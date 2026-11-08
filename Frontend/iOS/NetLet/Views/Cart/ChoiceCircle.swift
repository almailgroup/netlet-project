import SwiftUI

/// The circle beside a bag line, a store and All, on the owner's word ("you
/// should be able to choose what products you want the price for and only
/// checkout for those products") — the web's `ChoiceCircle`. A navy disc with
/// a white tick when chosen, a white minus when partly (a store or All with
/// some lines left out), and an empty ring when left out; 22 points drawn in a
/// 44-point press, so the larger target never moves the row. A toggle to
/// VoiceOver, named for what choosing it does.
struct ChoiceCircle: View {
    let state: CartChoice.State
    let label: String
    let toggle: (Bool) -> Void
    @Environment(\.accessibilityReduceMotion) private var still

    /// The empty ring: 4:1 on white, 3.6:1 on the page's ground.
    private static let ring = Color(red: 111 / 255, green: 127 / 255, blue: 153 / 255)

    var body: some View {
        Button {
            toggle(state != .all)
        } label: {
            ZStack {
                Circle().fill(state == .none ? Color.white : Brand.navy)
                Circle().strokeBorder(state == .none ? Self.ring : Brand.navy, lineWidth: 2)
                if state == .all {
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .heavy)).foregroundStyle(.white)
                } else if state == .some {
                    Image(systemName: "minus").font(.system(size: 11, weight: .heavy)).foregroundStyle(.white)
                }
            }
            .frame(width: 22, height: 22)
            .animation(still ? nil : .snappy(duration: 0.15), value: state)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .accessibilityLabel(label)
        .accessibilityAddTraits(state == .all ? [.isToggle, .isSelected] : .isToggle)
    }
}

/// All, as a circle and its word — above Saved items and Frequently bought,
/// the cart's own All. Choosing it chooses everything on the page; some
/// chosen draws the minus, and a press then chooses the rest.
struct ChoiceAll: View {
    let state: CartChoice.State
    let toggle: (Bool) -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 0) {
            ChoiceCircle(state: state, label: l.t("select.all"), toggle: toggle)
                .padding(.leading, -12)
            // The word is the eye's; the circle's name says it whole.
            Text(l.t("cart.chooseAll"))
                .font(.inter(14, .bold))
                .foregroundStyle(Brand.navy)
                .accessibilityHidden(true)
        }
        .fixedSize()
    }
}

/// What to do with what is chosen: a navy pill for the act the page is for
/// and a white one with a light rim beside it.
struct ChoicePill: View {
    let title: String
    var filled = false
    var systemImage: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 13, weight: .bold)) }
                Text(title).font(.inter(13, .bold)).lineLimit(1)
            }
            .foregroundStyle(filled ? Color.white : Brand.navy)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(Capsule().fill(filled ? Brand.navy : Color.white))
            .overlay(Capsule().strokeBorder(filled ? Color.clear : Brand.navy.opacity(0.25), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.action)
        .fixedSize()
    }
}
