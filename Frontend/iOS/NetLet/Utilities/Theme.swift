import SwiftUI

/// NetLet's palette, the web's own values: navy, the brand orange as a fill,
/// pearl as the ground. The orange is never used for words — on white it is
/// 3.08:1 — so words that would be orange use `accentInk` instead.
enum Brand {
    static let navy = Color(red: 10 / 255, green: 40 / 255, blue: 90 / 255)
    static let navyPressed = Color(red: 13 / 255, green: 51 / 255, blue: 114 / 255)
    static let orange = Color(red: 242 / 255, green: 104 / 255, blue: 58 / 255)
    static let pearl = Color(red: 243 / 255, green: 242 / 255, blue: 237 / 255)
    static let ink = Color(red: 31 / 255, green: 39 / 255, blue: 51 / 255)
    static let muted = Color(red: 83 / 255, green: 107 / 255, blue: 140 / 255)
    static let accentInk = Color(red: 164 / 255, green: 74 / 255, blue: 43 / 255)
    static let success = Color(red: 47 / 255, green: 93 / 255, blue: 51 / 255)
    static let danger = Color(red: 140 / 255, green: 47 / 255, blue: 34 / 255)
    static let line = Color(red: 213 / 255, green: 223 / 255, blue: 235 / 255)
    static let tint = Color(red: 238 / 255, green: 242 / 255, blue: 248 / 255)
}

/// The shop's main action: navy, full width, a thumb's height.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(isEnabled ? (configuration.isPressed ? Brand.navyPressed : Brand.navy) : Brand.navy.opacity(0.35))
            )
    }
}

/// The quieter action beside it: white, a navy rim, navy words.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(Brand.navy)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(configuration.isPressed ? Brand.tint : Color.white)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Brand.navy.opacity(0.25), lineWidth: 1)
            )
    }
}

extension View {
    /// A white card on the pearl ground, the web's `CARD`.
    func card() -> some View {
        padding(16)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
    }
}
