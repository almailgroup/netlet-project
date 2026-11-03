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

    /// How many lines the shopper's own cancel took back.
    struct CancelledOrder: Decodable, Sendable {
        let cancelled: Int
    }

    static let cancelOrder = Procedure<Reference, CancelledOrder>(mutation: "orders.cancel")
    static let requestReturn = Procedure<AskReturn, RequestedReturn>(mutation: "orders.requestReturn")
    static let cancelReturn = Procedure<ReturnId, Acknowledged>(mutation: "orders.cancelReturn")
    static let rateDelivery = Procedure<RateParcel, Acknowledged>(mutation: "orders.rateDelivery")
    static let claimDamage = Procedure<FileClaim, Acknowledged>(mutation: "orders.claimDamage")
    static let tracking = Procedure<Reference, [TrackedParcel]>(query: "orders.tracking")
    static let invoice = Procedure<InvoiceNumber, InvoiceRecord>(query: "invoices.get")

    // MARK: The after-sales centre — the web's `OrderActions`

    /// One line and the quantity wanted; nought takes it out.
    struct LineChange: Encodable, Sendable, Hashable {
        let lineId: Int
        let quantity: Int
    }

    struct ChangeAsk: Encodable, Sendable {
        let reference: String
        let changes: [LineChange]
    }

    /// The change at the figure the quote showed; refused with
    /// `orders.changeMoved` if it no longer holds.
    struct ChangeApply: Encodable, Sendable {
        let reference: String
        let changes: [LineChange]
        let expectOwed: String
    }

    struct MoveAddress: Encodable, Sendable {
        let reference: String
        let addressId: Int
    }

    struct BuyAgain: Encodable, Sendable {
        let reference: String
        let cartId: String?

        private enum CodingKeys: String, CodingKey { case reference, cartId }

        /// `cartId` is nullable, not optional: it is always sent.
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(reference, forKey: .reference)
            try container.encode(cartId, forKey: .cartId)
        }
    }

    static let changeQuote = Procedure<ChangeAsk, ChangeQuote>(query: "orders.changeQuote")
    static let changeOrder = Procedure<ChangeApply, Acknowledged>(mutation: "orders.change")
    static let changeOrderAddress = Procedure<MoveAddress, AddressMoved>(mutation: "orders.changeAddress")
    static let buyAgain = Procedure<BuyAgain, BuyAgainAnswer>(mutation: "orders.buyAgain")

    // MARK: Warranty (migration 0072)

    struct FileWarranty: Encodable, Sendable {
        let reference: String
        let orderItemId: Int
        let problem: String
        /// `/media/…` paths the shopper uploaded with `/api/media/review`.
        let photos: [String]
    }

    struct ClaimId: Encodable, Sendable {
        let id: Int
    }

    struct WarrantyDesk: Encodable, Sendable {
        let waiting: Bool
    }

    /// A remedy, or a refusal with the reason the shopper reads.
    struct DecideWarranty: Encodable, Sendable {
        let id: Int
        let accept: Bool
        let remedy: String?
        let response: String

        private enum CodingKeys: String, CodingKey { case id, accept, remedy, response }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(id, forKey: .id)
            try container.encode(accept, forKey: .accept)
            try container.encode(remedy, forKey: .remedy)
            try container.encode(response, forKey: .response)
        }
    }

    struct CompleteWarranty: Encodable, Sendable {
        let id: Int
        let note: String
    }

    static let fileWarranty = Procedure<FileWarranty, Acknowledged>(mutation: "warranty.file")
    static let withdrawWarranty = Procedure<ClaimId, Acknowledged>(mutation: "warranty.withdraw")
    static let warrantyDesk = Procedure<WarrantyDesk, [WarrantyDeskClaim]>(query: "warranty.list")
    static let warrantyWaiting = Procedure<NoInput, Int>(query: "warranty.waitingCount")
    static let decideWarranty = Procedure<DecideWarranty, Acknowledged>(mutation: "warranty.decide")
    static let completeWarranty = Procedure<CompleteWarranty, Acknowledged>(mutation: "warranty.complete")

    // MARK: Get help with this order

    struct HelpTurn: Encodable, Sendable, Hashable {
        /// "shopper" or "assistant".
        let role: String
        let text: String
    }

    struct AskOrderHelp: Encodable, Sendable {
        let reference: String
        let locale: String
        let turns: [HelpTurn]
    }

    static let orderHelp = Procedure<AskOrderHelp, OrderHelpAnswer>(mutation: "support.orderHelp")
    static let orderHelpAvailable = Procedure<NoInput, Bool>(query: "support.orderHelpAvailable")

    /// The return window an administrator set (`commerce.policy`).
    static let returnPolicy = Procedure<NoInput, ReturnPolicy>(query: "commerce.policy")
}

/// Frequently bought (migration 0073): the shopper's own list of what they
/// buy again and again — the web's `/account/frequent`.
extension API {
    struct FrequentProduct: Encodable, Sendable {
        let productId: Int
    }

    struct AddFrequent: Encodable, Sendable {
        let productId: Int
        let variantId: Int
        let quantity: Int
    }

    struct FrequentQuantity: Encodable, Sendable {
        let id: Int
        let quantity: Int
    }

    struct FrequentId: Encodable, Sendable {
        let id: Int
    }

    struct FrequentSaved: Decodable, Sendable {
        let id: Int
        let quantity: Int
    }

    static let frequentList = Procedure<LocaleOnly, FrequentList>(query: "frequent.list")
    static let frequentForProduct = Procedure<FrequentProduct, FrequentForProduct>(query: "frequent.forProduct")
    static let frequentSuggestions = Procedure<LocaleOnly, [FrequentSuggestion]>(query: "frequent.suggestions")
    static let frequentAdd = Procedure<AddFrequent, FrequentSaved>(mutation: "frequent.add")
    static let frequentSetQuantity = Procedure<FrequentQuantity, FrequentSaved>(mutation: "frequent.setQuantity")
    static let frequentRemove = Procedure<FrequentId, Acknowledged>(mutation: "frequent.remove")
}
