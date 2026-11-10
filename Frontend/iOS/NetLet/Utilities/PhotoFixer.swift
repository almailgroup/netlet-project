import UIKit

/// One of the fixes a product photo was given on the way in (3.3.4), the
/// web's `Fix`: its name is what the seller is told.
enum PhotoFix: String, Sendable, Equatable {
    case trimmed, squared, levelled, resized

    /// The dictionary's words for it (`media.fixTrimmed`…).
    var labelKey: String {
        switch self {
        case .trimmed: return "media.fixTrimmed"
        case .squared: return "media.fixSquared"
        case .levelled: return "media.fixLevelled"
        case .resized: return "media.fixResized"
        }
    }
}

/// A photo made ready to store: a JPEG the server takes, and what was done to it.
struct PreparedPhoto: Sendable, Equatable {
    let jpeg: Data
    let width: Int
    let height: Int
    let fixes: [PhotoFix]

    /// Whether anything but the resize happened: what makes "Fixed" worth offering.
    var changed: Bool { fixes.contains { $0 != .resized } }
}

/// A seller's photo, fixed and made ready to store — the web's
/// `Shared/commerce/media.ts` and `lib/preparePhoto.ts` in Swift, rule for
/// rule, so a photo added from the phone gets what one added in a browser
/// does. The app's uploads were only shrunk and re-encoded.
///
/// In order, and each only where it applies: **trim** a border of one colour,
/// when the four corners agree what that colour is; **square** it on that
/// colour with a margin, so a grid of cards lines up; **level** a flat photo,
/// every channel together and capped, so nothing is tinted or blown out;
/// **shrink** to the longest edge the shop stores and re-encode, which also
/// drops the camera's location. Each one that happened is named, and the
/// seller chooses between this and the photo as they took it.
///
/// The decisions are plain arithmetic over RGBA bytes, tested on the shared
/// rule's own cases; only `prepare` touches a picture.
enum PhotoFixer {
    struct Rgb: Equatable, Sendable {
        var r: Int
        var g: Int
        var b: Int
    }

    struct Box: Equatable, Sendable {
        var x: Int
        var y: Int
        var width: Int
        var height: Int
    }

    /// Within this many levels of each other, two colours are the same background.
    static let backgroundTolerance = 18
    /// The working copy is analysed at most this large: reading every pixel of
    /// a 12-megapixel photo stalls a phone.
    static let analysisEdge = 2400

    // MARK: The decisions

    /// How far apart two colours are, as the largest channel difference.
    static func gap(_ a: Rgb, _ b: Rgb) -> Int {
        max(abs(a.r - b.r), abs(a.g - b.g), abs(a.b - b.b))
    }

    static func pixel(_ data: [UInt8], width: Int, x: Int, y: Int) -> Rgb {
        let i = (y * width + x) * 4
        return Rgb(r: Int(data[i]), g: Int(data[i + 1]), b: Int(data[i + 2]))
    }

    /// The background colour, when the four corners agree on one; nil for a
    /// photo with no uniform border, which is then neither trimmed nor padded.
    static func uniformBackground(_ data: [UInt8], width: Int, height: Int) -> Rgb? {
        guard width > 2, height > 2, data.count >= width * height * 4 else { return nil }
        let inset = max(1, Int(Double(min(width, height)) * 0.01))
        let corners = [
            pixel(data, width: width, x: inset, y: inset),
            pixel(data, width: width, x: width - 1 - inset, y: inset),
            pixel(data, width: width, x: inset, y: height - 1 - inset),
            pixel(data, width: width, x: width - 1 - inset, y: height - 1 - inset),
        ]
        for corner in corners.dropFirst() where gap(corner, corners[0]) > backgroundTolerance { return nil }
        func average(_ channel: (Rgb) -> Int) -> Int {
            Int((Double(corners.reduce(0) { $0 + channel($1) }) / 4).rounded())
        }
        return Rgb(r: average(\.r), g: average(\.g), b: average(\.b))
    }

    /// The smallest box holding everything that is not background, or nil for
    /// a blank frame. Sampled on a grid rather than every pixel.
    static func contentBox(_ data: [UInt8], width: Int, height: Int, background: Rgb) -> Box? {
        let step = max(1, min(width, height) / 400)
        var minX = width, minY = height, maxX = -1, maxY = -1
        var y = 0
        while y < height {
            var x = 0
            while x < width {
                if gap(pixel(data, width: width, x: x, y: y), background) > backgroundTolerance {
                    if x < minX { minX = x }
                    if y < minY { minY = y }
                    if x > maxX { maxX = x }
                    if y > maxY { maxY = y }
                }
                x += step
            }
            y += step
        }
        guard maxX >= 0 else { return nil }
        minX = max(0, minX - step)
        minY = max(0, minY - step)
        maxX = min(width - 1, maxX + step)
        maxY = min(height - 1, maxY + step)
        return Box(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    /// The square a trimmed product sits in, with this share of margin on each side.
    static func squareAround(_ box: Box, margin: Double = 0.08) -> Int {
        Int((Double(max(box.width, box.height)) * (1 + margin * 2)).rounded())
    }

    /// The black and white points to stretch to, or nil when the photo already
    /// spans the range. The histogram is of every channel value together, the
    /// darkest and lightest half-percent are clipped, and the points are
    /// capped — black at 40, white at 215 — so the strongest lift is about a
    /// third: measured on brightness and uncapped, a dim brown product came
    /// out maroon.
    static func levels(for histogram: [Int], total: Int) -> (low: Int, high: Int)? {
        guard histogram.count == 256 else { return nil }
        let clip = Double(total) * 0.005
        var low = 0
        var seen = 0
        while low < 255, Double(seen + histogram[low]) <= clip {
            seen += histogram[low]
            low += 1
        }
        var high = 255
        seen = 0
        while high > 0, Double(seen + histogram[high]) <= clip {
            seen += histogram[high]
            high -= 1
        }
        // Already close to full range, or too narrow to stretch without inventing detail.
        if (low <= 10 && high >= 245) || high - low < 64 { return nil }
        return (min(low, 40), max(high, 215))
    }

    /// A lookup table that stretches `low...high` to `0...255`.
    static func levelsTable(low: Int, high: Int) -> [UInt8] {
        (0..<256).map { value in
            let stretched = (Double(value - low) * 255 / Double(high - low)).rounded()
            return UInt8(max(0, min(255, stretched)))
        }
    }

    // MARK: Pictures

    /// The bytes as a picture this phone can read.
    static func image(from data: Data) throws -> UIImage {
        guard let image = UIImage(data: data) else { throw ImagePreparation.Problem.unreadable }
        return image
    }

    /// The picture's pixels as RGBA, a row after a row from the top.
    static func rgba(of image: CGImage) -> [UInt8]? {
        let width = image.width
        let height = image.height
        guard width > 0, height > 0 else { return nil }
        var data = [UInt8](repeating: 255, count: width * height * 4)
        let drawn = data.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? data : nil
    }

    /// Those bytes as a picture again, holding its own copy of them.
    static func picture(rgba: [UInt8], width: Int, height: Int) -> CGImage? {
        guard rgba.count == width * height * 4, let provider = CGDataProvider(data: Data(rgba) as CFData) else { return nil }
        return CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: true,
            intent: .defaultIntent
        )
    }

    /// Draws at exactly this many pixels, opaque, whatever the screen's scale.
    private static func render(width: Int, height: Int, _ draw: (CGRect) -> Void) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let size = CGSize(width: width, height: height)
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            draw(CGRect(origin: .zero, size: size))
        }
    }

    /// The photo made ready to store. With `fix` false only the shrink and the
    /// re-encode happen: the seller's framing, kept as they took it, still has
    /// to be a size and a type NetLet stores.
    static func prepare(_ image: UIImage, fix: Bool, minEdge: Int, maxEdge: Int, maxBytes: Int) throws -> PreparedPhoto {
        let fullWidth = image.size.width * image.scale
        let fullHeight = image.size.height * image.scale
        guard fullWidth >= 1, fullHeight >= 1 else { throw ImagePreparation.Problem.unreadable }
        var fixes: [PhotoFix] = []

        // The working copy, upright (`draw(in:)` honours the camera's orientation).
        let scale = min(1, CGFloat(analysisEdge) / max(fullWidth, fullHeight))
        let workWidth = max(1, Int((fullWidth * scale).rounded()))
        let workHeight = max(1, Int((fullHeight * scale).rounded()))
        let work = render(width: workWidth, height: workHeight) { rect in
            UIColor.white.setFill()
            UIRectFill(rect)
            image.draw(in: rect)
        }
        guard let workImage = work.cgImage else { throw ImagePreparation.Problem.unreadable }

        var source = Box(x: 0, y: 0, width: workWidth, height: workHeight)
        var background: Rgb?
        if fix, let pixels = rgba(of: workImage) {
            background = uniformBackground(pixels, width: workWidth, height: workHeight)
            if let background, let box = contentBox(pixels, width: workWidth, height: workHeight, background: background),
               Double(box.width) < Double(workWidth) * 0.97 || Double(box.height) < Double(workHeight) * 0.97 {
                source = box
                fixes.append(.trimmed)
            }
        }

        // Squared on its own background, with a margin, when there is one.
        let side = fix && background != nil ? squareAround(source) : 0
        let wantedWidth = side > 0 ? side : source.width
        let wantedHeight = side > 0 ? side : source.height
        let shrink = min(1, Double(maxEdge) / Double(max(wantedWidth, wantedHeight)))
        let outWidth = Int((Double(wantedWidth) * shrink).rounded())
        let outHeight = Int((Double(wantedHeight) * shrink).rounded())
        guard min(outWidth, outHeight) >= minEdge else { throw ImagePreparation.Problem.tooSmall }
        if shrink < 1 || scale < 1 { fixes.append(.resized) }

        guard let cropped = workImage.cropping(to: CGRect(x: source.x, y: source.y, width: source.width, height: source.height)) else {
            throw ImagePreparation.Problem.unreadable
        }
        let piece = UIImage(cgImage: cropped)
        var out = render(width: outWidth, height: outHeight) { rect in
            if side > 0, let background {
                UIColor(red: CGFloat(background.r) / 255, green: CGFloat(background.g) / 255, blue: CGFloat(background.b) / 255, alpha: 1).setFill()
                UIRectFill(rect)
                let drawWidth = CGFloat(Double(source.width) * shrink)
                let drawHeight = CGFloat(Double(source.height) * shrink)
                piece.draw(in: CGRect(x: (rect.width - drawWidth) / 2, y: (rect.height - drawHeight) / 2, width: drawWidth, height: drawHeight))
            } else {
                piece.draw(in: rect)
            }
        }
        if side > 0, Double(abs(source.width - source.height)) > Double(max(source.width, source.height)) * 0.02 {
            fixes.append(.squared)
        }

        if fix, let outImage = out.cgImage, var pixels = rgba(of: outImage) {
            // Every channel value, not brightness — see `levels(for:total:)`.
            var histogram = [Int](repeating: 0, count: 256)
            var i = 0
            while i < pixels.count {
                histogram[Int(pixels[i])] += 1
                histogram[Int(pixels[i + 1])] += 1
                histogram[Int(pixels[i + 2])] += 1
                i += 4
            }
            if let points = levels(for: histogram, total: outWidth * outHeight * 3) {
                let table = levelsTable(low: points.low, high: points.high)
                i = 0
                while i < pixels.count {
                    pixels[i] = table[Int(pixels[i])]
                    pixels[i + 1] = table[Int(pixels[i + 1])]
                    pixels[i + 2] = table[Int(pixels[i + 2])]
                    i += 4
                }
                if let levelled = picture(rgba: pixels, width: outWidth, height: outHeight) {
                    out = UIImage(cgImage: levelled)
                    fixes.append(.levelled)
                }
            }
        }

        // Quality steps down until it fits, though at 1200 pixels it nearly always fits first time.
        for quality in [0.86, 0.76, 0.64, 0.5, 0.35] as [CGFloat] {
            if let encoded = out.jpegData(compressionQuality: quality), encoded.count <= maxBytes {
                return PreparedPhoto(jpeg: encoded, width: outWidth, height: outHeight, fixes: fixes)
            }
        }
        throw ImagePreparation.Problem.unreadable
    }
}
