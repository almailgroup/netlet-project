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
/// **The three are round icons in a row, on the owner's word** ("the same
/// for the codes, gift cards and points — round shaped icons"), each folded
/// until it is pressed — the web's `BagSavings`. Under each circle a line says
/// what it holds — what a code takes off, "Not applied" in red for one
/// refused, the points there are — and a corner badge says the same to the
/// eye. A press opens that one's box under the row, one at a time, with a
/// spring (a cut under Reduce Motion).
struct BagSavingsCard: View {
    let cart: Cart
    @State private var open: SavingsMark?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let savings = app.savings
        let bill = savings.bill(for: cart)
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("cart.savingsHeading"))
                .font(.inter(15, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            HStack(alignment: .top, spacing: 4) {
                ForEach(SavingsMark.allCases) { mark in
                    circle(mark, summary: summary(mark, bill: bill))
                }
            }
            if let open {
                VStack(alignment: .leading, spacing: 8) {
                    Text(title(open))
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                    switch open {
                    case .discount: CodeBoxRow(cart: cart, box: .discount)
                    case .gift: CodeBoxRow(cart: cart, box: .gift)
                    case .points: PointsRow(cart: cart)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(red: 246 / 255, green: 248 / 255, blue: 251 / 255)))
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .clipped()
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

    private func title(_ mark: SavingsMark) -> String {
        switch mark {
        case .discount: return l.t("cart.discountCode")
        case .gift: return l.t("cart.giftCard")
        case .points: return l.t("account.points")
        }
    }

    /// One circle: its mark, its name and what it holds; a press opens its box, or folds it.
    private func circle(_ mark: SavingsMark, summary: FoldSummary) -> some View {
        let isOpen = open == mark
        let badge: RoundBadge? = summary.tone == .good ? .done : summary.tone == .bad ? .problem : nil
        return Button {
            withAnimation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.9)) { open = isOpen ? nil : mark }
        } label: {
            VStack(spacing: 0) {
                RoundFace(fill: mark.fill, ring: isOpen, badge: badge) { AnyView(mark.mark) }
                RoundLabel(title: title(mark), note: summary.text, tone: summary.tone == .good ? .good : summary.tone == .bad ? .bad : .muted)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title(mark))
        .accessibilityValue(summary.text)
        .accessibilityAddTraits(isOpen ? .isSelected : [])
        .accessibilityHint(l.t(isOpen ? "ios.savings.fold" : "ios.savings.open"))
        .accessibilityIdentifier("savings-\(mark.rawValue)")
    }

    /// What a circle says under its name.
    private func summary(_ mark: SavingsMark, bill: Till.Bill) -> FoldSummary {
        switch mark {
        case .discount: return codeSummary(.discount, bill: bill)
        case .gift: return codeSummary(.gift, bill: bill)
        case .points: return pointsSummary(bill: bill)
        }
    }
}

extension BagSavingsCard {
    /// What a code's circle says about itself.
    fileprivate func codeSummary(_ box: SavingsModel.Box, bill: Till.Bill) -> FoldSummary {
        let savings = app.savings
        let mine = savings.cartId == cart.id
        let held = mine ? (box == .gift ? savings.giftCard : savings.code) : ""
        let quote = box == .gift ? savings.giftQuote : savings.codeQuote
        if held.isEmpty { return .init(text: l.t("cart.savingsOpen"), tone: .muted) }
        if quote?.ok == false { return .init(text: l.t("cart.savingsNotApplied"), tone: .bad) }
        guard quote != nil else { return .init(text: "\u{2066}\(SavingsModel.normalise(held))\u{2069}", tone: .muted) }
        let off = box == .gift ? bill.giftCard : bill.discount
        return .init(text: "−\(off.formatted(l.current))", tone: .good)
    }

    /// What the points' circle says: what it takes off, or what there is to use.
    fileprivate func pointsSummary(bill: Till.Bill) -> FoldSummary {
        let savings = app.savings
        guard app.session.isSignedIn, let balance = savings.balance else { return .init(text: l.t("cart.savingsOpen"), tone: .muted) }
        if savings.usePoints, !bill.points.isZero {
            return .init(text: "−\(bill.points.formatted(l.current))", tone: .good)
        }
        guard balance > 0, Till.pointsSpendable(balance, on: cart.total) > 0 else { return .init(text: l.t("cart.savingsOpen"), tone: .muted) }
        return .init(text: PointsFormat.count(balance, l.current), tone: .muted)
    }
}

/// What a circle says about what it holds.
struct FoldSummary {
    enum Tone { case muted, good, bad }
    let text: String
    let tone: Tone
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
