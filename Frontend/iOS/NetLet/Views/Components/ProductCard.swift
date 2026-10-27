import SwiftUI

/// A price, and the was-price beside it when the shop may advertise a saving.
struct PriceView: View {
    let price: Money
    var was: Money?
    var size: CGFloat = 16
    /// The product page's price, 24 on a phone.
    var large = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let size = large ? 24 : self.size
        // Never broken inside an amount: the was-price goes to the next line
        // when both do not fit, the web's `flex-wrap`.
        return FlowLayout(spacing: 6) {
            Text(price.formatted(l.current))
                .font(.inter(size, .bold))
                .foregroundStyle(Brand.navy)
                .fixedSize()
            if let was, was > price {
                Text(was.formatted(l.current))
                    .font(.inter(size >= 20 ? 14 : 12))
                    .strikethrough()
                    .foregroundStyle(Brand.muted)
                    .fixedSize()
                    .frame(minHeight: size * 1.2)
                    .accessibilityLabel(l.t("browse.onOffer") + ", " + was.formatted(l.current))
            }
        }
    }
}

/// The saving, navy on the orange: white on `#f2683a` is 3.08:1, navy is 4.65:1.
struct SavingBadge: View {
    let percent: Int
    var large = false

    var body: some View {
        Text("−\(percent)%")
            .font(.inter(large ? 15 : 13, .bold))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, large ? 10 : 7)
            .padding(.vertical, large ? 5 : 3)
            .background(Capsule().fill(Brand.orange))
            .environment(\.layoutDirection, .leftToRight)
    }
}

/// Minus, the count and plus — a bin at one, the way the delivery apps work.
struct QuantityStepper: View {
    let quantity: Int
    let maximum: Int
    var name = ""
    var busy = false
    var compact = false
    let change: (Int) -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 0) {
            Button {
                change(quantity - 1)
            } label: {
                Image(systemName: quantity <= 1 ? "trash" : "minus")
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.action)
            .accessibilityLabel(quantity <= 1 ? l.t("cart.remove", ["name": name]) : l.t("cart.decrease", ["name": name]))
            Group {
                if busy { ProgressView().tint(Brand.navy) } else { Text("\(quantity)").font(.inter(16, .bold)).monospacedDigit() }
            }
            .frame(minWidth: 30)
            .accessibilityLabel(l.t("cart.quantityShort", ["count": "\(quantity)"]))
            Button {
                change(quantity + 1)
            } label: {
                Image(systemName: "plus")
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.action)
            .disabled(quantity >= maximum)
            .accessibilityLabel(l.t("cart.increase", ["name": name]))
        }
        .foregroundStyle(Brand.navy)
        .disabled(busy)
        .background(Capsule().fill(Color.white))
        .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.2), lineWidth: 1))
    }
}

/// A product in a grid or on a shelf — the web's `ProductCard` on a phone.
///
/// A photograph to the card's edges at 4:5, which a finger swipes through (up
/// to five, with dots saying which), the saving and the heart over it, and
/// **the bag in its end corner** (`PhotoCartControl`, on the owner's word):
/// a plus that adds one and opens a stepper, which folds into the count once
/// the presses stop. Then the store, the name, the rating and the price, and
/// Buy now under them. A product with sizes asks which first, and both the
/// plus and Buy now open it.
struct ProductCard: View {
    let product: Product
    /// The Deals band's lead: two columns wide, a wider photo, a larger price.
    var feature = false
    /// A line in the store's place — "Sponsored · store", or why it was
    /// recommended — as the web's card takes a `note`.
    var note: String? = nil

    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let variant = product.leadVariant
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .top) {
                CardGallery(product: product, feature: feature)
                HStack(alignment: .top) {
                    badges(variant)
                    Spacer(minLength: 0)
                    HeartButton(product: product)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                PhotoCartControl(product: product).padding(8)
            }
            VStack(alignment: .leading, spacing: 0) {
                if let line = note ?? product.vendor, !line.isEmpty {
                    Text(line)
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                        .lineLimit(1)
                }
                NavigationLink(value: Route.product(handle: product.handle)) {
                    Text(product.title)
                        .font(.inter(feature ? 17 : 14, .semibold))
                        .foregroundStyle(Brand.navy)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2, reservesSpace: !feature)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.tap)
                .padding(.top, 2)
                if let rating = product.rating {
                    RatingLine(rating: rating).padding(.top, 4)
                }
                if let variant {
                    PriceView(price: variant.price, was: variant.saving == nil ? nil : variant.compareAtPrice, size: feature ? 20 : 16)
                        .padding(.top, 6)
                    // The price per kilo or litre of something sold by weight (`UnitPrice`).
                    if let measure = variant.measure,
                       let per = ListingRules.shared.unitPrice(variant.price, unit: measure.unit, step: measure.stepAmount) {
                        Text(l.t("unit.perUnit", ["price": per.price.formatted(l.current), "unit": l.t("unit.\(per.unit)")]))
                            .font(.inter(12))
                            .foregroundStyle(Brand.muted)
                            .padding(.top, 2)
                    }
                }
                Spacer(minLength: 0)
                CardActions(product: product)
                    .padding(.top, 10)
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .padding(.bottom, 10)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 16, style: .continuous))
        // A long press previews the product without leaving the shelf (3.1.11)
        // — the web's long-press Quick View, in the phone's own shape: the
        // photo, the name and the price lifted over the page, with what the
        // card's buttons do beneath it.
        .contextMenu {
            CardMenu(product: product)
        } preview: {
            CardPreview(product: product)
                .environment(app)
                .environment(l)
        }
    }

    @ViewBuilder
    private func badges(_ variant: ProductVariant?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let percent = variant?.savingPercent, percent > 0 {
                SavingBadge(percent: percent, large: feature)
            }
            if variant?.preorder != nil {
                tag(l.t("product.preorder"), fill: Brand.navy)
            }
            if product.isExpress {
                HStack(spacing: 4) {
                    Image(systemName: "bolt.fill").font(.system(size: 9))
                    Text(l.t("product.express"))
                }
                .font(.inter(11, .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(Brand.navy))
            }
            if !product.isAvailable {
                tag(l.t("product.soldOut"), fill: Brand.body)
            }
        }
        .padding(8)
        .allowsHitTesting(false)
    }

    private func tag(_ text: String, fill: Color) -> some View {
        Text(text)
            .font(.inter(11, .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(fill))
    }
}

/// What a long press offers beneath the preview: the product's page, what
/// the card's own buttons do, and saving and sharing it.
private struct CardMenu: View {
    let product: Product
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let variant = product.leadVariant
        Button {
            app.push(.product(handle: product.handle))
        } label: {
            Label(l.t("quick.fullDetails"), systemImage: "doc.text.magnifyingglass")
        }
        if let variant, variant.availableForSale {
            if product.needsChoice {
                Button {
                    app.push(.product(handle: product.handle))
                } label: {
                    Label(l.t("product.chooseOption"), systemImage: "slider.horizontal.3")
                }
            } else {
                if app.cart.cart?.plainLine(for: variant.id) == nil {
                    Button {
                        Task { await add(variant, thenCheckout: false) }
                    } label: {
                        Label(l.t(variant.preorder == nil ? "product.addToCart" : "product.preorder"), systemImage: "bag")
                    }
                }
                Button {
                    Task {
                        if app.cart.cart?.plainLine(for: variant.id) != nil { app.openCheckout() } else { await add(variant, thenCheckout: true) }
                    }
                } label: {
                    Label(l.t("product.buyNow"), systemImage: "bolt.fill")
                }
            }
        }
        let saved = app.saved.contains(product.id)
        Button {
            Task { await app.heart(product) }
        } label: {
            Label(l.t(saved ? "product.removeSaved" : "product.save", ["name": product.title]), systemImage: saved ? "heart.slash" : "heart")
        }
        ShareLink(item: app.services.configuration.url(path: ReferralCode.productPath(handle: product.handle, userId: app.session.user?.id))) {
            Label(l.t("product.share", ["name": product.title]), systemImage: "square.and.arrow.up")
        }
    }

    private func add(_ variant: ProductVariant, thenCheckout: Bool) async {
        if await app.cart.add(variantId: variant.id) {
            Haptics.succeeded()
            announce(l.t("cart.added", ["name": product.title]))
            if thenCheckout { app.openCheckout() }
        } else {
            Haptics.refused()
            app.toast(l.t("cart.addFailed"))
        }
    }
}

/// The product lifted over the page by a long press: the first photo large,
/// then the store, the name, the rating and the price.
private struct CardPreview: View {
    let product: Product
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let variant = product.leadVariant
        VStack(alignment: .leading, spacing: 0) {
            Brand.photo
                .aspectRatio(4.0 / 5.0, contentMode: .fit)
                .overlay {
                    RemoteImage(reference: product.images.first?.url, contentMode: .fill, label: product.images.first?.altText ?? product.title)
                }
                .clipped()
            VStack(alignment: .leading, spacing: 4) {
                if let vendor = product.vendor, !vendor.isEmpty {
                    Text(vendor).font(.inter(13)).foregroundStyle(Brand.muted).lineLimit(1)
                }
                Text(product.title)
                    .font(.inter(17, .semibold))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                if let rating = product.rating { RatingLine(rating: rating) }
                if let variant {
                    PriceView(price: variant.price, was: variant.saving == nil ? nil : variant.compareAtPrice, size: 20)
                        .padding(.top, 2)
                }
                if !product.isAvailable {
                    Text(l.t("product.soldOut")).font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
                }
            }
            .padding(14)
        }
        .frame(width: 300)
        .background(Color.white)
        .environment(\.layoutDirection, l.layoutDirection)
    }
}

/// The card's photographs: up to five, swiped like the phone's own pictures,
/// with a row of dots saying how many and which. Arabic runs it the other way
/// round with no code of its own. A press opens the product.
struct CardGallery: View {
    let product: Product
    var feature = false
    @State private var current: Int?
    @Environment(AppModel.self) private var app

    static let most = 5

    var body: some View {
        let photos = Array(product.images.prefix(Self.most))
        let ratio: CGFloat = feature ? 33.0 / 20.0 : 4.0 / 5.0
        // The card's width decides the frame and the photos fill it — never
        // the other way round: a scroller sized by its content made every
        // card in a grid as wide as its photos and pushed the grid off screen.
        Color.clear
            .aspectRatio(ratio, contentMode: .fit)
            .overlay {
                if photos.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 0) {
                            ForEach(Array(photos.enumerated()), id: \.offset) { index, photo in
                                frame(photo)
                                    .containerRelativeFrame([.horizontal, .vertical])
                                    .id(index)
                            }
                        }
                        .scrollTargetLayout()
                    }
                    .scrollTargetBehavior(.paging)
                    .scrollPosition(id: $current)
                    // At the photo's start, level with the bag's plus in its
                    // end corner — in the middle, a narrow card's plus sat over them.
                    .overlay(alignment: .bottomLeading) { dots(count: photos.count, at: current ?? 0) }
                } else {
                    frame(photos.first)
                }
            }
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 15, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: 15, style: .continuous))
    }

    private func frame(_ photo: ProductImage?) -> some View {
        Button {
            app.push(.product(handle: product.handle))
        } label: {
            (feature ? Color.white : Brand.photo)
                .overlay {
                    if let photo {
                        RemoteImage(reference: photo.url, contentMode: feature ? .fit : .fill, label: photo.altText ?? product.title)
                    }
                }
                .clipped()
                .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .accessibilityHidden(true)
    }

    private func dots(count: Int, at index: Int) -> some View {
        HStack(spacing: 4) {
            ForEach(0..<count, id: \.self) { dot in
                Capsule()
                    .fill(Brand.navy.opacity(dot == index ? 1 : 0.3))
                    .frame(width: dot == index ? 12 : 6, height: 6)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(Capsule().fill(Color.white.opacity(0.85)))
        .padding(.leading, 8)
        .padding(.bottom, 23)
        .animation(.easeOut(duration: 0.2), value: index)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The heart on a card's photo: a white disc, red and filled once saved.
struct HeartButton: View {
    let product: Product
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let saved = app.saved.contains(product.id)
        Button {
            Task { await app.heart(product) }
        } label: {
            Image(systemName: saved ? "heart.fill" : "heart")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(saved ? Color(red: 230 / 255, green: 28 / 255, blue: 56 / 255) : Brand.navy)
                .frame(width: 32, height: 32)
                .background(Circle().fill(Color.white))
                .overlay(Circle().strokeBorder(Brand.cardLine, lineWidth: 1))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.action)
        .accessibilityLabel(l.t(saved ? "product.removeSaved" : "product.save", ["name": product.title]))
        .accessibilityAddTraits(saved ? .isSelected : [])
    }
}

/// A star, the score and how many said so.
struct RatingLine: View {
    let rating: Product.Rating
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "star.fill")
                .font(.system(size: 11))
                .foregroundStyle(Brand.star)
            Text(rating.value.formatted(.number.precision(.fractionLength(0...1))))
                .font(.inter(12, .semibold))
                .foregroundStyle(Brand.ink)
            if let count = rating.count {
                Text("(\(count))")
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
            }
        }
        .environment(\.locale, l.current.locale)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            rating.count.map { l.t("product.ratingAriaCount", ["value": "\(rating.value)", "max": "\(rating.scaleMax)", "count": "\($0)"]) }
                ?? l.t("product.ratingAria", ["value": "\(rating.value)", "max": "\(rating.scaleMax)"])
        )
    }
}

/// Buy now under the price — the bag itself is on the photo
/// (`PhotoCartControl`). "Choose an option" when a size comes first opens the
/// product, and "Sold out" says so when nothing can be bought. The web's
/// `CardAction` on a touch screen.
struct CardActions: View {
    let product: Product
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let variant = product.leadVariant
        Group {
            if let variant, variant.availableForSale {
                if product.needsChoice {
                    buyPill { app.push(.product(handle: product.handle)) }
                } else if app.cart.cart?.plainLine(for: variant.id) != nil {
                    // Already in the bag: checkout is the whole of what is left.
                    buyPill { app.openCheckout() }
                } else {
                    buyPill { buy(variant) }
                }
            } else {
                Text(l.t("product.soldOut"))
                    .font(.inter(14, .medium))
                    .foregroundStyle(Brand.muted)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Capsule().fill(Brand.photo))
                    .overlay(Capsule().strokeBorder(Brand.cardLine, lineWidth: 1))
                    .accessibilityLabel(l.t("product.unavailableName", ["name": product.title]))
            }
        }
        .disabled(busy)
    }

    private func buyPill(_ press: @escaping () -> Void) -> some View {
        Button(action: press) {
            HStack(spacing: 6) {
                if busy {
                    ProgressView().tint(Brand.navy).controlSize(.small)
                } else {
                    Image(systemName: "bolt.fill").font(.system(size: 13, weight: .medium))
                }
                Text(l.t("product.buyNow")).lineLimit(1)
            }
            .font(.inter(14, .medium))
            .foregroundStyle(Brand.navy)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(CardPillStyle())
        .accessibilityLabel(l.t("card.buyName", ["name": product.title]))
    }

    private func buy(_ variant: ProductVariant) {
        Task {
            busy = true
            let added = await app.cart.add(variantId: variant.id)
            busy = false
            if added {
                app.openCheckout()
            } else {
                Haptics.refused()
                app.toast(l.t("cart.addFailed"))
            }
        }
    }
}

/// The bag on a card's photo, in its end corner — how the app adds to the
/// cart, on the owner's word; the web's `PhotoCartControl` on a phone.
///
/// Three faces, one at a time, grown and folded in place:
///
/// - **A plus**, white, while the product is not in the bag. A press puts one
///   in and opens the stepper.
/// - **The stepper** — the bin at one or a minus, the count, a plus — in navy
///   across the foot of the photo. Every press changes the bag's line and
///   starts the wait again.
/// - **The count**, a navy square with the cart and how many, once the
///   stepper has been left alone for `settleSeconds`. A press opens it again.
///
/// It reads the bag's plain line for the variant (`plainLine`), the one Buy
/// now follows. A product with sizes or colours opens its page instead, and a
/// sold-out one draws nothing here — its badge on the photo says so.
///
/// **Every press is felt** (`.action`), a refusal as two taps, and VoiceOver
/// is told what each did. Under VoiceOver the
/// stepper does not fold by itself, which would pull it from under somebody
/// moving between its buttons.
struct PhotoCartControl: View {
    let product: Product
    @State private var open = false
    @State private var adding = false
    @State private var settle: Task<Void, Never>?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver

    /// How long the stepper stays open after the last press — the web's `SETTLE_MS`.
    static let settleSeconds: Double = 2.5

    var body: some View {
        if let variant = product.leadVariant, variant.availableForSale {
            let line = product.needsChoice ? nil : app.cart.cart?.plainLine(for: variant.id)
            let stepping = open && line != nil
            Group {
                if product.needsChoice {
                    plus(label: l.t("card.chooseName", ["name": product.title])) {
                        app.push(.product(handle: product.handle))
                    }
                } else if let line, stepping {
                    stepper(line: line, variant: variant)
                } else if let line {
                    countFace(line.quantity)
                } else {
                    plus(label: l.t(variant.preorder == nil ? "card.addName" : "card.preorderName", ["name": product.title])) {
                        add(variant)
                    }
                }
            }
            .frame(maxWidth: stepping ? 152 : 44, minHeight: 44, maxHeight: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(line == nil ? Color.white : Brand.navy))
            .overlay {
                if line == nil {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: Brand.navy.opacity(line == nil ? 0.14 : 0.26), radius: 5, y: 2)
            .animation(reduceMotion ? nil : .snappy(duration: 0.22), value: stepping)
            .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: line == nil)
            .onDisappear {
                settle?.cancel()
                open = false
            }
        }
    }

    private func plus(label: String, press: @escaping () -> Void) -> some View {
        Button(action: press) {
            Group {
                if adding {
                    ProgressView().tint(Brand.navy).controlSize(.small)
                } else {
                    Image(systemName: "plus").font(.system(size: 18, weight: .semibold))
                }
            }
            .foregroundStyle(Brand.navy)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.action)
        .disabled(adding)
        .accessibilityLabel(label)
    }

    /// The cart with how many in its basket, as the web draws it.
    private func countFace(_ count: Int) -> some View {
        Button {
            open = true
            settleLater()
        } label: {
            ZStack {
                Image(systemName: "cart").font(.system(size: 22, weight: .regular))
                Text("\(count)")
                    .font(.inter(count > 9 ? 9 : 11, .bold))
                    .monospacedDigit()
                    .offset(x: 1.5, y: -3)
            }
            .foregroundStyle(Color.white)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.action)
        .transition(.opacity)
        .accessibilityLabel(l.t("card.changeQuantity", ["count": "\(count)", "name": product.title]))
    }

    private func stepper(line: CartItem, variant: ProductVariant) -> some View {
        let count = line.quantity
        let busy = app.cart.busyLine == line.lineId
        return HStack(spacing: 0) {
            Button {
                change(line, to: count - 1)
            } label: {
                Image(systemName: count <= 1 ? "trash" : "minus")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.action)
            .accessibilityLabel(l.t(count <= 1 ? "cart.remove" : "cart.decrease", ["name": product.title]))
            Group {
                if busy {
                    ProgressView().tint(.white).controlSize(.small)
                } else {
                    Text("\(count)").font(.inter(16, .bold)).monospacedDigit().foregroundStyle(Color.white)
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityLabel(l.t("cart.quantityShort", ["count": "\(count)"]))
            Button {
                change(line, to: count + 1)
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.action)
            .disabled(count >= variant.maxQuantity)
            .accessibilityLabel(l.t("cart.increase", ["name": product.title]))
        }
        .disabled(busy)
        .transition(.opacity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("card.inCart", ["count": "\(count)"]))
    }

    private func add(_ variant: ProductVariant) {
        adding = true
        Task {
            let added = await app.cart.add(variantId: variant.id)
            adding = false
            if added {
                open = true
                settleLater()
                announce(l.t("cart.added", ["name": product.title]))
            } else {
                Haptics.refused()
                app.toast(l.t("cart.addFailed"))
            }
        }
    }

    private func change(_ line: CartItem, to quantity: Int) {
        if quantity < 1 { open = false }
        settleLater()
        Task {
            await app.cart.setQuantity(lineId: line.lineId, to: quantity)
            announce(quantity < 1
                ? l.t("cart.removedName", ["name": product.title])
                : l.t("cart.quantityShort", ["count": "\(quantity)"]))
        }
    }

    /// Folds the stepper into the count once the presses stop; each press
    /// starts the wait again. Not under VoiceOver.
    private func settleLater() {
        settle?.cancel()
        guard !voiceOver else { return }
        settle = Task { @MainActor in
            try? await Task.sleep(for: .seconds(Self.settleSeconds))
            guard !Task.isCancelled else { return }
            open = false
        }
    }
}

/// The card's white button, shaded while a finger is down.
struct CardPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Capsule().fill(configuration.isPressed ? Brand.pressFill : Color.white))
            .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.2), lineWidth: 1))
            .pressHaptic(configuration.isPressed, strength: Haptics.actionStrength)
    }
}

/// A grid of cards, two to a row on a phone, 12 apart.
struct ProductGrid: View {
    let products: [Product]
    /// A card's line in the store's place, where a shelf has one to say.
    var note: ((Product) -> String?)? = nil

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(products) { product in
                ProductCard(product: product, note: note?(product))
            }
        }
    }
}

extension Product {
    /// The review score, from the `reviews` namespace — `productRating`: a
    /// number or `{ value, scale_max }`, and how many reviews when known.
    struct Rating: Hashable, Sendable {
        let value: Double
        let scaleMax: Double
        let count: Int?
    }

    var rating: Rating? {
        guard let raw = attributes.first(where: { $0.namespace == "reviews" && $0.key == "rating" })?.value else { return nil }
        var value: Double?
        var scaleMax = 5.0
        if let data = raw.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            value = (object["value"] as? NSNumber)?.doubleValue ?? Double("\(object["value"] ?? "")")
            if let scale = (object["scale_max"] as? NSNumber)?.doubleValue ?? Double("\(object["scale_max"] ?? "")"), scale > 0 { scaleMax = scale }
        }
        if value == nil { value = Double(raw.trimmingCharacters(in: .whitespaces)) }
        guard let value, value >= 0 else { return nil }
        let count = attributes.first(where: { $0.namespace == "reviews" && $0.key == "rating_count" }).flatMap { Int($0.value) }
        return Rating(value: value, scaleMax: scaleMax, count: count.flatMap { $0 >= 0 ? $0 : nil })
    }

    /// Flagged for NetLet Express by a tag the seller typed (`isExpressEligible`).
    var isExpress: Bool {
        tags.contains { tag in
            var word = tag.trimmingCharacters(in: .whitespaces).lowercased()
            if word.hasPrefix("netlet ") { word = String(word.dropFirst("netlet ".count)).trimmingCharacters(in: .whitespaces) }
            return word == "express"
        }
    }
}

/// Says something to VoiceOver where nothing on screen changes to say it —
/// adding from a card opens no drawer, so the count and this are the receipt.
@MainActor
func announce(_ text: String) {
    UIAccessibility.post(notification: .announcement, argument: text)
}
