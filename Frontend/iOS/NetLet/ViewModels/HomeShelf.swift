import Foundation
import Observation
import UIKit

/// The home page's catalogue and the shelves cut from it, read once and shared
/// — the web's `useCatalog(24)`, which the header, the home page and the
/// categories page all read, so the header asks nothing new on Home.
///
/// The shelves are `shelvesFor` in `content/homeLayout.ts`, rule for rule,
/// in the owner's order: Mega deals is the deepest savings, from
/// `megaPercent` off; Deals is every other saving, deepest first; Trending is
/// what shoppers reached for this week and Bestsellers what sold over ninety
/// days, both from the server; New arrivals is the newest. Each leaves out
/// what a shelf above it shows, a strip under four products is not drawn,
/// and what a hidden shelf did not show is free for the next — so every live
/// product is on the home page somewhere and a small shop is one honest grid.
/// A shelf narrowed by department tabs keeps two dozen (`tabbed`), so a
/// department's tab is a shelf and not a pair.
@Observable
@MainActor
final class HomeShelf {
    private(set) var catalogue: LoadState<[Product]> = .idle
    private(set) var bestsellers: [Product] = []
    private(set) var trending: [Product] = []
    private(set) var stores: [StoreCard] = []
    private(set) var brands: [BrandCount] = []
    /// NetLet's own occasions running today (`occasions.live`); nil until the
    /// server has answered or failed to, and until then no occasion is drawn
    /// — the calendar's Halloween shown for a moment over one NetLet switched
    /// off would be a band that flashes.
    private(set) var curated: LiveOccasions?
    /// Products on sale per department; nil until the server has answered.
    private(set) var counts: [String: Int]?
    /// How to reach a person at NetLet, for the footer: the shop's defaults
    /// until the server's settings arrive.
    private(set) var contact: ShopContact = .fallback
    /// The shelves on screen are this morning's, and asking again just failed
    /// — said on the page, because a shopper should know the prices are not
    /// fresh from the server.
    private(set) var showingEarlier = false
    private var loadedFor: Language?

    private let catalog: CatalogServicing
    /// Fetches the catalogue's first photos ahead of the shelves (`warm`), or
    /// does nothing — what a test hands it.
    private let warm: @MainActor ([Product]) -> Void
    nonisolated static let size = 24
    /// A strip below this is a broken shelf, not a short one (`MIN_SHELF_PRODUCTS`).
    nonisolated static let floor = 4
    /// The most one strip carries; "View all" is the rest (`MAX_SHELF_PRODUCTS`).
    nonisolated static let most = 12
    /// The most a shelf with department tabs holds (`MAX_TABBED_PRODUCTS`).
    nonisolated static let tabbed = 24
    /// A saving this deep is a mega deal (`MEGA_DEAL_PERCENT`).
    nonisolated static let megaPercent = 30
    /// A department is a tab only with this many on the shelf (`MIN_TAB_PRODUCTS`).
    nonisolated static let minTab = 2
    /// The most occasions drawn on one day (`MAX_OCCASIONS`).
    nonisolated static let mostOccasions = 2
    /// The stores row and the brands row are drawn from three up.
    nonisolated static let minimumRow = 3

    init(catalog: CatalogServicing, warm: @escaping @MainActor ([Product]) -> Void = { _ in }) {
        self.catalog = catalog
        self.warm = warm
    }

    /// The photos every shelf on the home page will ask for, fetched while the
    /// shopper is still reading the front door — at a card's size, a few at a
    /// time, and kept (`ImagePipeline`), so the shelves draw with them there.
    static func warmPhotos(resolve: @escaping (String?) -> URL?) -> @MainActor ([Product]) -> Void {
        { products in
            let pixels = ImagePipeline.cardPixels(scale: UITraitCollection.current.displayScale)
            var seen = Set<URL>()
            let urls = products.compactMap { resolve($0.images.first?.url) }.filter { seen.insert($0).inserted }
            Task(priority: .utility) { await ImagePipeline.shared.prefetch(urls, pixels: pixels) }
        }
    }

    /// An occasion whose shopping is on, with what it shows: the calendar's
    /// (`occasion`), from the products the stores tagged for it, or one
    /// NetLet curated (`curated`), with its own names and picture.
    struct OccasionShelf: Equatable, Identifiable {
        let slug: String
        let occasion: Occasion?
        let curated: CuratedOccasion?
        let products: [Product]
        var id: String { slug }
    }

    struct Shelves: Equatable {
        var mega: [Product] = []
        var deals: [Product] = []
        var occasions: [OccasionShelf] = []
        var trending: [Product] = []
        var bestsellers: [Product] = []
        var newest: [Product] = []
    }

    /// A shelf cut by department, for the row of tabs over it (`departmentTabs`).
    struct DepartmentTab: Identifiable, Equatable {
        let slug: String
        /// The dictionary key of its name.
        let label: String
        let products: [Product]
        var id: String { slug }
    }

    var shelves: Shelves {
        Self.shelves(catalogue.value ?? [], bestsellers: bestsellers, trending: trending, curated: curated, occasionsDrawn: curated != nil)
    }

    /// Whether the home page draws a deals shelf — Mega deals or Deals — the
    /// rule every link to deals keeps (`dealsDrawn`).
    var dealsDrawn: Bool { !shelves.mega.isEmpty || !shelves.deals.isEmpty }

    /// Reads it all for this language, or nothing when it already has.
    func load(language: Language, force: Bool = false) async {
        if !force, loadedFor == language, catalogue.value != nil { return }
        // What the server answered earlier today, drawn at once; asked again below.
        var drewEarlier = false
        if loadedFor != language || catalogue.value == nil, let kept = catalog.rememberedProducts(first: Self.size, department: nil, language: language) {
            drewEarlier = true
            catalogue = .loaded(kept)
            bestsellers = catalog.rememberedBestsellers(language: language) ?? []
            trending = catalog.rememberedTrending(language: language) ?? []
            stores = catalog.rememberedStores(language: language) ?? []
            brands = catalog.rememberedBrands() ?? brands
            counts = catalog.rememberedDepartmentCounts() ?? counts
            curated = catalog.rememberedLiveOccasions(language: language) ?? curated
            warm(kept + bestsellers + trending)
        }
        if catalogue.value == nil { catalogue = .loading }
        async let counted = try? catalog.departmentCounts()
        async let sold = try? catalog.bestsellers(language: language)
        async let hot = try? catalog.trending(language: language)
        async let storeCards = try? catalog.stores(language: language)
        async let brandRows = try? catalog.brands()
        async let channels = try? catalog.contact()
        async let occasions = try? catalog.liveOccasions(language: language)
        do {
            let products = try await catalog.products(first: Self.size, department: nil, language: language)
            warm(products)
            catalogue = .loaded(products)
            loadedFor = language
            showingEarlier = false
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, catalogue.value == nil { catalogue = .failed(failure) }
            if failure != .cancelled, drewEarlier || showingEarlier { showingEarlier = true }
        }
        bestsellers = await sold ?? bestsellers
        trending = await hot ?? trending
        warm(bestsellers + trending)
        stores = await storeCards ?? stores
        brands = await brandRows ?? brands
        counts = await counted ?? counts
        contact = await channels ?? contact
        // Answered or not, the page may draw its occasions now: with no answer
        // it keeps the one it had, or is the calendar's own.
        let answered = await occasions
        curated = answered ?? curated ?? LiveOccasions.empty
        warm(curated?.occasions.flatMap(\.products) ?? [])
    }

    /// `shelvesFor`, pure.
    nonisolated static func shelves(_ catalogue: [Product], bestsellers: [Product], trending: [Product] = [], now: Date = Date(), occasions calendar: [Occasion] = ReferenceData.shared.occasions, curated: LiveOccasions? = nil, occasionsDrawn: Bool = true) -> Shelves {
        var shown = Set<String>()
        func pick(_ candidates: [Product], floor: Int, most: Int = Self.most) -> [Product] {
            let fresh = candidates.filter { !shown.contains($0.id) }
            guard fresh.count >= floor else { return [] }
            let chosen = Array(fresh.prefix(most))
            for product in chosen { shown.insert(product.id) }
            return chosen
        }
        let offers = byDiscount(catalogue.filter(\.isOnOffer))
        let mega = pick(offers.filter { $0.bestSaving >= megaPercent }, floor: Self.floor)
        let deals = pick(offers, floor: Self.floor, most: tabbed)
        // The seasons and the occasions whose shopping is on today, each from
        // the products the stores tagged for it — after the deals, before Trending.
        var occasions: [OccasionShelf] = []
        // NetLet's own lead. What it chose is shown whole, in its order — a
        // curator who picked six sees six, whatever a shelf above holds — and
        // what the stores tagged follows, less what a shelf above shows.
        for entry in (occasionsDrawn ? curated?.occasions : nil) ?? [] where occasions.count < mostOccasions {
            let chosen = Set(entry.products.map(\.id))
            let fresh = entry.occasion.products(chosen: entry.products, catalogue: catalogue, calendar: calendar)
                .filter { chosen.contains($0.id) || !shown.contains($0.id) }
            guard fresh.count >= Self.floor else { continue }
            let products = Array(fresh.prefix(Self.most))
            for product in products { shown.insert(product.id) }
            occasions.append(OccasionShelf(slug: entry.occasion.slug, occasion: nil, curated: entry.occasion, products: products))
        }
        // Then the calendar's, but for one NetLet took over or switched off.
        let replaced = Set((curated?.replaced ?? []) + occasions.map(\.slug))
        for occasion in (occasionsDrawn ? calendar : []) where occasion.isOn(now) && occasions.count < mostOccasions && !replaced.contains(occasion.slug) {
            let chosen = pick(catalogue.filter { occasion.matches($0) }, floor: Self.floor)
            if !chosen.isEmpty { occasions.append(OccasionShelf(slug: occasion.slug, occasion: occasion, curated: nil, products: chosen)) }
        }
        let hot = pick(trending, floor: Self.floor, most: tabbed)
        let sold = pick(bestsellers, floor: Self.floor, most: tabbed)
        // The catalogue arrives oldest first, so the newest is its end.
        let newest = pick(Array(catalogue.reversed()), floor: 1, most: tabbed)
        return Shelves(mega: mega, deals: deals, occasions: occasions, trending: hot, bestsellers: sold, newest: newest)
    }

    /// A shelf cut by department (`departmentTabs`): each department with
    /// `minTab` of the shelf in it, in the departments' own order, keeping the
    /// shelf's order — and none when a row could change nothing, one
    /// department holding the whole shelf being the "All" tab said twice.
    nonisolated static func departmentTabs(_ products: [Product], departments: [Department] = ReferenceData.shared.departments) -> [DepartmentTab] {
        let tabs = departments.map { department in
            DepartmentTab(slug: department.slug, label: department.label, products: products.filter { $0.productType == department.name || $0.tags.contains(department.name) })
        }
        .filter { $0.products.count >= minTab }
        if tabs.count == 1, tabs[0].products.count == products.count { return [] }
        return tabs
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

    /// What the search field offers in turn while it is empty (`CyclingExample`),
    /// on the owner's word ("give recommendations in the text … that cycle
    /// through smoothly") — every one of them true of this shop today: a
    /// department with something on sale, a brand it sells, a kind of product
    /// on its shelves, taken in turn so the field never says the same sort of
    /// thing twice running. A department is named as the page names it (lower
    /// case in English); a type a seller typed is offered on the Arabic page
    /// only if it is Arabic (`catalogExample` in `LiveSearch.tsx`); a brand is
    /// a name, offered on both. At most ten.
    func searchExamples(language: LanguageSettings) -> [String] {
        let arabic = language.current == .ar
        let products = catalogue.value ?? []
        let departments = ReferenceData.shared.departments.filter { department in
            if let counts { return (counts[department.slug] ?? 0) > 0 }
            return products.contains { ReferenceData.shared.department(named: $0.productType ?? "")?.slug == department.slug }
        }
        .map { language.t($0.label) }
        .map { arabic ? $0 : $0.lowercased() }
        let brandNames = brands.prefix(6).map(\.name)
        var types: [String] = []
        for product in products {
            guard let type = product.productType?.trimmingCharacters(in: .whitespaces), !type.isEmpty,
                  ReferenceData.shared.department(named: type) == nil else { continue }
            if arabic && !type.unicodeScalars.contains(where: { (0x0600...0x06FF).contains($0.value) }) { continue }
            types.append(arabic ? type : type.lowercased())
        }
        var seen = Set<String>()
        var turns: [String] = []
        let lists = [departments, brandNames, types]
        for index in 0..<(lists.map(\.count).max() ?? 0) {
            for list in lists where index < list.count {
                let word = list[index]
                if seen.insert(word.lowercased()).inserted { turns.append(word) }
            }
        }
        return Array(turns.prefix(10))
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
