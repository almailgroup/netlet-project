import Foundation

/// What NetLet's own desks read: the review queue, seller applications, the
/// people with accounts, the audit trail, the feature switchboard and the
/// standing orders — the web's admin-only pages, which the server refuses to
/// anybody else whatever the app offers.

// MARK: - Standing orders

struct SubscriptionOverview: Decodable, Sendable {
    let active: Int
    let paused: Int
    let due: Int
    /// Whether the daily run is set up (`CRON_SECRET`), or runs only by hand.
    let scheduled: Bool
}

struct SubscriptionRun: Decodable, Sendable {
    let due: Int
    let placed: Int
    let outOfStock: Int
    let paused: Int
}

// MARK: - The audit trail

/// A value in an audit row's before or after: whatever was written, read as
/// the text the web prints with `String(value)`.
enum AuditValue: Decodable, Hashable, Sendable {
    case text(String)
    case number(Double)
    case flag(Bool)
    case nothing
    case other

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .nothing }
        else if let value = try? container.decode(Bool.self) { self = .flag(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .text(value) }
        else { self = .other }
    }

    /// `String(value ?? "—")`, as the web's summary prints it.
    var shown: String {
        switch self {
        case .text(let value): return value
        case .number(let value): return value == value.rounded() && abs(value) < 1e15 ? String(Int(value)) : String(value)
        case .flag(let value): return value ? "true" : "false"
        case .nothing: return "—"
        case .other: return "…"
        }
    }
}

struct AuditEntry: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let action: String
    var subjectType: String? = nil
    var subjectLabel: String? = nil
    var actorEmail: String? = nil
    var actorRole: String? = nil
    var authorisedByEmail: String? = nil
    var before: [String: AuditValue]? = nil
    var after: [String: AuditValue]? = nil
    let createdAt: Date

    private enum CodingKeys: String, CodingKey {
        case id, action, subjectType, subjectLabel, actorEmail, actorRole, authorisedByEmail, before, after, createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        action = try container.decode(String.self, forKey: .action)
        subjectType = try container.decodeIfPresent(String.self, forKey: .subjectType)
        subjectLabel = try container.decodeIfPresent(String.self, forKey: .subjectLabel)
        actorEmail = try container.decodeIfPresent(String.self, forKey: .actorEmail)
        actorRole = try container.decodeIfPresent(String.self, forKey: .actorRole)
        authorisedByEmail = try container.decodeIfPresent(String.self, forKey: .authorisedByEmail)
        // A row's before and after are whatever the act wrote; anything that
        // is not an object of values is simply not summarised.
        before = try? container.decodeIfPresent([String: AuditValue].self, forKey: .before)
        after = try? container.decodeIfPresent([String: AuditValue].self, forKey: .after)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
    }

    /// The first of the fields a person reads that changed (`summarise`).
    var change: (field: String, from: String, to: String)? {
        let b = before ?? [:]
        let a = after ?? [:]
        for key in ["status", "role", "price", "commissionPercent", "commissionFixed"] where a[key] != nil || b[key] != nil {
            let from = b[key]?.shown ?? "—"
            let to = a[key]?.shown ?? "—"
            if from == to { continue }
            return (key, from, to)
        }
        return nil
    }

    /// Written by the shop itself — a scheduled run, an automatic decision.
    var automatic: Bool { after?["automatic"] == .flag(true) }
}

// MARK: - The switchboard

struct FeatureSwitch: Decodable, Identifiable, Hashable, Sendable {
    /// Why a switch that reads on may still show nothing (`readinessOf`).
    struct Why: Decodable, Hashable, Sendable {
        /// "blocked" or "note".
        let kind: String
        let reason: String
    }

    let key: String
    let enabled: Bool
    var updatedAt: Date? = nil
    var updatedByEmail: String? = nil
    var why: Why? = nil

    var id: String { key }
}

// MARK: - People

struct PortalPerson: Decodable, Identifiable, Hashable, Sendable {
    struct Membership: Decodable, Hashable, Sendable {
        let vendorId: Int
        let vendorName: String
        let role: String
    }

    let id: Int
    let email: String
    var name: String? = nil
    /// "admin" or "user".
    let role: String
    var lastSignedIn: Date? = nil
    let createdAt: Date
    let vendors: [Membership]
    /// Capabilities granted on their own (3.3.9): "vendor.setCommission".
    var grants: [String]? = nil

    var shownName: String { (name?.isEmpty == false ? name : nil) ?? email }
}

struct PeoplePage: Decodable, Sendable {
    let rows: [PortalPerson]
    let total: Int
    let page: Int
    let pageSize: Int
}

// MARK: - Seller applications

/// An application waiting on an administrator, with who sent it and how many
/// of its papers nobody has decided yet.
struct PendingApplication: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let storeName: String
    var contactEmail: String? = nil
    var contactPhone: String? = nil
    var governorate: String? = nil
    var addressLine: String? = nil
    var licenceNumber: String? = nil
    var licenceDocUrl: String? = nil
    var identityDocUrl: String? = nil
    var payoutIban: String? = nil
    let underPlatformLicence: Bool
    var proposedCommissionPercent: String? = nil
    /// A fixed amount per sale proposed instead of a percentage (3.3.2).
    var proposedCommissionFixed: String? = nil
    var commissionNote: String? = nil
    var agreementVersion: String? = nil
    let status: String
    let createdAt: Date
    var applicantEmail: String? = nil
    var documentsWaiting: Int = 0

    /// What approving still needs, as the form's labels (`missingFromApplication`):
    /// the agreement accepted to *this* version, since a term added since is
    /// not something they agreed to.
    func missing(currentAgreement: String) -> [String] {
        func blank(_ value: String?) -> Bool { (value ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
        var found: [String] = []
        if blank(contactEmail) { found.append("sell.fieldEmail") }
        if blank(contactPhone) { found.append("sell.fieldPhone") }
        if blank(governorate) { found.append("sell.fieldGovernorate") }
        if blank(addressLine) { found.append("sell.fieldAddress") }
        if blank(payoutIban) { found.append("sell.fieldIban") }
        if !underPlatformLicence && blank(licenceNumber) { found.append("sell.fieldLicence") }
        if agreementVersion != currentAgreement { found.append("sell.fieldAgreement") }
        return found
    }

    /// A link an administrator will open is a web address or nothing.
    static func webAddress(_ value: String?) -> URL? {
        guard let value, value.range(of: #"^https?://\S+$"#, options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
        return URL(string: value)
    }
}

struct ApplicationPage: Decodable, Sendable {
    let rows: [PendingApplication]
    let total: Int
    let page: Int
    let pageSize: Int
}

// MARK: - The review queue

struct ReviewFlag: Decodable, Hashable, Sendable {
    let finding: String
    /// "serious" or "minor".
    let severity: String
    var detail: String? = nil

    var label: String {
        switch finding {
        case "noImages": return "admin.flagNoImages"
        case "zeroPrice": return "admin.flagZeroPrice"
        case "noCategory": return "admin.flagNoCategory"
        case "thinDescription": return "admin.flagThinDescription"
        case "contactInText": return "admin.flagContactInText"
        case "shoutingTitle": return "admin.flagShoutingTitle"
        case "bannedClaim": return "admin.flagBannedClaim"
        default: return "admin.flagModelConcern"
        }
    }
}

struct ReviewedProduct: Decodable, Sendable {
    let productId: Int
    let flags: [ReviewFlag]
    let attention: Bool
}

struct ModelFlagAnswer: Decodable, Sendable {
    var flag: ReviewFlag? = nil
    let available: Bool
}

/// A number an administrator sets without a deploy (`features.settings`):
/// the referral programme's two rates (3.1.15), each inside its range.
struct PlatformSetting: Decodable, Sendable {
    let key: String
    let value: String
    let defaultValue: String
    let min: Double
    let max: Double
    var updatedAt: Date? = nil
    var updatedByEmail: String? = nil

    var minText: String { min == min.rounded() ? "\(Int(min))" : "\(min)" }
    var maxText: String { max == max.rounded() ? "\(Int(max))" : "\(max)" }

    /// `normaliseSetting`: a percentage, two decimals at most, inside the range — or nil.
    func normalise(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard trimmed.range(of: #"^\d{1,3}(\.\d{1,2})?$"#, options: .regularExpression) != nil, let number = Double(trimmed), number >= min, number <= max else { return nil }
        return String(format: "%.2f", locale: Locale(identifier: "en_US_POSIX"), number)
    }
}

struct Availability: Decodable, Sendable {
    let available: Bool
}

extension API {
    static let subscriptionOverview = Procedure<NoInput, SubscriptionOverview>(query: "subscriptions.overview")
    static let runDueSubscriptions = Procedure<NoInput, SubscriptionRun>(mutation: "subscriptions.runDue")

    static let auditTrail = Procedure<Limit, [AuditEntry]>(query: "inventory.audit")
    static let markAuditSeen = Procedure<NoInput, Acknowledged>(mutation: "inventory.markAuditSeen")

    static let featureSwitches = Procedure<NoInput, [FeatureSwitch]>(query: "features.list")

    struct SetFeature: Encodable, Sendable {
        let key: String
        let enabled: Bool
    }

    static let setFeature = Procedure<SetFeature, Acknowledged>(mutation: "features.set")

    static let platformSettings = Procedure<NoInput, [PlatformSetting]>(query: "features.settings")

    struct SetSetting: Encodable, Sendable {
        let key: String
        let value: String
    }

    static let setPlatformSetting = Procedure<SetSetting, Acknowledged>(mutation: "features.setSetting")

    struct PeopleQuery: Encodable, Sendable {
        var query: String?
        var page: Int?
    }

    static let people = Procedure<PeopleQuery, PeoplePage>(query: "inventory.people.list")

    struct SetAdmin: Encodable, Sendable {
        let userId: Int
        let isAdmin: Bool
    }

    static let setAdmin = Procedure<SetAdmin, Acknowledged>(mutation: "inventory.people.setAdmin")

    struct AddByEmail: Encodable, Sendable {
        let vendorId: Int
        let email: String
        let role: String
    }

    static let addToVendor = Procedure<AddByEmail, Acknowledged>(mutation: "inventory.people.addToVendor")

    struct VendorMember: Encodable, Sendable {
        let vendorId: Int
        let userId: Int
    }

    static let removeFromVendor = Procedure<VendorMember, Acknowledged>(mutation: "inventory.people.removeFromVendor")

    struct SetGrant: Encodable, Sendable {
        let userId: Int
        let capability: String
        let granted: Bool
    }

    /// One capability granted on its own, or taken back (3.3.9).
    static let setGrant = Procedure<SetGrant, Acknowledged>(mutation: "inventory.people.setGrant")

    struct ApplicationQuery: Encodable, Sendable {
        var status: String?
        var page: Int?
    }

    static let pendingApplications = Procedure<ApplicationQuery, ApplicationPage>(query: "inventory.applications.list")

    struct ApplicationId: Encodable, Sendable {
        let applicationId: Int
    }

    static let reviewerDocuments = Procedure<ApplicationId, [ApplicationDocument]>(query: "inventory.applications.documents")

    struct DocumentDecision: Encodable, Sendable {
        let id: Int
        let decision: String
        var note: String?
    }

    /// Answers the document's new status, "accepted" or "rejected".
    static let reviewDocument = Procedure<DocumentDecision, String>(mutation: "inventory.applications.reviewDocument")

    struct Approval: Encodable, Sendable {
        let id: Int
        /// The store's rate; the standard one when absent.
        var commissionPercent: String?
        /// A fixed amount per sale, beside the rate or instead of it (3.3.2).
        var commissionFixed: String?
    }

    static let approveApplication = Procedure<Approval, Acknowledged>(mutation: "inventory.applications.approve")

    struct Rejection: Encodable, Sendable {
        let id: Int
        let reason: String
    }

    static let rejectApplication = Procedure<Rejection, Acknowledged>(mutation: "inventory.applications.reject")

    struct ReviewIds: Encodable, Sendable {
        let ids: [Int]
    }

    static let reviewFlags = Procedure<ReviewIds, [ReviewedProduct]>(query: "inventory.products.flags")
    static let modelReviewAvailable = Procedure<NoInput, Availability>(query: "inventory.products.modelReviewAvailable")
    static let modelFlag = Procedure<RowId, ModelFlagAnswer>(mutation: "inventory.products.modelFlag")

    struct ReviewDecision: Encodable, Sendable {
        let id: Int
        let approve: Bool
        var note: String?
    }

    static let reviewProduct = Procedure<ReviewDecision, Acknowledged>(mutation: "inventory.products.review")
}

// MARK: - Fraud watch

/// A review on NetLet's fraud watch (`orders.reviewWatch`): what was written,
/// by whom, and each thing the shared rules noticed about it (3.6.5).
struct ReviewWatchRow: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    var productId: Int? = nil
    let productTitle: String
    let rating: Int
    var title: String? = nil
    var body: String? = nil
    var reviewerEmail: String? = nil
    let createdAt: Date
    let hidden: Bool
    var hiddenReason: String? = nil
    let risk: String
    let flags: [OrderRisk.Flag]
}

/// A referral on the fraud watch (`orders.referralWatch`): who invited whom,
/// whether the points were paid, and what looks like one person twice.
struct ReferralWatchRow: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    var referrerEmail: String? = nil
    var referredEmail: String? = nil
    let createdAt: Date
    var qualifiedAt: Date? = nil
    let risk: String
    let flags: [OrderRisk.Flag]
}

extension API {
    static let reviewWatch = Procedure<NoInput, [ReviewWatchRow]>(query: "orders.reviewWatch")
    static let referralWatch = Procedure<NoInput, [ReferralWatchRow]>(query: "orders.referralWatch")

    struct HideReview: Encodable, Sendable {
        let reviewId: Int
        let hidden: Bool
        var reason: String? = nil
    }

    static let setReviewHidden = Procedure<HideReview, Acknowledged>(mutation: "reviews.setHidden")
}
