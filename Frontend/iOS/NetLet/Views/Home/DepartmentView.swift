import SwiftUI

/// A department's shelf — or the whole catalogue, or a view of it: what is
/// on offer, what is new, one brand. The web's `/category/<slug>`.
struct DepartmentView: View {
    let slug: String?
    var view: ShelfView = .all
    /// One of the department's subcategories to open on, the web's `?sub=`.
    var sub: String? = nil
    /// A tab's first screen — the Deals tab's — with no way back to draw.
    var root = false
    @Environment(AppModel.self) private var app

    var body: some View {
        ModelHost(make: { BrowseModel(source: .shelf(slug: slug, view: view), catalog: app.services.catalog, sub: sub) }) { model in
            BrowsePage(model: model, root: root)
        }
    }
}

/// A search's results, the web's `/search?q=`: the same page as a department,
/// over what the server's search found in the whole catalogue.
struct SearchResultsView: View {
    let query: String
    /// One department to search within, or nil for the whole shop.
    var department: String? = nil
    @Environment(AppModel.self) private var app

    var body: some View {
        ModelHost(make: { BrowseModel(source: .search(query, department: department), catalog: app.services.catalog) }) { model in
            BrowsePage(model: model)
        }
    }
}

/// The Deals page's shelves, after the owner's picture: what is on offer, a
/// shelf per kind of thing (`DealShelves`), each its name, View all — that
/// kind's department narrowed to it and to what is on offer — and a sideways
/// row of cards (`ProductRail`). The web's `DealShelves`.
private struct DealShelvesView: View {
    let shelves: [DealShelves.Shelf]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(shelves) { shelf in
                ProductRail(title: title(shelf), products: shelf.products, viewAll: viewAll(shelf))
            }
        }
        // The rails carry their own side room; the page's is given back.
        .padding(.horizontal, -16)
        .padding(.top, -24)
    }

    private func title(_ shelf: DealShelves.Shelf) -> String {
        let department = ReferenceData.shared.department(slug: shelf.department)
        if let department, let kind = department.sub(shelf.subcategory) { return kind.shown(l.current) }
        if let department { return l.t(department.label) }
        return l.t("browse.moreDeals")
    }

    private func viewAll(_ shelf: DealShelves.Shelf) -> (() -> Void)? {
        guard let slug = shelf.department else { return nil }
        return { app.push(.dealsIn(department: slug, sub: shelf.subcategory)) }
    }
}

/// Which sheet the page has open: every filter, one group of them, or the sort.
private enum BrowseSheet: Identifiable {
    case filters(FilterGroupKey?)
    case sort

    var id: String {
        switch self {
        case .filters(let group): return "filters:" + (group?.id ?? "all")
        case .sort: return "sort"
        }
    }
}

/// The page both draw: where it sits, its name with how many products under
/// it, the subcategories, a row of filter chips, the chips of what is ticked,
/// and the grid — and floating over the tab bar, a navy Sort | Filter pill.
/// Both after the owner's reference: each chip opens its own group, and the
/// pill is always in reach, where a Filters row in the page went up under the
/// header with the first scroll. The assistant folds to its mark beside the
/// pill, the reference's round button, rather than leaving the page.
private struct BrowsePage: View {
    @Bindable var model: BrowseModel
    var root = false
    @State private var sheet: BrowseSheet?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        ShopPage(root: root, logo: false, refresh: { await model.load(language: l.current) }, assistant: true, assistantFolded: true, searchTerm: model.searchTerm) {
            VStack(alignment: .leading, spacing: 0) {
                Breadcrumbs(trail: activeSub.map { [departmentName, $0.shown(l.current)] } ?? [crumb])
                Text(title)
                    .pageTitle()
                    .fixedSize(horizontal: false, vertical: true)
                    // What the UI tests read the page by.
                    .accessibilityIdentifier("page-title")
                Text(countLine)
                    .font(.inter(15))
                    .foregroundStyle(Brand.body)
                    .padding(.top, 8)
                    .accessibilityAddTraits(.updatesFrequently)
                subcategoryRow
                filterChips
                chips
                    .padding(.top, 12)
                results
                    .padding(.top, 16)
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(alignment: .bottom) { sortFilterPill }
        .sheet(item: $sheet) { open in
            Group {
                switch open {
                case .filters(let group):
                    FilterSheet(model: model, only: group)
                        .presentationDetents(group == nil ? [.large] : [.medium, .large])
                case .sort:
                    SortSheet(model: model)
                        .presentationDetents([.medium])
                }
            }
            .environment(\.layoutDirection, l.layoutDirection)
            .buttonStyle(HapticDefaultStyle())
            .presentationDragIndicator(.visible)
        }
        .task(id: l.current) { await model.load(language: l.current) }
        .onAppear {
            // A screenshot's sheet (`browseSheet:` in `AppModel.openScreen`).
            guard let start = app.browseSheetStart else { return }
            app.browseSheetStart = nil
            sheet = start == "sort" ? .sort : .filters(start == "all" ? nil : FilterGroupKey(id: start))
        }
    }

    // MARK: Words

    private var departmentName: String {
        model.department.map { l.t($0.label) } ?? l.t("browse.allProducts")
    }

    private var crumb: String {
        if model.isDealsPage { return l.t("nav.deals") }
        return model.query == nil ? departmentName : l.t("browse.searchCrumb")
    }

    /// The subcategory the page is narrowed to, by its department.
    private var activeSub: Department.Subcategory? {
        model.query == nil ? model.department?.sub(model.filters.sub) : nil
    }

    private var title: String {
        if let query = model.query { return l.t("browse.searchTitle", ["query": query]) }
        if let activeSub { return activeSub.shown(l.current) }
        if model.isDealsPage { return l.t("nav.deals") }
        guard model.department == nil, case .shelf(_, let view) = model.source else { return departmentName }
        // The view's own name while it is exactly that view and nothing more.
        switch view {
        case .newest where model.filters.activeCount == 0 && model.sort == .newest: return l.t("footer.newArrivals")
        case .brand(let name) where model.filters.activeCount == 1 && model.filters.brands == [name]: return name
        default: return departmentName
        }
    }

    private var countLine: String {
        guard model.products.value != nil else { return " " }
        return l.productCount(model.shown.count)
    }

    private var filtersLabel: String {
        let count = model.shownFilters.activeCount
        return count > 0 ? l.t("browse.filtersWithCount", ["count": "\(count)"]) : l.t("browse.filters")
    }

    // MARK: Sort and filter

    /// The filter groups as chips, the owner's reference: each opens its own
    /// group, and one with something ticked says how many.
    @ViewBuilder
    private var filterChips: some View {
        let groups = FilterGroups.of(model.facets, model.shownFilters)
        if !groups.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(groups) { group in filterChip(group) }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
            }
            .padding(.horizontal, -16)
            .padding(.top, 16)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("browse.filterBy"))
        }
    }

    private func filterChip(_ group: FilterGroups.Group) -> some View {
        let on = group.active > 0
        let name = group.key.chipLabel(l)
        return Button {
            sheet = .filters(group.key)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: group.key.symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .accessibilityHidden(true)
                Text(name).lineLimit(1)
                if on {
                    Text("\(group.active)")
                        .font(.inter(12, .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(Capsule().fill(Brand.navy))
                }
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
            }
            .font(.inter(14, on ? .bold : .semibold))
            .foregroundStyle(Brand.navy)
            .padding(.leading, 14)
            .padding(.trailing, 12)
            .frame(minHeight: 44)
            .background(Capsule().fill(on ? Brand.tint : Color.white))
            .overlay(Capsule().strokeBorder(on ? Brand.navy : Brand.line, lineWidth: on ? 1.5 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 22))
        .accessibilityLabel(on ? "\(name), \(group.active)" : name)
    }

    /// Sort and Filter, one navy pill over the tab bar, riding down with it
    /// when it slides away — centred in what the assistant's mark leaves of
    /// the foot of the screen, with a dot on Filter while anything is ticked.
    private var sortFilterPill: some View {
        HStack(spacing: 0) {
            Button {
                sheet = .sort
            } label: {
                HStack(spacing: 8) {
                    Text(l.t("browse.sort"))
                    Image(systemName: "arrow.up.arrow.down").font(.system(size: 14, weight: .bold))
                }
                .padding(.leading, 20)
                .padding(.trailing, 16)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
            }
            .accessibilityLabel(l.t("browse.sortBy") + ": " + l.t(model.sort.labelKey))
            Rectangle()
                .fill(Color.white.opacity(0.3))
                .frame(width: 1, height: 24)
                .accessibilityHidden(true)
            Button {
                sheet = .filters(nil)
            } label: {
                HStack(spacing: 8) {
                    Text(l.t("browse.filter"))
                    Image(systemName: "line.3.horizontal.decrease").font(.system(size: 14, weight: .bold))
                }
                .padding(.leading, 16)
                .padding(.trailing, 20)
                .frame(maxHeight: .infinity)
                .overlay(alignment: .topTrailing) {
                    if model.shownFilters.activeCount > 0 {
                        NoticeDot()
                            .padding(.top, 9)
                            .padding(.trailing, 13)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .contentShape(Rectangle())
            }
            .accessibilityLabel(filtersLabel)
        }
        .font(.inter(15, .bold))
        .foregroundStyle(.white)
        .frame(height: 50)
        .background(Capsule().fill(Brand.navy).shadow(color: Brand.navy.opacity(0.28), radius: 15, x: 0, y: 10))
        .buttonStyle(.tap)
        .animation(still ? nil : .spring(response: 0.3, dampingFraction: 0.7), value: model.shownFilters.activeCount > 0)
        .frame(maxWidth: .infinity)
        .padding(.leading, 16)
        // The assistant's mark is 50 points at the end, 16 from the edge.
        .padding(.trailing, app.assistantOn ? 16 + 50 + 12 : 16)
        .padding(.bottom, 16)
        .offset(y: app.tabBarRide)
    }

    // MARK: What is ticked

    private struct Chip: Identifiable {
        let id: String
        let label: String
        let remove: (inout BrowseFilters) -> Void
    }

    private var activeChips: [Chip] {
        let filters = model.shownFilters
        var chips: [Chip] = []
        if filters.inStock { chips.append(Chip(id: "stock", label: l.t("browse.inStock")) { $0.inStock = false }) }
        if filters.onOffer { chips.append(Chip(id: "offer", label: l.t("browse.onOffer")) { $0.onOffer = false }) }
        if filters.express { chips.append(Chip(id: "express", label: l.t("browse.expressOnly")) { $0.express = false }) }
        for brand in filters.brands.sorted() {
            chips.append(Chip(id: "brand:" + brand, label: brand) { $0.brands.remove(brand) })
        }
        for seller in filters.sellers.sorted() {
            chips.append(Chip(id: "seller:" + seller, label: seller) { $0.sellers.remove(seller) })
        }
        for speed in Facets.speedOrder where filters.speeds.contains(speed) {
            chips.append(Chip(id: "speed:" + speed, label: l.t("speed.\(speed)")) { $0.speeds.remove(speed) })
        }
        if filters.minPrice != nil || filters.maxPrice != nil {
            chips.append(Chip(id: "price", label: priceLabel(filters)) {
                $0.minPrice = nil
                $0.maxPrice = nil
            })
        }
        for (name, values) in filters.options.sorted(by: { $0.key < $1.key }) {
            for value in values.sorted() {
                chips.append(Chip(id: "option:\(name):\(value)", label: value) { $0.options[name]?.remove(value) })
            }
        }
        if let stars = filters.minRating {
            chips.append(Chip(id: "rating", label: l.t("browse.ratingAndUp", ["stars": "\(stars)"])) { $0.minRating = nil })
        }
        return chips
    }

    /// "5 – 20", "From 5" or "Up to 20", the web's chip.
    private func priceLabel(_ filters: BrowseFilters) -> String {
        let low = filters.minPrice.map(UnitWording.number)
        let high = filters.maxPrice.map(UnitWording.number)
        if let low, let high { return "\(low) – \(high)" }
        if let low { return l.t("browse.priceFrom", ["min": low]) }
        return l.t("browse.priceUpTo", ["max": high ?? "0"])
    }

    /// The department's subcategories, on the owner's word — the web's chips
    /// under the title: those with something on this shelf and the one the
    /// page is narrowed to; a press narrows it and "All" widens it again.
    @ViewBuilder
    private var subcategoryRow: some View {
        let counts = model.subcategoryCounts
        let subs = (model.query == nil ? model.department?.subs ?? [] : [])
            .filter { (counts[$0.slug] ?? 0) > 0 || $0.slug == model.filters.sub }
        if !subs.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    subChip(title: l.t("categories.allSub"), count: model.products.value?.count ?? 0, slug: nil)
                    ForEach(subs) { entry in
                        subChip(title: entry.shown(l.current), count: counts[entry.slug] ?? 0, slug: entry.slug)
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.horizontal, -16)
            .padding(.top, 16)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("categories.subcategories"))
        }
    }

    private func subChip(title: String, count: Int, slug: String?) -> some View {
        let pressed = model.filters.sub == slug
        return Button {
            withAnimation(still ? nil : .snappy(duration: 0.2)) { model.filters.sub = slug }
        } label: {
            HStack(spacing: 6) {
                Text(title).lineLimit(1)
                Text("\(count)").foregroundStyle(pressed ? Color.white.opacity(0.8) : Brand.muted)
            }
            .font(.inter(14, .semibold))
            .foregroundStyle(pressed ? Color.white : Brand.navy)
            .padding(.horizontal, 16)
            .frame(minHeight: 40)
            .background(Capsule().fill(pressed ? Brand.navy : Color.white))
            .overlay(Capsule().strokeBorder(pressed ? Brand.navy : Brand.line, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(pressed ? .isSelected : [])
    }

    @ViewBuilder
    private var chips: some View {
        let ticked = activeChips
        if !ticked.isEmpty {
            FlowLayout(spacing: 8) {
                ForEach(ticked) { chip in
                    Button {
                        chip.remove(&model.filters)
                    } label: {
                        HStack(spacing: 6) {
                            Text(chip.label).lineLimit(1)
                            Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                        }
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 36)
                        .background(Capsule().fill(Brand.tint))
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("browse.remove", ["name": chip.label]))
                }
                Button(l.t("browse.clearAll")) { model.clearFilters() }
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.accentInk)
                    .frame(minHeight: 36)
            }
        }
    }

    // MARK: The grid

    @ViewBuilder
    private var results: some View {
        switch model.products {
        case .idle, .loading:
            GridSkeleton()
        case .failed(let error):
            ErrorStateView(error: error) { await model.load(language: l.current) }
        case .loaded:
            let shown = model.shown
            if let corrected = model.correctedTo, !corrected.isEmpty, !shown.isEmpty {
                Text(l.t("browse.showingFor", ["term": corrected]))
                    .font(.inter(14))
                    .foregroundStyle(Brand.body)
                    .padding(.bottom, 12)
            }
            // Paid placements for this department: a strip of their own above
            // the grid, so the grid stays in the order the shopper chose.
            if case .shelf(let slug?, .all) = model.source, model.query == nil {
                SponsoredShelf(slot: "department", departmentSlug: slug)
            }
            if shown.isEmpty {
                empty
            } else if model.isDealsPage {
                DealShelvesView(shelves: DealShelves.of(shown, deepestFirst: model.sort == .relevance))
            } else {
                ProductGrid(products: shown)
            }
        }
    }

    @ViewBuilder
    private var empty: some View {
        if model.isDealsPage, model.shownFilters.activeCount == 0 {
            // The Deals tab with nothing on offer: not a filter the shopper set.
            EmptyStateView(systemImage: "tag", title: l.t("browse.noDeals"), note: l.t("browse.noDealsNote"), actionTitle: l.t("browse.browseEverything")) {
                app.push(.department(slug: nil))
            }
        } else if model.shownFilters.activeCount > 0 {
            EmptyStateView(systemImage: "line.3.horizontal.decrease.circle", title: l.t("browse.empty"), note: l.t("browse.emptyNote"), actionTitle: l.t("browse.clearAll")) {
                model.clearFilters()
            }
        } else if let query = model.query {
            EmptyStateView(systemImage: "magnifyingglass", title: l.t("browse.noneFor", ["term": query]), note: l.t("browse.emptySearchNote"))
        } else {
            EmptyStateView(systemImage: "shippingbox", title: l.t("browse.emptyCategory"), note: l.t("browse.emptyCategoryNote"), actionTitle: model.department == nil ? nil : l.t("nav.allDepartments")) {
                app.push(.department(slug: nil))
            }
        }
    }
}

extension FilterGroupKey {
    /// What its chip says — short where the group's own name is long.
    @MainActor
    func chipLabel(_ l: LanguageSettings) -> String {
        switch self {
        case .offers: return l.t("browse.chipOffers")
        case .brand: return l.t("browse.brand")
        case .price: return l.t("browse.price")
        case .rating: return l.t("browse.chipRating")
        case .seller: return l.t("browse.seller")
        case .speed: return l.t("browse.deliverySpeed")
        case .option(let name): return name
        }
    }

    /// Its full name, over its sheet and its part of every filter's sheet.
    @MainActor
    func title(_ l: LanguageSettings) -> String {
        switch self {
        case .offers: return l.t("browse.offers")
        case .rating: return l.t("browse.rating")
        default: return chipLabel(l)
        }
    }

    /// Its picture on the chip, after the owner's reference.
    var symbol: String {
        switch self {
        case .offers: return "percent"
        case .brand: return "tag"
        case .price: return "banknote"
        case .rating: return "star"
        case .seller: return "storefront"
        case .speed: return "box.truck"
        case .option: return "slider.horizontal.3"
        }
    }
}

/// The close button a browse sheet carries at its top end.
private struct SheetClose: View {
    let label: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Button {
            dismiss()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Brand.navy)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.white))
                .overlay(Circle().strokeBorder(Brand.cardLine, lineWidth: 1))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.tap)
        .accessibilityLabel(label)
    }
}

/// The orders a shelf can be put in, the chosen one ticked; a press puts it
/// in that order and puts the sheet away.
private struct SortSheet: View {
    @Bindable var model: BrowseModel
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(l.t("browse.sortBy"))
                    .font(.inter(17, .heavy))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                SheetClose(label: l.t("common.close"))
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 8)
            Divider()
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(ProductSort.allCases) { sort in
                        let chosen = model.sort == sort
                        Button {
                            model.sort = sort
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                Text(l.t(sort.labelKey))
                                    .font(.inter(16, chosen ? .bold : .medium))
                                    .foregroundStyle(Brand.navy)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                if chosen {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 16, weight: .bold))
                                        .foregroundStyle(Brand.navy)
                                        .accessibilityHidden(true)
                                }
                            }
                            .padding(.horizontal, 20)
                            .frame(minHeight: 52)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.tap)
                        .accessibilityAddTraits(chosen ? .isSelected : [])
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .background(Brand.ground.ignoresSafeArea())
    }
}

/// The phone's filters: every group that can narrow this shelf, or — opened
/// from a chip — that one group alone, under its own name; a Clear for what
/// it shows, and a button saying how many results are left.
private struct FilterSheet: View {
    @Bindable var model: BrowseModel
    /// One group alone, from its chip; nil for every filter.
    var only: FilterGroupKey?
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let facets = model.facets
        let groups = FilterGroups.of(facets, model.shownFilters)
        let shown = only.map { key in groups.filter { $0.key == key } } ?? groups
        let ticked = shown.reduce(0) { $0 + $1.active }
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(only?.title(l) ?? l.t("browse.filters"))
                    .font(.inter(17, .heavy))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if ticked > 0 {
                    Button(l.t(only == nil ? "browse.clearAll" : "browse.clearGroup")) {
                        if let only {
                            // On the Deals page "On offer" is the page, not the group's to clear.
                            let deals = model.isDealsPage
                            FilterGroups.clear(only, in: &model.filters)
                            if deals { model.filters.onOffer = true }
                        } else {
                            model.clearFilters()
                        }
                    }
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.accentInk)
                    .frame(minHeight: 44)
                }
                SheetClose(label: l.t("browse.closeFilters"))
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 8)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if only != nil {
                        ForEach(shown) { group in
                            content(group.key, facets: facets)
                                .padding(.top, 12)
                        }
                    } else {
                        ForEach(shown) { group in
                            section(group.key.title(l)) { content(group.key, facets: facets) }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            }
            Divider()
            Button(l.t("browse.showResults", ["count": "\(model.shown.count)"])) { dismiss() }
                .buttonStyle(AccentButtonStyle())
                .padding(16)
        }
        .background(Brand.ground.ignoresSafeArea())
    }

    /// One group's controls, by its key.
    @ViewBuilder
    private func content(_ key: FilterGroupKey, facets: Facets) -> some View {
        switch key {
        case .offers:
            if facets.narrows(facets.inStock) || model.filters.inStock {
                tick(l.t("browse.inStock"), count: facets.inStock, on: $model.filters.inStock)
            }
            if !model.isDealsPage, facets.narrows(facets.onOffer) || model.filters.onOffer {
                tick(l.t("browse.onOffer"), count: facets.onOffer, on: $model.filters.onOffer)
            }
            if facets.narrows(facets.express) || model.filters.express {
                tick(l.t("browse.expressOnly"), count: facets.express, on: $model.filters.express)
            }
        case .brand:
            values(facets.brands, selected: $model.filters.brands)
        case .seller:
            values(facets.sellers, selected: $model.filters.sellers)
        case .speed:
            values(facets.speeds, selected: $model.filters.speeds) { l.t("speed.\($0)") }
        case .price:
            PriceRangeFields(filters: $model.filters, bounds: facets.priceBounds)
        case .rating:
            ForEach(facets.ratings) { rating in
                let stars = Int(rating.value) ?? 0
                tick(l.t("browse.ratingAndUp", ["stars": rating.value]), count: rating.count, on: Binding(
                    get: { model.filters.minRating == stars },
                    set: { model.filters.minRating = $0 ? stars : nil }
                ))
            }
        case .option(let name):
            let known = facets.options.first { $0.name == name }?.values ?? []
            let selected = model.filters.options[name] ?? []
            values(known.isEmpty ? selected.sorted().map { FacetValue(value: $0, count: 0) } : known, selected: optionBinding(name))
        }
    }

    private func optionBinding(_ name: String) -> Binding<Set<String>> {
        Binding(
            get: { model.filters.options[name] ?? [] },
            set: { model.filters.options[name] = $0.isEmpty ? nil : $0 }
        )
    }

    private func values(_ values: [FacetValue], selected: Binding<Set<String>>, label: @escaping (String) -> String = { $0 }) -> some View {
        ForEach(values) { value in
            tick(label(value.value), count: value.count, on: Binding(
                get: { selected.wrappedValue.contains(value.value) },
                set: { on in
                    if on { selected.wrappedValue.insert(value.value) } else { selected.wrappedValue.remove(value.value) }
                }
            ))
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.inter(15, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 20)
                .padding(.bottom, 6)
            content()
        }
        .padding(.bottom, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(Brand.cardLine).frame(height: 1) }
    }

    private func tick(_ label: String, count: Int, on: Binding<Bool>) -> some View {
        Button {
            on.wrappedValue.toggle()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: on.wrappedValue ? "checkmark.square.fill" : "square")
                    .font(.system(size: 20))
                    .foregroundStyle(on.wrappedValue ? Brand.navy : Brand.muted)
                Text(label)
                    .font(.inter(15))
                    .foregroundStyle(Brand.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text("\(count)")
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .monospacedDigit()
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(on.wrappedValue ? [.isSelected] : [])
    }
}

/// The price range, the web's: the page's cheapest and dearest as a hint,
/// a lowest and a highest typed, and Apply — a range filtered as it is typed
/// would narrow the grid to nothing at the first digit. Ends given the wrong
/// way round are swapped rather than refused.
private struct PriceRangeFields: View {
    @Binding var filters: BrowseFilters
    /// The page's cheapest and dearest, for the hint; nil when only a range
    /// already chosen keeps the group on screen.
    let bounds: (min: Int, max: Int)?
    @State private var low = ""
    @State private var high = ""
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let bounds {
                Text(l.t("browse.priceRange", ["min": Money(fils: bounds.min * 1000).formatted(l.current), "max": Money(fils: bounds.max * 1000).formatted(l.current)]))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
            }
            HStack(spacing: 8) {
                field(l.t("browse.priceMin"), text: $low)
                Text("–").foregroundStyle(Brand.muted).accessibilityHidden(true)
                field(l.t("browse.priceMax"), text: $high)
                Button(l.t("browse.priceApply")) { apply() }
                    .font(.inter(14, .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.navy))
                    .buttonStyle(.tap)
            }
        }
        .padding(.top, 4)
        .onAppear {
            low = filters.minPrice.map(UnitWording.number) ?? ""
            high = filters.maxPrice.map(UnitWording.number) ?? ""
        }
    }

    private func field(_ label: String, text: Binding<String>) -> some View {
        TextField(label, text: text)
            .keyboardType(.decimalPad)
            .font(.inter(16))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            .accessibilityLabel(label)
    }

    private func apply() {
        func read(_ text: String) -> Double? {
            let value = Double(PhoneNumber.foldDigits(text).trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "٫", with: "."))
            guard let value, value.isFinite, value >= 0 else { return nil }
            return value
        }
        var min = read(low)
        var max = read(high)
        if let lower = min, let upper = max, lower > upper { (min, max) = (upper, lower) }
        filters.minPrice = min
        filters.maxPrice = max
        Haptics.tap()
    }
}

