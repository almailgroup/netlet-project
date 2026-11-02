import SwiftUI
import UIKit

/// The tab bar's five icons — the web's own drawing (`content/tabIcons.ts`,
/// exported to `tabIcons.json`): bold and wordless, on the owner's word,
/// after the picture they sent of a shop's bar — a rounded house, three
/// squares and a sparkle, a bag with a percent sign for the deals, a person
/// in a circle, the cart. An outline for each tab and a filled form for the
/// one that is chosen, drawn here as template images the system tints — navy
/// chosen, the bar's ink otherwise — so the tab bar stays Apple's own. A
/// `knockout` path is cut out of what is drawn (the percent through the
/// chosen bag), with the clear blend mode, since one tint cannot draw it.
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
    }

    struct Drawing: Decodable, Sendable {
        let outline: [Path]
        let filled: [Path]
    }

    struct File: Decodable, Sendable {
        let strokeWidth: Double
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
            drawn["\(icon.rawValue)-outline"] = render(drawing.outline, stroke: file.strokeWidth)
            drawn["\(icon.rawValue)-filled"] = render(drawing.filled, stroke: file.strokeWidth)
        }
        return drawn
    }()

    /// The icon as a template image, filled while its tab is the one showing;
    /// the SF Symbol it replaced if the drawing is missing.
    func image(filled: Bool) -> Image {
        if let drawn = Self.images["\(rawValue)-\(filled ? "filled" : "outline")"] {
            return Image(uiImage: drawn)
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

    /// The paths on the 24 grid, drawn at `side` points as a template.
    static func render(_ paths: [Path], stroke: Double) -> UIImage {
        let size = CGSize(width: side, height: side)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            let cg = context.cgContext
            cg.scaleBy(x: side / 24, y: side / 24)
            cg.setLineWidth(stroke)
            cg.setLineCap(.round)
            cg.setLineJoin(.round)
            cg.setFillColor(UIColor.black.cgColor)
            cg.setStrokeColor(UIColor.black.cgColor)
            // What is drawn first, then what is cut out of it.
            for path in paths.filter({ $0.knockout != true }) + paths.filter({ $0.knockout == true }) {
                cg.setBlendMode(path.knockout == true ? .clear : .normal)
                cg.addPath(cgPath(path.d))
                switch path.mode {
                case "fill": cg.fillPath()
                case "both": cg.drawPath(using: .fillStroke)
                default: cg.strokePath()
                }
            }
        }
        return image.withRenderingMode(.alwaysTemplate)
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
