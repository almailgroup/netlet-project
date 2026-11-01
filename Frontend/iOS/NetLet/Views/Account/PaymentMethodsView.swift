import SwiftUI

/// How the shopper pays, and the cards they save — the web's
/// `AccountPayments`, on the owner's word ("add a manage card for payment
/// methods saved").
///
/// It says what is true today: every order is cash on delivery, so cash is
/// the default and the only way to pay; KNET, a card and Apple Pay are drawn
/// as checkout draws them, marked as coming. There are no saved cards, and
/// "Add a card" cannot be pressed: saving one needs a payment provider that
/// holds it as a token, and NetLet integrates none yet. NetLet never stores a
/// card number, and the screen says so.
struct PaymentMethodsView: View {
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ShopPage(header: false) {
            AccountSection(title: l.t("account.sectionPayments"), hint: l.t("account.hint.payments")) {
                VStack(spacing: 12) {
                    ways
                    cards
                }
            }
        }
    }

    private var ways: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(l.t("payments.waysTitle"))
                .font(.inter(16, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 16)
            way(icon: AnyView(Image(systemName: "banknote")), title: "checkout.payCod", note: "checkout.payCodNote", chosen: true)
            DashedRule()
            way(icon: AnyView(Text(verbatim: "KNET").font(.inter(10, .heavy))), title: "checkout.payKnet", note: "checkout.payKnetNote", chosen: false)
            DashedRule()
            way(icon: AnyView(Image(systemName: "creditcard")), title: "checkout.payCard", note: "checkout.payCardNote", chosen: false)
            DashedRule()
            way(icon: AnyView(Image(systemName: "apple.logo")), title: "checkout.payApple", note: "checkout.payAppleNote", chosen: false)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
    }

    private func way(icon: AnyView, title: String, note: String, chosen: Bool) -> some View {
        HStack(spacing: 14) {
            icon
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(chosen ? Color.white : Brand.muted)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(chosen ? Brand.navy : Brand.photo))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t(title)).font(.inter(15, .bold)).foregroundStyle(chosen ? Brand.navy : Brand.body)
                Text(l.t(note)).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(l.t(chosen ? "payments.default" : "checkout.paySoon"))
                .font(.inter(12, .bold))
                .foregroundStyle(chosen ? Brand.success : Brand.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Capsule().fill(chosen ? Brand.successFill : Brand.photo))
        }
        .frame(minHeight: 72)
        .accessibilityElement(children: .combine)
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
