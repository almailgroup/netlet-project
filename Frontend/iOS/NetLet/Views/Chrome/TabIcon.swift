import SwiftUI
import UIKit

/// The tab bar's five icons — the web's own drawing (`content/tabIcons.ts`,
/// exported to `tabIcons.json`): bold and wordless, on the owner's word,
/// after the picture they sent of a shop's bar — a rounded house, three
/// squares and a sparkle, a red shopping bag with a percent for the deals, a
/// person in a circle, the cart. An outline for each tab and a filled form
/// for the one that is chosen, drawn here as template images the system tints
/// — navy chosen, the bar's ink otherwise — so the tab bar stays Apple's own.
///
/// **Deals keeps its own red and is drawn a little larger, on the owner's
/// word**: an icon with `color` is drawn in it (`deep` paths in the darker
/// one) as an original image the system leaves alone, at its own `size`. A
/// `knockout` path is cut out of what is drawn, with the clear blend mode —
/// the percent on the chosen bag, so the bar shows through it.
///
/// The paths are absolute M, L, H, V, C and Z alone, the parser below being
/// all it takes; a test draws every one.
enum TabIcon: String, CaseIterable {
    case home, categories, deals, profile, cart

    struct Path: Decodable, Sendable {
        let d: String
        let mode: String
        /// Cut out of what is drawn rather than drawn.
        var knockout: Bool?
        /// Drawn in the icon's darker colour.
        var deep: Bool?
    }

    /// An icon's own colours, as `#rrggbb`.
    struct Colors: Decodable, Sendable {
        let ink: String
        let deep: String
    }

    struct Drawing: Decodable, Sendable {
        let outline: [Path]
        let filled: [Path]
        /// Drawn larger than the rest.
        var size: Double?
        /// Its own colours, kept whether chosen or not; none takes the tint.
        var color: Colors?
    }

    struct File: Decodable, Sendable {
        let strokeWidth: Double
        var size: Double?
        let icons: [String: Drawing]
    }

    /// An icon's size, in points — larger than the system's 25, as the words
    /// under it are gone and the picture the owner sent draws them bold.
    static let side: CGFloat = 28

    static let file: File? = try? JSONDecoder().decode(File.self, from: Bundle.main.resource("tabIcons", "json"))

    /// Every icon in both forms, drawn once.
    private static let images: [String: UIImage] = {
        var drawn: [String: UIImage] = [:]
        guard let file else { return drawn }
        for icon in TabIcon.allCases {
            guard let drawing = file.icons[icon.rawValue] else { continue }
            let side = CGFloat(drawing.size ?? file.size ?? Double(TabIcon.side))
            drawn["\(icon.rawValue)-outline"] = render(drawing.outline, stroke: file.strokeWidth, side: side, colors: drawing.color)
            drawn["\(icon.rawValue)-filled"] = render(drawing.filled, stroke: file.strokeWidth, side: side, colors: drawing.color)
        }
        return drawn
    }()

    /// The icon, filled while its tab is the one showing — a template the
    /// system tints, or in its own colours (`renderingMode(.original)`, so a
    /// tint never paints over the red); the SF Symbol it replaced if the
    /// drawing is missing.
    func image(filled: Bool) -> Image {
        if let drawn = Self.images["\(rawValue)-\(filled ? "filled" : "outline")"] {
            return Image(uiImage: drawn)
                .renderingMode(drawn.renderingMode == .alwaysOriginal ? .original : .template)
        }
        return Image(systemName: fallback)
    }

    private var fallback: String {
        switch self {
        case .home: return "house"
        case .categories: return "square.grid.2x2"
        case .deals: return "bag"
        case .profile: return "person.crop.circle"
        case .cart: return "cart"
        }
    }

    /// The paths on the 24 grid, drawn at `side` points — as a template, or
    /// in the icon's own colours as an original image.
    static func render(_ paths: [Path], stroke: Double, side: CGFloat = TabIcon.side, colors: Colors? = nil) -> UIImage {
        let size = CGSize(width: side, height: side)
        let ink = colors.flatMap { color($0.ink) } ?? .black
        let deep = colors.flatMap { color($0.deep) } ?? ink
        let image = UIGraphicsImageRenderer(size: size).image { context in
            let cg = context.cgContext
            cg.scaleBy(x: side / 24, y: side / 24)
            cg.setLineWidth(stroke)
            cg.setLineCap(.round)
            cg.setLineJoin(.round)
            // What is drawn first, then what is cut out of it.
            for path in paths.filter({ $0.knockout != true }) + paths.filter({ $0.knockout == true }) {
                let paint = path.deep == true ? deep : ink
                cg.setFillColor(paint.cgColor)
                cg.setStrokeColor(paint.cgColor)
                cg.setBlendMode(path.knockout == true ? .clear : .normal)
                cg.addPath(cgPath(path.d))
                switch path.mode {
                case "fill": cg.fillPath()
                case "both": cg.drawPath(using: .fillStroke)
                default: cg.strokePath()
                }
            }
        }
        return image.withRenderingMode(colors == nil ? .alwaysTemplate : .alwaysOriginal)
    }

    /// `#rrggbb` as a colour, or nil for anything else.
    static func color(_ hex: String) -> UIColor? {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }

    /// A path of absolute M, L, H, V, C and Z, the only commands the web's
    /// drawing uses (`TAB_ICON_COMMANDS`).
    static func cgPath(_ d: String) -> CGPath {
        let path = CGMutablePath()
        var spaced = ""
        for character in d {
            if "MLHVCZ".contains(character) { spaced += " \(character) " } else { spaced.append(character) }
        }
        let tokens = spaced.split(whereSeparator: \.isWhitespace).map(String.init)
        var index = 0
        var current = CGPoint.zero
        var command = "M"
        func number() -> CGFloat {
            defer { index += 1 }
            return index < tokens.count ? CGFloat(Double(tokens[index]) ?? 0) : 0
        }
        while index < tokens.count {
            let token = tokens[index]
            if token.count == 1, "MLHVCZ".contains(token) {
                command = token
                index += 1
                if command == "Z" { path.closeSubpath() }
                continue
            }
            switch command {
            case "M":
                current = CGPoint(x: number(), y: number())
                path.move(to: current)
                command = "L"
            case "L":
                current = CGPoint(x: number(), y: number())
                path.addLine(to: current)
            case "H":
                current = CGPoint(x: number(), y: current.y)
                path.addLine(to: current)
            case "V":
                current = CGPoint(x: current.x, y: number())
                path.addLine(to: current)
            case "C":
                let first = CGPoint(x: number(), y: number())
                let second = CGPoint(x: number(), y: number())
                current = CGPoint(x: number(), y: number())
                path.addCurve(to: current, control1: first, control2: second)
            default:
                index += 1
            }
        }
        return path
    }
}
