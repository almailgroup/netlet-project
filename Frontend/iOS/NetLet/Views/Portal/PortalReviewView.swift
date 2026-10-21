import SwiftUI

/// Products waiting for NetLet's approval — the web's `/admin/review`. Each
/// listing carries what the rules found wrong with it, and a model's opinion
/// when one is asked for, one product at a time, since it costs money.
/// Sending one back needs a note, because the seller reads it.
struct PortalReviewView: View {
    @State private var page = 1
    @State private var list: SellerProductPage?
    @State private var flags: [Int: [ReviewFlag]] = [:]
    @State private var modelAvailable = false
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.review"), intro: l.t("admin.reviewIntro"), refresh: { await load() }) {
            if let list {
                if list.total > 0 {
                    StatusPill(label: l.t("admin.reviewWaiting", ["count": "\(list.total)"]), tone: .preparing)
                }
                if list.rows.isEmpty {
                    PortalEmpty(text: l.t("admin.nothingToReview"))
                } else {
                    ForEach(list.rows) { row in
                        ReviewCard(row: row, flags: flags[row.id] ?? [], modelAvailable: modelAvailable) { await load() }
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
        let api = app.services.api
        do {
            let answer = try await api.call(API.sellerProducts, .init(page: page, status: "pending_review"))
            list = answer
            failed = nil
            let ids = answer.rows.map(\.id)
            if !ids.isEmpty, let found = try? await api.call(API.reviewFlags, .init(ids: ids)) {
                flags = Dictionary(found.map { ($0.productId, $0.flags) }, uniquingKeysWith: { first, _ in first })
            }
            modelAvailable = (try? await api.call(API.modelReviewAvailable))?.available ?? false
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, list == nil { failed = failure }
        }
    }
}

private struct ReviewCard: View {
    let row: SellerProduct
    let flags: [ReviewFlag]
    let modelAvailable: Bool
    let decided: () async -> Void
    @State private var note = ""
    @State private var busy = false
    @State private var extra: ReviewFlag?
    @State private var asked = false
    @State private var asking = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalCard {
            HStack(alignment: .top, spacing: 12) {
                RemoteImage(reference: row.cover, contentMode: .fill)
                    .frame(width: 64, height: 64)
                    .background(Brand.photo)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    Button {
                        app.open(.portal("/admin/products/\(row.id)"))
                    } label: {
                        Text(row.displayTitle(l.current)).font(.inter(15, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.tap)
                    Text(summary).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            findings
            Divider()
            LabeledField(label: l.t("admin.reviewNote"), text: Binding(get: { note }, set: { note = String($0.prefix(2000)) }),
                         hint: l.t("admin.reviewNoteHint"), axis: .vertical)
            HStack(spacing: 8) {
                Button {
                    Task { await decide(approve: false) }
                } label: { Label(l.t("admin.reject"), systemImage: "arrow.uturn.backward") }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(busy || trimmedNote.isEmpty)
                Spacer()
                Button {
                    Task { await decide(approve: true) }
                } label: {
                    HStack(spacing: 6) {
                        if busy { ProgressView().tint(.white) } else { Image(systemName: "checkmark") }
                        Text(l.t("admin.approve"))
                    }
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(busy)
            }
        }
    }

    private var trimmedNote: String { note.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The store, how many variants, the lowest price and when it was last changed.
    private var summary: String {
        var parts: [String] = []
        if let vendor = row.vendorName { parts.append(vendor) }
        parts.append(row.variants.count == 1 ? l.t("admin.variantOne") : l.t("admin.variantCount", ["count": "\(row.variants.count)"]))
        if let cheapest = row.cheapest { parts.append(cheapest.formatted(l.current)) }
        if let updated = row.updatedAt { parts.append(OrderWording.date(updated, language: l.current)) }
        return parts.joined(separator: " · ")
    }

    private var findings: some View {
        let all = flags + (extra.map { [$0] } ?? [])
        return VStack(alignment: .leading, spacing: 6) {
            if all.isEmpty {
                Label(l.t("admin.flagsNone"), systemImage: "checkmark").font(.inter(13, .semibold)).foregroundStyle(Brand.success)
            } else {
                ForEach(Array(all.enumerated()), id: \.offset) { _, flag in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: flag.severity == "serious" ? "exclamationmark.triangle.fill" : "info.circle")
                            .foregroundStyle(flag.severity == "serious" ? Brand.danger : Brand.accentInk)
                        (Text(l.t(flag.label)).fontWeight(.semibold) + Text(flag.detail.map { " · \($0)" } ?? ""))
                            .font(.inter(13))
                            .foregroundStyle(flag.severity == "serious" ? Brand.danger : Brand.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(l.t("admin.reviewFindings"))
            }
            if modelAvailable {
                Button {
                    Task { await askModel() }
                } label: {
                    HStack(spacing: 6) {
                        if asking { ProgressView().tint(Brand.navy) } else { Image(systemName: "sparkles") }
                        Text(l.t(asked ? "admin.flagModelAsked" : "admin.flagModelAsk"))
                    }
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(asking || asked)
            }
        }
    }

    private func askModel() async {
        asking = true
        defer { asking = false }
        var answer: ModelFlagAnswer?
        guard await app.attempt(fallback: "admin.saveFailed", {
            answer = try await app.services.api.call(API.modelFlag, .init(id: row.id))
        }), let answer else { return }
        asked = true
        extra = answer.flag
        if answer.flag == nil { app.toast(l.t("admin.flagModelNothing")) }
    }

    private func decide(approve: Bool) async {
        busy = true
        defer { busy = false }
        let written = trimmedNote
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.reviewProduct, .init(id: row.id, approve: approve, note: written.isEmpty ? nil : written))
        }) {
            await decided()
        }
    }
}
