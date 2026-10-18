import SwiftUI

/// One product: the photos, the name, who sells it, the price, the choice of
/// variant, how many, Add to cart and Buy now, then the description and the
/// specification rows. The price and both buttons sit together at the foot of
/// the screen, so they are under the thumb however far down somebody reads.
struct ProductDetailView: View {
    let handle: String
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { ProductDetailViewModel(handle: handle, catalog: app.services.catalog) }) { model in
            content(model)
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func content(_ model: ProductDetailViewModel) -> some View {
        LoadStateView(state: model.product, retry: { await model.load(language: l.current) }) { product in
            if let product {
                ProductPage(product: product, model: model)
            } else {
                EmptyStateView(
                    systemImage: "shippingbox",
                    title: l.t("product.notFound"),
                    note: l.t("product.notFoundNote")
                )
            }
        }
        .background(Brand.pearl.ignoresSafeArea())
        .task(id: l.current) { await model.load(language: l.current) }
    }
}

private struct ProductPage: View {
    let product: Product
    @Bindable var model: ProductDetailViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var failure: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                gallery
                VStack(alignment: .leading, spacing: 14) {
                    if let vendor = product.vendor {
                        Text(l.t("browse.soldBy", ["name": vendor]))
                            .font(.subheadline)
                            .foregroundStyle(Brand.muted)
                    }
                    Text(product.title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(Brand.ink)
                        .accessibilityAddTraits(.isHeader)
                    priceBlock
                    availability
                    choices
                    quantity
                    if let failure {
                        FieldProblem(key: failure)
                    }
                }
                .padding(.horizontal, 16)
                details.padding(.horizontal, 16)
            }
            .padding(.bottom, 24)
        }
        .safeAreaInset(edge: .bottom) { buyBar }
        .navigationTitle(product.title)
        .sensoryFeedback(.success, trigger: app.cart.itemCount)
    }

    private var gallery: some View {
        let images = product.images
        return TabView(selection: $model.imageIndex) {
            if images.isEmpty {
                RemoteImage(reference: nil).tag(0)
            }
            ForEach(Array(images.enumerated()), id: \.offset) { index, image in
                RemoteImage(reference: image.url, contentMode: .fit, label: image.altText ?? product.title)
                    .padding(12)
                    .tag(index)
                    .accessibilityLabel(l.t("product.showImage", ["index": "\(index + 1)", "total": "\(images.count)"]))
            }
        }
        .tabViewStyle(.page(indexDisplayMode: images.count > 1 ? .always : .never))
        .indexViewStyle(.page(backgroundDisplayMode: .always))
        .aspectRatio(1, contentMode: .fit)
        .background(Color.white)
        .accessibilityLabel(l.t("product.productImages"))
    }

    @ViewBuilder
    private var priceBlock: some View {
        if let variant = model.variant ?? product.leadVariant {
            HStack(spacing: 10) {
                PriceView(price: variant.price, was: variant.compareAtPrice, large: true)
                if let percent = variant.savingPercent, percent > 0 { SavingBadge(percent: percent) }
            }
        }
    }

    @ViewBuilder
    private var availability: some View {
        if let variant = model.variant {
            if !variant.availableForSale {
                Label(l.t("product.outOfStock"), systemImage: "xmark.circle").foregroundStyle(Brand.danger)
            } else if variant.preorder != nil {
                Label(l.t("product.preorderShipsUnknown"), systemImage: "clock").foregroundStyle(Brand.navy)
            } else {
                Label(l.t("product.inStock"), systemImage: "checkmark.circle").foregroundStyle(Brand.success)
            }
        } else if !product.isAvailable {
            Label(l.t("product.soldOut"), systemImage: "xmark.circle").foregroundStyle(Brand.danger)
        }
    }

    /// Options when they tell every variant apart, names otherwise, and
    /// nothing for a product with one variant.
    @ViewBuilder
    private var choices: some View {
        if product.variants.count > 1 {
            if model.choosesByOption(product) {
                ForEach(product.options, id: \.name) { option in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(option.name).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                        FlowLayout(spacing: 8) {
                            ForEach(option.values, id: \.self) { value in
                                ChoiceChip(
                                    title: value,
                                    selected: model.selection[option.name] == value,
                                    available: model.isAvailable(option: option.name, value: value, in: product)
                                ) {
                                    model.select(option: option.name, value: value, in: product)
                                }
                            }
                        }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(l.t("product.chooseOption")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                    FlowLayout(spacing: 8) {
                        ForEach(product.variants) { variant in
                            ChoiceChip(title: variant.title, selected: model.variant?.id == variant.id, available: variant.availableForSale) {
                                model.select(variant: variant)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var quantity: some View {
        if let variant = model.variant, variant.availableForSale {
            HStack(spacing: 12) {
                Text(l.t("product.quantity")).font(.subheadline.weight(.semibold))
                QuantityStepper(quantity: model.quantity, maximum: max(1, variant.maxQuantity), name: product.title) { next in
                    model.quantity = min(max(1, next), max(1, variant.maxQuantity))
                }
                Spacer()
            }
            let inBag = app.cart.quantity(of: variant.id)
            if inBag > 0 {
                Button {
                    app.selectedTab = .cart
                } label: {
                    Text(inBag == 1 ? l.t("product.inYourCartOne") : l.t("product.inYourCartMany", ["count": "\(inBag)"]))
                        .font(.subheadline.weight(.semibold))
                        .underline()
                }
                .frame(minHeight: 44)
            }
        }
    }

    @ViewBuilder
    private var details: some View {
        let blocks = DescriptionBlock.parse(product.description)
        if !blocks.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(l.t("product.information")).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                    switch block {
                    case .paragraph(let text):
                        Text(text).font(.body).foregroundStyle(Brand.ink)
                    case .list(let items):
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(items, id: \.self) { item in
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Text("•").foregroundStyle(Brand.muted)
                                    Text(item).foregroundStyle(Brand.ink)
                                }
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
        let specs = product.specifications
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("product.specifications")).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            if specs.isEmpty {
                Text(l.t("product.noSpecs")).font(.subheadline).foregroundStyle(Brand.muted)
            } else {
                ForEach(Array(specs.enumerated()), id: \.offset) { _, row in
                    HStack(alignment: .firstTextBaseline) {
                        Text(row.label).font(.subheadline).foregroundStyle(Brand.muted)
                        Spacer(minLength: 12)
                        Text(row.value).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink).multilineTextAlignment(.trailing)
                    }
                    Divider()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    /// Add to cart over Buy now, with the price — the same two everywhere.
    private var buyBar: some View {
        let variant = model.variant
        let ready = variant?.availableForSale == true
        return VStack(spacing: 8) {
            if product.isAvailable && variant == nil {
                Text(l.t("product.chooseOption"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Brand.muted)
                    .frame(maxWidth: .infinity, minHeight: 50)
            } else {
                HStack(spacing: 10) {
                    Button {
                        Task { await add(openCheckout: false) }
                    } label: {
                        if model.adding { ProgressView().tint(Brand.navy) } else {
                            Label(model.quantity > 1 ? l.t("product.addToCartCount", ["count": "\(model.quantity)"]) : l.t("product.addToCart"), systemImage: "bag")
                                .lineLimit(1).minimumScaleFactor(0.8)
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button {
                        Task { await add(openCheckout: true) }
                    } label: {
                        Label(model.quantity > 1 ? l.t("product.buyNowCount", ["count": "\(model.quantity)"]) : l.t("product.buyNow"), systemImage: "bolt.fill")
                            .lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
                .disabled(!ready || model.adding)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.regularMaterial)
        .overlay(alignment: .top) { Divider() }
    }

    private func add(openCheckout: Bool) async {
        failure = nil
        // Buy now on an item already in the bag goes straight to checkout rather than adding it again.
        if openCheckout, let variant = model.variant, app.cart.quantity(of: variant.id) > 0 {
            app.openCheckout()
            return
        }
        if await model.add(to: app.cart) {
            announce(l.t("cart.added", ["name": product.title]))
            if openCheckout { app.openCheckout() }
        } else {
            failure = openCheckout ? "cart.buyFailed" : "cart.addFailed"
        }
    }
}

/// One option value, as a chip that says whether it is chosen and whether it can be bought.
struct ChoiceChip: View {
    let title: String
    let selected: Bool
    let available: Bool
    let choose: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button(action: choose) {
            Text(title)
                .font(.subheadline.weight(selected ? .bold : .regular))
                .strikethrough(!available)
                .foregroundStyle(selected ? .white : (available ? Brand.navy : Brand.muted))
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(Capsule().fill(selected ? Brand.navy : Color.white))
                .overlay(Capsule().strokeBorder(selected ? Brand.navy : Brand.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityValue(available ? "" : l.t("product.unavailable"))
    }
}

/// A seller's description, read as the web reads it (`descriptionBlocks`):
/// lines starting with -, • or * are a list, the rest are paragraphs.
enum DescriptionBlock: Equatable {
    case paragraph(String)
    case list([String])

    static func parse(_ text: String) -> [DescriptionBlock] {
        var blocks: [DescriptionBlock] = []
        var paragraph: [String] = []
        var list: [String] = []
        func flushParagraph() {
            if !paragraph.isEmpty { blocks.append(.paragraph(paragraph.joined(separator: " "))) }
            paragraph = []
        }
        func flushList() {
            if !list.isEmpty { blocks.append(.list(list)) }
            list = []
        }
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                flushParagraph()
                flushList()
            } else if let first = line.first, ["-", "•", "*"].contains(first) {
                flushParagraph()
                let item = line.dropFirst().trimmingCharacters(in: .whitespaces)
                if !item.isEmpty { list.append(item) }
            } else {
                flushList()
                paragraph.append(line)
            }
        }
        flushParagraph()
        flushList()
        return blocks
    }
}
