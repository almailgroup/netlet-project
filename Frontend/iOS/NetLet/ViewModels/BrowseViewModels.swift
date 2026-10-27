import Foundation
import Observation

/// What a shelf page shows before the shopper narrows it: everything, what is
/// on offer (deepest first), the newest, or one brand — the web's
/// `/category/all?offer=1`, `?sort=newest` and `?brand=`.
enum ShelfView: Hashable {
    case all, deals, newest
    case brand(String)
}

/// How a shelf's products are ordered — the web's sort options, done on the
/// shelf the app holds rather than by asking again (`sortProducts`).
enum ProductSort: String, CaseIterable, Identifiable {
    case relevance, priceLow, priceHigh, discount, rating, newest

    var id: String { rawValue }

    var labelKey: String {
        switch self {
        case .relevance: return "browse.sort.relevance"
        case .priceLow: return "browse.sort.priceLow"
        case .priceHigh: return "browse.sort.priceHigh"
        case .discount: return "browse.sort.discount"
        case .rating: return "browse.sort.rating"
        case .newest: return "browse.sort.newest"
        }
    }

    /// A stable sort: products the order does not separate keep the server's order.
    func apply(to products: [Product]) -> [Product] {
        func price(_ product: Product) -> Int { product.priceRange.min.fils }
        func rating(_ product: Product) -> Double { product.rating?.value ?? 0 }
        let indexed = Array(products.enumerated())
        let sorted: [(offset: Int, element: Product)]
        switch self {
        case .relevance:
            return products
        case .newest:
            // Newest first: the catalogue arrives oldest first.
            return Array(products.reversed())
        case .priceLow:
            sorted = indexed.sorted { price($0.element) != price($1.element) ? price($0.element) < price($1.element) : $0.offset < $1.offset }
        case .priceHigh:
            sorted = indexed.sorted { price($0.element) != price($1.element) ? price($0.element) > price($1.element) : $0.offset < $1.offset }
        case .discount:
            return HomeShelf.byDiscount(products)
        case .rating:
            sorted = indexed.sorted {
                if rating($0.element) != rating($1.element) { return rating($0.element) > rating($1.element) }
                if price($0.element) != price($1.element) { return price($0.element) < price($1.element) }
                return $0.offset < $1.offset
            }
        }
        return sorted.map(\.element)
    }
}

/// The filters a shopper ticks, the web's `BrowseFilters` without the price
/// range — each a rule `applyFilters` already has.
struct BrowseFilters: Equatable {
    var brands: Set<String> = []
    var sellers: Set<String> = []
    /// The seller's shipping bands ticked (`speeds`).
    var speeds: Set<String> = []
    var options: [String: Set<String>] = [:]
    /// A price range in dinars, either end open.
    var minPrice: Double?
    var maxPrice: Double?
    var minRating: Int?
    var inStock = false
    var onOffer = false
    var express = false

    /// How many are on, for "Filters (3)" and the corner button's badge.
    var activeCount: Int {
        brands.count + sellers.count + speeds.count + options.values.reduce(0) { $0 + $1.count }
            + (minPrice == nil && maxPrice == nil ? 0 : 1)
            + (minRating == nil ? 0 : 1) + (inStock ? 1 : 0) + (onOffer ? 1 : 0) + (express ? 1 : 0)
    }

    func admits(_ product: Product) -> Bool {
        if !brands.isEmpty {
            guard let brand = product.brand, brands.contains(brand) else { return false }
        }
        if !sellers.isEmpty {
            guard let vendor = product.vendor, sellers.contains(vendor) else { return false }
        }
        for (name, wanted) in options where !wanted.isEmpty {
            let values = product.options.first { $0.name == name }?.values ?? []
            if !values.contains(where: { wanted.contains($0) }) { return false }
        }
        if !speeds.isEmpty {
            guard let speed = product.deliverySpeed, speeds.contains(speed) else { return false }
        }
        let price = Double(product.priceRange.min.fils) / 1000
        if let minPrice, price < minPrice { return false }
        if let maxPrice, price > maxPrice { return false }
        if let minRating, (product.rating?.value ?? 0) < Double(minRating) { return false }
        if inStock && !product.isAvailable { return false }
        if onOffer && !product.isOnOffer { return false }
        if express && !product.isExpress { return false }
        return true
    }
}

/// One value a filter can take and how many products carry it.
struct FacetValue: Hashable, Identifiable {
    let value: String
    let count: Int
    var id: String { value }
}

/// The filters worth drawing, derived from the products on the page rather
/// than declared (`facetsFor`): a group that cannot narrow anything is not drawn.
struct Facets {
    struct Option: Identifiable {
        let name: String
        let values: [FacetValue]
        var id: String { name }
    }

    let total: Int
    let brands: [FacetValue]
    let sellers: [FacetValue]
    /// The shipping bands on the page, fastest first.
    let speeds: [FacetValue]
    let options: [Option]
    /// The page's cheapest and dearest, whole dinars, for the price range's hint.
    let priceBounds: (min: Int, max: Int)?
    let ratings: [FacetValue]
    let inStock: Int
    let onOffer: Int
    let express: Int

    init(_ products: [Product]) {
        func tally(_ values: [String]) -> [FacetValue] {
            var counts: [String: Int] = [:]
            for value in values { counts[value, default: 0] += 1 }
            return counts.map { FacetValue(value: $0.key, count: $0.value) }
                .sorted { $0.count != $1.count ? $0.count > $1.count : $0.value.localizedCompare($1.value) == .orderedAscending }
        }
        total = products.count
        brands = tally(products.compactMap(\.brand))
        sellers = tally(products.compactMap { $0.vendor?.isEmpty == false ? $0.vendor : nil })
        speeds = tally(products.compactMap(\.deliverySpeed)).sorted {
            (Self.speedOrder.firstIndex(of: $0.value) ?? .max) < (Self.speedOrder.firstIndex(of: $1.value) ?? .max)
        }
        let prices = products.map { Double($0.priceRange.min.fils) / 1000 }
        if let low = prices.min(), let high = prices.max() {
            priceBounds = (Int(low.rounded(.down)), Int(high.rounded(.up)))
        } else {
            priceBounds = nil
        }
        var names: [String] = []
        for product in products { for option in product.options where !names.contains(option.name) { names.append(option.name) } }
        options = names.map { name in
            Option(name: name, values: tally(products.flatMap { product in Array(Set(product.options.first { $0.name == name }?.values ?? [])) }))
        }
        let count = products.count
        ratings = [4, 3, 2, 1]
            .map { threshold in FacetValue(value: String(threshold), count: products.filter { ($0.rating?.value ?? 0) >= Double(threshold) }.count) }
            .filter { $0.count > 0 && $0.count < count }
        inStock = products.filter(\.isAvailable).count
        onOffer = products.filter(\.isOnOffer).count
        express = products.filter(\.isExpress).count
    }

    /// `DELIVERY_SPEEDS`, fastest first.
    static let speedOrder = ["same_day", "next_day", "two_to_four", "up_to_week", "made_to_order"]

    /// `facetNarrows`: two values, or one that not every product carries.
    func narrows(_ values: [FacetValue]) -> Bool {
        values.count > 1 || (values.count == 1 && values[0].count < total)
    }

    /// A tick that would change something: some carry it and some do not.
    func narrows(_ count: Int) -> Bool { count > 0 && count < total }
}

/// A shelf page — a department, the whole catalogue, a view of it, or a
/// search's results — with the filters and the sort a phone draws.
@Observable
@MainActor
final class BrowseModel {
    enum Source: Hashable {
        case shelf(slug: String?, view: ShelfView)
        case search(String, department: String? = nil)
    }

    let source: Source
    private(set) var products: LoadState<[Product]> = .idle
    /// The catalogue's own spelling, when a search found nothing as typed.
    private(set) var correctedTo: String?
    var filters = BrowseFilters()
    var sort: ProductSort = .relevance

    private let catalog: CatalogServicing
    /// The most a shelf asks for — the server's own ceiling.
    static let pageSize = 100
    static let searchLimit = 60

    init(source: Source, catalog: CatalogServicing) {
        self.source = source
        self.catalog = catalog
        if case .shelf(_, let view) = source {
            switch view {
            case .all: break
            case .deals:
                filters.onOffer = true
                sort = .discount
            case .newest:
                sort = .newest
            case .brand(let name):
                filters.brands = [name]
            }
        }
    }

    var department: Department? {
        if case .shelf(let slug, _) = source { return ReferenceData.shared.department(slug: slug) }
        return nil
    }

    var query: String? {
        if case .search(let words, _) = source { return words }
        return nil
    }

    func load(language: Language) async {
        if products.value == nil { products = .loading }
        do {
            switch source {
            case .shelf:
                // The server narrows by the category's slug, which is the department's.
                products = .loaded(try await catalog.products(first: Self.pageSize, department: department?.slug, language: language))
            case .search(let words, let scope):
                let found = try await catalog.search(words, department: scope, limit: Self.searchLimit, language: language)
                correctedTo = found.correctedTo
                products = .loaded(found.products)
            }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, products.value == nil { products = .failed(failure) }
        }
    }

    var shown: [Product] {
        sort.apply(to: (products.value ?? []).filter(filters.admits))
    }

    var facets: Facets { Facets(products.value ?? []) }

    func clearFilters() {
        filters = BrowseFilters()
    }
}

/// The search screen. It asks the server once typing pauses, over the whole
/// catalogue, and keeps the last answer on screen while the next arrives.
@Observable
@MainActor
final class SearchViewModel {
    /// What is in the box. The screen calls `queryChanged()` when it moves,
    /// which is what asks the server.
    var query = ""
    private var scheduledFor = ""

    private(set) var result: LoadState<SearchResult> = .idle
    /// The words the result on screen answers, so a stale answer is never
    /// drawn under newer words.
    private(set) var answered = ""
    private(set) var recent: [String]

    private let catalog: CatalogServicing
    private let defaults: UserDefaults
    private var pending: Task<Void, Never>?
    var language: Language = .en
    /// The pause after a key before the server is asked, the web's 120ms plus
    /// a little for a phone keyboard's autocorrect.
    var debounce: Duration = .milliseconds(250)
    static let recentKey = "netlet.recentSearches"
    static let resultLimit = 40

    init(catalog: CatalogServicing, defaults: UserDefaults = .standard) {
        self.catalog = catalog
        self.defaults = defaults
        recent = defaults.stringArray(forKey: Self.recentKey) ?? []
    }

    var trimmed: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// The search the keyboard's Search key asks for: at once, and remembered.
    func submit() async {
        pending?.cancel()
        scheduledFor = trimmed
        remember(trimmed)
        await run(trimmed)
    }

    func clearRecent() {
        recent = []
        defaults.removeObject(forKey: Self.recentKey)
    }

    /// The box changed: ask once typing pauses.
    func queryChanged() {
        guard trimmed != scheduledFor else { return }
        scheduleSearch()
    }

    private func scheduleSearch() {
        pending?.cancel()
        let words = trimmed
        scheduledFor = words
        guard !words.isEmpty else {
            result = .idle
            answered = ""
            return
        }
        let pause = debounce
        pending = Task { [weak self] in
            try? await Task.sleep(for: pause)
            guard !Task.isCancelled else { return }
            await self?.run(words)
        }
    }

    func run(_ words: String) async {
        guard !words.isEmpty else { return }
        if result.value == nil { result = .loading }
        do {
            let found = try await catalog.search(words, department: nil, limit: Self.resultLimit, language: language)
            guard words == trimmed else { return }
            result = .loaded(found)
            answered = words
        } catch {
            let failure = APIError.from(error)
            guard failure != .cancelled, words == trimmed else { return }
            result = .failed(failure)
        }
    }

    /// Recent searches stay on this device and are never sent anywhere.
    func remember(_ words: String) {
        guard !words.isEmpty else { return }
        recent = Array(([words] + recent.filter { $0.caseInsensitiveCompare(words) != .orderedSame }).prefix(6))
        defaults.set(recent, forKey: Self.recentKey)
    }
}

/// One product, the variant chosen and how many.
@Observable
@MainActor
final class ProductDetailViewModel {
    let handle: String
    private(set) var product: LoadState<Product?> = .idle
    private(set) var selection: [String: String] = [:]
    /// Set when the product has variants and none is chosen yet, or the
    /// options chosen name none — its first button then says "Choose an option".
    private(set) var variant: ProductVariant?
    var quantity = 1
    var imageIndex = 0
    /// The optional extras ticked for this line, by id.
    var addons: Set<String> = []
    private(set) var adding = false

    private let catalog: CatalogServicing

    init(handle: String, catalog: CatalogServicing) {
        self.handle = handle
        self.catalog = catalog
    }

    func load(language: Language) async {
        if product.value == nil { product = .loading }
        do {
            let found = try await catalog.product(handle: handle, language: language)
            product = .loaded(found)
            if let found, variant == nil { choose(initialVariant(of: found)) }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, product.value == nil { product = .failed(failure) }
        }
    }

    /// Starts from a copy already on screen — a card's, for the preview a
    /// hold opens — so nothing waits on the network; `load` asks the server
    /// again behind it.
    func start(with shown: Product) {
        guard product.value == nil else { return }
        product = .loaded(shown)
        if variant == nil { choose(initialVariant(of: shown)) }
    }

    /// A product with one variant has it chosen; with several, nothing is
    /// chosen for the shopper — a size has to be picked before a number means anything.
    private func initialVariant(of product: Product) -> ProductVariant? {
        product.variants.count == 1 ? product.variants.first : nil
    }

    private func choose(_ chosen: ProductVariant?) {
        variant = chosen
        selection = Dictionary((chosen?.selectedOptions ?? []).map { ($0.name, $0.value) }, uniquingKeysWith: { first, _ in first })
        quantity = min(max(1, quantity), max(1, chosen?.maxQuantity ?? 1))
    }

    /// Whether options tell every variant apart; otherwise variants are chosen by name.
    func choosesByOption(_ product: Product) -> Bool {
        guard !product.options.isEmpty else { return false }
        let keys = product.variants.map { variant in product.options.map { variant.value(of: $0.name) ?? "" }.joined(separator: "\u{1F}") }
        return Set(keys).count == product.variants.count && !keys.contains { $0.replacingOccurrences(of: "\u{1F}", with: "").isEmpty }
    }

    func select(option name: String, value: String, in product: Product) {
        var next = selection
        next[name] = value
        selection = next
        let match = product.variants.first { variant in
            product.options.allSatisfy { option in next[option.name] == variant.value(of: option.name) }
        }
        variant = match
        if let match { quantity = min(quantity, max(1, match.maxQuantity)) }
        showPhoto(of: value, in: product)
    }

    func select(variant chosen: ProductVariant) {
        choose(chosen)
    }

    /// Whether picking `value` for `option` would name a variant that can be bought.
    func isAvailable(option name: String, value: String, in product: Product) -> Bool {
        product.variants.contains { variant in
            variant.availableForSale && variant.value(of: name) == value && product.options.allSatisfy { option in
                option.name == name || selection[option.name] == nil || selection[option.name] == variant.value(of: option.name)
            }
        }
    }

    /// Choosing a colour shows its photo, by the photo's description — the web's rule.
    private func showPhoto(of value: String, in product: Product) {
        if let index = GalleryRules.photoIndex(naming: value, in: product.gallery) {
            imageIndex = index
        }
    }

    func add(to cart: CartModel) async -> Bool {
        guard let variant, variant.availableForSale else { return false }
        adding = true
        defer { adding = false }
        // A line with extras is its own line, priced by the server; a plain one joins the plain line.
        if !addons.isEmpty {
            return await cart.add(lines: [API.CartLine(variantId: variant.id, quantity: quantity, addonIds: addons.sorted())])
        }
        return await cart.add(variantId: variant.id, quantity: quantity)
    }

    /// The size guide's answer, chosen: the variant whose size it names.
    func choose(size: String, axis: String, in product: Product) {
        if choosesByOption(product), product.options.contains(where: { $0.name == axis }) {
            select(option: axis, value: size, in: product)
        } else if let match = product.variants.first(where: { $0.title.caseInsensitiveCompare(size) == .orderedSame || $0.value(of: axis)?.caseInsensitiveCompare(size) == .orderedSame }) {
            choose(match)
        }
    }
}
