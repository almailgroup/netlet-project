import Foundation

/// One page of the shopper's orders (`orders.list`).
struct OrderPage: Decodable, Sendable {
    let rows: [OrderSummary]
    let total: Int
    let page: Int
    let pageSize: Int
}

/// An order in the list, led by where it is rather than how it is paid —
/// the web's rule, because "awaiting payment" on every cash order answers a
/// question nobody is asking.
struct OrderSummary: Decodable, Identifiable, Hashable, Sendable {
    struct Summary: Decodable, Hashable, Sendable {
        struct FirstLine: Decodable, Hashable, Sendable {
            let title: String
            let variant: String?
        }

        let lineCount: Int
        let first: FirstLine?
        let photos: [String]
        let progress: OrderProgress
        /// How many of its items may be sent back for a refund now — the list
        /// row's "Request a refund", drawn only where it leads somewhere.
        /// Absent from a server older than the count, which draws none.
        let refundable: Int?
        /// How many of its items may be rated now — delivered, paid for and
        /// not yet reviewed (`eligibilityFor`): the row's "Rate your items".
        let reviewable: Int?
    }

    let id: Int
    let reference: String
    let status: String
    let paymentMethod: String
    let grandTotal: Money
    let placedAt: Date
    let summary: Summary
    /// What is still owed, less any line no longer coming (`stillOwed`).
    var owed: Owed? = nil

    struct Owed: Decodable, Hashable, Sendable {
        let owed: Money
        let reduced: Bool
    }

    /// The figure the row leads with: what an order that is over came to,
    /// otherwise what is still to pay — "KWD 0" over a refund read as an
    /// order that cost nothing.
    var shownTotal: Money {
        isOver ? grandTotal : owed?.owed ?? grandTotal
    }

    var isOver: Bool { status == "refunded" || status == "cancelled" }
}

/// Where an order is, read off its lines on the server (`orderProgress`).
struct OrderProgress: Decodable, Hashable, Sendable {
    let kind: String
    let preordered: Bool?
    let at: String?
    let delivered: Int?
    let of: Int?
}

/// One order opened (`orders.get`): its lines, and what can be done about
/// it now — each line's return, each parcel's rating and claim, the invoice.
struct OrderDetail: Decodable, Sendable {
    let order: OrderRecord
    let lines: [OrderLine]
    let windowDays: Int
    let parcels: [Parcel]
    let returns: [ReturnRequest]
    let documents: [OrderDocument]
    /// Whether the shopper may cancel it themselves, and if not why — the
    /// server's `shopperCancelState`.
    let cancel: OrderCancelState
    /// Each parcel as steps for "Track order" (`stepsForOrder`); nil from a
    /// server older than tracking.
    let steps: OrderSteps?

    private enum CodingKeys: String, CodingKey { case order, lines, windowDays, parcels, returns, documents, cancel, steps }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        order = try container.decode(OrderRecord.self, forKey: .order)
        lines = try container.decode([OrderLine].self, forKey: .lines)
        windowDays = try container.decodeIfPresent(Int.self, forKey: .windowDays) ?? ReferenceData.shared.rules.returnWindowDays
        parcels = try container.decodeIfPresent([Parcel].self, forKey: .parcels) ?? []
        returns = try container.decodeIfPresent([ReturnRequest].self, forKey: .returns) ?? []
        documents = try container.decodeIfPresent([OrderDocument].self, forKey: .documents) ?? []
        cancel = try container.decodeIfPresent(OrderCancelState.self, forKey: .cancel) ?? OrderCancelState(cancellable: false, reason: nil)
        steps = try container.decodeIfPresent(OrderSteps.self, forKey: .steps)
    }

    /// The lines that may be sent back for a refund now.
    var refundable: [OrderLine] { lines.filter { mayAskReturn(for: $0) } }

    /// Why the order can no longer be cancelled, said only while something in
    /// it is still coming — an order that is over needs no sentence.
    var cancelRefusal: String? {
        guard !cancel.cancellable, let reason = cancel.reason, reason != "orders.cancelClosed", let steps, !steps.cancelled,
              steps.parcels.contains(where: { $0.step != "delivered" }) else { return nil }
        return reason
    }

    /// The newest return asked for on a line, if any.
    func latestReturn(for line: OrderLine) -> ReturnRequest? {
        returns.first { $0.orderItemId == line.id }
    }

    /// Whether a line may be sent back now: the window is open and nothing
    /// is already open, refunded or exchanged on it (`LineReturn`'s `mayAsk`).
    func mayAskReturn(for line: OrderLine) -> Bool {
        guard line.returnState?.returnable == true else { return false }
        return !returns.contains { $0.orderItemId == line.id && ($0.isOpen || $0.status == "refunded" || $0.status == "exchanged") }
    }

    /// The parcels worth a card: arrived, or carrying a claim.
    var caredFor: [Parcel] { parcels.filter { $0.arrivedAt != nil || $0.claim != nil } }

    var hasShipped: Bool { lines.contains { $0.fulfilment == "shipped" } }
}

/// `shopperCancelState`: cancellable, or the message key saying why not.
struct OrderCancelState: Decodable, Hashable, Sendable {
    let cancellable: Bool
    let reason: String?
}

/// The order's parcels as steps — placed, being prepared, on the way,
/// delivered — `stepsForOrder` on the server.
struct OrderSteps: Decodable, Hashable, Sendable {
    let placedAt: Date
    let cancelled: Bool
    let parcels: [ParcelSteps]

    static let order = ["placed", "preparing", "onTheWay", "delivered"]
}

struct ParcelSteps: Decodable, Hashable, Identifiable, Sendable {
    let key: String
    let vendorName: String?
    let destinationLabel: String?
    let fast: Bool
    let lineIds: [Int]
    let step: String
    let deliveredAt: Date?
    let promise: Promise?

    var id: String { key }

    /// What the seller said about when: a window of days, made to order, or a
    /// pre-order's release date.
    struct Promise: Decodable, Hashable, Sendable {
        let kind: String
        let from: Date?
        let to: Date?
        let late: Bool?
        let at: Date?
    }

    /// How far along the four steps it is, 0 to 3.
    var reached: Int { OrderSteps.order.firstIndex(of: step) ?? 0 }
}

struct OrderRecord: Decodable, Hashable, Sendable {
    let id: Int
    let reference: String
    let status: String
    let paymentMethod: String
    let itemsTotal: Money
    let deliveryTotal: Money
    let grandTotal: Money
    let discountValue: Money
    let pointsValue: Money
    let giftCardValue: Money
    let contactName: String?
    let contactPhone: String?
    let deliveryZoneId: String?
    let addressLine: String?
    let placedAt: Date
}

/// A line as it was sold: every figure was frozen at the moment of sale.
struct OrderLine: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let productTitle: String
    let variantTitle: String
    let vendorName: String?
    let unitPrice: Money
    let quantity: Int
    let lineTotal: Money
    let fulfilment: String
    let photo: String?
    var returnState: ReturnState? = nil
    var destination: Destination? = nil
    /// The shopper's own review of this line, and whether it may be rated
    /// now — the rule `reviews.write` refuses with. Absent from an older server.
    var review: MyReview? = nil
    var reviewEligibility: ReviewableLine.Eligibility? = nil

    /// "Rate this item" is drawn for a line with no review that may be rated.
    var mayRate: Bool { review == nil && reviewEligibility?.allowed == true }

    /// Where a line went when the order went to more than one door.
    struct Destination: Decodable, Hashable, Sendable {
        let label: String
    }

    var variantLabel: String? {
        variantTitle == "Default" || variantTitle.isEmpty ? nil : variantTitle
    }
}

/// What placing an order answers: its reference and what it came to.
struct PlacedOrder: Decodable, Hashable, Sendable {
    let reference: String
    let total: Money
}
