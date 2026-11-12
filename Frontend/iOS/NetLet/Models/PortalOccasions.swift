import Foundation

// MARK: - The occasions desk

extension PortalRules {
    /// The occasions desk's limits (`occasionDesk.ts`), which the server refuses past.
    struct OccasionLimits: Decodable, Sendable {
        let titleMax: Int
        let slugMax: Int
        let maxProducts: Int
        let maxDays: Int
    }
}

/// Where one of NetLet's occasions stands today (`OccasionSeason`).
struct OccasionSeason: Decodable, Hashable, Sendable {
    /// "on", "upcoming", "ended" or "outOfSeason".
    let state: String
    /// Days left, today being zero; nil while it keeps the calendar's window.
    var daysLeft: Int? = nil
    /// Days to its first day, or since its last.
    var days: Int? = nil
}

/// One of NetLet's occasions as the desk lists it (`AdminOccasion`).
struct AdminOccasion: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let slug: String
    let title: String
    let titleAr: String
    let imageUrl: String?
    let startsOn: String?
    let endsOn: String?
    let includeTagged: Bool
    /// "draft", "published" or "hidden".
    let status: String
    /// Its address is one of the calendar's occasions, which it takes over once published.
    let calendar: Bool
    let season: OccasionSeason
    /// Products chosen for it, and of those how many the shop shows today.
    let chosen: Int
    let live: Int
    /// Products the stores tagged for it that the shop shows, beyond the chosen.
    let tagged: Int

    func name(_ language: Language) -> String {
        language == .ar && !titleAr.trimmingCharacters(in: .whitespaces).isEmpty ? titleAr : title
    }
}

/// One of the calendar's own occasions, with what stands over it (`CalendarEntry`).
struct OccasionCalendarEntry: Decodable, Identifiable, Hashable, Sendable {
    struct Row: Decodable, Hashable, Sendable {
        let id: Int
        let status: String
    }

    let slug: String
    /// Whether the calendar's window is open today.
    let on: Bool
    let tagged: Int
    /// NetLet's row for it, if it has one.
    let row: Row?
    var id: String { slug }
}

/// The desk (`occasions.list`): NetLet's own, and the calendar's ten.
struct OccasionDesk: Decodable, Sendable {
    /// False until migration 0081 is pasted: the desk says it is not open yet.
    let ready: Bool
    let rows: [AdminOccasion]
    let calendar: [OccasionCalendarEntry]
}

/// One of NetLet's occasions with the products chosen for it (`OccasionDetail`).
struct OccasionDetail: Decodable, Sendable {
    /// A product chosen for the occasion, as the editor lists it.
    struct Chosen: Decodable, Identifiable, Hashable, Sendable {
        let id: Int
        let title: String
        let titleAr: String?
        let vendorName: String?
        let imageUrl: String?
        /// Whether the shop shows it today.
        let live: Bool

        func name(_ language: Language) -> String {
            if language == .ar, let titleAr, !titleAr.trimmingCharacters(in: .whitespaces).isEmpty { return titleAr }
            return title
        }
    }

    let occasion: AdminOccasion
    let products: [Chosen]

    private enum CodingKeys: String, CodingKey { case products }

    /// The server sends the occasion's own fields beside its products, in one object.
    init(from decoder: Decoder) throws {
        occasion = try AdminOccasion(from: decoder)
        products = try decoder.container(keyedBy: CodingKeys.self).decode([Chosen].self, forKey: .products)
    }
}

/// What an administrator writes (`OccasionContent`), and the products chosen.
struct OccasionDraft: Encodable, Equatable, Sendable {
    var slug = ""
    var title = ""
    var titleAr = ""
    var imageUrl: String?
    var startsOn: String?
    var endsOn: String?
    var includeTagged = true
    var productIds: [Int] = []

    /// Optional values are sent as `null`, which the server's `.nullable()` expects.
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(slug, forKey: .slug)
        try c.encode(title, forKey: .title)
        try c.encode(titleAr, forKey: .titleAr)
        try c.encode(OrNull(imageUrl), forKey: .imageUrl)
        try c.encode(OrNull(startsOn), forKey: .startsOn)
        try c.encode(OrNull(endsOn), forKey: .endsOn)
        try c.encode(includeTagged, forKey: .includeTagged)
        try c.encode(productIds, forKey: .productIds)
    }

    private enum CodingKeys: String, CodingKey { case slug, title, titleAr, imageUrl, startsOn, endsOn, includeTagged, productIds }
}

extension API {
    struct OccasionSave: Encodable, Sendable {
        let id: OrNull<Int>
        let occasion: OccasionDraft
    }

    struct OccasionStatus: Encodable, Sendable {
        let id: Int
        let status: String
    }

    struct OccasionId: Encodable, Sendable {
        let id: Int
    }

    struct OccasionHide: Encodable, Sendable {
        let slug: String
    }

    struct OccasionDeleted: Decodable, Sendable {
        let ok: Bool
    }

    static let occasionDesk = Procedure<NoInput, OccasionDesk>(query: "occasions.list")
    static let occasionGet = Procedure<OccasionId, OccasionDetail>(query: "occasions.get")
    static let occasionSave = Procedure<OccasionSave, OccasionDetail>(mutation: "occasions.save")
    static let occasionSetStatus = Procedure<OccasionStatus, OccasionDetail>(mutation: "occasions.setStatus")
    /// Switch one of the calendar's own occasions off.
    static let occasionHide = Procedure<OccasionHide, OccasionDetail>(mutation: "occasions.hide")
    static let occasionDelete = Procedure<OccasionId, OccasionDeleted>(mutation: "occasions.delete")
}

/// `Shared/commerce/occasionDesk.ts` in Swift: what is wrong with an occasion
/// as written, by the box it is wrong in, so the editor says it under the box
/// before the server would refuse it. Tested on the TypeScript's own cases.
enum OccasionRules {
    enum Field: String, CaseIterable, Sendable {
        case title, titleAr, slug, imageUrl, startsOn, endsOn
    }

    nonisolated static var limits: PortalRules.OccasionLimits {
        PortalRules.shared.occasions ?? .init(titleMax: 80, slugMax: 40, maxProducts: 60, maxDays: 366)
    }

    /// Lower-case letters, digits and single hyphens (`isOccasionSlug`).
    nonisolated static func isSlug(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= limits.slugMax else { return false }
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        return parts.allSatisfy { part in
            !part.isEmpty && part.unicodeScalars.allSatisfy { ("a"..."z").contains($0) || ("0"..."9").contains($0) }
        }
    }

    /// The address a name would have (`occasionSlug`): "White Friday 2026" → `white-friday-2026`.
    nonisolated static func slug(_ title: String) -> String {
        var out = ""
        var gap = false
        for scalar in title.lowercased().unicodeScalars {
            if ("a"..."z").contains(scalar) || ("0"..."9").contains(scalar) {
                if gap, !out.isEmpty { out.append("-") }
                out.unicodeScalars.append(scalar)
                gap = false
            } else {
                gap = true
            }
        }
        var cut = String(out.prefix(limits.slugMax))
        while cut.hasSuffix("-") { cut.removeLast() }
        return cut.isEmpty ? "occasion" : cut
    }

    /// Whether an address is one of the calendar's own occasions.
    nonisolated static func isCalendar(_ slug: String) -> Bool {
        ReferenceData.shared.occasions.contains { $0.slug == slug }
    }

    /// A `yyyy-mm-dd` day as a count of days, or nil when it is not a real day.
    nonisolated static func dayNumber(_ day: String?) -> Int? {
        guard let day, day.count == 10 else { return nil }
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
        guard components.isValidDate(in: calendar), let date = calendar.date(from: components) else { return nil }
        return Int((date.timeIntervalSince1970 / 86_400).rounded())
    }

    /// `occasionProblems`: the first thing wrong in each box, as a dictionary key.
    nonisolated static func problems(_ draft: OccasionDraft) -> [Field: String] {
        var problems: [Field: String] = [:]
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let titleAr = draft.titleAr.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty { problems[.title] = "occasions.needTitle" }
        else if title.count > limits.titleMax { problems[.title] = "occasions.titleTooLong" }
        else if !ContactFilter.findings(title).isEmpty { problems[.title] = "occasions.contactDetails" }
        if titleAr.isEmpty { problems[.titleAr] = "occasions.needTitleAr" }
        else if titleAr.count > limits.titleMax { problems[.titleAr] = "occasions.titleTooLong" }
        else if !ContactFilter.findings(titleAr).isEmpty { problems[.titleAr] = "occasions.contactDetails" }
        if !isSlug(draft.slug) { problems[.slug] = "occasions.badSlug" }
        if let image = draft.imageUrl, !image.isMediaPath { problems[.imageUrl] = "occasions.badPicture" }

        let hasStart = !(draft.startsOn ?? "").isEmpty
        let hasEnd = !(draft.endsOn ?? "").isEmpty
        if !hasStart && !hasEnd {
            if !isCalendar(draft.slug) { problems[.startsOn] = "occasions.needDates" }
            return problems
        }
        let from = dayNumber(draft.startsOn)
        let to = dayNumber(draft.endsOn)
        if !hasStart { problems[.startsOn] = "occasions.needBothDates" }
        else if from == nil { problems[.startsOn] = "occasions.badDate" }
        if !hasEnd { problems[.endsOn] = "occasions.needBothDates" }
        else if to == nil { problems[.endsOn] = "occasions.badDate" }
        if let from, let to {
            if to < from { problems[.endsOn] = "occasions.endsBeforeStart" }
            else if to - from + 1 > limits.maxDays { problems[.endsOn] = "occasions.tooLong" }
        }
        return problems
    }

    /// The first problem in the form's own order.
    nonisolated static func first(_ problems: [Field: String]) -> (field: Field, problem: String)? {
        for field in Field.allCases { if let problem = problems[field] { return (field, problem) } }
        return nil
    }

    /// The status's name and pill tone on the desk.
    nonisolated static func statusKey(_ status: String) -> String {
        switch status {
        case "published": return "occasions.status.published"
        case "hidden": return "occasions.status.hidden"
        default: return "occasions.status.draft"
        }
    }

    nonisolated static func statusTone(_ status: String) -> String {
        switch status {
        case "published": return "good"
        case "hidden": return "warning"
        default: return "neutral"
        }
    }
}

private extension String {
    /// One of NetLet's own uploads, as `Shared/commerce/media.ts`'s `isMediaPath` reads it.
    var isMediaPath: Bool {
        guard hasPrefix("/media/") else { return false }
        let name = dropFirst("/media/".count)
        let pieces = name.split(separator: ".")
        guard pieces.count == 2, ["webp", "jpg"].contains(pieces[1]) else { return false }
        let id = pieces[0]
        return (16...64).contains(id.count) && id.unicodeScalars.allSatisfy {
            ("a"..."z").contains($0) || ("A"..."Z").contains($0) || ("0"..."9").contains($0) || $0 == "_" || $0 == "-"
        }
    }
}
