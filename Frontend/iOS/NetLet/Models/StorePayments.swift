import Foundation

/// The ways a store lets its shoppers pay (migration 0093), on the owner's
/// word — `Shared/commerce/storePayments.ts` in Swift, on its test's cases:
/// cash on delivery with its limit, KNET, a card and Apple Pay, any of them
/// and one at least; a basket is offered what all its stores take.
struct StorePaymentRules: Decodable, Sendable {
    /// Every way, in the order they are drawn.
    let methods: [String]
    /// Whether checkout takes KNET, a card and Apple Pay yet. It does not.
    let onlineLive: Bool

    static var shared: StorePaymentRules {
        ReferenceData.shared.rules.storePayments ?? StorePaymentRules(methods: ["cod", "knet", "card", "apple_pay"], onlineLive: false)
    }
}

enum StorePay {
    static let online = ["knet", "card", "apple_pay"]

    /// The dictionary's word for a way to pay.
    static func key(_ method: String) -> String { "storePay.method.\(method)" }

    /// The online ways named, once each and in the shop's order.
    static func clean(_ values: [String]) -> [String] {
        online.filter { values.contains($0) }
    }

    /// What saving would be refused for: a store keeps one way at least.
    static func problem(cod: Bool, online chosen: [String]) -> String? {
        cod || !clean(chosen).isEmpty ? nil : "storePay.needOne"
    }

    /// Those that work today, and those that are coming.
    static func line(_ methods: [String], live: Bool = StorePaymentRules.shared.onlineLive) -> (now: [String], soon: [String]) {
        (methods.filter { $0 == "cod" || live }, methods.filter { $0 != "cod" && !live })
    }

    /// What every store takes, and the first that leaves nothing in common.
    static func shared(_ stores: [(vendorId: Int, methods: [String])]) -> (methods: [String], differs: Int?) {
        var together = StorePaymentRules.shared.methods
        for store in stores {
            let next = together.filter { store.methods.contains($0) }
            if next.isEmpty { return ([], store.vendorId) }
            together = next
        }
        return (together, nil)
    }
}

/// A store's ways to pay as its page shows and edits them (`storePayments.get`).
struct StorePaymentsView: Decodable, Hashable, Sendable {
    let vendorId: Int
    let name: String
    let nameAr: String?
    /// Whether the online choices can be saved: false until 0093 is pasted.
    let ready: Bool
    let cod: Bool
    let codCeiling: String?
    let online: [String]
    let methods: [String]
    let live: Bool
}

/// How a basket can be paid (`Cart.payments`): each store's ways, what every
/// store being checked out takes, and the store that leaves nothing shared.
struct CartPayments: Decodable, Hashable, Sendable {
    struct Store: Decodable, Hashable, Sendable {
        let vendorId: Int
        let methods: [String]
    }

    struct Differs: Decodable, Hashable, Sendable {
        let vendorId: Int
        let vendorName: String
        let vendorNameAr: String?
    }

    let stores: [Store]
    let shared: [String]
    let differs: Differs?

    func methods(of vendorId: Int?) -> [String]? {
        guard let vendorId else { return nil }
        return stores.first { $0.vendorId == vendorId }?.methods
    }
}

extension API {
    struct StorePaymentsScope: Encodable, Sendable {
        /// The store named, or nil for the store the person asking acts for.
        var vendorId: Int?
    }

    static let storePayments = Procedure<StorePaymentsScope, StorePaymentsView>(query: "storePayments.get")

    struct StorePaymentsChange: Encodable, Sendable {
        var vendorId: Int?
        let cod: Bool
        let codCeiling: String?
        let online: [String]
    }

    static let setStorePayments = Procedure<StorePaymentsChange, StorePaymentsView>(mutation: "storePayments.set")
}
