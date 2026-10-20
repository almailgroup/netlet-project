import SwiftUI
import UIKit

/// The tap a finger feels, at the owner's strengths: the tab bar at half,
/// every other button at a tenth — a low tick that says the press took
/// without competing with the tab bar's.
///
/// **A press that does something to a product is felt at the tab bar's
/// strength, on the owner's word** — Add to cart, Buy now, a step of the
/// quantity anywhere, the bin, the heart, Place order — so a shopper knows the
/// act took. An order placed answers with the system's success pattern, and an
/// add the shop refused with its error pattern, beside the words that say so.
///
/// One generator, so the strengths are steps on one scale. The system's own
/// "System Haptics" switch silences all of it, as it does every app's.
@MainActor
enum Haptics {
    /// The tab bar's (the system's own, in `RootView`).
    static let tabStrength: CGFloat = 0.5
    /// A press that does something to a product: as firm as the tab bar's.
    static let actionStrength: CGFloat = 0.5
    /// Every other button's.
    static let buttonStrength: CGFloat = 0.1

    private static let generator = UIImpactFeedbackGenerator(style: .medium)
    private static let outcome = UINotificationFeedbackGenerator()

    static func tab() { impact(tabStrength) }
    static func action() { impact(actionStrength) }
    static func tap() { impact(buttonStrength) }

    /// It worked, and mattered: an order placed.
    static func succeeded() { outcome.notificationOccurred(.success) }
    /// The shop said no: an add or a quantity change that did not take.
    static func refused() { outcome.notificationOccurred(.error) }

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
    let strength: CGFloat

    func body(content: Content) -> some View {
        content.onChange(of: isPressed) { _, pressed in
            if pressed { strength >= Haptics.actionStrength ? Haptics.action() : Haptics.tap() }
        }
    }
}

extension View {
    /// Every one of the app's button styles wears this, so no button is
    /// silent; a product's buttons pass `Haptics.actionStrength`.
    func pressHaptic(_ isPressed: Bool, strength: CGFloat = Haptics.buttonStrength) -> some View {
        modifier(PressHaptic(isPressed: isPressed, strength: strength))
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

/// A product's plain button — a step of the quantity, the bin — in the
/// system's borderless look like every other plain button, ticking at the
/// tab bar's strength rather than a tenth.
struct ActionHapticStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button(role: configuration.role) {
            Haptics.action()
            configuration.trigger()
        } label: {
            configuration.label
        }
        .buttonStyle(.borderless)
    }
}

extension PrimitiveButtonStyle where Self == ActionHapticStyle {
    /// A press that does something to a product, felt as firmly as the tab bar.
    static var action: ActionHapticStyle { ActionHapticStyle() }
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
