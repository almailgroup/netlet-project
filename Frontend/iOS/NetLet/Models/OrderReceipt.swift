import Foundation

/// Where an order is on its way to the door, as My orders draws it — the
/// web's `journeyStage` (`Shared/commerce/orderReceipt.ts`): a box being got
/// ready, a van on the road, the house reached, or an order that left the
/// road, which draws no road at all.
enum JourneyStage: String, Sendable {
    case processing, onTheWay, delivered, cancelled, returned

    /// The three stops of the road, in order.
    static let road: [JourneyStage] = [.processing, .onTheWay, .delivered]

    /// Where on the road it is, 0 to 2; nil for an order that left it.
    var step: Int? { JourneyStage.road.firstIndex(of: self) }
}

/// The receipt's rules — `orderReceipt.ts` in Swift, tested on its cases
/// (`OrderReceiptTests`), so the app's receipt and the website's cannot say
/// different things. Every figure is the one the order froze.
enum ReceiptRules {
    /// `orderProgress`'s kind to the journey's stage. Part-delivered is still
    /// on the way, since something in it is.
    static func journeyStage(_ kind: String) -> JourneyStage {
        switch kind {
        case "onTheWay", "partlyDelivered": return .onTheWay
        case "delivered": return .delivered
        case "cancelled": return .cancelled
        case "returned": return .returned
        default: return .processing
        }
    }

    /// Which of the tracker's four steps an item is at — the order, being
    /// got ready, on the way, at the door — as the band under an opened
    /// order's item draws them (0 to 3), or nil once it left the road:
    /// `journeyStep` in `orderReceipt.ts`.
    static func journeyStep(_ kind: String) -> Int? {
        switch kind {
        case "received": return 0
        case "preparing": return 1
        case "onTheWay", "partlyDelivered": return 2
        case "delivered": return 3
        default: return nil
        }
    }

    /// Where an order has got to, read off its lines — `orderProgress` in
    /// Swift: the furthest-behind line still coming decides; a cancelled line
    /// holds nothing back and a returned one arrived and went back.
    static func progress(status: String, lines: [(fulfilment: String, deliveredAt: Date?, preordered: Bool)]) -> OrderProgress {
        let coming = lines.filter { $0.fulfilment != "cancelled" }
        if status == "cancelled" || coming.isEmpty { return OrderProgress(kind: "cancelled", preordered: nil, at: nil, delivered: nil, of: nil) }
        let kept = coming.filter { $0.fulfilment != "returned" }
        if kept.isEmpty { return OrderProgress(kind: "returned", preordered: nil, at: nil, delivered: nil, of: nil) }
        let delivered = kept.filter { $0.fulfilment == "delivered" }
        if delivered.count == kept.count {
            // The day the last of it arrived, which is the day the order did.
            let last = delivered.compactMap { $0.deliveredAt }.max()
            return OrderProgress(kind: "delivered", preordered: nil, at: last.map { ISO8601.withFraction.string(from: $0) }, delivered: nil, of: nil)
        }
        if !delivered.isEmpty { return OrderProgress(kind: "partlyDelivered", preordered: nil, at: nil, delivered: delivered.count, of: kept.count) }
        if kept.contains(where: { $0.fulfilment == "shipped" }) { return OrderProgress(kind: "onTheWay", preordered: nil, at: nil, delivered: nil, of: nil) }
        if kept.contains(where: { $0.fulfilment == "preparing" }) { return OrderProgress(kind: "preparing", preordered: nil, at: nil, delivered: nil, of: nil) }
        return OrderProgress(kind: "received", preordered: kept.allSatisfy { $0.preordered }, at: nil, delivered: nil, of: nil)
    }

    /// What a line of the sum is.
    enum RowKind: String, Sendable { case subtotal, delivery, tax, discount, points, giftCard, total }

    /// One line of the sum: what it is, its figure, and how it is drawn.
    struct Row: Equatable, Sendable {
        let kind: RowKind
        let amount: Money
        var minus = false
        var free = false
        var strong = false
        var params: [String: String] = [:]
    }

    /// The order's figures as it froze them.
    struct Figures: Sendable {
        var itemsTotal: Money
        var deliveryTotal: Money
        var grandTotal: Money
        var discountCode: String?
        var discountValue: Money
        var pointsSpent: Int
        var pointsValue: Money
        var giftCardCode: String?
        var giftCardValue: Money
    }

    /// A gift card's code is a bearer value — whoever reads it can spend what
    /// is left — and a receipt is a file that gets forwarded: only its last
    /// four characters are printed.
    static func maskedCardCode(_ code: String) -> String {
        let clean = code.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.count <= 4 ? clean : "•••• " + String(clean.suffix(4))
    }

    /// The sum in the till's own order: the goods, delivery and tax, then the
    /// order's code, the points and the gift card, then the total. A reduction
    /// that took nothing is not printed; delivery is, as free.
    static func rows(_ order: Figures, tax: (amount: Money, rate: String)?) -> [Row] {
        var rows = [Row(kind: .subtotal, amount: order.itemsTotal)]
        rows.append(Row(kind: .delivery, amount: order.deliveryTotal, free: order.deliveryTotal.isZero))
        if let tax, tax.amount.fils > 0 { rows.append(Row(kind: .tax, amount: tax.amount, params: ["rate": tax.rate])) }
        if order.discountValue.fils > 0 {
            rows.append(Row(kind: .discount, amount: order.discountValue, minus: true, params: ["code": order.discountCode ?? ""]))
        }
        if order.pointsValue.fils > 0 {
            rows.append(Row(kind: .points, amount: order.pointsValue, minus: true, params: ["points": "\(order.pointsSpent)"]))
        }
        if order.giftCardValue.fils > 0 {
            rows.append(Row(kind: .giftCard, amount: order.giftCardValue, minus: true, params: ["code": order.giftCardCode.map(maskedCardCode) ?? ""]))
        }
        rows.append(Row(kind: .total, amount: order.grandTotal, strong: true))
        return rows
    }

    /// How it stands with the money: paid, paid online instead, refunded,
    /// cancelled, or what is still to pay at the door — less than the total
    /// once something in it was cancelled.
    enum Payment: Equatable, Sendable {
        case paid, paidOnline, refunded, cancelled, nothingDue
        case onDelivery(amount: Money, reduced: Bool)
    }

    static let onlineMethods: Set<String> = ["knet", "card", "apple_pay"]

    static func payment(status: String, paymentMethod: String?, grandTotal: Money, owedNow: Money) -> Payment {
        switch status {
        case "paid": return .paid
        case "refunded": return .refunded
        case "cancelled": return .cancelled
        default:
            if let method = paymentMethod, onlineMethods.contains(method) { return .paidOnline }
            if owedNow.fils <= 0 { return .nothingDue }
            return .onDelivery(amount: owedNow, reduced: owedNow < grandTotal)
        }
    }

    /// How it was paid: cash on delivery unless an online way was chosen.
    enum Method: String, Sendable { case cod, knet, card, applePay }

    static func method(_ paymentMethod: String?) -> Method {
        switch paymentMethod {
        case "knet": return .knet
        case "card": return .card
        case "apple_pay": return .applePay
        default: return .cod
        }
    }

    /// The file's name: the shop and the order, so a folder of them sorts.
    static func fileName(_ reference: String) -> String {
        let kept = reference.unicodeScalars.filter { scalar in
            scalar == "-" || (scalar.isASCII && CharacterSet.alphanumerics.contains(scalar))
        }
        return "NetLet-receipt-" + String(String.UnicodeScalarView(kept)) + ".pdf"
    }
}
