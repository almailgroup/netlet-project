import Foundation

/// The pages that are words, read from `content.json` — the help page's
/// answers, the three legal documents and the seller application's rules,
/// exported from the same modules the web draws them from. Every sentence is
/// a dictionary key; the figures it is drawn with are the code's own.
struct SiteContent: Decodable, Sendable {
    struct Help: Decodable, Sendable {
        struct Group: Decodable, Identifiable, Sendable {
            let id: String
            let title: String
            let entries: [Entry]
        }

        struct Entry: Decodable, Identifiable, Sendable {
            struct Link: Decodable, Sendable {
                let href: String
                let label: String
            }

            let id: String
            let question: String
            let answer: String
            let params: [String: String]
            let link: Link?

            private enum CodingKeys: String, CodingKey {
                case id, question, answer, params, link
            }

            init(from decoder: Decoder) throws {
                let container = try decoder.container(keyedBy: CodingKeys.self)
                id = try container.decode(String.self, forKey: .id)
                question = try container.decode(String.self, forKey: .question)
                answer = try container.decode(String.self, forKey: .answer)
                params = (try? container.decode([String: LooseText].self, forKey: .params))?.mapValues(\.text) ?? [:]
                link = try container.decodeIfPresent(Link.self, forKey: .link)
            }
        }

        let groups: [Group]
        let maxQuestion: Int
    }

    struct Legal: Decodable, Sendable {
        struct Paragraph: Decodable, Hashable, Sendable {
            let key: String
            /// Drawn only while the deployment does what it describes.
            let only: String?
        }

        struct Section: Decodable, Identifiable, Sendable {
            let id: String
            let title: String
            let body: [Paragraph]
        }

        struct Document: Decodable, Sendable {
            let title: String
            let intro: String
            let plain: String
            let sections: [Section]
        }

        let updated: String
        /// What every sentence is drawn with: the return window, the standard
        /// commission, the payout and price-request day counts, the agreement's version.
        let figures: [String: String]
        let documents: [String: Document]

        private enum CodingKeys: String, CodingKey {
            case updated, figures, documents
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            updated = try container.decode(String.self, forKey: .updated)
            figures = (try container.decode([String: LooseText].self, forKey: .figures)).mapValues(\.text)
            documents = try container.decode([String: Document].self, forKey: .documents)
        }
    }

    struct Selling: Decodable, Sendable {
        let agreementVersion: String
        let defaultCommission: String
        let maxCommissionNote: Int
        let documentKinds: [String]
        let documentTypes: [String]
        let maxDocumentBytes: Int
    }

    let help: Help
    let legal: Legal
    let selling: Selling

    static let shared: SiteContent? = try? JSONDecoder().decode(SiteContent.self, from: Bundle.main.resource("content", "json"))
}

/// Which legal document a page draws.
enum LegalDocument: String, Hashable, Sendable {
    case terms, privacy, sellers
}

// MARK: Guides

/// A guide as the list shows it (`guides.published`).
struct GuideCard: Decodable, Identifiable, Hashable, Sendable {
    let slug: String
    /// `shopper` or `seller`.
    let audience: String
    let title: String
    let titleAr: String
    let summary: String
    let summaryAr: String
    let imageUrl: String?
    let stepCount: Int

    var id: String { slug }
}

/// One guide opened (`guides.bySlug`).
struct Guide: Decodable, Sendable {
    struct Step: Decodable, Hashable, Sendable {
        let title: String
        let titleAr: String
        let body: String
        let bodyAr: String
        let imageUrl: String?
    }

    let slug: String
    let audience: String
    let title: String
    let titleAr: String
    let summary: String
    let summaryAr: String
    let steps: [Step]
}

/// A guide's words in the page's language, or the other one when only that
/// was written — and which language they are in (`pickGuideText`).
func pickGuideText(_ language: Language, en: String, ar: String) -> (text: String, language: Language) {
    if language == .ar { return ar.trimmingCharacters(in: .whitespaces).isEmpty ? (en, .en) : (ar, .ar) }
    return en.trimmingCharacters(in: .whitespaces).isEmpty ? (ar, .ar) : (en, .en)
}

// MARK: Gift lists

/// A published list as a giver sees it (`wishlists.byToken`, `findByPhone`):
/// what is on it and whether each is taken — never by whom.
struct GiftList: Decodable, Identifiable, Sendable {
    struct Item: Decodable, Hashable, Sendable {
        let productId: String
        let note: String?
        let quantity: Int
        /// available, claimed or bought.
        let state: String
        let claimedByYou: Bool
    }

    let token: String
    let title: String
    let ownerName: String?
    let items: [Item]

    var id: String { token }
}

/// The presents a guest took on this phone — the web's `giftClaims`: the
/// claim names nobody, so the device remembers it, says "You are getting
/// this" from it, and sends it with the order that buys it.
enum HeldClaims {
    static let key = "netlet.giftClaims"

    struct Claim: Codable, Hashable, Sendable {
        let token: String
        let productId: String
        var at = Date()
    }

    static func all(_ defaults: UserDefaults = .standard, now: Date = Date()) -> [Claim] {
        let hold = TimeInterval(ReferenceData.shared.rules.accountRules.claimHoldDays) * 86_400
        let stored = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode([Claim].self, from: $0) } ?? []
        return stored.filter { now.timeIntervalSince($0.at) < hold }
    }

    static func remember(token: String, productId: String, _ defaults: UserDefaults = .standard) {
        let kept = all(defaults).filter { $0.token != token || $0.productId != productId } + [Claim(token: token, productId: productId)]
        defaults.set(try? JSONEncoder().encode(Array(kept.suffix(50))), forKey: key)
    }

    static func holds(token: String, productId: String, _ defaults: UserDefaults = .standard) -> Bool {
        all(defaults).contains { $0.token == token && $0.productId == productId }
    }
}

// MARK: Help

/// An order found by its number and the email it was placed with
/// (`help.lookupOrder`): its state and each line's, and nothing else.
struct LookedUpOrder: Decodable, Sendable {
    struct Line: Decodable, Hashable, Sendable {
        let title: String
        let variantTitle: String?
        let quantity: Int
        let fulfilment: String
    }

    let reference: String
    let placedAt: Date
    let status: String
    let lines: [Line]
}

// MARK: Selling

/// The applicant's own application to open a store (`inventory.applications.mine`).
struct StoreApplication: Decodable, Sendable {
    let id: Int
    let storeName: String
    let storeNameAr: String?
    let contactEmail: String?
    let contactPhone: String?
    let governorate: String?
    let addressLine: String?
    let licenceNumber: String?
    let licenceDocUrl: String?
    let identityDocUrl: String?
    let payoutIban: String?
    let underPlatformLicence: Bool
    let proposedCommissionPercent: String?
    /// A fixed amount per sale proposed instead of a percentage (3.3.2).
    let proposedCommissionFixed: String?
    let commissionNote: String?
    let agreementVersion: String?
    /// draft, submitted, approved or rejected.
    let status: String
    let rejectionReason: String?
    let updatedAt: Date
}

/// A paper uploaded with an application, and what the reviewer decided.
struct ApplicationDocument: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let kind: String
    let fileName: String
    let byteSize: Int
    /// pending, accepted or rejected.
    let status: String
    let reviewNote: String?
    let createdAt: Date
}

extension Array {
    /// Nil for an empty list, so an optional field is not sent at all.
    var nilIfEmpty: [Element]? { isEmpty ? nil : self }
}

extension String {
    /// Nil for an empty string, so `??` can fall through to the next answer.
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
