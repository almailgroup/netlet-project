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
}
