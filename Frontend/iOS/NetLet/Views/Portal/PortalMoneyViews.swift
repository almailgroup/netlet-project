import SwiftUI

/// A figure and its label, in a grid of them — the finance tables' cells,
/// drawn as a card because seven columns do not fit a phone.
private struct FigureGrid: View {
    let figures: [(String, String)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)],
                  alignment: .leading, spacing: 8) {
            ForEach(Array(figures.enumerated()), id: \.offset) { _, figure in
                VStack(alignment: .leading, spacing: 2) {
                    Text(figure.0).font(.inter(11, .semibold)).foregroundStyle(Brand.muted).lineLimit(1).minimumScaleFactor(0.8)
                    Text(figure.1).font(.inter(13, .bold)).foregroundStyle(Brand.navy).lineLimit(1).minimumScaleFactor(0.7)
                }
            }
        }
    }
}

// MARK: - Finance

/// What the orders froze, reported — the web's `/admin/finance`: gross,
/// refunded and net as three figures, NetLet's cut and what the sellers are
/// owed beside them, by seller and by month, each seller's weeks, when each
/// order's money comes due, and the cash-outs waiting to be paid.
struct PortalFinanceView: View {
    @State private var report: FinanceReport?
    @State private var weekly: WeeklyPayouts?
    @State private var due: [PayoutDue]?
    @State private var cashOuts: [CashOut]?
    @State private var failed: APIError?
    @State private var settling: CashOut?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.financeTitle"), intro: l.t("admin.financeNote"), refresh: { await load() }) {
            if let report {
                if report.truncated { PortalNotice(text: l.t("admin.financeTruncated"), tone: .warning) }
                if report.totals.paidLines == 0 && report.totals.refundedLines == 0 {
                    PortalEmpty(text: l.t("admin.financeEmpty"))
                } else {
                    headline(report.totals)
                    if !report.vendors.isEmpty {
                        PortalSectionHeading(title: l.t("admin.financeBySeller"))
                        ForEach(report.vendors, id: \.self) { row in
                            PortalCard {
                                Text(row.vendorName).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                                FigureGrid(figures: figures(row.paidLines + row.refundedLines, row.gross, row.refunded, row.net, row.commission, row.vendorNet))
                            }
                        }
                    }
                    if !report.months.isEmpty {
                        PortalSectionHeading(title: l.t("admin.financeByMonth"), note: l.t("admin.financeMonthNote"))
                        ForEach(report.months, id: \.self) { row in
                            PortalCard {
                                Text(latin(row.month)).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                                FigureGrid(figures: figures(row.paidLines + row.refundedLines, row.gross, row.refunded, row.net, row.commission, row.vendorNet))
                            }
                        }
                    }
                    weeks
                    PayoutsDueSection(due: due)
                }
                cashOutSection
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 160)
            }
        }
        .task { await load() }
        .confirmationDialog(settling.map { l.t("admin.markPaidTitle", ["amount": $0.value.formatted(l.current), "name": ($0.name?.isEmpty == false ? $0.name : nil) ?? $0.email]) } ?? "",
                            isPresented: Binding(get: { settling != nil }, set: { if !$0 { settling = nil } }), titleVisibility: .visible) {
            Button(l.t("admin.markPaid")) {
                if let row = settling { Task { await settle(row) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { settling = nil }
        } message: {
            Text(l.t("admin.markPaidBody"))
        }
    }

    private func amount(_ money: Money) -> String { money.formatted(l.current) }

    private func figures(_ lines: Int, _ gross: Money, _ refunded: Money, _ net: Money, _ commission: Money, _ owed: Money) -> [(String, String)] {
        [
            (l.t("admin.financeLinesColumn"), "\(lines)"), (l.t("admin.financeSales"), amount(gross)), (l.t("admin.financeRefunded"), amount(refunded)),
            (l.t("admin.financeNet"), amount(net)), (l.t("admin.financeCommission"), amount(commission)), (l.t("admin.financeOwed"), amount(owed)),
        ]
    }

    private func headline(_ totals: FinanceTotals) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            tile("admin.financeNet", amount(totals.net), l.t("admin.financeGrossLess", ["gross": amount(totals.gross), "refunded": amount(totals.refunded)]), "banknote")
            tile("admin.financeCommission", amount(totals.commission), totals.takeRate.map { l.t("admin.financeTakeRate", ["rate": $0]) }, "wallet.pass")
            tile("admin.financeVendorNet", amount(totals.vendorNet), l.t("admin.financeOwedNote"), "storefront")
            tile("admin.financeRefunded", amount(totals.refunded), l.t("admin.financeLineCount", ["paid": "\(totals.paidLines)", "refunded": "\(totals.refundedLines)"]), "arrow.uturn.backward")
        }
    }

    private func tile(_ label: String, _ value: String, _ sub: String?, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(l.t(label), systemImage: symbol).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            Text(value).font(.inter(18, .heavy)).foregroundStyle(Brand.navy).lineLimit(1).minimumScaleFactor(0.6)
            if let sub { Text(sub).font(.inter(11)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 100, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    @ViewBuilder
    private var weeks: some View {
        PortalSectionHeading(title: l.t("admin.payouts"), note: "\(l.t("admin.payoutsNote")) \(l.t("admin.payoutWeekStarts"))")
        if let weekly {
            if weekly.vendors.isEmpty {
                PortalEmpty(text: l.t("admin.payoutsEmpty"))
            } else {
                ForEach(weekly.vendors, id: \.self) { seller in
                    PortalCard {
                        HStack {
                            Text(seller.vendorName).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                            Spacer()
                            Text(amount(seller.owed)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                        }
                        ForEach(seller.weeks, id: \.self) { week in
                            Divider()
                            Text("\(l.t("admin.payoutWeekColumn")) \(latin(week.weekStart))").font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                            FigureGrid(figures: [
                                (l.t("admin.financeLinesColumn"), "\(week.lines)"), (l.t("admin.financeSales"), amount(week.gross)),
                                (l.t("admin.financeRefunded"), amount(week.refunded)), (l.t("admin.financeCommission"), amount(week.commission)),
                                (l.t("admin.payoutOwed"), amount(week.owed)),
                            ])
                        }
                    }
                }
                Text("\(l.t("admin.payoutTotalOwed")): \(amount(weekly.owed))").font(.inter(14, .bold)).foregroundStyle(Brand.navy)
            }
        }
    }

    @ViewBuilder
    private var cashOutSection: some View {
        PortalSectionHeading(title: l.t("admin.cashOuts"), note: l.t("admin.cashOutsNote"))
        if let cashOuts {
            if cashOuts.isEmpty {
                PortalEmpty(text: l.t("admin.cashOutsEmpty"))
            } else {
                ForEach(cashOuts) { row in
                    PortalCard {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                if let name = row.name, !name.isEmpty { Text(name).font(.inter(14, .bold)).foregroundStyle(Brand.navy) }
                                Text(latin(row.email)).font(.inter(12)).foregroundStyle(Brand.muted)
                            }
                            Spacer()
                            Text(amount(row.value)).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                        }
                        Text([row.pot == "affiliate" ? l.t("admin.cashOutAffiliate") : l.t("rewards.balance", ["points": "\(row.points)"]),
                              "\(l.t("admin.cashOutRequested")) \(OrderWording.date(row.requestedAt, language: l.current))"].joined(separator: " · "))
                            .font(.inter(12)).foregroundStyle(Brand.body)
                        Button(l.t("admin.markPaid")) { settling = row }
                            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                            .disabled(busy)
                    }
                }
            }
        }
    }

    private func load() async {
        let api = app.services.api
        do {
            report = try await api.call(API.financeReport)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, report == nil { failed = failure }
            return
        }
        weekly = (try? await api.call(API.weeklyPayouts)) ?? weekly
        due = (try? await api.call(API.payoutsDue, .init())) ?? due ?? []
        cashOuts = (try? await api.call(API.pendingCashOuts)) ?? cashOuts ?? []
    }

    private func settle(_ row: CashOut) async {
        settling = nil
        busy = true
        defer { busy = false }
        if await app.attempt(done: "admin.markPaidDone", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.settleCashOut, .init(entryId: row.id))
        }) {
            cashOuts = (try? await app.services.api.call(API.pendingCashOuts)) ?? cashOuts
        }
    }
}

// MARK: - Invoices

/// Every invoice and credit note NetLet has issued — the web's
/// `/admin/invoices`, searched by number; each opens the document itself.
struct PortalInvoicesView: View {
    @State private var page = 1
    @State private var typed = ""
    @State private var query = ""
    @State private var list: InvoicePage?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.invoices"), intro: l.t("admin.invoicesNote"), refresh: { await load() }) {
            HStack(spacing: 8) {
                TextField("INV-2026-000001", text: Binding(get: { typed }, set: { typed = String($0.prefix(40)) }))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit(search)
                    .font(.inter(15))
                    .environment(\.layoutDirection, .leftToRight)
                    .accessibilityLabel(l.t("admin.invoicesSearch"))
                Button(action: search) { Image(systemName: "magnifyingglass").foregroundStyle(Brand.navy).frame(width: 40, height: 40) }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("admin.invoicesSearch"))
            }
            .padding(.leading, 12)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            if let list {
                if list.rows.isEmpty {
                    PortalEmpty(text: l.t(query.isEmpty ? "admin.invoicesNone" : "admin.invoicesNoMatch"))
                } else {
                    ForEach(list.rows) { row in rowCard(row) }
                    PortalPager(page: list.page, pageSize: list.pageSize, total: list.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
    }

    private func search() {
        page = 1
        query = typed.trimmingCharacters(in: .whitespaces)
        Task { await load() }
    }

    private func rowCard(_ row: InvoiceListRow) -> some View {
        Button {
            app.open(.invoice(number: row.number))
        } label: {
            PortalCard {
                HStack {
                    Text(latin(row.number)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    Spacer()
                    Text((row.kind == "credit_note" ? "−" : "") + row.total.formatted(l.current)).font(.inter(14, .bold))
                        .foregroundStyle(row.kind == "credit_note" ? Brand.danger : Brand.navy)
                }
                FlowLayout(spacing: 6) {
                    StatusPill(label: l.t(row.kind == "credit_note" ? "invoice.creditNote" : "invoice.title"), tone: row.kind == "credit_note" ? .preparing : .shipped)
                    Text("\(latin(row.orderReference)) · \(OrderWording.date(row.issuedAt, language: l.current))").font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
        }
        .buttonStyle(PressFillStyle(cornerRadius: 14))
    }

    private func load() async {
        do {
            list = try await app.services.api.call(API.invoiceList, .init(page: page, query: query.isEmpty ? nil : query))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, list == nil { failed = failure }
        }
    }
}

// MARK: - Codes and gift cards

/// Discount codes and gift cards — the web's `/admin/promotions`. A code is
/// made or edited in one form (a live campaign's edit is ordinary); a gift
/// card's code is generated, since the code is the whole credential.
struct PortalPromotionsView: View {
    @State private var vouchers: Vouchers?
    @State private var failed: APIError?
    @State private var editing: String?
    @State private var code = ""
    @State private var kind = "percent"
    @State private var value = ""
    @State private var minSpend = ""
    @State private var endsAt: Date?
    @State private var maxRedemptions = ""
    @State private var perShopper = "1"
    @State private var cardAmount = ""
    @State private var cardNote = ""
    @State private var cardExpires: Date?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.promotions"), intro: l.t("admin.promotionsNote"), refresh: { await load() }) {
            codeForm
            if app.features.isOn("giftCards") {
                cardForm
            } else {
                PortalNotice(text: l.t("admin.cardsOff"), tone: .info)
            }
            if let vouchers {
                PortalSectionHeading(title: l.t("admin.codesTitle"))
                if vouchers.codes.isEmpty {
                    PortalEmpty(text: l.t("admin.codesEmpty"))
                } else {
                    ForEach(vouchers.codes) { row in codeRow(row) }
                }
                PortalSectionHeading(title: l.t("admin.cardsTitle"))
                if vouchers.cards.isEmpty {
                    PortalEmpty(text: l.t("admin.cardsEmpty"))
                } else {
                    ForEach(vouchers.cards) { row in cardRow(row) }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
    }

    private var codeForm: some View {
        PortalCard {
            Label(editing ?? l.t("admin.codeNew"), systemImage: "ticket").font(.inter(16, .bold)).foregroundStyle(Brand.navy)
            if let editing { PortalNotice(text: l.t("admin.codeEditing", ["code": editing]), tone: .info) }
            LabeledField(label: l.t("admin.codeCode"), text: Binding(get: { code }, set: { code = String($0.uppercased().prefix(40)) }), keyboard: .asciiCapable, leftToRight: true)
                .disabled(editing != nil)
            ChoiceField(label: l.t("admin.codeKind"), current: kind, placeholder: l.t("admin.codeKind"),
                        options: (PortalRules.shared.money?.voucherKinds ?? ["percent", "fixed"]).map { ($0, l.t($0 == "percent" ? "admin.codePercent" : "admin.codeFixed")) }) { kind = $0 ?? "percent" }
            LabeledField(label: l.t("admin.codeValue"), text: $value, placeholder: kind == "percent" ? "10" : "0.000", keyboard: .decimalPad, leftToRight: true)
            LabeledField(label: l.t("admin.codeMinSpend"), text: $minSpend, placeholder: "0.000", hint: l.t("admin.codeMinSpendHint"), keyboard: .decimalPad, leftToRight: true)
            DayField(label: l.t("admin.codeEndsAt"), hint: l.t("admin.codeEndsHint"), day: $endsAt)
            LabeledField(label: l.t("admin.codeMaxRedemptions"), text: Binding(get: { maxRedemptions }, set: { maxRedemptions = PhoneNumber.foldDigits($0).filter(\.isNumber) }),
                         hint: l.t("admin.codeLimitHint"), keyboard: .numberPad, leftToRight: true)
            LabeledField(label: l.t("admin.codePerShopper"), text: Binding(get: { perShopper }, set: { perShopper = PhoneNumber.foldDigits($0).filter(\.isNumber) }),
                         keyboard: .numberPad, leftToRight: true)
            HStack(spacing: 8) {
                if editing != nil {
                    Button(l.t("admin.codeStartNew")) { clearCode() }.buttonStyle(PortalSmallButtonStyle())
                }
                Spacer()
                Button(l.t("admin.codeSave")) { Task { await saveCode() } }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled(busy || code.trimmingCharacters(in: .whitespaces).count < 3 || value.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private var cardForm: some View {
        PortalCard {
            Label(l.t("admin.cardNew"), systemImage: "giftcard").font(.inter(16, .bold)).foregroundStyle(Brand.navy)
            LabeledField(label: l.t("admin.cardAmount"), text: $cardAmount, placeholder: "0.000", keyboard: .decimalPad, leftToRight: true)
            DayField(label: l.t("admin.cardExpires"), hint: l.t("admin.cardExpiresHint"), day: $cardExpires)
            LabeledField(label: l.t("admin.cardNote"), text: Binding(get: { cardNote }, set: { cardNote = String($0.prefix(200)) }))
            HStack {
                Spacer()
                Button(l.t("admin.cardCreate")) { Task { await makeCard() } }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled(busy || cardAmount.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func codeRow(_ row: DiscountCode) -> some View {
        let over = row.endsAt.map { $0 < Date() } ?? false
        let shownValue = row.kind == "percent" ? latin("\(ApplicationModel.trimmedRate(row.value))%") : (Money(amount: row.value)?.formatted(l.current) ?? row.value)
        return PortalCard {
            HStack(alignment: .top) {
                FlowLayout(spacing: 6) {
                    Text(latin(row.code)).font(.system(size: 15, weight: .bold, design: .monospaced)).foregroundStyle(Brand.navy).textSelection(.enabled)
                    StatusPill(label: shownValue, tone: .shipped)
                    if over { StatusPill(label: l.t("offers.statusExpired"), tone: .waiting) }
                }
                Spacer()
                Button(l.t("admin.codeEdit")) { edit(row) }.buttonStyle(PortalSmallButtonStyle())
            }
            Text(codeLine(row)).font(.inter(12)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func codeLine(_ row: DiscountCode) -> String {
        var parts = [row.maxRedemptions.map { l.t("admin.codeUsedOf", ["used": "\(row.used)", "max": "\($0)"]) } ?? l.t("admin.codeUsed", ["used": "\(row.used)"])]
        parts.append(row.endsAt.map { l.t("admin.codeEnds", ["date": OrderWording.date($0, language: l.current)]) } ?? l.t("admin.codeNoEnd"))
        if let min = row.minSpend, let money = Money(amount: min) { parts.append("\(l.t("admin.codeMinSpend")): \(money.formatted(l.current))") }
        return parts.joined(separator: " · ")
    }

    private func cardRow(_ row: GiftCardRow) -> some View {
        PortalCard {
            HStack(alignment: .top) {
                Text(latin(row.code)).font(.system(size: 14, weight: .bold, design: .monospaced)).foregroundStyle(Brand.navy).textSelection(.enabled)
                Spacer()
                Text(l.t("admin.cardRemaining", ["remaining": row.remaining.formatted(l.current), "initial": row.initialBalance.formatted(l.current)]))
                    .font(.inter(12, .semibold)).foregroundStyle(Brand.navy).multilineTextAlignment(.trailing)
            }
            if let note = row.note, !note.isEmpty { Text(note).font(.inter(12)).foregroundStyle(Brand.body) }
            if let expires = row.expiresAt {
                Text(l.t("admin.cardExpiresOn", ["date": OrderWording.date(expires, language: l.current)])).font(.inter(12)).foregroundStyle(Brand.muted)
            }
        }
    }

    private func edit(_ row: DiscountCode) {
        editing = row.code
        code = row.code
        kind = row.kind
        value = row.kind == "percent" ? ApplicationModel.trimmedRate(row.value) : row.value
        minSpend = row.minSpend ?? ""
        endsAt = row.endsAt
        maxRedemptions = row.maxRedemptions.map(String.init) ?? ""
        perShopper = "\(row.perShopper)"
    }

    private func clearCode() {
        editing = nil
        code = ""
        kind = "percent"
        value = ""
        minSpend = ""
        endsAt = nil
        maxRedemptions = ""
        perShopper = "1"
    }

    private func load() async {
        do {
            vouchers = try await app.services.api.call(API.vouchers)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, vouchers == nil { failed = failure }
        }
    }

    private func saveCode() async {
        busy = true
        defer { busy = false }
        let request = API.DiscountCodeInput(
            code: code.trimmingCharacters(in: .whitespaces),
            kind: kind,
            value: PhoneNumber.foldDigits(value).trimmingCharacters(in: .whitespaces),
            minSpend: .text(PhoneNumber.foldDigits(minSpend)),
            endsAt: OrNull(endsAt.map(StoreRules.kuwaitDay)),
            maxRedemptions: OrNull(Int(maxRedemptions)),
            perShopper: max(1, Int(perShopper) ?? 1)
        )
        if await app.attempt(done: "admin.codeSaved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.saveDiscountCode, request)
        }) {
            clearCode()
            await load()
        }
    }

    private func makeCard() async {
        busy = true
        defer { busy = false }
        let request = API.GiftCardInput(amount: PhoneNumber.foldDigits(cardAmount).trimmingCharacters(in: .whitespaces),
                                        note: .text(cardNote), expiresAt: OrNull(cardExpires.map(StoreRules.kuwaitDay)))
        var minted: MintedCard?
        guard await app.attempt(fallback: "admin.saveFailed", {
            minted = try await app.services.api.call(API.createGiftCard, request)
        }), let minted else { return }
        app.toast(l.t("admin.cardCreated", ["code": minted.code]))
        cardAmount = ""
        cardNote = ""
        cardExpires = nil
        await load()
    }
}

/// An optional day: off is no date, on is a date chosen below it.
private struct DayField: View {
    let label: String
    var hint: String?
    @Binding var day: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(label, isOn: Binding(get: { day != nil }, set: { day = $0 ? (day ?? Date()) : nil }))
                .font(.subheadline.weight(.semibold))
                .tint(Brand.navy)
            if let chosen = day {
                DatePicker(label, selection: Binding(get: { chosen }, set: { day = $0 }), displayedComponents: .date)
                    .labelsHidden()
            }
            if let hint { Text(hint).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true) }
        }
    }
}

// MARK: - Affiliates

/// Who earns from sharing NetLet's links — the web's `/admin/affiliates`:
/// approving, suspending and each one's rate, never above the ceiling.
struct PortalAffiliatesView: View {
    @State private var page = 1
    @State private var list: AffiliatePage?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var ceiling: String {
        let value = PortalRules.shared.money?.maxAffiliatePercent ?? 20
        return value == value.rounded() ? "\(Int(value))" : "\(value)"
    }

    var body: some View {
        PortalScreen(title: l.t("admin.affiliates"), intro: l.t("admin.affiliatesNote", ["ceiling": ceiling]), refresh: { await load() }) {
            if let list {
                if list.rows.isEmpty {
                    PortalEmpty(text: l.t("admin.affiliatesNone"))
                } else {
                    ForEach(list.rows) { row in
                        AffiliateCard(row: row, ceiling: ceiling) { await load() }
                    }
                    PortalPager(page: list.page, pageSize: list.pageSize, total: list.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            list = try await app.services.api.call(API.affiliateList, .init(page: page))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, list == nil { failed = failure }
        }
    }
}

private struct AffiliateCard: View {
    let row: AffiliateRow
    let ceiling: String
    let changed: () async -> Void
    @State private var rate: String
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    init(row: AffiliateRow, ceiling: String, changed: @escaping () async -> Void) {
        self.row = row
        self.ceiling = ceiling
        self.changed = changed
        _rate = State(initialValue: row.ratePercent)
    }

    var body: some View {
        PortalCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    (Text(row.displayName).font(.inter(15, .bold)).foregroundColor(Brand.navy) + Text("  \(latin(row.code))").font(.system(size: 12, design: .monospaced)).foregroundColor(Brand.muted))
                    Text([row.name, latin(row.email), OrderWording.date(row.createdAt, language: l.current)].compactMap { $0 }.joined(separator: " · "))
                        .font(.inter(12)).foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 6)
                StatusPill(label: l.t(statusKey), tone: .portal(row.status == "active" ? "good" : row.status == "suspended" ? "danger" : "warning"))
            }
            if let channel = row.channel, !channel.isEmpty {
                Text("\(l.t("affiliate.channel")): \(latin(channel))").font(.inter(12)).foregroundStyle(Brand.body)
            }
            Text(l.t("admin.affiliateStats", ["orders": "\(row.paidOrders)", "earned": row.earned.formatted(l.current)])).font(.inter(13)).foregroundStyle(Brand.ink)
            HStack(alignment: .bottom, spacing: 8) {
                LabeledField(label: l.t("admin.affiliateRate"), text: Binding(get: { rate }, set: { rate = String(PhoneNumber.foldDigits($0).filter { $0.isNumber || $0 == "." }.prefix(5)) }),
                             hint: l.t("admin.affiliateRateHint", ["ceiling": ceiling]), keyboard: .decimalPad, leftToRight: true)
                Button(l.t("admin.affiliateSetRate")) { Task { await update(.init(affiliateId: row.id, ratePercent: rate)) } }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(busy || rate == row.ratePercent)
                    .padding(.bottom, 28)
            }
            HStack {
                Spacer()
                if row.status != "active" {
                    Button(l.t(row.status == "pending" ? "admin.affiliateApprove" : "admin.affiliateReinstate")) { Task { await update(.init(affiliateId: row.id, status: "active")) } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                } else {
                    Button(l.t("admin.affiliateSuspend")) { Task { await update(.init(affiliateId: row.id, status: "suspended")) } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                }
            }
            .disabled(busy)
        }
    }

    private var statusKey: String {
        switch row.status {
        case "active": return "affiliate.statusActive"
        case "suspended": return "affiliate.statusSuspended"
        default: return "affiliate.statusPending"
        }
    }

    private func update(_ request: API.AffiliateUpdate) async {
        busy = true
        defer { busy = false }
        if await app.attempt(done: "admin.affiliateSaved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.updateAffiliate, request)
        }) {
            await changed()
        }
    }
}

// MARK: - Membership

/// Membership on NetLet's desk — the web's `/admin/membership`: what the
/// programme has carried, granting months by email (buying waits on
/// payments), the free-delivery floor, and every grant with its state.
struct PortalMembershipView: View {
    @State private var report: MembershipReport?
    @State private var terms: MembershipTerms?
    @State private var freeOver: String?
    @State private var grants: MembershipPage?
    @State private var currentOnly = true
    @State private var page = 1
    @State private var failed: APIError?
    @State private var email = ""
    @State private var months = 3
    @State private var note = ""
    @State private var ending: MembershipGrant?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var floorText: String { freeOver ?? terms?.freeDeliveryOver ?? "" }
    private var floorOk: Bool {
        let value = PhoneNumber.foldDigits(floorText).trimmingCharacters(in: .whitespaces)
        return value.isEmpty || value.range(of: #"^\d{1,9}(\.\d{1,3})?$"#, options: .regularExpression) != nil
    }

    var body: some View {
        PortalScreen(title: l.t("membership.title"), intro: l.t("membership.adminNote"), refresh: { await load() }) {
            if let report {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    PortalStat(label: l.t("membership.reportMembers"), value: "\(report.members)")
                    PortalStat(label: l.t("membership.reportOrders"), value: "\(report.orders)")
                    PortalStat(label: l.t("membership.reportWaived"), value: report.waived.formatted(l.current))
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            }
            grantForm
            termsForm
            grantList
        }
        .task { await load() }
        .onChange(of: currentOnly) {
            page = 1
            Task { await loadGrants() }
        }
        .confirmationDialog(ending.map { l.t("membership.endTitle", ["email": $0.email]) } ?? "",
                            isPresented: Binding(get: { ending != nil }, set: { if !$0 { ending = nil } }), titleVisibility: .visible) {
            Button(l.t("membership.end"), role: .destructive) {
                if let row = ending { Task { await end(row) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { ending = nil }
        } message: {
            Text(l.t("membership.endBody"))
        }
    }

    private var grantForm: some View {
        PortalCard {
            Text(l.t("membership.grantTitle")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("membership.grantNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            LabeledField(label: l.t("membership.email"), text: $email, keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
            ChoiceField(label: l.t("membership.months"), current: "\(months)", placeholder: l.t("membership.months"),
                        options: (1...(PortalRules.shared.money?.maxGrantMonths ?? 12)).map { ("\($0)", "\($0)") }) { months = Int($0 ?? "3") ?? 3 }
            LabeledField(label: l.t("membership.why"), text: Binding(get: { note }, set: { note = String($0.prefix(PortalRules.shared.money?.maxGrantNote ?? 300)) }))
            HStack {
                Spacer()
                Button(l.t("membership.grant")) { Task { await grant() } }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled(busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private var termsForm: some View {
        PortalCard {
            Text(l.t("membership.termsTitle")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            LabeledField(label: l.t("membership.freeOverLabel"), text: Binding(get: { floorText }, set: { freeOver = $0 }), placeholder: "0.000",
                         hint: l.t("membership.freeOverHint"), problem: floorOk ? nil : l.t("offers.badAmount"), keyboard: .decimalPad, leftToRight: true)
            HStack {
                Spacer()
                Button(l.t("admin.save")) { Task { await saveTerms() } }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled(busy || !floorOk || freeOver == nil || terms == nil)
            }
        }
    }

    @ViewBuilder
    private var grantList: some View {
        PortalSectionHeading(title: l.t("membership.grantsTitle"))
        PortalSegmented(label: l.t("membership.grantsTitle"), value: $currentOnly, options: [(true, l.t("membership.filterCurrent")), (false, l.t("support.filterAll"))])
        if let grants {
            if grants.rows.isEmpty {
                PortalEmpty(text: l.t("membership.none"))
            } else {
                ForEach(grants.rows) { row in grantRow(row) }
                PortalPager(page: grants.page, pageSize: grants.pageSize, total: grants.total) { next in
                    page = next
                    Task { await loadGrants() }
                }
            }
        }
    }

    private func grantRow(_ row: MembershipGrant) -> some View {
        let state = row.state()
        return PortalCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(latin(row.email)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    Text(l.t("membership.span", ["from": OrderWording.date(row.startsAt, language: l.current), "to": OrderWording.date(row.endsAt, language: l.current)]))
                        .font(.inter(12)).foregroundStyle(Brand.muted)
                    if let note = row.note, !note.isEmpty { Text(note).font(.inter(12)).foregroundStyle(Brand.body) }
                }
                Spacer(minLength: 6)
                StatusPill(label: l.t(stateKey(state)), tone: state == "active" ? .done : state == "queued" ? .shipped : .waiting)
            }
            if row.cancelledAt == nil && row.endsAt > Date() {
                HStack {
                    Spacer()
                    Button(l.t("membership.end")) { ending = row }.buttonStyle(PortalSmallButtonStyle(kind: .danger)).disabled(busy)
                }
            }
        }
    }

    private func stateKey(_ state: String) -> String {
        switch state {
        case "ended": return "membership.statusEnded"
        case "active": return "membership.statusActive"
        case "queued": return "membership.statusQueued"
        default: return "membership.statusOver"
        }
    }

    private func load() async {
        let api = app.services.api
        do {
            report = try await api.call(API.membershipReport)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, report == nil { failed = failure }
        }
        terms = (try? await api.call(API.membershipTerms)) ?? terms
        await loadGrants()
    }

    private func loadGrants() async {
        grants = (try? await app.services.api.call(API.membershipList, .init(current: currentOnly, page: page))) ?? grants
    }

    private func grant() async {
        busy = true
        defer { busy = false }
        let trimmed = note.trimmingCharacters(in: .whitespaces)
        var granted: GrantedMembership?
        guard await app.attempt(fallback: "admin.saveFailed", {
            granted = try await app.services.api.call(API.grantMembership, .init(email: email.trimmingCharacters(in: .whitespaces), months: months, note: trimmed.isEmpty ? nil : trimmed))
        }), let granted else { return }
        app.toast(l.t("membership.granted", ["until": OrderWording.date(granted.endsAt, language: l.current)]))
        email = ""
        note = ""
        await load()
    }

    private func saveTerms() async {
        busy = true
        defer { busy = false }
        let value = OrNull<String>.text(PhoneNumber.foldDigits(floorText))
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.setMembershipTerms, .init(freeDeliveryOver: value))
        }) {
            freeOver = nil
            terms = (try? await app.services.api.call(API.membershipTerms)) ?? terms
        }
    }

    private func end(_ row: MembershipGrant) async {
        ending = nil
        busy = true
        defer { busy = false }
        if await app.attempt(done: "membership.ended", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.endMembership, .init(id: row.id))
        }) {
            await load()
        }
    }
}
