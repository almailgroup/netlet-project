import SwiftUI

/// One product, in the shop's frame — the web's `/products/<handle>`.
struct ProductDetailView: View {
    let handle: String
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { ProductDetailViewModel(handle: handle, catalog: app.services.catalog) }) { model in
            content(model)
        }
    }

    @ViewBuilder
    private func content(_ model: ProductDetailViewModel) -> some View {
        Group {
            if case .loaded(let found) = model.product, let product = found {
                ProductPage(product: product, model: model)
            } else {
                // Waiting, failed or gone: still the shop's frame, with its way back.
                ShopPage(refresh: { await model.load(language: l.current) }) {
                    LoadStateView(state: model.product, retry: { await model.load(language: l.current) }) { _ in
                        EmptyStateView(
                            systemImage: "shippingbox",
                            title: l.t("product.notFound"),
                            note: l.t("product.notFoundNote")
                        )
                        .card(padding: 0)
                    }
                    .padding(16)
                }
            }
        }
        .task(id: l.current) { await model.load(language: l.current) }
    }
}

/// The product page, the web's `ProductDetail` as a phone draws it: where it
/// sits, the photographs, then one card that decides the purchase — who sells
/// it, the name, the rating, the price and its saving, whether it is in stock
/// and when it would arrive, the choice of variant, how many, Add to cart
/// beside the heart and Buy now under them — and after the decision the
/// details as four sections that open and close, then related products.
/// Once the page's own buttons have gone up under the header, the price and
/// the same two buttons float over the tab bar.
private struct ProductPage: View {
    let product: Product
    @Bindable var model: ProductDetailViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var failure: String?
    @State private var buttonsGone = false
    @State private var open: Set<String> = ["specifications"]
    /// The photos, open on the list or straight on full screen. One value
    /// rather than a flag and a second flag beside it: a value read only
    /// inside a cover's content is the old one the first time it presents.
    @State private var photos: PhotoViewerStart?
    /// Whether the shopper holds a membership, for the member price line.
    @State private var member = false
    /// The governorate the account delivers to, named in "Get it by … to …".
    @State private var area: Governorate?
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        ShopPage(refresh: { await model.load(language: l.current) }, assistant: !buttonsGone, assistantProduct: product) {
            VStack(alignment: .leading, spacing: 0) {
                Breadcrumbs(trail: crumbs)
                ProductPhotos(product: product, index: $model.imageIndex) { photos = .photos }
                    .padding(.top, 8)
                buyBox
                    .padding(.top, 24)
                // Complements before reviews, reviews before more to consider.
                BoughtTogetherShelf(product: product)
                ReviewsSection(product: product)
                    .padding(.top, 40)
                related
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(alignment: .bottom) {
            if buttonsGone { stickyBar.transition(.move(edge: .bottom).combined(with: .opacity)) }
        }
        .animation(still ? nil : .easeOut(duration: 0.2), value: buttonsGone)
        .sensoryFeedback(.impact(weight: .medium, intensity: Haptics.strength), trigger: app.cart.itemCount)
        .fullScreenCover(item: $photos) { start in
            PhotoSheet(product: product, index: $model.imageIndex, startFull: start == .zoom) { photos = nil }
                .environment(\.layoutDirection, l.layoutDirection)
                .buttonStyle(HapticDefaultStyle())
        }
        .task(id: app.session.isSignedIn) {
            guard app.session.isSignedIn else {
                member = false
                area = nil
                return
            }
            member = (try? await app.services.api.call(API.myMembership))?.member ?? false
            area = ReferenceData.shared.governorate(id: (try? await app.services.account.profile())?.deliveryZoneId)
        }
        .task {
            // A screenshot's start (`-NetLetOpen photos:` or `zoom:`), taken once.
            guard let start = app.photoViewerStart else { return }
            app.photoViewerStart = nil
            photos = start
        }
    }

    private var crumbs: [String] {
        var trail: [String] = []
        if let type = product.productType, !type.isEmpty {
            trail.append(ReferenceData.shared.department(named: type).map { l.t($0.label) } ?? type)
        }
        trail.append(product.title)
        return trail
    }

    private var variant: ProductVariant? { model.variant ?? product.leadVariant }

    // MARK: The card that decides the purchase

    private var buyBox: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let vendor = product.vendor, !vendor.isEmpty {
                FlowLayout(spacing: 8) {
                    if let slug = product.vendorSlug {
                        Button(l.t("browse.soldBy", ["name": vendor])) { app.push(.store(slug: slug)) }
                            .font(.inter(12, .bold))
                            .foregroundStyle(Brand.accentInk)
                            .buttonStyle(.tap)
                    } else {
                        Text(vendor).font(.inter(12, .bold)).foregroundStyle(Brand.muted)
                    }
                    StoreBadges(badges: product.vendorBadges)
                }
            }
            if let sku = variant?.sku, !sku.isEmpty {
                (Text(l.t("product.sku") + ": ") + Text("\u{2066}\(sku)\u{2069}"))
                    .font(.inter(14, .medium))
                    .foregroundStyle(Brand.muted)
                    .padding(.top, 12)
            }
            if let type = product.productType, !type.isEmpty {
                Text(l.t("product.category") + ": " + (ReferenceData.shared.department(named: type).map { l.t($0.label) } ?? type))
                    .font(.inter(14, .medium))
                    .foregroundStyle(Brand.muted)
                    .padding(.top, 8)
            }
            Text(product.title)
                .font(.inter(26, .heavy))
                .tracking(-0.5)
                .lineSpacing(4)
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 8)
            if let rating = product.rating {
                HStack(spacing: 8) {
                    Image(systemName: "star.fill").font(.system(size: 14)).foregroundStyle(Brand.star)
                    Text(rating.value.formatted(.number.precision(.fractionLength(0...1))))
                        .font(.inter(14, .heavy))
                        .foregroundStyle(Brand.ink)
                    if let count = rating.count {
                        Text("(" + (count == 1 ? l.t("product.reviewOne") : l.t("product.reviews", ["count": "\(count)"])) + ")")
                            .font(.inter(14))
                            .foregroundStyle(Brand.muted)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(rating.count.map { l.t("product.ratingAriaCount", ["value": "\(rating.value)", "max": "\(Int(rating.scaleMax))", "count": "\($0)"]) }
                    ?? l.t("product.ratingAria", ["value": "\(rating.value)", "max": "\(Int(rating.scaleMax))"]))
                .padding(.top, 12)
            }
            if product.isExpress {
                HStack(spacing: 6) {
                    Image(systemName: "bolt.fill").font(.system(size: 12))
                    Text(l.t("product.expressTitle"))
                }
                .font(.inter(12, .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 12)
                .padding(.vertical, 4)
                .background(Capsule().fill(Brand.orange))
                .padding(.top, 16)
            }
            price.padding(.top, 20)
            priceNotes
            Rectangle().fill(Brand.navy.opacity(0.08)).frame(height: 1).padding(.vertical, 24)
            VStack(alignment: .leading, spacing: 8) {
                availability
                if variant?.preorder == nil {
                    DeliveryLine(speed: product.deliverySpeed, provider: product.deliveryProvider, area: area?.name(l.current))
                }
            }
            choices.padding(.top, 8)
            // The fitting beside the choosing: the size guide and seeing it on you.
            FlowLayout(spacing: 20) {
                if let chart = product.sizeChart {
                    SizeGuideButton(product: product, chart: chart) { size in
                        model.choose(size: size, axis: chart.axis, in: product)
                    }
                }
                TryOnButton(product: product)
            }
            .padding(.top, 8)
            if let addons = product.addons, !addons.isEmpty {
                AddonPicker(addons: addons, chosen: $model.addons).padding(.top, 16)
            }
            if let variant = model.variant ?? product.leadVariant {
                BundlesPanel(variantId: variant.id)
            }
            quantity.padding(.top, 24)
            buttons
                .padding(.top, 24)
                .background {
                    GeometryReader { proxy in
                        Color.clear.onChange(of: proxy.frame(in: .global).maxY < 120) { _, gone in buttonsGone = gone }
                    }
                }
            if let failure { FieldProblem(key: failure).padding(.top, 8) }
            if variant?.preorder != nil {
                Text(l.t("product.preorderNote"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .padding(.top, 12)
            }
            VStack(alignment: .leading, spacing: 12) {
                if let variant = model.variant, variant.availableForSale, variant.preorder == nil,
                   product.subscription != nil, app.features.isOn("subscriptions") {
                    SubscribePanel(product: product, variant: variant, quantity: model.quantity)
                }
                FollowButton(product: product)
                if let variant = model.variant ?? product.leadVariant {
                    PriceRequestPanel(variant: variant)
                }
                if product.isExpress {
                    Label(l.t("product.expressNote"), systemImage: "checkmark.seal")
                        .font(.inter(12, .semibold))
                        .foregroundStyle(Brand.muted)
                        .frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                }
                // On a phone it follows everything that buys, the web's place for it.
                ProductAssistantPanel(product: product)
            }
            .padding(.top, 16)
            Rectangle().fill(Brand.navy.opacity(0.08)).frame(height: 1).padding(.vertical, 24)
            information
        }
        .padding(24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
        .shadow(color: Brand.navy.opacity(0.05), radius: 16, x: 0, y: 8)
    }

    @ViewBuilder
    private var price: some View {
        if let variant {
            FlowLayout(spacing: 12) {
                Text(variant.price.formatted(l.current))
                    .font(.inter(32, .heavy))
                    .tracking(-1.2)
                    .foregroundStyle(Brand.ink)
                if let was = variant.compareAtPrice, variant.saving != nil {
                    Text(was.formatted(l.current))
                        .font(.inter(18))
                        .strikethrough()
                        .foregroundStyle(Brand.muted)
                        .accessibilityLabel(l.t("browse.onOffer") + ", " + was.formatted(l.current))
                }
                if let percent = variant.savingPercent, percent > 0 {
                    Text(l.t("product.savePercent", ["percent": "\(percent)"]))
                        .font(.inter(12, .bold))
                        .foregroundStyle(Color(red: 21 / 255, green: 87 / 255, blue: 36 / 255))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Color(red: 212 / 255, green: 237 / 255, blue: 218 / 255)))
                }
            }
        }
    }

    /// A member's own price, shown only to a member — a price somebody is told
    /// about and cannot have is not one to show them — and the price per kilo
    /// or litre of something sold by weight (`UnitPrice`).
    @ViewBuilder
    private var priceNotes: some View {
        if let variant {
            if member, let memberPrice = variant.memberPrice {
                Label(l.t("membership.yourPrice", ["price": memberPrice.formatted(l.current)]), systemImage: "checkmark.seal.fill")
                    .font(.inter(13, .heavy))
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Color(red: 231 / 255, green: 237 / 255, blue: 245 / 255)))
                    .padding(.top, 8)
            }
            if let measure = variant.measure,
               let per = ListingRules.shared.unitPrice(variant.price, unit: measure.unit, step: measure.stepAmount) {
                Text(l.t("unit.perUnit", ["price": per.price.formatted(l.current), "unit": l.t("unit.\(per.unit)")]))
                    .font(.inter(14))
                    .foregroundStyle(Brand.muted)
                    .padding(.top, 4)
            }
        }
    }

    @ViewBuilder
    private var availability: some View {
        if let variant = model.variant {
            if !variant.availableForSale {
                Label(l.t("product.outOfStock"), systemImage: "xmark.circle").foregroundStyle(Color(red: 179 / 255, green: 38 / 255, blue: 30 / 255))
                    .font(.inter(14, .bold))
            } else if let preorder = variant.preorder {
                // The release date is the promise; one already past is no date at all (`preorder.ts`).
                Label(preorder.releaseAt.map { l.t("product.preorderShips", ["date": OrderWording.day($0, language: l.current)]) } ?? l.t("product.preorderShipsUnknown"), systemImage: "clock")
                    .foregroundStyle(Brand.navy)
                    .font(.inter(14, .bold))
            } else {
                Label(l.t("product.inStock"), systemImage: "checkmark.circle").foregroundStyle(Brand.success)
                    .font(.inter(14, .bold))
            }
        } else if !product.isAvailable {
            Label(l.t("product.soldOut"), systemImage: "xmark.circle").foregroundStyle(Color(red: 179 / 255, green: 38 / 255, blue: 30 / 255))
                .font(.inter(14, .bold))
        }
    }

    /// Options when they tell every variant apart, names otherwise, and
    /// nothing for a product with one variant (`choiceMode`).
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
                        ForEach(product.variants) { variant in
                            ChoiceChip(title: variant.title, selected: model.variant?.id == variant.id, available: variant.availableForSale) {
                                model.select(variant: variant)
                            }
                        }
                    }
                }
                .padding(.top, 16)
            }
        }
    }

    /// How many, and what the bag already holds of this option — the stepper
    /// is "how many more", and a 1 beside a bag of 5 read as the bag being wrong.
    @ViewBuilder
    private var quantity: some View {
        if let variant = model.variant, variant.availableForSale {
            let inBag = app.cart.quantity(of: variant.id)
            FlowLayout(spacing: 12) {
                Text(l.t("product.quantity") + ":").font(.inter(14, .semibold)).foregroundStyle(Brand.muted)
                    .frame(minHeight: 44)
                QuantityStepper(quantity: model.quantity, maximum: max(1, variant.maxQuantity), name: product.title) { next in
                    model.quantity = min(max(1, next), max(1, variant.maxQuantity))
                }
                if inBag > 0 {
                    Button {
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

    /// Add to cart beside the heart, Buy now under them — both the card's
    /// white button, told apart by the bag and the bolt (`PURCHASE_TONE`).
    private var buttons: some View {
        let ready = model.variant?.availableForSale == true
        return VStack(spacing: 12) {
            HStack(spacing: 12) {
                Button {
                    Task { await add(openCheckout: false) }
                } label: {
                    HStack(spacing: 8) {
                        if model.adding { ProgressView().tint(Brand.navy) } else { Image(systemName: "bag").font(.system(size: 17, weight: .medium)) }
                        Text(addLabel).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity, minHeight: 56)
                }
                .buttonStyle(PurchaseButtonStyle())
                Button {
                    Task { await app.heart(product) }
                } label: {
                    Image(systemName: app.saved.contains(product.id) ? "heart.fill" : "heart")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(Color(red: 230 / 255, green: 28 / 255, blue: 56 / 255))
                        .frame(width: 56, height: 56)
                }
                .buttonStyle(PurchaseButtonStyle())
                .accessibilityLabel(l.t(app.saved.contains(product.id) ? "product.removeSaved" : "product.save", ["name": product.title]))
            }
            Button {
                Task { await add(openCheckout: true) }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "bolt.fill").font(.system(size: 16, weight: .medium))
                    Text(buyLabel).lineLimit(1).minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, minHeight: 56)
            }
            .buttonStyle(PurchaseButtonStyle())
        }
        .disabled(!ready && model.variant != nil)
        .opacity(ready || model.variant == nil ? 1 : 0.5)
    }

    private var addLabel: String {
        if model.variant == nil && product.isAvailable { return l.t("product.chooseOption") }
        if model.variant?.preorder != nil { return model.quantity > 1 ? l.t("product.preorderCount", ["count": "\(model.quantity)"]) : l.t("product.preorderAction") }
        return l.t("product.addToCart")
    }

    private var buyLabel: String {
        model.quantity > 1 ? l.t("product.buyNowCount", ["count": "\(model.quantity)"]) : l.t("product.buyNow")
    }

    /// The price and the same two buttons, over the tab bar once the page's
    /// own have gone up under the header (`StickyBuyBar`).
    private var stickyBar: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(product.title).font(.inter(12)).foregroundStyle(Brand.muted).lineLimit(1)
                if let variant {
                    Text(variant.price.formatted(l.current)).font(.inter(16, .heavy)).foregroundStyle(Brand.navy)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                Task { await add(openCheckout: false) }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "bag").font(.system(size: 14, weight: .medium))
                    Text(l.t("product.addToCart")).lineLimit(1)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
            }
            .buttonStyle(PurchaseButtonStyle(radius: 12, size: 14))
            Button {
                Task { await add(openCheckout: true) }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "bolt.fill").font(.system(size: 13, weight: .medium))
                    Text(l.t("product.buyNow")).lineLimit(1)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
            }
            .buttonStyle(PurchaseButtonStyle(radius: 12, size: 14))
        }
        .disabled(model.variant?.availableForSale != true)
        .padding(.leading, 18)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .background(GlassCapsule())
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("product.buyBar", ["name": product.title]))
    }

    // MARK: After the decision

    private var information: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(l.t("product.information")).font(.inter(17, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                .padding(.bottom, 8)
            section("specifications", symbol: "list.bullet.indent", title: l.t("product.specifications")) { specifications }
            section("shipping", symbol: "truck.box", title: l.t("product.shippingPolicy")) {
                VStack(alignment: .leading, spacing: 14) {
                    if product.isExpress { policyRow("bolt", "product.expressTitle", "shipping.express.body") }
                    policyRow("truck.box", "shipping.standard.title", "shipping.standard.body")
                    policyRow("tag", "shipping.charges.title", "shipping.charges.body")
                    policyRow("wallet.pass", "shipping.payment.title", "shipping.payment.body")
                }
            }
            section("warranty", symbol: "checkmark.shield", title: l.t("product.warrantyPolicy")) {
                VStack(alignment: .leading, spacing: 14) {
                    policyRow("checkmark.shield", l.t("warranty.seller.title"), product.warranty.map { l.t("warranty.seller.stated", ["value": $0]) } ?? l.t("warranty.seller.none"), translated: true)
                    policyRow("checkmark.shield", "shipping.protection.title", "shipping.protection.body")
                    policyRow("wrench.and.screwdriver", "warranty.claim.title", "warranty.claim.body")
                }
            }
            section("returns", symbol: "arrow.uturn.backward", title: l.t("product.returnsPolicy")) {
                VStack(alignment: .leading, spacing: 14) {
                    policyRow("arrow.uturn.backward", l.t("shipping.returns.title"), l.t("returns.window.body", ["days": "\(ReferenceData.shared.rules.returnWindowDays)"]), translated: true)
                    policyRow("shippingbox", "returns.condition.title", "returns.condition.body")
                    policyRow("wallet.pass", "returns.refund.title", "returns.refund.body")
                }
            }
        }
    }

    /// One of the four, the WAI-ARIA disclosure the web draws on a phone.
    private func section<Content: View>(_ id: String, symbol: String, title: String, @ViewBuilder content: () -> Content) -> some View {
        let shown = open.contains(id)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(still ? nil : .easeOut(duration: 0.2)) {
                    if shown { open.remove(id) } else { open.insert(id) }
                }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(Brand.navy).frame(width: 22)
                    Text(title).font(.inter(15, .bold)).foregroundStyle(Brand.navy).frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Brand.muted)
                        .rotationEffect(.degrees(shown ? 180 : 0))
                }
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            .accessibilityAddTraits(.isHeader)
            if shown {
                content()
                    .padding(.bottom, 16)
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Brand.cardLine).frame(height: 1) }
    }

    private func policyRow(_ symbol: String, _ title: String, _ body: String, translated: Bool = false) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 34, height: 34)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.navy.opacity(0.08)))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Brand.navy.opacity(0.12), lineWidth: 1))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(translated ? title : l.t(title)).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
                Text(translated ? body : l.t(body)).font(.inter(13)).lineSpacing(3).foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var specifications: some View {
        let blocks = DescriptionBlock.parse(product.description)
        let specs = product.specifications
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let text):
                    Text(text).font(.inter(14)).lineSpacing(6).foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                case .list(let items):
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(items, id: \.self) { item in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("•").foregroundStyle(Brand.navy.opacity(0.4))
                                Text(item).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
            if specs.isEmpty {
                if blocks.isEmpty {
                    Text(l.t("product.noSpecs")).font(.inter(14)).foregroundStyle(Brand.muted)
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(specs.enumerated()), id: \.offset) { index, row in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(row.label).font(.inter(13)).foregroundStyle(Brand.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(row.value).font(.inter(13, .semibold)).foregroundStyle(Brand.ink)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(index % 2 == 0 ? Brand.photo : Color.white)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            }
        }
    }

    // MARK: Related products

    @ViewBuilder
    private var related: some View {
        let others = relatedProducts
        if !others.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                Rectangle().fill(Brand.cardLine).frame(height: 1)
                    .padding(.bottom, 24)
                Text(l.t("product.relatedTitle")).shelfTitle()
                ProductGrid(products: others)
            }
            .padding(.top, 56)
        }
    }

    /// The same department or a shared tag (`Shared/commerce/related.ts`); the
    /// seller only breaks a tie, and nothing scoring nothing fills a place.
    private var relatedProducts: [Product] {
        let tags = Set(product.tags.map { $0.lowercased() })
        let scored: [(product: Product, score: Int, offset: Int)] = (app.shelf.catalogue.value ?? []).enumerated().compactMap { offset, other in
            guard other.id != product.id else { return nil }
            var score = 0
            if let type = product.productType, !type.isEmpty, other.productType == type { score += 3 }
            score += Set(other.tags.map { $0.lowercased() }).intersection(tags).count * 2
            guard score > 0 else { return nil }
            if other.vendor == product.vendor { score += 1 }
            return (other, score, offset)
        }
        return scored.sorted { $0.score != $1.score ? $0.score > $1.score : $0.offset < $1.offset }.prefix(4).map { $0.product }
    }

    private func add(openCheckout: Bool) async {
        failure = nil
        guard model.variant != nil else {
            // Nothing chosen yet: the first button says so, and pressing it
            // shows where the choice is.
            failure = "product.chooseOption"
            return
        }
        // Buy now on an item already in the bag goes straight to checkout rather than adding it again.
        if openCheckout, let variant = model.variant, app.cart.quantity(of: variant.id) > 0 {
            app.openCheckout()
            return
        }
        if await model.add(to: app.cart) {
            announce(l.t("cart.added", ["name": product.title]))
            if openCheckout { app.openCheckout() }
        } else {
            Haptics.refused()
            failure = openCheckout ? "cart.buyFailed" : "cart.addFailed"
        }
    }
}

/// The product page's white buttons: a white surface, a light navy rim, navy
/// words, shaded while a finger is down (`PURCHASE_TONE`).
struct PurchaseButtonStyle: ButtonStyle {
    var radius: CGFloat = 14
    var size: CGFloat = 15

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(size, .bold))
            .foregroundStyle(Brand.navy)
            .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(configuration.isPressed ? Brand.pressFill : Color.white))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Brand.navy.opacity(0.2), lineWidth: 1))
            .pressHaptic(configuration.isPressed, strength: Haptics.actionStrength)
    }
}

/// The seller's band said as a date to plan on — "Get it by Tue 13 Oct" —
/// counted in business days across the Kuwaiti weekend, and nothing at all
/// when the seller stated nothing (`DeliverySpeedLine`).
struct DeliveryLine: View {
    let speed: String?
    let provider: String?
    /// The shopper's governorate, when the account has one (`speed.getByTo`).
    var area: String? = nil
    @Environment(LanguageSettings.self) private var l

    /// Business days each band covers; made to order has none.
    static let windows: [String: ClosedRange<Int>] = ["same_day": 0...0, "next_day": 1...1, "two_to_four": 2...4, "up_to_week": 4...7]

    var body: some View {
        if speed != nil || provider != nil {
            VStack(alignment: .leading, spacing: 4) {
                if let speed, let window = Self.windows[speed] {
                    let date = day(Self.addBusinessDays(window.upperBound))
                    Text(area.map { l.t("speed.getByTo", ["date": date, "area": $0]) } ?? l.t("speed.getBy", ["date": date]))
                        .font(.inter(15, .bold))
                        .foregroundStyle(Brand.success)
                }
                FlowLayout(spacing: 8) {
                    Label(speed.map { l.t("speed.\($0)") } ?? l.t("product.shippedBy", ["name": provider ?? ""]), systemImage: "truck.box")
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                    if speed != nil, let provider {
                        Text(l.t("product.shippedBy", ["name": provider])).font(.inter(13)).foregroundStyle(Brand.muted)
                    }
                    if speed != nil {
                        Text(l.t("speed.bySeller")).font(.inter(12)).foregroundStyle(Brand.muted)
                    }
                }
            }
        }
    }

    private func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = l.current.locale
        formatter.timeZone = Self.kuwait
        formatter.setLocalizedDateFormatFromTemplate("EEEdMMM")
        return formatter.string(from: date)
    }

    static let kuwait = TimeZone(identifier: "Asia/Kuwait") ?? TimeZone(secondsFromGMT: 3 * 3600)!

    /// `days` business days from today in Kuwait, skipping Friday and Saturday;
    /// zero still moves off a weekend.
    static func addBusinessDays(_ days: Int, from now: Date = Date()) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = kuwait
        func weekend(_ date: Date) -> Bool {
            let weekday = calendar.component(.weekday, from: date)
            return weekday == 6 || weekday == 7
        }
        var date = calendar.startOfDay(for: now)
        while weekend(date) { date = calendar.date(byAdding: .day, value: 1, to: date) ?? date }
        var left = max(0, days)
        while left > 0 {
            date = calendar.date(byAdding: .day, value: 1, to: date) ?? date
            if !weekend(date) { left -= 1 }
        }
        return date
    }
}

extension Product {
    /// The seller's own warranty as they typed it (`merchantWarranty`).
    var warranty: String? {
        let row = attributes.first { $0.namespace != "reviews" && $0.key.lowercased().filter { !" _-".contains($0) } == "warranty" }
        let value = row?.value.trimmingCharacters(in: .whitespaces) ?? ""
        return value.isEmpty ? nil : value
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
        .buttonStyle(.tap)
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
