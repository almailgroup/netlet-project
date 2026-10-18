import SwiftUI

/// NetLet's palette, the web's own values (`index.css` and the components):
/// navy, the brand orange as a fill, and the page's near-white ground. The
/// orange is never used for words — on white it is 3.08:1 — so words that
/// would be orange use `accentInk` instead, and words on it are navy.
enum Brand {
    static let navy = Color(red: 10 / 255, green: 40 / 255, blue: 90 / 255)
    static let navyPressed = Color(red: 13 / 255, green: 51 / 255, blue: 114 / 255)
    static let orange = Color(red: 242 / 255, green: 104 / 255, blue: 58 / 255)
    static let pearl = Color(red: 243 / 255, green: 242 / 255, blue: 237 / 255)
    /// The page's own background, `--background` (#fafafa).
    static let ground = Color(red: 250 / 255, green: 250 / 255, blue: 250 / 255)
    static let ink = Color(red: 31 / 255, green: 34 / 255, blue: 41 / 255)
    /// Body copy under a heading (#404553).
    static let body = Color(red: 64 / 255, green: 69 / 255, blue: 83 / 255)
    /// The tab bar's words, near-black over its glass (#16181d).
    static let nearBlack = Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255)
    static let muted = Color(red: 83 / 255, green: 107 / 255, blue: 140 / 255)
    static let accentInk = Color(red: 164 / 255, green: 74 / 255, blue: 43 / 255)
    /// The orange's words over navy, where darkening it would make it worse.
    static let accentOnDark = Color(red: 255 / 255, green: 171 / 255, blue: 133 / 255)
    static let success = Color(red: 47 / 255, green: 93 / 255, blue: 51 / 255)
    static let successFill = Color(red: 227 / 255, green: 239 / 255, blue: 228 / 255)
    static let danger = Color(red: 140 / 255, green: 47 / 255, blue: 34 / 255)
    /// A field's or a panel's rim (#d5dfeb).
    static let line = Color(red: 213 / 255, green: 223 / 255, blue: 235 / 255)
    /// A card's rim, `CARD` (#e6e9ef).
    static let cardLine = Color(red: 230 / 255, green: 233 / 255, blue: 239 / 255)
    /// The pale navy an icon sits on (#eef2f8).
    static let tint = Color(red: 238 / 255, green: 242 / 255, blue: 248 / 255)
    /// Behind a product photograph (#f4f6f9).
    static let photo = Color(red: 244 / 255, green: 246 / 255, blue: 249 / 255)
    /// The hover and press fill on white (#f0f2f5).
    static let pressFill = Color(red: 240 / 255, green: 242 / 255, blue: 245 / 255)
    /// The tab bar's current-tab pill (#ececef).
    static let tabPill = Color(red: 236 / 255, green: 236 / 255, blue: 239 / 255)
    static let star = Color(red: 255 / 255, green: 184 / 255, blue: 0 / 255)
    static let chevron = Color(red: 138 / 255, green: 160 / 255, blue: 189 / 255)
}

/// The shop's main action: navy, full width, a thumb's height.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(15, .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(
                Capsule()
                    .fill(isEnabled ? (configuration.isPressed ? Brand.navyPressed : Brand.navy) : Brand.navy.opacity(0.35))
            )
    }
}

/// The orange action, with navy words on it (4.65:1): Place order, Today's deals.
struct AccentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(15, .bold))
            .foregroundStyle(Brand.navy)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(Capsule().fill(Brand.orange.opacity(isEnabled ? 1 : 0.45)))
            .overlay(Capsule().fill(Brand.navy.opacity(configuration.isPressed ? 0.06 : 0)))
    }
}

/// The quieter action beside it: white, a navy rim, navy words.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(15, .bold))
            .foregroundStyle(Brand.navy)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(Capsule().fill(configuration.isPressed ? Brand.pressFill : Color.white))
            .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.2), lineWidth: 1))
    }
}

/// A press anywhere on a tile shades it the way a finger shades the web's
/// controls (`(hover: none)` and `:active`): the press fill, nothing moving.
struct PressFillStyle: ButtonStyle {
    var cornerRadius: CGFloat = 16

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Brand.navy.opacity(configuration.isPressed ? 0.06 : 0))
                    .allowsHitTesting(false)
            )
    }
}

extension View {
    /// A white card on the ground, the web's `CARD`: white, a hairline rim, 16 round.
    func card(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    /// A section's or a shelf's heading: 20px, extra bold, navy (`text-xl font-extrabold`).
    func shelfTitle(onDark: Bool = false) -> some View {
        font(.inter(20, .heavy))
            .tracking(-0.2)
            .foregroundStyle(onDark ? Color.white : Brand.navy)
            .accessibilityAddTraits(.isHeader)
    }

    /// A page's own title: 24px on a phone, the web's `TITLE`.
    func pageTitle() -> some View {
        font(.inter(24, .heavy))
            .tracking(-0.24)
            .foregroundStyle(Brand.navy)
            .accessibilityAddTraits(.isHeader)
    }
}
