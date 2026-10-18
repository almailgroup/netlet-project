import Foundation
import Observation

/// Adding a product: what a shopper decides on — name in both languages,
/// price, opening stock, photos, description, department — and one press.
///
/// The product, its first variant, the opening count and the gallery are one
/// transaction on the server, so Create is one outcome and leaving is none.
/// Publishing is its own act after it: a store whose listings are checked
/// first gets "In review", and the screen says so.
@Observable
@MainActor
final class NewListingViewModel {
    struct Photo: Identifiable, Equatable {
        let id = UUID()
        var preview: Data
        var uploaded: UploadedPhoto?
        var failure: String?
    }

    enum Outcome: Equatable {
        case published(title: String)
        case inReview(title: String)
        /// Created, but publishing was refused: it exists as a draft, with the reason.
        case draft(title: String, reason: String)
    }

    var draft = Validation.ListingDraft()
    var categoryId: Int?
    var publish = true
    private(set) var categories: LoadState<[Category]> = .idle
    private(set) var photos: [Photo] = []
    private(set) var submitted = false
    private(set) var creating = false
    private(set) var refusal: String?
    private(set) var outcome: Outcome?

    private let service: SellerServicing
    private let rules: Rules

    init(service: SellerServicing, rules: Rules = ReferenceData.shared.rules) {
        self.service = service
        self.rules = rules
    }

    func load() async {
        guard categories.value == nil else { return }
        categories = .loading
        do {
            categories = .loaded(try await service.categories())
        } catch {
            categories = .failed(APIError.from(error))
        }
    }

    var departmentSlug: String? {
        categories.value?.first(where: { $0.id == categoryId })?.slug
    }

    var problems: [Validation.ListingField: String] {
        Validation.listingProblems(draft, departmentSlug: departmentSlug, rules: rules.listing)
    }

    /// Said once Create has been pressed, never before somebody reaches the box.
    func problem(_ field: Validation.ListingField) -> String? {
        submitted ? problems[field] : nil
    }

    var photoProblem: String? {
        submitted && !photos.contains(where: { $0.uploaded != nil }) ? "admin.newCheckPhoto" : nil
    }

    var uploading: Bool { photos.contains { $0.uploaded == nil && $0.failure == nil } }
    var canAddPhoto: Bool { photos.count < rules.listing.maxPhotos }

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
        guard photo.failure == nil else { return }
        let id = photo.id
        do {
            let uploaded = try await service.upload(jpeg: photo.preview)
            update(id) { $0.uploaded = uploaded }
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            update(id) { $0.failure = key }
        }
    }

    func removePhoto(_ id: UUID) {
        photos.removeAll { $0.id == id }
    }

    /// The first photo is the one on the card.
    func makeCover(_ id: UUID) {
        guard let index = photos.firstIndex(where: { $0.id == id }), index > 0 else { return }
        photos.insert(photos.remove(at: index), at: 0)
    }

    func create(vendorId: Int) async -> Bool {
        submitted = true
        refusal = nil
        guard problems.isEmpty, photoProblem == nil, !uploading else { return false }
        creating = true
        defer { creating = false }
        let description = draft.description.trimmingCharacters(in: .whitespacesAndNewlines)
        let warranty = draft.warranty.trimmingCharacters(in: .whitespacesAndNewlines)
        let stock = Int(draft.stock.trimmingCharacters(in: .whitespaces)) ?? 0
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let listing = API.NewListing(
            vendorId: vendorId,
            title: title,
            titleAr: draft.titleAr.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description.isEmpty ? nil : description,
            categoryId: categoryId,
            warranty: warranty.isEmpty ? nil : warranty,
            variant: .init(price: draft.price.trimmingCharacters(in: .whitespaces), stock: stock),
            images: photos.compactMap(\.uploaded).map { .init(url: $0.url) }
        )
        let created: CreatedListing
        do {
            created = try await service.create(listing)
        } catch {
            refusal = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            return false
        }
        guard publish else {
            outcome = .draft(title: title, reason: "")
            return true
        }
        do {
            let status = try await service.publish(id: created.id)
            outcome = status == "published" ? .published(title: title) : .inReview(title: title)
        } catch {
            outcome = .draft(title: title, reason: APIError.from(error).messageKey(knownKey: Phrasebook.shared.has))
        }
        return true
    }

    func reset() {
        draft = Validation.ListingDraft()
        categoryId = nil
        photos = []
        submitted = false
        refusal = nil
        outcome = nil
    }

    private func update(_ id: UUID, _ change: (inout Photo) -> Void) {
        guard let index = photos.firstIndex(where: { $0.id == id }) else { return }
        change(&photos[index])
    }
}
