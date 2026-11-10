import SwiftUI

/// The button a sold-out product wears in place of Add to cart — "Notify me
/// when back in stock" — the web's `StockReminder` (`StockReminders` holds
/// the state). On the product page and in the preview it is the page's one
/// action, a navy capsule the width of the pair it stands in for, with a line
/// under it saying how the reminder will arrive and how many are waiting; on
/// a card, in Saved and in Frequently bought it is the card's own white
/// capsule; in the floating buy bar it sits beside the price. Once set it
/// reads "We'll notify you" with a tick ("Notifying" on a card and in the
/// bar, the web's short form), and a press turns it off again.
struct StockReminderButton: View {
    enum Style { case page, card, bar }

    let productId: String
    let title: String
    var style: Style = .card
    @State private var waiting = 0
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    init(product: Product, style: Style = .card) {
        productId = product.id
        title = product.title
        self.style = style
    }

    init(productId: String, title: String, style: Style = .card) {
        self.productId = productId
        self.title = title
        self.style = style
    }

    var body: some View {
        let on = app.reminders.isOn(productId)
        VStack(spacing: 6) {
            switch style {
            case .page:
                Button(action: press) {
                    label(on: on, words: l.t(on ? "remind.set" : "remind.button"), icon: 15, spinner: on ? Brand.navy : .white)
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .modifier(PageTone(on: on))
                .accessibilityLabel(l.t(on ? "remind.setName" : "remind.name", ["name": title]))
                .accessibilityAddTraits(on ? .isSelected : [])
                Text(note)
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if waiting > 0 {
                    Text(waiting == 1 ? l.t("follow.waitingOne") : l.t("follow.waiting", ["count": "\(waiting)"]))
                        .font(.inter(12, .semibold))
                        .foregroundStyle(Brand.muted)
                }
            case .bar:
                Button(action: press) {
                    label(on: on, words: l.t(on ? "remind.setShort" : "remind.short"), icon: 13, spinner: on ? Brand.navy : .white)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 42)
                }
                .modifier(PageTone(on: on, size: 14))
                .accessibilityLabel(l.t(on ? "remind.setShortName" : "remind.shortName", ["name": title]))
                .accessibilityAddTraits(on ? .isSelected : [])
            case .card:
                Button(action: press) {
                    label(on: on, words: l.t(on ? "remind.setShort" : "remind.short"), icon: 13, spinner: on ? .white : Brand.navy)
                        .font(.inter(14, .medium))
                        .foregroundStyle(on ? Color.white : Brand.navy)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.horizontal, 4)
                        .contentShape(Rectangle())
                }
                .buttonStyle(ReminderCardStyle(on: on))
                .accessibilityLabel(l.t(on ? "remind.setShortName" : "remind.shortName", ["name": title]))
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .task(id: app.session.isSignedIn) {
            if app.session.isSignedIn { await app.reminders.load() }
            if style == .page {
                waiting = (try? await app.services.api.call(API.followers, .init(productId: productId))) ?? 0
            }
        }
    }

    private var note: String {
        guard app.session.isSignedIn else { return l.t("remind.noteGuest") }
        return l.t(app.reminders.byEmail ? "remind.noteEmail" : "remind.noteInbox")
    }

    private func press() {
        app.pressReminder(productId: productId, title: title)
    }

    @ViewBuilder
    private func label(on: Bool, words: String, icon: CGFloat, spinner: Color) -> some View {
        HStack(spacing: 7) {
            if app.reminders.working.contains(productId) {
                ProgressView().controlSize(.small).tint(spinner)
            } else {
                Image(systemName: on ? "checkmark" : "bell.badge").font(.system(size: icon, weight: .semibold))
            }
            Text(words)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.75)
    }
}

/// The page's tone: navy off (Add to cart's), white with a navy rim on (Buy now's).
private struct PageTone: ViewModifier {
    let on: Bool
    var size: CGFloat = 15

    func body(content: Content) -> some View {
        if on {
            content.buttonStyle(BuyNowStyle(size: size))
        } else {
            content.buttonStyle(AddToCartStyle(size: size))
        }
    }
}

/// The card's capsule, in Liquid Glass: clear off, navy on. Only a sold-out
/// card wears one.
private struct ReminderCardStyle: ButtonStyle {
    let on: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .liquidGlass(on ? .navy : .clear, pressed: configuration.isPressed)
            .pressHaptic(configuration.isPressed, strength: Haptics.actionStrength)
    }
}
