import PhotosUI
import QuickLook
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Opening a store — the web's `/sell`: the store's details, its papers and
/// their uploads, the standard commission with room to propose a lower one,
/// and the seller agreement. Saved as a draft at any point; sent for review
/// only once nothing an administrator needs is missing.
struct SellView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        InfoPage(title: l.t("sell.title"), note: l.t("sell.note")) {
            if app.session.isSignedIn {
                ModelHost(make: { ApplicationModel(api: app.services.api, seller: app.services.seller) }) { model in
                    ApplicationForm(model: model)
                        .task { await model.load() }
                }
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Text(l.t("sell.signInFirst")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    Button {
                        app.authPresented = true
                    } label: {
                        Label(l.t("sell.signIn"), systemImage: "storefront")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
                .card()
            }
        }
    }
}

@Observable
@MainActor
final class ApplicationModel {
    var storeName = ""
    var storeNameAr = ""
    var contactEmail = ""
    var contactPhone = ""
    var governorate = ""
    var addressLine = ""
    var licenceNumber = ""
    var licenceDocUrl = ""
    var identityDocUrl = ""
    var payoutIban = ""
    var underPlatformLicence = false
    var agreed = false
    var proposing = false
    /// A lower percentage, or a fixed amount per sale (3.3.2) — one or the other.
    var proposingFixed = false
    var proposedCommission = ""
    var proposedFixed = ""
    var commissionNote = ""

    private(set) var application: LoadState<StoreApplication?> = .idle
    private(set) var documents: [ApplicationDocument] = []
    private(set) var saving = false
    private(set) var uploading: String?
    let api: APICalling
    private let seller: SellerServicing
    private let rules = SiteContent.shared?.selling

    init(api: APICalling, seller: SellerServicing) {
        self.api = api
        self.seller = seller
    }

    var agreementVersion: String { rules?.agreementVersion ?? "" }
    var standardRate: String { rules.map { Self.trimmedRate($0.defaultCommission) } ?? "10" }

    /// The application's state: none, draft, submitted, more_needed (NetLet
    /// asked for more and handed it back), approved or rejected.
    var state: String { application.value??.status ?? "none" }
    var editable: Bool { ["none", "draft", "rejected", "more_needed"].contains(state) }
    /// The link boxes are only for an application that gave links before uploads existed.
    var linkedEarlier: (licence: Bool, identity: Bool) {
        (application.value??.licenceDocUrl?.isEmpty == false, application.value??.identityDocUrl?.isEmpty == false)
    }

    func load() async {
        if application.value == nil { application = .loading }
        do {
            let row = try await api.call(API.myApplication)
            application = .loaded(row)
            if let row { fill(row) }
            documents = row == nil ? [] : (try? await api.call(API.applicationDocuments)) ?? []
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, application.value == nil { application = .failed(failure) }
        }
    }

    private func fill(_ row: StoreApplication) {
        storeName = row.storeName
        storeNameAr = row.storeNameAr ?? ""
        contactEmail = row.contactEmail ?? ""
        contactPhone = row.contactPhone ?? ""
        governorate = row.governorate ?? ""
        addressLine = row.addressLine ?? ""
        licenceNumber = row.licenceNumber ?? ""
        licenceDocUrl = row.licenceDocUrl ?? ""
        identityDocUrl = row.identityDocUrl ?? ""
        payoutIban = row.payoutIban ?? ""
        underPlatformLicence = row.underPlatformLicence
        agreed = row.agreementVersion == agreementVersion
        proposing = row.proposedCommissionPercent != nil || row.proposedCommissionFixed != nil
        proposingFixed = row.proposedCommissionFixed != nil
        proposedCommission = row.proposedCommissionPercent.map(Self.trimmedRate) ?? ""
        proposedFixed = row.proposedCommissionFixed ?? ""
        commissionNote = row.commissionNote ?? ""
    }

    /// "8.50" as "8.5", "10.00" as "10" — the web's `String(Number(rate))`.
    nonisolated static func trimmedRate(_ rate: String) -> String {
        guard rate.contains(".") else { return rate }
        var text = rate
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        return text
    }

    /// What an administrator still needs, as the form's labels (`missingFromApplication`).
    var missing: [String] {
        func blank(_ value: String) -> Bool { value.trimmingCharacters(in: .whitespaces).isEmpty }
        var found: [String] = []
        if blank(contactEmail) { found.append("sell.fieldEmail") }
        if blank(contactPhone) { found.append("sell.fieldPhone") }
        if blank(governorate) { found.append("sell.fieldGovernorate") }
        if blank(addressLine) { found.append("sell.fieldAddress") }
        if blank(payoutIban) { found.append("sell.fieldIban") }
        if !underPlatformLicence && blank(licenceNumber) { found.append("sell.fieldLicence") }
        if !agreed { found.append("sell.fieldAgreement") }
        return found
    }

    /// Whether a proposed rate is a percentage below the standard one (`proposalProblem`).
    var proposalProblem: String? {
        guard proposing else { return nil }
        if proposingFixed {
            /* `fixedProposalProblem`: an amount in dinars, three decimals at most. */
            let fixed = proposedFixed.trimmingCharacters(in: .whitespaces)
            return fixed.isEmpty || fixed.range(of: #"^\d{1,9}(\.\d{1,3})?$"#, options: .regularExpression) != nil ? nil : "application.badCommission"
        }
        let value = proposedCommission.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty else { return nil }
        guard value.range(of: #"^\d{1,3}(\.\d{1,2})?$"#, options: .regularExpression) != nil, let rate = Double(value), rate <= 100 else {
            return "application.badCommission"
        }
        return rate >= (Double(rules?.defaultCommission ?? "10") ?? 10) ? "application.commissionNotLower" : nil
    }

    static func badLink(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && trimmed.range(of: #"^https?://\S+$"#, options: [.regularExpression, .caseInsensitive]) == nil
    }

    var linksOk: Bool { !Self.badLink(licenceDocUrl) && !Self.badLink(identityDocUrl) }

    private var payload: API.ApplicationInput {
        func value(_ text: String) -> String? {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        return API.ApplicationInput(
            storeName: storeName.trimmingCharacters(in: .whitespacesAndNewlines),
            storeNameAr: value(storeNameAr),
            contactEmail: value(contactEmail),
            contactPhone: value(contactPhone),
            governorate: governorate.isEmpty ? nil : governorate,
            addressLine: value(addressLine),
            licenceNumber: value(licenceNumber),
            licenceDocUrl: value(licenceDocUrl),
            identityDocUrl: value(identityDocUrl),
            payoutIban: value(payoutIban),
            underPlatformLicence: underPlatformLicence,
            agreementVersion: agreed ? agreementVersion : nil,
            proposedCommissionPercent: proposing && !proposingFixed ? value(proposedCommission) : nil,
            proposedCommissionFixed: proposing && proposingFixed ? value(PhoneNumber.foldDigits(proposedFixed)) : nil,
            commissionNote: proposing ? value(commissionNote) : nil
        )
    }

    func save() async throws {
        saving = true
        defer { saving = false }
        _ = try await api.call(API.saveApplication, payload)
        await load()
    }

    func submit() async throws {
        saving = true
        defer { saving = false }
        _ = try await api.call(API.saveApplication, payload)
        _ = try await api.call(API.submitApplication)
        await load()
    }

    func upload(kind: String, fileName: String, contentType: String, data: Data) async throws {
        guard let rules else { return }
        guard data.count <= rules.maxDocumentBytes else { throw APIError.server(code: "BAD_REQUEST", message: "documents.tooLarge", status: 413) }
        guard rules.documentTypes.contains(contentType) else { throw APIError.server(code: "BAD_REQUEST", message: "documents.notAccepted", status: 415) }
        uploading = kind
        defer { uploading = nil }
        _ = try await seller.uploadDocument(kind: kind, fileName: fileName, contentType: contentType, data: data)
        documents = (try? await api.call(API.applicationDocuments)) ?? documents
    }

    func remove(_ document: ApplicationDocument) async throws {
        _ = try await api.call(API.removeApplicationDocument, .init(id: document.id))
        documents = (try? await api.call(API.applicationDocuments)) ?? documents
    }

    /// The newest file of each kind, and an accepted one it would replace (`currentByKind`).
    func current(_ kind: String) -> (latest: ApplicationDocument, replacing: ApplicationDocument?)? {
        let sorted = documents.filter { $0.kind == kind }.sorted { ($0.createdAt, $0.id) > ($1.createdAt, $1.id) }
        guard let latest = sorted.first else { return nil }
        let replacing = latest.status == "accepted" ? nil : sorted.dropFirst().first(where: { $0.status == "accepted" })
        return (latest, replacing)
    }
}

private struct ApplicationForm: View {
    @Bindable var model: ApplicationModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        LoadStateView(state: model.application, retry: { await model.load() }) { _ in
            VStack(alignment: .leading, spacing: 16) {
                status
                Group {
                    section("sell.aboutStore") {
                        LabeledField(label: l.t("sell.fieldStoreName"), text: $model.storeName)
                        LabeledField(label: l.t("sell.fieldStoreNameAr"), text: $model.storeNameAr)
                        LabeledField(label: l.t("sell.fieldEmail"), text: $model.contactEmail, keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
                        LabeledField(label: l.t("sell.fieldPhone"), text: $model.contactPhone, placeholder: "+965", keyboard: .phonePad, content: .telephoneNumber, leftToRight: true)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(l.t("sell.fieldGovernorate")).font(.subheadline.weight(.semibold))
                            Menu {
                                ForEach(ReferenceData.shared.governorates) { governorate in
                                    Button(governorate.name(l.current)) {
                                        Haptics.tap()
                                        model.governorate = governorate.id
                                    }
                                }
                            } label: {
                                MenuField(text: ReferenceData.shared.governorate(id: model.governorate)?.name(l.current), placeholder: l.t("sell.choose"))
                            }
                            .accessibilityLabel(l.t("sell.fieldGovernorate"))
                        }
                        LabeledField(label: l.t("sell.fieldAddress"), text: $model.addressLine)
                    }
                    section("sell.papers") {
                        Toggle(isOn: $model.underPlatformLicence) {
                            Text(l.t("sell.underPlatformLicence")).font(.inter(14)).fixedSize(horizontal: false, vertical: true)
                        }
                        .tint(Brand.navy)
                        if !model.underPlatformLicence {
                            LabeledField(label: l.t("sell.fieldLicence"), text: $model.licenceNumber, leftToRight: true)
                        }
                        LabeledField(label: l.t("sell.fieldIban"), text: $model.payoutIban, leftToRight: true)
                        if model.linkedEarlier.licence {
                            LabeledField(label: l.t("sell.fieldLicenceDoc"), text: $model.licenceDocUrl, placeholder: "https://",
                                         problem: ApplicationModel.badLink(model.licenceDocUrl) ? "sell.badLink" : nil, keyboard: .URL, leftToRight: true)
                        }
                        if model.linkedEarlier.identity {
                            LabeledField(label: l.t("sell.fieldIdentityDoc"), text: $model.identityDocUrl, placeholder: "https://",
                                         problem: ApplicationModel.badLink(model.identityDocUrl) ? "sell.badLink" : nil, keyboard: .URL, leftToRight: true)
                        }
                    }
                    section("documents.title") {
                        Text(l.t("documents.note")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                        if model.application.value ?? nil == nil {
                            Text(l.t("documents.saveFirst")).font(.inter(13)).foregroundStyle(Brand.body)
                        } else {
                            // The papers applied with; the contract and its signed copy come after (3.3.1).
                            ForEach((SiteContent.shared?.selling.documentKinds ?? []).filter { $0 != "contract" && $0 != "signed_contract" }, id: \.self) { kind in
                                DocumentRow(kind: kind, model: model)
                            }
                        }
                    }
                    section("sell.commission") {
                        Text(l.t("sell.commissionStandard", ["rate": model.standardRate])).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                        Toggle(isOn: $model.proposing) {
                            Text(l.t("sell.commissionPropose")).font(.inter(14))
                        }
                        .tint(Brand.navy)
                        if model.proposing {
                            Picker(l.t("sell.commissionKind"), selection: $model.proposingFixed) {
                                Text(l.t("sell.commissionKindPercent")).tag(false)
                                Text(l.t("sell.commissionKindFixed")).tag(true)
                            }
                            .pickerStyle(.segmented)
                            if model.proposingFixed {
                                LabeledField(label: l.t("sell.commissionFixed"), text: $model.proposedFixed, placeholder: "0.000", keyboard: .decimalPad, leftToRight: true)
                            } else {
                                LabeledField(label: l.t("sell.commissionRate"), text: $model.proposedCommission, keyboard: .decimalPad, leftToRight: true)
                            }
                            LabeledField(label: l.t("sell.commissionWhy"), text: $model.commissionNote)
                            if let problem = model.proposalProblem {
                                Text(l.t(problem, ["rate": model.standardRate])).font(.footnote).foregroundStyle(Brand.danger)
                            }
                            Text(l.t("sell.commissionDecided")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    section("sell.agreement") {
                        Text(l.t("sell.agreementNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                        OnwardLink(symbol: "doc.text", title: l.t("sell.readAgreement")) { app.open(.legal(.sellers)) }
                        Toggle(isOn: $model.agreed) {
                            Text(l.t("sell.agreementAccept", ["version": model.agreementVersion])).font(.inter(14)).fixedSize(horizontal: false, vertical: true)
                        }
                        .tint(Brand.navy)
                    }
                }
                .disabled(!model.editable)
                /* Outside what stops the papers changing once NetLet has the
                   application: the signed contract is the one paper sent back then. */
                ContractStep(model: model)
                if model.editable { actions }
            }
        }
    }

    @ViewBuilder
    private var status: some View {
        switch model.state {
        case "submitted":
            Label(l.t("sell.waiting"), systemImage: "clock").font(.inter(14, .semibold)).foregroundStyle(Brand.navy).card()
        case "approved":
            VStack(alignment: .leading, spacing: 10) {
                Label(l.t("sell.approved"), systemImage: "checkmark.circle").font(.inter(14, .semibold)).foregroundStyle(Brand.success)
                Button(l.t("sell.openPortal")) { app.open(.portal("/admin")) }
                    .buttonStyle(PrimaryButtonStyle())
            }
            .card()
        case "rejected":
            Label(model.application.value??.rejectionReason ?? l.t("sell.rejected"), systemImage: "xmark.circle")
                .font(.inter(14, .semibold))
                .foregroundStyle(Brand.danger)
                .card()
        case "more_needed":
            // NetLet's note, in the reviewer's words, and what to do about it.
            VStack(alignment: .leading, spacing: 6) {
                Label(l.t("sell.moreNeeded"), systemImage: "doc.badge.plus").font(.inter(14, .semibold)).foregroundStyle(Brand.accentInk)
                if let note = model.application.value??.rejectionReason, !note.isEmpty {
                    Text(note).font(.inter(14)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
                }
                Text(l.t("sell.moreNeededHint")).font(.inter(13)).foregroundStyle(Brand.body)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        default:
            EmptyView()
        }
    }

    private var actions: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !model.missing.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(l.t("sell.stillNeeded")).font(.inter(13, .bold)).foregroundStyle(Brand.ink)
                    ForEach(model.missing, id: \.self) { key in
                        Text("· \(l.t(key))").font(.inter(13)).foregroundStyle(Brand.body)
                    }
                }
            }
            let named = !model.storeName.trimmingCharacters(in: .whitespaces).isEmpty
            Button {
                Task { await app.attempt(done: "sell.saved") { try await model.save() } }
            } label: {
                if model.saving { ProgressView().tint(Brand.navy) } else { Text(l.t("sell.save")) }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(!named || !model.linksOk || model.saving)
            Button {
                Task { await app.attempt(done: "sell.submitted") { try await model.submit() } }
            } label: {
                Text(l.t("sell.submit"))
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.missing.isEmpty || !named || !model.linksOk || model.saving || model.proposalProblem != nil)
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t(title)).font(.inter(17, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

/// One kind of paper: what it is, the file uploaded and the reviewer's
/// answer, and a file from Files or a photo of it to upload or replace.
private struct DocumentRow: View {
    let kind: String
    let model: ApplicationModel
    /// Whether a file can be added here; the papers follow the form, the signed contract its own rule.
    var mayUpload: Bool?
    @State private var importing = false
    @State private var photo: PhotosPickerItem?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let entry = model.current(kind)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t(DocumentWords.label(kind))).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
                    Text(l.t(DocumentWords.hint(kind))).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                if let latest = entry?.latest {
                    Text(l.t(latest.status == "accepted" ? "documents.statusAccepted" : latest.status == "rejected" ? "documents.statusRejected" : "documents.statusPending"))
                        .font(.inter(11, .bold))
                        .foregroundStyle(latest.status == "accepted" ? Brand.success : latest.status == "rejected" ? Brand.danger : Brand.navy)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(latest.status == "accepted" ? Brand.successFill : Brand.tint))
                }
            }
            if let latest = entry?.latest {
                Label("\(latest.fileName) · \(DocumentWords.size(latest.byteSize, l))", systemImage: "paperclip")
                    .font(.inter(12))
                    .foregroundStyle(Brand.body)
                if latest.status == "rejected", let note = latest.reviewNote {
                    Text(l.t("documents.reviewerNote", ["note": note])).font(.inter(12)).foregroundStyle(Brand.danger)
                }
                if let replacing = entry?.replacing {
                    Text(l.t("documents.replacing", ["name": replacing.fileName])).font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            if mayUpload ?? model.editable {
                HStack(spacing: 8) {
                    Menu {
                        Button(l.t("ios.documents.fromFiles")) { importing = true }
                        PhotosPicker(selection: $photo, matching: .images) {
                            Text(l.t("ios.documents.fromPhotos"))
                        }
                    } label: {
                        HStack(spacing: 6) {
                            if model.uploading == kind { ProgressView().tint(Brand.navy) } else { Image(systemName: "arrow.up.doc") }
                            Text(l.t(entry == nil ? "documents.upload" : "documents.replace"))
                        }
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(Capsule().fill(Brand.tint))
                    }
                    .disabled(model.uploading != nil)
                    .accessibilityLabel("\(l.t(entry == nil ? "documents.upload" : "documents.replace")): \(l.t(DocumentWords.label(kind)))")
                    if let latest = entry?.latest, latest.status != "accepted", model.editable {
                        Button(l.t("documents.remove")) {
                            Task { await app.attempt(done: "documents.removed") { try await model.remove(latest) } }
                        }
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.danger)
                        .frame(minHeight: 40)
                        .buttonStyle(.tap)
                    }
                }
            }
            Divider()
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png, .webP]) { result in
            guard case .success(let url) = result else { return }
            Task { await uploadFile(url) }
        }
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.85) ?? data
                    await send(name: "\(kind).jpg", type: "image/jpeg", data: jpeg)
                }
                photo = nil
            }
        }
    }

    private func uploadFile(_ url: URL) async {
        let opened = url.startAccessingSecurityScopedResource()
        defer { if opened { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        await send(name: url.lastPathComponent, type: type, data: data)
    }

    private func send(name: String, type: String, data: Data) async {
        await app.attempt(done: "documents.uploaded", fallback: "documents.failed") {
            try await model.upload(kind: kind, fileName: name, contentType: type, data: data)
        }
    }

}

/// The contract step (3.3.1): NetLet's final contract, to read, sign and send
/// back — while NetLet holds the application, too. Drawn only once NetLet has
/// attached one.
private struct ContractStep: View {
    let model: ApplicationModel
    @State private var preview: URL?
    @State private var opening = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if let contract = model.current("contract")?.latest {
            VStack(alignment: .leading, spacing: 10) {
                Text(l.t("documents.contractTitle")).font(.inter(17, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                Text(l.t("documents.contractNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { await open(contract) }
                } label: {
                    Label(contract.fileName, systemImage: opening ? "hourglass" : "paperclip").font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                }
                .buttonStyle(.tap)
                .disabled(opening)
                DocumentRow(kind: "signed_contract", model: model, mayUpload: model.current("signed_contract")?.latest.status != "accepted")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .quickLookPreview($preview)
        }
    }

    private func open(_ document: ApplicationDocument) async {
        opening = true
        defer { opening = false }
        var file: URL?
        if await app.attempt(fallback: "documents.failed", { file = try await app.services.seller.downloadDocument(id: document.id, fileName: document.fileName) }) {
            preview = file
        }
    }
}

/// A document kind's words and a file's size, shared by the applicant's
/// form and the administrator's review.
enum DocumentWords {
    static func label(_ kind: String) -> String {
        switch kind {
        case "trade_licence": return "documents.kindTradeLicence"
        case "signatory_id": return "documents.kindSignatoryId"
        case "iban_letter": return "documents.kindIbanLetter"
        case "authorisation": return "documents.kindAuthorisation"
        case "contract": return "documents.kindContract"
        case "signed_contract": return "documents.kindSignedContract"
        default: return "documents.kindOther"
        }
    }

    static func hint(_ kind: String) -> String {
        switch kind {
        case "trade_licence": return "documents.hintTradeLicence"
        case "signatory_id": return "documents.hintSignatoryId"
        case "iban_letter": return "documents.hintIbanLetter"
        case "authorisation": return "documents.hintAuthorisation"
        case "contract": return "documents.hintContract"
        case "signed_contract": return "documents.hintSignedContract"
        default: return "documents.hintOther"
        }
    }

    /// A file's size in words (`useFileSize`).
    @MainActor
    static func size(_ bytes: Int, _ l: LanguageSettings) -> String {
        if bytes >= 1_000_000 {
            return l.t("documents.sizeMb", ["size": String(format: "%.1f", Double(bytes) / 1_000_000)])
        }
        return l.t("documents.sizeKb", ["size": "\(max(1, Int((Double(bytes) / 1000).rounded())))"])
    }
}
