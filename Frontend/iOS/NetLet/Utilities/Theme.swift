import SwiftUI

/// The shop's main action: navy Liquid Glass, full width, a thumb's height.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(15, .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .liquidGlass(.navy, enabled: isEnabled, pressed: configuration.isPressed)
            .pressHaptic(configuration.isPressed)
    }
}

/// An act that cannot be taken back — deleting for good: white on the shop's
/// red glass, the web's danger button, only ever behind a confirmation.
struct DangerButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(15, .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .liquidGlass(.danger, enabled: isEnabled, pressed: configuration.isPressed)
            .pressHaptic(configuration.isPressed)
    }
}

/// The orange action, in orange glass with navy words on it (4.65:1): Checkout, Today's deals.
struct AccentButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(15, .bold))
            .foregroundStyle(Brand.navy)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .liquidGlass(.orange, enabled: isEnabled, pressed: configuration.isPressed)
            .pressHaptic(configuration.isPressed)
    }
}

/// The quieter action beside it: light glass under navy words.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(15, .bold))
            .foregroundStyle(Brand.navy.opacity(isEnabled ? 1 : 0.45))
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .liquidGlass(.clear, enabled: isEnabled, pressed: configuration.isPressed)
            .pressHaptic(configuration.isPressed)
    }
}

/// A press anywhere on a tile shades it the way a finger shades the web's
/// controls (`(hover: none)` and `:active`): the press fill, nothing moving.
struct PressFillStyle: ButtonStyle {
    var cornerRadius: CGFloat = 16
    /// How firmly a press is felt — half, as every haptic in the app is now
    /// (`Haptics.strength`); kept a setting so a press can be told apart again.
    var strength: CGFloat = Haptics.buttonStrength

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Brand.navy.opacity(configuration.isPressed ? 0.06 : 0))
                    .allowsHitTesting(false)
            )
            .pressHaptic(configuration.isPressed, strength: strength)
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

/// The sign-in's calm colours, the web's: a pale sky and a pale peach drawn
/// from the brand's navy and orange, and a soft fill for the boxes, so the
/// form is easy on the eyes and nothing on it is louder than its button.
enum Calm {
    /// The Sign in | Create account track.
    static let track = Color(red: 233 / 255, green: 239 / 255, blue: 247 / 255)
    /// A box at rest, and its rim.
    static let field = Color(red: 245 / 255, green: 248 / 255, blue: 252 / 255)
    static let rim = Color(red: 214 / 255, green: 223 / 255, blue: 235 / 255)
    /// The password's tile and the code's.
    static let sky = Color(red: 227 / 255, green: 236 / 255, blue: 248 / 255)
    static let peach = Color(red: 253 / 255, green: 233 / 255, blue: 222 / 255)
    static let peachInk = Color(red: 164 / 255, green: 74 / 255, blue: 43 / 255)
    /// A chosen tile.
    static let chosen = Color(red: 243 / 255, green: 247 / 255, blue: 252 / 255)
    static let icon = Color(red: 107 / 255, green: 127 / 255, blue: 156 / 255)
}
