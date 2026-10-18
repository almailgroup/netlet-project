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
    }

    let id: Int
    let reference: String
    let status: String
    let paymentMethod: String
    let grandTotal: Money
    let placedAt: Date
    let summary: Summary
}

/// Where an order is, read off its lines on the server (`orderProgress`).
struct OrderProgress: Decodable, Hashable, Sendable {
    let kind: String
    let preordered: Bool?
    let at: String?
    let delivered: Int?
    let of: Int?
}

/// One order opened (`orders.get`).
struct OrderDetail: Decodable, Sendable {
    let order: OrderRecord
    let lines: [OrderLine]
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

    var variantLabel: String? {
        variantTitle == "Default" || variantTitle.isEmpty ? nil : variantTitle
    }
}

/// What placing an order answers: its reference and what it came to.
struct PlacedOrder: Decodable, Hashable, Sendable {
    let reference: String
    let total: Money
}
