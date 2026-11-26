import Foundation

/// One page of the shopper's orders (`orders.list`).
struct OrderPage: Decodable, Sendable {
    let rows: [OrderSummary]
    let total: Int
    let page: Int
    let pageSize: Int
    /// How many orders each view holds under the same search and period
    /// (`filterOrders`): the chips' numbers. Absent from an older server.
    var counts: [String: Int]? = nil
    /// Whether the filters read as far back as they may (`ORDER_SCAN_CEILING`).
    var atCeiling: Bool? = nil
    /// What there is to choose from — the stores bought from, the years
    /// ordered in, the first order's day — over every order. Absent from an
    /// older server, which draws no chips.
    var facets: OrderFacets? = nil
}

/// The choices My orders' chips offer (`orders.list`'s `facets`).
struct OrderFacets: Decodable, Hashable, Sendable {
    struct Store: Decodable, Hashable, Sendable, Identifiable {
        let id: Int
        let name: String
        let nameAr: String?
        let count: Int
    }

    let stores: [Store]
    let years: [Int]
    let firstDay: String?
}

/// What My orders' tools ask the server for (`orders.list`'s view, search,
/// period or days, store, payment, total and order —
/// `Shared/commerce/orderFilters.ts`): the server filters over every order,
/// so a tab's number is what pressing it shows.
struct OrderFilters: Hashable, Sendable {
    var view = "all"
    var q = ""
    var period = "all"
    /// Two Kuwaiti days of the shopper's own (`yyyy-MM-dd`), either open; a
    /// year is its first and last day.
    var from: String?
    var to: String?
    /// A store bought from, by its id.
    var store: Int?
    /// "all", "cod" or "online".
    var payment = "all"
    /// "all" or one of the total's bands (`ORDER_TOTALS`).
    var total = "all"
    /// "newest", "oldest", "highest" or "lowest".
    var sort = "newest"
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
/// An order's tax as frozen (0087): what it came to and the rate charged.
struct OrderTax: Decodable, Hashable, Sendable {
    let amount: Money
    let rate: String
}

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
    /// What can still be changed before a driver has it — an item, a
    /// quantity, the address (`shopperChangeState`, `addressChangeState`).
    let change: OrderChangeState
    let changeAddress: OrderChangeState
    /// Whether the shopper may still change how it is paid (`paymentChangeState`).
    let paymentChange: PaymentChangeState
    /// What the driver collects now (`owed.ts`); absent from an older server,
    /// which leaves the order's total.
    let owedNow: Money?
    /// Warranty claims on its lines, newest first, with where each stands.
    let warranty: [WarrantyClaim]
    /// The day and time the shopper asked of each store (migration 0085),
    /// frozen with the order; empty from an older server or an order with none.
    let deliverySlots: [OrderDeliverySlot]
    /// The QR and code for the driver while a parcel is on its way (0086);
    /// nil otherwise, and from a server older than 0086.
    let handover: OrderHandover?
    /// The tax added at checkout (0087), the sum of the lines' frozen tax, and
    /// its rate; nil untaxed, and from a server older than 0087.
    let tax: OrderTax?

    private enum CodingKeys: String, CodingKey { case order, lines, windowDays, parcels, returns, documents, cancel, steps, change, changeAddress, paymentChange, owedNow, warranty, deliverySlots, handover, tax }

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
        change = try container.decodeIfPresent(OrderChangeState.self, forKey: .change) ?? .closed
        changeAddress = try container.decodeIfPresent(OrderChangeState.self, forKey: .changeAddress) ?? .closed
        paymentChange = try container.decodeIfPresent(PaymentChangeState.self, forKey: .paymentChange) ?? .closed
        owedNow = try container.decodeIfPresent(Money.self, forKey: .owedNow)
        warranty = try container.decodeIfPresent([WarrantyClaim].self, forKey: .warranty) ?? []
        deliverySlots = try container.decodeIfPresent([OrderDeliverySlot].self, forKey: .deliverySlots) ?? []
        handover = try container.decodeIfPresent(OrderHandover.self, forKey: .handover)
        tax = try container.decodeIfPresent(OrderTax.self, forKey: .tax)
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

    /// Whether an item can be tracked: it is in one of the parcels — the
    /// web's `tracksItem`. A cancelled item leaves its parcel and a cancelled
    /// order has none, so a press on such an item's words opens its product
    /// page rather than a tracker with nothing in it.
    func tracks(_ lineId: Int) -> Bool {
        !cancelled && parcels.contains { $0.lineIds.contains(lineId) }
    }
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
    /// What the receipt prints beside its figures — the code the order used,
    /// the points it spent, the gift card's code and the driver's notes, as the
    /// order froze them. Absent from a recording older than the receipt.
    var discountCode: String? = nil
    var pointsSpent: Int? = nil
    var giftCardCode: String? = nil
    var addressNotes: String? = nil

    /// Its figures for the receipt's sum (`ReceiptRules.rows`).
    var receiptFigures: ReceiptRules.Figures {
        ReceiptRules.Figures(
            itemsTotal: itemsTotal, deliveryTotal: deliveryTotal, grandTotal: grandTotal,
            discountCode: discountCode, discountValue: discountValue,
            pointsSpent: pointsSpent ?? 0, pointsValue: pointsValue,
            giftCardCode: giftCardCode, giftCardValue: giftCardValue
        )
    }
}

/// A line as it was sold: every figure was frozen at the moment of sale.
/// A store's preferred day and time on an order (`order_delivery_slots`).
struct OrderDeliverySlot: Decodable, Hashable, Sendable {
    let vendorId: Int?
    let date: String
    let window: String

    var slot: DeliverySlot { DeliverySlot(date: date, window: window) }
}

struct OrderLine: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let productTitle: String
    let variantTitle: String
    let vendorName: String?
    /// The store it came from, which a delivery day names (0085).
    var vendorId: Int? = nil
    let unitPrice: Money
    let quantity: Int
    let lineTotal: Money
    let fulfilment: String
    let photo: String?
    /// The variant it was, while the product still has it — what Buy again puts back.
    var variantId: Int? = nil
    var returnState: ReturnState? = nil
    var destination: Destination? = nil
    /// The shopper's own review of this line, and whether it may be rated
    /// now — the rule `reviews.write` refuses with. Absent from an older server.
    var review: MyReview? = nil
    var reviewEligibility: ReviewableLine.Eligibility? = nil
    /// Whether a warranty claim may be filed on it now, and the store's own
    /// warranty words, shown as typed (`warrantyEligibility`).
    var warrantyEligibility: ReviewableLine.Eligibility? = nil
    var warrantyTerms: String? = nil
    /// Whether its quantity may still be lowered or the item taken out:
    /// in the store's hands, unpaid, and not part of a set.
    var changeable: Bool? = nil
    /// The line's own discount code and what it took, as frozen (0074).
    var discountCode: String? = nil
    var discountAmount: Money? = nil
    /// When it arrived, and whether it was a pre-order — what the receipt's
    /// status is read off (`ReceiptRules.progress`, the server's `orderProgress`).
    var deliveredAt: Date? = nil
    var preordered: Bool? = nil
    /// Its page on the shop, while the shop still shows the product — what a
    /// press on the item opens (on the owner's word: "I cannot see product
    /// details" from an order). Absent from an older server.
    var productHandle: String? = nil

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
