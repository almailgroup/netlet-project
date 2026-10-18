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

    /// The session cookie's name (`COOKIE_NAME` in `Shared/const.ts`).
    let sessionCookie: String
    let maxLineQuantity: Int
    let returnWindowDays: Int
    let listing: Listing
    let media: Media
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
    }

    let departments: [Department]
    let governorates: [Governorate]
    let areas: [String: [Area]]
    let requiredParts: [String]
    let partMax: [String: Int]
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
            media: .init(maxEdge: 1200, minEdge: 300, maxUploadBytes: 1_500_000)
        )
        return ReferenceData(
            departments: departments.sorted { $0.position < $1.position },
            governorates: kuwait?.governorates ?? [],
            areas: kuwait?.areas ?? [:],
            requiredParts: kuwait?.requiredParts ?? ["area", "block", "street", "building"],
            partMax: kuwait?.partMax ?? [:],
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

    func governorate(id: String?) -> Governorate? {
        governorates.first { $0.id == id }
    }

    /// The governorate an area belongs to, so choosing an area can choose it too.
    func governorate(ofArea area: String?) -> String? {
        guard let area else { return nil }
        return areas.first(where: { $0.value.contains { $0.en == area } })?.key
    }
}
