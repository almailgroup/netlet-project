import SwiftUI

/// Search over the whole catalogue, on the server, by the same ranking the web
/// uses. With nothing typed it offers this phone's recent searches and the
/// departments; a misspelling gets the catalogue's own spelling, said above
/// the results.
struct SearchView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { SearchViewModel(catalog: app.services.catalog) }) { model in
            content(model)
        }
        .navigationTitle(l.t("browse.searchCrumb"))
    }

    private func content(_ model: SearchViewModel) -> some View {
        @Bindable var model = model
        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if model.trimmed.isEmpty {
                    suggestions(model)
                } else {
                    results(model)
                }
            }
            .padding(16)
        }
        .background(Brand.pearl.ignoresSafeArea())
        .searchable(text: $model.query, placement: .navigationBarDrawer(displayMode: .always), prompt: l.t("header.searchAria"))
        .onChange(of: model.query) { model.queryChanged() }
        .onSubmit(of: .search) { Task { await model.submit() } }
        .onChange(of: l.current, initial: true) { _, language in
            model.language = language
            if !model.trimmed.isEmpty { Task { await model.run(model.trimmed) } }
        }
    }

    @ViewBuilder
    private func suggestions(_ model: SearchViewModel) -> some View {
        if !model.recent.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(l.t("header.recentSearches")).font(.headline).foregroundStyle(Brand.navy)
                    Spacer()
                    Button(l.t("header.clearRecent")) { model.clearRecent() }
                        .font(.subheadline.weight(.semibold))
                        .accessibilityLabel(l.t("header.clearRecentAria"))
                }
                FlowChips(items: model.recent) { term in
                    model.query = term
                    Task { await model.submit() }
                }
            }
        }
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("header.shopByDepartment")).font(.headline).foregroundStyle(Brand.navy)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(ReferenceData.shared.departments) { department in
                    DepartmentTile(title: l.t(department.label), art: department.artPath, count: nil, route: .department(slug: department.slug))
                }
                DepartmentTile(title: l.t("nav.allDepartments"), art: "/departments/all.webp", count: nil, route: .department(slug: nil))
            }
        }
    }

    @ViewBuilder
    private func results(_ model: SearchViewModel) -> some View {
        switch model.result {
        case .loaded(let result):
            if let corrected = result.correctedTo, !corrected.isEmpty {
                Text(l.t("search.showingFor", ["term": corrected]))
                    .font(.subheadline)
                    .foregroundStyle(Brand.muted)
            }
            if result.products.isEmpty {
                EmptyStateView(
                    systemImage: "magnifyingglass",
                    title: l.t("browse.noneFor", ["term": model.answered]),
                    note: l.t("browse.emptySearchNote")
                )
            } else {
                Text(l.t("browse.searchTitle", ["query": model.answered]))
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                Text(l.productCount(result.total))
                    .font(.subheadline)
                    .foregroundStyle(Brand.muted)
                ProductGrid(products: result.products)
            }
        case .failed(let error):
            ErrorStateView(error: error) { await model.run(model.trimmed) }
        case .idle, .loading:
            LoadingView()
        }
    }
}

/// Words as chips that wrap onto as many lines as they need.
struct FlowChips: View {
    let items: [String]
    let choose: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Button {
                    choose(item)
                } label: {
                    Text(item)
                        .font(.subheadline)
                        .foregroundStyle(Brand.navy)
                        .lineLimit(1)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 40)
                        .background(Capsule().fill(Color.white))
                        .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Lays its children out in rows, wrapping at the edge, in the layout's direction.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
