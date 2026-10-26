import Foundation

/// One of NetLet's departments (`Shared/commerce/departments.ts`).
struct Department: Decodable, Identifiable, Hashable, Sendable {
    let slug: String
    let name: String
    let nameAr: String
    let position: Int
    /// The dictionary key of its name, so it reads the way the web spells it.
    let label: String
    let icon: String

    var id: String { slug }

    /// An SF Symbol standing in for the web's icon of the same name.
    var symbol: String {
        switch icon {
        case "plug": return "powerplug"
        case "cooking-pot": return "frying.pan"
        case "flower": return "camera.macro"
        case "shirt": return "tshirt"
        case "carrot": return "carrot"
        default: return "square.grid.2x2"
        }
    }

    /// The department's art on the site, the same file the web's tiles draw.
    var artPath: String { "/departments/\(slug).webp" }
}

/// A governorate the shop delivers to (`kuwaitDeliveryZones` in `Shared/customer.ts`).
struct Governorate: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let label: String
    let labelAr: String

    func name(_ language: Language) -> String { language == .ar ? labelAr : label }
}

/// An area of a governorate, in both languages; the English name is the stored value.
struct Area: Decodable, Hashable, Sendable {
    let en: String
    let ar: String

    func name(_ language: Language) -> String { language == .ar ? ar : en }
}

/// The rules the app holds a form to before the server does — the same
/// constants the web and the server import, exported to `rules.json`.
struct Rules: Decodable, Sendable {
    struct Listing: Decodable, Sendable {
        let maxTitle: Int
        let maxSku: Int
        let maxStock: Int
        let maxDescription: Int
        let maxPhotos: Int
        let warrantyRequiredDepartments: [String]
    }

    struct Media: Decodable, Sendable {
        let maxEdge: Int
        let minEdge: Int
        let maxUploadBytes: Int
    }

    /// The shop's own contact details (`NETLET_CONTACT`), the footer's defaults.
    struct Contact: Decodable, Sendable {
        let phone: String
        let email: String
        let address: String
        let addressAr: String
    }

    /// What the account's sections hold a form to, and the choices they offer.
    struct Account: Decodable, Sendable {
        /// One kind of notice a shopper can switch off (`notificationKinds`).
        struct NoticeKind: Decodable, Hashable, Sendable {
            let kind: String
            /// The dictionary key of its name.
            let label: String
            let enabledByDefault: Bool
        }

        let maxAddresses: Int
        let maxAddressLabel: Int
        let maxAddressLine: Int
        let maxAddressNotes: Int
        let notificationKinds: [NoticeKind]
        /// The params of a notice that hold an amount, drawn as money.
        let moneyParams: [String]
        let supportTopics: [String]
        let maxSupportMessage: Int
        let maxOpenConversations: Int
        let ratingMax: Int
        let maxReviewTitle: Int
        let maxReviewBody: Int
        let attributionDays: Int
        let minAffiliatePayoutFils: Int
        let minCashOutPoints: Int
        let maxLists: Int
        let maxListItems: Int
        let claimHoldDays: Int
        let askWindowDays: Int
        let offerWindowDays: Int
        let maxOfferNote: Int
        let subscriptionIntervals: [Int]

        static let fallback = Account(
            maxAddresses: 12, maxAddressLabel: 40, maxAddressLine: 300, maxAddressNotes: 300,
            notificationKinds: [
                .init(kind: "price_drop", label: "notification.priceDrop", enabledByDefault: true),
                .init(kind: "bag_reminder", label: "notification.bagReminder", enabledByDefault: false),
                .init(kind: "new_arrival", label: "notification.newArrival", enabledByDefault: true),
                .init(kind: "delivery_update", label: "notification.deliveryUpdate", enabledByDefault: true),
            ],
            moneyParams: ["price", "amount", "total"],
            supportTopics: ["order", "delivery", "return", "payment", "account", "other"],
            maxSupportMessage: 2000, maxOpenConversations: 5, ratingMax: 5, maxReviewTitle: 120, maxReviewBody: 2000,
            attributionDays: 30, minAffiliatePayoutFils: 5000, minCashOutPoints: 1000, maxLists: 12, maxListItems: 200,
            claimHoldDays: 14, askWindowDays: 7, offerWindowDays: 3, maxOfferNote: 400,
            subscriptionIntervals: [1, 2, 4, 8]
        )
    }

    /// What an order's own forms are held to: a return, a delivery rating and
    /// a damage claim (`returnRequests.ts`, `deliveryRatings.ts`, `damageClaims.ts`).
    struct Orders: Decodable, Sendable {
        let returnKinds: [String]
        let returnReasons: [String]
        let openReturnStatuses: [String]
        let maxReturnNote: Int
        let ratingWindowDays: Int
        let maxDeliveryComment: Int
        let claimWindowDays: Int
        let maxClaimDescription: Int
        /// What one referral point is worth spent, in fils (`FILS_PER_POINT`).
        let filsPerPoint: Int

        static let fallback = Orders(
            returnKinds: ["refund", "exchange"],
            returnReasons: ["damaged", "defective", "wrongItem", "notAsDescribed", "tooSmall", "tooLarge", "changedMind", "other"],
            openReturnStatuses: ["requested", "review", "approved", "collected"],
            maxReturnNote: 1000, ratingWindowDays: 30, maxDeliveryComment: 500, claimWindowDays: 7, maxClaimDescription: 2000,
            filsPerPoint: 1
        )
    }

    /// What the assistants send the gateway and how much (`Shared/ai/gateway.ts`,
    /// `Shared/commerce/assistant.ts`, `Shared/commerce/photoSearch.ts`).
    struct AI: Decodable, Sendable {
        let chatPath: String
        let maxChatTurns: Int
        let maxChatText: Int
        let maxQuestion: Int
        let maxBriefDescription: Int
        let maxSpecRows: Int
        let maxSuggestions: Int
        /// The two questions a department's shoppers ask first, as message keys.
        let departmentQuestions: [String: [String]]
        let photoMaxEdge: Int
        let maxPhotoChars: Int
        /// "Generate with AI" (`GATEWAY_ROUTES.catalog`, `MAX_NOTES`, `MAX_IMAGES`).
        var catalogPath = "/api/ai/catalog-assist"
        var maxNotes = 4000
        var maxDraftImages = 3

        static let fallback = AI(
            chatPath: "/api/ai/chat", maxChatTurns: 12, maxChatText: 1000, maxQuestion: 300,
            maxBriefDescription: 1500, maxSpecRows: 24, maxSuggestions: 4, departmentQuestions: [:],
            photoMaxEdge: 768, maxPhotoChars: 240_000
        )
    }

    /// The session cookie's name (`COOKIE_NAME` in `Shared/const.ts`).
    let sessionCookie: String
    let maxLineQuantity: Int
    let returnWindowDays: Int
    let listing: Listing
    let media: Media
    let contact: Contact?
    let account: Account?
    let orders: Orders?
    let ai: AI?
    /// The floor on a password being set (`MIN_PASSWORD_LENGTH`), the server's own.
    var minPasswordLength: Int? = nil

    /// The password floor, or the same number when the file predates it.
    var passwordFloor: Int { minPasswordLength ?? 8 }

    /// The account's rules, or the same numbers when the file predates them.
    var accountRules: Account { account ?? .fallback }
    var orderRules: Orders { orders ?? .fallback }
    var aiRules: AI { ai ?? .fallback }
}

/// Everything the app reads from `Shared/` rather than from the network: the
/// departments, Kuwait's governorates and areas, and the form rules. Generated
/// by `Frontend/iOS/scripts/exportShared.ts`; a stale copy fails the web's tests.
struct ReferenceData: Sendable {
    private struct Kuwait: Decodable {
        let governorates: [Governorate]
        let areas: [String: [Area]]
        let requiredParts: [String]
        let partMax: [String: Int]
        let partLabels: [String: [String: String]]?
        let bounds: Bounds?
        let centre: Pin?
        let governorateCentres: [String: Pin]?
    }

    /// The rectangle a pin must fall in to be in Kuwait (`KUWAIT_BOUNDS`).
    struct Bounds: Decodable, Sendable {
        let south: Double
        let north: Double
        let west: Double
        let east: Double

        func contains(_ pin: Pin) -> Bool {
            pin.lat >= south && pin.lat <= north && pin.lng >= west && pin.lng <= east
        }
    }

    let departments: [Department]
    let governorates: [Governorate]
    let areas: [String: [Area]]
    let requiredParts: [String]
    let partMax: [String: Int]
    /// The words an address line is composed with, per language (`PART_LABEL_EN`).
    let partLabels: [String: [String: String]]
    let bounds: Bounds
    let centre: Pin
    let governorateCentres: [String: Pin]
    let rules: Rules

    static let shared: ReferenceData = load(from: .main)

    static func load(from bundle: Bundle) -> ReferenceData {
        let decoder = JSONDecoder()
        let departments = (try? decoder.decode([Department].self, from: bundle.resource("departments", "json"))) ?? []
        let kuwait = try? decoder.decode(Kuwait.self, from: bundle.resource("kuwait", "json"))
        let rules = (try? decoder.decode(Rules.self, from: bundle.resource("rules", "json"))) ?? Rules(
            sessionCookie: "app_session_id",
            maxLineQuantity: 99,
            returnWindowDays: 14,
            listing: .init(maxTitle: 255, maxSku: 120, maxStock: 1_000_000, maxDescription: 20_000, maxPhotos: 12, warrantyRequiredDepartments: ["electronics"]),
            media: .init(maxEdge: 1200, minEdge: 300, maxUploadBytes: 1_500_000),
            contact: nil,
            account: nil,
            orders: nil,
            ai: nil
        )
        return ReferenceData(
            departments: departments.sorted { $0.position < $1.position },
            governorates: kuwait?.governorates ?? [],
            areas: kuwait?.areas ?? [:],
            requiredParts: kuwait?.requiredParts ?? ["area", "block", "street", "building"],
            partMax: kuwait?.partMax ?? [:],
            partLabels: kuwait?.partLabels ?? [:],
            bounds: kuwait?.bounds ?? Bounds(south: 28.5, north: 30.15, west: 46.5, east: 48.6),
            centre: kuwait?.centre ?? Pin(lat: 29.3759, lng: 47.9774),
            governorateCentres: kuwait?.governorateCentres ?? [:],
            rules: rules
        )
    }

    func department(slug: String?) -> Department? {
        departments.first { $0.slug == slug }
    }

    /// A product's department, by the catalogue name it carries (`productType`).
    func department(named name: String?) -> Department? {
        guard let name else { return nil }
        return departments.first { $0.name.caseInsensitiveCompare(name) == .orderedSame || $0.nameAr == name }
    }

    /// An area's name in the page's language, by its stored English name.
    func areaName(_ stored: String, language: Language) -> String {
        for list in areas.values { if let area = list.first(where: { $0.en == stored }) { return area.name(language) } }
        return stored
    }

    func governorate(id: String?) -> Governorate? {
        governorates.first { $0.id == id }
    }

    /// The governorate an area belongs to, so choosing an area can choose it too.
    func governorate(ofArea area: String?) -> String? {
        guard let area else { return nil }
        return areas.first(where: { $0.value.contains { $0.en == area } })?.key
    }
}
