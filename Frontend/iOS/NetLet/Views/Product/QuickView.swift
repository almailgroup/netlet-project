import SwiftUI

/// A product seen without leaving the shelf — opened by **holding a card**, on
/// the owner's word, and the app's alone: the web's Quick View, as a sheet
/// that rises over the page the shopper is on.
///
/// It is enough to decide on: the photographs to swipe through, who sells it,
/// the name, the rating and the price, whether it is in stock, the choice of
/// size or colour, how many, and Add to cart and Buy now — the product page's
/// own rules through the product page's own model, so the two cannot answer
/// differently. **Full product details** opens the whole page, and so does a
/// press on the photo or the name: the sheet goes down and the page is pushed
/// where the card was.
///
/// It opens at once on the card's own copy of the product and asks the server
/// again behind it, as the product page does (`start(with:)`).
struct QuickViewSheet: View {
    let product: Product
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { ProductDetailViewModel(handle: product.handle, catalog: app.services.catalog) }) { model in
            QuickViewContent(shown: product, model: model)
                .task {
                    model.start(with: product)
                    await model.load(language: l.current)
                }
        }
        .presentationDetents([.fraction(0.86), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(Color.white)
    }
}

private struct QuickViewContent: View {
    let shown: Product
    @Bindable var model: ProductDetailViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var failure: String?

    /// The server's fresh copy once it has answered, the card's until then.
    private var product: Product { model.product.value.flatMap { $0 } ?? shown }
    private var variant: ProductVariant? { model.variant ?? product.leadVariant }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    photos
                    details.padding(.horizontal, 20).padding(.top, 16)
                }
                .padding(.bottom, 16)
            }
            actions
        }
        .background(Color.white)
    }

    // MARK: The top: what this is, saving, sharing, closing

    private var topBar: some View {
        HStack(spacing: 4) {
            Text(l.t("quick.title"))
                .font(.inter(15, .bold))
                .foregroundStyle(Brand.muted)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            Button {
                Task { await app.heart(product) }
            } label: {
                Image(systemName: app.saved.contains(product.id) ? "heart.fill" : "heart")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Color(red: 230 / 255, green: 28 / 255, blue: 56 / 255))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.action)
            .accessibilityLabel(l.t(app.saved.contains(product.id) ? "product.removeSaved" : "product.save", ["name": product.title]))
            ShareLink(item: app.services.configuration.url(path: ReferralCode.productPath(handle: product.handle, userId: app.session.user?.id))) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(l.t("product.share", ["name": product.title]))
            Button {
                app.previewing = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Brand.photo))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("quick.close"))
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .padding(.top, 14)
        .padding(.bottom, 4)
    }

    // MARK: The photographs

    /// Every photograph, swiped like the phone's own pictures, mirrored on the
    /// Arabic page. A press opens the whole product.
    private var photos: some View {
        let stills = Array(product.images.prefix(8))
        return Group {
            if stills.count > 1 {
                TabView(selection: $model.imageIndex) {
                    ForEach(Array(stills.enumerated()), id: \.offset) { index, photo in
                        photoFrame(photo).tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .always))
            } else {
                photoFrame(stills.first)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .background(Brand.photo)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(alignment: .topLeading) {
            if let percent = variant?.savingPercent, percent > 0 {
                SavingBadge(percent: percent, large: true).padding(12)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private func photoFrame(_ photo: ProductImage?) -> some View {
        Button(action: openFull) {
            Brand.photo
                .overlay {
                    if let photo {
                        RemoteImage(reference: photo.url, contentMode: .fit, label: photo.altText ?? product.title)
                    }
                }
                .clipped()
                .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .accessibilityLabel(l.t("quick.fullDetails"))
    }

    // MARK: What decides the purchase

    private var details: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let vendor = product.vendor, !vendor.isEmpty {
                Text(vendor).font(.inter(13, .semibold)).foregroundStyle(Brand.muted).lineLimit(1)
            }
            Button(action: openFull) {
                Text(product.title)
                    .font(.inter(21, .heavy))
                    .tracking(-0.3)
                    .foregroundStyle(Brand.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.tap)
            .padding(.top, 4)
            if let rating = product.rating {
                RatingLine(rating: rating).padding(.top, 8)
            }
            if let variant {
                PriceView(price: variant.price, was: variant.saving == nil ? nil : variant.compareAtPrice, large: true)
                    .padding(.top, 12)
                if let measure = variant.measure,
                   let per = ListingRules.shared.unitPrice(variant.price, unit: measure.unit, step: measure.stepAmount) {
                    Text(l.t("unit.perUnit", ["price": per.price.formatted(l.current), "unit": l.t("unit.\(per.unit)")]))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .padding(.top, 2)
                }
            }
            availability.padding(.top, 12)
            choices
            quantity.padding(.top, 16)
            if let failure { FieldProblem(key: failure).padding(.top, 8) }
            if let summary {
                Text(summary)
                    .font(.inter(14))
                    .foregroundStyle(Brand.body)
                    .lineSpacing(3)
                    .lineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 20)
            }
        }
    }

    /// The description's first paragraph, or its first few list lines.
    private var summary: String? {
        switch DescriptionBlock.parse(product.description).first {
        case .paragraph(let text): return text
        case .list(let items): return items.prefix(3).map { "• " + $0 }.joined(separator: "\n")
        case nil: return nil
        }
    }

    @ViewBuilder
    private var availability: some View {
        if let chosen = model.variant {
            if !chosen.availableForSale {
                Label(l.t("product.outOfStock"), systemImage: "xmark.circle")
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.danger)
            } else if let preorder = chosen.preorder {
                Label(preorder.releaseAt.map { l.t("product.preorderShips", ["date": OrderWording.day($0, language: l.current)]) } ?? l.t("product.preorderShipsUnknown"), systemImage: "clock")
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
            } else {
                Label(l.t("product.inStock"), systemImage: "checkmark.circle")
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.success)
            }
        } else if !product.isAvailable {
            Label(l.t("product.soldOut"), systemImage: "xmark.circle")
                .font(.inter(14, .bold))
                .foregroundStyle(Brand.danger)
        }
    }

    /// The product page's choice, chip for chip (`choiceMode`).
    @ViewBuilder
    private var choices: some View {
        if product.variants.count > 1 {
            if model.choosesByOption(product) {
                ForEach(product.options, id: \.name) { option in
                    VStack(alignment: .leading, spacing: 8) {
                        (Text(option.name + ": ").font(.inter(14, .semibold)).foregroundColor(Brand.muted)
                            + Text(model.selection[option.name] ?? "").font(.inter(14, .bold)).foregroundColor(Brand.ink))
                        FlowLayout(spacing: 8) {
                            ForEach(option.values, id: \.self) { value in
                                ChoiceChip(
                                    title: value,
                                    selected: model.selection[option.name] == value,
                                    available: model.isAvailable(option: option.name, value: value, in: product)
                                ) {
                                    failure = nil
                                    model.select(option: option.name, value: value, in: product)
                                }
                            }
                        }
                    }
                    .padding(.top, 16)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(l.t("product.chooseOption")).font(.inter(14, .semibold)).foregroundStyle(Brand.muted)
                    FlowLayout(spacing: 8) {
                        ForEach(product.variants) { option in
                            ChoiceChip(title: option.title, selected: model.variant?.id == option.id, available: option.availableForSale) {
                                failure = nil
                                model.select(variant: option)
                            }
                        }
                    }
                }
                .padding(.top, 16)
            }
        }
    }

    /// How many, and what the bag already holds of this choice.
    @ViewBuilder
    private var quantity: some View {
        if let chosen = model.variant, chosen.availableForSale {
            let inBag = app.cart.quantity(of: chosen.id)
            FlowLayout(spacing: 12) {
                QuantityStepper(quantity: model.quantity, maximum: max(1, chosen.maxQuantity), name: product.title) { next in
                    model.quantity = min(max(1, next), max(1, chosen.maxQuantity))
                }
                if inBag > 0 {
                    Button {
                        app.previewing = nil
                        app.select(.cart)
                    } label: {
                        Text(inBag == 1 ? l.t("product.inYourCartOne") : l.t("product.inYourCartMany", ["count": "\(inBag)"]))
                            .font(.inter(13, .semibold))
                            .foregroundStyle(Brand.navy)
                            .underline()
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.tap)
                }
            }
        }
    }

    // MARK: The buttons, kept under the thumb

    private var actions: some View {
        let ready = model.variant?.availableForSale == true
        return VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    Task { await add(openCheckout: false) }
                } label: {
                    HStack(spacing: 8) {
                        if model.adding { ProgressView().tint(Brand.navy) } else { Image(systemName: "bag").font(.system(size: 16, weight: .medium)) }
                        Text(addLabel).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(PurchaseButtonStyle())
                Button {
                    Task { await add(openCheckout: true) }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "bolt.fill").font(.system(size: 15, weight: .medium))
                        Text(model.quantity > 1 ? l.t("product.buyNowCount", ["count": "\(model.quantity)"]) : l.t("product.buyNow"))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(PurchaseButtonStyle())
            }
            .disabled(!ready && model.variant != nil)
            .opacity(ready || model.variant == nil ? 1 : 0.5)
            Button(action: openFull) {
                HStack(spacing: 8) {
                    Text(l.t("quick.fullDetails"))
                    Image(systemName: "arrow.forward").font(.system(size: 14, weight: .bold)).flipsForRightToLeftLayoutDirection(true)
                }
                .font(.inter(15, .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 50)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.navy))
            }
            .buttonStyle(.tap)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .background(Color.white.shadow(.drop(color: Brand.navy.opacity(0.08), radius: 10, y: -4)))
    }

    private var addLabel: String {
        if model.variant == nil && product.isAvailable { return l.t("product.chooseOption") }
        if model.variant?.preorder != nil { return model.quantity > 1 ? l.t("product.preorderCount", ["count": "\(model.quantity)"]) : l.t("product.preorderAction") }
        return l.t("product.addToCart")
    }

    /// The whole page: the sheet goes down and the page opens where the card was.
    private func openFull() {
        let handle = product.handle
        app.previewing = nil
        app.push(.product(handle: handle))
    }

    /// The product page's rule: a choice first; Buy now on something already
    /// in the bag goes straight to checkout rather than adding it again.
    private func add(openCheckout: Bool) async {
        failure = nil
        guard let chosen = model.variant else {
            failure = "product.chooseOption"
            Haptics.refused()
            return
        }
        if openCheckout, app.cart.quantity(of: chosen.id) > 0 {
            app.previewing = nil
            app.openCheckout()
            return
        }
        if await model.add(to: app.cart) {
            Haptics.succeeded()
            announce(l.t("cart.added", ["name": product.title]))
            if openCheckout {
                app.previewing = nil
                app.openCheckout()
            }
        } else {
            Haptics.refused()
            failure = openCheckout ? "cart.buyFailed" : "cart.addFailed"
        }
    }
}
