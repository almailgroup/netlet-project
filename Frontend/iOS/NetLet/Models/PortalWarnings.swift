import Foundation

/// A warning NetLet issued a store (`warnings.list`, 3.3.18).
struct StoreWarning: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let reason: String
    let productId: Int?
    let productTitle: String?
    let productTitleAr: String?
    let createdAt: Date
    let expiresAt: Date
    let withdrawnAt: Date?
    /// standing, lapsed, withdrawn, or cleared (before the store was reinstated).
    let state: String
    /// Who issued it — NetLet's own people see it, never the store.
    let issuedBy: String?
}

struct StoreWarnings: Decodable, Sendable {
    let rows: [StoreWarning]
    let standing: Int
    let suspendAt: Int
}

/// `Shared/inventory/warnings.ts`: how long a warning stands, how many
/// suspend, and what a reason must be.
struct WarningRules {
    let days = 365
    let suspendAt = 3
    let maxReason = 400

    func reasonProblem(_ reason: String) -> String? {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "warnings.needsReason" }
        if trimmed.count > maxReason { return "warnings.tooLong" }
        return nil
    }
}

extension API {
    struct WarningScope: Encodable, Sendable {
        var vendorId: Int?
    }

    static let storeWarnings = Procedure<WarningScope, StoreWarnings>(query: "warnings.list")

    struct IssueWarning: Encodable, Sendable {
        let vendorId: Int
        let productId: Int?
        let reason: String
    }

    struct WarningIssued: Decodable, Sendable {
        let id: Int
        let standing: Int
        let suspended: Bool
    }

    static let issueWarning = Procedure<IssueWarning, WarningIssued>(mutation: "warnings.issue")

    struct WarningId: Encodable, Sendable {
        let warningId: Int
    }

    struct WarningCount: Decodable, Sendable {
        let standing: Int
    }

    static let withdrawWarning = Procedure<WarningId, WarningCount>(mutation: "warnings.withdraw")
}
