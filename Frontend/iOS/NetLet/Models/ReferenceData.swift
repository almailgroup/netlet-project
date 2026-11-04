import Foundation
import UIKit

/// One of NetLet's departments (`Shared/commerce/departments.ts`).
struct Department: Decodable, Identifiable, Hashable, Sendable {
    let slug: String
    let name: String
    let nameAr: String
    let position: Int
    /// The dictionary key of its name, so it reads the way the web spells it.
    let label: String
    let icon: String
    /// Its subcategories by name, in the order the Categories tab lists them
    /// (`Shared/commerce/subcategories.ts`); the server files each product.
    let subcategories: [Subcategory]?

    struct Subcategory: Decodable, Identifiable, Hashable, Sendable {
        let slug: String
        let name: String
        let nameAr: String
        /// What its row on the Categories tab shows (`SUBCATEGORY_ICONS`), a
        /// name the app turns into an SF Symbol.
        let icon: String?

        var id: String { slug }
        func shown(_ language: Language) -> String { language == .ar ? nameAr : name }

        /// The SF Symbols that stand for its icon, the likeliest first: the
        /// first one this iOS has is drawn (`symbol`), and a test holds that
        /// every icon has one.
        var symbolCandidates: [String] { Self.symbols[icon ?? ""] ?? [] }

        /// The first of `symbolCandidates` this iOS draws, or the grid.
        var symbol: String {
            symbolCandidates.first { UIImage(systemName: $0) != nil } ?? "square.grid.2x2"
        }

        /// The web's `SubcategoryIcon` drawings, in SF Symbols.
        static let symbols: [String: [String]] = [
            "phone": ["iphone"],
            "tablet": ["ipad"],
            "laptop": ["laptopcomputer"],
            "headphones": ["headphones"],
            "watch": ["applewatch"],
            "tv": ["tv"],
            "camera": ["camera"],
            "gamepad": ["gamecontroller"],
            "cable": ["cable.connector", "powerplug"],
            "microwave": ["microwave", "oven"],
            "dining": ["fork.knife"],
            "sofa": ["sofa", "chair.lounge"],
            "lamp": ["lamp.table", "lamp.desk", "lightbulb"],
            "bed": ["bed.double"],
            "washer": ["washer", "dryer"],
            "spray": ["bubbles.and.sparkles", "sparkles"],
            "drop": ["drop"],
            "brush": ["paintbrush.pointed", "paintbrush"],
            "scissors": ["scissors"],
            "sparkles": ["sparkles"],
            "bath": ["bathtub", "shower"],
            "dress": ["figure.stand.dress", "hanger"],
            "shirt": ["tshirt"],
            "baby": ["figure.child", "stroller", "teddybear"],
            "shoe": ["shoe", "shoeprints.fill", "figure.walk"],
            "bag": ["handbag", "bag"],
            "glasses": ["eyeglasses"],
            "dumbbell": ["dumbbell", "figure.run"],
            "produce": ["carrot", "leaf"],
            "wheat": ["basket", "takeoutbag.and.cup.and.straw"],
            "milk": ["waterbottle", "drop.halffull"],
            "croissant": ["birthday.cake", "fork.knife"],
            "cookie": ["popcorn", "gift"],
            "cup": ["cup.and.saucer"],
            "meat": ["fish", "fork.knife"],
        ]
    }

    var id: String { slug }

    /// Its subcategories, none for a department exported without them.
    var subs: [Subcategory] { subcategories ?? [] }
    func sub(_ slug: String?) -> Subcategory? { subs.first { $0.slug == slug } }

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

/// A season or an occasion — Ramadan, Back to school, the New Year — and
/// which products are for it (`Shared/commerce/occasions.ts`, exported to
/// `occasions.json`): a name in both languages, the words a store tags a
/// product with for it, and a window by the Gregorian calendar or the Umm
/// al-Qura one, drawn as the shopping for it happens.
struct Occasion: Decodable, Identifiable, Hashable, Sendable {
    struct Window: Decodable, Hashable, Sendable {
        /// "gregorian" or "hijri".
        let calendar: String
        /// A month and a day; `to` earlier than `from` wraps the year's end.
        let from: [Int]
        let to: [Int]
    }

    let slug: String
    /// The dictionary key of its name.
    let label: String
    let tags: [String]
    let window: Window
    var id: String { slug }

    /// A tag as a store might type it, reduced to what it means (`foldTag`):
    /// lower case, spaces and punctuation gone, the Arabic letters keyboards
    /// disagree on made one and the vowel marks dropped.
    nonisolated static func fold(_ tag: String) -> String {
        let marks = Set<UInt32>(0x064B...0x0652).union([0x0640])
        var out = ""
        for scalar in tag.precomposedStringWithCanonicalMapping.lowercased().unicodeScalars {
            if marks.contains(scalar.value) { continue }
            switch scalar {
            case "أ", "إ", "آ": out.append("ا")
            case "ة": out.append("ه")
            case "ى": out.append("ي")
            default:
                if CharacterSet.alphanumerics.contains(scalar) { out.unicodeScalars.append(scalar) }
            }
        }
        return out
    }

    /// Every folded word that puts a product on the occasion; the slug counts too.
    var keys: Set<String> { Set(([slug] + tags).map(Self.fold)) }

    func matches(_ product: Product) -> Bool { matches(tags: product.tags) }

    func matches(tags: [String]) -> Bool {
        let keys = keys
        return tags.contains { keys.contains(Self.fold($0)) }
    }

    /// Whether the occasion's shopping is on at this moment, on Kuwait's day.
    func isOn(_ date: Date) -> Bool {
        var calendar = Calendar(identifier: window.calendar == "hijri" ? .islamicUmmAlQura : .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Kuwait") ?? calendar.timeZone
        let parts = calendar.dateComponents([.month, .day], from: date)
        guard let month = parts.month, let day = parts.day, window.from.count == 2, window.to.count == 2 else { return false }
        return Self.inWindow(month: month, day: day, from: window.from, to: window.to)
    }

    /// Whether a month and day fall inside a window, which may wrap the year's end (`inWindow`).
    nonisolated static func inWindow(month: Int, day: Int, from: [Int], to: [Int]) -> Bool {
        let here = month * 100 + day
        let start = from[0] * 100 + from[1]
        let end = to[0] * 100 + to[1]
        return start <= end ? (here >= start && here <= end) : (here >= start || here <= end)
    }
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

        /// What a shopper is told, in the five groups the settings draw
        /// (`noticeCategories.ts`): each one of the switches above, or none
        /// when it is always on.
        struct NoticeCategory: Decodable, Hashable, Sendable {
            let id: String
            let title: String
            let body: String
            let preference: String?
            let alwaysNote: String?
        }

        let maxAddresses: Int
        let maxAddressLabel: Int
        let maxAddressLine: Int
        let maxAddressNotes: Int
        let notificationKinds: [NoticeKind]
        let noticeCategories: [NoticeCategory]
        /// The params of a notice that hold an amount, drawn as money.
        let moneyParams: [String]
        let supportTopics: [String]
        let maxSupportMessage: Int
        let maxOpenConversations: Int
        let ratingMax: Int
        let maxReviewTitle: Int
        let maxReviewBody: Int
        /// The most photos one review carries (`MAX_REVIEW_PHOTOS`).
        let maxReviewPhotos: Int
        /// How many reviews a product page asks for at a time (`REVIEW_PAGE`).
        let reviewPage: Int
        /// The square a profile photo is made at, and what it may weigh (`profilePhoto.ts`).
        let profilePhotoEdge: Int
        let maxProfilePhotoBytes: Int
        /// How long a product link keeps counting after it is opened (3.7).
        let productLinkDays: Int
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
            noticeCategories: [
                .init(id: "orders", title: "notify.cat.orders.title", body: "notify.cat.orders.body", preference: "delivery_update", alwaysNote: "notify.cat.orders.always"),
                .init(id: "deals", title: "notify.cat.deals.title", body: "notify.cat.deals.body", preference: "price_drop", alwaysNote: "notify.cat.deals.always"),
                .init(id: "personal", title: "notify.cat.personal.title", body: "notify.cat.personal.body", preference: "bag_reminder", alwaysNote: "notify.cat.personal.always"),
                .init(id: "recommendations", title: "notify.cat.recommendations.title", body: "notify.cat.recommendations.body", preference: "new_arrival", alwaysNote: nil),
                .init(id: "account", title: "notify.cat.account.title", body: "notify.cat.account.body", preference: nil, alwaysNote: "notify.cat.account.always"),
            ],
            moneyParams: ["price", "amount", "total"],
            supportTopics: ["order", "delivery", "return", "payment", "account", "other"],
            maxSupportMessage: 2000, maxOpenConversations: 5, ratingMax: 5, maxReviewTitle: 120, maxReviewBody: 2000,
            maxReviewPhotos: 4, reviewPage: 10, profilePhotoEdge: 512, maxProfilePhotoBytes: 400_000,
            productLinkDays: 30, minAffiliatePayoutFils: 5000, minCashOutPoints: 1000, maxLists: 12, maxListItems: 200,
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

    /// "Your profile"'s details (`Shared/commerce/profileDetails.ts`).
    struct ProfileLimits: Decodable, Sendable {
        let namePartMax: Int
        let earliestBirthday: String

        static let fallback = ProfileLimits(
            namePartMax: 60,
            earliestBirthday: "1900-01-01"
        )
    }

    /// My Profile's country and the order page's after-sales centre
    /// (`Shared/commerce/country.ts`, `warranty.ts`, `orderHelp.ts`).
    struct AfterSales: Decodable, Sendable {
        struct Country: Decodable, Sendable, Hashable {
            let code: String
            let open: Bool
        }

        struct Warranty: Decodable, Sendable {
            let minProblem: Int
            let maxProblem: Int
            let maxResponse: Int
            let maxPhotos: Int
            let remedies: [String]
        }

        struct Help: Decodable, Sendable {
            let maxQuestion: Int
            let turns: Int
            let starters: [String]
            let actions: [String]
            /// The help centre's issues, and the ones about one item (`selfService.ts`).
            let issues: [String]
            let itemIssues: [String]
        }

        let countries: [Country]
        let homeCountry: String
        let warranty: Warranty
        let help: Help

        static let fallback = AfterSales(
            countries: ["KW", "SA", "AE", "QA", "BH", "OM"].map { Country(code: $0, open: $0 == "KW") },
            homeCountry: "KW",
            warranty: Warranty(minProblem: 10, maxProblem: 1000, maxResponse: 600, maxPhotos: 4, remedies: ["repair", "replace", "refund"]),
            help: Help(
                maxQuestion: 500, turns: 6, starters: [], actions: [],
                issues: ["late", "damaged", "wrong", "return", "exchange", "warranty", "payment", "account"],
                itemIssues: ["damaged", "wrong", "return", "exchange", "warranty"]
            )
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
    /// The shapes the password meter calls easy to guess (`COMMON_PASSWORDS`).
    var commonPasswords: [String]? = nil
    var profile: ProfileLimits? = nil
    var afterSales: AfterSales? = nil

    /// The profile's rules, or the fallback when the export predates them.
    var profileRules: ProfileLimits { profile ?? .fallback }

    /// The password floor, or the same number when the file predates it.
    var passwordFloor: Int { minPasswordLength ?? 8 }

    /// The common shapes, or none when the file predates them.
    var commonPasswordList: [String] { commonPasswords ?? [] }

    /// The account's rules, or the same numbers when the file predates them.
    var accountRules: Account { account ?? .fallback }
    var orderRules: Orders { orders ?? .fallback }
    var aiRules: AI { ai ?? .fallback }
    var afterSalesRules: AfterSales { afterSales ?? .fallback }
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
    /// The seasons and the occasions, in the order they are drawn (`OCCASIONS`).
    let occasions: [Occasion]
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
        let occasions = (try? decoder.decode([Occasion].self, from: bundle.resource("occasions", "json"))) ?? []
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
            occasions: occasions,
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

    func occasion(slug: String?) -> Occasion? {
        guard let slug else { return nil }
        return occasions.first { $0.slug == slug }
    }

    /// The occasions whose shopping is on at this moment, in the table's order (`occasionsOn`).
    func occasionsOn(_ date: Date = Date()) -> [Occasion] {
        occasions.filter { $0.isOn(date) }
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
