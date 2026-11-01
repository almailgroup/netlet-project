import SwiftUI
import UIKit

/// The tab bar's four icons — the web's own drawing (`content/tabIcons.ts`,
/// exported to `tabIcons.json`), on the owner's word ("see if you can improve
/// the icon design for the menu at the bottom").
///
/// They were SF Symbols — a house, a person, a cart and a grid — beside the
/// web's own set, so the app's bar and the web's drew four different
/// pictures. Now one set: one line weight, round caps and joins, the house's
/// roof NetLet's own, an outline for each tab and a filled form for the one
/// that is chosen, drawn here as template images the system tints — navy
/// chosen, the bar's ink otherwise — so the tab bar stays Apple's own.
///
/// The paths are absolute M, L, H, V, C and Z alone, the parser below being
/// all it takes; a test draws every one.
enum TabIcon: String, CaseIterable {
    case home, profile, cart, categories

    struct Path: Decodable, Sendable {
        let d: String
        let mode: String
    }

    struct Drawing: Decodable, Sendable {
        let outline: [Path]
        let filled: [Path]
    }

    struct File: Decodable, Sendable {
        let strokeWidth: Double
        let icons: [String: Drawing]
    }

    /// The tab bar's own size for an icon, in points.
    static let side: CGFloat = 25

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
        case .profile: return "person"
        case .cart: return "cart"
        case .categories: return "square.grid.2x2"
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
            for path in paths {
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
