import SwiftUI
import UIKit

/// The tap a finger feels, at the owner's two strengths: the tab bar at half,
/// every other button at a tenth — a low tick that says the press took
/// without competing with the tab bar's.
///
/// One generator, so both strengths are steps on one scale. The system's own
/// "System Haptics" switch silences it, as it does every app's.
@MainActor
enum Haptics {
    /// The floating tab bar's (`FloatingTabBar`).
    static let tabStrength: CGFloat = 0.5
    /// Every other button's.
    static let buttonStrength: CGFloat = 0.1

    private static let generator = UIImpactFeedbackGenerator(style: .medium)

    static func tab() { impact(tabStrength) }
    static func tap() { impact(buttonStrength) }

    private static func impact(_ intensity: CGFloat) {
        generator.impactOccurred(intensity: intensity)
        // Ready for the next press, so it lands on the finger and not a beat after.
        generator.prepare()
    }
}

/// The button tick on a style's press: the moment a finger comes down on the
/// button, as a key does, rather than when it lifts.
struct PressHaptic: ViewModifier {
    let isPressed: Bool

    func body(content: Content) -> some View {
        content.onChange(of: isPressed) { _, pressed in
            if pressed { Haptics.tap() }
        }
    }
}

extension View {
    /// Every one of the app's button styles wears this, so no button is silent.
    func pressHaptic(_ isPressed: Bool) -> some View {
        modifier(PressHaptic(isPressed: isPressed))
    }
}

/// A button drawn as its label alone — what `.plain` was — with the tick.
struct TapStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.7 : 1)
            .pressHaptic(configuration.isPressed)
    }
}

extension ButtonStyle where Self == TapStyle {
    /// The app's plain button: its label, a press that dims it, and the tick.
    static var tap: TapStyle { TapStyle() }
}

/// What every button with no style of its own wears, set once at the app's
/// root: the system's own look (borderless, in the tint), and the tick when it
/// is pressed. A button with a style of its own keeps it and ticks through it.
struct HapticDefaultStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role) {
            Haptics.tap()
            configuration.trigger()
        } label: {
            configuration.label
        }
        .buttonStyle(.borderless)
    }
}
