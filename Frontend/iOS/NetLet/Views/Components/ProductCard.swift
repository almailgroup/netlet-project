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
            .disabled(quantity >= maximum)
            .accessibilityLabel(l.t("cart.increase", ["name": name]))
        }
        .foregroundStyle(Brand.navy)
        .disabled(busy)
        .background(Capsule().fill(Color.white))
        .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.2), lineWidth: 1))
    }
}

/// A product in a grid or on a shelf — the web's `ProductCard`, line for line.
///
/// A photograph to the card's edges at 4:5, which a finger swipes through (up
/// to five, with dots saying which), the saving and the heart over it; then
/// the store, the name, the rating and the price; then Add to cart over Buy
/// now — both the card's white button, told apart by the bag and the bolt.
/// Once the product is in the bag, Add becomes the bag's own stepper. A
/// product with sizes asks which first, and both buttons open it.
struct ProductCard: View {
    let product: Product
    /// The Deals band's lead: two columns wide, a wider photo, a larger price.
    var feature = false

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
            VStack(alignment: .leading, spacing: 0) {
                if let vendor = product.vendor, !vendor.isEmpty {
                    Text(vendor)
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
                .buttonStyle(.plain)
                .padding(.top, 2)
                if let rating = product.rating {
                    RatingLine(rating: rating).padding(.top, 4)
                }
                if let variant {
                    PriceView(price: variant.price, was: variant.saving == nil ? nil : variant.compareAtPrice, size: feature ? 20 : 16)
                        .padding(.top, 6)
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
                    .overlay(alignment: .bottom) { dots(count: photos.count, at: current ?? 0) }
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
        .buttonStyle(.plain)
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
        .padding(.bottom, 8)
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
            Task {
                await app.saved.toggle(product.id)
                app.toast(l.t(saved ? "saved.removed" : "saved.savedForLater", ["name": product.title]))
            }
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
        .buttonStyle(.plain)
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

/// Add to cart over Buy now — or the bag's stepper over Buy now once the
/// product is in the bag, "Choose an option" when a size comes first, and
/// "Sold out" when nothing can be bought. The web's `CardAction`.
struct CardActions: View {
    let product: Product
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let variant = product.leadVariant
        VStack(spacing: 6) {
            if let variant, variant.availableForSale {
                if product.needsChoice {
                    pill(label: l.t("card.chooseName", ["name": product.title])) {
                        app.push(.product(handle: product.handle))
                    } face: {
                        Text(l.t("product.chooseOption")).lineLimit(1)
                    }
                    buyPill { app.push(.product(handle: product.handle)) }
                } else if let line = app.cart.cart?.plainLine(for: variant.id) {
                    stepper(line: line, variant: variant)
                    buyPill { app.openCheckout() }
                } else {
                    pill(label: l.t("card.addName", ["name": product.title])) {
                        add(variant, thenCheckout: false)
                    } face: {
                        HStack(spacing: 6) {
                            if busy {
                                ProgressView().tint(Brand.navy).controlSize(.small)
                            } else {
                                Image(systemName: "bag").font(.system(size: 14, weight: .medium))
                            }
                            Text(l.t(variant.preorder == nil ? "product.addToCart" : "product.preorder")).lineLimit(1)
                        }
                    }
                    buyPill { add(variant, thenCheckout: true) }
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
        pill(label: l.t("card.buyName", ["name": product.title]), press: press) {
            HStack(spacing: 6) {
                Image(systemName: "bolt.fill").font(.system(size: 13, weight: .medium))
                Text(l.t("product.buyNow")).lineLimit(1)
            }
        }
    }

    /// The card's white button: a white surface, a light navy rim, navy words
    /// in the header's own button lettering (`PURCHASE_TONE`, `.pressable`).
    private func pill<Face: View>(label: String, press: @escaping () -> Void, @ViewBuilder face: () -> Face) -> some View {
        Button(action: press) {
            face()
                .font(.inter(14, .medium))
                .foregroundStyle(Brand.navy)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, minHeight: 44)
                .padding(.horizontal, 4)
                .contentShape(Rectangle())
        }
        .buttonStyle(CardPillStyle())
        .accessibilityLabel(label)
    }

    private func stepper(line: CartItem, variant: ProductVariant) -> some View {
        let count = line.quantity
        let lineBusy = busy || app.cart.busyLine == line.lineId
        return HStack(spacing: 0) {
            Button {
                Task { await app.cart.setQuantity(lineId: line.lineId, to: count - 1) }
            } label: {
                Image(systemName: count <= 1 ? "trash" : "minus")
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 40, height: 44)
            }
            .accessibilityLabel(l.t(count <= 1 ? "cart.remove" : "cart.decrease", ["name": product.title]))
            Group {
                if lineBusy {
                    ProgressView().tint(Brand.navy).controlSize(.small)
                } else {
                    ViewThatFits(in: .horizontal) {
                        Text(l.t("card.inCart", ["count": "\(count)"])).lineLimit(1)
                        Text("\(count)")
                    }
                }
            }
            .font(.inter(14, .medium))
            .monospacedDigit()
            .frame(maxWidth: .infinity)
            .accessibilityLabel(l.t("cart.quantityShort", ["count": "\(count)"]))
            Button {
                Task { await app.cart.setQuantity(lineId: line.lineId, to: count + 1) }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 40, height: 44)
            }
            .disabled(count >= variant.maxQuantity)
            .accessibilityLabel(l.t("cart.increase", ["name": product.title]))
        }
        .foregroundStyle(Brand.navy)
        .disabled(lineBusy)
        .background(Capsule().fill(Color.white))
        .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.2), lineWidth: 1))
    }

    private func add(_ variant: ProductVariant, thenCheckout: Bool) {
        Task {
            busy = true
            let added = await app.cart.add(variantId: variant.id)
            busy = false
            if added {
                announce(l.t("cart.added", ["name": product.title]))
                if thenCheckout { app.openCheckout() }
            } else {
                app.toast(l.t("cart.addFailed"))
            }
        }
    }
}

/// The card's white button, shaded while a finger is down.
struct CardPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(Capsule().fill(configuration.isPressed ? Brand.pressFill : Color.white))
            .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.2), lineWidth: 1))
    }
}

/// A grid of cards, two to a row on a phone, 12 apart.
struct ProductGrid: View {
    let products: [Product]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(products) { product in
                ProductCard(product: product)
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
