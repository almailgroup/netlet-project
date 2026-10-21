import Foundation

/// The portal's overview (`pages/admin/Overview.tsx`): what is waiting on
/// this person, how the store is selling, its health, and the standing counts.
struct PortalCounts: Decodable, Sendable {
    struct Store: Decodable, Hashable, Sendable {
        let id: Int
    }

    let draft: Int
    let pendingReview: Int
    let published: Int
    let archived: Int
    let outOfStock: Int
    let lowStock: Int
    let vendorsPending: Int
    let vendorsApproved: Int
    /// Live stores charging no commission — far more often a rate nobody set.
    let zeroCommission: [Store]
}

/// A store's health (`vendorHealth`): four evenly weighted parts, each with
/// the counts it came from.
struct StoreHealth: Decodable, Sendable {
    struct Part: Decodable, Hashable, Sendable {
        let key: String
        let score: Int
        let detail: [String: Double?]
    }

    let score: Int
    let band: String
    let components: [Part]
}

/// Sales off the frozen lines (`salesSummary`), for today, seven days and thirty.
struct SalesSummary: Decodable, Sendable {
    struct Figures: Decodable, Hashable, Sendable {
        let sales: Money
        let orders: Int
        let averageOrder: Money
        let returns: Int
    }

    struct Day: Decodable, Hashable, Sendable {
        let day: String
        let sales: Money
        let orders: Int
    }

    struct Top: Decodable, Hashable, Sendable {
        let productId: Int?
        let title: String
        let units: Int
        let sales: Money
    }

    let periods: [String: Figures]
    let daily: [Day]
    let top: [Top]
}

/// What sellers changed, and how much of it this administrator has not read.
struct SellerChanges: Decodable, Sendable {
    let rows: [AuditEntry]
    let unseen: Int
}

struct CentreWaiting: Decodable, Sendable {
    let toReceive: Int
    let toPick: Int
}

extension API {
    struct VendorScope: Encodable, Sendable {
        var vendorId: Int?
    }

    struct Limit: Encodable, Sendable {
        let limit: Int
    }

    static let portalIdentity = Procedure<VendorScope, SellerIdentity>(query: "inventory.me")
    static let portalCounts = Procedure<VendorScope, PortalCounts>(query: "inventory.overview")
    static let storeHealth = Procedure<VendorScope, StoreHealth?>(query: "inventory.health")
    static let sales = Procedure<NoInput, SalesSummary>(query: "inventory.sales")
    static let offersWaiting = Procedure<VendorScope, Int>(query: "offers.waiting")
    static let sellerChanges = Procedure<Limit, SellerChanges>(query: "inventory.sellerChanges")
    static let applicationsWaiting = Procedure<NoInput, Int>(query: "inventory.applications.waiting")
    static let parcelsWaiting = Procedure<NoInput, Int>(query: "dispatch.waiting")
    static let claimsOpen = Procedure<NoInput, Int>(query: "dispatch.claims.openCount")
    static let returnsWaiting = Procedure<NoInput, Int>(query: "returns.waiting")
    static let affiliatesWaiting = Procedure<NoInput, Int>(query: "affiliates.waiting")
    static let bannersWaiting = Procedure<NoInput, Int>(query: "ads.bannersWaiting")
    static let supportWaiting = Procedure<NoInput, Int>(query: "support.waiting")
    static let centreWaiting = Procedure<NoInput, CentreWaiting>(query: "fulfilment.waiting")
    static let shopperMessagesWaiting = Procedure<NoInput, Int>(query: "chat.seller.unread")
}

/// What a bulk action did (`products.bulk`): how many it did, and each one
/// refused with why.
struct BulkResult: Decodable, Sendable {
    struct Refusal: Decodable, Hashable, Sendable {
        let id: Int
        let reason: String
    }

    let done: Int
    let refused: [Refusal]
}

/// What deleting a product would take with it, and what refuses it
/// (`deletionCheck`), shown before anybody confirms.
struct DeletionCheck: Decodable, Sendable {
    let id: Int
    let title: String
    let variants: Int
    let images: Int
    let unitsOnHand: Int
    let inCarts: Int
    let savedBy: Int
    let openOrderLines: Int
    let bundles: Int
    let subscriptions: Int
    let blockers: [String]
}

struct DeletedProduct: Decodable, Sendable {
    let id: Int
    let title: String
}

extension API {
    struct Bulk: Encodable, Sendable {
        let ids: [Int]
        let action: String
        var percent: Double?
        var amount: Int?
    }

    static let bulkProducts = Procedure<Bulk, BulkResult>(mutation: "inventory.products.bulk")
    static let deletionCheck = Procedure<RowId, DeletionCheck>(query: "inventory.products.deletionCheck")
    static let deleteProduct = Procedure<RowId, DeletedProduct>(mutation: "inventory.products.delete")
}
