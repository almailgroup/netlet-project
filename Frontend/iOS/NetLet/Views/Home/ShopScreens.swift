import SwiftUI

/// The departments as a page, the phone's Categories tab — the home page's
/// cards made the page's subject, each saying how many products it holds,
/// and Today's deals under them only while the home page would draw them.
struct CategoriesView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ShopPage(root: true, logo: false, refresh: { await app.shelf.load(language: l.current, force: true) }) {
            VStack(alignment: .leading, spacing: 0) {
                Breadcrumbs(trail: [l.t("nav.categories")])
                Text(l.t("nav.categories")).pageTitle().padding(.bottom, 24)
                DepartmentCardGrid(columns: 2, counted: true)
                if app.shelf.dealsDrawn {
                    Button {
                        app.push(.deals)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "tag")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(Brand.navy)
                                .frame(width: 36, height: 36)
                                .background(Circle().fill(Brand.orange))
                            Text(l.t("home.heroDeals"))
                                .font(.inter(15, .bold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "chevron.forward")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 56)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.navy))
                        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    }
                    .buttonStyle(.tap)
                    .padding(.top, 16)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
        }
    }
}

/// What the shopper saved — the hearts, on the account when signed in and on
/// this phone when not — the web's `/saved`.
struct SavedView: View {
    @State private var catalogue: LoadState<[Product]> = .idle
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let ids = app.saved.ids
        let found = (catalogue.value ?? []).filter { ids.contains($0.id) }
            .sorted { (ids.firstIndex(of: $0.id) ?? 0) < (ids.firstIndex(of: $1.id) ?? 0) }
        let missing = catalogue.value == nil ? 0 : max(0, ids.count - found.count)
        ShopPage(refresh: { await load() }) {
            VStack(alignment: .leading, spacing: 0) {
                Breadcrumbs(trail: [l.t("saved.title")])
                Text(l.t("saved.title")).pageTitle()
                Text(ids.isEmpty ? l.t("saved.emptyPrompt") : found.count == 1 ? l.t("saved.countOne") : l.t("saved.count", ["count": "\(found.count)"]))
                    .font(.inter(15))
                    .foregroundStyle(Brand.body)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
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
                    case .idle, .loading: LoadingView()
                    case .failed(let error): ErrorStateView(error: error) { await load() }
                    case .loaded: ProductGrid(products: found)
                    }
                }
                // Under the hearts it learns from, and only once it has learnt
                // something: nothing is drawn until it is personal.
                RecommendedRail()
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
        }
        .task(id: "\(l.current.rawValue)|\(app.saved.ids.count)") { await load() }
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

/// Every store with something on sale, the busiest first — the web's `/stores`.
struct StoresView: View {
    @State private var stores: LoadState<[StoreCard]> = .idle
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ShopPage(refresh: { await load() }) {
            VStack(alignment: .leading, spacing: 0) {
                Breadcrumbs(trail: [l.t("stores.title")])
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
                            LazyVStack(spacing: 12) {
                                ForEach(list) { store in StoreCardView(store: store) }
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
                    Breadcrumbs(trail: [l.t("stores.title")])
                    LoadingView()
                case .failed(let error):
                    Breadcrumbs(trail: [l.t("stores.title")])
                    ErrorStateView(error: error) { await load() }
                case .loaded(let found):
                    if let found {
                        content(found)
                    } else {
                        Breadcrumbs(trail: [l.t("stores.title")])
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
        Breadcrumbs(trail: [l.t("stores.title"), store.name])
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
            delivery = freeOver.map { l.t("stores.deliveryFeeFreeOver", ["fee": fee.formatted(l.current), "threshold": $0.formatted(l.current)]) }
                ?? l.t("stores.deliveryFee", ["fee": fee.formatted(l.current)])
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
                    HStack(spacing: 8) {
                        chip(l.t("stores.allDepartments"), count: found.products.count, key: "")
                        ForEach(departments, id: \.name) { entry in
                            chip(departmentLabel(entry.name), count: entry.count, key: entry.name)
                        }
                    }
                }
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
                .background(Capsule().fill(on ? Brand.navy : Color.white))
                .overlay(Capsule().strokeBorder(on ? Brand.navy : Brand.line, lineWidth: 1))
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
