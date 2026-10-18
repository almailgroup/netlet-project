import SwiftUI

/// The front door: one line saying what the shop is, the departments, today's
/// deals when there are enough of them to be a shelf, and what is new.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { HomeViewModel(catalog: app.services.catalog) }) { model in
            content(model)
        }
        .navigationTitle("NetLet")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { LanguageToolbarItem() }
    }

    private func content(_ model: HomeViewModel) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                hero
                departments(model)
                LoadStateView(state: model.products, retry: { await model.load(language: l.current) }) { products in
                    VStack(alignment: .leading, spacing: 28) {
                        if !model.deals.isEmpty {
                            shelf(title: l.t("rail.deals.title"), products: model.deals, dark: true)
                        }
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: l.t("rail.newest.title"), route: .department(slug: nil))
                            if products.isEmpty {
                                EmptyStateView(systemImage: "shippingbox", title: l.t("browse.emptyCategory"), note: l.t("browse.emptyCategoryNote"))
                            } else {
                                ProductGrid(products: products)
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .background(Brand.pearl.ignoresSafeArea())
        .refreshable { await model.load(language: l.current) }
        .task(id: l.current) { await model.load(language: l.current) }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 10) {
            (Text(l.t("home.heroTitle") + " ").foregroundStyle(.white) + Text(l.t("home.heroTitleAccent")).foregroundStyle(Brand.orange))
                .font(.system(.largeTitle, design: .rounded).weight(.heavy))
                .accessibilityAddTraits(.isHeader)
            Text(l.t("home.heroNote"))
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.88))
            HStack(spacing: 10) {
                Label(l.t("home.payOnDelivery"), systemImage: "banknote")
                Label(l.t("home.returnsWithin", ["days": "\(ReferenceData.shared.rules.returnWindowDays)"]), systemImage: "arrow.uturn.backward")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.9))
            .padding(.top, 4)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(colors: [Brand.navy, Brand.navy.opacity(0.92)], startPoint: .top, endPoint: .bottom)
        )
    }

    private func departments(_ model: HomeViewModel) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("home.shopByCategory"))
                .font(.title3.weight(.bold))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                ForEach(ReferenceData.shared.departments) { department in
                    DepartmentTile(
                        title: l.t(department.label),
                        art: department.artPath,
                        count: model.counts[department.slug],
                        route: .department(slug: department.slug)
                    )
                }
                DepartmentTile(title: l.t("nav.allDepartments"), art: "/departments/all.webp", count: nil, route: .department(slug: nil))
            }
        }
        .padding(.horizontal, 16)
    }

    private func shelf(title: String, products: [Product], dark: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.title3.weight(.bold))
                .foregroundStyle(dark ? .white : Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.horizontal, 16)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 12) {
                    ForEach(products) { product in
                        ProductCard(product: product).frame(width: 170)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.vertical, 18)
        .background(dark ? Brand.navy : .clear)
    }
}

/// A department as a white tile with its art and how many products it holds.
struct DepartmentTile: View {
    let title: String
    let art: String
    let count: Int?
    let route: Route
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        NavigationLink(value: route) {
            VStack(spacing: 6) {
                Color.clear
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay { RemoteImage(reference: art, contentMode: .fit) }
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(2, reservesSpace: true)
                    .multilineTextAlignment(.center)
                if let count {
                    Text(l.productCount(count))
                        .font(.caption2)
                        .foregroundStyle(Brand.muted)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// A section's heading with "View all" beside it.
struct SectionHeader: View {
    let title: String
    var route: Route?
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack {
            Text(title)
                .font(.title3.weight(.bold))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if let route {
                NavigationLink(value: route) {
                    HStack(spacing: 2) {
                        Text(l.t("home.viewAll"))
                        Image(systemName: "chevron.forward")
                    }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                }
            }
        }
    }
}

/// The language control, which names the language you would get — "العربية"
/// on the English app and "English" on the Arabic one, the web header's rule.
@MainActor
struct LanguageToolbarItem: ToolbarContent {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button(l.t("header.language")) {
                app.setLanguage(l.current.other)
            }
            .font(.subheadline.weight(.semibold))
            .environment(\.locale, l.current.other.locale)
            .accessibilityHint(l.t("header.changeLanguage"))
        }
    }
}
