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
///
/// **Holding the card opens a preview of the product**, on the owner's word
/// (`QuickViewSheet`, the app's alone): the photographs, the price, the choice
/// and the buttons, with the whole page a press away. The card is drawn afresh
/// the moment the hold is felt, so the finger lifting off it presses nothing —
/// the photo under it is a link, and the lift opened the product behind the
/// preview, the web's own long-press lesson.
///
/// **The hold is the photo's and the words', never the card's own buttons.**
/// It was the whole card's, so a press on the photo's plus that lasted 0.4s
/// added the product, opened the preview over it and drew the card afresh,
/// stepper and all: the product went into a sheet the moment it went into the
/// bag. The plus, the stepper, the heart and Buy now do only what they say;
/// the web's own hold is on the photo alone.
struct ProductCard: View {
    let product: Product
    /// The Deals band's lead: two columns wide, a wider photo, a larger price.
    var feature = false
    /// A line in the store's place — "Sponsored · store", or why it was
    /// recommended — as the web's card takes a `note`.
    var note: String? = nil

    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    /// Moves on with each hold, so the card under the finger is a new one.
    @State private var held = 0

    /// The card's identity: its product, and how many holds it has had.
    /// **It names the product, and that is what drew only one card.** It was
    /// the hold count alone — 0 on every card — and an explicit id on what a
    /// lazy grid or row draws stands in for the `ForEach`'s own, so every card
    /// on a shelf had the same identity and the grid drew one of them: a
    /// department of 27 products showed one card under "27 products".
    private var identity: String { "\(product.id)#\(held)" }

    var body: some View {
        let variant = product.leadVariant
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .top) {
                CardGallery(product: product, feature: feature)
                    .simultaneousGesture(hold)
                HStack(alignment: .top) {
                    badges(variant)
                    Spacer(minLength: 0)
                    HeartButton(product: product)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                PhotoCartControl(product: product).padding(8)
            }
            // The photo is its 4:5 at the card's width, whatever the row is.
            // Left flexible, a row taller than the card shared its height
            // between the photo and the spacer above Buy now: the photo shrank
            // to a narrower 4:5 in the middle and a gap opened under the price.
            .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 0) {
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
                    .accessibilityAction(named: Text(l.t("quick.open", ["name": product.title]))) { preview() }
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
                }
                .contentShape(Rectangle())
                .simultaneousGesture(hold)
                Spacer(minLength: 0)
                CardActions(product: product)
                    .padding(.top, 10)
            }
            .padding(.horizontal, 10)
            .padding(.top, 8)
            .padding(.bottom, 10)
        }
        .id(identity)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    /// A hold previews the product without leaving the shelf (3.1.11), on the
    /// photo and the words. A finger that moves is scrolling, and the hold
    /// gives way to it.
    private var hold: some Gesture {
        LongPressGesture(minimumDuration: 0.4).onEnded { _ in preview() }
    }

    private func preview() {
        Haptics.action()
        held += 1
        app.previewing = product
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

/// The card's photographs: up to five, swiped like the phone's own pictures,
/// with a row of dots saying how many and which. Arabic runs it the other way
/// round with no code of its own. A press opens the product.
struct CardGallery: View {
    let product: Product
    var feature = false
    @State private var current: Int?
    @Environment(AppModel.self) private var app
    @Environment(\.displayScale) private var scale

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
            // The second photo, fetched once the card is on screen, so the first
            // swipe finds it there — the web's card draws its next photo the same way.
            .task(id: product.id) {
                guard photos.count > 1, let next = app.services.configuration.resolve(photos[1].url) else { return }
                await ImagePipeline.shared.prefetch([next], pixels: ImagePipeline.cardPixels(scale: scale))
            }
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
        let saved = app.saved.isHearted(product.id)
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
    }

    private func buyPill(_ press: @escaping () -> Void) -> some View {
        Button(action: press) {
            HStack(spacing: 6) {
                Image(systemName: "bolt.fill").font(.system(size: 13, weight: .medium))
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

    /// Checkout opens at once on the bag drawn ahead, the web's rule; it
    /// waits for the bag to settle before an order can be placed.
    private func buy(_ variant: ProductVariant) {
        app.openCheckout()
        Task {
            if !(await app.cart.add(variantId: variant.id, product: product)) {
                Haptics.refused()
                app.toast(l.t("cart.buyFailed"))
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
            Image(systemName: "plus").font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.action)
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
            Text("\(count)").font(.inter(16, .bold)).monospacedDigit().foregroundStyle(Color.white)
                .contentTransition(.numericText(value: Double(count)))
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
        .transition(.opacity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("card.inCart", ["count": "\(count)"]))
    }

    /// The line is drawn in the bag the moment the plus is pressed and the
    /// stepper opens on it; a refusal folds it away again and says so.
    private func add(_ variant: ProductVariant) {
        open = true
        settleLater()
        announce(l.t("cart.added", ["name": product.title]))
        Task {
            if !(await app.cart.add(variantId: variant.id, product: product)) {
                open = false
                Haptics.refused()
                app.toast(l.t("cart.addFailed"))
            }
        }
    }

    private func change(_ line: CartItem, to quantity: Int) {
        if quantity < 1 { open = false }
        settleLater()
        announce(quantity < 1
            ? l.t("cart.removedName", ["name": product.title])
            : l.t("cart.quantityShort", ["count": "\(quantity)"]))
        Task { await app.cart.setQuantity(lineId: line.lineId, to: quantity) }
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
