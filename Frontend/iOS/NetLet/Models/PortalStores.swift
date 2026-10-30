import Foundation

/// The stores on NetLet as an administrator reads them — the web's
/// `/admin/vendors`, `/admin/vendors/new` and `/admin/vendors/:id` — and the
/// small rules those pages ask before the server does
/// (`Shared/inventory/storeProfile.ts`, `discountLicence.ts`).
enum StoreRules {
    /// A store name as a web address (`storeSlug`): an unusable name gives
    /// an empty one, which the form asks about rather than inventing.
    static func slug(_ name: String) -> String {
        var text = name.lowercased().replacingOccurrences(of: "&", with: " and ")
        text = text.replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
        return text.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    }

    /// An IBAN as it is checked and saved (`normaliseIban`): no spaces or
    /// hyphens, upper case, and in a Kuwaiti one the four-letter bank code read
    /// as letters, so "NB0K" typed for the National Bank is NBOK. Nowhere
    /// else: in the rest of an IBAN a digit is a digit.
    static func normaliseIban(_ raw: String) -> String {
        let iban = raw.replacingOccurrences(of: "[\\s-]", with: "", options: .regularExpression).uppercased()
        guard iban.hasPrefix("KW"), iban.count >= 8 else { return iban }
        let bank = String(iban.dropFirst(4).prefix(4))
            .replacingOccurrences(of: "0", with: "O")
            .replacingOccurrences(of: "1", with: "I")
        return String(iban.prefix(4)) + bank + String(iban.dropFirst(8))
    }

    /// The IBAN as it will be saved, when that is not what was typed beyond
    /// its spaces and case (`ibanReadAs`), for the form to say.
    static func ibanReadAs(_ raw: String) -> String? {
        let plain = raw.replacingOccurrences(of: "[\\s-]", with: "", options: .regularExpression).uppercased()
        let read = normaliseIban(raw)
        return read != plain ? read : nil
    }

    /// IBAN check digits by the mod-97 rule (`isValidIban`): a transposed
    /// pair passes any length check and sends money nowhere.
    static func isValidIban(_ raw: String) -> Bool {
        let iban = normaliseIban(raw)
        guard iban.range(of: "^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$", options: .regularExpression) != nil else { return false }
        let rearranged = iban.dropFirst(4) + iban.prefix(4)
        var remainder = 0
        for character in rearranged {
            guard let ascii = character.asciiValue else { return false }
            if ascii >= 65 && ascii <= 90 {
                remainder = (remainder * 100 + Int(ascii) - 55) % 97
            } else {
                remainder = (remainder * 10 + Int(ascii) - 48) % 97
            }
        }
        return remainder == 1
    }

    /// Eight digits, optionally after +965 (`isValidKuwaitPhone`).
    static func isValidKuwaitPhone(_ raw: String) -> Bool {
        let digits = raw.replacingOccurrences(of: "[\\s()-]", with: "", options: .regularExpression)
        return digits.range(of: "^(\\+?965)?[0-9]{8}$", options: .regularExpression) != nil
    }

    /// What a store still lacks, as the form's labels, in the form's order
    /// (`missingStoreDetails`) — said, never refused.
    static func missing(email: String?, phone: String?, governorate: String?, address: String?, licence: String?, iban: String?) -> [String] {
        func blank(_ value: String?) -> Bool { (value ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
        return [
            ("admin.contactEmail", email), ("admin.contactPhone", phone), ("admin.governorate", governorate),
            ("admin.addressLine", address), ("admin.licenceNumber", licence), ("admin.payoutIban", iban),
        ]
        .filter { blank($0.1) }
        .map(\.0)
    }

    /// The discount permit's state in words (`discountAllowed`): a number and
    /// an end date in the future, a number with no end date, an expired one,
    /// or none.
    enum Permit: Equatable {
        case valid(Date)
        case noExpiry
        case expired(Date)
        case missing
    }

    static func permit(number: String?, expiresAt: Date?, now: Date = Date()) -> Permit {
        guard let number, !number.trimmingCharacters(in: .whitespaces).isEmpty else { return .missing }
        guard let expiresAt else { return .noExpiry }
        return expiresAt < now ? .expired(expiresAt) : .valid(expiresAt)
    }

    /// The Kuwaiti day a moment falls on, as the date box holds it.
    static func kuwaitDay(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func statusKey(_ status: String) -> String {
        switch status {
        case "approved": return "vendorStatus.approved"
        case "suspended": return "vendorStatus.suspended"
        default: return "vendorStatus.pending"
        }
    }

    static func statusTone(_ status: String) -> String {
        switch status {
        case "approved": return "good"
        case "suspended": return "danger"
        default: return "warning"
        }
    }

    static func badgeKey(_ badge: String) -> String {
        switch badge {
        case "verified": return "badge.verified"
        case "highRating": return "badge.highRating"
        default: return "badge.fastShipping"
        }
    }

    static func roleWhat(_ role: String) -> String {
        switch role {
        case "owner": return "admin.roleOwnerWhat"
        case "manager": return "admin.roleManagerWhat"
        default: return "admin.roleStaffWhat"
        }
    }

    static let statuses = ["pending", "approved", "suspended"]
}

extension PortalRules {
    /// The badge a person awards and the floors the measured ones are earned
    /// by (`vendorHealth.ts`).
    struct BadgeRules: Decodable, Sendable {
        let awarded: [String]
        let highRatingFloor: Double
        let highRatingMinReviews: Int
        let fastShare: Double
        let fastHours: Int
        let fastWindowDays: Int
        let fastMinDeliveries: Int
    }
}

/// A store in the list, with its shelf, its team and its rate.
struct StoreListRow: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let slug: String
    let name: String
    let status: String
    let commissionPercent: String
    var logoUrl: String? = nil
    var contactEmail: String? = nil
    var contactPhone: String? = nil
    var governorate: String? = nil
    var addressLine: String? = nil
    var licenceNumber: String? = nil
    var payoutIban: String? = nil
    var productCount: Int = 0
    var liveCount: Int = 0
    var memberCount: Int = 0

    var missing: [String] {
        StoreRules.missing(email: contactEmail, phone: contactPhone, governorate: governorate, address: addressLine, licence: licenceNumber, iban: payoutIban)
    }
}

struct StoreListPage: Decodable, Sendable {
    let rows: [StoreListRow]
    let total: Int
    let page: Int
    let pageSize: Int
    /// How many stores each status holds, before it is pressed.
    var counts: [String: Int] = [:]
}

/// One store whole, with its figures.
struct StoreDetail: Decodable, Sendable {
    struct Stats: Decodable, Sendable {
        let products: Int
        let live: Int
        let inReview: Int
        let drafts: Int
        let members: Int
    }

    let id: Int
    let slug: String
    let name: String
    var nameAr: String? = nil
    let status: String
    let commissionPercent: String
    var commissionFixed: String? = nil
    let autoPublish: Bool
    var discountLicenceNumber: String? = nil
    var discountLicenceExpiresAt: Date? = nil
    var deliveryFlat: String? = nil
    var deliveryFreeOver: String? = nil
    var deliverySpeed: String? = nil
    var deliveryProvider: String? = nil
    /// The fast trip (3.2.5): its own fee and band; nil is no fast option.
    var fastDeliveryFee: String? = nil
    var fastDeliverySpeed: String? = nil
    /// Who carries the store's parcels (3.3.13): "netlet", or "own" with its company.
    var deliveryMode: String? = nil
    var deliveryCourierId: Int? = nil
    var underPlatformLicence: Bool? = nil
    var acceptsCod: Bool? = nil
    var codCeiling: String? = nil
    var subscriptionPercent: String? = nil
    var badges: [String]? = nil
    var contactEmail: String? = nil
    var contactPhone: String? = nil
    var description: String? = nil
    var descriptionAr: String? = nil
    var logoUrl: String? = nil
    var governorate: String? = nil
    var addressLine: String? = nil
    var licenceNumber: String? = nil
    var payoutIban: String? = nil
    let stats: Stats

    var missing: [String] {
        StoreRules.missing(email: contactEmail, phone: contactPhone, governorate: governorate, address: addressLine, licence: licenceNumber, iban: payoutIban)
    }

    /// Only the badge a person awards is read from the row (`awardedBadges`).
    var awarded: [String] {
        let allowed = PortalRules.shared.badges?.awarded ?? ["verified"]
        return (badges ?? []).filter(allowed.contains)
    }
}

struct CreatedStore: Decodable, Sendable {
    struct Vendor: Decodable, Sendable {
        let id: Int
    }

    let vendor: Vendor
}

struct ResetSent: Decodable, Sendable {
    let sent: Bool
    var email: String? = nil
}

extension API {
    struct StoreQuery: Encodable, Sendable {
        var page: Int?
        var query: String?
        var status: String?
        var pageSize: Int?
    }

    static let storeList = Procedure<StoreQuery, StoreListPage>(query: "inventory.vendors.list")
    static let storeDetail = Procedure<StoreId, StoreDetail?>(query: "inventory.vendors.get")

    /// One section's fields: a key left out is not touched, and an emptied
    /// box is sent as null so the server clears it.
    struct StorePatch: Encodable, Sendable {
        let vendorId: Int
        var name: String?
        var nameAr: OrNull<String>?
        var logoUrl: OrNull<String>?
        var description: OrNull<String>?
        var descriptionAr: OrNull<String>?
        var contactEmail: OrNull<String>?
        var contactPhone: OrNull<String>?
        var governorate: OrNull<String>?
        var addressLine: OrNull<String>?
        var licenceNumber: OrNull<String>?
        var underPlatformLicence: Bool?
        var discountLicenceNumber: OrNull<String>?
        /// A bare day, which the server reads as the end of that Kuwaiti day.
        var discountLicenceExpiresAt: OrNull<String>?
        var deliverySpeed: OrNull<String>?
        var deliveryFlat: OrNull<String>?
        var deliveryFreeOver: OrNull<String>?
        var deliveryProvider: OrNull<String>?
        var fastDeliveryFee: OrNull<String>?
        var fastDeliverySpeed: OrNull<String>?
        var deliveryMode: String?
        var deliveryCourierId: OrNull<Int>?
        var acceptsCod: Bool?
        var codCeiling: OrNull<String>?
        var subscriptionPercent: OrNull<String>?
        var payoutIban: OrNull<String>?
    }

    static let updateStore = Procedure<StorePatch, Acknowledged>(mutation: "inventory.vendors.updateProfile")

    struct StoreStatus: Encodable, Sendable {
        let vendorId: Int
        let status: String
    }

    static let setStoreStatus = Procedure<StoreStatus, Acknowledged>(mutation: "inventory.vendors.setStatus")

    struct StoreAutoPublish: Encodable, Sendable {
        let vendorId: Int
        let autoPublish: Bool
    }

    static let setStoreAutoPublish = Procedure<StoreAutoPublish, Acknowledged>(mutation: "inventory.vendors.setAutoPublish")

    struct StoreCommission: Encodable, Sendable {
        let vendorId: Int
        let percent: String
        let fixed: OrNull<String>
    }

    static let setStoreCommission = Procedure<StoreCommission, Acknowledged>(mutation: "inventory.vendors.setCommission")

    struct BadgeChoice: Encodable, Sendable {
        let vendorId: Int
        let badges: [String]
    }

    static let setStoreBadges = Procedure<BadgeChoice, Acknowledged>(mutation: "inventory.vendors.setBadges")

    struct NewLogin: Encodable, Sendable {
        let vendorId: Int
        let email: String
        let password: String
        let name: String?
        let role: String
    }

    static let addNewMember = Procedure<NewLogin, Acknowledged>(mutation: "inventory.vendors.addNewMember")

    struct ResetFor: Encodable, Sendable {
        let userId: Int
        let locale: String
    }

    static let sendMemberReset = Procedure<ResetFor, ResetSent>(mutation: "inventory.vendors.sendPasswordReset")

    struct NewStore: Encodable, Sendable {
        struct Owner: Encodable, Sendable {
            let email: String
            let password: String
            let name: String?
            let role: String
        }

        let name: String
        let slug: String
        let status: String
        let commissionPercent: String
        let commissionFixed: String?
        let autoPublish: Bool
        let nameAr: String?
        let contactEmail: String?
        let contactPhone: String?
        let governorate: String?
        let addressLine: String?
        let licenceNumber: String?
        let payoutIban: String?
        let description: String?
        let descriptionAr: String?
        let logoUrl: String?
        let owner: Owner?
    }

    static let createStore = Procedure<NewStore, CreatedStore>(mutation: "inventory.vendors.create")
}
