import Foundation

/// Warranty and installation (3.1.2) — `Shared/commerce/addons.ts` in Swift,
/// tested on its cases (`AddonRulesTests`). On the owner's word: an
/// installation fee of its own, extended warranty plans each with a length
/// and a price, and any other extra, every one named in English and Arabic or
/// named for the seller. The lengths and the ceilings come from `portal.json`,
/// so the app cannot offer a length the server refuses.
enum AddonRules {
    static var warrantyMonths: [Int] { ListingRules.shared.warrantyMonths }
    static var maxAddons: Int { ListingRules.shared.maxAddons }
    static var nameMax: Int { ListingRules.shared.addonNameMax }

    /// The three groups, in the order the editor draws them.
    static let groups = ["installation", "warranty", "other"]

    enum Problem: String, Hashable, Sendable {
        case price, name, warrantyLength, warrantyTwice, nameLong

        /// The sentence said under the box that is wrong.
        var key: String {
            switch self {
            case .price: return "admin.addonPriceProblem"
            case .name: return "admin.addonNameProblem"
            case .warrantyLength: return "admin.warrantyLengthProblem"
            case .warrantyTwice: return "admin.warrantyTwiceProblem"
            case .nameLong: return "admin.addonNameLongProblem"
            }
        }
    }

    /// One extra as a seller fills it in: the names may be blank, the length is a warranty's alone.
    struct Draft: Hashable, Sendable {
        var kind: String
        var label: String = ""
        var labelAr: String = ""
        var price: String = ""
        var warrantyMonths: Int? = nil
    }

    static func isLength(_ months: Int?) -> Bool { months.map { warrantyMonths.contains($0) } ?? false }

    /// "2 years", "6 months", counted in the language asked for.
    static func lengthWords(_ months: Int, language: Language) -> String {
        months % 12 == 0
            ? Phrasebook.shared.text("addon.lengthYears", language: language, params: ["count": "\(months / 12)"])
            : Phrasebook.shared.text("addon.lengthMonths", language: language, params: ["count": "\(months)"])
    }

    /// What an extra is called with no name of its own — `defaultAddonName`.
    static func defaultName(kind: String, months: Int?, language: Language) -> String? {
        if kind == "installation" { return Phrasebook.shared.text("addon.installationName", language: language) }
        if kind == "warranty", let months, isLength(months) {
            return months % 12 == 0
                ? Phrasebook.shared.text("addon.warrantyYearsName", language: language, params: ["count": "\(months / 12)"])
                : Phrasebook.shared.text("addon.warrantyMonthsName", language: language, params: ["count": "\(months)"])
        }
        return nil
    }

    /// Whether the stored names are the ones the server wrote for a blank name — `hasDefaultName`.
    static func hasDefaultName(kind: String, label: String, labelAr: String?, months: Int?) -> Bool {
        guard let en = defaultName(kind: kind, months: months, language: .en), trimmed(label) == en else { return false }
        let ar = trimmed(labelAr ?? "")
        return ar.isEmpty || ar == defaultName(kind: kind, months: months, language: .ar)
    }

    /// A stored extra as the editor shows it: a default name blank again — `draftOf`.
    static func draft(kind rawKind: String, label: String, labelAr: String?, price: String, months rawMonths: Int?) -> Draft {
        let kind = groups.contains(rawKind) ? rawKind : "other"
        let months = kind == "warranty" && isLength(rawMonths) ? rawMonths : nil
        if hasDefaultName(kind: kind, label: label, labelAr: labelAr, months: months) {
            return Draft(kind: kind, price: price, warrantyMonths: months)
        }
        return Draft(kind: kind, label: label, labelAr: labelAr ?? "", price: price, warrantyMonths: months)
    }

    /// A row the seller added and left blank is an abandoned edit, not an extra.
    static func isBlank(_ draft: Draft) -> Bool {
        trimmed(draft.price).isEmpty && trimmed(draft.label).isEmpty && trimmed(draft.labelAr).isEmpty
            && (draft.kind != "warranty" || draft.warrantyMonths == nil)
    }

    /// What is wrong with each extra, row by row — `addonProblems`, which the server asks too.
    static func problems(_ drafts: [Draft]) -> [[Problem]] {
        var lengths = Set<Int>()
        return drafts.map { draft in
            var found: [Problem] = []
            if !isPrice(trimmed(draft.price)) { found.append(.price) }
            let named = !trimmed(draft.label).isEmpty || !trimmed(draft.labelAr).isEmpty
            if trimmed(draft.label).count > nameMax || trimmed(draft.labelAr).count > nameMax { found.append(.nameLong) }
            if draft.kind == "other" && !named { found.append(.name) }
            if draft.kind == "warranty" {
                if let months = draft.warrantyMonths, isLength(months) {
                    if lengths.contains(months) { found.append(.warrantyTwice) }
                    lengths.insert(months)
                } else if !named {
                    found.append(.warrantyLength)
                }
            }
            return found
        }
    }

    /// Up to nine digits, up to three after the point, and above nothing.
    static func isPrice(_ text: String) -> Bool {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard (1...2).contains(parts.count), let whole = parts.first, (1...9).contains(whole.count),
              whole.allSatisfy({ $0.isASCII && $0.isNumber }) else { return false }
        if parts.count == 2 {
            let fraction = parts[1]
            guard (1...3).contains(fraction.count), fraction.allSatisfy({ $0.isASCII && $0.isNumber }) else { return false }
        }
        return text.contains { $0 != "0" && $0 != "." }
    }

    private static func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}
