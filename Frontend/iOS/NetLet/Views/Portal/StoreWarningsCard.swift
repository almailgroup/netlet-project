import SwiftUI

/// A store's warnings (3.3.18) — the web's `StoreWarnings`: on its page for
/// NetLet's people, who issue and withdraw them, and on the store's own
/// overview, where its people read each one's reason, the product it names
/// and the day it stops counting, under "1 of 3 standing". Issuing asks first
/// and says when this one would suspend the store.
struct StoreWarningsCard: View {
    var vendorId: Int?
    var storeName: String?
    let manage: Bool
    @State private var summary: StoreWarnings?
    @State private var products: [SellerProduct] = []
    @State private var reason = ""
    @State private var productId: Int?
    @State private var tried = false
    @State private var confirming = false
    @State private var withdrawing: StoreWarning?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: WarningRules { .init() }

    var body: some View {
        Group {
            /* A store with nothing on its record sees nothing on its overview. */
            if manage || summary?.rows.isEmpty == false {
                PortalCard {
                    Text(l.t("warnings.title")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                    Text(l.t(manage ? "warnings.noteAdmin" : "warnings.noteStore", ["suspendAt": "\(rules.suspendAt)", "days": "\(rules.days)"]))
                        .font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    if let summary {
                        Label(l.t("warnings.standing", ["count": "\(summary.standing)", "suspendAt": "\(summary.suspendAt)"]), systemImage: "exclamationmark.triangle")
                            .font(.inter(14, .semibold))
                            .foregroundStyle(summary.standing > 0 ? Brand.danger : Brand.navy)
                        if summary.rows.isEmpty {
                            Text(l.t("warnings.none")).font(.inter(13)).foregroundStyle(Brand.muted)
                        }
                        ForEach(summary.rows) { row in
                            Divider()
                            line(row)
                        }
                    } else {
                        ProgressView().tint(Brand.navy)
                    }
                    if manage { issueForm }
                }
            }
        }
        .task { await load() }
        .confirmationDialog(l.t("warnings.issueTitle", ["store": storeName ?? ""]), isPresented: $confirming, titleVisibility: .visible) {
            Button(l.t("warnings.issue"), role: .destructive) { Task { await issue() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            let next = (summary?.standing ?? 0) + 1
            Text(l.t(next >= rules.suspendAt ? "warnings.issueBodySuspends" : "warnings.issueBody", ["count": "\(next)", "suspendAt": "\(rules.suspendAt)"]))
        }
        .confirmationDialog(l.t("warnings.withdrawTitle"), isPresented: Binding(get: { withdrawing != nil }, set: { if !$0 { withdrawing = nil } }), titleVisibility: .visible) {
            Button(l.t("warnings.withdraw")) { if let row = withdrawing { Task { await withdraw(row) } } }
            Button(l.t("common.cancel"), role: .cancel) { withdrawing = nil }
        } message: {
            Text(l.t("warnings.withdrawBody"))
        }
    }

    private func line(_ row: StoreWarning) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                Text(row.reason).font(.inter(14)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
                Text(details(row)).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 6) {
                StatusPill(label: l.t(stateKey(row.state)), tone: row.state == "standing" ? .stopped : row.state == "cleared" ? .shipped : .waiting)
                if manage && row.state == "standing" {
                    Button(l.t("warnings.withdraw")) { withdrawing = row }
                        .buttonStyle(PortalSmallButtonStyle())
                        .disabled(busy)
                }
            }
        }
    }

    private func details(_ row: StoreWarning) -> String {
        var parts = [OrderWording.date(row.createdAt, language: l.current)]
        if let title = row.productTitle {
            parts.append(l.t("warnings.aboutProduct", ["product": l.current == .ar ? (row.productTitleAr ?? title) : title]))
        }
        if row.state == "standing" { parts.append(l.t("warnings.until", ["date": OrderWording.date(row.expiresAt, language: l.current)])) }
        if let who = row.issuedBy { parts.append(l.t("warnings.issuedBy", ["email": latin(who)])) }
        return parts.joined(separator: " · ")
    }

    private func stateKey(_ state: String) -> String {
        switch state {
        case "standing": return "warnings.stateStanding"
        case "withdrawn": return "warnings.stateWithdrawn"
        case "cleared": return "warnings.stateCleared"
        default: return "warnings.stateLapsed"
        }
    }

    private var problem: String? { rules.reasonProblem(reason) }

    @ViewBuilder
    private var issueForm: some View {
        Divider()
        Text(l.t("warnings.issue")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
        LabeledField(label: l.t("warnings.reason"), text: Binding(get: { reason }, set: { reason = String($0.prefix(rules.maxReason)) }),
                     problem: tried ? problem.map { l.t($0) } : nil, axis: .vertical)
        ChoiceField(label: l.t("warnings.product"), current: productId.map(String.init) ?? "", placeholder: l.t("warnings.noProduct"),
                    options: [("", l.t("warnings.noProduct"))] + products.map { (String($0.id), l.current == .ar ? ($0.titleAr ?? $0.title) : $0.title) }) { chosen in
            productId = chosen.flatMap(Int.init)
        }
        Button {
            tried = true
            if problem == nil { confirming = true }
        } label: { Label(l.t("warnings.issue"), systemImage: "exclamationmark.triangle") }
            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
            .disabled(busy)
    }

    private func load() async {
        let api = app.services.api
        summary = (try? await api.call(API.storeWarnings, .init(vendorId: vendorId))) ?? summary
        if manage, let vendorId, products.isEmpty {
            products = (try? await app.services.seller.listings(vendorId: vendorId, page: 1))?.rows ?? []
        }
    }

    private func issue() async {
        guard let vendorId else { return }
        busy = true
        defer { busy = false }
        var answer: API.WarningIssued?
        guard await app.attempt(fallback: "admin.saveFailed", {
            answer = try await app.services.api.call(API.issueWarning, .init(vendorId: vendorId, productId: productId, reason: reason.trimmingCharacters(in: .whitespacesAndNewlines)))
        }) else { return }
        app.toast(l.t(answer?.suspended == true ? "warnings.issuedSuspended" : "warnings.issued"))
        reason = ""
        productId = nil
        tried = false
        await load()
    }

    private func withdraw(_ row: StoreWarning) async {
        withdrawing = nil
        busy = true
        defer { busy = false }
        if await app.attempt(done: "warnings.withdrawn", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.withdrawWarning, .init(warningId: row.id))
        }) { await load() }
    }
}
