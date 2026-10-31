import Foundation

/// The till, in order: the goods and delivery, then a discount code, then
/// points, then a gift card, each capped at what is still owed — the web's
/// `settle`, `pointsSpendableOn`, `spendValue` and `giftCardPayment`, so the
/// summary here and the order the server writes cannot disagree.
enum Till {
    struct Bill: Equatable, Sendable {
        let discount: Money
        let points: Money
        let giftCard: Money
        let payable: Money

        /// Anything taken off at all, so a summary knows to draw the rows.
        var reduced: Bool { !discount.isZero || !points.isZero || !giftCard.isZero }
    }

    private static var filsPerPoint: Int { ReferenceData.shared.rules.orderRules.filsPerPoint }

    /// What these points are worth spent inside NetLet.
    static func spendValue(_ points: Int) -> Money {
        Money(fils: max(0, points) * filsPerPoint)
    }

    /// The most of an order a balance may pay for: points are a discount,
    /// not a deposit, so never more than the total.
    static func pointsSpendable(_ points: Int, on total: Money) -> Int {
        min(max(0, points), max(0, total.fils) / max(1, filsPerPoint))
    }

    /// The lesser of what is left on the card and what is still owed.
    static func giftCardPayment(remaining: Money, owed: Money) -> Money {
        remaining.fils < owed.fils ? remaining : owed
    }

    static func settle(goods: Money, delivery: Money, discount: Money = .zero, points: Money = .zero, giftCard: Money = .zero) -> Bill {
        let total = goods + delivery
        let discount = capped(discount, total)
        let afterDiscount = total - discount
        let points = capped(points, afterDiscount)
        let afterPoints = afterDiscount - points
        let giftCard = capped(giftCard, afterPoints)
        return Bill(discount: discount, points: points, giftCard: giftCard, payable: afterPoints - giftCard)
    }

    /// The whole bill from a bag, a quoted code and the points chosen — one
    /// box holding either kind, as checkout once took it.
    static func bill(for cart: Cart, quote: API.VoucherQuote?, balance: Int, usePoints: Bool) -> Bill {
        bill(for: cart, discount: quote, gift: quote, balance: balance, usePoints: usePoints)
    }

    /// The whole bill from a bag, a discount code's quote, a gift card's and
    /// the points chosen — the web's `useSavingsBill`. A quote of the other
    /// kind, or a refused one, takes nothing off.
    static func bill(for cart: Cart, discount: API.VoucherQuote?, gift: API.VoucherQuote?, balance: Int, usePoints: Bool) -> Bill {
        let discountOff = discount?.ok == true && discount?.kind == "discount" ? discount?.amount ?? .zero : .zero
        let afterDiscount = cart.total - discountOff
        let pointsOff = usePoints ? spendValue(pointsSpendable(balance, on: afterDiscount)) : .zero
        let card = gift?.ok == true && gift?.kind == "gift" ? gift : nil
        let giftOff = card.map { giftCardPayment(remaining: $0.remaining ?? $0.amount ?? .zero, owed: afterDiscount - pointsOff) } ?? .zero
        return settle(goods: cart.subtotal, delivery: cart.delivery.total, discount: discountOff, points: pointsOff, giftCard: giftOff)
    }

    private static func capped(_ amount: Money, _ ceiling: Money) -> Money {
        amount.fils > ceiling.fils ? ceiling : Money(fils: max(0, amount.fils))
    }
}
