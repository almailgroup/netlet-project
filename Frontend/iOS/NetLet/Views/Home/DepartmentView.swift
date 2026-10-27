import SwiftUI

/// A department's shelf — or the whole catalogue, or a view of it: what is
/// on offer, what is new, one brand. The web's `/category/<slug>`.
struct DepartmentView: View {
    let slug: String?
    var view: ShelfView = .all
    @Environment(AppModel.self) private var app

    var body: some View {
        ModelHost(make: { BrowseModel(source: .shelf(slug: slug, view: view), catalog: app.services.catalog) }) { model in
            BrowsePage(model: model)
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

/// The page both draw: where it sits, its name with how many products under
/// it, Filters and Sort side by side a thumb's width each, the chips of what
/// is ticked, and the grid. Once the Filters row has gone up under the header,
/// a round button in the end corner stands in for it, with the count ticked.
private struct BrowsePage: View {
    @Bindable var model: BrowseModel
    @State private var filtersOpen = false
    @State private var rowGone = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        ShopPage(logo: false, refresh: { await model.load(language: l.current) }) {
            VStack(alignment: .leading, spacing: 0) {
                Breadcrumbs(trail: [crumb])
                Text(title)
                    .pageTitle()
                    .fixedSize(horizontal: false, vertical: true)
                Text(countLine)
                    .font(.inter(15))
                    .foregroundStyle(Brand.body)
                    .padding(.top, 8)
                    .accessibilityAddTraits(.updatesFrequently)
                controls
                    .padding(.top, 16)
                    .padding(.bottom, 20)
                chips
                results
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(alignment: .bottomTrailing) { cornerFilters }
        .sheet(isPresented: $filtersOpen) {
            FilterSheet(model: model)
                .environment(\.layoutDirection, l.layoutDirection)
                .buttonStyle(HapticDefaultStyle())
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .task(id: l.current) { await model.load(language: l.current) }
    }

    // MARK: Words

    private var departmentName: String {
        model.department.map { l.t($0.label) } ?? l.t("browse.allProducts")
    }

    private var crumb: String {
        model.query == nil ? departmentName : l.t("browse.searchCrumb")
    }

    private var title: String {
        if let query = model.query { return l.t("browse.searchTitle", ["query": query]) }
        guard model.department == nil, case .shelf(_, let view) = model.source else { return departmentName }
        // The view's own name while it is exactly that view and nothing more.
        switch view {
        case .deals where model.filters.activeCount == 1 && model.filters.onOffer: return l.t("footer.onOffer")
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
        let count = model.filters.activeCount
        return count > 0 ? l.t("browse.filtersWithCount", ["count": "\(count)"]) : l.t("browse.filters")
    }

    // MARK: Filters and Sort

    private var controls: some View {
        HStack(spacing: 8) {
            Button {
                filtersOpen = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "slider.horizontal.3").font(.system(size: 15, weight: .semibold))
                    Text(filtersLabel).lineLimit(1)
                }
                .font(.inter(14, .bold))
                .foregroundStyle(Brand.navy)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(PressFillStyle(cornerRadius: 12))
            Menu {
                Picker(l.t("browse.sortBy"), selection: $model.sort) {
                    ForEach(ProductSort.allCases) { sort in
                        Text(l.t(sort.labelKey)).tag(sort)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up.arrow.down")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Brand.muted)
                    Text(l.t(model.sort.labelKey))
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Brand.muted)
                }
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .accessibilityLabel(l.t("browse.sortBy"))
            .accessibilityValue(l.t(model.sort.labelKey))
            .onChange(of: model.sort) { Haptics.tap() }
        }
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onChange(of: proxy.frame(in: .global).maxY < 140) { _, gone in
                        withAnimation(still ? nil : .easeOut(duration: 0.2)) { rowGone = gone }
                    }
            }
        }
    }

    @ViewBuilder
    private var cornerFilters: some View {
        if rowGone {
            Button {
                filtersOpen = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(Circle().fill(Brand.navy))
                    .shadow(color: Brand.navy.opacity(0.25), radius: 15, x: 0, y: 10)
                    .overlay(alignment: .topTrailing) {
                        PixelBadge(value: model.filters.activeCount).fixedSize().offset(x: 4, y: -4)
                    }
            }
            .buttonStyle(.tap)
            .accessibilityLabel(filtersLabel)
            .padding(.trailing, 16)
            .padding(.bottom, 12)
            .transition(.opacity.combined(with: .offset(y: 12)))
        }
    }

    // MARK: What is ticked

    private struct Chip: Identifiable {
        let id: String
        let label: String
        let remove: (inout BrowseFilters) -> Void
    }

    private var activeChips: [Chip] {
        let filters = model.filters
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
            .padding(.bottom, 16)
        }
    }

    // MARK: The grid

    @ViewBuilder
    private var results: some View {
        switch model.products {
        case .idle, .loading:
            LoadingView()
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
            } else {
                ProductGrid(products: shown)
            }
        }
    }

    @ViewBuilder
    private var empty: some View {
        if model.filters.activeCount > 0 {
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

/// The phone's filters: a sheet of the groups that can narrow this shelf, a
/// Clear all, and a button saying how many results are left.
private struct FilterSheet: View {
    @Bindable var model: BrowseModel
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let facets = model.facets
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(l.t("browse.filters"))
                    .font(.inter(17, .heavy))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if model.filters.activeCount > 0 {
                    Button(l.t("browse.clearAll")) { model.clearFilters() }
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.accentInk)
                }
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
                .accessibilityLabel(l.t("browse.closeFilters"))
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 8)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if facets.narrows(facets.inStock) || facets.narrows(facets.onOffer) || facets.narrows(facets.express) || model.filters.inStock || model.filters.onOffer || model.filters.express {
                        group(l.t("browse.offers")) {
                            if facets.narrows(facets.inStock) || model.filters.inStock {
                                tick(l.t("browse.inStock"), count: facets.inStock, on: $model.filters.inStock)
                            }
                            if facets.narrows(facets.onOffer) || model.filters.onOffer {
                                tick(l.t("browse.onOffer"), count: facets.onOffer, on: $model.filters.onOffer)
                            }
                            if facets.narrows(facets.express) || model.filters.express {
                                tick(l.t("browse.expressOnly"), count: facets.express, on: $model.filters.express)
                            }
                        }
                    }
                    values(l.t("browse.brand"), facets.brands, selected: $model.filters.brands, facets: facets)
                    values(l.t("browse.seller"), facets.sellers, selected: $model.filters.sellers, facets: facets)
                    values(l.t("browse.deliverySpeed"), facets.speeds, selected: $model.filters.speeds, facets: facets) { l.t("speed.\($0)") }
                    if let bounds = facets.priceBounds {
                        group(l.t("browse.price")) {
                            PriceRangeFields(filters: $model.filters, bounds: bounds)
                        }
                    }
                    ForEach(facets.options) { option in
                        values(option.name, option.values, selected: optionBinding(option.name), facets: facets)
                    }
                    if !facets.ratings.isEmpty || model.filters.minRating != nil {
                        group(l.t("browse.rating")) {
                            ForEach(facets.ratings) { rating in
                                let stars = Int(rating.value) ?? 0
                                tick(l.t("browse.ratingAndUp", ["stars": rating.value]), count: rating.count, on: Binding(
                                    get: { model.filters.minRating == stars },
                                    set: { model.filters.minRating = $0 ? stars : nil }
                                ))
                            }
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

    private func optionBinding(_ name: String) -> Binding<Set<String>> {
        Binding(
            get: { model.filters.options[name] ?? [] },
            set: { model.filters.options[name] = $0.isEmpty ? nil : $0 }
        )
    }

    @ViewBuilder
    private func values(_ title: String, _ values: [FacetValue], selected: Binding<Set<String>>, facets: Facets, label: @escaping (String) -> String = { $0 }) -> some View {
        if facets.narrows(values) || !selected.wrappedValue.isEmpty {
            group(title) {
                ForEach(values) { value in
                    tick(label(value.value), count: value.count, on: Binding(
                        get: { selected.wrappedValue.contains(value.value) },
                        set: { on in
                            if on { selected.wrappedValue.insert(value.value) } else { selected.wrappedValue.remove(value.value) }
                        }
                    ))
                }
            }
        }
    }

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
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
    let bounds: (min: Int, max: Int)
    @State private var low = ""
    @State private var high = ""
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("browse.priceRange", ["min": Money(fils: bounds.min * 1000).formatted(l.current), "max": Money(fils: bounds.max * 1000).formatted(l.current)]))
                .font(.inter(13))
                .foregroundStyle(Brand.muted)
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

