import SwiftUI

/// A product seen without leaving the shelf — opened by **holding a card**, on
/// the owner's word, and the app's alone: the web's Quick View, as a sheet
/// that rises over the page the shopper is on.
///
/// It is enough to decide on: the photographs to swipe through, who sells it,
/// the name, the rating and the price, whether it is in stock and when it
/// arrives, the choice of size or colour, how many, and Add to cart and Buy
/// now — the product page's own rules through the product page's own model,
/// so the two cannot answer differently. **Full product details** opens the
/// whole page, and so does a press on the photo or the name: the sheet goes
/// down and the page is pushed where the card was.
///
/// **It is drawn as the web's preview is, on the owner's word** ("it's not
/// working well"): it opened on a square photo that filled the sheet, so the
/// price was cut at its foot and the choice, the stock and the quantity were
/// all a scroll away, under three full-width buttons. Now a navy band says
/// what it is and closes it, the photo is a 4:3 window with its thumbnails
/// under it and a count on it, the price, the stock, the delivery date and
/// the choice follow on the first screen, and the pair at the foot is the
/// web's `PREVIEW_TONE` — Add to cart in navy, Buy now white with a navy rim —
/// with the whole page a link under the details. Add to cart says it worked
/// where the finger is ("Added to your cart", with a tick) and the line under
/// the quantity says how many the bag holds, with View cart; a choice not yet
/// made is scrolled to and said, rather than a line appearing out of sight.
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
        .presentationDetents([.large])
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
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var failure: String?
    /// The photograph showing, among the stills.
    @State private var photo = 0
    /// Add to cart was pressed and taken: the button says so for a moment.
    @State private var added = false
    @State private var addedReset: Task<Void, Never>?

    /// The server's fresh copy once it has answered, the card's until then.
    private var product: Product { model.product.value.flatMap { $0 } ?? shown }
    private var variant: ProductVariant? { model.variant ?? product.leadVariant }
    private var stills: [ProductImage] { Array(product.images.prefix(8)) }

    /// Every line of the chosen option in the bag — plain, with extras, in a
    /// set — the web's count.
    private var inBag: Int {
        guard let chosen = model.variant else { return 0 }
        return (app.cart.cart?.items ?? []).filter { $0.variantId == chosen.id }.reduce(0) { $0 + $1.quantity }
    }

    /// What is left of the chosen option once the bag's own is counted
    /// (`BagStock.room`): it offered the whole shelf over a bag that already
    /// held most of it, and checkout then refused.
    private var room: Int {
        guard let chosen = model.variant else { return 0 }
        return BagStock.room(chosen.maxQuantity, inBag: inBag)
    }

    /// The pair can add something: an option chosen, on sale, with room left.
    private var ready: Bool { model.variant?.availableForSale == true && room > 0 }

    var body: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                band
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        photos
                        details.padding(.horizontal, 20).padding(.top, 18)
                    }
                    .padding(.bottom, 24)
                }
                actions(proxy)
            }
        }
        .background(Color.white)
        .onChange(of: model.imageIndex) { _, index in
            // A colour chosen shows its photo — counted in the gallery, which
            // a video can sit in, so it is found among the stills by address.
            guard product.gallery.indices.contains(index) else { return }
            let address = product.gallery[index].url
            if let at = stills.firstIndex(where: { $0.url == address }) {
                withAnimation(still ? nil : .easeInOut(duration: 0.25)) { photo = at }
            }
        }
        .onDisappear { addedReset?.cancel() }
    }

    // MARK: The band: what this is, saving, sharing, closing

    /// The brand's navy across the top, the web's: the preview is the shop
    /// speaking over the page, and says so in its colour.
    private var band: some View {
        HStack(spacing: 2) {
            Text(l.t("quick.title"))
                .font(.inter(15, .bold))
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            let hearted = app.saved.isHearted(product.id)
            Button {
                Task { await app.heart(product) }
            } label: {
                Image(systemName: hearted ? "heart.fill" : "heart")
                    .font(.system(size: 18, weight: .medium))
                    // A lighter red than the cards' — the same red on navy is
                    // under 3:1; this is 5.3:1.
                    .foregroundStyle(hearted ? Color(red: 1, green: 107 / 255, blue: 127 / 255) : .white)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.action)
            .accessibilityLabel(l.t(hearted ? "product.removeSaved" : "product.save", ["name": product.title]))
            ShareLink(item: app.services.configuration.url(path: ReferralCode.productPath(handle: product.handle, code: app.memberCode))) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(l.t("product.share", ["name": product.title]))
            Button {
                app.previewing = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 34, height: 34)
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 1))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("quick.close"))
        }
        .padding(.leading, 20)
        .padding(.trailing, 8)
        .padding(.top, 16)
        .padding(.bottom, 6)
        .background(Brand.navy)
    }

    // MARK: The photographs

    /// Every photograph in a 4:3 window — swiped like the phone's own
    /// pictures, mirrored on the Arabic page — with a count on it and the
    /// thumbnails under it, the web's preview. A press opens the whole product.
    private var photos: some View {
        VStack(spacing: 10) {
            Group {
                if stills.count > 1 {
                    TabView(selection: $photo) {
                        ForEach(Array(stills.enumerated()), id: \.offset) { index, image in
                            photoFrame(image).tag(index)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                } else {
                    photoFrame(stills.first)
                }
            }
            .aspectRatio(4.0 / 3.0, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .background(Brand.photo)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(alignment: .topLeading) {
                if let percent = variant?.savingPercent, percent > 0 {
                    SavingBadge(percent: percent, large: true).padding(12)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if stills.count > 1 {
                    Text("\(photo + 1) / \(stills.count)")
                        .font(.inter(12, .bold))
                        .monospacedDigit()
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Color.white.opacity(0.92)))
                        .environment(\.layoutDirection, .leftToRight)
                        .padding(10)
                        .accessibilityHidden(true)
                }
            }
            if stills.count > 1 {
                thumbnails
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    private var thumbnails: some View {
        ScrollViewReader { strip in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(stills.enumerated()), id: \.offset) { index, image in
                        let current = index == photo
                        Button {
                            withAnimation(still ? nil : .easeInOut(duration: 0.25)) { photo = index }
                        } label: {
                            RemoteImage(reference: image.url, contentMode: .fit)
                                .padding(4)
                                .frame(width: 56, height: 56)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .strokeBorder(current ? Brand.navy : Brand.cardLine, lineWidth: current ? 2 : 1)
                                )
                                .scaleEffect(current || still ? 1 : 0.94)
                                .animation(still ? nil : .spring(duration: 0.25, bounce: 0.3), value: current)
                        }
                        .buttonStyle(.tap)
                        .id(index)
                        .accessibilityLabel(l.t("product.showImage", ["index": "\(index + 1)", "total": "\(stills.count)"]))
                        .accessibilityAddTraits(current ? .isSelected : [])
                    }
                }
                .padding(.vertical, 2)
            }
            .onChange(of: photo) { _, now in
                withAnimation(still ? nil : .easeInOut(duration: 0.25)) { strip.scrollTo(now, anchor: .center) }
            }
        }
    }

    private func photoFrame(_ image: ProductImage?) -> some View {
        Button(action: openFull) {
            Brand.photo
                .overlay {
                    if let image {
                        RemoteImage(reference: image.url, contentMode: .fit, label: image.altText ?? product.title)
                            .padding(12)
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
                    .font(.inter(22, .heavy))
                    .tracking(-0.3)
                    .foregroundStyle(Brand.navy)
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
                    .contentTransition(.numericText())
                    .animation(still ? nil : .snappy(duration: 0.25), value: variant.id)
                if let measure = variant.measure,
                   let per = ListingRules.shared.unitPrice(variant.price, unit: measure.unit, step: measure.stepAmount) {
                    Text(l.t("unit.perUnit", ["price": l.price(per.price), "unit": l.t("unit.\(per.unit)")]))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .padding(.top, 2)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                availability
                if variant?.preorder == nil {
                    DeliveryLine(speed: product.deliverySpeed, provider: product.deliveryProvider)
                }
            }
            .padding(.top, 14)
            if let summary {
                Text(summary)
                    .font(.inter(15))
                    .foregroundStyle(Brand.body)
                    .lineSpacing(3)
                    .lineLimit(4)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 14)
            }
            Rectangle().fill(Brand.navy.opacity(0.08)).frame(height: 1).padding(.top, 18)
            choices.id(QuickViewPlace.choices)
            quantity.padding(.top, 16)
            if let failure {
                FieldProblem(key: failure)
                    .padding(.top, 8)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            Button(action: openFull) {
                HStack(spacing: 6) {
                    Text(l.t("quick.fullDetails")).underline()
                    Image(systemName: "arrow.forward").font(.system(size: 13, weight: .bold)).flipsForRightToLeftLayoutDirection(true)
                }
                .font(.inter(15, .bold))
                .foregroundStyle(Brand.navy)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            .padding(.top, 14)
        }
        .animation(still ? nil : .easeOut(duration: 0.2), value: failure)
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

    /// How many, and what the bag already holds of this choice — or, sold
    /// out, a way to hear when it is back, which takes the stepper's place as
    /// on the web.
    @ViewBuilder
    private var quantity: some View {
        if let chosen = model.variant {
            if chosen.availableForSale {
                VStack(alignment: .leading, spacing: 8) {
                    if room > 0 {
                        HStack(spacing: 12) {
                            Text(l.t("product.quantity"))
                                .font(.inter(14, .semibold))
                                .foregroundStyle(Brand.muted)
                            QuantityStepper(quantity: min(model.quantity, room), maximum: room, name: product.title) { next in
                                model.quantity = min(max(1, next), room)
                            }
                        }
                    }
                    if inBag > 0 {
                        HStack(spacing: 8) {
                            Text(inBag == 1 ? l.t("product.inYourCartOne") : l.t("product.inYourCartMany", ["count": "\(inBag)"]))
                                .font(.inter(13, .semibold))
                                .foregroundStyle(Brand.body)
                            Button {
                                app.previewing = nil
                                app.select(.cart)
                            } label: {
                                Text(l.t("ios.quick.viewCart"))
                                    .font(.inter(13, .bold))
                                    .foregroundStyle(Brand.navy)
                                    .underline()
                                    .frame(minHeight: 44)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.tap)
                        }
                        .transition(.opacity)
                    }
                }
                .onChange(of: room, initial: true) { _, most in
                    if most > 0, model.quantity > most { model.quantity = most }
                }
                .animation(still ? nil : .easeOut(duration: 0.2), value: inBag)
            } else {
                FollowButton(product: product)
            }
        }
    }

    // MARK: The buttons, kept under the thumb

    private func actions(_ proxy: ScrollViewProxy) -> some View {
        HStack(spacing: 10) {
            Button {
                Task { await add(openCheckout: false, proxy: proxy) }
            } label: {
                AddToCartLabel(title: addLabel, adding: model.adding, done: added, iconSize: 16)
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(AddToCartStyle(done: added))
            Button {
                Task { await add(openCheckout: true, proxy: proxy) }
            } label: {
                BuyNowLabel(title: model.quantity > 1 && ready ? l.t("product.buyNowCount", ["count": "\(min(model.quantity, room))"]) : l.t("product.buyNow"), iconSize: 15)
                    .padding(.horizontal, 10)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(BuyNowStyle())
        }
        .disabled(model.variant != nil && !ready)
        .opacity(model.variant != nil && !ready ? 0.5 : 1)
        .animation(still ? nil : .spring(duration: 0.3, bounce: 0.25), value: added)
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 12)
        .background(Color.white.shadow(.drop(color: Brand.navy.opacity(0.08), radius: 10, y: -4)))
    }

    private var addLabel: String {
        if model.variant == nil && product.isAvailable { return l.t("product.chooseOption") }
        if model.variant?.preorder != nil { return model.quantity > 1 ? l.t("product.preorderCount", ["count": "\(model.quantity)"]) : l.t("product.preorderAction") }
        return model.quantity > 1 ? l.t("product.addToCartCount", ["count": "\(min(model.quantity, max(room, 1)))"]) : l.t("product.addToCart")
    }

    /// The whole page: the sheet goes down and the page opens where the card was.
    private func openFull() {
        let handle = product.handle
        app.previewing = nil
        app.push(.product(handle: handle))
    }

    /// The product page's rule: a choice first; Buy now on something already
    /// in the bag goes straight to checkout rather than adding it again.
    private func add(openCheckout: Bool, proxy: ScrollViewProxy) async {
        failure = nil
        guard let chosen = model.variant else {
            // The choice is where the words say what is missing, so it is
            // brought into view rather than left under the fold.
            failure = "product.chooseOption"
            Haptics.refused()
            withAnimation(still ? nil : .easeInOut(duration: 0.3)) { proxy.scrollTo(QuickViewPlace.choices, anchor: .top) }
            return
        }
        if openCheckout, app.cart.quantity(of: chosen.id) > 0 {
            app.previewing = nil
            app.openCheckout()
            return
        }
        if openCheckout {
            app.previewing = nil
            app.openCheckout()
            if !(await model.add(to: app.cart, product: product)) {
                Haptics.refused()
                app.toast(l.t("cart.buyFailed"))
            }
            return
        }
        Haptics.succeeded()
        announce(l.t("cart.added", ["name": product.title]))
        added = true
        addedReset?.cancel()
        addedReset = Task {
            try? await Task.sleep(for: .seconds(1.6))
            guard !Task.isCancelled else { return }
            added = false
        }
        if !(await model.add(to: app.cart, product: product)) {
            Haptics.refused()
            addedReset?.cancel()
            added = false
            failure = "cart.addFailed"
        }
    }
}

private enum QuickViewPlace {
    static let choices = "quick-view-choices"
}
