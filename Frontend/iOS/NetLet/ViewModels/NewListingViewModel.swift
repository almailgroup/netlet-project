import Foundation
import Observation
import UIKit

/// Adding a product — the web's `/admin/products/new`: what a shopper decides
/// on (name in both languages, price, photos, description, department) and,
/// beside it, what the web form also asks — the store for an administrator,
/// a was-price, the SKU, the Arabic description, tags and the department's
/// specification rows, with a model's draft to start from where one can be
/// had.
///
/// The product, its first variant, the opening count and the gallery are one
/// transaction on the server, so Create is one outcome and leaving is none.
/// Publishing is its own act after it: a store whose listings are checked
/// first gets "In review", and the toast says so.
@Observable
@MainActor
final class NewListingViewModel {
    struct Photo: Identifiable, Equatable {
        let id = UUID()
        /// The prepared JPEG of a photo from the library; nil for one added by its address.
        var preview: Data?
        var uploaded: UploadedPhoto?
        /// A photo added by its web address, which nothing uploads.
        var link: String?
        var failure: String?

        var url: String? { uploaded?.url ?? link }
        var pending: Bool { uploaded == nil && link == nil && failure == nil }
    }

    /// A specification row by the department's own key.
    struct Spec: Identifiable, Equatable {
        let key: String
        var value: String

        var id: String { key }
    }

    /// Where Create left the product, for the editor to open on.
    struct Created: Equatable {
        let id: Int
        let message: String
    }

    enum GeneratorState: Equatable {
        case idle, working, done(CatalogDraft), failed(String)
    }

    var draft = Validation.ListingDraft()
    var categoryId: Int?
    var descriptionAr = ""
    var tags = ""
    var specs: [Spec] = []
    var photoLink = ""
    private(set) var photoLinkProblem: String?
    /// The store an administrator chose; a store's own people act for theirs.
    var chosenVendor: Int?
    private(set) var categories: LoadState<[Category]> = .idle
    private(set) var stores: [StoreListRow] = []
    private(set) var ownStore: OwnStore?
    private(set) var photos: [Photo] = []
    private(set) var submitted = false
    private(set) var creating: String?
    private(set) var refusal: String?
    private(set) var serverProblems: [Validation.ListingField: String] = [:]
    private(set) var arabicDraftOn = false
    private(set) var draftingArabic = false
    var notes = ""
    private(set) var generator: GeneratorState = .idle
    private(set) var needInput = false

    private let service: SellerServicing
    private let api: APICalling
    let seller: SellerIdentity?
    private let rules: Rules
    @ObservationIgnored private var gateway: (vendorId: Int, gateway: AIGateway)?
    @ObservationIgnored private var generating: Task<Void, Never>?

    init(service: SellerServicing, api: APICalling, seller: SellerIdentity?, vendorId: Int? = nil, rules: Rules = ReferenceData.shared.rules) {
        self.service = service
        self.api = api
        self.seller = seller
        self.rules = rules
        chosenVendor = vendorId
    }

    var isAdmin: Bool { seller?.kind == "admin" }

    func load() async {
        guard categories.value == nil else { return }
        categories = .loading
        do {
            categories = .loaded(try await service.categories())
        } catch {
            categories = .failed(APIError.from(error))
        }
        if isAdmin {
            stores = (try? await api.call(API.storeList, .init(pageSize: 200)))?.rows ?? []
        } else {
            ownStore = (try? await api.call(API.myStore)) ?? nil
        }
        arabicDraftOn = (try? await api.call(API.arabicDraftAvailable)) ?? false
    }

    // MARK: The store

    /// The store the product is created in: a store's own, or the one an
    /// administrator chose, else the first on the list.
    var vendorId: Int? {
        guard let seller else { return nil }
        if seller.kind == "vendor" { return seller.vendorId }
        if let chosenVendor, stores.contains(where: { $0.id == chosenVendor }) { return chosenVendor }
        return stores.first?.id ?? chosenVendor
    }

    var vendorName: String? {
        if seller?.kind == "vendor" { return ownStore?.name }
        return stores.first { $0.id == vendorId }?.name
    }

    var mayPublish: Bool {
        guard let seller, let vendorId else { return false }
        return seller.can("product.publish", vendorId: vendorId)
    }

    var publishGoesToReview: Bool { seller?.kind == "vendor" && ownStore?.autoPublish == false }

    /// An administrator with no store to put a product in.
    var noStore: Bool { isAdmin && categories.value != nil && stores.isEmpty }

    // MARK: Rules

    var departmentSlug: String? {
        categories.value?.first(where: { $0.id == categoryId })?.slug
    }

    var needsWarranty: Bool {
        departmentSlug.map { rules.listing.warrantyRequiredDepartments.contains($0) } ?? false
    }

    var problems: [Validation.ListingField: String] {
        Validation.listingProblems(draft, departmentSlug: departmentSlug, rules: rules.listing).merging(serverProblems) { _, server in server }
    }

    /// Said once Create has been pressed, never before somebody reaches the box.
    func problem(_ field: Validation.ListingField) -> String? {
        submitted || serverProblems[field] != nil ? problems[field] : nil
    }

    /// What is wrong, in the form's order.
    var wrong: [Validation.ListingField] { Validation.ListingField.allCases.filter { problems[$0] != nil } }

    /// The rows shown: only the ones the chosen department asks for.
    var shownSpecs: [Spec] {
        let known = Set(ListingRules.shared.fields(departmentSlug).map(\.key))
        return specs.filter { known.contains($0.key) }
    }

    func edit(_ field: Validation.ListingField) {
        serverProblems[field] = nil
    }

    var uploading: Bool { photos.contains(where: \.pending) }
    var canAddPhoto: Bool { photos.count < rules.listing.maxPhotos }

    // MARK: Photos

    /// A photo chosen from the library: made ready on the phone, then uploaded
    /// at once, so Create only has to name the addresses.
    func addPhoto(_ data: Data) async {
        guard canAddPhoto else { return }
        var photo = Photo(preview: data)
        do {
            photo.preview = try ImagePreparation.jpeg(from: data, rules: rules.media)
        } catch ImagePreparation.Problem.tooSmall {
            photo.failure = "media.tooSmall"
        } catch {
            photo.failure = "media.notAnImage"
        }
        photos.append(photo)
        guard photo.failure == nil, let jpeg = photo.preview else { return }
        let id = photo.id
        do {
            let uploaded = try await service.upload(jpeg: jpeg)
            update(id) { $0.uploaded = uploaded }
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            update(id) { $0.failure = key }
        }
    }

    /// A photo by its web address (`photoUrlProblem`): the gallery's own rule.
    func addLink() {
        let value = photoLink.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, value.range(of: "^https?://\\S+$", options: [.regularExpression, .caseInsensitive]) != nil else {
            photoLinkProblem = "admin.newPhotoUrl"
            return
        }
        photoLinkProblem = nil
        guard canAddPhoto, !photos.contains(where: { $0.url == value }) else { return }
        photos.append(Photo(link: value))
        photoLink = ""
    }

    func clearLinkProblem() { photoLinkProblem = nil }

    func removePhoto(_ id: UUID) {
        photos.removeAll { $0.id == id }
    }

    /// The first photo is the one on the card.
    func makeCover(_ id: UUID) {
        guard let index = photos.firstIndex(where: { $0.id == id }), index > 0 else { return }
        photos.insert(photos.remove(at: index), at: 0)
    }

    // MARK: Model drafts

    func draftArabicName() async -> String? {
        guard let vendorId else { return nil }
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return nil }
        draftingArabic = true
        defer { draftingArabic = false }
        do {
            let answer = try await api.call(API.draftArabicTitle, .init(vendorId: vendorId, title: title))
            guard answer.kind == "draft", let text = answer.text else { return "admin.arabicDraftUnavailable" }
            draft.titleAr = text
            edit(.titleAr)
            return nil
        } catch {
            return "admin.arabicDraftUnavailable"
        }
    }

    /// The photos sent with a draft: the first uploads in the gallery — a photo
    /// added by its address is on somebody else's server.
    var draftPhotos: [Photo] {
        Array(photos.filter { $0.uploaded != nil && $0.preview != nil }.prefix(rules.aiRules.maxDraftImages))
    }

    func generate(locale: String) {
        let trimmed = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        let sending = draftPhotos
        guard !trimmed.isEmpty || !sending.isEmpty else {
            needInput = true
            return
        }
        needInput = false
        guard let vendorId else { return }
        let images = sending.compactMap { photo -> CatalogAssistBody.Image? in
            guard let data = photo.preview, let image = UIImage(data: data), let address = PhotoShrinker.dataURL(image) else { return nil }
            return .init(mimeType: "image/jpeg", data: String(address.drop(while: { $0 != "," }).dropFirst()))
        }
        let body = CatalogAssistBody(locale: locale, notes: trimmed, department: departmentSlug, images: images)
        let gateway = gatewayFor(vendorId)
        generator = .working
        generating?.cancel()
        generating = Task { [weak self] in
            do {
                let answer = try await gateway.catalog(body)
                guard !Task.isCancelled else { return }
                self?.generator = .done(answer)
            } catch {
                guard !Task.isCancelled else { return }
                let code = (error as? GatewayRefusal)?.code ?? "model_unavailable"
                self?.generator = .failed(Self.generatorMessage(code))
            }
        }
    }

    func cancelGenerating() {
        generating?.cancel()
        generating = nil
        generator = .idle
    }

    func discardDraft() { generator = .idle }

    /// What the draft has replaces a box and what it lacks leaves it alone; a
    /// department the seller had chosen stands.
    func use(_ generated: CatalogDraft) {
        let warranty = generated.attributes.first { $0.key == "warranty" }?.value
        if !generated.title.en.isEmpty { draft.title = generated.title.en }
        if !generated.title.ar.isEmpty { draft.titleAr = generated.title.ar }
        if !generated.description.en.isEmpty { draft.description = generated.description.en }
        if let warranty, !warranty.isEmpty { draft.warranty = warranty }
        if !generated.description.ar.isEmpty { descriptionAr = generated.description.ar }
        if categoryId == nil, let category = categories.value?.first(where: { $0.slug == generated.department }) {
            categoryId = category.id
        }
        if !generated.tags.isEmpty { tags = generated.tags.joined(separator: ", ") }
        specs = generated.attributes.filter { $0.key != "warranty" }.map { Spec(key: $0.key, value: $0.value) }
        serverProblems = [:]
        generator = .idle
    }

    nonisolated static func generatorMessage(_ code: String) -> String {
        switch code {
        case "rate_limited": return "admin.genErrorBusy"
        case "too_large": return "admin.genErrorTooLarge"
        case "model_refused": return "admin.genErrorRefused"
        default: return "admin.genErrorFailed"
        }
    }

    private func gatewayFor(_ vendorId: Int) -> AIGateway {
        if let gateway, gateway.vendorId == vendorId { return gateway.gateway }
        let api = self.api
        let made = AIGateway(mint: { try await api.call(API.catalogSession, .init(vendorId: vendorId)) })
        gateway = (vendorId, made)
        return made
    }

    // MARK: Create

    /// Creates the product, and publishes it when asked. Answers where it
    /// was left, or nil when something has to be fixed first.
    func create(publish: Bool, language: LanguageSettings) async -> Created? {
        submitted = true
        refusal = nil
        guard let vendorId else {
            refusal = "admin.needVendorFirst"
            return nil
        }
        guard problems.isEmpty, !uploading else { return nil }
        creating = publish ? "publish" : "draft"
        defer { creating = nil }
        func trimmed(_ text: String) -> String? {
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? nil : value
        }
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let listing = API.NewListing(
            vendorId: vendorId,
            title: title,
            titleAr: draft.titleAr.trimmingCharacters(in: .whitespacesAndNewlines),
            description: trimmed(draft.description),
            descriptionAr: trimmed(descriptionAr),
            categoryId: categoryId,
            tags: tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty },
            warranty: trimmed(draft.warranty),
            specs: shownSpecs.compactMap { row in trimmed(row.value).map { API.NewListing.Spec(key: row.key, value: $0) } },
            variant: .init(
                price: draft.price.trimmingCharacters(in: .whitespaces),
                compareAtPrice: trimmed(draft.compareAtPrice),
                sku: trimmed(draft.sku),
                stock: Int(draft.stock.trimmingCharacters(in: .whitespaces)) ?? 0
            ),
            images: photos.compactMap(\.url).map { .init(url: $0) }
        )
        let created: CreatedListing
        do {
            created = try await service.create(listing)
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            if key == "admin.skuTaken" { serverProblems[.sku] = key }
            refusal = key == "error.serverProblem" ? "admin.saveFailed" : key
            return nil
        }
        let named = language.t("admin.newCreated", ["title": isolated(title)])
        guard publish else {
            return Created(id: created.id, message: "\(named) \(language.t("admin.newDraftNote"))")
        }
        do {
            let status = try await service.publish(id: created.id)
            return Created(id: created.id, message: "\(named) \(language.t(status == "pending_review" ? "admin.sentForReview" : "admin.nowLive"))")
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            let reason = language.t(key == "error.serverProblem" ? "admin.saveFailed" : key)
            return Created(id: created.id, message: language.t("admin.newCreatedDraft", ["title": isolated(title), "reason": reason]))
        }
    }

    /// A merchant's name inside one of our sentences, in first-strong isolates.
    private func isolated(_ text: String) -> String { "\u{2068}\(text)\u{2069}" }

    private func update(_ id: UUID, _ change: (inout Photo) -> Void) {
        guard let index = photos.firstIndex(where: { $0.id == id }) else { return }
        change(&photos[index])
    }
}
