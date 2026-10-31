import SwiftUI

/// The pair that buys, on the product page, its floating bar and the preview —
/// the preview's own pair (`PREVIEW_TONE`), on the owner's word ("make the
/// buttons for adding to cart and buying now better and compact"). Add to
/// cart is the brand's navy with white words, and green for the moment it says
/// it worked; Buy now is white with a navy rim. Side by side, in one row of
/// capsules, each a thumb's height — the product page stacked two white
/// buttons and a heart (one the photo already carries) over 124 points.
///
/// Each gives under the finger (a step darker, a little smaller) and is felt
/// on the press (`pressHaptic`).
struct AddToCartStyle: ButtonStyle {
    /// It has just worked: green, for the moment the button says so.
    var done = false
    var size: CGFloat = 15

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(size, .bold))
            .foregroundStyle(.white)
            .background(
                Capsule().fill(done ? Brand.success : (configuration.isPressed ? Color(red: 13 / 255, green: 51 / 255, blue: 114 / 255) : Brand.navy))
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.2, bounce: 0.3), value: configuration.isPressed)
            .pressHaptic(configuration.isPressed, strength: Haptics.actionStrength)
    }
}

/// Buy now: white, a navy rim and navy words.
struct BuyNowStyle: ButtonStyle {
    var size: CGFloat = 15

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(size, .bold))
            .foregroundStyle(Brand.navy)
            .background(Capsule().fill(configuration.isPressed ? Brand.pressFill : Color.white))
            .overlay(Capsule().strokeBorder(Brand.navy, lineWidth: 1.5))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.2, bounce: 0.3), value: configuration.isPressed)
            .pressHaptic(configuration.isPressed, strength: Haptics.actionStrength)
    }
}

/// What Add to cart says inside itself: the bag and the words, a turning
/// wheel while the first add waits, and a tick and "Added" for a moment once
/// it has worked — said where the finger is rather than in a toast.
struct AddToCartLabel: View {
    let title: String
    var adding = false
    var done = false
    var iconSize: CGFloat = 15
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ZStack {
            if done {
                Label(l.t("ios.product.added"), systemImage: "checkmark")
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
            } else {
                HStack(spacing: 7) {
                    if adding {
                        ProgressView().tint(.white).controlSize(.small)
                    } else {
                        Image(systemName: "bag").font(.system(size: iconSize, weight: .semibold))
                    }
                    Text(title)
                }
                .transition(.scale(scale: 0.8).combined(with: .opacity))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.75)
    }
}

/// What Buy now says: the bolt and the words.
struct BuyNowLabel: View {
    let title: String
    var iconSize: CGFloat = 14

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "bolt.fill").font(.system(size: iconSize, weight: .semibold))
            Text(title)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.75)
    }
}
