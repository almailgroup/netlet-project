import Foundation

/// NetLet's money desks — the finance panel, invoices, codes and gift cards,
/// affiliates and membership — as the web's admin pages read them. Every
/// figure is what the orders froze; nothing here recomputes a rate.

// MARK: - Finance

/// Gross, refunded and net are three figures, never one; commission and what
/// the sellers are owed add up to the net (`Shared/commerce/finance.ts`).
struct FinanceTotals: Decodable, Hashable, Sendable {
    let gross: Money
    let refunded: Money
    let net: Money
    let commission: Money
    let vendorNet: Money
    let paidLines: Int
    let refundedLines: Int

    /// NetLet's cut as a share of the net, to one decimal (`takeRate`).
    var takeRate: String? {
        guard net.fils > 0 else { return nil }
        let tenths = (commission.fils * 1000) / net.fils
        return tenths % 10 == 0 ? "\(tenths / 10)" : "\(Double(tenths) / 10)"
    }
}

struct SellerTotals: Decodable, Hashable, Sendable {
    var vendorId: Int? = nil
    let vendorName: String
    let gross: Money
    let refunded: Money
    let net: Money
    let commission: Money
    let vendorNet: Money
    let paidLines: Int
    let refundedLines: Int
}

struct MonthTotals: Decodable, Hashable, Sendable {
    /// "2026-10", in UTC, which the page says.
    let month: String
    let gross: Money
    let refunded: Money
    let net: Money
    let commission: Money
    let vendorNet: Money
    let paidLines: Int
    let refundedLines: Int
}

struct FinanceReport: Decodable, Sendable {
    let totals: FinanceTotals
    let vendors: [SellerTotals]
    let months: [MonthTotals]
    var truncated: Bool = false
}

/// What each seller is owed, week by week (Sunday to Saturday).
struct WeeklyPayouts: Decodable, Sendable {
    struct Seller: Decodable, Hashable, Sendable {
        struct Week: Decodable, Hashable, Sendable {
            let weekStart: String
            let gross: Money
            let refunded: Money
            let commission: Money
            let owed: Money
            let lines: Int
        }

        var vendorId: Int? = nil
        let vendorName: String
        let weeks: [Week]
        let owed: Money
    }

    let vendors: [Seller]
    let owed: Money
}

/// A shopper's points, or an affiliate's commission, waiting to be paid.
struct CashOut: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    var name: String? = nil
    let email: String
    /// "points" or "affiliate", paid at different rates.
    let pot: String
    let points: Int
    let value: Money
    let requestedAt: Date
}

struct Settled: Decodable, Sendable {
    let settled: Bool
}

// MARK: - Invoices

struct InvoiceListRow: Decodable, Identifiable, Hashable, Sendable {
    let number: String
    /// "invoice" or "credit_note".
    let kind: String
    let total: Money
    let issuedAt: Date
    let orderReference: String

    var id: String { number }
}

struct InvoicePage: Decodable, Sendable {
    let rows: [InvoiceListRow]
    let total: Int
    let page: Int
    let pageSize: Int
}

// MARK: - Codes and gift cards

struct DiscountCode: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let code: String
    /// "percent" or "fixed".
    let kind: String
    let value: String
    var minSpend: String? = nil
    var endsAt: Date? = nil
    var maxRedemptions: Int? = nil
    var perShopper: Int = 1
    var used: Int = 0
}

struct GiftCardRow: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let code: String
    let initialBalance: Money
    let remaining: Money
    var expiresAt: Date? = nil
    var note: String? = nil
}

struct Vouchers: Decodable, Sendable {
    let codes: [DiscountCode]
    let cards: [GiftCardRow]
}

struct MintedCard: Decodable, Sendable {
    let code: String
}

// MARK: - Affiliates

struct AffiliateRow: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let email: String
    var name: String? = nil
    let code: String
    let displayName: String
    var channel: String? = nil
    /// active or suspended — or pending, an application left from before joining was instant.
    let status: String
    let createdAt: Date
    var paidOrders: Int = 0
    /// Points a member's links earned, net of returns.
    var points: Int = 0
    /// The old programme's money, net of refunds.
    let earned: Money
}

struct AffiliatePage: Decodable, Sendable {
    let rows: [AffiliateRow]
    let total: Int
    let page: Int
    let pageSize: Int
}

// MARK: - Membership

struct MembershipGrant: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let email: String
    let startsAt: Date
    let endsAt: Date
    var cancelledAt: Date? = nil
    var note: String? = nil
    let active: Bool

    /// ended, active, queued or over.
    func state(now: Date = Date()) -> String {
        if cancelledAt != nil { return "ended" }
        if active { return "active" }
        return startsAt > now ? "queued" : "over"
    }
}

struct MembershipPage: Decodable, Sendable {
    let rows: [MembershipGrant]
    let total: Int
    let page: Int
    let pageSize: Int
}

struct MembershipTerms: Decodable, Sendable {
    var freeDeliveryOver: String? = nil
}

struct MembershipReport: Decodable, Sendable {
    let members: Int
    let orders: Int
    let waived: Money
}

struct GrantedMembership: Decodable, Sendable {
    let endsAt: Date
}

extension PortalRules {
    /// The money desks' limits (`affiliate.ts`, `membership.ts`, `vouchers.ts`).
    struct MoneyRules: Decodable, Sendable {
        let maxAffiliatePercent: Double
        let maxGrantMonths: Int
        let maxGrantNote: Int
        let voucherKinds: [String]
    }
}

extension API {
    static let financeReport = Procedure<NoInput, FinanceReport>(query: "finance.report")
    static let weeklyPayouts = Procedure<NoInput, WeeklyPayouts>(query: "finance.payouts")
    static let pendingCashOuts = Procedure<NoInput, [CashOut]>(query: "rewards.pendingCashOuts")

    struct CashOutEntry: Encodable, Sendable {
        let entryId: Int
    }

    static let settleCashOut = Procedure<CashOutEntry, Settled>(mutation: "rewards.settleCashOut")

    struct InvoiceQuery: Encodable, Sendable {
        var page: Int?
        var query: String?
    }

    static let invoiceList = Procedure<InvoiceQuery, InvoicePage>(query: "invoices.list")

    static let vouchers = Procedure<NoInput, Vouchers>(query: "orders.vouchers")

    struct DiscountCodeInput: Encodable, Sendable {
        let code: String
        let kind: String
        let value: String
        let minSpend: OrNull<String>
        /// A bare day, the end of that Kuwaiti day.
        let endsAt: OrNull<String>
        let maxRedemptions: OrNull<Int>
        let perShopper: Int
    }

    static let saveDiscountCode = Procedure<DiscountCodeInput, Acknowledged>(mutation: "orders.saveDiscountCode")

    struct GiftCardInput: Encodable, Sendable {
        let amount: String
        let note: OrNull<String>
        let expiresAt: OrNull<String>
    }

    static let createGiftCard = Procedure<GiftCardInput, MintedCard>(mutation: "orders.createGiftCard")

    static let affiliateList = Procedure<PageOnly, AffiliatePage>(query: "affiliates.list")

    struct AffiliateUpdate: Encodable, Sendable {
        let affiliateId: Int
        var status: String?
    }

    static let updateAffiliate = Procedure<AffiliateUpdate, Acknowledged>(mutation: "affiliates.update")

    struct MembershipQuery: Encodable, Sendable {
        let current: Bool
        var page: Int?
    }

    static let membershipList = Procedure<MembershipQuery, MembershipPage>(query: "membership.list")
    static let membershipTerms = Procedure<NoInput, MembershipTerms>(query: "membership.terms")
    static let membershipReport = Procedure<NoInput, MembershipReport>(query: "membership.report")

    struct FreeOver: Encodable, Sendable {
        let freeDeliveryOver: OrNull<String>
    }

    static let setMembershipTerms = Procedure<FreeOver, Acknowledged>(mutation: "membership.setTerms")

    struct Grant: Encodable, Sendable {
        let email: String
        let months: Int
        let note: String?
    }

    static let grantMembership = Procedure<Grant, GrantedMembership>(mutation: "membership.grant")
    static let endMembership = Procedure<RowId, Acknowledged>(mutation: "membership.end")
}
