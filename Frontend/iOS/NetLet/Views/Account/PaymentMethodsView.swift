import SwiftUI

/// The cards a shopper has saved — the web's `AccountPayments`, on the
/// owner's word ("add a manage card for payment methods saved", then "remove
/// the ways to pay … only saved cards; you can only add payment methods").
///
/// The saved cards and one way to add one, nothing else: the ways to pay
/// (cash on delivery, KNET, a card, Apple Pay) are checkout's question, and
/// left this screen. There are no saved cards yet, and "Add a payment method"
/// cannot be pressed: saving one needs a payment provider that holds it as a
/// token, and NetLet integrates none yet. NetLet never stores a card number,
/// and the screen says so.
struct PaymentMethodsView: View {
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ShopPage(header: false) {
            AccountSection(title: l.t("account.sectionPayments"), hint: l.t("account.hint.payments")) {
                cards
            }
        }
    }

    private var cards: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("payments.savedCards"))
                .font(.inter(16, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "creditcard")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 44, height: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t("payments.noCards")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                    Text(l.t("payments.noCardsNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(red: 251 / 255, green: 252 / 255, blue: 254 / 255)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
            .accessibilityElement(children: .combine)
            Button {} label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus").font(.system(size: 15, weight: .bold))
                    Text(l.t("payments.addCard"))
                    Text(l.t("checkout.paySoon"))
                        .font(.inter(12, .bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Brand.photo))
                }
                .font(.inter(15, .bold))
                .foregroundStyle(Brand.muted)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(Capsule().fill(Color.white))
                .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
            }
            .buttonStyle(.tap)
            .disabled(true)
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "lock").font(.system(size: 13, weight: .semibold)).padding(.top, 2).accessibilityHidden(true)
                Text(l.t("payments.neverStored")).fixedSize(horizontal: false, vertical: true)
            }
            .font(.inter(13))
            .foregroundStyle(Brand.muted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }
}
