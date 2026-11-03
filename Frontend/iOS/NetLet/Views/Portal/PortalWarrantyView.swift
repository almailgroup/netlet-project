import SwiftUI

/// The warranty desk (migration 0072) — the web's `/admin/warranty`: a store's
/// claims, or every store's for NetLet, waiting ones first.
///
/// Each card is what the shopper filed — the item, their words and photos,
/// the store's own warranty words beside it — and the buttons
/// `warrantyActions` allows: accept with a remedy, or decline with a reason
/// the shopper reads; a repair accepted is the store's to mark done. A
/// replacement or a refund becomes an approved return on Returns, which
/// collects the item and settles it. The shopper is a first name and nothing
/// else — a store needs to know who, never how to reach them.
struct PortalWarrantyView: View {
    @State private var waitingOnly = true
    @State private var rows: [WarrantyDeskClaim]?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("warranty.deskTitle"), intro: l.t("warranty.deskNote"), refresh: { await load() }) {
            PortalSegmented(label: l.t("warranty.deskTitle"), value: $waitingOnly, options: [(true, l.t("admin.returnsTabOpen")), (false, l.t("admin.returnsTabAll"))])
            if let rows {
                if rows.isEmpty {
                    PortalEmpty(text: l.t("warranty.deskNone"))
                } else {
                    ForEach(rows) { row in WarrantyDeskCard(row: row) { Task { await load() } } }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
        .onChange(of: waitingOnly) { Task { await load() } }
    }

    private func load() async {
        do {
            rows = try await app.services.api.call(API.warrantyDesk, .init(waiting: waitingOnly))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, rows == nil { failed = failure }
        }
    }
}

private struct WarrantyDeskCard: View {
    let row: WarrantyDeskClaim
    let changed: () -> Void
    @State private var mode: Mode?
    @State private var remedy = "repair"
    @State private var words = ""
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private enum Mode { case accept, decline, complete }

    private var rules: Rules.AfterSales.Warranty { ReferenceData.shared.rules.afterSalesRules.warranty }

    var body: some View {
        PortalCard {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    (Text(row.productTitle) + Text(row.quantity > 1 ? " ×\(row.quantity)" : "").foregroundColor(Brand.muted))
                        .font(.inter(15, .bold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                    Text([latin(row.reference), app.session.seller?.kind == "admin" ? row.vendorName : nil, row.shopper, OrderWording.date(row.createdAt, language: l.current)].compactMap { $0 }.joined(separator: " · "))
                        .font(.inter(12)).foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 6)
                WarrantyStagePill(stage: row.stage)
            }
            Group {
                if let delivered = row.deliveredAt {
                    Text(l.t("warranty.deskDelivered", ["date": OrderWording.date(delivered, language: l.current)]))
                }
                if let terms = row.terms, !terms.isEmpty {
                    Text(l.t("warranty.storeTerms") + " ") + Text(terms).bold()
                } else {
                    Text(l.t("warranty.deskNoTerms"))
                }
            }
            .font(.inter(12))
            .foregroundStyle(Brand.muted)
            .fixedSize(horizontal: false, vertical: true)
            Text(row.problem)
                .font(.inter(14))
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.photo))
            if !row.photos.isEmpty {
                HStack(spacing: 8) {
                    ForEach(row.photos, id: \.self) { photo in
                        RemoteImage(reference: photo)
                            .frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .accessibilityLabel(l.t("warranty.deskPhoto"))
                    }
                }
            }
            if let response = row.response, !response.isEmpty {
                (Text(l.t("warranty.deskAnswer") + " ").bold() + Text(response))
                    .font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
            if row.stage == "returning" {
                Button(l.t("warranty.deskOpenReturn")) { app.open(.portal("/admin/returns")) }
                    .buttonStyle(PortalSmallButtonStyle())
            }
            if let mode {
                form(mode)
            } else if !row.actions.isEmpty {
                FlowLayout(spacing: 8) {
                    if row.actions.contains("accept") {
                        Button(l.t("warranty.deskAccept")) { open(.accept) }.buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    }
                    if row.actions.contains("decline") {
                        Button(l.t("warranty.deskDecline")) { open(.decline) }.buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    }
                    if row.actions.contains("complete") {
                        Button(l.t("warranty.deskComplete")) { open(.complete) }.buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    }
                }
            }
        }
    }

    private func open(_ next: Mode) {
        words = ""
        mode = next
    }

    private func form(_ mode: Mode) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            if mode == .accept {
                Text(l.t("warranty.deskRemedy")).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                HStack(spacing: 8) {
                    ForEach(rules.remedies, id: \.self) { option in
                        ChoiceChip(title: l.t(Self.remedyLabel(option)), selected: remedy == option, available: true) { remedy = option }
                    }
                }
                if remedy != "repair" {
                    Text(l.t("warranty.deskBecomesReturn")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            LabeledField(
                label: l.t(mode == .decline ? "warranty.deskWhy" : mode == .complete ? "warranty.deskDoneNote" : "warranty.deskHow"),
                text: Binding(get: { words }, set: { words = String($0.prefix(rules.maxResponse)) }),
                problem: problem(mode).map { l.t($0) },
                axis: .vertical
            )
            HStack(spacing: 8) {
                Button(l.t("claims.cancel")) { self.mode = nil }.buttonStyle(PortalSmallButtonStyle())
                Spacer()
                Button(l.t(mode == .decline ? "warranty.deskDecline" : mode == .complete ? "warranty.deskComplete" : "warranty.deskAccept")) {
                    Task { await send(mode) }
                }
                .buttonStyle(PortalSmallButtonStyle(kind: mode == .decline ? .danger : .primary))
                .disabled(busy || problem(mode) != nil)
            }
        }
    }

    /// `responseIssue`: a refusal says why, and nothing carries contact details.
    private func problem(_ mode: Mode) -> String? {
        let trimmed = words.trimmingCharacters(in: .whitespacesAndNewlines)
        if mode == .decline && trimmed.isEmpty { return "warranty.needsReason" }
        if !trimmed.isEmpty && !ContactFilter.findings(trimmed).isEmpty { return "warranty.contactDetails" }
        return nil
    }

    private func send(_ mode: Mode) async {
        busy = true
        defer { busy = false }
        let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
        if await app.attempt(done: "warranty.deskSaved", fallback: "admin.saveFailed", {
            switch mode {
            case .complete:
                _ = try await app.services.api.call(API.completeWarranty, .init(id: row.id, note: text))
            case .accept:
                _ = try await app.services.api.call(API.decideWarranty, .init(id: row.id, accept: true, remedy: remedy, response: text))
            case .decline:
                _ = try await app.services.api.call(API.decideWarranty, .init(id: row.id, accept: false, remedy: nil, response: text))
            }
        }) {
            self.mode = nil
            changed()
        }
    }

    static func remedyLabel(_ remedy: String) -> String {
        switch remedy {
        case "replace": return "warranty.deskReplace"
        case "refund": return "warranty.deskRefund"
        default: return "warranty.deskRepair"
        }
    }
}
