import Foundation

/// What the account's sections read, as the server answers them. Each is the
/// shape a web section (`components/account/*`) draws, decoded leniently: a
/// field the app does not draw is not declared, so a new column on the
/// server cannot break the app.

// MARK: Switches

/// Which of the shop's switchable features are on (`features.states`) —
/// `Shared/features.ts`, read so a section the API would refuse is not offered.
struct FeatureStates: Decodable, Sendable {
    let values: [String: Bool]

    init(values: [String: Bool]) { self.values = values }

    init(from decoder: Decoder) throws {
        values = try decoder.singleValueContainer().decode([String: Bool].self)
    }

    /// A switch the answer does not name is on, the way the web's `useFeature`
    /// answers its default while loading: the server refuses regardless.
    func isOn(_ key: String) -> Bool { values[key] ?? true }

    static let unknown = FeatureStates(values: [:])
}

// MARK: Notifications

/// One notice in the inbox (`notifications.list`). It is a message key and its
/// params, never English, so one written in English reads in Arabic next week.
struct Notice: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let kind: String
    let messageKey: String
    let params: [String: String]
    let link: String?
    let read: Bool
    let createdAt: Date

    private enum CodingKeys: String, CodingKey {
        case id, kind, messageKey, params, link, read, createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        kind = try container.decode(String.self, forKey: .kind)
        messageKey = try container.decode(String.self, forKey: .messageKey)
        params = (try? container.decode([String: LooseText].self, forKey: .params))?.mapValues(\.text) ?? [:]
        link = try container.decodeIfPresent(String.self, forKey: .link)
        read = try container.decode(Bool.self, forKey: .read)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
    }

    /// The values the sentence is drawn with, in the reader's language — the
    /// web's `noticeValues`: an `…Ar` twin on the Arabic page when it was
    /// given, and every money param drawn as money.
    func values(_ language: Language, moneyParams: [String] = ReferenceData.shared.rules.accountRules.moneyParams) -> [String: String] {
        var values: [String: String] = [:]
        for (name, value) in params where !name.hasSuffix("Ar") {
            let twin = params["\(name)Ar"]?.trimmingCharacters(in: .whitespaces)
            values[name] = language == .ar && twin?.isEmpty == false ? twin! : value
        }
        for name in moneyParams {
            if let amount = values[name], let money = Money(amount: amount) { values[name] = money.formatted(language) }
        }
        return values
    }
}

/// One page of the inbox.
struct NoticePage: Decodable, Sendable {
    let entries: [Notice]
    let total: Int
    let unread: Int
    let page: Int
    let pageSize: Int
}

/// A shopper's stored choice for one kind of notice (`customer.notifications.list`).
struct NoticePreference: Decodable, Hashable, Sendable {
    let kind: String
    let enabled: Bool
}

/// Whether the shop sends email at all (`notifications.channels`).
struct NoticeChannels: Decodable, Sendable {
    let email: Bool
}

/// A value the server sends as either a string or a number, read as text.
struct LooseText: Decodable, Hashable, Sendable {
    let text: String

    init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if let text = try? single.decode(String.self) {
            self.text = text
        } else if let number = try? single.decode(Int.self) {
            text = String(number)
        } else if let number = try? single.decode(Double.self) {
            text = String(number)
        } else if let flag = try? single.decode(Bool.self) {
            text = flag ? "true" : "false"
        } else {
            text = ""
        }
    }
}

// MARK: Wishlists

/// One of the shopper's lists (`wishlists.mine`).
struct WishlistSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let title: String
    /// `private` or `public`; private is the default and public a decision.
    let visibility: String
    let itemCount: Int
    let phone: String?

    var isPublic: Bool { visibility == "public" }
}

/// A list opened by its owner (`wishlists.get`). Who claimed what is not in
/// it on purpose: a list whose owner can watch items go grey tells them what
/// they are getting for their birthday.
struct WishlistDetail: Decodable, Sendable {
    struct List: Decodable, Sendable {
        let id: Int
        let title: String
        let visibility: String
        let ownerName: String?
    }

    struct Item: Decodable, Identifiable, Hashable, Sendable {
        let id: Int
        /// The storefront's product id, a string.
        let productId: String
        let note: String?
        let quantity: Int
    }

    let list: List
    let items: [Item]
}

/// What creating a list answers: its id.
struct CreatedList: Decodable, Sendable {
    let id: Int

    init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if let id = try? single.decode(Int.self) {
            self.id = id
        } else {
            struct Row: Decodable { let id: Int }
            id = try single.decode(Row.self).id
        }
    }
}

// MARK: Price requests

/// A price the shopper asked a seller for (`offers.list`). Its state is the
/// server's, expiry and use included — neither is stored, both are derived.
struct PriceRequest: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    /// pending, offered, declined, expired, withdrawn or used.
    let state: String
    let productHandle: String?
    let productTitle: String
    let variantTitle: String?
    let vendorName: String
    let listPrice: Money
    let askedPrice: Money
    let offeredPrice: Money?
    let quantity: Int
    let shopperNote: String?
    let vendorNote: String?
    let expiresAt: Date?
    let createdAt: Date

    var variantLabel: String? {
        guard let variantTitle, variantTitle != "Default", !variantTitle.isEmpty else { return nil }
        return variantTitle
    }
}

// MARK: Reviews

/// A delivered line the shopper may review, and whether they have (`reviews.mine`).
struct ReviewableLine: Decodable, Identifiable, Hashable, Sendable {
    struct Eligibility: Decodable, Hashable, Sendable {
        let allowed: Bool
        let reason: String?
    }

    let orderItemId: Int
    let orderReference: String
    let productId: String?
    let productTitle: String
    let deliveredAt: Date?
    let reviewId: Int?
    let myRating: Int?
    let eligibility: Eligibility

    var id: Int { orderItemId }
}

// MARK: Talking to NetLet

/// One conversation with NetLet's help desk (`support.mine`).
struct SupportConversation: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let topic: String
    let orderReference: String?
    /// open, waiting or resolved.
    let status: String
    let lastMessageAt: Date
    let unread: Bool
}

/// A conversation opened (`support.thread`). The first answer is computed
/// from the order's facts and stored as message keys, so it reads in either
/// language.
struct SupportThread: Decodable, Sendable {
    struct Part: Decodable, Hashable, Sendable {
        let key: String
        let params: [String: String]

        private enum CodingKeys: String, CodingKey {
            case key, params
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            key = try container.decode(String.self, forKey: .key)
            params = (try? container.decode([String: LooseText].self, forKey: .params))?.mapValues(\.text) ?? [:]
        }
    }

    struct Message: Decodable, Identifiable, Hashable, Sendable {
        let id: Int
        /// shopper, automatic or staff.
        let author: String
        let body: String?
        let answer: [Part]?
        let createdAt: Date
    }

    let id: Int
    let topic: String
    let orderReference: String?
    let status: String
    let messages: [Message]
}

/// What opening a conversation answers.
struct OpenedSupport: Decodable, Sendable {
    let id: Int
}

// MARK: Rewards

/// Referral points (`rewards.mine`): a code to share, a balance, what it is
/// worth in the shop and in cash, and the ledger behind it.
struct Rewards: Decodable, Sendable {
    struct CashOut: Decodable, Sendable {
        let ok: Bool
        let shortBy: Int?
    }

    struct Entry: Decodable, Identifiable, Hashable, Sendable {
        let id: Int
        let points: Int
        let reason: String
        let orderReference: String?
        let settledAt: Date?
        let createdAt: Date
    }

    let code: String
    let balance: Int
    let spendValue: Money
    let cashOutValue: Money
    let cashOut: CashOut
    let minimumCashOut: Int
    let invited: Int
    let qualified: Int
    let entries: [Entry]
}

// MARK: Affiliates

/// The affiliate programme's dashboard (`affiliates.mine`), or nil before joining.
struct AffiliateDashboard: Decodable, Sendable {
    struct Payout: Decodable, Sendable {
        let ok: Bool
        let shortBy: Money?
    }

    struct Entry: Decodable, Identifiable, Hashable, Sendable {
        let id: Int
        let reason: String
        let orderReference: String?
        let amount: Money
        let settledAt: Date?
        let createdAt: Date
    }

    /// pending, approved or suspended.
    let status: String
    let code: String
    let displayName: String
    let channel: String?
    let ratePercent: String
    let paidOrders: Int
    let waitingOrders: Int
    let earned: Money
    let reversed: Money
    let balance: Money
    let payout: Payout
    let entries: [Entry]
}

/// What asking for an affiliate payout answers: how much is on its way.
struct PayoutRequested: Decodable, Sendable {
    let amount: Money
}

// MARK: Subscribe & Save

/// A standing order (`subscriptions.mine`): a promise about price, never above
/// the ceiling frozen when the shopper subscribed.
struct StandingOrder: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let productTitle: String
    let variantTitle: String?
    let productHandle: String?
    let image: String?
    let quantity: Int
    let intervalWeeks: Int
    let addressLabel: String?
    /// active, paused or cancelled.
    let status: String
    let pausedReason: String?
    let nextRunOn: String?
    let lastRunOn: String?
    let lastOutcome: String?
    let priceCeiling: Money
    let priceNow: Money?

    var variantLabel: String? {
        guard let variantTitle, variantTitle != "Default", !variantTitle.isEmpty else { return nil }
        return variantTitle
    }
}
