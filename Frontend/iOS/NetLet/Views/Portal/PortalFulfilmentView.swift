import SwiftUI

/// Fulfilled by NetLet — the web's `/admin/fulfilment`: two desks on one
/// page. A seller announces stock to a centre and sees what NetLet holds of
/// theirs; NetLet picks and packs, counts shipments in, sends stock back and
/// runs its centres. Only NetLet counts NetLet's shelf.
struct PortalFulfilmentView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let operates = app.session.seller?.can("fulfilment.operate") == true
        PortalScreen(title: l.t("fulfilment.title"), intro: l.t(operates ? "fulfilment.operatorNote" : "fulfilment.sellerNote")) {
            if operates {
                PickListSection()
                ShipmentsSection(isOperator: true)
                HeldSection(isOperator: true)
                ChargesSection(isOperator: true)
                CentresSection()
            } else {
                AnnounceSection()
                HeldSection(isOperator: false)
                ShipmentsSection(isOperator: false)
                ChargesSection(isOperator: false)
            }
        }
    }
}

private enum FulfilmentWords {
    static func status(_ status: String) -> String {
        switch status {
        case "received": return "fulfilment.statusReceived"
        case "cancelled": return "fulfilment.statusCancelled"
        default: return "fulfilment.statusAnnounced"
        }
    }
}

// MARK: Announcing (a seller)

private struct AnnounceSection: View {
    struct Draft: Identifiable {
        let variantId: Int
        let label: String
        var quantity: String
        var id: Int { variantId }
    }

    @State private var open: Bool?
    @State private var centres: [FulfilmentCentre] = []
    @State private var centreId: Int?
    @State private var query = ""
    @State private var results: [SendableVariant] = []
    @State private var lines: [Draft] = []
    @State private var note = ""
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var chosen: Int? { centreId ?? centres.first?.id }

    var body: some View {
        let parsed = lines.map { (variantId: $0.variantId, quantity: Int($0.quantity) ?? 0) }
        let problem = WarehouseRules.shared.inboundProblem(parsed)
        Group {
            if open == false {
                PortalEmpty(text: l.t("fulfilment.notOpen"))
            } else if open == true {
                PortalCard {
                    Label(l.t("fulfilment.sendTitle"), systemImage: "shippingbox").font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                    Text(l.t("fulfilment.sendNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    Menu {
                        ForEach(centres) { centre in Button(centre.name) { centreId = centre.id } }
                    } label: {
                        MenuField(text: centres.first { $0.id == chosen }?.name, placeholder: l.t("fulfilment.centre"))
                    }
                    .accessibilityLabel(l.t("fulfilment.centre"))
                    LabeledField(label: l.t("fulfilment.findVariant"), text: $query)
                    ForEach(results) { variant in resultRow(variant) }
                    if !lines.isEmpty {
                        Text(l.t("fulfilment.onThisShipment")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                        ForEach(lines) { line in
                            HStack(spacing: 8) {
                                Text(line.label).font(.inter(13)).foregroundStyle(Brand.ink).frame(maxWidth: .infinity, alignment: .leading)
                                TextField("1", text: Binding(get: { line.quantity }, set: { value in
                                    if let index = lines.firstIndex(where: { $0.id == line.id }) { lines[index].quantity = value.filter { ("0"..."9").contains($0) } }
                                }))
                                .keyboardType(.numberPad)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 72)
                                .environment(\.layoutDirection, .leftToRight)
                                .accessibilityLabel(l.t("fulfilment.sendingFor", ["item": line.label]))
                                Button { lines.removeAll { $0.id == line.id } } label: {
                                    Image(systemName: "xmark").foregroundStyle(Brand.danger).frame(width: 40, height: 40)
                                }
                                .buttonStyle(.tap)
                                .accessibilityLabel(l.t("fulfilment.removeItem", ["item": line.label]))
                            }
                        }
                        if let problem { Text(l.t(problem, ["max": "\(WarehouseRules.shared.inbound.maxUnits)"])).font(.footnote).foregroundStyle(Brand.danger) }
                    }
                    LabeledField(label: l.t("fulfilment.note"), text: Binding(get: { note }, set: { note = String($0.prefix(500)) }), axis: .vertical)
                    Button { Task { await announce(parsed) } } label: {
                        if sending { ProgressView().tint(.white) } else { Text(l.t("fulfilment.announce")) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(problem != nil || chosen == nil || sending || app.session.seller?.can("fulfilment.send", vendorId: app.session.seller?.ownVendor) != true)
                }
            }
        }
        .task { await load() }
        .onChange(of: query) { Task { await search() } }
    }

    private func resultRow(_ variant: SendableVariant) -> some View {
        let blocked: String? = variant.preorderStock > 0 ? "fulfilment.blockedPreorder"
            : (variant.centreId != nil && variant.centreId != chosen) ? "fulfilment.blockedOtherCentre" : nil
        let added = lines.contains { $0.variantId == variant.variantId }
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(variant.label).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                Text([variant.sku.map(latin),
                      variant.centreId != nil ? l.t("fulfilment.alreadyHeld", ["count": "\(variant.stock)"]) : l.t("fulfilment.yourShelf", ["count": "\(variant.stock)"]),
                      blocked.map { l.t($0) }].compactMap { $0 }.joined(separator: " · "))
                    .font(.inter(12)).foregroundStyle(Brand.muted)
            }
            Spacer()
            Button(l.t(added ? "fulfilment.added" : "fulfilment.add")) {
                lines.append(Draft(variantId: variant.variantId, label: variant.label, quantity: "1"))
            }
            .buttonStyle(PortalSmallButtonStyle())
            .disabled(blocked != nil || added)
        }
    }

    private func load() async {
        let api = app.services.api
        open = (try? await api.call(API.fulfilmentOpen)) ?? false
        guard open == true else { return }
        centres = (try? await api.call(API.centres))?.filter(\.active) ?? []
        await search()
    }

    private func search() async {
        let term = query
        try? await Task.sleep(for: .milliseconds(250))
        guard term == query else { return }
        results = (try? await app.services.api.call(API.sendable, .init(query: term.trimmingCharacters(in: .whitespaces)))) ?? results
    }

    private func announce(_ parsed: [(variantId: Int, quantity: Int)]) async {
        guard let chosen else { return }
        sending = true
        defer { sending = false }
        var shipment: Announced?
        let input = API.Announce(centreId: chosen, lines: parsed.map { .init(variantId: $0.variantId, quantity: $0.quantity) }, note: .text(note))
        guard await app.attempt(fallback: "admin.saveFailed", { shipment = try await app.services.api.call(API.announceShipment, input) }) else { return }
        app.toast(l.t("fulfilment.announced", ["reference": shipment?.reference ?? ""]))
        lines = []
        note = ""
    }
}

// MARK: Picking (NetLet)

private struct PickListSection: View {
    @State private var picks: PickList?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            PortalSectionHeading(title: l.t("fulfilment.pickTitle"), note: l.t("fulfilment.pickNote"))
            if let picks {
                if picks.orders.isEmpty {
                    PortalEmpty(text: l.t("fulfilment.nothingToPick"))
                } else {
                    ForEach(picks.orders, id: \.self) { order in
                        PortalCard {
                            HStack(alignment: .top) {
                                Text("\(latin(order.reference)) · \(order.centreName) · \(OrderWording.date(order.placedAt, language: l.current))").font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                                Spacer()
                                Button(l.t("fulfilment.markPacked")) { Task { await pack(order) } }
                                    .buttonStyle(PortalSmallButtonStyle(kind: .primary)).disabled(busy)
                            }
                            ForEach(order.lines, id: \.lineId) { line in
                                Text([
                                    "\(latin("\(line.quantity)×")) \(line.productTitle)\(line.variantTitle.map { " — \($0)" } ?? "")",
                                    line.sku.map(latin), line.vendorName,
                                ].compactMap { $0 }.joined(separator: " · "))
                                .font(.inter(13)).foregroundStyle(Brand.body)
                            }
                        }
                    }
                    if picks.truncated { Text(l.t("fulfilment.pickTruncated")).font(.footnote).foregroundStyle(Brand.muted) }
                }
            }
        }
        .task { await load() }
    }

    private func load() async { picks = (try? await app.services.api.call(API.pickList)) ?? picks }

    private func pack(_ order: PickList.Order) async {
        busy = true
        defer { busy = false }
        var result: Packed?
        guard await app.attempt(fallback: "admin.saveFailed", { result = try await app.services.api.call(API.markPacked, .init(orderId: order.orderId, centreId: order.centreId)) }) else { return }
        app.toast(l.t("fulfilment.packedToast", ["count": "\(result?.packed ?? 0)"]))
        await load()
    }
}

// MARK: Shipments

private struct ShipmentsSection: View {
    let isOperator: Bool
    @State private var status: String = "all"
    @State private var page = 1
    @State private var shipments: PortalPageOf<InboundShipment>?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            PortalSectionHeading(title: l.t(isOperator ? "fulfilment.toReceive" : "fulfilment.yourShipments"))
            PortalSegmented(label: l.t("fulfilment.yourShipments"), value: $status, options: [
                ("all", l.t("support.filterAll")), ("announced", l.t("fulfilment.statusAnnounced")),
                ("received", l.t("fulfilment.statusReceived")), ("cancelled", l.t("fulfilment.statusCancelled")),
            ])
            if let shipments {
                if shipments.rows.isEmpty {
                    PortalEmpty(text: l.t("fulfilment.noShipments"))
                } else {
                    ForEach(shipments.rows) { shipment in card(shipment) }
                    PortalPager(page: shipments.page, pageSize: shipments.pageSize, total: shipments.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            }
        }
        .task {
            if isOperator && shipments == nil { status = "announced" }
            await load()
        }
        .onChange(of: status) {
            page = 1
            Task { await load() }
        }
    }

    private func card(_ shipment: InboundShipment) -> some View {
        PortalCard {
            HStack(alignment: .top) {
                Text([latin(shipment.reference), isOperator ? shipment.vendorName : nil, shipment.centreName, OrderWording.date(shipment.createdAt, language: l.current)]
                    .compactMap { $0 }.joined(separator: " · ")).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                Spacer()
                StatusPill(label: l.t(FulfilmentWords.status(shipment.status)), tone: shipment.status == "received" ? .done : shipment.status == "cancelled" ? .waiting : .preparing)
            }
            if let note = shipment.note, !note.isEmpty, note != "NaN" { Text(note).font(.inter(13)).foregroundStyle(Brand.body) }
            if isOperator && shipment.status == "announced" {
                ReceiveForm(shipment: shipment) { Task { await load() } }
            } else {
                ForEach(shipment.lines) { line in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(line.productTitle) — \(line.variantTitle)\(line.sku.map { " · \(latin($0))" } ?? "")").font(.inter(13)).foregroundStyle(Brand.ink)
                        Text([
                            line.received == nil ? l.t("fulfilment.expectedOnly", ["expected": "\(line.expected)"]) : l.t("fulfilment.counted", ["expected": "\(line.expected)", "received": "\(line.received ?? 0)"]),
                            line.short > 0 ? l.t("fulfilment.short", ["count": "\(line.short)"]) : nil,
                            line.over > 0 ? l.t("fulfilment.over", ["count": "\(line.over)"]) : nil,
                        ].compactMap { $0 }.joined(separator: " · "))
                        .font(.inter(12, line.short + line.over > 0 ? .semibold : .regular)).foregroundStyle(line.short > 0 ? Brand.danger : Brand.muted)
                    }
                }
            }
            if !isOperator && shipment.status == "announced" {
                Button(l.t("fulfilment.cancelShipment")) {
                    Task {
                        if await app.attempt(fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.cancelShipment, .init(id: shipment.id)) }) { await load() }
                    }
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .danger))
            }
        }
    }

    private func load() async {
        shipments = (try? await app.services.api.call(API.shipments, .init(status: status == "all" ? nil : status, page: page))) ?? shipments
    }
}

/// Counting a shipment in: zero is a real count — nothing arrived — and it asks first.
private struct ReceiveForm: View {
    let shipment: InboundShipment
    let received: () -> Void
    @State private var counts: [Int: String] = [:]
    @State private var asking = false
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let max = WarehouseRules.shared.inbound.maxUnits
        let parsed = shipment.lines.map { (lineId: $0.id, received: Int(counts[$0.id] ?? "") ?? -1) }
        let valid = parsed.allSatisfy { $0.received >= 0 && $0.received <= max }
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("fulfilment.countIn", ["reference": shipment.reference])).font(.inter(13, .bold)).foregroundStyle(Brand.navy)
            ForEach(shipment.lines) { line in
                HStack(spacing: 8) {
                    Text("\(line.productTitle) — \(line.variantTitle)").font(.inter(13)).foregroundStyle(Brand.ink).frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(l.t("fulfilment.expected")) \(line.expected)").font(.inter(12)).foregroundStyle(Brand.muted)
                    TextField("", text: Binding(get: { counts[line.id] ?? "" }, set: { counts[line.id] = $0.filter { ("0"..."9").contains($0) } }))
                        .keyboardType(.numberPad)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 72)
                        .environment(\.layoutDirection, .leftToRight)
                        .accessibilityLabel(l.t("fulfilment.countFor", ["item": "\(line.productTitle) — \(line.variantTitle)"]))
                }
            }
            Button(l.t("fulfilment.recordCount")) { asking = true }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(!valid || busy)
        }
        .onAppear { counts = Dictionary(uniqueKeysWithValues: shipment.lines.map { ($0.id, "\($0.expected)") }) }
        .alert(l.t("fulfilment.recordCountTitle", ["reference": shipment.reference]), isPresented: $asking) {
            Button(l.t("fulfilment.recordCount")) { Task { await record(parsed) } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("fulfilment.recordCountBody"))
        }
    }

    private func record(_ parsed: [(lineId: Int, received: Int)]) async {
        busy = true
        defer { busy = false }
        var result: Received?
        let input = API.Receipt(id: shipment.id, counts: parsed.map { .init(lineId: $0.lineId, received: $0.received) })
        guard await app.attempt(fallback: "admin.saveFailed", { result = try await app.services.api.call(API.receiveShipment, input) }) else { return }
        app.toast(l.t("fulfilment.receivedToast", ["count": "\(result?.received ?? 0)"]))
        received()
    }
}

// MARK: Held stock

private struct HeldSection: View {
    let isOperator: Bool
    @State private var page = 1
    @State private var held: PortalPageOf<HeldVariant>?
    @State private var sending: HeldVariant?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            PortalSectionHeading(title: l.t(isOperator ? "fulfilment.heldAll" : "fulfilment.heldYours"))
            if let held {
                if held.rows.isEmpty {
                    PortalEmpty(text: l.t("fulfilment.nothingHeld"))
                } else {
                    ForEach(held.rows) { row in
                        PortalCard {
                            Text("\(row.productTitle) — \(row.variantTitle)").font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                            Text([row.sku.map(latin), isOperator ? row.vendorName : nil, row.centreName].compactMap { $0 }.joined(separator: " · ")).font(.inter(12)).foregroundStyle(Brand.muted)
                            HStack {
                                Text(l.t("fulfilment.onShelf", ["count": "\(row.stock)"])).font(.inter(13, .bold)).foregroundStyle(Brand.navy)
                                Spacer()
                                if isOperator {
                                    Button { sending = row } label: { Label(l.t("fulfilment.sendBack"), systemImage: "arrow.uturn.backward") }
                                        .buttonStyle(PortalSmallButtonStyle())
                                }
                            }
                        }
                    }
                    PortalPager(page: held.page, pageSize: held.pageSize, total: held.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            }
        }
        .task { await load() }
        .alert(l.t("fulfilment.sendBackTitle", ["item": sending.map { "\($0.productTitle) — \($0.variantTitle)" } ?? ""]),
               isPresented: Binding(get: { sending != nil }, set: { if !$0 { sending = nil } })) {
            Button(l.t("fulfilment.sendBack"), role: .destructive) {
                if let row = sending {
                    Task {
                        if await app.attempt(done: "fulfilment.sentBackToast", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.returnToSeller, .init(variantId: row.variantId)) }) { await load() }
                    }
                }
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("fulfilment.sendBackBody", ["count": "\(sending?.stock ?? 0)"]))
        }
    }

    private func load() async { held = (try? await app.services.api.call(API.heldStock, .init(page: page))) ?? held }
}

// MARK: Packing charges

private struct ChargesSection: View {
    let isOperator: Bool
    @State private var page = 1
    @State private var charges: PortalPageOf<PackingCharge>?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            PortalSectionHeading(title: l.t("fulfilment.chargesTitle"), note: l.t("fulfilment.chargesNote"))
            if let charges {
                if charges.rows.isEmpty {
                    PortalEmpty(text: l.t("fulfilment.noCharges"))
                } else {
                    ForEach(charges.rows) { row in
                        PortalCard {
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.reference).font(.inter(13, .semibold)).foregroundStyle(Brand.navy).environment(\.layoutDirection, .leftToRight)
                                    Text([latin(row.orderReference), isOperator ? row.vendorName : nil, row.centreName, OrderWording.date(row.createdAt, language: l.current)]
                                        .compactMap { $0 }.joined(separator: " · ")).font(.inter(12)).foregroundStyle(Brand.muted)
                                    Text(l.t("fulfilment.chargeUnits", ["units": "\(row.units)", "rate": row.ratePerUnit.formatted(l.current)])).font(.inter(12)).foregroundStyle(Brand.body)
                                }
                                Spacer()
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text(row.amount.formatted(l.current)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                                    Text(l.t(row.deducted ? "fulfilment.chargeTaken" : "fulfilment.chargeNext")).font(.inter(12)).foregroundStyle(Brand.muted)
                                }
                            }
                        }
                    }
                    PortalPager(page: charges.page, pageSize: charges.pageSize, total: charges.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            }
        }
        .task { await load() }
    }

    private func load() async { charges = (try? await app.services.api.call(API.packingCharges, .init(page: page))) ?? charges }
}

// MARK: Centres (NetLet)

private struct CentresSection: View {
    @State private var centres: [FulfilmentCentre] = []
    @State private var name = ""
    @State private var governorate = ReferenceData.shared.governorates.first?.id ?? "capital"
    @State private var addressLine = ""
    @State private var rates: [Int: String] = [:]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            PortalSectionHeading(title: l.t("fulfilment.centres"), note: l.t("fulfilment.centresNote"))
            if centres.isEmpty { PortalEmpty(text: l.t("fulfilment.noCentres")) }
            ForEach(centres) { centre in
                let rate = rates[centre.id] ?? centre.packFeePerUnit ?? ""
                let ok = rate.trimmingCharacters(in: .whitespaces).isEmpty || rate.trimmingCharacters(in: .whitespaces).range(of: #"^\d{1,6}(\.\d{1,3})?$"#, options: .regularExpression) != nil
                PortalCard {
                    Text(centre.name).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                    Text("\(zone(centre.governorate)) · \(centre.addressLine)").font(.inter(12)).foregroundStyle(Brand.muted)
                    HStack(alignment: .bottom, spacing: 8) {
                        LabeledField(label: l.t("fulfilment.packRateFor", ["centre": centre.name]), text: Binding(get: { rate }, set: { rates[centre.id] = $0 }),
                                     placeholder: l.t("fulfilment.packRatePlaceholder"), problem: ok ? nil : l.t("fulfilment.badRate"), keyboard: .decimalPad, leftToRight: true)
                        Button(l.t("fulfilment.setRate")) { Task { await setRate(centre, rate) } }
                            .buttonStyle(PortalSmallButtonStyle()).disabled(!ok)
                    }
                    Button(l.t(centre.active ? "fulfilment.closeCentre" : "fulfilment.reopenCentre")) {
                        Task { await run { try await $0.call(API.setCentreActive, .init(id: centre.id, active: !centre.active)) } }
                    }
                    .buttonStyle(PortalSmallButtonStyle(kind: centre.active ? .danger : .secondary))
                }
            }
            PortalCard {
                LabeledField(label: l.t("fulfilment.centreName"), text: Binding(get: { name }, set: { name = String($0.prefix(120)) }))
                Menu {
                    ForEach(ReferenceData.shared.governorates) { zone in Button(zone.name(l.current)) { governorate = zone.id } }
                } label: {
                    MenuField(text: zone(governorate), placeholder: l.t("admin.governorate"))
                }
                .accessibilityLabel(l.t("admin.governorate"))
                LabeledField(label: l.t("admin.addressLine"), text: Binding(get: { addressLine }, set: { addressLine = String($0.prefix(300)) }))
                Button(l.t("fulfilment.openCentre")) {
                    Task {
                        await run { try await $0.call(API.createCentre, .init(name: name.trimmingCharacters(in: .whitespaces), governorate: governorate, addressLine: addressLine.trimmingCharacters(in: .whitespaces))) }
                        name = ""
                        addressLine = ""
                    }
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || addressLine.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .task { await load() }
    }

    private func zone(_ id: String) -> String {
        ReferenceData.shared.governorates.first { $0.id == id }?.name(l.current) ?? id
    }

    private func load() async { centres = (try? await app.services.api.call(API.centres)) ?? centres }

    private func setRate(_ centre: FulfilmentCentre, _ rate: String) async {
        await run { try await $0.call(API.setPackRate, .init(id: centre.id, rate: .text(rate))) }
    }

    private func run(_ work: @escaping (APICalling) async throws -> Acknowledged) async {
        let api = app.services.api
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", { _ = try await work(api) }) { await load() }
    }
}
