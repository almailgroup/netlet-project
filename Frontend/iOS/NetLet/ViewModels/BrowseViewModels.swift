import Foundation
import Observation

/// What a shelf page shows before the shopper narrows it: everything, what is
/// on offer (deepest first), the newest, or one brand — the web's
/// `/category/all?offer=1`, `?sort=newest` and `?brand=`.
enum ShelfView: Hashable {
    case all, deals, newest
    /// Highest rated first, the web's `?sort=rating`.
    case topRated
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
    /// One of the department's subcategories, by slug — the page it names
    /// rather than a filter, so it is not counted and clearing keeps it.
    var sub: String?
    /// An occasion's shelf, by slug (`?occasion=`): the products the stores
    /// tagged for it. The page, like a subcategory, so not counted either.
    var occasion: String?

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
        if let sub, product.subcategory != sub { return false }
        if let occasion {
            // A slug naming no occasion narrows to nothing, never to everything.
            guard let found = ReferenceData.shared.occasion(slug: occasion), found.matches(product) else { return false }
        }
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

/// A group of filters: what one chip in the phone's row names and its sheet
/// draws — the web's `FilterGroupKey`, less the department, which the app's
/// pages never narrow by.
enum FilterGroupKey: Hashable, Identifiable {
    case offers, brand, price, rating, seller, speed
    case option(String)

    /// A key from its `id`, the screenshots' hook names a group by.
    init?(id: String) {
        switch id {
        case "offers": self = .offers
        case "brand": self = .brand
        case "price": self = .price
        case "rating": self = .rating
        case "seller": self = .seller
        case "speed": self = .speed
        default:
            guard id.hasPrefix("option:") else { return nil }
            self = .option(String(id.dropFirst("option:".count)))
        }
    }

    var id: String {
        switch self {
        case .offers: return "offers"
        case .brand: return "brand"
        case .price: return "price"
        case .rating: return "rating"
        case .seller: return "seller"
        case .speed: return "speed"
        case .option(let name): return "option:" + name
        }
    }
}

/// The groups that can narrow a page, in the chip row's order, each with how
/// many of its values are ticked — the web's `filterGroups`, rule for rule:
/// a group is there when ticking it could change something, or when
/// something in it is already ticked, so a chip never vanishes from under a
/// shopper who has just used it.
enum FilterGroups {
    struct Group: Identifiable, Equatable {
        let key: FilterGroupKey
        let active: Int
        var id: String { key.id }
    }

    static func of(_ facets: Facets, _ filters: BrowseFilters) -> [Group] {
        var groups: [Group] = []
        let offers = (filters.inStock ? 1 : 0) + (filters.onOffer ? 1 : 0) + (filters.express ? 1 : 0)
        if offers > 0 || facets.narrows(facets.inStock) || facets.narrows(facets.onOffer) || facets.narrows(facets.express) {
            groups.append(Group(key: .offers, active: offers))
        }
        if !filters.brands.isEmpty || facets.narrows(facets.brands) {
            groups.append(Group(key: .brand, active: filters.brands.count))
        }
        let priced = filters.minPrice != nil || filters.maxPrice != nil
        if priced || facets.priceBounds != nil { groups.append(Group(key: .price, active: priced ? 1 : 0)) }
        if filters.minRating != nil || !facets.ratings.isEmpty {
            groups.append(Group(key: .rating, active: filters.minRating == nil ? 0 : 1))
        }
        if !filters.sellers.isEmpty || facets.narrows(facets.sellers) {
            groups.append(Group(key: .seller, active: filters.sellers.count))
        }
        if !filters.speeds.isEmpty || facets.narrows(facets.speeds) {
            groups.append(Group(key: .speed, active: filters.speeds.count))
        }
        var names = facets.options.filter { facets.narrows($0.values) || !(filters.options[$0.name] ?? []).isEmpty }.map(\.name)
        for (name, values) in filters.options.sorted(by: { $0.key < $1.key }) where !values.isEmpty && !names.contains(name) {
            names.append(name)
        }
        for name in names { groups.append(Group(key: .option(name), active: filters.options[name]?.count ?? 0)) }
        return groups
    }

    /// One group's values taken off — its sheet's Clear.
    static func clear(_ key: FilterGroupKey, in filters: inout BrowseFilters) {
        switch key {
        case .offers:
            filters.inStock = false
            filters.onOffer = false
            filters.express = false
        case .brand: filters.brands = []
        case .price:
            filters.minPrice = nil
            filters.maxPrice = nil
        case .rating: filters.minRating = nil
        case .seller: filters.sellers = []
        case .speed: filters.speeds = []
        case .option(let name): filters.options[name] = nil
        }
    }
}

/// The Deals page's shelves — the web's `dealShelves` (`Shared/commerce/deals.ts`),
/// rule for rule, tested on its cases: what is on offer, a shelf per kind of
/// thing (the product's subcategory within its department); a kind with a
/// single deal joins its department's own shelf, which follows the
/// department's kinds; the fullest shelves first, then the departments' and
/// their kinds' own order, products in no department last; the deepest saving
/// leading each shelf unless an order was chosen; `size` cards before View all.
enum DealShelves {
    struct Shelf: Identifiable {
        let key: String
        let department: String?
        let subcategory: String?
        let total: Int
        let products: [Product]
        var id: String { key }
    }

    nonisolated static let size = 12
    nonisolated static let minKind = 2

    nonisolated static func of(_ products: [Product], deepestFirst: Bool, departments: [Department] = ReferenceData.shared.departments) -> [Shelf] {
        func department(of product: Product) -> Department? { departments.first { $0.name == product.productType } }
        // Kinds, in the order first met, to see which can stand alone.
        var kinds: [(key: String, products: [Product])] = []
        func add(_ product: Product, to key: String, in list: inout [(key: String, products: [Product])]) {
            if let at = list.firstIndex(where: { $0.key == key }) { list[at].products.append(product) } else { list.append((key, [product])) }
        }
        for product in products {
            guard let home = department(of: product) else { add(product, to: "other", in: &kinds); continue }
            let kind = product.subcategory.flatMap { home.sub($0)?.slug }
            add(product, to: home.slug + "/" + (kind ?? ""), in: &kinds)
        }
        var shelves: [(key: String, products: [Product])] = []
        for entry in kinds {
            let parts = entry.key.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            let key = entry.key == "other" ? "other" : (parts[1].isEmpty || entry.products.count < minKind) ? parts[0] + "/" : entry.key
            for product in entry.products { add(product, to: key, in: &shelves) }
        }
        func rank(_ shelf: Shelf) -> (Int, Int) {
            guard let slug = shelf.department, let home = departments.first(where: { $0.slug == slug }) else { return (Int.max, Int.max) }
            let order = home.subs.map(\.slug)
            return (home.position, shelf.subcategory.flatMap { order.firstIndex(of: $0) } ?? order.count)
        }
        return shelves.map { entry in
            let parts = entry.key.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            let ordered = deepestFirst
                ? entry.products.enumerated()
                    .sorted { a, b in
                        let left = a.element.bestSaving, right = b.element.bestSaving
                        return left != right ? left > right : a.offset < b.offset
                    }
                    .map(\.element)
                : entry.products
            return Shelf(
                key: entry.key == "other" ? "other" : parts[1].isEmpty ? parts[0] : entry.key,
                department: entry.key == "other" ? nil : parts[0],
                subcategory: entry.key == "other" || parts[1].isEmpty ? nil : parts[1],
                total: entry.products.count,
                products: Array(ordered.prefix(size))
            )
        }
        .sorted { a, b in
            if a.total != b.total { return a.total > b.total }
            let left = rank(a), right = rank(b)
            return left.0 != right.0 ? left.0 < right.0 : left.1 < right.1
        }
    }
}

extension Product {
    /// The best live saving across the variants still for sale, in percent —
    /// `savingPercentOf`, which leads a Deals shelf.
    var bestSaving: Int {
        variants.filter(\.availableForSale).compactMap(\.savingPercent).max() ?? 0
    }
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
    /// The words a search page is for, which its header's field shows.
    var searchTerm: String? {
        if case .search(let words, _) = source { return words }
        return nil
    }
    private(set) var products: LoadState<[Product]> = .idle
    /// One of NetLet's own occasions at this page's address (`occasions.bySlug`):
    /// its names and banner, with the products chosen for it in `chosen`.
    private(set) var curatedOccasion: CuratedOccasion?
    /// A calendar occasion NetLet switched off: its page shows nothing.
    private(set) var occasionHidden = false
    private var chosen: [Product] = []
    /// The catalogue's own spelling, when a search found nothing as typed.
    private(set) var correctedTo: String?
    /// The stores that sell what the page shows, the one selling the most
    /// first — a search's answer, or a subcategory's (`loadStores`) — drawn
    /// at the top of the page, on the owner's word.
    private(set) var stores: [StoreCard] = []
    /// The Deals page's own search (`PageSearchField`): the deals whose words
    /// hold every word typed, never the shop's.
    var pageTerm = ""
    var filters = BrowseFilters()
    var sort: ProductSort = .relevance

    private let catalog: CatalogServicing
    /// The most a shelf asks for — the server's own ceiling.
    static let pageSize = 100
    static let searchLimit = 60

    init(source: Source, catalog: CatalogServicing, sub: String? = nil, occasion: String? = nil) {
        self.source = source
        self.catalog = catalog
        filters.sub = sub
        filters.occasion = occasion
        if case .shelf(_, let view) = source {
            switch view {
            case .all: break
            case .deals:
                filters.onOffer = true
                sort = .discount
            case .newest:
                sort = .newest
            case .topRated:
                sort = .rating
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

    /// The occasion in the page's address, when it is a shelf and not a search.
    private var occasionSlug: String? {
        if case .shelf = source { return filters.occasion }
        return nil
    }

    func load(language: Language) async {
        // A department opened earlier today draws at once and is asked again
        // behind. Not an occasion's page: NetLet may have curated it, taken
        // one of the calendar's over or switched it off, so it waits for the
        // server rather than drawing the calendar's own for a moment.
        if products.value == nil, case .shelf = source, occasionSlug == nil,
           let kept = catalog.rememberedProducts(first: Self.pageSize, department: department?.slug, language: language) {
            products = .loaded(kept)
        }
        if products.value == nil { products = .loading }
        do {
            switch source {
            case .shelf:
                if let occasionSlug {
                    // With no answer the calendar's own rule decides, as it did before there was a desk.
                    async let asked = try? catalog.occasionPage(slug: occasionSlug, language: language)
                    let all = try await catalog.products(first: Self.pageSize, department: department?.slug, language: language)
                    let page = await asked
                    curatedOccasion = page?.occasion
                    occasionHidden = page?.hidden ?? false
                    chosen = page?.products ?? []
                    products = .loaded(all)
                } else {
                    // The server narrows by the category's slug, which is the department's.
                    products = .loaded(try await catalog.products(first: Self.pageSize, department: department?.slug, language: language))
                }
            case .search(let words, let scope):
                let found = try await catalog.search(words, department: scope, limit: Self.searchLimit, language: language)
                correctedTo = found.correctedTo
                stores = found.stores ?? []
                products = .loaded(found.products)
            }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, products.value == nil { products = .failed(failure) }
        }
    }

    /// What the page's filters narrow: the shelf, or — on an occasion's page
    /// — the occasion's own products. One NetLet curated is what it chose, in
    /// its order, then what the stores tagged for it; the calendar's is what
    /// the stores tagged; an address naming no occasion, or one switched off,
    /// is nothing, never everything.
    private var pool: [Product] {
        let all = products.value ?? []
        guard let slug = occasionSlug else { return all }
        if let curatedOccasion { return curatedOccasion.products(chosen: chosen, catalogue: all) }
        guard !occasionHidden, let occasion = ReferenceData.shared.occasion(slug: slug) else { return [] }
        return all.filter { occasion.matches($0) }
    }

    /// The filters once the occasion has narrowed the page by itself.
    private var poolFilters: BrowseFilters {
        var narrowed = filters
        if occasionSlug != nil { narrowed.occasion = nil }
        return narrowed
    }

    /// The default order is the shelf's own, so a curated occasion keeps the
    /// order it was chosen in until the shopper picks another. On the Deals
    /// page its own search narrows the deals, keeping their order.
    var shown: [Product] {
        let narrowed = sort.apply(to: pool.filter(poolFilters.admits))
        let words = SearchRank.queryWords(pageTerm)
        guard isDealsPage, !words.isEmpty else { return narrowed }
        return narrowed.filter { SearchRank.score(SearchRank.doc($0), words) > 0 }
    }

    /// The stores that sell a subcategory, when the page is one. A search's
    /// come with its answer; any other page has none.
    func loadStores(language: Language) async {
        guard case .shelf = source else { return }
        guard let department, let sub = filters.sub else { stores = []; return }
        stores = (try? await catalog.storesSelling(department: department.name, sub: sub, language: language)) ?? []
    }

    /// The Deals page, on the owner's word: the whole shop narrowed to what
    /// is on offer — the Deals tab — drawn as a shelf per kind of thing. "On
    /// offer" is the page rather than a filter on it (`shownFilters`).
    var isDealsPage: Bool {
        if case .shelf(.none, .deals) = source, query == nil { return filters.onOffer }
        return false
    }

    /// The filters as the page shows and counts them: on the Deals page,
    /// without the "On offer" the page itself is — the web's `shownFilters`.
    var shownFilters: BrowseFilters {
        var shown = filters
        if isDealsPage { shown.onOffer = false }
        return shown
    }

    /// A subcategory is the page, so its facets are its own products'; on
    /// the Deals page they are what is on offer, so a brand ticked there has
    /// deals to show.
    var facets: Facets {
        var all = pool
        if isDealsPage { all = all.filter(\.isOnOffer) }
        guard let sub = filters.sub else { return Facets(all) }
        return Facets(all.filter { $0.subcategory == sub })
    }

    /// How many of the shelf's products each subcategory holds — the chips under the title.
    var subcategoryCounts: [String: Int] {
        var counts: [String: Int] = [:]
        for product in products.value ?? [] {
            if let sub = product.subcategory { counts[sub, default: 0] += 1 }
        }
        return counts
    }

    /// The calendar's occasion the page is narrowed to, by its slug
    /// (`activeOccasion`) — unless NetLet's own stands in its place or
    /// switched it off.
    var activeOccasion: Occasion? {
        query == nil && curatedOccasion == nil && !occasionHidden ? ReferenceData.shared.occasion(slug: filters.occasion) : nil
    }

    func clearFilters() {
        // The subcategory or the occasion is the page, not a filter, so it
        // stays; so does "On offer" on the Deals page, which it is.
        let deals = isDealsPage
        filters = BrowseFilters(sub: filters.sub, occasion: filters.occasion)
        filters.onOffer = deals
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
    /// The products this app already holds that answer the words in the box,
    /// best first, while the server is asked for them — the web's
    /// `shelvedProducts`. Nil once the server has answered those words, or
    /// when nothing held matches: a misspelling is the server's to correct.
    private(set) var interim: [Product]?
    /// Where those come from: the home page's shelves, set by the screen.
    @ObservationIgnored var held: @MainActor () -> [Product] = { [] }
    /// Every answer the server gave this search, by its words, so going back
    /// to words already asked draws their answer at once.
    @ObservationIgnored private var earlier: [String: SearchResult] = [:]

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
            interim = nil
            return
        }
        if let known = earlier[words] {
            result = .loaded(known)
            answered = words
            interim = nil
        } else {
            interim = heldAnswer(words)
        }
        let pause = debounce
        pending = Task { [weak self] in
            try? await Task.sleep(for: pause)
            guard !Task.isCancelled else { return }
            await self?.run(words)
        }
    }

    /// The held products and earlier answers ranked for the words by the
    /// shop's own rule (`SearchRank`, the web's `rankBySearch`), or nil when
    /// none of them answers.
    private func heldAnswer(_ words: String) -> [Product]? {
        var seen = Set<String>()
        let pool = (held() + earlier.values.flatMap(\.products)).filter { seen.insert($0.id).inserted }
        let ranked = SearchRank.rank(pool, words)
        return ranked.isEmpty ? nil : Array(ranked.prefix(8))
    }

    func run(_ words: String) async {
        guard !words.isEmpty else { return }
        if result.value == nil { result = .loading }
        do {
            let found = try await catalog.search(words, department: nil, limit: Self.resultLimit, language: language)
            if earlier.count >= 40 { earlier.removeAll() }
            earlier[words] = found
            guard words == trimmed else { return }
            result = .loaded(found)
            answered = words
            interim = nil
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

    /// Into the bag, drawn there at once from the product; true once the
    /// server has it. Only a line with extras waits with a spinner, since the
    /// server prices its extras and it appears with the answer.
    func add(to cart: CartModel, product: Product? = nil) async -> Bool {
        guard let variant, variant.availableForSale else { return false }
        if !addons.isEmpty {
            adding = true
            defer { adding = false }
            return await cart.add(lines: [API.CartLine(variantId: variant.id, quantity: quantity, addonIds: addons.sorted())])
        }
        return await cart.add(variantId: variant.id, quantity: quantity, product: product)
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
