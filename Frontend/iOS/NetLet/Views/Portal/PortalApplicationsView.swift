import QuickLook
import UniformTypeIdentifiers
import SwiftUI

/// Seller applications waiting on NetLet — the web's `/admin/applications`.
/// Each card is what the applicant gave, their papers to accept or turn down
/// one by one, the rate the administrator sets (the standard one unless they
/// change it), and approving, which waits on every detail and every paper.
struct PortalApplicationsView: View {
    @State private var page = 1
    @State private var list: ApplicationPage?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.applications"), intro: l.t("admin.applicationsNote"), refresh: { await load() }) {
            if let list {
                if list.rows.isEmpty {
                    PortalEmpty(text: l.t("admin.applicationsEmpty"))
                } else {
                    ForEach(list.rows) { row in
                        ApplicationCard(row: row) { await load() }
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
            list = try await app.services.api.call(API.pendingApplications, .init(status: "submitted", page: page))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, list == nil { failed = failure }
        }
    }
}

private struct ApplicationCard: View {
    let row: PendingApplication
    let changed: () async -> Void
    @State private var rate: String
    @State private var fixed = ""
    @State private var reason = ""
    @State private var deciding = false
    @State private var documents: [ApplicationDocument]?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private static var standard: String { ApplicationModel.trimmedRate(SiteContent.shared?.selling.defaultCommission ?? "10") }
    private static var agreement: String { SiteContent.shared?.selling.agreementVersion ?? "" }

    init(row: PendingApplication, changed: @escaping () async -> Void) {
        self.row = row
        self.changed = changed
        _rate = State(initialValue: ApplicationCard.standard)
    }

    var body: some View {
        let missing = row.missing(currentAgreement: Self.agreement)
        PortalCard {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.storeName).font(.inter(16, .bold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                    Text([row.applicantEmail.map(latin), OrderWording.date(row.createdAt, language: l.current)].compactMap { $0 }.joined(separator: " · "))
                        .font(.inter(12)).foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 6)
                StatusPill(label: l.t(statusKey), tone: .preparing)
            }
            details
            links
            DocumentReviewSection(applicationId: row.id, documents: $documents) { await changed() }
            if let version = row.agreementVersion {
                Text(l.t("admin.applicationAgreed", ["version": version]) + (version != Self.agreement ? " ⚠" : ""))
                    .font(.inter(12)).foregroundStyle(version != Self.agreement ? Brand.accentInk : Brand.muted)
            }
            commission
            if !missing.isEmpty {
                PortalNotice(text: l.t("admin.applicationMissing", ["fields": missing.map { l.t($0) }.joined(separator: l.current == .ar ? "، " : ", ")]), tone: .danger)
            }
            if row.documentsWaiting > 0 {
                PortalNotice(text: l.t("admin.applicationDocsWaiting", ["count": "\(row.documentsWaiting)"]), tone: .warning)
            }
            Divider()
            LabeledField(label: l.t("admin.applicationReason"), text: Binding(get: { reason }, set: { reason = String($0.prefix(400)) }))
            HStack(spacing: 8) {
                Button {
                    Task { await reject() }
                } label: { Label(l.t("admin.applicationReject"), systemImage: "xmark") }
                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    .disabled(deciding || reason.trimmingCharacters(in: .whitespaces).isEmpty)
                Spacer()
                Button {
                    Task { await approve() }
                } label: {
                    HStack(spacing: 6) {
                        if deciding { ProgressView().tint(.white) } else { Image(systemName: "checkmark") }
                        Text(l.t("admin.applicationApprove"))
                    }
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(deciding || !missing.isEmpty || row.documentsWaiting > 0)
            }
        }
    }

    private var statusKey: String {
        switch row.status {
        case "draft": return "admin.applicationStatusDraft"
        case "approved": return "admin.applicationStatusApproved"
        case "rejected": return "admin.applicationStatusRejected"
        default: return "admin.applicationStatusSubmitted"
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 6) {
            detail("sell.fieldEmail", row.contactEmail, latinValue: true)
            detail("sell.fieldPhone", row.contactPhone, latinValue: true)
            detail("sell.fieldGovernorate", row.governorate.map { ReferenceData.shared.governorate(id: $0)?.name(l.current) ?? $0 })
            detail("sell.fieldAddress", row.addressLine)
            detail("sell.fieldLicence", row.underPlatformLicence ? l.t("admin.underPlatformLicence") : row.licenceNumber, latinValue: !row.underPlatformLicence)
            detail("sell.fieldIban", row.payoutIban, latinValue: true)
        }
    }

    @ViewBuilder
    private func detail(_ label: String, _ value: String?, latinValue: Bool = false) -> some View {
        if let value, !value.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(l.t(label)).font(.inter(12, .semibold)).foregroundStyle(Brand.muted).frame(width: 110, alignment: .leading)
                Text(latinValue ? latin(value) : value).font(.inter(13)).foregroundStyle(Brand.ink).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// Papers given as links before uploads existed — web addresses only.
    @ViewBuilder
    private var links: some View {
        let licence = PendingApplication.webAddress(row.licenceDocUrl)
        let identity = PendingApplication.webAddress(row.identityDocUrl)
        if licence != nil || identity != nil {
            FlowLayout(spacing: 8) {
                Text(l.t("admin.applicationDocs")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                if let licence {
                    Link(destination: licence) { Label(l.t("admin.applicationLicenceDoc"), systemImage: "arrow.up.forward.square") }
                        .buttonStyle(PortalSmallButtonStyle())
                }
                if let identity {
                    Link(destination: identity) { Label(l.t("admin.applicationIdentityDoc"), systemImage: "arrow.up.forward.square") }
                        .buttonStyle(PortalSmallButtonStyle())
                }
            }
        }
    }

    private var commission: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(row.proposedCommissionPercent.map {
                l.t("admin.applicationProposed", ["rate": ApplicationModel.trimmedRate($0), "standard": Self.standard])
            } ?? row.proposedCommissionFixed.map {
                l.t("admin.applicationProposedFixed", ["amount": Money(fils: Money.parseFils($0) ?? 0).formatted(l.current), "standard": Self.standard])
            } ?? l.t("admin.applicationNoProposal", ["standard": Self.standard]))
            .font(.inter(13, .semibold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
            if let note = row.commissionNote, !note.isEmpty {
                Text("“\(note)”").font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .bottom, spacing: 8) {
                LabeledField(label: l.t("admin.applicationRate"), text: $rate, keyboard: .decimalPad, leftToRight: true)
                    .frame(maxWidth: 120)
                // A fixed amount per sale (3.3.2), beside the rate or instead of it.
                LabeledField(label: l.t("admin.applicationFixed"), text: $fixed, placeholder: "0.000", keyboard: .decimalPad, leftToRight: true)
                    .frame(maxWidth: 120)
            }
            if row.proposedCommissionPercent != nil || row.proposedCommissionFixed != nil {
                Button(l.t("admin.applicationUseProposed")) {
                    if let proposed = row.proposedCommissionPercent {
                        rate = ApplicationModel.trimmedRate(proposed)
                    } else {
                        rate = "0"
                        fixed = row.proposedCommissionFixed ?? ""
                    }
                }
                .buttonStyle(PortalSmallButtonStyle())
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
    }

    private func approve() async {
        deciding = true
        defer { deciding = false }
        let chosen = PhoneNumber.foldDigits(rate).trimmingCharacters(in: .whitespaces)
        let amount = PhoneNumber.foldDigits(fixed).trimmingCharacters(in: .whitespaces)
        if await app.attempt(done: "admin.applicationApproved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.approveApplication, .init(id: row.id, commissionPercent: chosen.isEmpty ? nil : chosen, commissionFixed: amount.isEmpty ? nil : amount))
        }) {
            await changed()
        }
    }

    private func reject() async {
        deciding = true
        defer { deciding = false }
        let why = reason.trimmingCharacters(in: .whitespaces)
        if await app.attempt(done: "admin.applicationRejected", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.rejectApplication, .init(id: row.id, reason: why))
        }) {
            await changed()
        }
    }
}

/// An application's papers, newest of each kind, for the reviewer to open,
/// accept or turn down with a reason the applicant reads.
private struct DocumentReviewSection: View {
    let applicationId: Int
    @Binding var documents: [ApplicationDocument]?
    let changed: () async -> Void
    @State private var rejecting: Int?
    @State private var note = ""
    @State private var busy = false
    @State private var opening: Int?
    @State private var preview: URL?
    @State private var choosingContract = false
    @State private var attaching = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(l.t("documents.title")).font(.inter(13, .bold)).foregroundStyle(Brand.ink)
                Spacer()
                /* NetLet's final contract (3.3.1), sent to the applicant to sign and upload. */
                Button { choosingContract = true } label: {
                    Label(l.t((documents ?? []).contains(where: { $0.kind == "contract" }) ? "documents.replaceContract" : "documents.attachContract"),
                          systemImage: attaching ? "hourglass" : "arrow.up.doc")
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(attaching)
            }
            if let documents {
                let kinds = (SiteContent.shared?.selling.documentKinds ?? []).filter { current($0, in: documents) != nil }
                if kinds.isEmpty {
                    Text(l.t("documents.noneUploaded")).font(.inter(13)).foregroundStyle(Brand.muted)
                } else {
                    ForEach(kinds, id: \.self) { kind in
                        if let entry = current(kind, in: documents) { row(kind, entry.latest, entry.replacing) }
                    }
                }
            } else {
                ProgressView().tint(Brand.navy)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
        .task { await load() }
        .quickLookPreview($preview)
        .fileImporter(isPresented: $choosingContract, allowedContentTypes: [.pdf, .jpeg, .png, .webP]) { result in
            guard case .success(let url) = result else { return }
            Task { await attach(url) }
        }
    }

    private func attach(_ url: URL) async {
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        attaching = true
        defer { attaching = false }
        if await app.attempt(done: "documents.contractAttached", fallback: "documents.failed", {
            _ = try await app.services.seller.attachContract(applicationId: applicationId, fileName: url.lastPathComponent, contentType: type, data: data)
        }) {
            await load()
        }
    }

    @ViewBuilder
    private func row(_ kind: String, _ latest: ApplicationDocument, _ replacing: ApplicationDocument?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(l.t(DocumentWords.label(kind))).font(.inter(13, .bold)).foregroundStyle(Brand.navy)
                Spacer()
                StatusPill(label: l.t(statusKey(latest.status)), tone: latest.status == "accepted" ? .done : latest.status == "rejected" ? .stopped : .preparing)
            }
            Button {
                Task { await open(latest) }
            } label: {
                HStack(spacing: 6) {
                    if opening == latest.id { ProgressView().tint(Brand.navy) } else { Image(systemName: "paperclip") }
                    Text(latest.fileName).lineLimit(1).truncationMode(.middle)
                    Text("· \(DocumentWords.size(latest.byteSize, l))").foregroundStyle(Brand.muted)
                }
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.navy)
                .frame(minHeight: 36)
            }
            .buttonStyle(.tap)
            .disabled(opening != nil)
            if let reviewNote = latest.reviewNote, !reviewNote.isEmpty {
                Text(l.t("documents.reviewerNote", ["note": reviewNote])).font(.inter(12)).foregroundStyle(Brand.body)
            }
            if let replacing {
                Button {
                    Task { await open(replacing) }
                } label: {
                    Text("\(l.t("documents.replacingAdmin")) \(replacing.fileName)").font(.inter(12)).foregroundStyle(Brand.muted).multilineTextAlignment(.leading)
                }
                .buttonStyle(.tap)
            }
            if latest.status == "pending" {
                if rejecting == latest.id {
                    LabeledField(label: l.t("documents.rejectReason"), text: Binding(get: { note }, set: { note = String($0.prefix(400)) }))
                    HStack(spacing: 8) {
                        Button(l.t("documents.reject")) { Task { await decide(latest, "reject") } }
                            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                            .disabled(busy || note.trimmingCharacters(in: .whitespaces).isEmpty)
                        Button(l.t("documents.keep")) {
                            rejecting = nil
                            note = ""
                        }
                        .buttonStyle(PortalSmallButtonStyle())
                    }
                } else {
                    HStack(spacing: 8) {
                        Button { Task { await decide(latest, "accept") } } label: { Label(l.t("documents.accept"), systemImage: "checkmark") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                            .accessibilityLabel("\(l.t("documents.accept")): \(l.t(DocumentWords.label(kind)))")
                        Button {
                            rejecting = latest.id
                            note = ""
                        } label: { Label(l.t("documents.reject"), systemImage: "xmark") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                            .accessibilityLabel("\(l.t("documents.reject")): \(l.t(DocumentWords.label(kind)))")
                    }
                    .disabled(busy)
                }
            }
            Divider()
        }
    }

    private func statusKey(_ status: String) -> String {
        status == "accepted" ? "documents.statusAccepted" : status == "rejected" ? "documents.statusRejected" : "documents.statusPending"
    }

    /// The newest file of each kind, and an accepted one it would replace (`currentByKind`).
    private func current(_ kind: String, in documents: [ApplicationDocument]) -> (latest: ApplicationDocument, replacing: ApplicationDocument?)? {
        let sorted = documents.filter { $0.kind == kind }.sorted { ($0.createdAt, $0.id) > ($1.createdAt, $1.id) }
        guard let latest = sorted.first else { return nil }
        let replacing = latest.status == "accepted" ? nil : sorted.dropFirst().first { $0.status == "accepted" }
        return (latest, replacing)
    }

    private func load() async {
        documents = (try? await app.services.api.call(API.reviewerDocuments, .init(applicationId: applicationId))) ?? documents ?? []
    }

    private func open(_ document: ApplicationDocument) async {
        opening = document.id
        defer { opening = nil }
        var file: URL?
        guard await app.attempt(fallback: "documents.failed", {
            file = try await app.services.seller.downloadDocument(id: document.id, fileName: document.fileName)
        }) else { return }
        preview = file
    }

    private func decide(_ document: ApplicationDocument, _ decision: String) async {
        busy = true
        defer { busy = false }
        let reason = note.trimmingCharacters(in: .whitespaces)
        var status: String?
        guard await app.attempt(fallback: "admin.saveFailed", {
            status = try await app.services.api.call(API.reviewDocument, .init(id: document.id, decision: decision, note: decision == "reject" ? reason : nil))
        }) else { return }
        app.toast(l.t(status == "accepted" ? "documents.accepted" : "documents.rejected"))
        rejecting = nil
        note = ""
        await load()
        await changed()
    }
}
