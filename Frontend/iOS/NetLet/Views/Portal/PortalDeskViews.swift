import SwiftUI

// MARK: Stock

/// What is running low and what moved — the web's `/admin/stock`. Low is
/// judged against each variant's own reorder point, so three left of
/// something that reorders at twenty sorts above three of something at two.
///
/// **It keeps itself current**: the shelf's four counts, the list and the log
/// are asked again every thirty seconds while the page is open, and it says
/// when it last heard. Each low shelf says its state (`ShelfState`, the
/// dashboard's rule), how long it lasts at the last four weeks' pace, and —
/// for a rank that moves stock — takes a reorder point and a delivery where it
/// stands, through the procedures the web's stock page calls.
struct PortalStockView: View {
    @State private var page = 1
    @State private var low: PortalPageOf<LowStockRow>?
    @State private var shelf: ShelfHealth?
    @State private var moves: [StockMove]?
    @State private var failed: APIError?
    @State private var heard: Date?
    @State private var refreshing = false
    @State private var reorderTexts: [Int: String] = [:]
    @State private var arrivedTexts: [Int: String] = [:]
    @State private var busy: Int?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    /// How often the page asks again while it is open.
    private static let live: Duration = .seconds(30)

    private var mayMove: Bool {
        guard let seller = app.session.seller else { return false }
        return seller.can("stock.adjust", vendorId: seller.ownVendor)
    }

    var body: some View {
        PortalScreen(title: l.t("admin.stockTitle"), intro: l.t("admin.stockIntro"), refresh: { await load() }) {
            HStack(spacing: 10) {
                if let heard {
                    Text(l.t("stock.updated", ["time": time(heard)])).font(.inter(12)).foregroundStyle(Brand.muted)
                }
                Spacer()
                Button {
                    Task { await load() }
                } label: {
                    Label(l.t("stock.refresh"), systemImage: "arrow.clockwise")
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(refreshing)
            }
            if let shelf {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    ForEach(ShelfState.allCases, id: \.self) { state in stateTile(state, count: shelf.count(state)) }
                }
            }
            PortalSectionHeading(title: l.t("admin.lowStockTitle"), note: l.t("admin.lowStockNote"))
            if let low {
                if low.rows.isEmpty {
                    PortalEmpty(text: l.t("admin.nothingLow"))
                } else {
                    ForEach(low.rows) { row in lowRow(row) }
                    PortalPager(page: low.page, pageSize: low.pageSize, total: low.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 80)
            }
            PortalSectionHeading(title: l.t("admin.recentMovements"))
            if let moves {
                if moves.isEmpty {
                    PortalEmpty(text: l.t("admin.noMovements"))
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(moves.enumerated()), id: \.element.id) { index, move in
                            if index > 0 { Divider() }
                            moveRow(move)
                        }
                    }
                    .portalSurface(cornerRadius: 16)
                }
            }
        }
        .task {
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.live)
                if Task.isCancelled { break }
                await load()
            }
        }
    }

    /// One of the shelf's four states, counted, with its icon and word.
    private func stateTile(_ state: ShelfState, count: Int) -> some View {
        let tone = PortalLook.tone(state)
        return HStack(spacing: 10) {
            Image(systemName: tone.symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tone.ink)
                .frame(width: 38, height: 38)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(tone.plate))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text("\(count)").font(.inter(20, .heavy)).foregroundStyle(Brand.navy).monospacedDigit()
                Text(l.t(state.label)).font(.inter(12, .semibold)).foregroundStyle(Brand.muted).lineLimit(1).minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .portalSurface(cornerRadius: 16)
        .accessibilityElement(children: .combine)
    }

    private func statePill(_ state: ShelfState) -> some View {
        let tone = PortalLook.tone(state)
        return HStack(spacing: 4) {
            Image(systemName: tone.symbol).font(.system(size: 10, weight: .bold)).accessibilityHidden(true)
            Text(l.t(state.label))
        }
        .font(.inter(12, .semibold))
        .foregroundStyle(tone.ink)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(tone.plate))
        .fixedSize()
    }

    private func lowRow(_ row: LowStockRow) -> some View {
        PortalCard {
            HStack(alignment: .top, spacing: 8) {
                Button {
                    app.open(.portal("/admin/products/\(row.productId)"))
                } label: {
                    Text(row.productTitle).font(.inter(15, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                }
                .buttonStyle(.tap)
                Spacer(minLength: 6)
                statePill(row.state)
            }
            Text([row.variantTitle == "Default" ? nil : row.variantTitle,
                  l.t("admin.remaining", ["count": "\(max(0, row.stock))"]),
                  row.vendorName].compactMap { $0 }.joined(separator: " · "))
                .font(.inter(13)).foregroundStyle(Brand.muted)
            if let reorderAt = row.lowStockAt {
                levelBar(stock: row.stock, reorderAt: reorderAt)
            }
            if let days = row.daysOfCover {
                Text(l.t("stock.daysLeft", ["count": "\(max(1, days))"]))
                    .font(.inter(13, days < 7 ? .semibold : .regular))
                    .foregroundStyle(days < 7 ? PortalLook.tone(.low).ink : Brand.navy)
            } else {
                Text(l.t("stock.noPace")).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            // Shoppers asked to hear when it is back: a reason to reorder sooner.
            if row.waiting > 0 {
                Text(l.t("admin.waitingForRestock", ["count": "\(row.waiting)"])).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
            }
            if mayMove {
                Divider().padding(.vertical, 2)
                // Side by side where they fit, one over the other on a narrow phone.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 14) {
                        reorderEditor(row)
                        receiveEditor(row)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        reorderEditor(row)
                        receiveEditor(row)
                    }
                }
            } else {
                Text(row.lowStockAt.map { l.t("admin.reorderAt", ["count": "\($0)"]) } ?? l.t("admin.noThreshold"))
                    .font(.inter(13)).foregroundStyle(Brand.muted)
            }
        }
    }

    /// How much of the reorder point is left: full at twice the point, empty at none.
    private func levelBar(stock: Int, reorderAt: Int) -> some View {
        let share = min(1, max(0, Double(stock) / Double(max(1, reorderAt * 2))))
        let state: ShelfState = stock <= 0 ? .out : stock <= reorderAt ? .low : .healthy
        return GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(PortalLook.grid)
                Capsule().fill(PortalLook.tone(state).mark).frame(width: max(4, proxy.size.width * share))
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }

    private func reorderEditor(_ row: LowStockRow) -> some View {
        let text = reorderTexts[row.variantId] ?? row.lowStockAt.map(String.init) ?? ""
        let parsed: Int? = text.isEmpty ? nil : Int(text)
        let valid = text.isEmpty || (parsed.map { $0 >= 0 && $0 <= DashboardRules.maxReorderPoint } ?? false)
        let changed = (text.isEmpty ? nil : parsed) != row.lowStockAt
        let suggested = row.suggestedReorderAt
        let name = row.variantTitle == "Default" ? row.productTitle : "\(row.productTitle) — \(row.variantTitle)"
        return VStack(alignment: .leading, spacing: 4) {
            Text(l.t("stock.reorderPoint")).font(.inter(12, .semibold)).foregroundStyle(Brand.navy)
            HStack(spacing: 6) {
                numberBox(Binding(get: { text }, set: { reorderTexts[row.variantId] = digits($0) }), label: l.t("stock.reorderFor", ["name": name]))
                Button(l.t("stock.setReorder")) { Task { await setReorder(row, parsed) } }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(!valid || !changed || busy == row.variantId)
            }
            if let suggested, suggested != row.lowStockAt {
                Button {
                    reorderTexts[row.variantId] = String(suggested)
                } label: {
                    Text(l.t("stock.suggested", ["count": "\(suggested)"])).font(.inter(11, .semibold)).foregroundStyle(PortalLook.indigoInk)
                }
                .buttonStyle(.tap)
            } else {
                Text(l.t("stock.reorderHint")).font(.inter(11)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func receiveEditor(_ row: LowStockRow) -> some View {
        let text = arrivedTexts[row.variantId] ?? ""
        let amount = Int(text) ?? 0
        let name = row.variantTitle == "Default" ? row.productTitle : "\(row.productTitle) — \(row.variantTitle)"
        return VStack(alignment: .leading, spacing: 4) {
            Text(l.t("stock.arrived")).font(.inter(12, .semibold)).foregroundStyle(Brand.navy)
            HStack(spacing: 6) {
                numberBox(Binding(get: { text }, set: { arrivedTexts[row.variantId] = digits($0) }), label: l.t("stock.receiveFor", ["name": name]), placeholder: "0")
                Button {
                    Task { await receive(row, amount) }
                } label: {
                    // The word alone: beside the number box in half a card, an
                    // icon with it cut the English to "Rece…".
                    Text(l.t("stock.receive")).lineLimit(1).minimumScaleFactor(0.85)
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(amount <= 0 || amount > 1_000_000 || busy == row.variantId)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func numberBox(_ text: Binding<String>, label: String, placeholder: String = "") -> some View {
        TextField(placeholder, text: text)
            .keyboardType(.numberPad)
            .font(.inter(15, .semibold))
            .multilineTextAlignment(.center)
            .monospacedDigit()
            .frame(width: 58, height: 40)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(PortalLook.ground))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(PortalLook.hairline, lineWidth: 1))
            .accessibilityLabel(label)
    }

    /// What was typed, digits only, an Arabic keyboard's read as digits.
    private func digits(_ text: String) -> String {
        String(PhoneNumber.foldDigits(text).filter { ("0"..."9").contains($0) }.prefix(7))
    }

    private func setReorder(_ row: LowStockRow, _ level: Int?) async {
        busy = row.variantId
        defer { busy = nil }
        if await app.attempt(done: level == nil ? "stock.reorderCleared" : "stock.reorderSaved", fallback: "admin.badReorderPoint", {
            _ = try await app.services.api.call(API.setReorderPoint, .init(variantId: row.variantId, lowStockAt: OrNull(level)))
        }) {
            reorderTexts[row.variantId] = nil
            await load()
        }
    }

    private func receive(_ row: LowStockRow, _ amount: Int) async {
        busy = row.variantId
        defer { busy = nil }
        var now = 0
        if await app.attempt(fallback: "error.serverProblem", {
            now = try await app.services.api.call(API.adjustVariantStock, .init(variantId: row.variantId, delta: amount, reason: "received"))
        }) {
            app.toast(l.t("stock.receivedNow", ["count": "\(now)"]))
            arrivedTexts[row.variantId] = nil
            await load()
        }
    }

    private func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: l.current == .ar ? "ar_KW@numbers=latn" : "en_GB")
        formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: date)
    }

    private func moveRow(_ move: StockMove) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(move.productTitle).font(.inter(14, .semibold)).foregroundStyle(Brand.navy).lineLimit(2)
                Spacer(minLength: 6)
                Text(move.delta > 0 ? "+\(move.delta)" : "\(move.delta)")
                    .font(.inter(15, .bold))
                    .foregroundStyle(move.delta > 0 ? Brand.success : Brand.danger)
                    .environment(\.layoutDirection, .leftToRight)
            }
            Text([StockWords.reason(move.reason).map { l.t($0) } ?? move.reason,
                  move.actorEmail.map { _ in l.t("admin.movedBy", ["name": move.actorName ?? move.actorEmail ?? ""]) } ?? l.t("admin.movedBySystem"),
                  OrderWording.dateTime(move.createdAt, language: l.current)].joined(separator: " · "))
                .font(.inter(12)).foregroundStyle(Brand.muted)
            Text("\(l.t("admin.columnAfter")): \(move.resulting)").font(.inter(12)).foregroundStyle(Brand.muted)
        }
        .padding(12)
    }

    private func load() async {
        let api = app.services.api
        refreshing = true
        defer { refreshing = false }
        async let history = try? api.call(API.stockHistory, .init(limit: 30))
        async let health = try? api.call(API.shelfHealth)
        do {
            low = try await api.call(API.lowStock, .init(page: page))
            failed = nil
            heard = Date()
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, low == nil { failed = failure }
        }
        shelf = await health ?? shelf
        moves = await history ?? moves ?? []
    }
}

enum StockWords {
    static func reason(_ reason: String) -> String? {
        switch reason {
        case "received": return "reason.received"
        case "sold": return "reason.sold"
        case "returned": return "reason.returned"
        case "damaged": return "reason.damaged"
        case "correction": return "reason.correction"
        case "netletReceived": return "reason.netletReceived"
        case "netletHandedOver": return "reason.netletHandedOver"
        case "netletReturned": return "reason.netletReturned"
        default: return nil
        }
    }
}

// MARK: Price requests

/// Shoppers asking for a special price — the web's `/admin/offers`. The
/// answer is a price for one shopper, never an advertised saving, so it
/// needs no permit; the store's owner decides whether the store takes them.
struct PortalOffersView: View {
    @State private var page = 1
    @State private var openOnly = true
    @State private var inbox: PortalPageOf<PriceAsk>?
    @State private var failed: APIError?
    @State private var takes: Bool?
    @State private var prices: [Int: String] = [:]
    @State private var notes: [Int: String] = [:]
    @State private var busy: Int?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var vendorId: Int? { app.session.seller?.ownVendor }

    var body: some View {
        PortalScreen(title: l.t("admin.offersTitle"), intro: l.t("admin.offersNote"), refresh: { await load() }) {
            if let vendorId, app.session.seller?.can("vendor.editProfile", vendorId: vendorId) == true, let takes {
                Toggle(isOn: Binding(get: { takes }, set: { value in Task { await setTakes(value, vendorId: vendorId) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.t("admin.offersStoreOpen")).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                        Text(l.t("admin.offersStoreOpenNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .tint(Brand.navy)
                .card(padding: 14)
            }
            PortalSegmented(label: l.t("admin.offersTitle"), value: $openOnly, options: [(true, l.t("admin.offersOpenOnly")), (false, l.t("admin.offersAll"))])
            if let inbox {
                if inbox.rows.isEmpty {
                    PortalEmpty(text: l.t("admin.offersEmpty"))
                } else {
                    ForEach(inbox.rows) { row in askCard(row) }
                    PortalPager(page: inbox.page, pageSize: inbox.pageSize, total: inbox.total) { next in
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
        .onChange(of: openOnly) {
            page = 1
            Task { await load() }
        }
    }

    private func askCard(_ row: PriceAsk) -> some View {
        PortalCard {
            HStack(alignment: .top, spacing: 8) {
                Text(row.productTitle).font(.inter(15, .bold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 6)
                StatusPill(label: l.t(OfferWords.state(row.state)), tone: .portal(row.state == "pending" ? "warning" : row.state == "offered" ? "good" : row.state == "used" ? "navy" : "neutral"))
            }
            FlowLayout(spacing: 10) {
                Text(l.t("admin.offersShopperAsked", ["price": row.askedPrice.formatted(l.current)])).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                Text(l.t("admin.offersListed", ["price": row.listPrice.formatted(l.current)])).font(.inter(13)).foregroundStyle(Brand.body)
                Text(l.t("admin.offersQuantity", ["count": "\(row.quantity)"])).font(.inter(13)).foregroundStyle(Brand.body)
                Text(OrderWording.date(row.createdAt, language: l.current)).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            if let note = row.shopperNote, !note.isEmpty {
                Text(note).font(.inter(14)).foregroundStyle(Brand.ink).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
            }
            if row.state != "pending", let offered = row.offeredPrice {
                Text(offered.formatted(l.current)).font(.inter(14, .bold)).foregroundStyle(Brand.success)
            }
            if row.state == "pending" {
                LabeledField(label: l.t("admin.offersAnswerPrice"), text: price(row.id), placeholder: row.askedPrice.amount, keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: "\(l.t("admin.offersAnswerNote")) (\(l.t("admin.optional")))", text: noteBox(row.id))
                HStack(spacing: 8) {
                    Spacer()
                    Button { Task { await decline(row) } } label: { Label(l.t("admin.offersDecline"), systemImage: "xmark") }
                        .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    Button { Task { await answer(row) } } label: {
                        if busy == row.id { ProgressView().tint(.white) } else { Label(l.t("admin.offersSend"), systemImage: "checkmark") }
                    }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled((prices[row.id] ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .disabled(busy != nil)
            }
        }
    }

    private func price(_ id: Int) -> Binding<String> {
        Binding(get: { prices[id] ?? "" }, set: { prices[id] = $0 })
    }

    private func noteBox(_ id: Int) -> Binding<String> {
        Binding(get: { notes[id] ?? "" }, set: { notes[id] = String($0.prefix(ReferenceData.shared.rules.accountRules.maxOfferNote)) })
    }

    private func note(_ id: Int) -> String? {
        let text = (notes[id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    private func answer(_ row: PriceAsk) async {
        busy = row.id
        defer { busy = nil }
        let price = (prices[row.id] ?? "").trimmingCharacters(in: .whitespaces)
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.answerAsk, .init(offerId: row.id, offeredPrice: price, note: note(row.id), vendorId: vendorId))
        }) { await load() }
    }

    private func decline(_ row: PriceAsk) async {
        busy = row.id
        defer { busy = nil }
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.declineAsk, .init(offerId: row.id, note: note(row.id), vendorId: vendorId))
        }) { await load() }
    }

    private func setTakes(_ value: Bool, vendorId: Int) async {
        let before = takes
        takes = value
        if !(await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.setStoreTakesAsks, .init(vendorId: vendorId, accepts: value))
        })) { takes = before }
    }

    private func load() async {
        let api = app.services.api
        if let vendorId, takes == nil { takes = try? await api.call(API.storeTakesAsks, .init(vendorId: vendorId)) }
        do {
            inbox = try await api.call(API.askInbox, .init(page: page, open: openOnly))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, inbox == nil { failed = failure }
        }
    }
}

enum OfferWords {
    static func state(_ state: String) -> String {
        switch state {
        case "pending": return "admin.offersOpenOnly"
        case "offered": return "admin.offersAnswered"
        case "declined": return "offers.statusDeclined"
        case "expired": return "offers.statusExpired"
        case "withdrawn": return "offers.statusWithdrawn"
        default: return "offers.statusUsed"
        }
    }
}

// MARK: Team

/// Who can sign in to the store, at which rank — the web's `/admin/team`. An
/// owner ranks and removes their own people; a store always keeps an owner,
/// which the server holds under a lock.
struct PortalTeamView: View {
    @State private var members: [StoreMember]?
    @State private var failed: APIError?
    @State private var removing: StoreMember?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private static let roles = ["staff", "manager", "owner"]

    var body: some View {
        let actor = app.session.seller
        let vendorId = actor?.ownVendor
        PortalScreen(title: l.t(vendorId == nil ? "admin.team" : "admin.teamTitle"), intro: vendorId == nil ? nil : l.t("admin.teamIntro"), refresh: { await load() }) {
            if vendorId == nil {
                Text(l.t("admin.teamAdminNote")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true).card(padding: 14)
            } else if let members {
                if members.isEmpty {
                    PortalEmpty(text: l.t("admin.noMembers"))
                } else {
                    ForEach(members) { member in memberRow(member, actor: actor, vendorId: vendorId ?? 0) }
                }
                PortalSectionHeading(title: l.t("admin.rolesTitle"))
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Self.roles, id: \.self) { role in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.t(TeamWords.role(role))).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                            Text(l.t(TeamWords.note(role))).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card(padding: 14)
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
        .alert(l.t("admin.removeMemberTitle", ["name": removing?.shownName ?? ""]), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button(l.t("admin.removeMember"), role: .destructive) {
                if let member = removing, let vendorId { Task { await remove(member, vendorId: vendorId) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { removing = nil }
        } message: {
            Text(l.t("admin.removeMemberBody"))
        }
    }

    private func memberRow(_ member: StoreMember, actor: SellerIdentity?, vendorId: Int) -> some View {
        let manages = actor?.can("vendor.manageMembers", vendorId: vendorId) == true
        return PortalCard {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(member.shownName).font(.inter(15, .semibold)).foregroundStyle(Brand.navy)
                        if member.userId == actor?.userId { Text(l.t("admin.you")).font(.inter(12)).foregroundStyle(Brand.muted) }
                    }
                    Text(member.email ?? "").font(.inter(13)).foregroundStyle(Brand.muted).environment(\.layoutDirection, .leftToRight)
                }
                Spacer(minLength: 6)
                if !manages { StatusPill(label: l.t(TeamWords.role(member.role)), tone: .shipped) }
            }
            if manages {
                HStack(spacing: 8) {
                    Menu {
                        ForEach(Self.roles, id: \.self) { role in
                            Button(l.t(TeamWords.role(role))) { Task { await setRole(member, role, vendorId: vendorId) } }
                        }
                    } label: {
                        MenuField(text: l.t(TeamWords.role(member.role)), placeholder: l.t("admin.memberRole"))
                    }
                    .accessibilityLabel(l.t("admin.memberRole"))
                    Button { removing = member } label: {
                        Image(systemName: "trash").font(.system(size: 15)).foregroundStyle(Brand.danger).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel("\(l.t("admin.remove")): \(member.shownName)")
                }
            }
        }
    }

    private func setRole(_ member: StoreMember, _ role: String, vendorId: Int) async {
        guard role != member.role else { return }
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.setMemberRole, .init(vendorId: vendorId, userId: member.userId, role: role))
        }) { await load() }
    }

    private func remove(_ member: StoreMember, vendorId: Int) async {
        removing = nil
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.removeMember, .init(vendorId: vendorId, userId: member.userId))
        }) { await load() }
    }

    private func load() async {
        guard let vendorId = app.session.seller?.ownVendor else { return }
        do {
            members = try await app.services.api.call(API.storeMembers, .init(vendorId: vendorId))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, members == nil { failed = failure }
        }
    }
}

enum TeamWords {
    static func role(_ role: String) -> String {
        switch role {
        case "owner": return "admin.roleOwner"
        case "manager": return "admin.roleManager"
        default: return "admin.roleStaff"
        }
    }

    static func note(_ role: String) -> String {
        switch role {
        case "owner": return "admin.roleOwnerNote"
        case "manager": return "admin.roleManagerNote"
        default: return "admin.roleStaffNote"
        }
    }
}
