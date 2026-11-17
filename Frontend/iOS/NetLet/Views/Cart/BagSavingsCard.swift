import SwiftUI

/// Checkout's three ways to pay less — the web's `BagSavings`, on the owner's
/// word ("display three distinct options: a discount code input, a gift card
/// input, a NetLet points redemption toggle"), at checkout only, on their word
/// too ("only in the checkout page, not cart"), over `SavingsModel`.
///
/// Each code is applied on the press and asked about then; a code in the
/// wrong box is moved to the right one and said so. Points are a switch for a
/// balance that has some; a guest is told to sign in, and an account with
/// none is told where they come from — a line, never a switch that can only
/// be turned on to no effect.
///
/// **Each of the three is folded until it is pressed, on the owner's word**
/// ("keep these sections collapsed by default and expand them when clicked")
/// — the web's `SavingsRow`. Folded, each row says what it holds: a code and
/// what it takes off, "Not applied" in red for one refused, the points it
/// would use.
struct BagSavingsCard: View {
    let cart: Cart
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let savings = app.savings
        let bill = savings.bill(for: cart)
        VStack(alignment: .leading, spacing: 0) {
            Text(l.t("cart.savingsHeading"))
                .font(.inter(15, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 14)
                .padding(.bottom, 4)
            FoldRow(icon: AnyView(Image(systemName: "ticket").foregroundStyle(Brand.muted)), title: l.t("cart.discountCode"), summary: codeSummary(.discount, bill: bill)) {
                CodeBoxRow(cart: cart, box: .discount)
            }
            Divider().overlay(Brand.cardLine)
            FoldRow(icon: AnyView(Image(systemName: "gift").foregroundStyle(Brand.muted)), title: l.t("cart.giftCard"), summary: codeSummary(.gift, bill: bill)) {
                CodeBoxRow(cart: cart, box: .gift)
            }
            Divider().overlay(Brand.cardLine)
            FoldRow(icon: AnyView(PointsCoin(size: 18)), title: l.t("account.points"), summary: pointsSummary(bill: bill)) {
                PointsRow(cart: cart)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
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

extension BagSavingsCard {
    /// What a folded code row says about itself.
    fileprivate func codeSummary(_ box: SavingsModel.Box, bill: Till.Bill) -> FoldSummary {
        let savings = app.savings
        let mine = savings.cartId == cart.id
        let held = mine ? (box == .gift ? savings.giftCard : savings.code) : ""
        let quote = box == .gift ? savings.giftQuote : savings.codeQuote
        if held.isEmpty { return .init(text: l.t("cart.savingsOpen"), tone: .muted) }
        if quote?.ok == false { return .init(text: l.t("cart.savingsNotApplied"), tone: .bad) }
        let code = "\u{2066}\(SavingsModel.normalise(held))\u{2069}"
        guard quote != nil else { return .init(text: code, tone: .muted) }
        let off = box == .gift ? bill.giftCard : bill.discount
        return .init(text: "\(code) · −\(off.formatted(l.current))", tone: .good)
    }

    /// What the folded points row says: what it uses, or what there is to use.
    fileprivate func pointsSummary(bill: Till.Bill) -> FoldSummary? {
        let savings = app.savings
        guard app.session.isSignedIn, let balance = savings.balance else { return nil }
        if savings.usePoints, !bill.points.isZero {
            return .init(text: l.t("cart.pointsUsing", ["value": bill.points.formatted(l.current)]), tone: .good)
        }
        guard balance > 0, Till.pointsSpendable(balance, on: cart.total) > 0 else { return nil }
        return .init(text: l.t("rewards.balance", ["points": PointsFormat.count(balance, l.current)]), tone: .muted)
    }
}

/// One folded row: its name and what it holds on a button, and what changes
/// it under that, opened with a spring (a cut under Reduce Motion).
/// What a folded row says about what it holds.
struct FoldSummary {
    enum Tone { case muted, good, bad }
    let text: String
    let tone: Tone
}

struct FoldRow<Content: View>: View {
    let icon: AnyView
    let title: String
    let summary: FoldSummary?
    @ViewBuilder let content: () -> Content
    @State private var open = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.9)) { open.toggle() }
            } label: {
                HStack(spacing: 10) {
                    icon.frame(width: 20).accessibilityHidden(true)
                    Text(title)
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.navy)
                        .layoutPriority(1)
                    Spacer(minLength: 8)
                    if let summary {
                        Text(summary.text)
                            .font(.inter(13, .semibold))
                            .foregroundStyle(summary.tone == .good ? Brand.success : summary.tone == .bad ? Brand.danger : Brand.muted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Brand.muted)
                        .rotationEffect(.degrees(open ? 180 : 0))
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityValue(open ? "" : (summary?.text ?? ""))
            if open {
                content()
                    .padding(.bottom, 10)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .clipped()
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
                        // Asks first, on the owner's word.
                        Task {
                            let code = SavingsModel.normalise(held)
                            guard await RemovalQuestion.code(code.isEmpty ? held : code, scope: box == .gift ? .giftCard : .order, l) else { return }
                            savings.remove(box)
                        }
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
                            Text(l.t("checkout.usePoints", ["points": PointsFormat.count(offer, l.current), "value": Till.spendValue(offer).formatted(l.current)]))
                                .font(.inter(13))
                                .foregroundStyle(Brand.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .tint(Brand.navy)
                    .onChange(of: savings.usePoints) { Haptics.tap() }
                } else {
                    Text(l.t("cart.noPoints")).font(.inter(13)).foregroundStyle(Brand.muted)
                    Button(l.t("cart.howToEarn")) { app.push(.wallet) }
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(minHeight: 36)
                        .buttonStyle(.tap)
                }
            } else {
                ProgressView().frame(height: 20)
            }
        }
    }
}
