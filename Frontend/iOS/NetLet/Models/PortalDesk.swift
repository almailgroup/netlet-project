import Foundation

/// A page of rows, as every paged portal list answers (`Shared/pagination.ts`).
struct PortalPageOf<Row: Decodable & Sendable>: Decodable, Sendable {
    let rows: [Row]
    let total: Int
    let page: Int
    let pageSize: Int

    var pages: Int { max(1, (total + max(pageSize, 1) - 1) / max(pageSize, 1)) }
}

// MARK: Orders

/// An order on the seller's desk (`orders.forSeller`): the seller's own
/// figure, not the shopper's basket total, since a shared basket's covers a
/// rival's goods.
struct DeskOrder: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let reference: String
    let status: String
    let paymentMethod: String?
    let placedAt: Date
    let vendorCount: Int
    let orderTotal: Money
}

/// How much attention an order wants (3.6.5), and the evidence behind it.
struct OrderRisk: Decodable, Hashable, Sendable {
    struct Flag: Decodable, Hashable, Sendable {
        let signal: String
        let serious: Bool
        let detail: [String: Figure]
    }

    let orderId: Int
    let risk: String
    let flags: [Flag]
}

/// A figure in a signal's evidence: a count or an amount written as a decimal.
enum Figure: Decodable, Hashable, Sendable {
    case number(Double)
    case text(String)

    init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if let number = try? single.decode(Double.self) { self = .number(number) } else { self = .text(try single.decode(String.self)) }
    }

    var written: String {
        switch self {
        case .number(let value): return value.rounded() == value ? String(Int(value)) : String(value)
        case .text(let value): return value
        }
    }
}

/// One order opened on the desk (`orders.forSellerDetail`): the delivery and
/// the lines this person may act on — a seller's own, an administrator's all.
struct DeskOrderDetail: Decodable, Sendable {
    struct Order: Decodable, Hashable, Sendable {
        let id: Int
        let reference: String
        let status: String
        let placedAt: Date
        let contactName: String?
        let paymentMethod: String?
        let addressLine: String?
        let addressNotes: String?
        let deliveryPin: Pin?
        let subscriptionId: Int?

        /// `canRecordCollection`: cash is recorded once, for the basket, while it is still owed.
        var mayRecordCash: Bool { paymentMethod == "cod" && status == "pending_payment" }
    }

    struct Line: Decodable, Identifiable, Hashable, Sendable {
        struct Addon: Decodable, Hashable, Sendable {
            let id: Int
            let label: String
            let price: Money
        }

        struct Destination: Decodable, Hashable, Sendable {
            let label: String
            let addressLine: String?
            let pin: Pin?
        }

        let id: Int
        let productTitle: String
        let variantTitle: String?
        let quantity: Int
        let unitPrice: Money
        let lineTotal: Money
        let fulfilment: String
        let deliveredAt: Date?
        let centreId: Int?
        let addons: [Addon]
        let destination: Destination?

        var variantLabel: String? {
            guard let variantTitle, !variantTitle.isEmpty, variantTitle != "Default" else { return nil }
            return variantTitle
        }

        /// Left the shelf, so a delivery company may be asked to pay for damage.
        var mayClaim: Bool { fulfilment == "shipped" || fulfilment == "delivered" || (fulfilment == "returned" && deliveredAt != nil) }
    }

    let scope: String?
    let order: Order
    let lines: [Line]
}

struct CashRecorded: Decodable, Sendable {
    let recorded: Bool
}

// MARK: Stock

/// A variant at or under its own reorder point (`inventory.lowStock`).
struct LowStockRow: Decodable, Identifiable, Hashable, Sendable {
    let variantId: Int
    let variantTitle: String
    let stock: Int
    let lowStockAt: Int?
    let productId: Int
    let productTitle: String
    let vendorName: String?
    let waiting: Int

    var id: Int { variantId }
}

/// One recorded change to a shelf, and why (`inventory.stockHistory`).
struct StockMove: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let delta: Int
    let resulting: Int
    let reason: String
    let createdAt: Date
    let variantTitle: String
    let productId: Int
    let productTitle: String
    let actorEmail: String?
    let actorName: String?
}

// MARK: Price requests

/// A shopper's request for a special price, as the seller answers it (`offers.inbox`).
struct PriceAsk: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let state: String
    let productTitle: String
    let variantTitle: String?
    let vendorName: String?
    let listPrice: Money
    let askedPrice: Money
    let offeredPrice: Money?
    let quantity: Int
    let shopperNote: String?
    let vendorNote: String?
    let createdAt: Date
}

// MARK: Returns

/// A return or exchange on the seller's desk (`returns.list`), with the acts
/// the server says it may take next — the page offers only those.
struct ReturnCase: Decodable, Identifiable, Hashable, Sendable {
    struct Destination: Decodable, Hashable, Sendable {
        let addressLine: String?
    }

    let id: Int
    let reference: String
    let productTitle: String
    let quantity: Int
    let lineTotal: Money
    let vendorName: String?
    let kind: String
    let reason: String
    let note: String?
    let status: String
    let decidedBy: String?
    let declineReason: String?
    let refundAmount: Money?
    let refundPaidAt: Date?
    let replacementReference: String?
    let destination: Destination?
    let contactName: String?
    let contactPhone: String?
    let addressLine: String?
    let createdAt: Date
    let actions: [String]

    /// Where to collect it from: a line sent elsewhere is collected from there.
    var collectFrom: String {
        [contactName, contactPhone, destination?.addressLine ?? addressLine].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

struct ReturnReceived: Decodable, Sendable {
    let outcome: String
    let replacementReference: String?
    let refundAmount: Money?
}

// MARK: Team

/// Somebody who can sign in to the store (`inventory.vendors.members`).
struct StoreMember: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let userId: Int
    let role: String
    let email: String
    let name: String?

    var shownName: String { (name?.isEmpty == false ? name : nil) ?? email }
}

// MARK: Payouts

/// What a store is owed now, ready to go out (`finance.payoutBatches`).
struct PayoutBatch: Decodable, Identifiable, Hashable, Sendable {
    struct Line: Decodable, Hashable, Sendable {
        let orderId: Int?
        let reference: String
        let amount: Money
        let kind: String
    }

    let vendorId: Int
    let vendorName: String
    let iban: String?
    let total: Money
    let payable: Bool
    let lines: [Line]

    var id: Int { vendorId }
}

/// A transfer frozen and waiting to be sent (`finance.preparedPayouts`).
struct PreparedRun: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let vendorName: String
    let total: Money
    let iban: String?
    let preparedAt: Date?
    let fileReference: String?
}

struct PreparedRuns: Decodable, Sendable {
    let rows: [PreparedRun]
    let total: Int
    let page: Int
    let pageSize: Int
    let unfiled: Int
}

/// A bank file of prepared transfers (`finance.payoutFiles`).
struct BankFile: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let reference: String
    let createdAt: Date
    let waiting: Int
    let sent: Int
    let cancelled: Int
    let total: Money
}

struct BankFiles: Decodable, Sendable {
    let rows: [BankFile]
    let total: Int
    let page: Int
    let pageSize: Int
    /// Why the ISO 20022 file cannot be made, when it cannot (a message key).
    let pain001: String?
}

/// A payout already sent or being sent (`finance.payoutHistory`).
struct PayoutRun: Decodable, Identifiable, Hashable, Sendable {
    struct Line: Decodable, Hashable, Sendable {
        let reference: String
        let amount: Money
    }

    let id: Int
    let vendorName: String
    let total: Money
    let status: String
    let bankReference: String?
    let iban: String?
    let preparedAt: Date?
    let paidAt: Date?
    let lines: [Line]
}

/// When each order's money comes due to its seller (`finance.payoutsDue`).
struct PayoutDue: Decodable, Hashable, Sendable {
    struct Due: Decodable, Hashable, Sendable {
        struct Window: Decodable, Hashable, Sendable {
            let from: Date
            let to: Date
        }

        let state: String
        let window: Window?
        let overdue: Bool?
    }

    let orderId: Int
    let reference: String
    let vendorId: Int
    let vendorName: String
    let owed: Money
    let paid: Money
    let sending: Money
    let due: Due
}

struct PreparedAll: Decodable, Sendable {
    let prepared: Int
    let skipped: [String]
}

struct PreparedOne: Decodable, Sendable {
    let total: Money
}

struct MadeFile: Decodable, Sendable {
    let reference: String
    let transfers: Int
}

struct MarkedSent: Decodable, Sendable {
    let runs: Int
}

/// A bank file's contents, to hand to the bank (`finance.downloadPayoutFile`).
struct PayoutFileContent: Decodable, Sendable {
    let filename: String
    let mimeType: String
    let content: String
}
