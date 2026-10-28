import Foundation

/// One press on the bag, as it is drawn before the server has answered.
enum BagOp: Hashable, Sendable {
    /// Add to the variant's line; `ghost` is the line drawn when there is none yet.
    case add(variantId: String, quantity: Int, ghost: CartItem?)
    case set(lineId: String, quantity: Int)
    case remove(lineId: String)
}

/// What the bag looks like the moment a button is pressed — the web's
/// `lib/bagOps.ts`, rule for rule.
///
/// Every press on the photo's plus, the stepper, the bin and Buy now waited
/// for the round trip before anything moved — a spinner on the plus, the
/// count still the old number, the tab's badge late — so on a phone each tap
/// took a third of a second or more to be believed. The bag now changes at
/// once by these rules, the server's answer replaces the guess when it lands,
/// and a refusal puts the bag back as the server has it (`CartModel`).
///
/// Only what the press itself decides is guessed: the quantity, the line, and
/// the line total and subtotal that follow from the bag's own prices. A
/// delivery fee depends on each seller's threshold and is the server's to
/// answer, so the total carries the old delivery until it does, and the page
/// draws the money as updating while it is (`CartModel.syncing`).
enum BagOps {
    /// A line the press drew before the server made it. Its id says which
    /// variant it is for, so a plus pressed on it before the answer is sent to
    /// the real line once there is one.
    static let ghostPrefix = "pending:"

    static func ghostLineId(_ variantId: String) -> String { ghostPrefix + variantId }

    static func ghostVariant(_ lineId: String) -> String? {
        lineId.hasPrefix(ghostPrefix) ? String(lineId.dropFirst(ghostPrefix.count)) : nil
    }

    /// The bag before there is one, so the first item has somewhere to be drawn.
    static let noBag = Cart(
        id: "",
        items: [],
        itemCount: 0,
        subtotal: .zero,
        delivery: CartDelivery(perVendor: [], total: .zero),
        cod: CashOnDelivery(available: true, because: nil),
        total: .zero
    )

    /// The line a card's plus makes, drawn from the card's own product: the
    /// plain line, at the shelf price. Nil for a variant the product does not have.
    static func ghostLine(_ product: Product, variantId: String, quantity: Int) -> CartItem? {
        guard let variant = product.variants.first(where: { $0.id == variantId }) else { return nil }
        let item = CartItem(
            lineId: ghostLineId(variantId),
            variantId: variantId,
            productHandle: product.handle,
            // Already in the page's language: the catalogue was read in it.
            productTitle: product.title,
            productTitleAr: nil,
            variantTitle: variant.title,
            image: product.images.first,
            unitPrice: variant.price,
            quantity: quantity,
            measure: variant.measure,
            lineTotal: variant.price,
            bundleName: nil,
            addons: [],
            // The card knows its store by address only; the server's answer adds the id.
            vendor: product.vendorSlug.map { CartStore(id: nil, name: product.vendor ?? "", nameAr: nil, slug: $0) }
        )
        return withQuantity(item, quantity)
    }

    /// A line at another quantity, its total at what one of it cost in the
    /// server's last answer — its price with any extras, which the app's
    /// model of an extra does not carry — or at its unit price when that does
    /// not divide evenly.
    static func withQuantity(_ item: CartItem, _ quantity: Int) -> CartItem {
        var next = item
        let each = item.quantity > 0 && item.lineTotal.fils % item.quantity == 0
            ? item.lineTotal.fils / item.quantity
            : item.unitPrice.fils
        next.quantity = quantity
        next.lineTotal = Money(fils: each * quantity, currencyCode: item.lineTotal.currencyCode)
        return next
    }

    private static func counted(_ items: [CartItem]) -> Int { items.reduce(0) { $0 + $1.quantity } }

    /// The bag with new lines, its count and subtotal following. A count the
    /// lines do not explain — an add whose line cannot be drawn yet — is
    /// carried over, so the badge does not drop back while it waits.
    static func withItems(_ cart: Cart, _ items: [CartItem]) -> Cart {
        var next = cart
        let unexplained = max(0, cart.itemCount - counted(cart.items))
        let subtotal = items.reduce(0) { $0 + $1.lineTotal.fils }
        next.items = items
        next.itemCount = counted(items) + unexplained
        next.subtotal = Money(fils: subtotal, currencyCode: cart.subtotal.currencyCode)
        next.total = Money(fils: subtotal + cart.delivery.total.fils, currencyCode: cart.total.currencyCode)
        return next
    }

    /// One press applied to the bag. The server keeps one line per variant,
    /// so an add onto one adds to it, up to the line's ceiling.
    static func apply(_ cart: Cart?, _ op: BagOp) -> Cart? {
        switch op {
        case let .add(variantId, quantity, ghost):
            let bag = cart ?? noBag
            if let index = bag.items.firstIndex(where: { $0.variantId == variantId }) {
                var items = bag.items
                items[index] = withQuantity(items[index], min(ReferenceData.shared.rules.maxLineQuantity, items[index].quantity + quantity))
                return withItems(bag, items)
            }
            if let ghost { return withItems(bag, bag.items + [ghost]) }
            var more = bag
            more.itemCount += quantity
            return more
        case let .set(lineId, quantity):
            guard let cart else { return nil }
            // A press on a drawn-ahead line follows it to the real one once that exists.
            let target = realLineId(cart, lineId)
            return withItems(cart, cart.items.map { $0.lineId == target ? withQuantity($0, quantity) : $0 })
        case let .remove(lineId):
            guard let cart else { return nil }
            let target = realLineId(cart, lineId)
            return withItems(cart, cart.items.filter { $0.lineId != target })
        }
    }

    /// The line a press names, once the server has made it: a drawn-ahead
    /// line becomes the variant's real one, and nil while there is none.
    static func realLineId(_ cart: Cart?, _ lineId: String) -> String? {
        guard let variantId = ghostVariant(lineId) else { return lineId }
        return cart?.items.first(where: { $0.variantId == variantId })?.lineId
    }
}
