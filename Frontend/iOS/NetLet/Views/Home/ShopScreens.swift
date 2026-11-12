import SwiftUI

/// The departments as a page, the phone's Categories tab — the department
/// tiles in a row and the chosen one's subcategories under them
/// (`DepartmentBrowser`), and Today's deals under those only while the home
/// page would draw them.
/// **Shop by brand leads it** (`BrandsView`), drawn only while the shop has
/// a brand. Shop by stores stood beside it, and **the stores are under each
/// department now, on the owner's word** ("remove the shop by stores,
/// instead add the stores to the sub category"; `DepartmentBrowser`).
///
/// **Its search searches the page, on the owner's word** ("the search bar
/// should only search for what's in the specific page"): the header's field
/// reads "Search categories and stores" here (`PageSearchField`), and typing
/// puts the departments, the subcategories (by their names and the words they
/// are called by) and the stores that answer in place of the tiles, with the
/// shop's own search a press away when nothing does — the web's `/categories`.
struct CategoriesView: View {
    @State private var term = ""
    /// Every store, for the page's own search, asked the first time it is used.
    @State private var allStores: [StoreCard]?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let words = term.trimmingCharacters(in: .whitespacesAndNewlines)
        ShopPage(root: true, logo: false, refresh: { await app.shelf.load(language: l.current, force: true) },
                 pageSearch: PageSearch(text: $term, placeholder: "search.inCategories")) {
            VStack(alignment: .leading, spacing: 0) {
                Text(l.t("nav.categories")).pageTitle()
                if !words.isEmpty {
                    CategoriesResults(term: words, stores: allStores) { slug in
                        // The page itself again, opened on that department.
                        app.categoriesOpen = slug
                        term = ""
                    }
                        .padding(.top, 20)
                        .padding(.bottom, 48)
                } else {
                    shopWays
                        .padding(.top, 20)
                    ShelfHeading(title: l.t("home.shopByCategory"))
                        .padding(.top, 26)
                        .padding(.bottom, 16)
                    DepartmentBrowser()
                        .padding(.bottom, 48)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
        }
        .task(id: words.isEmpty ? "" : l.current.rawValue) {
            guard !words.isEmpty else { return }
            // A store list that cannot be read finds no store, rather than
            // holding "nothing matches" back for ever.
            allStores = (try? await app.services.api.call(API.stores, .init(locale: l.current.rawValue, limit: 200))) ?? []
        }
    }

    /// The ways into the whole shop, over the departments — the row Amazon and
    /// noon open their categories on, the web's `ShopWays`: Today's deals
    /// while the home page draws that shelf, Shop by brand while there is a
    /// brand, the stores, the newest and everything. A sideways row.
    private var shopWays: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if app.shelf.dealsDrawn {
                    way(symbol: "tag", title: l.t("home.heroDeals"), strong: true) { app.push(.deals) }
                }
                if !app.shelf.brands.isEmpty {
                    way(symbol: "tag.circle", title: l.t("home.shopByBrand")) { app.push(.brands) }
                }
                way(symbol: "storefront", title: l.t("stores.title")) { app.push(.stores) }
                way(symbol: "sparkles", title: l.t("browse.sort.newest")) { app.push(.newest) }
                way(symbol: "line.3.horizontal", title: l.t("nav.allDepartments")) { app.push(.department(slug: nil)) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
        .padding(.horizontal, -16)
        .glassRow()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("categories.waysToShop"))
    }

    private func way(symbol: String, title: String, strong: Bool = false, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            HStack(spacing: 7) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(strong ? Color(red: 1, green: 171 / 255, blue: 133 / 255) : Brand.navy)
                    .accessibilityHidden(true)
                Text(title).lineLimit(1)
            }
            .font(.inter(14, .bold))
            .foregroundStyle(strong ? Color.white : Brand.navy)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .glassChip(chosen: strong)
        }
        .buttonStyle(.tap)
    }
}

/// What the shopper saved — the hearts, on the account when signed in and on
/// this phone when not — the web's `/saved`.
struct SavedView: View {
    /// The two tabs, on the owner's word ("make it Saved items and wishlists,
    /// so both will be in one") — the web's `/saved` and its `?tab=wishlists`.
    enum Showing: Hashable { case saved, wishlists }
    @State private var tab: Showing
    @State private var catalogue: LoadState<[Product]> = .idle
    /// The products chosen for Move to cart or Remove — the web's circles,
    /// on the owner's word ("a multiple selection option for the pages that
    /// need it").
    @State private var chosen: Set<String> = []
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    init(initialTab: Showing = .saved) {
        _tab = State(initialValue: initialTab)
    }

    var body: some View {
        let ids = app.saved.ids
        let found = (catalogue.value ?? []).filter { ids.contains($0.id) }
            .sorted { (ids.firstIndex(of: $0.id) ?? 0) < (ids.firstIndex(of: $1.id) ?? 0) }
        let missing = catalogue.value == nil ? 0 : max(0, ids.count - found.count)
        ShopPage(refresh: { if tab == .saved { await load() } }) {
            VStack(alignment: .leading, spacing: 0) {
                Text(l.t("saved.andWishlists")).pageTitle()
                TextTabs(tabs: [TextTab(id: Showing.saved, label: l.t("footer.savedItems")), TextTab(id: Showing.wishlists, label: l.t("saved.tabWishlists"))], selection: tab) { tab = $0 }
                    .padding(.top, 12)
                if tab == .wishlists {
                    WishlistsTab().padding(.top, 20)
                } else {
                Text(ids.isEmpty ? l.t("saved.emptyPrompt") : found.count == 1 ? l.t("saved.countOne") : l.t("saved.count", ["count": "\(found.count)"]))
                    .font(.inter(15))
                    .foregroundStyle(Brand.body)
                    .padding(.top, 16)
                    .padding(.bottom, 20)
                if missing > 0 {
                    Text(missing == 1 ? l.t("saved.unavailableOne") : l.t("saved.unavailableCount", ["count": "\(missing)"]))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .padding(.bottom, 16)
                }
                if ids.isEmpty {
                    EmptyStateView(systemImage: "heart", title: l.t("saved.emptyTitle"), note: l.t("saved.emptyNote"), actionTitle: l.t("saved.browse")) {
                        app.push(.department(slug: nil))
                    }
                    .card(padding: 0)
                } else {
                    switch catalogue {
                    case .idle, .loading: GridSkeleton(cards: min(ids.count, 4))
                    case .failed(let error): ErrorStateView(error: error) { await load() }
                    // Each to the cart or a wishlist, on the owner's word —
                    // the cart's own saved card, two to a row.
                    case .loaded:
                        let picked = found.filter { chosen.contains($0.id) }
                        if !found.isEmpty {
                            FlowLayout(spacing: 8) {
                                ChoiceAll(state: picked.isEmpty ? .none : picked.count == found.count ? .all : .some) { all in
                                    chosen = all ? Set(found.map(\.id)) : []
                                }
                                if !picked.isEmpty {
                                    ChoicePill(title: l.t("saved.moveChosen", ["count": "\(picked.count)"]), filled: true, systemImage: "bag") {
                                        moveChosen(picked)
                                    }
                                    ChoicePill(title: l.t("saved.removeChosen", ["count": "\(picked.count)"])) {
                                        removeChosen(picked)
                                    }
                                }
                            }
                            .padding(.bottom, 12)
                        }
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                            ForEach(found) { product in
                                SavedProductCard(product: product, grid: true, choice: SavedProductCard.Choice(chosen: chosen.contains(product.id)) { next in
                                    if next { chosen.insert(product.id) } else { chosen.remove(product.id) }
                                })
                            }
                        }
                    }
                }
                // Under the hearts it learns from, and only once it has learnt
                // something: nothing is drawn until it is personal.
                RecommendedRail()
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
        }
        .task(id: "\(l.current.rawValue)|\(app.saved.ids.count)") { await load() }
    }

    /// Each chosen product that can go in the bag as it is (one option, in
    /// stock) out of Saved and into the bag, as its card's own Move to cart
    /// does; the rest stay chosen, and the toast says so.
    private func moveChosen(_ picked: [Product]) {
        let app = self.app
        let movable = picked.filter { $0.variants.count <= 1 && $0.variants.contains(where: \.availableForSale) }
        let stayed = picked.filter { product in !movable.contains(where: { $0.id == product.id }) }
        chosen = Set(stayed.map(\.id))
        let failed = l.t("cart.addFailed")
        let said = movable.isEmpty
            ? l.t("saved.someStayed")
            : l.t("saved.movedChosen") + (stayed.isEmpty ? "" : " " + l.t("saved.someStayed"))
        app.toast(said)
        Task {
            for product in movable {
                guard let variant = product.variants.first(where: \.availableForSale) else { continue }
                await app.saved.unsave(product.id)
                let added = await app.cart.add(variantId: variant.id, quantity: 1, product: product)
                if !added {
                    Haptics.refused()
                    await app.saved.save(product.id)
                    app.toast(failed)
                }
            }
        }
    }

    /// The chosen products out of Saved, with Undo in the toast.
    private func removeChosen(_ picked: [Product]) {
        let app = self.app
        let gone = picked.map(\.id)
        chosen = []
        Task {
            for id in gone { await app.saved.unsave(id) }
        }
        app.toast(l.t("saved.removedChosen"), undo: {
            Task { for id in gone { await app.saved.save(id) } }
        })
    }

    /// The saved products by id (`commerce.products.byIds`) — looked up in the
    /// newest page instead, anything older read as no longer available.
    private func load() async {
        if catalogue.value == nil { catalogue = .loading }
        do {
            let ids = Array(app.saved.ids.prefix(200))
            catalogue = .loaded(ids.isEmpty ? [] : try await app.services.api.call(API.productsByIds, .init(ids: ids, locale: l.current.rawValue)))
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, catalogue.value == nil { catalogue = .failed(failure) }
        }
    }
}

/// Every brand on the shelf — what "Shop by brand" opens, the web's `/brands`:
/// the same read the home shelf keeps (`HomeShelf.brands`), each a rounded
/// square opening everything of that brand, three to a row like the stores.
struct BrandsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let brands = app.shelf.brands
        ShopPage(refresh: { await app.shelf.load(language: l.current, force: true) }) {
            VStack(alignment: .leading, spacing: 0) {
                Text(l.t("brands.title")).pageTitle()
                Text(l.t("brands.note"))
                    .font(.inter(15))
                    .foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
                Group {
                    if brands.isEmpty {
                        EmptyStateView(systemImage: "tag", title: l.t("brands.empty"), note: l.t("brands.emptyNote"))
                            .card(padding: 0)
                    } else {
                        TileGrid(spacing: 12, columns: 3, widest: 150, rowSpacing: 18) {
                            ForEach(brands) { brand in BrandTile(brand: brand) }
                        }
                    }
                }
                .padding(.top, 24)
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
        }
    }
}

/// Every store with something on sale, the busiest first — the web's `/stores`,
/// as rounded squares three to a row on the owner's word (`StoreTile`): it was
/// a list, a row a store.
struct StoresView: View {
    @State private var stores: LoadState<[StoreCard]> = .idle
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ShopPage(refresh: { await load() }) {
            VStack(alignment: .leading, spacing: 0) {
                Text(l.t("stores.title")).pageTitle()
                if let list = stores.value {
                    Text(list.count == 1 ? l.t("stores.countOne") : l.t("stores.countMany", ["count": "\(list.count)"]))
                        .font(.inter(15))
                        .foregroundStyle(Brand.body)
                        .padding(.top, 8)
                }
                Group {
                    switch stores {
                    case .idle, .loading:
                        LoadingView()
                    case .failed(let error):
                        ErrorStateView(error: error) { await load() }
                    case .loaded(let list):
                        if list.isEmpty {
                            EmptyStateView(systemImage: "storefront", title: l.t("stores.empty"), note: l.t("stores.emptyNote"))
                                .card(padding: 0)
                        } else {
                            TileGrid(spacing: 12, columns: 3, widest: 150, rowSpacing: 18) {
                                ForEach(list) { store in StoreTile(store: store) }
                            }
                        }
                    }
                }
                .padding(.top, 24)
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
        }
        .task(id: l.current) { await load() }
    }

    private func load() async {
        if stores.value == nil { stores = .loading }
        do {
            stores = .loaded(try await app.services.catalog.stores(language: l.current))
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, stores.value == nil { stores = .failed(failure) }
        }
    }
}

/// One store as a shopper would ask about it — who it is, what it says about
/// itself, where it is, how it delivers, how its customers rated it — and its
/// whole live shelf, narrowed by its departments. The web's `/stores/<slug>`.
struct StoreView: View {
    let slug: String
    @State private var page: LoadState<StorePage?> = .idle
    @State private var department = ""
    @State private var sort: ProductSort = .relevance
    /// Words searched for inside this store, past a dozen products.
    @State private var term = ""
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ShopPage(refresh: { await load() }) {
            VStack(alignment: .leading, spacing: 0) {
                switch page {
                case .idle, .loading:
                    LoadingView()
                case .failed(let error):
                    ErrorStateView(error: error) { await load() }
                case .loaded(let found):
                    if let found {
                        content(found)
                    } else {
                        EmptyStateView(systemImage: "storefront", title: l.t("stores.notFound"), note: l.t("stores.notFoundNote"), actionTitle: l.t("stores.seeAll")) {
                            app.push(.stores)
                        }
                        .card(padding: 0)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
        }
        .task(id: l.current) { await load() }
    }

    @ViewBuilder
    private func content(_ found: StorePage) -> some View {
        let store = found.store
        profile(store)
        products(found)
        if !found.reviews.isEmpty {
            reviews(found.reviews, rating: store.rating)
        }
    }

    private func profile(_ store: StorePage.Profile) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 16) {
                StoreMark(name: store.name, logoUrl: store.logoUrl, large: true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(store.name).pageTitle()
                    FlowLayout(spacing: 6) {
                        if let rating = store.rating {
                            StoreRating(rating: rating)
                            Text("·")
                        }
                        Text(l.t(store.products == 1 ? "home.brandCountOne" : "home.brandCountMany", ["count": "\(store.products)"]))
                        if let zone = ReferenceData.shared.governorate(id: store.governorate) {
                            Text("·")
                            Label(zone.name(l.current), systemImage: "mappin").labelStyle(.titleAndIcon)
                        }
                        Text("·")
                        Text(l.t("stores.since", ["date": since(store.since)]))
                    }
                    .font(.inter(14))
                    .foregroundStyle(Brand.muted)
                    StoreBadges(badges: store.badges).padding(.top, 4)
                }
            }
            if let description = store.description {
                Text(description)
                    .font(.inter(15))
                    .lineSpacing(5)
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 20)
            }
            Rectangle().fill(Brand.tint).frame(height: 1).padding(.top, 20)
            FlowLayout(spacing: 8) {
                ForEach(facts(store), id: \.label) { fact in
                    HStack(spacing: 8) {
                        Image(systemName: fact.symbol).font(.system(size: 14, weight: .semibold)).foregroundStyle(Brand.accentInk)
                        Text(fact.label).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(Color(red: 243 / 255, green: 245 / 255, blue: 249 / 255)))
                }
            }
            .padding(.top, 20)
        }
        .card(padding: 20)
    }

    private struct Fact: Hashable {
        let symbol: String
        let label: String
    }

    private struct DepartmentCount: Hashable {
        let name: String
        let count: Int
    }

    private func facts(_ store: StorePage.Profile) -> [Fact] {
        let fee = store.delivery.flat.flatMap { Money(amount: $0) }.flatMap { $0.fils > 0 ? $0 : nil }
        let freeOver = store.delivery.freeOver.flatMap { Money(amount: $0) }.flatMap { $0.fils > 0 ? $0 : nil }
        // What checkout charges: no fee recorded is free delivery, never a number the store did not type.
        let delivery: String
        if let fee {
            delivery = freeOver.map { l.t("stores.deliveryFeeFreeOver", ["fee": l.price(fee), "threshold": l.price($0)]) }
                ?? l.t("stores.deliveryFee", ["fee": l.price(fee)])
        } else {
            delivery = l.t("stores.deliveryFree")
        }
        var facts = [Fact(symbol: "truck.box", label: delivery)]
        if let speed = store.delivery.speed { facts.append(Fact(symbol: "bolt", label: l.t("speed.\(speed)"))) }
        if store.delivery.cashOnDelivery { facts.append(Fact(symbol: "wallet.pass", label: l.t("home.payOnDelivery"))) }
        return facts
    }

    private func since(_ iso: String) -> String {
        let reader = ISO8601DateFormatter()
        reader.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = reader.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = l.current.locale
        formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
        formatter.setLocalizedDateFormatFromTemplate("MMMMyyyy")
        return formatter.string(from: date)
    }

    @ViewBuilder
    private func products(_ found: StorePage) -> some View {
        let departments = storeDepartments(found.products)
        let inDepartment = found.products.filter { department.isEmpty || ($0.productType ?? "") == department }
        let shelf = narrowed(inDepartment)
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(l.t("stores.products")).shelfTitle()
                Spacer()
                Menu {
                    Picker(l.t("browse.sortBy"), selection: $sort) {
                        ForEach(ProductSort.allCases) { option in Text(l.t(option.labelKey)).tag(option) }
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.up.arrow.down").font(.system(size: 13, weight: .semibold))
                        Text(l.t(sort.labelKey)).lineLimit(1)
                    }
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 40)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                }
                .accessibilityLabel(l.t("browse.sortBy"))
                .onChange(of: sort) { Haptics.tap() }
            }
            if found.products.count > Self.searchFrom {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Brand.muted)
                        .accessibilityHidden(true)
                    TextField(l.t("stores.searchPlaceholder"), text: $term)
                        .font(.inter(16))
                        .foregroundStyle(Brand.navy)
                        .submitLabel(.search)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .accessibilityLabel(l.t("stores.searchLabel", ["name": found.store.name]))
                }
                .padding(.horizontal, 12)
                .frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            }
            if departments.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    GlassGroup {
                        HStack(spacing: 8) {
                            chip(l.t("stores.allDepartments"), count: found.products.count, key: "")
                            ForEach(departments, id: \.name) { entry in
                                chip(departmentLabel(entry.name), count: entry.count, key: entry.name)
                            }
                        }
                    }
                }
                .glassRow()
                .accessibilityLabel(l.t("stores.departments"))
            }
            if found.products.isEmpty {
                EmptyStateView(systemImage: "shippingbox", title: l.t("stores.emptyShelf"), note: l.t("stores.emptyShelfNote"), actionTitle: l.t("stores.seeAll")) {
                    app.push(.stores)
                }
                .card(padding: 0)
            } else if shelf.isEmpty {
                EmptyStateView(systemImage: "magnifyingglass", title: l.t("stores.noMatch"), note: l.t("stores.noMatchNote"), actionTitle: l.t("stores.showEverything")) {
                    department = ""
                    term = ""
                }
                .card(padding: 0)
            } else {
                ProductGrid(products: shelf)
                if found.products.count < found.store.products {
                    Text(l.t("stores.newestOf", ["shown": "\(found.products.count)", "total": "\(found.store.products)"]))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                }
            }
        }
        .padding(.top, 32)
    }

    /// The shelf searched by the shop's one rule; a chosen sort still wins
    /// over the ranking.
    private func narrowed(_ products: [Product]) -> [Product] {
        let words = term.trimmingCharacters(in: .whitespacesAndNewlines)
        if words.isEmpty { return sort.apply(to: products) }
        let ranked = SearchRank.rank(products, words)
        return sort == .relevance ? ranked : sort.apply(to: ranked)
    }

    /// A store's shelf is searched from a dozen products up (`SEARCH_FROM`).
    private static let searchFrom = 12

    private func storeDepartments(_ products: [Product]) -> [DepartmentCount] {
        var counts: [String: Int] = [:]
        var order: [String] = []
        for product in products {
            guard let type = product.productType, !type.isEmpty else { continue }
            if counts[type] == nil { order.append(type) }
            counts[type, default: 0] += 1
        }
        return order.map { DepartmentCount(name: $0, count: counts[$0] ?? 0) }
    }

    private func departmentLabel(_ name: String) -> String {
        ReferenceData.shared.department(named: name).map { l.t($0.label) } ?? name
    }

    private func chip(_ label: String, count: Int, key: String) -> some View {
        let on = department == key
        return Button {
            department = key
        } label: {
            Text("\(label) · \(count)")
                .font(.inter(13, .bold))
                .foregroundStyle(on ? .white : Brand.navy)
                .padding(.horizontal, 14)
                .frame(minHeight: 40)
                .glassChip(chosen: on)
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }

    private func reviews(_ reviews: [StorePage.Review], rating: StoreCard.Rating?) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(l.t("stores.reviewsTitle")).shelfTitle()
                if let rating { StoreRating(rating: rating) }
            }
            ForEach(reviews) { review in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 2) {
                        ForEach(1...5, id: \.self) { star in
                            Image(systemName: star <= review.rating ? "star.fill" : "star")
                                .font(.system(size: 12))
                                .foregroundStyle(star <= review.rating ? Brand.star : Brand.line)
                        }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(l.t("product.ratingAria", ["value": "\(review.rating)", "max": "5"]))
                    if let title = review.title, !title.isEmpty {
                        Text(title).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                    }
                    if let body = review.body, !body.isEmpty {
                        Text(body).font(.inter(14)).lineSpacing(4).foregroundStyle(Brand.ink).lineLimit(4)
                    }
                    Text("\(review.author) · \(review.productTitle)")
                        .font(.inter(12.5))
                        .foregroundStyle(Brand.muted)
                        .padding(.top, 4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card(padding: 16)
            }
        }
        .padding(.top, 40)
    }

    private func load() async {
        if page.value == nil { page = .loading }
        do {
            page = .loaded(try await app.services.catalog.store(slug: slug, language: l.current))
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, page.value == nil { page = .failed(failure) }
        }
    }
}
