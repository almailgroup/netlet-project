import CoreLocation
import SwiftUI

// MARK: - Dispatch

/// The dispatch board — the web's `/admin/dispatch`: every parcel, one
/// seller's goods to one door, by where it is. NetLet assigns a company; a
/// company's people collect and hand over, and may share where they are.
struct PortalDispatchView: View {
    @State private var tab = "waiting"
    @State private var board: DispatchBoard?
    @State private var failed: APIError?
    @State private var companies: [DeliveryCompany] = []
    @State private var scores: DeliveryScores?
    @State private var busy: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.openURL) private var openURL

    private var actor: SellerIdentity? { app.session.seller }
    private var mayAssign: Bool { actor?.can("delivery.assign") == true }

    var body: some View {
        PortalScreen(title: l.t("admin.dispatch"), intro: l.t("admin.dispatchNote"), refresh: { await load() }) {
            if actor?.kind == "courier" { ShareLocationCard() }
            PortalSegmented(label: l.t("admin.dispatch"), value: $tab, options: [
                ("waiting", l.t("dispatch.waiting")), ("transit", l.t("dispatch.transit")), ("done", l.t("dispatch.done")),
            ])
            if let board {
                if board.parcels.isEmpty {
                    PortalEmpty(text: l.t(actor?.kind == "courier" ? "dispatch.noneCourier" : "dispatch.none"))
                } else {
                    ForEach(board.parcels) { parcel in parcelCard(parcel) }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
            scoresSection
        }
        .task { await load() }
        .onChange(of: tab) { Task { await load() } }
    }

    private func parcelCard(_ parcel: BoardParcel) -> some View {
        let address = parcel.destination ?? parcel.orderAddress
        return PortalCard {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(parcel.reference).font(.inter(14, .bold)).foregroundStyle(Brand.navy).environment(\.layoutDirection, .leftToRight)
                    Text(l.t("dispatch.parcelOf", ["seller": parcel.vendorName ?? "—", "where": parcel.destination?.label ?? l.t("dispatch.toOrderAddress")]))
                        .font(.inter(13)).foregroundStyle(Brand.body)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 4) {
                    // Members are first in line, and the board says so.
                    if parcel.member == true && parcel.state != "delivered" {
                        StatusPill(label: l.t("membership.priority"), tone: .shipped, systemImage: "checkmark.seal")
                    }
                    // A fast parcel (3.2.5): the shopper paid for its own trip, and it goes first.
                    if parcel.fast == true && parcel.state != "delivered" {
                        StatusPill(label: l.t("dispatch.fastParcel"), tone: .preparing, systemImage: "bolt.fill")
                    }
                    StatusPill(label: parcel.items == 1 ? l.t("dispatch.itemsOne") : l.t("dispatch.items", ["count": "\(parcel.items)"]), tone: .waiting)
                }
            }
            Text(address.line).font(.inter(13)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
            if let pin = address.pin {
                Button {
                    if let url = URL(string: "https://maps.apple.com/?ll=\(pin.lat),\(pin.lng)&q=\(pin.lat),\(pin.lng)") { openURL(url) }
                } label: { Label(l.t("pin.openInMaps"), systemImage: "mappin.and.ellipse").font(.inter(13, .semibold)) }
                .buttonStyle(.tap)
            }
            // NetLet's shelf: the driver collects from the centre, not the seller.
            if let from = parcel.collectFrom {
                Label("\(l.t("fulfilment.collectFrom")) \(from.name) · \(from.addressLine)", systemImage: "building.2").font(.inter(13)).foregroundStyle(Brand.body)
            }
            FlowLayout(spacing: 6) {
                StatusPill(label: parcel.vehicle.map { l.t("dispatch.vehicle", ["vehicle": l.t(ShippingWords.vehicle($0))]) } ?? l.t("dispatch.vehicleUnknown"),
                           tone: parcel.vehicle == nil ? .preparing : .shipped, systemImage: "truck.box")
                if parcel.paymentMethod == "cod" {
                    StatusPill(label: parcel.paymentCollectedAt != nil ? l.t("dispatch.cashPaid") : l.t("dispatch.collectCash", ["amount": parcel.orderTotal.formatted(l.current)]),
                               tone: parcel.paymentCollectedAt != nil ? .done : .preparing)
                }
                if !mayAssign || parcel.selfDelivered == true {
                    Text(parcel.selfDelivered == true ? l.t("dispatch.storeDelivers")
                         : parcel.courierName.map { l.t("dispatch.assignedTo", ["name": $0]) } ?? l.t("dispatch.unassigned"))
                        .font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            ForEach(parcel.lines, id: \.lineId) { line in
                Text("\(latin("\(line.quantity) ×")) \(line.productTitle)").font(.inter(13)).foregroundStyle(Brand.body)
            }
            /* Not NetLet's to give out when the store carries it itself (3.3.13). */
            let assignable = mayAssign && parcel.selfDelivered != true
            if assignable || !parcel.courierMoves.isEmpty {
                Divider()
                FlowLayout(spacing: 8) {
                    if assignable {
                        Menu {
                            Button(l.t("dispatch.unassigned")) { Task { await assign(parcel, nil) } }
                            ForEach(companies.filter { $0.status == "active" || $0.id == parcel.courierId }) { company in
                                Button(company.name) { Task { await assign(parcel, company.id) } }
                            }
                        } label: {
                            MenuField(text: parcel.courierName, placeholder: l.t("dispatch.unassigned"))
                        }
                        .accessibilityLabel(l.t("dispatch.assign", ["parcel": parcel.reference]))
                        .disabled(busy == parcel.id)
                    }
                    ForEach(parcel.courierMoves, id: \.self) { state in
                        Button { Task { await move(parcel, state) } } label: {
                            Label(l.t(state == "shipped" ? "dispatch.collect" : "dispatch.handOver"), systemImage: "shippingbox.and.arrow.backward")
                        }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                        .disabled(busy == parcel.id)
                    }
                }
            }
        }
    }

    private func part(_ label: String, _ value: Double?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(l.t(label)).font(.inter(12)).foregroundStyle(Brand.muted)
            Text(latin(value.map { String(format: "%.1f", $0) } ?? "—")).font(.inter(13, .bold)).foregroundStyle(Brand.navy)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var scoresSection: some View {
        PortalSectionHeading(title: l.t("delivery.scoresHeading"), note: l.t("delivery.scoresNote"))
        if let scores {
            if scores.scores.isEmpty {
                PortalEmpty(text: l.t("delivery.noScores"))
            } else {
                ForEach(scores.scores, id: \.self) { score in
                    PortalCard {
                        Text(score.courierName ?? l.t("delivery.sellerCarried")).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                        HStack(spacing: 6) {
                            StarsView(rating: Int(score.average.rounded()))
                            Text(l.t(score.count == 1 ? "delivery.scoreLineOne" : "delivery.scoreLine", ["average": String(format: "%.1f", score.average), "count": "\(score.count)"]))
                                .font(.inter(13)).foregroundStyle(Brand.body)
                        }
                        // The three parts (3.4.4), from the ratings that gave them.
                        if let parts = score.parts, parts.any {
                            HStack(alignment: .top, spacing: 8) {
                                part("delivery.partSpeed", parts.speed)
                                part("delivery.partCondition", parts.condition)
                                part("delivery.partConduct", parts.conduct)
                            }
                        }
                    }
                }
                let comments = scores.recent.filter { $0.comment?.isEmpty == false }
                if !comments.isEmpty {
                    Text(l.t("delivery.recentHeading")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    ForEach(Array(comments.enumerated()), id: \.offset) { _, row in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                StarsView(rating: row.rating)
                                Text([OrderWording.date(row.createdAt, language: l.current), row.vendorName].compactMap { $0 }.joined(separator: " · ")).font(.inter(12)).foregroundStyle(Brand.muted)
                            }
                            Text(row.comment ?? "").font(.inter(13)).foregroundStyle(Brand.ink)
                        }
                        .card(padding: 12)
                    }
                }
            }
        }
    }

    private func load() async {
        let api = app.services.api
        async let found = try? api.call(API.deliveryScores)
        if mayAssign, companies.isEmpty { companies = (try? await api.call(API.deliveryCompanies)) ?? [] }
        do {
            board = try await api.call(API.dispatchBoard, .init(state: tab))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { failed = failure; board = nil }
        }
        scores = await found ?? scores
    }

    private func move(_ parcel: BoardParcel, _ state: String) async {
        busy = parcel.id
        defer { busy = nil }
        if await app.attempt(done: "dispatch.moved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.moveParcel, .init(orderId: parcel.orderId, key: parcel.key, to: state))
        }) { await load() }
    }

    private func assign(_ parcel: BoardParcel, _ courierId: Int?) async {
        busy = parcel.id
        defer { busy = nil }
        if await app.attempt(done: "dispatch.assigned", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.assignParcel, .init(orderId: parcel.orderId, key: parcel.key, courierId: OrNull(courierId)))
        }) { await load() }
    }
}

/// A driver choosing, every time, to share where they are while carrying
/// parcels (`ShareLocation`): off whenever the board opens, a point at most
/// every fifteen seconds, and stopping takes the position off the server.
private struct ShareLocationCard: View {
    @State private var sharer: PositionSharer
    @State private var stillVisible = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    // Made in an initialiser: Swift 5 mode evaluates a stored property's
    // initial value outside the main actor.
    init() {
        _sharer = State(initialValue: PositionSharer())
    }

    var body: some View {
        PortalCard {
            Label(l.t("tracking.shareTitle"), systemImage: "location.fill").font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            Text(l.t("tracking.shareNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                if sharer.on {
                    Button(l.t("tracking.stop")) { Task { await stop() } }.buttonStyle(PortalSmallButtonStyle())
                } else {
                    Button(l.t("tracking.start")) { sharer.start { position in await send(position) } }.buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    if stillVisible {
                        Button(l.t("tracking.clear")) { Task { await stop() } }.buttonStyle(PortalSmallButtonStyle())
                    }
                }
            }
            if let status = sharer.status {
                Text(l.t(status) + (sharer.on && sharer.lastSent != nil ? " · " + l.t("tracking.lastSent", ["time": time(sharer.lastSent!)]) : ""))
                    .font(.inter(12)).foregroundStyle(sharer.problem ? Brand.danger : Brand.muted)
            } else if stillVisible {
                Text(l.t("tracking.stillVisible")).font(.inter(12)).foregroundStyle(Brand.muted)
            }
        }
        .task { stillVisible = (try? await app.services.api.call(API.mySharing))?.sharing ?? false }
        .onDisappear { sharer.stop() }
    }

    private func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: l.current == .ar ? "ar_KW@numbers=latn" : "en_GB")
        formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private func send(_ position: CLLocation) async -> Bool {
        do {
            _ = try await app.services.api.call(API.sharePosition, .init(lat: position.coordinate.latitude, lng: position.coordinate.longitude, accuracy: position.horizontalAccuracy))
            stillVisible = true
            return true
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(key == "error.serverProblem" ? "tracking.unavailable" : key))
            return false
        }
    }

    private func stop() async {
        sharer.stop()
        _ = try? await app.services.api.call(API.stopSharing)
        stillVisible = false
    }
}

/// The phone's position while sharing is on, handed over at most every fifteen seconds.
@Observable
@MainActor
final class PositionSharer: NSObject, CLLocationManagerDelegate {
    private(set) var on = false
    private(set) var status: String?
    private(set) var problem = false
    private(set) var lastSent: Date?
    private let manager = CLLocationManager()
    private var sentAt = Date.distantPast
    private var send: ((CLLocation) async -> Bool)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func start(_ send: @escaping (CLLocation) async -> Bool) {
        self.send = send
        problem = false
        switch manager.authorizationStatus {
        case .denied, .restricted:
            fail("tracking.denied")
        case .notDetermined:
            on = true
            status = "tracking.locating"
            manager.requestWhenInUseAuthorization()
        default:
            on = true
            status = "tracking.locating"
            manager.startUpdatingLocation()
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
        on = false
        status = nil
    }

    private func fail(_ key: String) {
        stop()
        status = key
        problem = true
    }

    private func arrived(_ location: CLLocation) {
        guard on, Date().timeIntervalSince(sentAt) >= 15, let send else { return }
        sentAt = Date()
        Task {
            if await send(location) {
                self.lastSent = Date()
                self.status = "tracking.sharing"
            } else {
                self.stop()
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard self.on else { return }
            switch status {
            case .authorizedWhenInUse, .authorizedAlways: self.manager.startUpdatingLocation()
            case .denied, .restricted: self.fail("tracking.denied")
            default: break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last else { return }
        Task { @MainActor in self.arrived(last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.fail("tracking.unavailable") }
    }
}

// MARK: - Claims

/// Damage in transit, as a liability — the web's `/admin/claims`. The company
/// answers before NetLet decides, and deciding is final, so it asks first.
struct PortalClaimsView: View {
    @State private var tab = "open"
    @State private var claims: [DamageClaim]?
    @State private var ledger: [ClaimLedgerRow] = []
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.claims"), intro: l.t("admin.claimsNote"), refresh: { await load() }) {
            if !ledger.isEmpty {
                PortalSectionHeading(title: l.t("admin.claimsLedger"))
                ForEach(ledger, id: \.self) { row in
                    PortalCard {
                        HStack {
                            Text(row.courierName ?? "—").font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                            Spacer()
                            Text(row.owed.formatted(l.current)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                        }
                        Text("\(l.t("admin.claimsLedgerAccepted")): \(row.accepted) · \(l.t("admin.claimsLedgerOpen")): \(row.open) · \(l.t("admin.claimsLedgerRejected")): \(row.rejected)")
                            .font(.inter(12)).foregroundStyle(Brand.muted)
                    }
                }
            }
            PortalSegmented(label: l.t("admin.claims"), value: $tab, options: [
                ("open", l.t("admin.claimsTabOpen")), ("accepted", l.t("admin.claimsTabAccepted")), ("rejected", l.t("admin.claimsTabRejected")),
            ])
            if let claims {
                if claims.isEmpty {
                    PortalEmpty(text: l.t("admin.claimsNone"))
                } else {
                    ForEach(claims) { claim in ClaimCard(claim: claim) { Task { await load() } } }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
        .onChange(of: tab) { Task { await load() } }
    }

    private func load() async {
        let api = app.services.api
        if app.session.seller?.can("delivery.view") == true { ledger = (try? await api.call(API.claimLedger)) ?? ledger }
        do {
            claims = try await api.call(API.damageClaims, .init(status: tab))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { failed = failure; claims = nil }
        }
    }
}

private struct ClaimCard: View {
    let claim: DamageClaim
    let changed: () -> Void
    @State private var response = ""
    @State private var award = ""
    @State private var note = ""
    @State private var confirming: String?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.openURL) private var openURL

    var body: some View {
        let actor = app.session.seller
        PortalCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text([latin(claim.reference), claim.vendorName].compactMap { $0 }.joined(separator: " · ")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    Text([l.t(ClaimWords.filedBy(claim.filedAs)), claim.courierName.map { l.t("admin.claimsAgainst", ["company": $0]) }, OrderWording.date(claim.createdAt, language: l.current)]
                        .compactMap { $0 }.joined(separator: " · ")).font(.inter(12)).foregroundStyle(Brand.muted)
                }
                Spacer()
                StatusPill(label: l.t(ClaimWords.status(claim.status)), tone: .portal(claim.status == "open" ? "warning" : claim.status == "accepted" ? "good" : "neutral"))
            }
            ForEach(claim.lines, id: \.lineId) { line in
                HStack {
                    Text(line.productTitle).font(.inter(13)).foregroundStyle(Brand.body)
                    Spacer()
                    Text(line.lineTotal.formatted(l.current)).font(.inter(13)).foregroundStyle(Brand.muted)
                }
            }
            FlowLayout(spacing: 10) {
                Text(l.t("admin.claimsClaimed", ["amount": claim.claimedAmount.formatted(l.current)])).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                if let awarded = claim.awardedAmount {
                    Text(l.t("admin.claimsAwarded", ["amount": awarded.formatted(l.current)])).font(.inter(13, .semibold)).foregroundStyle(Brand.success)
                }
            }
            Text(claim.description).font(.inter(14)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
            // The evidence is a picture somewhere else; it is shown here, and
            // the address opens on its own only when pressed.
            if let evidence = claim.evidenceUrl, let url = URL(string: evidence), url.scheme == "https" {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase { image.resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous)) }
                }
                .frame(maxHeight: 220)
                Button { openURL(url) } label: { Label(l.t("admin.claimsEvidence"), systemImage: "arrow.up.forward.square").font(.inter(13, .semibold)) }
                    .buttonStyle(.tap)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(l.t("admin.claimsResponse")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                Text(claim.courierResponse ?? l.t("admin.claimsNoResponse")).font(.inter(13)).foregroundStyle(claim.courierResponse == nil ? Brand.muted : Brand.ink)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
            if let decision = claim.decisionNote, !decision.isEmpty {
                Text(decision).font(.inter(13)).foregroundStyle(Brand.body)
            }
            if claim.status == "open" && actor?.kind == "courier" { respond }
            if claim.status == "open" && actor?.can("delivery.decideClaims") == true { decide }
        }
        .onAppear {
            response = claim.courierResponse ?? ""
            award = claim.claimedAmount.amount
        }
        .alert(confirming == "accepted"
               ? l.t("admin.claimsConfirmAccept", ["amount": (Money(amount: award) ?? claim.claimedAmount).formatted(l.current), "company": claim.courierName ?? "—"])
               : l.t("admin.claimsConfirmReject"),
               isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } })) {
            Button(l.t(confirming == "accepted" ? "admin.claimsAcceptShort" : "admin.claimsReject"), role: confirming == "accepted" ? nil : .destructive) {
                Task { await decideNow() }
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("admin.claimsConfirmBody"))
        }
    }

    private var respond: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            LabeledField(label: l.t("admin.claimsRespondLabel"), text: Binding(get: { response }, set: { response = String($0.prefix(WarehouseRules.shared.maxClaimResponse)) }), axis: .vertical)
            HStack {
                Spacer()
                Button(l.t("admin.claimsRespond")) { Task { await sendResponse() } }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled(busy || response.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private var decide: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            HStack(alignment: .top, spacing: 8) {
                LabeledField(label: l.t("admin.claimsAwardLabel"), text: $award, keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: l.t("admin.claimsNoteLabel"), text: Binding(get: { note }, set: { note = String($0.prefix(500)) }))
            }
            HStack(spacing: 8) {
                Spacer()
                Button(l.t("admin.claimsReject")) { confirming = "rejected" }.buttonStyle(PortalSmallButtonStyle(kind: .danger)).disabled(busy)
                Button(l.t("admin.claimsAccept")) { confirming = "accepted" }.buttonStyle(PortalSmallButtonStyle(kind: .primary)).disabled(busy)
            }
        }
    }

    private func refusalParams() -> [String: String] { ["days": "\(ReferenceData.shared.rules.orderRules.claimWindowDays)"] }

    private func sendResponse() async {
        busy = true
        defer { busy = false }
        if await app.attempt(done: "admin.claimsResponded", fallback: "admin.saveFailed", params: refusalParams(), {
            _ = try await app.services.api.call(API.respondToClaim, .init(claimId: claim.id, response: response))
        }) { changed() }
    }

    private func decideNow() async {
        guard let outcome = confirming else { return }
        confirming = nil
        busy = true
        defer { busy = false }
        var input = API.ClaimDecision(claimId: claim.id, outcome: outcome, note: .text(note))
        if outcome == "accepted" { input.awardedAmount = award.trimmingCharacters(in: .whitespaces).isEmpty ? claim.claimedAmount.amount : award.trimmingCharacters(in: .whitespaces) }
        if await app.attempt(done: "admin.claimsDecided", fallback: "admin.saveFailed", params: refusalParams(), {
            _ = try await app.services.api.call(API.decideClaim, input)
        }) { changed() }
    }
}

enum ClaimWords {
    static func filedBy(_ filer: String) -> String {
        switch filer {
        case "seller": return "admin.claimsFiledBy.seller"
        case "admin": return "admin.claimsFiledBy.admin"
        default: return "admin.claimsFiledBy.shopper"
        }
    }

    static func status(_ status: String) -> String {
        switch status {
        case "accepted": return "admin.claimsTabAccepted"
        case "rejected": return "admin.claimsTabRejected"
        default: return "admin.claimsTabOpen"
        }
    }
}
