import UIKit

/// A listing photo made ready for `/api/media` on the phone, as the web does
/// it in the seller's browser (`preparePhoto.ts`): turned upright, shrunk so
/// its longer edge is at most `maxEdge`, and re-encoded as JPEG under the
/// server's byte ceiling. Re-encoding also drops the camera's location data.
enum ImagePreparation {
    enum Problem: Error, Equatable {
        /// Smaller than the server accepts — `media.tooSmall`.
        case tooSmall
        /// Not a picture this phone can read.
        case unreadable
    }

    static func jpeg(from data: Data, rules: Rules.Media) throws -> Data {
        guard let image = UIImage(data: data) else { throw Problem.unreadable }
        return try jpeg(from: image, rules: rules)
    }

    static func jpeg(from image: UIImage, rules: Rules.Media) throws -> Data {
        let size = image.size
        let shorter = min(size.width, size.height) * image.scale
        guard shorter >= CGFloat(rules.minEdge) else { throw Problem.tooSmall }

        let longer = max(size.width, size.height) * image.scale
        let factor = min(1, CGFloat(rules.maxEdge) / longer)
        let target = CGSize(width: (size.width * image.scale * factor).rounded(), height: (size.height * image.scale * factor).rounded())

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let drawn = UIGraphicsImageRenderer(size: target, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: target))
            image.draw(in: CGRect(origin: .zero, size: target))
        }

        for quality in [0.85, 0.75, 0.65, 0.5] as [CGFloat] {
            if let encoded = drawn.jpegData(compressionQuality: quality), encoded.count <= rules.maxUploadBytes {
                return encoded
            }
        }
        guard let smallest = drawn.jpegData(compressionQuality: 0.35) else { throw Problem.unreadable }
        return smallest
    }

    /// A profile photo (`Shared/commerce/profilePhoto.ts`): the largest square
    /// the picture holds, from its centre, at `edge` — or the picture's own
    /// size when smaller, never under the upload floor, so a small picture is
    /// drawn up rather than refused — under `maxBytes` as JPEG. The web's
    /// `prepareProfilePhoto`; the server checks the square again.
    static func squareJPEG(from image: UIImage, edge: Int, minEdge: Int, maxBytes: Int) throws -> (data: Data, image: UIImage) {
        let width = image.size.width * image.scale
        let height = image.size.height * image.scale
        let side = min(width, height)
        guard side > 0 else { throw Problem.unreadable }
        let target = CGFloat(max(minEdge, min(Int(side.rounded(.down)), edge)))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let factor = target / side
        let drawn = UIGraphicsImageRenderer(size: CGSize(width: target, height: target), format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: target, height: target))
            // Drawn upright (`draw(in:)` honours the photo's orientation), centred on the square.
            image.draw(in: CGRect(x: (target - width * factor) / 2, y: (target - height * factor) / 2, width: width * factor, height: height * factor))
        }
        for quality in [0.85, 0.75, 0.65, 0.5] as [CGFloat] {
            if let encoded = drawn.jpegData(compressionQuality: quality), encoded.count <= maxBytes {
                return (encoded, drawn)
            }
        }
        throw Problem.unreadable
    }
}

extension ImagePreparation {
    /// `jpeg(from:rules:)` off the main thread. A photo from the library is
    /// twelve megapixels: decoding it, drawing it smaller and encoding it
    /// again takes a few hundred milliseconds, and on the main thread that is
    /// a press that does not answer and a spinner that does not turn.
    static func jpegOffMain(from data: Data, rules: Rules.Media) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            try jpeg(from: data, rules: rules)
        }.value
    }

    /// `squareJPEG` off the main thread, for the same reason.
    static func squareJPEGOffMain(from image: UIImage, edge: Int, minEdge: Int, maxBytes: Int) async throws -> (data: Data, image: UIImage) {
        try await Task.detached(priority: .userInitiated) {
            try squareJPEG(from: image, edge: edge, minEdge: minEdge, maxBytes: maxBytes)
        }.value
    }
}
