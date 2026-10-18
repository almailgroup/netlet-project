import CoreText
import SwiftUI
import UIKit

/// Inter, the web's face, from the one variable file the app carries
/// (`Resources/Fonts/InterVariable.ttf`, registered under `UIAppFonts`).
///
/// The web asks Google Fonts for Inter at 400 to 700 and nothing else, so its
/// `font-extrabold` has always drawn at 700; `.heavy` here is 700 for the same
/// reason. Inter has no Arabic, and Arabic words fall back to the system's
/// Arabic face, as they do in a browser.
enum Inter {
    enum Weight: CGFloat {
        case regular = 400
        case medium = 500
        case semibold = 600
        case bold = 700
        /// The web's `font-extrabold`, which renders at 700 there.
        case heavy = 700.5
    }

    /// The variable axis Inter's weight lives on, as CoreText names it ('wght').
    private static let weightAxis = 0x7767_6874

    static func uiFont(_ size: CGFloat, _ weight: Weight) -> UIFont {
        let value = min(weight.rawValue, 700)
        let descriptor = UIFontDescriptor(fontAttributes: [
            .name: "InterVariable",
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [weightAxis: value],
        ])
        return UIFont(descriptor: descriptor, size: size)
    }
}

extension Font {
    /// Inter at the web's pixel size, grown with the reader's own text size.
    static func inter(_ size: CGFloat, _ weight: Inter.Weight = .regular) -> Font {
        Font(UIFontMetrics.default.scaledFont(for: Inter.uiFont(size, weight)) as CTFont)
    }
}
