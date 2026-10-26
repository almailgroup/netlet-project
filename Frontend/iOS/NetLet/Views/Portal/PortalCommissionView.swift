import SwiftUI

/// The commission desk — the web's `/admin/commission` (3.3.2, 3.3.9):
/// stores' proposals waiting for an answer, and every store's rate.
///
/// Open to an administrator, and to an employee an administrator granted
/// `vendor.setCommission` and nothing else — which is why it is its own page
/// rather than a section of a store's: that employee sees each store's rate
/// and not its IBAN, contacts or team. Every change goes through the audited
/// door any commission edit takes.
struct PortalCommissionView: View {
    @State private var waiting = true
    @State private var page = 1
    @State private var proposals: CommissionProposalPage?
    @State private var failed: APIError?
    @State private var declining: CommissionProposal?
    @State private var note = ""
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("commission.deskTitle"), intro: l.t("commission.deskNote"), refresh: { await load() }) {
            PortalSegmented(label: l.t("commission.deskTitle"), value: $waiting, options: [(true, l.t("commission.viewWaiting")), (false, l.t("commission.viewDecided"))])
            if let proposals {
                let rows = proposals.rows.filter { waiting ? $0.status == "pending" : $0.status != "pending" }
                if rows.isEmpty {
                    PortalEmpty(text: l.t(waiting ? "commission.noneWaiting" : "commission.noneDecided"))
                } else {
                    ForEach(rows) { row in card(row) }
                    PortalPager(page: proposals.page, pageSize: proposals.pageSize, total: proposals.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
            CommissionStoreRates()
        }
        .task(id: waiting) {
            page = 1
            await load()
        }
        .sheet(item: $declining) { row in
            NavigationStack {
                Form {
                    Section {
                        Text(l.t("commission.declineBody")).font(.inter(13)).foregroundStyle(Brand.body)
                        TextField(l.t("commission.declineNote"), text: Binding(get: { note }, set: { note = String($0.prefix(ProposalRules.maxDecisionNote)) }), axis: .vertical)
                            .lineLimit(2...5)
                    }
                }
                .navigationTitle(l.t("commission.declineTitle"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(l.t("common.cancel")) { declining = nil } }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(l.t("commission.decline")) { Task { await decide(row, accept: false) } }
                            .disabled(busy || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func card(_ row: CommissionProposal) -> some View {
        PortalCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.productTitle.map { l.t("commission.forProduct", ["product": $0, "store": row.vendorName]) } ?? l.t("commission.forStore", ["store": row.vendorName]))
                        .font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                    Text(OrderWording.date(row.createdAt, language: l.current)).font(.inter(12)).foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 6)
                StatusPill(label: l.t(statusKey(row.status)), tone: .portal(statusTone(row.status)))
            }
            Text("\(l.t("commission.asks", ["figure": CommissionWording.figure(row.percent, row.fixed, l)])) · \(l.t("commission.chargedNow", ["figure": CommissionWording.current(row.current.percent, row.current.fixed, l)]))")
                .font(.inter(14)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
            if let reason = row.reason, !reason.isEmpty {
                Text("“\(reason)”").font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
            if let decision = row.decisionNote, !decision.isEmpty {
                Text(l.t("commission.noteWas", ["note": decision])).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            if row.status == "pending" {
                HStack(spacing: 8) {
                    Button { Task { await decide(row, accept: true) } } label: { Label(l.t("commission.accept"), systemImage: "checkmark") }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    Button { note = ""; declining = row } label: { Label(l.t("commission.decline"), systemImage: "xmark") }
                        .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                }
                .disabled(busy)
            }
        }
    }

    private func statusKey(_ status: String) -> String {
        switch status {
        case "accepted": return "commission.statusAccepted"
        case "declined": return "commission.statusDeclined"
        case "withdrawn": return "commission.statusWithdrawn"
        default: return "commission.statusPending"
        }
    }

    private func statusTone(_ status: String) -> String {
        switch status {
        case "accepted": return "good"
        case "declined": return "danger"
        case "withdrawn": return "neutral"
        default: return "warning"
        }
    }

    private func load() async {
        do {
            proposals = try await app.services.api.call(API.commissionProposals, .init(status: waiting ? "pending" : nil, page: page))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, proposals == nil { failed = failure }
        }
    }

    private func decide(_ row: CommissionProposal, accept: Bool) async {
        busy = true
        defer { busy = false }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if await app.attempt(done: accept ? "commission.acceptedDone" : "commission.declinedDone", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.decideProposal, .init(proposalId: row.id, accept: accept, note: accept ? nil : trimmed))
        }) {
            declining = nil
            await load()
        }
    }
}

/// Every store's rate, searched by name, each saved on its own.
private struct CommissionStoreRates: View {
    @State private var query = ""
    @State private var page = 1
    @State private var stores: CommissionStorePage?
    @State private var drafts: [Int: (percent: String, fixed: String)] = [:]
    @State private var saving: Int?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalSectionHeading(title: l.t("commission.storesTitle"), note: l.t("commission.storesNote"))
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Brand.muted)
            TextField(l.t("commission.searchStores"), text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .font(.inter(15))
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 44)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
        .task(id: query) {
            if stores != nil {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                page = 1
            }
            await load()
        }
        if let stores {
            if stores.rows.isEmpty {
                PortalEmpty(text: l.t("admin.noVendors"))
            } else {
                ForEach(stores.rows) { row in rateCard(row) }
                PortalPager(page: stores.page, pageSize: stores.pageSize, total: stores.total) { next in
                    page = next
                    Task { await load() }
                }
            }
        }
    }

    private func rateCard(_ row: CommissionStore) -> some View {
        let draft: (percent: String, fixed: String) = drafts[row.id] ?? (percent: CommissionWording.trimmedNumber(row.commissionPercent), fixed: row.commissionFixed ?? "")
        let changed = drafts[row.id] != nil
        return PortalCard {
            Text(l.current == .ar ? (row.nameAr ?? row.name) : row.name).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            HStack(alignment: .bottom, spacing: 8) {
                LabeledField(label: l.t("admin.commissionPercent"), text: Binding(get: { draft.percent }, set: { drafts[row.id] = (percent: $0, fixed: draft.fixed) }),
                             keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: l.t("admin.commissionFixed"), text: Binding(get: { draft.fixed }, set: { drafts[row.id] = (percent: draft.percent, fixed: $0) }),
                             placeholder: "0.000", keyboard: .decimalPad, leftToRight: true)
            }
            HStack {
                Spacer()
                SectionSave(pending: saving == row.id, disabled: !changed || saving != nil) { Task { await save(row, draft) } }
            }
        }
    }

    private func load() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        stores = (try? await app.services.api.call(API.commissionStores, .init(query: trimmed.isEmpty ? nil : trimmed, page: page))) ?? stores
    }

    private func save(_ row: CommissionStore, _ draft: (percent: String, fixed: String)) async {
        saving = row.id
        defer { saving = nil }
        let percent = PhoneNumber.foldDigits(draft.percent).trimmingCharacters(in: .whitespaces)
        let fixed = PhoneNumber.foldDigits(draft.fixed).trimmingCharacters(in: .whitespaces)
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.setStoreCommission, .init(vendorId: row.id, percent: percent.isEmpty ? "0" : percent, fixed: OrNull(fixed.isEmpty ? nil : fixed)))
        }) {
            drafts[row.id] = nil
            await load()
        }
    }
}
