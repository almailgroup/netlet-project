import SwiftUI
import UniformTypeIdentifiers

/// A product's catalogues in its editor — the web's `CatalogueEditor`, for the
/// store's managers and owner and for NetLet: the PDFs under the product,
/// where each stands (on the product page, waiting for NetLet, or turned down
/// with NetLet's reason), and a form to add one.
///
/// **A file over 5 MB is made smaller on the phone first** (`CataloguePDF.shrink`,
/// PDFKit storing its pictures again at a screen's size), and the form says
/// what it came to; one still too large is refused with its size before a
/// byte is sent. Then it goes up in parts, the button saying how far along.
/// The server decides where it lands, and the section says so before the
/// press from the editor's own answer.
struct CatalogueEditorSection: View {
    let productId: Int
    @State private var editor: CatalogueEditor?
    @State private var failed: APIError?
    @State private var removing: CatalogueRow?
    @State private var busy = false
    /* The form. */
    @State private var title = ""
    @State private var titleAr = ""
    @State private var chosen: (name: String, data: Data)?
    @State private var tried = false
    @State private var fileProblem: String?
    @State private var importing = false
    @State private var stage: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: CatalogueRules { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("catalogue.editorIntro", ["count": "\(rules.perProduct)"]))
                .font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if let editor {
                if editor.ready {
                    listed(editor)
                } else {
                    PortalNotice(text: l.t("catalogue.unavailable"))
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .task(id: productId) { await load() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf]) { result in
            guard case .success(let url) = result else { return }
            read(url)
        }
        .alert(l.t("catalogue.removeTitle"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button(l.t("catalogue.removeConfirm"), role: .destructive) {
                if let row = removing { Task { await remove(row) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { removing = nil }
        } message: {
            Text(l.t("catalogue.removeBody", ["name": removing.map { OrderWording.isolated($0.card.name(l.current)) } ?? ""]))
        }
    }

    // MARK: The list

    @ViewBuilder
    private func listed(_ editor: CatalogueEditor) -> some View {
        Text(l.t(editor.goesLive ? "catalogue.goesLive" : "catalogue.waitsForReview"))
            .font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
        if editor.items.isEmpty {
            Text(l.t("catalogue.none")).font(.inter(13)).foregroundStyle(Brand.muted)
        }
        ForEach(editor.items) { row in
            Divider()
            item(row)
        }
        Divider()
        if editor.room > 0 {
            form
        } else {
            PortalNotice(text: l.t("catalogue.full", ["count": "\(rules.perProduct)"]))
        }
    }

    private func item(_ row: CatalogueRow) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            CatalogueIdentity(card: row.card, detail: details(row))
            FlowLayout(spacing: 6) {
                StatusPill(label: l.t(statusKey(row.status)), tone: row.status == "live" ? .done : row.status == "pending" ? .preparing : .stopped)
            }
            if row.status == "declined", let note = row.reviewNote {
                Text(l.t("catalogue.declinedNote", ["note": OrderWording.isolated(note)]))
                    .font(.inter(13))
                    .foregroundStyle(Brand.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.danger.opacity(0.08)))
            }
            CatalogueActions(card: row.card)
            Button {
                removing = row
            } label: {
                Label(l.t("catalogue.remove"), systemImage: "trash")
            }
            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
            .disabled(busy)
            .accessibilityLabel(l.t("catalogue.removeName", ["name": row.card.name(l.current)]))
        }
    }

    private func statusKey(_ status: String) -> String {
        switch status {
        case "live": return "catalogue.statusLive"
        case "pending": return "catalogue.statusPending"
        default: return "catalogue.statusDeclined"
        }
    }

    private func details(_ row: CatalogueRow) -> String {
        var parts = [OrderWording.isolated(row.fileName), DocumentWords.size(row.sizeBytes, l), OrderWording.date(row.createdAt, language: l.current)]
        if row.byNetlet { parts.append(l.t("catalogue.byNetlet")) }
        return parts.joined(separator: " · ")
    }

    // MARK: Adding one

    @ViewBuilder
    private var form: some View {
        Text(l.t("catalogue.fileLabel")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
        Button {
            importing = true
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
        .buttonStyle(.tap)
        .disabled(busy)
        .accessibilityLabel("\(l.t("catalogue.fileLabel")): \(l.t("storeDocs.chooseFile"))")
        if let chosen {
            Text("\(OrderWording.isolated(chosen.name)) · \(DocumentWords.size(chosen.data.count, l))")
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.navy)
                .fixedSize(horizontal: false, vertical: true)
        }
        if let fileProblem {
            problemLine(fileProblem)
        } else if tried && chosen == nil {
            problemLine(l.t("catalogue.chooseFirst"))
        } else {
            Text(l.t("catalogue.fileHint")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        }
        LabeledField(label: l.t("catalogue.titleLabel"), text: Binding(get: { title }, set: { title = String($0.prefix(rules.titleMax)) }),
                     hint: l.t("catalogue.titleHint"), problem: titleProblem(title))
        LabeledField(label: l.t("catalogue.titleArLabel"), text: Binding(get: { titleAr }, set: { titleAr = String($0.prefix(rules.titleMax)) }),
                     problem: titleProblem(titleAr))
        HStack(spacing: 10) {
            Button {
                Task { await upload() }
            } label: {
                HStack(spacing: 6) {
                    if busy { ProgressView().tint(.white) } else { Image(systemName: "arrow.up.doc") }
                    Text(l.t("catalogue.upload"))
                }
            }
            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
            .disabled(busy)
            if let stage {
                Text(stage).font(.inter(12)).foregroundStyle(Brand.muted).accessibilityAddTraits(.updatesFrequently)
            }
        }
    }

    /// A title a shopper will read carries no phone number, email or link — said once Upload has been pressed.
    private func titleProblem(_ text: String) -> String? {
        tried && !ContactFilter.findings(text).isEmpty ? l.t("catalogue.offPlatform") : nil
    }

    private func problemLine(_ text: String) -> some View {
        Label(text, systemImage: "exclamationmark.circle")
            .font(.inter(12, .semibold))
            .foregroundStyle(Brand.danger)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// A file from Files: a PDF by its own first bytes, said as it is chosen.
    private func read(_ url: URL) {
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            chosen = nil
            fileProblem = l.t("catalogue.failed")
            return
        }
        if data.isEmpty {
            chosen = nil
            fileProblem = l.t("catalogue.empty")
        } else if !CataloguePDF.isPDF(data) {
            chosen = nil
            fileProblem = l.t("catalogue.notPdf")
        } else {
            chosen = (url.lastPathComponent, data)
            fileProblem = nil
        }
    }

    // MARK: Server

    private func load() async {
        do {
            editor = try await app.services.api.call(API.catalogueEditor, .init(productId: productId))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, editor == nil { failed = failure }
        }
    }

    private func upload() async {
        tried = true
        let named = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let namedAr = titleAr.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let chosen, ContactFilter.findings(named).isEmpty, ContactFilter.findings(namedAr).isEmpty else { return }
        busy = true
        defer {
            busy = false
            stage = nil
        }
        var data = chosen.data
        if data.count > rules.maxBytes {
            stage = l.t("catalogue.shrinking")
            let smaller = await CataloguePDF.shrink(data)
            guard let smaller, smaller.count <= rules.maxBytes else {
                fileProblem = l.t("catalogue.stillTooLarge", ["size": DocumentWords.size(min(smaller?.count ?? data.count, data.count), l)])
                Haptics.refused()
                return
            }
            app.toast(l.t("catalogue.shrunk", ["from": DocumentWords.size(data.count, l), "to": DocumentWords.size(smaller.count, l)]))
            data = smaller
        }
        stage = l.t("catalogue.uploading", ["percent": "0"])
        let request = CatalogueUpload(fileName: chosen.name, title: named.isEmpty ? nil : named, titleAr: namedAr.isEmpty ? nil : namedAr, data: data)
        var settled: CatalogueProgress?
        let language = l
        guard await app.attempt(fallback: "catalogue.failed", {
            settled = try await app.services.seller.uploadCatalogue(productId: productId, upload: request) { share in
                stage = language.t("catalogue.uploading", ["percent": "\(Int((share * 100).rounded()))"])
            }
        }) else { return }
        app.toast(l.t(settled?.status == "live" ? "catalogue.uploadedLive" : "catalogue.uploadedPending"))
        self.chosen = nil
        title = ""
        titleAr = ""
        tried = false
        fileProblem = nil
        await load()
    }

    private func remove(_ row: CatalogueRow) async {
        removing = nil
        busy = true
        defer { busy = false }
        _ = await app.attempt(done: "catalogue.removed", fallback: "admin.saveFailed") {
            _ = try await app.services.api.call(API.removeCatalogue, .init(id: row.id))
        }
        /* Read again either way: a refusal may mean somebody else already removed it. */
        await load()
    }
}

/// The catalogues stores put under their products, waiting for NetLet to look
/// at them — the web review queue's own section: each opened in Quick Look,
/// then approved onto the product page or turned down with a reason the store
/// reads under it in the product's editor. Drawn only while something waits.
struct CataloguesWaitingSection: View {
    @State private var rows: [WaitingCatalogue] = []
    @State private var notes: [Int: String] = [:]
    @State private var deciding: Int?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        // A VStack, not a Group: a `.task` on a Group with nothing in it never runs.
        VStack(alignment: .leading, spacing: 12) {
            if !rows.isEmpty {
                Text(l.t("catalogue.waitingHeading")).font(.inter(18, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                Text(l.t("catalogue.waitingIntro")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                ForEach(rows) { row in
                    card(row)
                }
            }
        }
        .padding(.top, rows.isEmpty ? 0 : 16)
        .task { await load() }
    }

    private func card(_ row: WaitingCatalogue) -> some View {
        PortalCard {
            CatalogueIdentity(card: row.card, detail: [
                l.t("catalogue.forProduct", ["product": OrderWording.isolated(row.productTitle), "store": OrderWording.isolated(row.store)]),
                OrderWording.isolated(row.fileName),
                DocumentWords.size(row.sizeBytes, l),
                OrderWording.date(row.createdAt, language: l.current),
            ].joined(separator: " · "))
            CatalogueActions(card: row.card)
            LabeledField(label: l.t("catalogue.noteLabel"),
                         text: Binding(get: { notes[row.id] ?? "" }, set: { notes[row.id] = String($0.prefix(CatalogueRules.shared.noteMax)) }),
                         hint: l.t("catalogue.declineBody"), axis: .vertical)
            HStack(spacing: 8) {
                Button {
                    Task { await decide(row, approve: false) }
                } label: {
                    Label(l.t("catalogue.decline"), systemImage: "arrow.uturn.backward")
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(deciding != nil || (notes[row.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button {
                    Task { await decide(row, approve: true) }
                } label: {
                    HStack(spacing: 6) {
                        if deciding == row.id { ProgressView().tint(.white) } else { Image(systemName: "checkmark") }
                        Text(l.t("catalogue.approve"))
                    }
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(deciding != nil)
            }
        }
    }

    private func load() async {
        rows = (try? await app.services.api.call(API.waitingCatalogues)) ?? []
    }

    private func decide(_ row: WaitingCatalogue, approve: Bool) async {
        deciding = row.id
        defer { deciding = nil }
        let note = (notes[row.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var answer: API.CatalogueDecided?
        guard await app.attempt(fallback: "admin.saveFailed", {
            answer = try await app.services.api.call(API.decideCatalogue, .init(id: row.id, approve: approve, note: approve || note.isEmpty ? nil : note))
        }) else {
            await load()
            return
        }
        app.toast(l.t(answer?.status == "live" ? "catalogue.approved" : "catalogue.declined"))
        notes[row.id] = nil
        await load()
    }
}
