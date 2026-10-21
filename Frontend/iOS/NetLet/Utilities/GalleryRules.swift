import CoreGraphics

/// The product photos' arithmetic — the web's `gallery.ts` and the constants
/// `ZoomViewer` zooms by: which photo is next, how many the rail draws, and
/// where a zoom lands. Pure, so the tests can hold it to the web's numbers.
enum GalleryRules {
    /// A double tap's zoom (`TAP_ZOOM`), and the most a photo is enlarged (`MAX_ZOOM`).
    static let tapZoom: CGFloat = 2.5
    static let maxZoom: CGFloat = 4
    /// A zoom button's step.
    static let zoomStep: CGFloat = 0.5
    /// Thumbnails a phone's rail draws before "+N" (`RAIL_LIMIT_NARROW`).
    static let railLimit = 4

    /// The next or previous item, round the end (`galleryIndex`).
    static func step(_ current: Int, by offset: Int, count: Int) -> Int {
        guard count > 1 else { return 0 }
        return ((current + offset) % count + count) % count
    }

    /// How many thumbnails the rail draws, and how many more "+N" stands for.
    /// One limit drives both, or the tile would count photos beside it.
    static func rail(count: Int) -> (shown: Int, more: Int) {
        count > railLimit ? (railLimit, count - railLimit) : (count, 0)
    }

    /// The zoom in button: from the photo's own size straight to a double
    /// tap's, then a step at a time up to the most.
    static func zoomedIn(from scale: CGFloat) -> CGFloat {
        scale <= 1 ? tapZoom : min(maxZoom, scale + zoomStep)
    }

    static func zoomedOut(from scale: CGFloat) -> CGFloat {
        max(1, scale - zoomStep)
    }

    /// The part of a photo that fills `viewport` at `scale`, centred on
    /// `point` in the photo's own coordinates — so the spot double-tapped is
    /// the spot that stays under the finger.
    static func zoomRect(around point: CGPoint, scale: CGFloat, viewport: CGSize) -> CGRect {
        let width = viewport.width / scale
        let height = viewport.height / scale
        return CGRect(x: point.x - width / 2, y: point.y - height / 2, width: width, height: height)
    }

    /// A picture of `size` drawn whole inside `box`, as large as it fits.
    static func fitted(_ size: CGSize, in box: CGSize) -> CGSize {
        guard size.width > 0, size.height > 0 else { return box }
        let ratio = min(box.width / size.width, box.height / size.height)
        return CGSize(width: size.width * ratio, height: size.height * ratio)
    }

    /// The first photo whose description names `value` as a whole word — the
    /// web's rule for showing a colour's photo — with Arabic's article taken
    /// off. Videos are never chosen.
    static func photoIndex(naming value: String, in gallery: [ProductMedia]) -> Int? {
        let word = value.lowercased()
        guard !word.isEmpty else { return nil }
        return gallery.firstIndex { item in
            guard !item.isVideo else { return false }
            return (item.altText ?? "").lowercased()
                .split(whereSeparator: { !$0.isLetter && !$0.isNumber })
                .contains { $0 == word || $0 == "ال" + word }
        }
    }
}
