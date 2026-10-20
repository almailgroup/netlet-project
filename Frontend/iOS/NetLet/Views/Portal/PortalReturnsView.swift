import SwiftUI

/// Returns and exchanges on the seller's desk — the web's `/admin/returns`.
/// Most decide themselves; what is left is collecting, receiving and paying
/// back, and each card offers only the acts the server says come next.
/// Receiving is the refund or the exchange, so it asks first.
struct PortalReturnsView: View {
    @State private var openOnly = true
    @State private var rows: [ReturnCase]?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.returns"), intro: l.t("admin.returnsNote"), refresh: { await load() }) {
            PortalSegmented(label: l.t("admin.returns"), value: $openOnly, options: [(true, l.t("admin.returnsTabOpen")), (false, l.t("admin.returnsTabAll"))])
            if let rows {
                if rows.isEmpty {
                    PortalEmpty(text: l.t("admin.returnsNone"))
                } else {
                    ForEach(rows) { row in ReturnCaseCard(row: row) { Task { await load() } } }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
        .onChange(of: openOnly) { Task { await load() } }
    }

    private func load() async {
        do {
            rows = try await app.services.api.call(API.deskReturns, .init(open: openOnly))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, rows == nil { failed = failure }
        }
    }
}

private struct ReturnCaseCard: View {
    let row: ReturnCase
    let changed: () -> Void
    @State private var declining = false
    @State private var reason = ""
    @State private var receiving = false
    @State private var restock = true
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalCard {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    (Text(row.productTitle) + Text(row.quantity > 1 ? " ×\(row.quantity)" : "").foregroundColor(Brand.muted))
                        .font(.inter(15, .bold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                    Text([latin(row.reference), app.session.seller?.kind == "admin" ? row.vendorName : nil, OrderWording.date(row.createdAt, language: l.current)].compactMap { $0 }.joined(separator: " · "))
                        .font(.inter(12)).foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 6)
                StatusPill(label: l.t(ReturnWords.status(row.status)), tone: .portal(ReturnWords.tone(row.status)))
            }
            FlowLayout(spacing: 8) {
                StatusPill(label: l.t(row.kind == "exchange" ? "returns.kindExchange" : "returns.kindRefund"), tone: .shipped)
                Text(l.t(ReturnWords.reason(row.reason))).font(.inter(13)).foregroundStyle(Brand.body)
                if row.decidedBy == "auto" { Text("· " + l.t("returns.decidedAutomatically")).font(.inter(13)).foregroundStyle(Brand.muted) }
            }
            if let note = row.note, !note.isEmpty {
                Text(note).font(.inter(14)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
            }
            if let declined = row.declineReason, !declined.isEmpty {
                Text(Phrasebook.shared.has(declined) ? l.t(declined) : declined).font(.inter(13)).foregroundStyle(Brand.danger).fixedSize(horizontal: false, vertical: true)
            }
            if row.status == "approved" {
                (Text(l.t("admin.returnsCollectFrom") + " ").fontWeight(.semibold) + Text(row.collectFrom))
                    .font(.inter(13)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
            }
            if row.status == "refunded" {
                let amount = (row.refundAmount ?? .zero).formatted(l.current)
                Text(row.refundPaidAt != nil ? l.t("returns.refundPaid", ["amount": amount]) : l.t("admin.returnsRefundOwed", ["amount": amount]))
                    .font(.inter(13, .semibold)).foregroundStyle(row.refundPaidAt != nil ? Brand.success : Brand.accentInk)
            }
            if row.status == "exchanged", let replacement = row.replacementReference {
                Text("\(l.t("returns.replacementSent")) \(latin(replacement))").font(.inter(13)).foregroundStyle(Brand.body)
            }
            if !row.actions.isEmpty { actions }
        }
        .alert(l.t(row.kind == "exchange" ? "admin.returnsConfirmExchange" : "admin.returnsConfirmRefund", ["amount": row.lineTotal.formatted(l.current)]), isPresented: $receiving) {
            Button(l.t(row.kind == "exchange" ? "admin.returnsReceiveExchange" : "admin.returnsReceiveRefund")) { Task { await receive() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text("\(l.t("admin.returnsConfirmBody")) \(l.t(restock ? "admin.returnsWillRestock" : "admin.returnsWillNotRestock"))")
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            // Restocking is a question for whoever holds the item, asked beside
            // the button rather than inside the confirmation.
            if row.actions.contains("receive") {
                Toggle(l.t("admin.returnsRestock"), isOn: $restock).font(.inter(14)).tint(Brand.navy)
            }
            FlowLayout(spacing: 8) {
                if row.actions.contains("decline") {
                    Button(l.t("admin.returnsDecline")) { declining.toggle() }.buttonStyle(PortalSmallButtonStyle(kind: .danger))
                }
                if row.actions.contains("approve") {
                    Button(l.t("admin.returnsApprove")) { Task { await act { try await $0.call(API.decideReturn, .init(requestId: row.id, approve: true)) } } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                }
                if row.actions.contains("collect") {
                    Button(l.t("admin.returnsCollected")) { Task { await act { try await $0.call(API.collectReturn, .init(requestId: row.id)) } } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                }
                if row.actions.contains("receive") {
                    Button(l.t(row.kind == "exchange" ? "admin.returnsReceiveExchange" : "admin.returnsReceiveRefund")) { receiving = true }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                }
                if row.actions.contains("markRefundPaid") {
                    Button(l.t("admin.returnsMarkPaid")) { Task { await act { try await $0.call(API.refundPaid, .init(requestId: row.id)) } } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                }
            }
            .disabled(busy)
            if declining {
                LabeledField(label: l.t("admin.returnsDeclineWhy"), text: Binding(get: { reason }, set: { reason = String($0.prefix(400)) }))
                HStack {
                    Spacer()
                    Button(l.t("admin.returnsDecline")) {
                        Task { await act { try await $0.call(API.decideReturn, .init(requestId: row.id, approve: false, reason: reason)) } }
                    }
                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    .disabled(busy || reason.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func act(_ work: @escaping (APICalling) async throws -> Acknowledged) async {
        busy = true
        defer { busy = false }
        let api = app.services.api
        if await app.attempt(done: "admin.returnsSaved", fallback: "admin.saveFailed", { _ = try await work(api) }) {
            declining = false
            changed()
        }
    }

    private func receive() async {
        busy = true
        defer { busy = false }
        var answer: ReturnReceived?
        guard await app.attempt(fallback: "admin.saveFailed", {
            answer = try await app.services.api.call(API.receiveReturn, .init(requestId: row.id, restock: restock))
        }), let answer else { return }
        app.toast(answer.outcome == "exchanged"
            ? l.t("admin.returnsExchanged", ["reference": answer.replacementReference ?? ""])
            : l.t("admin.returnsRefunded", ["amount": (answer.refundAmount ?? .zero).formatted(l.current)]))
        changed()
    }
}

enum ReturnWords {
    static func reason(_ reason: String) -> String {
        switch reason {
        case "damaged": return "returns.reasonDamaged"
        case "defective": return "returns.reasonDefective"
        case "wrongItem": return "returns.reasonWrongItem"
        case "notAsDescribed": return "returns.reasonNotAsDescribed"
        case "tooSmall": return "returns.reasonTooSmall"
        case "tooLarge": return "returns.reasonTooLarge"
        case "changedMind": return "returns.reasonChangedMind"
        default: return "returns.reasonOther"
        }
    }

    static func status(_ status: String) -> String {
        switch status {
        case "approved": return "returns.statusApproved"
        case "declined": return "returns.statusDeclined"
        case "collected": return "returns.statusCollected"
        case "refunded": return "returns.statusRefunded"
        case "exchanged": return "returns.statusExchanged"
        case "cancelled": return "returns.statusCancelled"
        default: return "returns.statusRequested"
        }
    }

    static func tone(_ status: String) -> String {
        switch status {
        case "requested": return "warning"
        case "approved", "collected": return "navy"
        case "refunded", "exchanged": return "good"
        case "declined": return "danger"
        default: return "neutral"
        }
    }
}
