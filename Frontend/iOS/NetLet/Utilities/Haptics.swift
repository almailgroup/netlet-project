import SwiftUI
import UIKit

/// The tap a finger feels: **everything at half strength but the tab bar,
/// which is three quarters, on the owner's word** — every button, a press that
/// does something to a product, an order placed and a refusal at half. It was
/// the tab bar and a product's presses at half and every other button at a
/// tenth; the owner asked for one strength across the app, and then for the
/// tab bar a little firmer, since it is the press that changes the whole
/// screen.
///
/// An order placed and an add the shop refused were the system's success and
/// error patterns, which take no strength; they are impacts at the same half
/// now — one for the order, two in quick succession for a refusal, so a no
/// still feels different from a yes (the web's `refusedHaptic` is two knocks
/// too), beside the words that say so.
///
/// One generator, so every press is the same tap. The system's own "System
/// Haptics" switch silences all of it, as it does every app's.
@MainActor
enum Haptics {
    /// Every haptic in the app but the tab bar's.
    static let strength: CGFloat = 0.5
    /// The tab bar's (the system's own, in `RootView`).
    static let tabStrength: CGFloat = 0.75
    /// A press that does something to a product.
    static let actionStrength: CGFloat = strength
    /// Every other button's.
    static let buttonStrength: CGFloat = strength
    /// The map pin dropping into place once the map stops — three quarters,
    /// on the owner's word, as the tab bar's.
    static let pinStrength: CGFloat = 0.75

    private static let generator = UIImpactFeedbackGenerator(style: .medium)

    static func tab() { impact(tabStrength) }
    static func action() { impact(actionStrength) }
    static func tap() { impact(buttonStrength) }
    static func pinDrop() { impact(pinStrength) }

    /// It worked, and mattered: an order placed.
    static func succeeded() { impact(strength) }
    /// The shop said no: an add or a quantity change that did not take — two
    /// taps, so it does not feel like the press that worked.
    static func refused() {
        impact(strength)
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(90))
            Haptics.impact(Haptics.strength)
        }
    }

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
/// system's borderless look like every other plain button, ticking as the
/// action it is.
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
///
/// **Never in a bar** — see `BarButton`: wrapped like this, a word in a sheet's
/// bar is taken for an icon on iOS 26 and cut to fit an icon's bubble.
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

/// A word in a sheet's bar — Close, Cancel, Decline — drawn by the system and
/// in full. Every button in the app inherits `HapticDefaultStyle`, which wraps
/// its label in a borderless button of its own; in a bar on iOS 26 the system
/// then takes the word for an icon and draws it in a round bubble an icon's
/// size, so "Close" read "Cl…" (the owner's screenshot of "Deliver to", and
/// "in many parts"). The system's own style draws it in a capsule that fits
/// the word; the tick moves into the action, so it is still felt.
struct BarButton: View {
    let title: String
    var role: ButtonRole?
    let action: @MainActor () -> Void

    init(_ title: String, role: ButtonRole? = nil, action: @escaping @MainActor () -> Void) {
        self.title = title
        self.role = role
        self.action = action
    }

    var body: some View {
        Button(role: role) {
            Haptics.tap()
            action()
        } label: {
            Text(title).fixedSize()
        }
        .buttonStyle(.automatic)
    }
}
