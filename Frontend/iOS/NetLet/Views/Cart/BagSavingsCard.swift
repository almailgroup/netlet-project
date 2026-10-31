import SwiftUI

/// The cart's three ways to pay less — the web's `BagSavings`, on the owner's
/// word ("display three distinct options: a discount code input, a gift card
/// input, a NetLet points redemption toggle"). The same card at checkout, over
/// the same `SavingsModel`, so what was chosen in the cart is already there.
///
/// Each code is applied on the press and asked about then; a code in the
/// wrong box is moved to the right one and said so. Points are a switch for a
/// balance that has some; a guest is told to sign in, and an account with
/// none is told where they come from — a line, never a switch that can only
/// be turned on to no effect.
struct BagSavingsCard: View {
    let cart: Cart
    /// Drawn inside another card (the cart's summary) with no frame of its own.
    var inset = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let savings = app.savings
        VStack(alignment: .leading, spacing: 0) {
            Text(l.t("cart.savingsHeading"))
                .font(.inter(15, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, inset ? 0 : 14)
                .padding(.bottom, 4)
            CodeBoxRow(cart: cart, box: .discount)
            Divider().overlay(Brand.cardLine)
            CodeBoxRow(cart: cart, box: .gift)
            Divider().overlay(Brand.cardLine)
            PointsRow(cart: cart)
        }
        .padding(.horizontal, inset ? 0 : 16)
        .padding(.bottom, inset ? 0 : 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if !inset { RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white) }
        }
        .overlay {
            if !inset { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1) }
        }
        .task(id: cart.id) {
            savings.follow(cartId: cart.id)
            await savings.loadBalance(signedIn: app.session.isSignedIn)
        }
        .onChange(of: cart.subtotal) {
            Task { await savings.requote(cartId: cart.id) }
        }
        .onChange(of: app.session.isSignedIn) {
            Task { await savings.loadBalance(signedIn: app.session.isSignedIn) }
        }
    }
}

private struct CodeBoxRow: View {
    let cart: Cart
    let box: SavingsModel.Box
    @State private var draft = ""
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let savings = app.savings
        let mine = savings.cartId == cart.id
        let held = mine ? (box == .gift ? savings.giftCard : savings.code) : ""
        let quote = box == .gift ? savings.giftQuote : savings.codeQuote
        let bill = savings.bill(for: cart)
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(l.t(box == .gift ? "cart.giftCard" : "cart.discountCode")).font(.inter(14, .bold))
            } icon: {
                Image(systemName: box == .gift ? "gift" : "ticket").foregroundStyle(Brand.muted)
            }
            .foregroundStyle(Brand.navy)
            if !held.isEmpty {
                let refused = quote?.ok == false ? quote?.reason ?? "voucher.unknown" : nil
                HStack(spacing: 10) {
                    Image(systemName: refused == nil ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(refused == nil ? Brand.success : Brand.danger)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\u{2066}\(SavingsModel.normalise(held))\u{2069}")
                            .font(.inter(14, .heavy))
                            .foregroundStyle(Brand.navy)
                        Text(refused.map { l.t($0) } ?? appliedNote(quote: quote, bill: bill))
                            .font(.inter(12, .semibold))
                            .foregroundStyle(refused == nil ? Brand.success : Brand.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    Button {
                        savings.remove(box)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Brand.muted)
                            .frame(width: 40, height: 40)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(PressFillStyle(cornerRadius: 12))
                    .accessibilityLabel(l.t("cart.removeCode", ["code": SavingsModel.normalise(held)]))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(refused == nil ? Brand.successFill : Brand.danger.opacity(0.08)))
            } else {
                HStack(spacing: 8) {
                    TextField(l.t(box == .gift ? "cart.giftCardPlaceholder" : "checkout.voucherPlaceholder"), text: $draft)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { Task { await apply() } }
                        .environment(\.layoutDirection, .leftToRight)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.pearl))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                        .accessibilityLabel(l.t(box == .gift ? "cart.giftCard" : "cart.discountCode"))
                    Button {
                        Task { await apply() }
                    } label: {
                        if savings.asking.contains(box) { ProgressView().tint(.white) } else { Text(l.t("checkout.voucherApply")) }
                    }
                    .buttonStyle(CompactPrimaryStyle())
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || savings.asking.contains(box))
                }
            }
            if let note = savings.notes[box] {
                Text(l.t(note.key))
                    .font(.inter(13, .semibold))
                    .foregroundStyle(note.good ? Brand.success : Brand.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 12)
    }

    private func appliedNote(quote: API.VoucherQuote?, bill: Till.Bill) -> String {
        guard let quote, quote.ok else { return "" }
        if quote.kind == "gift" {
            let remaining = quote.remaining ?? quote.amount ?? .zero
            return l.t("cart.giftPays", ["amount": bill.giftCard.formatted(l.current), "left": (remaining - bill.giftCard).formatted(l.current)])
        }
        return l.t("cart.codeTakesOff", ["amount": bill.discount.formatted(l.current)])
    }

    private func apply() async {
        if await app.savings.apply(draft, in: box, cartId: cart.id) { draft = "" }
    }
}

private struct PointsRow: View {
    let cart: Cart
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        @Bindable var savings = app.savings
        VStack(alignment: .leading, spacing: 6) {
            if !app.session.isSignedIn {
                heading
                Text(l.t("cart.pointsSignIn")).font(.inter(13)).foregroundStyle(Brand.muted)
                Button(l.t("header.signIn")) { app.authPresented = true }
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .frame(minHeight: 36)
                    .buttonStyle(.tap)
            } else if let balance = savings.balance {
                let offer = Till.pointsSpendable(balance, on: cart.total)
                if offer > 0 {
                    Toggle(isOn: $savings.usePoints) {
                        VStack(alignment: .leading, spacing: 2) {
                            heading
                            Text(l.t("checkout.usePoints", ["points": PointsFormat.count(offer, l.current), "value": Till.spendValue(offer).formatted(l.current)]))
                                .font(.inter(13))
                                .foregroundStyle(Brand.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .tint(Brand.navy)
                    .onChange(of: savings.usePoints) { Haptics.tap() }
                } else {
                    heading
                    Text(l.t("cart.noPoints")).font(.inter(13)).foregroundStyle(Brand.muted)
                    Button(l.t("cart.howToEarn")) { app.push(.rewards) }
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(minHeight: 36)
                        .buttonStyle(.tap)
                }
            } else {
                heading
                ProgressView().frame(height: 20)
            }
        }
        .padding(.vertical, 12)
    }

    private var heading: some View {
        HStack(spacing: 8) {
            PointsCoin(size: 18)
            Text(l.t("account.points")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
        }
    }
}
