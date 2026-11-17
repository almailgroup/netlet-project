import SwiftUI

/// The product page's and the preview's price for the quantity chosen — the
/// web's `QuantityPriceBlock`, over `QuantityPrice` (the web's
/// `priceForQuantity`), on the owner's word ("the main price should update
/// automatically based on the selected quantity … clearly display the
/// individual unit price below or beside the total price").
///
/// - The headline is the total, extras ticked included; its digits roll to
///   the new figure as the quantity changes (a cut under Reduce Motion).
/// - The struck was-price for the same many and the saving badge sit on a
///   line of their own under it: beside it, a total that gained a digit
///   wrapped them at one press and not the one before, moving the stepper
///   under the thumb.
/// - The unit line is always there, at one too, for the same reason.
/// - VoiceOver hears the new total when the quantity changes, the web's
///   polite live region.
struct QuantityPriceView: View {
    let quote: QuantityPrice
    /// The product's own saving in whole percent; nil or zero draws no badge.
    var savingPercent: Int?
    /// The product page's 32; the preview's 24.
    var large = true
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    private var unitLine: String {
        let step = quote.step.map { "\(UnitWording.number($0.value)) \(l.t("unit.\($0.unit)"))" } ?? ""
        return l.t(quote.lineKey, ["count": "\(quote.quantity)", "price": l.price(quote.unit), "step": step])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.price(quote.total))
                .font(.inter(large ? 32 : 24, large ? .heavy : .bold))
                .tracking(large ? -1.2 : -0.4)
                .foregroundStyle(large ? Brand.ink : Brand.navy)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .contentTransition(.numericText())
                .animation(still ? nil : .snappy(duration: 0.25), value: quote.total)
            if quote.wasTotal != nil || (savingPercent ?? 0) > 0 {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    if let was = quote.wasTotal {
                        Text(l.price(was))
                            .font(.inter(large ? 18 : 14))
                            .strikethrough()
                            .foregroundStyle(Brand.muted)
                            .accessibilityLabel(l.t("browse.onOffer") + ", " + l.price(was))
                    }
                    if let percent = savingPercent, percent > 0 {
                        Text(l.t("product.savePercent", ["percent": "\(percent)"]))
                            .font(.inter(12, .bold))
                            .foregroundStyle(Color(red: 21 / 255, green: 87 / 255, blue: 36 / 255))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color(red: 212 / 255, green: 237 / 255, blue: 218 / 255)))
                    }
                }
            }
            Text(unitLine)
                .font(.inter(large ? 15 : 14, .semibold))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .onChange(of: quote.quantity) { _, _ in
            AccessibilityNotification.Announcement(
                l.t("product.totalFor", ["count": "\(quote.quantity)", "price": l.price(quote.total)])
            ).post()
        }
    }
}
