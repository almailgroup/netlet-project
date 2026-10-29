import SwiftUI

/// The NetLet points coin — the web's `PointsCoin`, shape for shape, on the
/// owner's word ("add a good coin icon for NetLet points"): an amber face lit
/// from above into the brand orange, a darker edge under it for thickness, a
/// pressed ring inside the rim, NetLet's N in the navy and a soft gloss at the
/// top. Drawn rather than a picture, so it is sharp at every size from a line
/// of text to the points page's 52 points.
///
/// Decorative: beside a figure that says "points" it is the figure's picture,
/// so VoiceOver skips it.
struct PointsCoin: View {
    var size: CGFloat = 20

    var body: some View {
        let unit = size / 40
        ZStack {
            Circle()
                .fill(Color(red: 0.784, green: 0.376, blue: 0.122))
                .frame(width: 35.2 * unit, height: 35.2 * unit)
                .offset(y: 1.6 * unit)
            Circle()
                .fill(LinearGradient(
                    stops: [
                        .init(color: Color(red: 1.0, green: 0.847, blue: 0.580), location: 0),
                        .init(color: Color(red: 0.984, green: 0.671, blue: 0.282), location: 0.5),
                        .init(color: Color(red: 0.949, green: 0.518, blue: 0.227), location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom))
                .frame(width: 35.2 * unit, height: 35.2 * unit)
                .offset(y: -0.4 * unit)
            Circle()
                .strokeBorder(
                    LinearGradient(colors: [.white.opacity(0.85), .white.opacity(0.1), .clear], startPoint: .top, endPoint: .bottom),
                    lineWidth: 1.2 * unit)
                .frame(width: 34 * unit, height: 34 * unit)
                .offset(y: -0.4 * unit)
            Circle()
                .stroke(Color(red: 0.847, green: 0.435, blue: 0.153).opacity(0.55), lineWidth: 1.3 * unit)
                .frame(width: 26.2 * unit, height: 26.2 * unit)
                .offset(y: -0.4 * unit)
            Circle()
                .stroke(Color.white.opacity(0.32), lineWidth: 0.8 * unit)
                .frame(width: 26.2 * unit, height: 26.2 * unit)
                .offset(y: 0.3 * unit)
            CoinLetter()
                .fill(Brand.navy)
                .frame(width: 12.4 * unit, height: 12.9 * unit)
                .offset(y: -0.25 * unit)
            Ellipse()
                .fill(Color.white.opacity(0.32))
                .frame(width: 14.4 * unit, height: 6.2 * unit)
                .rotationEffect(.degrees(-24))
                .offset(x: -5.5 * unit, y: -10.6 * unit)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The N at the coin's centre, the web's path `M14.3 26.1V13.2h3.1l6.2 8.3v-8.3h3.1v12.9h-3.1l-6.2-8.3v8.3z`
/// drawn in its own 12.4 × 12.9 box.
private struct CoinLetter: Shape {
    func path(in rect: CGRect) -> Path {
        let x = rect.width / 12.4, y = rect.height / 12.9
        var path = Path()
        path.move(to: CGPoint(x: 0, y: 12.9 * y))
        path.addLine(to: CGPoint(x: 0, y: 0))
        path.addLine(to: CGPoint(x: 3.1 * x, y: 0))
        path.addLine(to: CGPoint(x: 9.3 * x, y: 8.3 * y))
        path.addLine(to: CGPoint(x: 9.3 * x, y: 0))
        path.addLine(to: CGPoint(x: 12.4 * x, y: 0))
        path.addLine(to: CGPoint(x: 12.4 * x, y: 12.9 * y))
        path.addLine(to: CGPoint(x: 9.3 * x, y: 12.9 * y))
        path.addLine(to: CGPoint(x: 3.1 * x, y: 4.6 * y))
        path.addLine(to: CGPoint(x: 3.1 * x, y: 12.9 * y))
        path.closeSubpath()
        return path.offsetBy(dx: rect.minX, dy: rect.minY)
    }
}

/// A count in the page's language with its thousands grouped — "12,500" — in
/// Latin digits on both pages, the web's `formatCount`.
enum PointsFormat {
    static func count(_ value: Int, _ language: Language) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = language.locale
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}
