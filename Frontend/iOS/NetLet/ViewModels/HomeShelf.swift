import Foundation
import Observation

/// The home page's catalogue and the shelves cut from it, read once and shared
/// — the web's `useCatalog(24)`, which the header, the home page and the
/// categories page all read, so the header asks nothing new on Home.
///
/// The shelves are `shelvesFor` in `content/homeLayout.ts`, rule for rule:
/// Deals is what is actually discounted, deepest first; Bestsellers is what
/// sold, from the server; New arrivals is the newest. Each leaves out what a
/// shelf above it shows, a strip under four products is not drawn, and what a
/// hidden shelf did not show is free for the next — so every live product is
/// on the home page somewhere and a small shop is one honest grid.
@Observable
@MainActor
final class HomeShelf {
    private(set) var catalogue: LoadState<[Product]> = .idle
    private(set) var bestsellers: [Product] = []
    private(set) var stores: [StoreCard] = []
    private(set) var brands: [BrandCount] = []
    /// Products on sale per department; nil until the server has answered.
    private(set) var counts: [String: Int]?
    /// How to reach a person at NetLet, for the footer: the shop's defaults
    /// until the server's settings arrive.
    private(set) var contact: ShopContact = .fallback
    private var loadedFor: Language?

    private let catalog: CatalogServicing
    nonisolated static let size = 24
    /// A strip below this is a broken shelf, not a short one (`MIN_SHELF_PRODUCTS`).
    nonisolated static let floor = 4
    /// The most one shelf carries; "View all" is the rest (`MAX_SHELF_PRODUCTS`).
    nonisolated static let most = 12
    /// The stores row and the brands row are drawn from three up.
    nonisolated static let minimumRow = 3

    init(catalog: CatalogServicing) {
        self.catalog = catalog
    }

    struct Shelves: Equatable {
        var deals: [Product] = []
        var bestsellers: [Product] = []
        var newest: [Product] = []
    }

    var shelves: Shelves { Self.shelves(catalogue.value ?? [], bestsellers: bestsellers) }

    /// Whether the home page draws a Deals shelf — the rule every link to deals keeps.
    var dealsDrawn: Bool { !shelves.deals.isEmpty }

    /// Reads it all for this language, or nothing when it already has.
    func load(language: Language, force: Bool = false) async {
        if !force, loadedFor == language, catalogue.value != nil { return }
        if catalogue.value == nil { catalogue = .loading }
        async let counted = try? catalog.departmentCounts()
        async let sold = try? catalog.bestsellers(language: language)
        async let storeCards = try? catalog.stores(language: language)
        async let brandRows = try? catalog.brands()
        async let channels = try? catalog.contact()
        do {
            catalogue = .loaded(try await catalog.products(first: Self.size, department: nil, language: language))
            loadedFor = language
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, catalogue.value == nil { catalogue = .failed(failure) }
        }
        bestsellers = await sold ?? bestsellers
        stores = await storeCards ?? stores
        brands = await brandRows ?? brands
        counts = await counted ?? counts
        contact = await channels ?? contact
    }

    /// `shelvesFor`, pure.
    nonisolated static func shelves(_ catalogue: [Product], bestsellers: [Product]) -> Shelves {
        var shown = Set<String>()
        func pick(_ candidates: [Product], floor: Int) -> [Product] {
            let fresh = candidates.filter { !shown.contains($0.id) }
            guard fresh.count >= floor else { return [] }
            let chosen = Array(fresh.prefix(most))
            for product in chosen { shown.insert(product.id) }
            return chosen
        }
        let deals = pick(byDiscount(catalogue.filter(\.isOnOffer)), floor: Self.floor)
        let sold = pick(bestsellers, floor: Self.floor)
        // The catalogue arrives oldest first, so the newest is its end.
        let newest = pick(Array(catalogue.reversed()), floor: 1)
        return Shelves(deals: deals, bestsellers: sold, newest: newest)
    }

    /// Deepest saving first, then the cheaper — `sortProducts(…, "discount")`.
    nonisolated static func byDiscount(_ products: [Product]) -> [Product] {
        products.enumerated().sorted { left, right in
            let (a, b) = (left.element, right.element)
            if a.deepestSaving != b.deepestSaving { return a.deepestSaving > b.deepestSaving }
            if a.priceRange.min != b.priceRange.min { return a.priceRange.min < b.priceRange.min }
            return left.offset < right.offset
        }.map(\.element)
    }

    /// The search field's example: the first product type the catalogue holds,
    /// as its department is named — lower case in English — or as the seller
    /// typed it, and on the Arabic page only when it is Arabic
    /// (`catalogExample` in `LiveSearch.tsx`).
    func searchExample(language: LanguageSettings) -> String? {
        let arabic = language.current == .ar
        for product in catalogue.value ?? [] {
            guard let type = product.productType?.trimmingCharacters(in: .whitespaces), !type.isEmpty else { continue }
            if let department = ReferenceData.shared.department(named: type) {
                let name = language.t(department.label)
                return arabic ? name : name.lowercased()
            }
            if !arabic { return type.lowercased() }
            if type.unicodeScalars.contains(where: { (0x0600...0x06FF).contains($0.value) }) { return type }
        }
        return nil
    }
}

extension Product {
    /// The maker, from the product's own Brand row (`brandOf`) — not the
    /// store, which is the seller.
    var brand: String? {
        let row = attributes.first { $0.key == "brand" && $0.namespace != "reviews" }
        let value = row?.value.trimmingCharacters(in: .whitespaces) ?? ""
        return value.isEmpty ? nil : value
    }

    /// A saving the shop may advertise on any variant — the server has already
    /// dropped a was-price the store's discount permit no longer allows.
    var isOnOffer: Bool { variants.contains { $0.compareAtPrice != nil } }

    /// The deepest saving across its variants, as a fraction of the was-price.
    var deepestSaving: Double {
        variants.reduce(0) { best, variant in
            guard let was = variant.compareAtPrice, was.fils > 0, was > variant.price else { return best }
            return max(best, Double(was.fils - variant.price.fils) / Double(was.fils))
        }
    }
}
