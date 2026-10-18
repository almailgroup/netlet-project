import Foundation
import Observation

/// The front of the shop: the departments with what each holds, and the newest products.
@Observable
@MainActor
final class HomeViewModel {
    private(set) var products: LoadState<[Product]> = .idle
    /// How many products each department has on sale. Absent until asked, so
    /// every department shows until the counts arrive — the web header's rule.
    private(set) var counts: [String: Int] = [:]

    private let catalog: CatalogServicing
    static let shelfSize = 24

    init(catalog: CatalogServicing) {
        self.catalog = catalog
    }

    func load(language: Language) async {
        if products.value == nil { products = .loading }
        async let counted = try? catalog.departmentCounts()
        do {
            let list = try await catalog.products(first: Self.shelfSize, department: nil, language: language)
            products = .loaded(list)
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { products = .failed(failure) }
        }
        counts = await counted ?? counts
    }

    /// Today's deals: what is actually discounted, deepest first. The home
    /// page's own rule is that a shelf below four products is not drawn.
    var deals: [Product] {
        let discounted = (products.value ?? []).filter { $0.leadVariant?.saving != nil }
        let sorted = discounted.sorted { ($0.leadVariant?.savingPercent ?? 0) > ($1.leadVariant?.savingPercent ?? 0) }
        return sorted.count >= 4 ? Array(sorted.prefix(8)) : []
    }
}

/// How a department's products are ordered — the web's sort options, done on
/// the shelf the app holds rather than by asking again.
enum ProductSort: String, CaseIterable, Identifiable {
    case relevance, newest, priceLow, priceHigh, discount

    var id: String { rawValue }

    var labelKey: String {
        switch self {
        case .relevance: return "browse.sort.relevance"
        case .newest: return "browse.sort.newest"
        case .priceLow: return "browse.sort.priceLow"
        case .priceHigh: return "browse.sort.priceHigh"
        case .discount: return "browse.sort.discount"
        }
    }

    /// A stable sort: products the order does not separate keep the server's order.
    func apply(to products: [Product]) -> [Product] {
        let indexed = Array(products.enumerated())
        func price(_ product: Product) -> Int { product.leadVariant?.price.fils ?? product.priceRange.min.fils }
        func saving(_ product: Product) -> Int { product.leadVariant?.savingPercent ?? 0 }
        let sorted: [(offset: Int, element: Product)]
        switch self {
        case .relevance, .newest:
            return products
        case .priceLow:
            sorted = indexed.sorted { price($0.element) != price($1.element) ? price($0.element) < price($1.element) : $0.offset < $1.offset }
        case .priceHigh:
            sorted = indexed.sorted { price($0.element) != price($1.element) ? price($0.element) > price($1.element) : $0.offset < $1.offset }
        case .discount:
            sorted = indexed.sorted { saving($0.element) != saving($1.element) ? saving($0.element) > saving($1.element) : $0.offset < $1.offset }
        }
        return sorted.map(\.element)
    }
}

/// One department's shelf, or the whole catalogue when there is no department.
@Observable
@MainActor
final class DepartmentViewModel {
    let slug: String?
    private(set) var products: LoadState<[Product]> = .idle
    var sort: ProductSort = .relevance
    var inStockOnly = false

    private let catalog: CatalogServicing
    static let pageSize = 60

    init(slug: String?, catalog: CatalogServicing) {
        self.slug = slug
        self.catalog = catalog
    }

    var department: Department? { ReferenceData.shared.department(slug: slug) }

    func load(language: Language) async {
        if products.value == nil { products = .loading }
        do {
            // The server narrows by the category's slug, which is the department's.
            products = .loaded(try await catalog.products(first: Self.pageSize, department: department?.slug, language: language))
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { products = .failed(failure) }
        }
    }

    var shown: [Product] {
        let list = products.value ?? []
        return sort.apply(to: inStockOnly ? list.filter(\.isAvailable) : list)
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
    private func remember(_ words: String) {
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
        let word = value.lowercased()
        if let index = product.images.firstIndex(where: { image in
            (image.altText ?? "").lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).contains { $0 == word || $0 == "ال" + word }
        }) {
            imageIndex = index
        }
    }

    func add(to cart: CartModel) async -> Bool {
        guard let variant, variant.availableForSale else { return false }
        adding = true
        defer { adding = false }
        return await cart.add(variantId: variant.id, quantity: quantity)
    }
}
