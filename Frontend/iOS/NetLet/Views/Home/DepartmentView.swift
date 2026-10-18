import SwiftUI

/// A department's shelf — or the whole catalogue — with its sort and an
/// in-stock filter, the two controls a phone's shelf needs most.
struct DepartmentView: View {
    let slug: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { DepartmentViewModel(slug: slug, catalog: app.services.catalog) }) { model in
            content(model)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var title: String {
        ReferenceData.shared.department(slug: slug).map { l.t($0.label) } ?? l.t("browse.allProducts")
    }

    private func content(_ model: DepartmentViewModel) -> some View {
        @Bindable var model = model
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.title.weight(.bold))
                        .foregroundStyle(Brand.navy)
                        .accessibilityAddTraits(.isHeader)
                    if let count = model.products.value?.count {
                        Text(l.productCount(model.inStockOnly ? model.shown.count : count))
                            .font(.subheadline)
                            .foregroundStyle(Brand.muted)
                    }
                }
                HStack(spacing: 10) {
                    Menu {
                        Picker(l.t("browse.sortBy"), selection: $model.sort) {
                            ForEach(ProductSort.allCases) { sort in
                                Text(l.t(sort.labelKey)).tag(sort)
                            }
                        }
                    } label: {
                        Label(l.t(model.sort.labelKey), systemImage: "arrow.up.arrow.down")
                            .lineLimit(1)
                    }
                    .buttonStyle(CardButtonStyle())
                    .accessibilityLabel(l.t("browse.sortBy"))

                    Toggle(isOn: $model.inStockOnly) {
                        Text(l.t("browse.inStock")).lineLimit(1)
                    }
                    .toggleStyle(.button)
                    .buttonStyle(CardButtonStyle())
                }
                LoadStateView(state: model.products, retry: { await model.load(language: l.current) }) { _ in
                    if model.shown.isEmpty {
                        EmptyStateView(
                            systemImage: "shippingbox",
                            title: l.t(model.inStockOnly ? "browse.empty" : "browse.emptyCategory"),
                            note: l.t(model.inStockOnly ? "browse.emptyNote" : "browse.emptyCategoryNote")
                        )
                    } else {
                        ProductGrid(products: model.shown)
                    }
                }
            }
            .padding(16)
        }
        .background(Brand.pearl.ignoresSafeArea())
        .refreshable { await model.load(language: l.current) }
        .task(id: l.current) { await model.load(language: l.current) }
    }
}
