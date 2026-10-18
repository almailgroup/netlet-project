import SwiftUI

/// A price, and the was-price beside it when the shop may advertise a saving.
struct PriceView: View {
    let price: Money
    var was: Money?
    var large = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(price.formatted(l.current))
                .font(large ? .title2.weight(.bold) : .headline.weight(.bold))
                .foregroundStyle(Brand.navy)
            if let was, was > price {
                Text(was.formatted(l.current))
                    .font(large ? .subheadline : .caption)
                    .strikethrough()
                    .foregroundStyle(Brand.muted)
                    .accessibilityLabel(l.t("browse.onOffer") + ", " + was.formatted(l.current))
            }
        }
    }
}

/// The navy-on-orange saving badge: white on the brand orange is 3.08:1, navy is 4.65:1.
struct SavingBadge: View {
    let percent: Int
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Text(l.t("product.savePercent", ["percent": "\(percent)"]))
            .font(.caption.weight(.bold))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(Brand.orange))
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
                    .frame(width: 44, height: compact ? 40 : 44)
            }
            .accessibilityLabel(quantity <= 1 ? l.t("cart.remove", ["name": name]) : l.t("cart.decrease", ["name": name]))
            Group {
                if busy { ProgressView().tint(Brand.navy) } else { Text("\(quantity)").font(.headline).monospacedDigit() }
            }
            .frame(minWidth: 30)
            .accessibilityLabel(l.t("cart.quantityShort", ["count": "\(quantity)"]))
            Button {
                change(quantity + 1)
            } label: {
                Image(systemName: "plus")
                    .frame(width: 44, height: compact ? 40 : 44)
            }
            .disabled(quantity >= maximum)
            .accessibilityLabel(l.t("cart.increase", ["name": name]))
        }
        .foregroundStyle(Brand.navy)
        .disabled(busy)
        .background(Capsule().fill(Color.white))
        .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.25), lineWidth: 1))
    }
}

/// A product in a grid: a photograph to its edges at 4:5, a name, a price and
/// Add to cart — or "Choose an option" when there is a size to pick first.
struct ProductCard: View {
    let product: Product
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var busy = false

    var body: some View {
        let variant = product.leadVariant
        VStack(alignment: .leading, spacing: 8) {
            NavigationLink(value: Route.product(handle: product.handle)) {
                VStack(alignment: .leading, spacing: 8) {
                    Color.clear
                        .aspectRatio(4 / 5, contentMode: .fit)
                        .overlay {
                            RemoteImage(reference: product.images.first?.url, label: product.images.first?.altText ?? product.title)
                        }
                        .clipped()
                        .overlay(alignment: .topLeading) {
                            if let percent = variant?.savingPercent, percent > 0 {
                                SavingBadge(percent: percent).padding(8)
                            }
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    Text(product.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Brand.ink)
                        .lineLimit(2, reservesSpace: true)
                        .multilineTextAlignment(.leading)
                    if let variant {
                        PriceView(price: variant.price, was: variant.compareAtPrice)
                    }
                }
            }
            .buttonStyle(.plain)
            action(variant)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
    }

    @ViewBuilder
    private func action(_ variant: ProductVariant?) -> some View {
        if !product.isAvailable {
            Text(l.t("product.soldOut"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Brand.muted)
                .frame(maxWidth: .infinity, minHeight: 44)
        } else if product.needsChoice {
            NavigationLink(value: Route.product(handle: product.handle)) {
                Text(l.t("product.chooseOption")).lineLimit(1).minimumScaleFactor(0.8)
            }
            .buttonStyle(CardButtonStyle())
        } else if let variant, let line = app.cart.cart?.plainLine(for: variant.id) {
            QuantityStepper(quantity: line.quantity, maximum: variant.maxQuantity, name: product.title, busy: busy || app.cart.busyLine == line.lineId, compact: true) { next in
                Task { await app.cart.setQuantity(lineId: line.lineId, to: next) }
            }
            .frame(maxWidth: .infinity)
        } else if let variant {
            Button {
                Task {
                    busy = true
                    let added = await app.cart.add(variantId: variant.id)
                    busy = false
                    if added { announce(l.t("cart.added", ["name": product.title])) }
                }
            } label: {
                if busy {
                    ProgressView().tint(Brand.navy)
                } else {
                    Label(l.t("product.addToCart"), systemImage: "bag.badge.plus").lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            .buttonStyle(CardButtonStyle())
            .disabled(busy)
        }
    }
}

/// The card's own button: the white surface with a light navy rim.
struct CardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Brand.navy)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(Capsule().fill(configuration.isPressed ? Brand.tint : Color.white))
            .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.25), lineWidth: 1))
    }
}

/// A grid of cards, two to a row on a phone and more where there is room.
struct ProductGrid: View {
    let products: [Product]

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160, maximum: 260), spacing: 12)], spacing: 12) {
            ForEach(products) { product in
                ProductCard(product: product)
            }
        }
    }
}

/// Says something to VoiceOver where nothing on screen changes to say it —
/// adding from a card opens no drawer, so the count and this are the receipt.
@MainActor
func announce(_ text: String) {
    UIAccessibility.post(notification: .announcement, argument: text)
}
