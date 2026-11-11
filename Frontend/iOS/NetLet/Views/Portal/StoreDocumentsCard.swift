import PhotosUI
import QuickLook
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// A store's documents — the web's `StoreDocuments`, on the owner's word
/// ("for the vendors there should be a section that will allow to upload
/// documents for the vendor. Store documents"): on a store's page for
/// NetLet's people, and on the store's own "Store documents" page for its
/// owner. The papers kept with the store, each with what it is, when it was
/// added and by whom and where its last day stands; a press opens one, and
/// the form under them adds one.
///
/// **The server decides every button**: a row says whether this person may
/// remove it, and the list whether they are NetLet, who may also keep a file
/// from the store. A file is checked against the shared rule before it is
/// sent, and the route refuses the same file besides.
struct StoreDocumentsCard: View {
    enum Audience { case netlet, store }

    let vendorId: Int
    /// NetLet's view of a store, one card among its sections, or the store's
    /// own page, whose heading already names it. Words only.
    let audience: Audience

    @State private var list: StoreDocumentList?
    @State private var failed: APIError?
    @State private var removing: StoreDocument?
    @State private var opening: Int?
    @State private var preview: URL?
    @State private var busy = false
    /* The form. */
    @State private var kind = ""
    @State private var title = ""
    @State private var expires: Date?
    @State private var chosen: ChosenFile?
    @State private var onlyNetLet = false
    @State private var tried = false
    @State private var fileProblem: String?
    @State private var importing = false
    @State private var photo: PhotosPickerItem?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private struct ChosenFile {
        let name: String
        let type: String
        let data: Data
    }

    private var rules: StoreDocumentRules { .shared }

    var body: some View {
        PortalCard {
            if audience == .netlet {
                Text(l.t("storeDocs.title")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                Text(l.t("storeDocs.noteAdmin")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            if let list {
                if list.ready {
                    listed(list)
                } else {
                    PortalNotice(text: l.t("storeDocs.unavailable"))
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .task { await load() }
        .quickLookPreview($preview)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png, .webP]) { result in
            guard case .success(let url) = result else { return }
            readFile(url)
        }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task {
                await readPhoto(item)
                photo = nil
            }
        }
        .alert(l.t("storeDocs.removeTitle"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button(l.t("documents.remove"), role: .destructive) {
                if let document = removing { Task { await remove(document) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { removing = nil }
        } message: {
            Text(l.t("storeDocs.removeBody", ["name": removing.map(name) ?? ""]))
        }
    }

    // MARK: The list

    @ViewBuilder
    private func listed(_ list: StoreDocumentList) -> some View {
        if list.documents.contains(where: \.needsAttention) {
            PortalNotice(text: l.t("storeDocs.attention"), tone: .warning)
        }
        if list.documents.isEmpty {
            Text(l.t("storeDocs.none")).font(.inter(13)).foregroundStyle(Brand.muted)
        }
        ForEach(list.documents) { document in
            if document.id != list.documents.first?.id { Divider() }
            row(document)
        }
        Divider()
        if list.room > 0 {
            form(netlet: list.netlet)
        } else {
            PortalNotice(text: l.t("storeDocs.tooManyFiles"))
        }
    }

    private func row(_ document: StoreDocument) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: document.contentType == "application/pdf" ? "doc.text" : "photo")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 38, height: 38)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(name(document)).font(.inter(14, .bold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                    Text(details(document)).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            if document.expiry.kind != "none" || document.netletOnly {
                FlowLayout(spacing: 6) {
                    if let pill = expiryPill(document) { StatusPill(label: pill.label, tone: pill.tone) }
                    if document.netletOnly { StatusPill(label: l.t("storeDocs.netletOnly"), tone: .shipped, systemImage: "lock") }
                }
            }
            HStack(spacing: 8) {
                Button {
                    Task { await open(document) }
                } label: {
                    HStack(spacing: 6) {
                        if opening == document.id { ProgressView().tint(Brand.navy) } else { Image(systemName: "arrow.down.doc") }
                        Text(l.t("storeDocs.download"))
                    }
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(opening != nil)
                .accessibilityLabel(l.t("storeDocs.downloadNamed", ["name": name(document)]))
                if document.mayRemove {
                    Button {
                        removing = document
                    } label: {
                        Label(l.t("documents.remove"), systemImage: "trash")
                    }
                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    .disabled(busy)
                    .accessibilityLabel(l.t("storeDocs.removeNamed", ["name": name(document)]))
                }
            }
        }
    }

    /// What a paper is called: the name somebody gave it, or its kind.
    private func name(_ document: StoreDocument) -> String {
        document.title ?? l.t(rules.label(document.kind))
    }

    private func details(_ document: StoreDocument) -> String {
        var parts: [String] = []
        if document.title != nil { parts.append(l.t(rules.label(document.kind))) }
        /* A file's name takes its own direction, wherever it lands in the line. */
        parts.append(OrderWording.isolated(document.fileName))
        parts.append(DocumentWords.size(document.byteSize, l))
        parts.append(OrderWording.date(document.createdAt, language: l.current))
        if document.by == "netlet" {
            parts.append(l.t("storeDocs.byNetLet"))
        } else if let who = document.uploader {
            parts.append(l.t("storeDocs.byPerson", ["name": OrderWording.isolated(who)]))
        } else if document.by == "store" {
            parts.append(l.t("storeDocs.byStore"))
        }
        return parts.joined(separator: " · ")
    }

    /// Where the paper's last day stands, as the server worked it out on
    /// Kuwait's calendar: gone, close, or still good.
    private func expiryPill(_ document: StoreDocument) -> (label: String, tone: OrderTone)? {
        guard let day = document.expiresOn else { return nil }
        let date = OrderWording.day(day, language: l.current)
        switch document.expiry.kind {
        case "expired":
            return (l.t("storeDocs.expired", ["date": date]), .stopped)
        case "soon":
            let days = document.expiry.days ?? 0
            return (days == 0 ? l.t("storeDocs.expiresToday") : l.t("storeDocs.expiresIn", ["count": "\(days)"]), .preparing)
        case "valid":
            return (l.t("storeDocs.validUntil", ["date": date]), .waiting)
        default:
            return nil
        }
    }

    // MARK: Adding one

    /// What kind of paper, a name, its last day, the file and — for NetLet —
    /// whether the store sees it. What is wrong is said under its box when
    /// Upload is pressed and leaves with the fix; a file that cannot be taken
    /// is said as it is chosen, being the answer to that press.
    @ViewBuilder
    private func form(netlet: Bool) -> some View {
        Text(l.t("storeDocs.add")).font(.inter(14, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
        ChoiceField(label: l.t("storeDocs.kind"), current: kind, placeholder: l.t("storeDocs.kindPlaceholder"),
                    options: rules.kinds.map { ($0.kind, l.t($0.label)) }) { kind = $0 ?? "" }
        if tried && kind.isEmpty { problemLine(l.t("storeDocs.chooseKind")) }
        LabeledField(label: l.t("storeDocs.name"), text: Binding(get: { title }, set: { title = String($0.prefix(rules.titleMax)) }), hint: l.t("storeDocs.nameHint"))
        Toggle(l.t("storeDocs.expires"), isOn: Binding(get: { expires != nil }, set: { expires = $0 ? (expires ?? Date()) : nil }))
            .font(.inter(14, .semibold))
            .tint(Brand.navy)
        if let day = expires {
            DatePicker(l.t("storeDocs.expires"), selection: Binding(get: { day }, set: { expires = $0 }), displayedComponents: .date)
                .labelsHidden()
                .kuwaitDays()
        }
        Text(l.t("storeDocs.expiresHint")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        filePicker
        if netlet {
            Toggle(isOn: $onlyNetLet) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t("storeDocs.onlyNetLet")).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                    Text(l.t("storeDocs.onlyNetLetHint")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Brand.navy)
        }
        Button {
            Task { await upload() }
        } label: {
            HStack(spacing: 6) {
                if busy { ProgressView().tint(.white) } else { Image(systemName: "arrow.up.doc") }
                Text(l.t(busy ? "storeDocs.uploading" : "storeDocs.upload"))
            }
        }
        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
        .disabled(busy)
    }

    @ViewBuilder
    private var filePicker: some View {
        Text(l.t("storeDocs.file")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
        Menu {
            Button(l.t("ios.documents.fromFiles")) { importing = true }
            PhotosPicker(selection: $photo, matching: .images) {
                Text(l.t("ios.documents.fromPhotos"))
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "paperclip")
                Text(l.t("storeDocs.chooseFile"))
            }
            .font(.inter(13, .bold))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .background(Capsule().fill(Brand.tint))
        }
        .disabled(busy)
        .accessibilityLabel("\(l.t("storeDocs.file")): \(l.t("storeDocs.chooseFile"))")
        if let chosen {
            Text("\(OrderWording.isolated(chosen.name)) · \(DocumentWords.size(chosen.data.count, l))")
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.navy)
                .fixedSize(horizontal: false, vertical: true)
        }
        if let fileProblem {
            problemLine(l.t(fileProblem))
        } else if tried && chosen == nil {
            problemLine(l.t("storeDocs.needFile"))
        } else {
            Text(l.t("storeDocs.fileHint")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func problemLine(_ text: String) -> some View {
        Label(text, systemImage: "exclamationmark.circle")
            .font(.inter(12, .semibold))
            .foregroundStyle(Brand.danger)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// The shared rule, asked before a file is kept for sending: its size
    /// and its type (`documentProblem`, less the bytes the server reads).
    private func take(name: String, type: String, data: Data) {
        let selling = SiteContent.shared?.selling
        if data.isEmpty {
            chosen = nil
            fileProblem = "documents.empty"
        } else if data.count > (selling?.maxDocumentBytes ?? 4_000_000) {
            chosen = nil
            fileProblem = "documents.tooLarge"
        } else if !(selling?.documentTypes ?? ["application/pdf", "image/jpeg", "image/png", "image/webp"]).contains(type) {
            chosen = nil
            fileProblem = "documents.notAccepted"
        } else {
            chosen = ChosenFile(name: name, type: type, data: data)
            fileProblem = nil
        }
    }

    private func readFile(_ url: URL) {
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            chosen = nil
            fileProblem = "documents.failed"
            return
        }
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        take(name: url.lastPathComponent, type: type, data: data)
    }

    /// A photo from the library, shrunk and re-encoded off the main thread
    /// as every library photo is, so a twelve-megapixel scan fits.
    private func readPhoto(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self),
              let jpeg = try? await ImagePreparation.jpegOffMain(from: data, rules: ReferenceData.shared.rules.media) else {
            chosen = nil
            fileProblem = "documents.notAccepted"
            return
        }
        take(name: "photo.jpg", type: "image/jpeg", data: jpeg)
    }

    // MARK: Server

    private func load() async {
        do {
            list = try await app.services.api.call(API.storeDocuments, .init(vendorId: vendorId))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, list == nil { failed = failure }
        }
    }

    private func upload() async {
        tried = true
        guard !kind.isEmpty, let chosen else { return }
        busy = true
        defer { busy = false }
        let named = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let request = StoreDocumentUpload(kind: kind, title: named.isEmpty ? nil : named, expiresOn: expires.map(StoreRules.kuwaitDay),
                                          netletOnly: onlyNetLet, fileName: chosen.name, contentType: chosen.type, data: chosen.data)
        guard await app.attempt(done: "storeDocs.uploaded", fallback: "documents.failed", {
            _ = try await app.services.seller.uploadStoreDocument(vendorId: vendorId, upload: request)
        }) else { return }
        kind = ""
        title = ""
        expires = nil
        self.chosen = nil
        onlyNetLet = false
        tried = false
        fileProblem = nil
        await load()
    }

    private func open(_ document: StoreDocument) async {
        opening = document.id
        defer { opening = nil }
        var file: URL?
        guard await app.attempt(fallback: "documents.failed", {
            file = try await app.services.seller.downloadStoreDocument(id: document.id, fileName: document.fileName)
        }) else { return }
        preview = file
    }

    private func remove(_ document: StoreDocument) async {
        removing = nil
        busy = true
        defer { busy = false }
        _ = await app.attempt(done: "storeDocs.removed", fallback: "admin.saveFailed") {
            _ = try await app.services.api.call(API.removeStoreDocument, .init(id: document.id))
        }
        /* Read again either way: a refusal may mean somebody else already removed it. */
        await load()
    }
}

/// A store's own documents, for its owner — the web's `/admin/store-documents`.
/// An administrator belongs to no store: each store's documents are a section
/// of its own page, which is what this says, the Team page's rule.
struct PortalStoreDocumentsView: View {
    @State private var round = 0
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let vendorId = app.session.seller?.ownVendor
        PortalScreen(title: l.t("storeDocs.title"), intro: vendorId == nil ? nil : l.t("storeDocs.noteStore"), refresh: { round += 1 }) {
            if let vendorId {
                /* Made afresh on a pull, so the card reads its list again. */
                StoreDocumentsCard(vendorId: vendorId, audience: .store).id(round)
            } else {
                Text(l.t("storeDocs.adminNote")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true).card(padding: 14)
            }
        }
    }
}
