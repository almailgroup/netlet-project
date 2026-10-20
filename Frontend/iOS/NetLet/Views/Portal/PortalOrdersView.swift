import SwiftUI

/// The orders a seller has to act on — the web's `/admin/orders`. Fulfilment
/// is per line and the page is built that way: a basket from three sellers
/// can be paid while two have shipped nothing, so each line carries its own
/// moves and the order carries only the payment, which is genuinely whole.
/// A seller sees their own lines; an administrator sees every order whole,
/// and how much attention each one wants.
struct PortalOrdersView: View {
    @State private var page = 1
    @State private var orders: PortalPageOf<DeskOrder>?
    @State private var risk: [Int: OrderRisk] = [:]
    @State private var failed: APIError?
    @State private var open: Int?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.orders"), intro: l.t("admin.ordersNote"), refresh: { await load() }) {
            if let orders {
                if orders.rows.isEmpty {
                    PortalEmpty(text: l.t("admin.ordersEmpty"))
                } else {
                    LazyVStack(spacing: 8) {
                        ForEach(orders.rows) { row in
                            DeskOrderCard(row: row, risk: risk[row.id], open: open == row.id) {
                                withAnimation(.easeOut(duration: 0.2)) { open = open == row.id ? nil : row.id }
                            } changed: {
                                Task { await load() }
                            }
                        }
                    }
                    PortalPager(page: orders.page, pageSize: orders.pageSize, total: orders.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 160)
            }
        }
        .task { await load() }
    }

    private func load() async {
        let api = app.services.api
        do {
            let found = try await api.call(API.deskOrders, .init(page: page))
            orders = found
            failed = nil
            // The signals name other accounts' behaviour, so only an administrator asks.
            if app.session.seller?.can("platform.viewAll") == true, !found.rows.isEmpty {
                let answer = (try? await api.call(API.orderRisk, .init(ids: found.rows.map(\.id)))) ?? []
                risk = Dictionary(answer.map { ($0.orderId, $0) }, uniquingKeysWith: { first, _ in first })
            }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, orders == nil { failed = failure }
        }
    }
}

/// One order on the desk, opened in place: an order is read in order to do
/// something to one of its lines, and a second page for a two-line order is
/// three presses to press one button.
private struct DeskOrderCard: View {
    let row: DeskOrder
    let risk: OrderRisk?
    let open: Bool
    let toggle: () -> Void
    let changed: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.reference).font(.inter(15, .bold)).foregroundStyle(Brand.navy).environment(\.layoutDirection, .leftToRight)
                        Text([OrderWording.date(row.placedAt, language: l.current), row.vendorCount > 1 ? l.t("admin.orderSellers", ["count": "\(row.vendorCount)"]) : nil].compactMap { $0 }.joined(separator: " · "))
                            .font(.inter(13)).foregroundStyle(Brand.muted)
                        HStack(spacing: 6) {
                            StatusPill(label: l.t(DeskWords.payment(row.status)), tone: .portal(row.status == "paid" ? "good" : row.status == "pending_payment" ? "warning" : "neutral"))
                            // A badge only when there is something to say: "low" on every
                            // row is an alert that never stops firing.
                            if let risk, risk.risk != "low" {
                                StatusPill(label: l.t(risk.risk == "high" ? "admin.riskHigh" : "admin.riskWatch"), tone: .portal(risk.risk == "high" ? "danger" : "warning"))
                            }
                        }
                    }
                    Spacer(minLength: 8)
                    HStack(spacing: 6) {
                        Text(row.orderTotal.formatted(l.current)).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                        Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.muted).rotationEffect(.degrees(open ? 180 : 0))
                    }
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 14))
            .accessibilityAddTraits(open ? .isSelected : [])

            if open {
                if let risk, !risk.flags.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(risk.flags, id: \.signal) { flag in
                            Text("· " + l.t(DeskWords.signal(flag.signal), DeskWords.detail(flag.detail, language: l.current)))
                                .font(.inter(13, flag.serious ? .semibold : .regular))
                                .foregroundStyle(flag.serious ? Brand.danger : Color(red: 92 / 255, green: 63 / 255, blue: 12 / 255))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(red: 1, green: 250 / 255, blue: 240 / 255))
                }
                Divider()
                DeskOrderDetailView(orderId: row.id, reference: row.reference, changed: changed).padding(14)
            }
        }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(open ? Brand.navy.opacity(0.3) : Brand.cardLine, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// The opened order: where it goes, the cash when it is owed, and each line
/// with the moves it may make.
private struct DeskOrderDetailView: View {
    let orderId: Int
    let reference: String
    let changed: () -> Void
    @State private var detail: DeskOrderDetail?
    @State private var loaded = false
    @State private var failed: APIError?
    @State private var moving: Int?
    @State private var cancelling: DeskOrderDetail.Line?
    @State private var collecting = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            if let detail {
                content(detail)
            } else if loaded {
                Text(l.t("admin.orderGone")).font(.inter(14)).foregroundStyle(Brand.muted)
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 60)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ detail: DeskOrderDetail) -> some View {
        let order = detail.order
        let actor = app.session.seller
        VStack(alignment: .leading, spacing: 14) {
            if order.subscriptionId != nil {
                StatusPill(label: l.t("subscriptions.repeatOrder"), tone: .shipped)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(l.t("admin.orderDeliverTo")).font(.inter(13, .semibold)).foregroundStyle(Brand.muted)
                Text(order.contactName ?? l.t("admin.orderNoName")).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                Text(order.addressLine ?? l.t("admin.orderNoAddress")).font(.inter(14)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                if let notes = order.addressNotes, !notes.isEmpty {
                    Text(notes).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                if let pin = order.deliveryPin { pinLink(pin) }
            }
            // Cash is collected once, for the basket. Absent unless it applies;
            // it asks first, since it settles the order and issues the invoice.
            if order.mayRecordCash {
                Button { collecting = true } label: { Label(l.t("admin.markCollected"), systemImage: "banknote") }
                    .buttonStyle(PrimaryButtonStyle())
            }
            Text(l.t("admin.orderLines")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
            VStack(spacing: 0) {
                ForEach(Array(detail.lines.enumerated()), id: \.element.id) { index, line in
                    if index > 0 { Divider() }
                    lineRow(line, order: order, actor: actor)
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            if actor?.can("delivery.fileClaim") == true && app.features.isOn("damageClaims") {
                let claimable = detail.lines.filter(\.mayClaim)
                if !claimable.isEmpty { TransitDamageForm(orderId: orderId, lines: claimable) }
            }
        }
        .alert(l.t("admin.cancelLineTitle", ["product": cancelling?.productTitle ?? ""]), isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } })) {
            Button(l.t("admin.moveToCancelled"), role: .destructive) {
                if let line = cancelling { Task { await move(line, to: "cancelled") } }
            }
            Button(l.t("admin.keepLine"), role: .cancel) { cancelling = nil }
        } message: {
            // An administrator sees every line, so knows when this one is the last
            // still coming and the order will close; a seller is told the rule.
            let closes = detail.scope == "admin" && detail.lines.filter { $0.fulfilment != "cancelled" }.count == 1
            Text(l.t(closes ? "admin.cancelLastLineBody" : "admin.cancelLineBody"))
        }
        .alert(l.t("admin.collectedTitle", ["reference": reference]), isPresented: $collecting) {
            Button(l.t("admin.markCollected")) { Task { await collect() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("admin.collectedBody"))
        }
    }

    private func lineRow(_ line: DeskOrderDetail.Line, order: DeskOrderDetail.Order, actor: SellerIdentity?) -> some View {
        // Off NetLet's shelf, NetLet picks and packs it: the seller is told rather
        // than offered buttons the server would refuse.
        let netletPacks = actor.map { $0.kind != "customer" && !(line.centreId == nil || $0.kind == "admin") } ?? false
        // A cancelled line on a closed order stays cancelled: what paid for it has gone back.
        let moves = order.status == "cancelled" && line.fulfilment == "cancelled" ? [] : PortalRules.shared.nextStates(line.fulfilment)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                (Text(line.productTitle).fontWeight(.semibold) + Text(line.variantLabel.map { " · \($0)" } ?? "").foregroundColor(Brand.muted))
                    .font(.inter(14))
                    .foregroundStyle(Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 6)
                Text("\(latin("\(line.quantity) ×")) \(line.unitPrice.formatted(l.current))").font(.inter(14, .bold)).foregroundStyle(Brand.navy)
            }
            // What was bought with it: the seller is who turns up to fit the thing.
            ForEach(line.addons, id: \.id) { addon in
                Text("+ \(addon.label) · \(addon.price.formatted(l.current))").font(.inter(13)).foregroundStyle(Brand.accentInk)
            }
            // Where this one went, when not where the rest went: two doors are two parcels.
            if let destination = line.destination {
                (Text(l.t("address.lineWent", ["label": destination.label])).fontWeight(.semibold) + Text(destination.addressLine.map { " · \($0)" } ?? "").foregroundColor(Brand.muted))
                    .font(.inter(13)).foregroundStyle(Brand.accentInk)
                if let pin = destination.pin { pinLink(pin) }
            }
            FlowLayout(spacing: 8) {
                StatusPill(label: l.t(DeskWords.fulfilment(line.fulfilment)), tone: .portal(DeskWords.fulfilmentTone(line.fulfilment)))
                if let delivered = line.deliveredAt {
                    Label(l.t("admin.deliveredOn", ["date": OrderWording.date(delivered, language: l.current)]), systemImage: "shippingbox")
                        .font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            if netletPacks {
                Label(l.t("fulfilment.netletPacks"), systemImage: "building.2").font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            } else if !moves.isEmpty {
                // Each move its own button: a seller marking twenty parcels shipped
                // presses twenty times, not forty.
                FlowLayout(spacing: 8) {
                    ForEach(moves, id: \.self) { next in
                        Button(l.t(next == "pending" && line.fulfilment == "cancelled" ? "admin.moveToRestore" : DeskWords.move(next))) {
                            if next == "cancelled" { cancelling = line } else { Task { await move(line, to: next) } }
                        }
                        .buttonStyle(PortalSmallButtonStyle(kind: next == "cancelled" ? .danger : .secondary))
                        .disabled(moving == line.id)
                    }
                }
            }
        }
        .padding(12)
    }

    private func pinLink(_ pin: Pin) -> some View {
        Button {
            if let url = URL(string: "https://maps.apple.com/?ll=\(pin.lat),\(pin.lng)&q=\(pin.lat),\(pin.lng)") { openURL(url) }
        } label: {
            Label(l.t("pin.openInMaps"), systemImage: "mappin.and.ellipse").font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
        }
        .buttonStyle(.tap)
    }

    private func load() async {
        do {
            detail = try await app.services.api.call(API.deskOrder, .init(orderId: orderId))
            loaded = true
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, detail == nil { failed = failure }
        }
    }

    private func move(_ line: DeskOrderDetail.Line, to next: String) async {
        moving = line.id
        cancelling = nil
        defer { moving = nil }
        if await app.attempt(done: "admin.fulfilmentSaved", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.moveLine, .init(lineId: line.id, fulfilment: next)) }) {
            await load()
            changed()
        }
    }

    private func collect() async {
        var answer: CashRecorded?
        guard await app.attempt(fallback: "admin.saveFailed", { answer = try await app.services.api.call(API.recordCash, .init(orderId: orderId)) }) else { return }
        // `recorded: false` is a real answer — somebody pressed it first — and is
        // said rather than shown as a success the page cannot back up.
        app.toast(l.t(answer?.recorded == true ? "admin.collectedSaved" : "admin.collectedAlready"))
        await load()
        changed()
    }
}

/// Damage in transit (3.4.2), reported from the order the seller is looking
/// at. Which parcel, which company and the most it can be are the server's;
/// a refusal names what to fix.
private struct TransitDamageForm: View {
    let orderId: Int
    let lines: [DeskOrderDetail.Line]
    @State private var open = false
    @State private var chosen: Set<Int> = []
    @State private var amount = ""
    @State private var description = ""
    @State private var evidence = ""
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var ceiling: Money { Money(fils: lines.filter { chosen.contains($0.id) }.reduce(0) { $0 + $1.lineTotal.fils }) }

    var body: some View {
        if !open {
            Button { open = true } label: { Label(l.t("claims.reportHeading"), systemImage: "exclamationmark.shield") }
                .buttonStyle(PortalSmallButtonStyle(kind: .danger))
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text(l.t("claims.reportHeading")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                Text(l.t("claims.reportNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                Text(l.t("claims.whichItems")).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                ForEach(lines) { line in
                    Button {
                        if chosen.contains(line.id) { chosen.remove(line.id) } else { chosen.insert(line.id) }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: chosen.contains(line.id) ? "checkmark.square.fill" : "square").font(.system(size: 20)).foregroundStyle(chosen.contains(line.id) ? Brand.navy : Brand.chevron)
                            Text(line.productTitle).font(.inter(14)).foregroundStyle(Brand.navy).lineLimit(1)
                            Spacer()
                            Text(line.lineTotal.formatted(l.current)).font(.inter(13)).foregroundStyle(Brand.muted)
                        }
                        .frame(minHeight: 40)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                    .accessibilityAddTraits(chosen.contains(line.id) ? .isSelected : [])
                }
                LabeledField(label: l.t("claims.amountLabel"), text: $amount, placeholder: ceiling.amount,
                             hint: l.t("claims.amountHint", ["amount": ceiling.formatted(l.current)]), keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: l.t("claims.evidenceLabel"), text: $evidence, placeholder: "https://", keyboard: .URL, content: .URL, leftToRight: true)
                LabeledField(label: l.t("claims.descriptionLabel"), text: $description, axis: .vertical)
                HStack(spacing: 8) {
                    Spacer()
                    Button(l.t("claims.cancel")) { open = false }.buttonStyle(PortalSmallButtonStyle())
                    Button(l.t("claims.submit")) { Task { await file() } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                        .disabled(sending || chosen.isEmpty || description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                  || description.count > ReferenceData.shared.rules.orderRules.maxClaimDescription)
                }
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color(red: 239 / 255, green: 198 / 255, blue: 189 / 255), lineWidth: 1))
        }
    }

    private func file() async {
        sending = true
        defer { sending = false }
        let typed = amount.trimmingCharacters(in: .whitespaces)
        let trimmedEvidence = evidence.trimmingCharacters(in: .whitespaces)
        let input = API.TransitClaim(orderId: orderId, lineIds: Array(chosen), amount: typed.isEmpty ? ceiling.amount : typed,
                                     description: description, evidenceUrl: trimmedEvidence.isEmpty ? nil : trimmedEvidence)
        let days = ["days": "\(ReferenceData.shared.rules.orderRules.claimWindowDays)"]
        if await app.attempt(done: "claims.filed", fallback: "admin.saveFailed", params: days, { _ = try await app.services.api.call(API.fileTransitClaim, input) }) {
            open = false
            chosen = []
            amount = ""
            description = ""
            evidence = ""
        }
    }
}

/// The desk's words for states and moves, as literal tables so every key is
/// one the dictionary check can see.
enum DeskWords {
    static func payment(_ status: String) -> String {
        switch status {
        case "paid": return "admin.orderPaid"
        case "cancelled": return "admin.orderCancelled"
        case "refunded": return "admin.orderRefunded"
        default: return "admin.orderPendingPayment"
        }
    }

    static func fulfilment(_ state: String) -> String {
        switch state {
        case "preparing": return "admin.fulfilPreparing"
        case "shipped": return "admin.fulfilShipped"
        case "delivered": return "admin.fulfilDelivered"
        case "cancelled": return "admin.fulfilCancelled"
        case "returned": return "admin.fulfilReturned"
        default: return "admin.fulfilPending"
        }
    }

    static func fulfilmentTone(_ state: String) -> String {
        switch state {
        case "pending": return "warning"
        case "preparing", "shipped": return "navy"
        case "delivered": return "good"
        case "returned": return "danger"
        default: return "neutral"
        }
    }

    /// What pressing does, not where the line ends up.
    static func move(_ state: String) -> String {
        switch state {
        case "preparing": return "admin.moveToPreparing"
        case "shipped": return "admin.moveToShipped"
        case "delivered": return "admin.moveToDelivered"
        case "cancelled": return "admin.moveToCancelled"
        case "returned": return "admin.fulfilReturned"
        default: return "admin.moveToPending"
        }
    }

    static func signal(_ signal: String) -> String {
        switch signal {
        case "newAccountHighValue": return "admin.riskNewAccount"
        case "addressManyAccounts": return "admin.riskAddress"
        case "rapidOrders": return "admin.riskRapid"
        case "refundHistory": return "admin.riskRefunds"
        case "highValueCash": return "admin.riskCash"
        case "firstOrderLargeQuantity": return "admin.riskQuantity"
        default: return "admin.riskWatch"
        }
    }

    /// A signal's evidence with its money formatted, like every other figure on the page.
    static func detail(_ detail: [String: Figure], language: Language) -> [String: String] {
        Dictionary(uniqueKeysWithValues: detail.map { key, value in
            if key == "total", let money = Money(amount: value.written) { return (key, money.formatted(language)) }
            return (key, value.written)
        })
    }
}
