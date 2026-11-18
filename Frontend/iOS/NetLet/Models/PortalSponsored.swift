import Foundation

/// Sponsored products (migration 0089) — the web's `/admin/sponsored`. A store
/// asks for one of its products among the home page's first products on days
/// it chooses; NetLet approves at a day rate and asks for the payment; the
/// store pays from its earnings or by bank transfer, which NetLet confirms.
/// The server decides every state and every button (`sponsor.list`); the app
/// draws what it is sent and asks the server's own rules early.

/// The rules a sponsored request is checked by before it is sent
/// (`Shared/commerce/sponsorRequests.ts`): the same lengths, the same highest
/// day rate and the same days, tested on that file's own cases.
struct SponsorRules: Decodable, Sendable {
    struct Limits: Decodable, Sendable {
        let noteMax: Int
        let referenceMax: Int
        let maxRate: String
        let payWithinDays: Int
    }

    let sponsor: Limits

    static let shared: SponsorRules = {
        let data = Bundle.main.resource("portal", "json")
        return (try? JSONDecoder().decode(SponsorRules.self, from: data)) ?? .fallback
    }()

    static let fallback = SponsorRules(sponsor: .init(noteMax: 400, referenceMax: 80, maxRate: "999.000", payWithinDays: 3))

    /// A real `yyyy-mm-dd` day: "2026-02-31" is not one.
    static func isDay(_ text: String) -> Bool {
        let parts = text.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
              parts.allSatisfy({ $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }),
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        let components = DateComponents(year: year, month: month, day: day)
        guard components.isValidDate(in: calendar) else { return false }
        return true
    }

    /// `rateProblem`: a day rate above nothing, in dinars and up to three decimals.
    func rateProblem(_ rate: String) -> String? {
        let text = rate.trimmingCharacters(in: .whitespacesAndNewlines)
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        let digits: (Substring) -> Bool = { !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } }
        guard (1...2).contains(parts.count), digits(parts[0]), parts[0].count <= 6,
              parts.count == 1 || (digits(parts[1]) && parts[1].count <= 3),
              let fils = Money.parseFils(text), fils > 0 else { return "sponsor.rateBad" }
        if fils > (Money.parseFils(sponsor.maxRate) ?? Int.max) { return "sponsor.rateTooHigh" }
        return nil
    }

    /// `payByProblem`: a real day, not past, and not after the run's first day
    /// (today, when that has passed).
    func payByProblem(_ payBy: String, startsOn: String, today: String) -> String? {
        guard Self.isDay(payBy) else { return "sponsor.payByBad" }
        if payBy < today { return "sponsor.payByPast" }
        let latest = startsOn < today ? today : startsOn
        if payBy > latest { return "sponsor.payByLate" }
        return nil
    }

    /// `referenceProblem`: the bank's reference, three characters at least.
    func referenceProblem(_ reference: String) -> String? {
        let text = reference.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if text.utf16.count < 3 { return "sponsor.referenceNeeded" }
        if text.utf16.count > sponsor.referenceMax { return "sponsor.referenceTooLong" }
        return nil
    }

    /// `defaultPayBy`: three days from today, never after the first day, and today once it has passed.
    func defaultPayBy(startsOn: String, today: String) -> String {
        if startsOn <= today { return today }
        let within = AdWords.addDays(today, sponsor.payWithinDays)
        return within < startsOn ? within : startsOn
    }

    /// `approvedRun`: what NetLet asks to be paid for — the days still to come,
    /// at the rate it chose — or nil while the rate is not one.
    func approvedRun(startsOn: String, endsOn: String, today: String, rate: String) -> (startsOn: String, days: Int, total: Money)? {
        guard rateProblem(rate) == nil, let fils = Money.parseFils(rate.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        let first = startsOn < today ? today : startsOn
        let days = max(0, AdWords.daysInclusive(first, endsOn))
        return (first, days, Money(fils: fils * days))
    }
}

/// What a request would cost and whether it can be sent (`sponsor.quote`).
struct SponsorQuote: Decodable, Sendable {
    let ready: Bool
    let cost: Money
    let dailyRate: Money
    let fullDays: [String]
    let room: Money
    let problem: String?
}

/// One request, as `sponsor.list` sends it: the server's state, step and buttons.
struct SponsorRow: Decodable, Identifiable, Hashable, Sendable {
    struct Placement: Decodable, Hashable, Sendable {
        let state: String
        let startsOn: String
        let endsOn: String
        let cancelledOn: String?
        let accrued: Money
    }

    struct Actions: Decodable, Hashable, Sendable {
        let approve: Bool
        let decline: Bool
        let payFromEarnings: Bool
        let sendTransfer: Bool
        let confirmPayment: Bool
        let notReceived: Bool
        let withdraw: Bool
        let stop: Bool

        var any: Bool { approve || decline || payFromEarnings || sendTransfer || confirmPayment || notReceived || withdraw || stop }
    }

    struct Results: Decodable, Hashable, Sendable {
        let daysShown: Int
        let homeViews: Int
        let homeVisitors: Int
        let viewsBefore: Int
        let lift: Int?
        let orders: Int
    }

    let id: Int
    let vendorId: Int
    let vendorName: String
    let productId: Int?
    let productTitle: String
    let productHandle: String?
    let photo: String?
    let startsOn: String
    let endsOn: String
    let days: Int
    let dailyRate: Money
    let total: Money
    let status: String
    let state: String
    let step: String
    let stopped: Bool
    let note: String?
    let reply: String?
    let payBy: String?
    let suggestedPayBy: String
    let paidWith: String?
    let paymentReference: String?
    let transferReference: String
    let placement: Placement?
    let actions: Actions
    let refundIfStopped: Money?
    let storeRoom: Money?
    let results: Results?

    static let steps = ["requested", "payment", "live", "ended"]
}

/// A page of requests with each view's count, NetLet's bank account and the store's room.
struct SponsorList: Decodable, Sendable {
    struct Counts: Decodable, Sendable {
        let todo: Int
        let open: Int
        let live: Int
        let done: Int
        let all: Int

        func of(_ view: String) -> Int {
            switch view {
            case "todo": return todo
            case "open": return open
            case "live": return live
            case "done": return done
            default: return all
            }
        }
    }

    struct Transfer: Decodable, Sendable {
        let name: String
        let iban: String
    }

    let ready: Bool
    let counts: Counts
    let transfer: Transfer?
    let room: Money?
    let rateCard: Money
    let capacity: Int
    let rows: [SponsorRow]
    let total: Int
    let page: Int
    let pageSize: Int
}

struct SponsorWaiting: Decodable, Sendable {
    let forNetLet: Int
    let toPay: Int
}

struct SponsorSent: Decodable, Sendable {
    let id: Int
    let total: Money
}

struct SponsorRefund: Decodable, Sendable {
    let refund: Money?
}

extension API {
    struct SponsorAsk: Encodable, Sendable {
        let productId: Int
        let startsOn: String
        let days: Int
        var note: String?
    }

    struct SponsorPage: Encodable, Sendable {
        let view: String
        let page: Int
    }

    struct SponsorApproval: Encodable, Sendable {
        let id: Int
        let dailyRate: String
        let payBy: String
        let reply: OrNull<String>
    }

    struct SponsorReply: Encodable, Sendable {
        let id: Int
        let reply: String
        var payBy: String?
    }

    struct SponsorTransfer: Encodable, Sendable {
        let id: Int
        let reference: String
    }

    struct SponsorConfirmation: Encodable, Sendable {
        let id: Int
        let startsOn: OrNull<String>
    }

    static let sponsorQuote = Procedure<SponsorAsk, SponsorQuote>(query: "sponsor.quote")
    static let sponsorRequest = Procedure<SponsorAsk, SponsorSent>(mutation: "sponsor.request")
    static let sponsorList = Procedure<SponsorPage, SponsorList>(query: "sponsor.list")
    static let sponsorWaiting = Procedure<NoInput, SponsorWaiting>(query: "sponsor.waiting")
    static let sponsorApprove = Procedure<SponsorApproval, Acknowledged>(mutation: "sponsor.approve")
    static let sponsorDecline = Procedure<SponsorReply, SponsorRefund>(mutation: "sponsor.decline")
    static let sponsorPayFromEarnings = Procedure<RowId, Acknowledged>(mutation: "sponsor.payFromEarnings")
    static let sponsorSendTransfer = Procedure<SponsorTransfer, Acknowledged>(mutation: "sponsor.sendTransfer")
    static let sponsorConfirm = Procedure<SponsorConfirmation, Acknowledged>(mutation: "sponsor.confirmPayment")
    static let sponsorNotReceived = Procedure<SponsorReply, Acknowledged>(mutation: "sponsor.notReceived")
    static let sponsorWithdraw = Procedure<RowId, Acknowledged>(mutation: "sponsor.withdraw")
    static let sponsorStop = Procedure<RowId, SponsorRefund>(mutation: "sponsor.stop")
}
