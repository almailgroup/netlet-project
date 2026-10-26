import Foundation

/// What can be done about an order once it exists — the web's
/// `LineReturn`, `ParcelCare`, `TrackParcels` and invoice page, one
/// procedure each.
extension API {
    struct AskReturn: Encodable, Sendable {
        let reference: String
        let orderItemId: Int
        let kind: String
        let reason: String
        let note: String?
    }

    struct ReturnId: Encodable, Sendable {
        let requestId: Int
    }

    /// Speed, package condition and courier conduct (3.4.4); the server makes
    /// the overall their average.
    struct RateParcel: Encodable, Sendable {
        let reference: String
        let parcelKey: String
        let speed: Int
        let condition: Int
        let conduct: Int
        let comment: String?
    }

    struct FileClaim: Encodable, Sendable {
        let reference: String
        let lineIds: [Int]
        let amount: String
        let description: String
        let evidenceUrl: String?
    }

    struct InvoiceNumber: Encodable, Sendable {
        let number: String
    }

    static let requestReturn = Procedure<AskReturn, RequestedReturn>(mutation: "orders.requestReturn")
    static let cancelReturn = Procedure<ReturnId, Acknowledged>(mutation: "orders.cancelReturn")
    static let rateDelivery = Procedure<RateParcel, Acknowledged>(mutation: "orders.rateDelivery")
    static let claimDamage = Procedure<FileClaim, Acknowledged>(mutation: "orders.claimDamage")
    static let tracking = Procedure<Reference, [TrackedParcel]>(query: "orders.tracking")
    static let invoice = Procedure<InvoiceNumber, InvoiceRecord>(query: "invoices.get")
}
