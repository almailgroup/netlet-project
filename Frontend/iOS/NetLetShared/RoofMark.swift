import SwiftUI

/// NetLet's roof, the app icon's mark, as a vector in the icon's own
/// 1024-point grid: two bars at forty-five degrees meeting at the apex, their
/// caps making the notch on top, with a hole near each foot.
enum RoofMark {
    /// The mark's box in the icon's grid.
    static let box = CGRect(x: 145, y: 312, width: 734, height: 400)
    /// Inside the roof where its two bars overlap, under the notch and over
    /// the inside corner — the point the zoom goes into.
    static let apex = CGPoint(x: 512, y: 390)
    /// How far the nearest edge of the roof is from `apex`, in the grid: the
    /// notch above and the inside corner below are both this close.
    static let apexReach: CGFloat = 28

    /// The roof, holes cut, in the grid.
    static let path: Path = {
        let s = 1 / 2.squareRoot()
        // A bar laid flat — along it, then across it — before it is turned.
        let flat = Path(roundedRect: CGRect(x: -490 * s, y: 775 * s, width: 640 * s, height: 155 * s), cornerRadius: 22, style: .continuous)
        // Turned forty-five degrees up to the right: the left bar.
        let left = flat.applying(CGAffineTransform(a: s, b: -s, c: s, d: s, tx: 0, ty: 0))
        // Mirrored across the middle: the right bar.
        let right = left.applying(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: 1024, ty: 0))
        var holes = Path()
        holes.addEllipse(in: CGRect(x: 189, y: 605, width: 62, height: 62))
        holes.addEllipse(in: CGRect(x: 773, y: 605, width: 62, height: 62))
        return left.union(right).subtracting(holes)
    }()

    /// Where the grid goes on screen: the mark `width` wide and centred at
    /// zoom 1, and scaled by `zoom` about the apex, which stays where it is.
    static func placement(in rect: CGRect, width: CGFloat, zoom: CGFloat) -> CGAffineTransform {
        let rest = width / box.width
        let anchor = CGPoint(
            x: rect.midX + (apex.x - box.midX) * rest,
            y: rect.midY + (apex.y - box.midY) * rest
        )
        let scale = rest * zoom
        return CGAffineTransform(translationX: anchor.x, y: anchor.y)
            .scaledBy(x: scale, y: scale)
            .translatedBy(x: -apex.x, y: -apex.y)
    }

    /// The zoom at which the roof round the apex covers the whole screen: the
    /// nearest edge of the roof has to be past the farthest edge of the
    /// screen, with room to spare.
    static func zoomToCover(_ size: CGSize, width: CGFloat) -> CGFloat {
        let rest = width / box.width
        let farthest = max(size.width, size.height) / 2 + abs(apex.y - box.midY) * rest + 60
        return max(1, farthest / (apexReach * rest))
    }
}

/// The roof fitted into whatever box it is drawn in, keeping its shape —
/// the brand's mark on the Lock Screen and the home screen widget.
struct RoofGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let box = RoofMark.box
        let scale = min(rect.width / box.width, rect.height / box.height)
        let placed = CGAffineTransform(translationX: rect.midX, y: rect.midY)
            .scaledBy(x: scale, y: scale)
            .translatedBy(x: -box.midX, y: -box.midY)
        return RoofMark.path.applying(placed)
    }
}
