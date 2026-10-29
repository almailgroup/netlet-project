import Foundation

/// A store's commission proposal (`commission.list`, 3.3.2): a percentage or a
/// fixed amount per sale, for the whole store or one product, with NetLet's
/// answer once there is one.
struct CommissionProposal: Decodable, Identifiable, Hashable, Sendable {
    struct Figure: Decodable, Hashable, Sendable {
        let percent: String?
        let fixed: String?
    }

    let id: Int
    let vendorId: Int
    let vendorName: String
    let productId: Int?
    let productTitle: String?
    let percent: String?
    let fixed: String?
    let reason: String?
    /// pending, accepted, declined or withdrawn.
    let status: String
    let decisionNote: String?
    let decidedAt: Date?
    let createdAt: Date
    /// What the store or product is charged now.
    let current: Figure
}

struct CommissionProposalPage: Decodable, Sendable {
    let rows: [CommissionProposal]
    let total: Int
    let page: Int
    let pageSize: Int
}

/// A store's rate on the commission desk — its rate and nothing else about it.
struct CommissionStore: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let nameAr: String?
    let status: String
    let commissionPercent: String
    let commissionFixed: String?
}

struct CommissionStorePage: Decodable, Sendable {
    let rows: [CommissionStore]
    let total: Int
    let page: Int
    let pageSize: Int
}

/// `Shared/inventory/commissionProposals.ts`'s `proposalFigureProblem`: one
/// figure, a percentage up to 100 with two decimals or an amount in dinars
/// with three — so the form refuses what the API would.
enum ProposalRules {
    static let maxReason = 500
    static let maxDecisionNote = 400

    static func problem(percent: String?, fixed: String?) -> String? {
        let percent = percent?.trimmingCharacters(in: .whitespaces).nilIfEmpty
        let fixed = fixed?.trimmingCharacters(in: .whitespaces).nilIfEmpty
        if (percent == nil) == (fixed == nil) { return "commission.oneFigure" }
        if let percent {
            guard percent.range(of: #"^\d{1,3}(\.\d{1,2})?$"#, options: .regularExpression) != nil, let value = Double(percent), value <= 100 else {
                return "commission.badPercent"
            }
        }
        if let fixed, fixed.range(of: #"^\d{1,9}(\.\d{1,3})?$"#, options: .regularExpression) == nil {
            return "commission.badFixed"
        }
        return nil
    }
}

/// `storeAffiliateRate` (`Shared/commerce/affiliate.ts`): the rate a store
/// offers a product to affiliates at — above nothing, at most the ceiling,
/// two decimals — normalised, or nil when it is not one (3.7.1).
enum AffiliateRules {
    static func storeRate(_ text: String, ceiling: Double) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard trimmed.range(of: #"^\d{1,2}(\.\d{1,2})?$"#, options: .regularExpression) != nil, let value = Double(trimmed), value > 0, value <= ceiling else {
            return nil
        }
        return String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), value)
    }
}

extension API {
    struct ProposeCommission: Encodable, Sendable {
        let vendorId: Int
        let productId: OrNull<Int>
        let percent: OrNull<String>
        let fixed: OrNull<String>
        let reason: OrNull<String>
    }

    static let proposeCommission = Procedure<ProposeCommission, CommissionProposal>(mutation: "commission.propose")

    struct ProposalId: Encodable, Sendable {
        let proposalId: Int
    }

    static let withdrawProposal = Procedure<ProposalId, Acknowledged>(mutation: "commission.withdraw")

    struct ProposalQuery: Encodable, Sendable {
        var status: String?
        var vendorId: Int?
        var productId: Int?
        var page: Int?
    }

    static let commissionProposals = Procedure<ProposalQuery, CommissionProposalPage>(query: "commission.list")

    struct DecideProposal: Encodable, Sendable {
        let proposalId: Int
        let accept: Bool
        var note: String?
    }

    static let decideProposal = Procedure<DecideProposal, CommissionProposal>(mutation: "commission.decide")
    static let proposalsWaiting = Procedure<NoInput, Int>(query: "commission.waiting")

    struct CommissionStoreQuery: Encodable, Sendable {
        var query: String?
        var page: Int?
    }

    static let commissionStores = Procedure<CommissionStoreQuery, CommissionStorePage>(query: "commission.stores")

    struct ProductAffiliate: Encodable, Sendable {
        let productId: Int
        let percent: OrNull<String>
    }

    struct AffiliatePercent: Decodable, Sendable {
        let percent: String?
    }

    /// A store offering one of its products to affiliates at a rate it funds, or withdrawing it (3.7.1).
    static let setProductAffiliate = Procedure<ProductAffiliate, AffiliatePercent>(mutation: "affiliates.setProduct")
}
