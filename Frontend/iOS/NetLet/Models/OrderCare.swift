import Foundation

/// Whether a line can be sent back now, decided on the server's clock
/// (`returnStateFor`) — the answer rather than the ingredients, so nobody
/// reopens a closed window by changing the phone's date.
struct ReturnState: Decodable, Hashable, Sendable {
    let returnable: Bool
    /// The message key saying why not, when it cannot.
    let reason: String?
    let closesAt: Date?
    let daysLeft: Int?
}

/// One return asked for on a line (`returnsForShopperOrder`), newest first.
struct ReturnRequest: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let orderItemId: Int
    let kind: String
    let reason: String
    let status: String
    let decidedBy: String?
    let declineReason: String?
    let refundAmount: Money?
    let refundPaidAt: Date?
    let replacementReference: String?
    let createdAt: Date

    /// Still waiting on somebody (`isOpenReturn`).
    var isOpen: Bool { ReferenceData.shared.rules.orderRules.openReturnStatuses.contains(status) }

    /// Withdrawable until the item has been collected, as the web offers it.
    var mayWithdraw: Bool { status == "requested" || status == "review" || status == "approved" }
}

/// What asking for a return answers: the request as written, its status
/// already decided where a rule could decide it.
struct RequestedReturn: Decodable, Sendable {
    let status: String
}

/// What a delivery is rated on (3.4.4) — `RATING_PARTS` — and the overall,
/// their average to a whole star, half up (`overallOf`).
enum DeliveryRatingParts {
    static let all = ["speed", "condition", "conduct"]

    static func label(_ part: String) -> String {
        switch part {
        case "speed": return "delivery.partSpeed"
        case "condition": return "delivery.partCondition"
        default: return "delivery.partConduct"
        }
    }

    static func overall(speed: Int, condition: Int, conduct: Int) -> Int {
        Int((Double(speed + condition + conduct) / 3).rounded(.toNearestOrAwayFromZero))
    }
}

/// One seller's goods to one door — what one driver carried
/// (`parcelsForShopper`), with what can be done about it at the door.
struct Parcel: Decodable, Identifiable, Hashable, Sendable {
    struct Line: Decodable, Hashable, Sendable {
        let lineId: Int
        let productTitle: String
        let lineTotal: Money
    }

    struct Rating: Decodable, Hashable, Sendable {
        let rating: Int
        let comment: String?
        /// The three parts (3.4.4); nil on a rating given before they existed.
        var speed: Int? = nil
        var condition: Int? = nil
        var conduct: Int? = nil
    }

    /// Whether it can be rated now: open from arrival for a window.
    struct RatingState: Decodable, Hashable, Sendable {
        let allowed: Bool
        let closesAt: Date?
        let reason: String?
    }

    struct Claim: Decodable, Hashable, Sendable {
        let id: Int
        let status: String
        let claimedAmount: Money
        let awardedAmount: Money?
        let decisionNote: String?
    }

    let key: String
    let vendorName: String?
    let destinationLabel: String?
    let state: String
    let arrivedAt: Date?
    let lines: [Line]
    let rating: Rating?
    let ratingState: RatingState
    let claim: Claim?
    /// Why a damage claim cannot be filed now, or nil when it can.
    let claimRefusal: String?

    var id: String { key }

    /// The most a claim can ask for: what the chosen lines were sold for
    /// (`claimCeiling`), never a figure somebody typed.
    func ceiling(_ lineIds: Set<Int>) -> Money {
        Money(fils: lines.filter { lineIds.contains($0.lineId) }.reduce(0) { $0 + $1.lineTotal.fils })
    }
}

/// An invoice or credit note issued on an order (`documentsForShopperOrder`).
struct OrderDocument: Decodable, Identifiable, Hashable, Sendable {
    let number: String
    let kind: String
    let total: Money
    let issuedAt: Date

    var id: String { number }
    var isCredit: Bool { kind == "credit_note" }
}

/// A parcel on the road (`orders.tracking`): which company, and where its
/// driver is while they choose to share it — never who.
struct TrackedParcel: Decodable, Hashable, Sendable {
    /// A five-minute band, or "arriving" when close. `source` says where the
    /// minutes came from: Apple's driving time with traffic, or the distance.
    struct Eta: Decodable, Hashable, Sendable {
        let kind: String
        let low: Int?
        let high: Int?
        let source: String?
    }

    let courierName: String
    let sellers: [String]
    let doorLabel: String?
    let driver: Pin?
    let recordedAt: Date?
    let door: Pin?
    let eta: Eta?
}

/// One issued document as frozen (`InvoiceDocument`): the page draws only
/// this, never today's store details.
struct InvoiceDocument: Decodable, Hashable, Sendable {
    struct Issuer: Decodable, Hashable, Sendable {
        let name: String
        let nameAr: String?
        let licence: String?
        let address: String?
    }

    struct Buyer: Decodable, Hashable, Sendable {
        let name: String?
        let phone: String?
        let email: String
        let address: String?
    }

    struct Line: Decodable, Hashable, Sendable {
        let title: String
        let titleAr: String?
        let variantTitle: String?
        let sku: String?
        let quantity: Int
        let unitPrice: Money
        let lineTotal: Money
    }

    struct Seller: Decodable, Hashable, Sendable {
        let vendorId: Int?
        let name: String
        let nameAr: String?
        let licence: String?
        let underPlatformLicence: Bool
        let lines: [Line]
        let delivery: Money
    }

    struct PaidWith: Decodable, Hashable, Sendable {
        let points: Money
        let giftCard: Money
        let cash: Money
    }

    struct Corrects: Decodable, Hashable, Sendable {
        let invoiceNumber: String
        let reason: String
    }

    let kind: String
    let number: String
    let issuedAt: Date
    let orderReference: String
    let currency: String
    let issuer: Issuer
    let buyer: Buyer
    let sellers: [Seller]
    let goods: Money
    let delivery: Money
    let discount: Money
    let total: Money
    let paidWith: PaidWith
    let paymentMethod: String?
    let credits: Corrects?

    var isCredit: Bool { kind == "credit_note" }
}

/// One document opened (`invoices.get`): the document, the credit notes
/// correcting it, and the code anybody holding the paper can check it with.
struct InvoiceRecord: Decodable, Sendable {
    let document: InvoiceDocument
    let credits: [OrderDocument]
    let verifyCode: String
}
