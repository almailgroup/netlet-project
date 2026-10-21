import Foundation

/// NetLet's help desk, its guides and the delivery companies — the web's
/// `/admin/support`, `/admin/guides` and `/admin/couriers` — as those pages
/// read them.

// MARK: - Support

/// One conversation in NetLet's inbox (`support.inbox`): open ones first,
/// then the rest by latest activity.
struct StaffInboxRow: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let topic: String
    var orderReference: String? = nil
    /// open, waiting or resolved.
    let status: String
    let lastMessageAt: Date
    /// The shopper wrote after NetLet last looked.
    let unread: Bool
    var shopperEmail: String? = nil
}

struct StaffInboxPage: Decodable, Sendable {
    let rows: [StaffInboxRow]
    let total: Int
    let page: Int
    let pageSize: Int
}

/// A conversation as NetLet reads it (`support.staffThread`): the shopper's
/// name and email beside what the shopper sees. Opening it marks it read.
struct StaffSupportThread: Decodable, Sendable {
    let id: Int
    let topic: String
    var orderReference: String? = nil
    let status: String
    var shopperName: String? = nil
    var shopperEmail: String? = nil
    let messages: [SupportThread.Message]
}

/// A model's draft for a person to read (`support.draft`,
/// `inventory.products.draftArabicTitle`): the words, or why there are none.
struct DraftAnswer: Decodable, Sendable {
    /// draft, nothingToAnswer or unavailable.
    let kind: String
    var text: String? = nil
}

/// The inbox's rule for a reply (`messageProblem`): something to say, and not
/// past the ceiling.
enum SupportRules {
    static func problem(_ body: String, limit: Int) -> String? {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "support.empty" }
        if trimmed.count > limit { return "support.tooLong" }
        return nil
    }

    static let filters = ["open", "waiting", "resolved", "all"]
}

// MARK: - Guides

/// A guide as NetLet's desk edits it — the shape `guides.save` takes and
/// every guide procedure answers with (`GuideContent`).
struct GuideContent: Codable, Hashable, Sendable {
    struct Step: Codable, Hashable, Sendable {
        var title: String
        var titleAr: String
        var body: String
        var bodyAr: String
        var imageUrl: String?

        static let empty = Step(title: "", titleAr: "", body: "", bodyAr: "", imageUrl: nil)

        var hasWords: Bool { !(title + titleAr + body + bodyAr).isEmpty || imageUrl != nil }

        /// `imageUrl` is sent even when nil, as the router asks for it.
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(title, forKey: .title)
            try container.encode(titleAr, forKey: .titleAr)
            try container.encode(body, forKey: .body)
            try container.encode(bodyAr, forKey: .bodyAr)
            try container.encode(imageUrl, forKey: .imageUrl)
        }
    }

    var audience: String
    var title: String
    var titleAr: String
    var summary: String
    var summaryAr: String
    var steps: [Step]

    static let empty = GuideContent(audience: "shopper", title: "", titleAr: "", summary: "", summaryAr: "", steps: [.empty])

    /// Whether a model's draft would replace anything typed.
    var hasWords: Bool { !(title + titleAr + summary + summaryAr).isEmpty || steps.contains(where: \.hasWords) }
}

/// A saved guide (`guides.get`, `guides.list`'s rows): its content with its
/// address and state.
struct AdminGuide: Decodable, Identifiable, Sendable {
    let id: Int
    let slug: String
    /// draft or published.
    let status: String
    let content: GuideContent
    let updatedAt: Date

    private enum CodingKeys: String, CodingKey {
        case id, slug, status, updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        slug = try container.decode(String.self, forKey: .slug)
        status = try container.decode(String.self, forKey: .status)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
        content = try GuideContent(from: decoder)
    }
}

struct AdminGuidePage: Decodable, Sendable {
    let rows: [AdminGuide]
    let total: Int
    let page: Int
    let pageSize: Int
}

/// A step's picture as the model drew it (`guides.picture`): the bytes, to be
/// prepared and uploaded like any photo once a person picks it.
struct DrawnPicture: Decodable, Sendable {
    let mimeType: String
    let data: String
}

/// The guide rules the desk asks before the server does (`guides.ts`).
enum GuideRules {
    /// What stops a guide being published (`guideProblems`), as message keys.
    static func problems(_ guide: GuideContent) -> [String] {
        func blank(_ text: String) -> Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        var problems: [String] = []
        if blank(guide.title) || blank(guide.titleAr) { problems.append("guides.needTitle") }
        if guide.steps.isEmpty { problems.append("guides.needSteps") }
        if guide.steps.contains(where: { blank($0.title) || blank($0.titleAr) || blank($0.body) || blank($0.bodyAr) }) {
            problems.append("guides.stepIncomplete")
        }
        if guide.steps.contains(where: { !acceptableImage($0.imageUrl) }) { problems.append("guides.badPicture") }
        let words = [guide.title, guide.titleAr, guide.summary, guide.summaryAr] + guide.steps.flatMap { [$0.title, $0.titleAr, $0.body, $0.bodyAr] }
        if words.contains(where: { !ContactFilter.findings($0).isEmpty }) { problems.append("guides.contactDetails") }
        return problems
    }

    /// Only NetLet's own uploads (`acceptableGuideImage`, `isMediaPath`).
    static func acceptableImage(_ value: String?) -> Bool {
        guard let value else { return true }
        return value.range(of: "^/media/[A-Za-z0-9_-]{16,64}\\.(?:webp|jpg)$", options: .regularExpression) != nil
    }

    /// The title in the page's language, then the other, then "Untitled".
    static func title(_ guide: GuideContent, arabic: Bool) -> String? {
        let first = arabic ? guide.titleAr : guide.title
        let fallback = [guide.title, guide.titleAr].first { !$0.isEmpty }
        return first.isEmpty ? fallback : first
    }
}

extension PortalRules {
    /// The guide editor's lengths (`guides.ts`).
    struct GuideLimits: Decodable, Sendable {
        let titleMax: Int
        let summaryMax: Int
        let stepTitleMax: Int
        let stepBodyMax: Int
        let maxSteps: Int
        let topicMax: Int
    }
}

// MARK: - Delivery companies

/// Someone who signs in for a delivery company (`dispatch.couriers.members`).
struct CourierMember: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let userId: Int
    let courierId: Int
    let email: String
    var name: String? = nil
}

extension API {
    struct InboxQuery: Encodable, Sendable {
        var status: String?
        var page: Int?
    }

    static let staffInbox = Procedure<InboxQuery, StaffInboxPage>(query: "support.inbox")
    static let staffThread = Procedure<RowId, StaffSupportThread>(query: "support.staffThread")

    struct StaffReply: Encodable, Sendable {
        let id: Int
        let body: String
    }

    static let staffReply = Procedure<StaffReply, Acknowledged>(mutation: "support.staffReply")
    static let staffResolve = Procedure<RowId, Acknowledged>(mutation: "support.staffResolve")
    static let supportDraftAvailable = Procedure<NoInput, Bool>(query: "support.draftAvailable")
    static let supportDraft = Procedure<RowId, DraftAnswer>(mutation: "support.draft")

    static let guideList = Procedure<PageOnly, AdminGuidePage>(query: "guides.list")
    static let guideGet = Procedure<RowId, AdminGuide>(query: "guides.get")

    struct GuideSave: Encodable, Sendable {
        let id: OrNull<Int>
        let guide: GuideContent
    }

    static let guideSave = Procedure<GuideSave, AdminGuide>(mutation: "guides.save")

    struct GuideStatus: Encodable, Sendable {
        let id: Int
        let status: String
    }

    static let guideSetStatus = Procedure<GuideStatus, AdminGuide>(mutation: "guides.setStatus")
    static let guideDelete = Procedure<RowId, Acknowledged>(mutation: "guides.delete")
    static let guideAIAvailable = Procedure<NoInput, Bool>(query: "guides.aiAvailable")

    struct GuideTopic: Encodable, Sendable {
        let topic: String
        let audience: String
    }

    static let guideDraft = Procedure<GuideTopic, GuideContent>(mutation: "guides.draft")

    struct StepWords: Encodable, Sendable {
        let title: String
        let body: String
    }

    static let guidePicture = Procedure<StepWords, DrawnPicture>(mutation: "guides.picture")

    struct NewCourier: Encodable, Sendable {
        let name: String
        let nameAr: OrNull<String>
        let contactPhone: OrNull<String>
        let contactEmail: OrNull<String>
    }

    static let createCourier = Procedure<NewCourier, Acknowledged>(mutation: "dispatch.couriers.create")

    struct CourierStatus: Encodable, Sendable {
        let courierId: Int
        let status: String
    }

    static let setCourierStatus = Procedure<CourierStatus, Acknowledged>(mutation: "dispatch.couriers.setStatus")

    struct CourierId: Encodable, Sendable {
        let courierId: Int
    }

    static let courierMembers = Procedure<CourierId, [CourierMember]>(query: "dispatch.couriers.members")

    struct CourierEmail: Encodable, Sendable {
        let courierId: Int
        let email: String
    }

    static let addCourierMember = Procedure<CourierEmail, Acknowledged>(mutation: "dispatch.couriers.addMember")

    struct CourierUser: Encodable, Sendable {
        let courierId: Int
        let userId: Int
    }

    static let removeCourierMember = Procedure<CourierUser, Acknowledged>(mutation: "dispatch.couriers.removeMember")
}
