import Foundation

// MARK: The dashboard

/// What the portal opens on (`inventory.dashboard`, `Shared/commerce/dashboard.ts`):
/// the sales line with a week's estimate after it, the period against the one
/// before, revenue by department, who bought and who joined, the shelf's health
/// and what sold most. Every figure is the server's; the app only draws it.
struct PortalDashboard: Decodable, Hashable, Sendable {
    struct Change: Decodable, Hashable, Sendable {
        let current: Money
        let previous: Money
        let change: Double?
    }

    struct CountChange: Decodable, Hashable, Sendable {
        let current: Int
        let previous: Int
        let change: Double?
    }

    struct Day: Decodable, Hashable, Identifiable, Sendable {
        let day: String
        let sales: Money
        let orders: Int
        let customers: Int
        let averageOrder: Money

        var id: String { day }
    }

    struct Point: Decodable, Hashable, Identifiable, Sendable {
        let day: String
        let sales: Money

        var id: String { day }
    }

    struct Totals: Decodable, Hashable, Sendable {
        let sales: Change
        let orders: CountChange
        let averageOrder: Change
        let customers: CountChange
    }

    struct Department: Decodable, Hashable, Sendable {
        /// Null for a product filed nowhere, or the rest folded together (`other`).
        let slug: String?
        let other: Bool?
        let sales: Money
        let percent: Int
    }

    struct Top: Decodable, Hashable, Sendable {
        let productId: Int?
        let title: String
        let units: Int
        let sales: Money
        let percent: Int
    }

    struct Joined: Decodable, Hashable, Sendable {
        let day: String
        let count: Int
    }

    let range: Int
    let days: [Day]
    let previousDays: [Point]
    let forecast: [Point]
    let totals: Totals
    let departments: [Department]
    let top: [Top]
    /// Accounts opened each day — an administrator's alone, null for a store.
    let newAccounts: [Joined]?
    let stock: ShelfHealth
    let truncated: Bool
}

/// The shelf's four states, counted (`inventory.stockHealth`, `StockHealth`).
struct ShelfHealth: Decodable, Hashable, Sendable {
    let healthy: Int
    let low: Int
    let out: Int
    let preorder: Int

    var total: Int { healthy + low + out + preorder }

    func count(_ state: ShelfState) -> Int {
        switch state {
        case .healthy: return healthy
        case .low: return low
        case .out: return out
        case .preorder: return preorder
        }
    }
}

/// What one variant's shelf amounts to — `stockState`, the rule the stock
/// page's pills and the dashboard's counts share.
enum ShelfState: String, CaseIterable, Sendable {
    case healthy, low, out, preorder

    init(stock: Int, reorderAt: Int?, preorderStock: Int) {
        if stock <= 0 {
            self = preorderStock > 0 ? .preorder : .out
        } else if let reorderAt, stock <= reorderAt {
            self = .low
        } else {
            self = .healthy
        }
    }

    var label: String {
        switch self {
        case .healthy: return "dashboard.stockHealthy"
        case .low: return "dashboard.stockLow"
        case .out: return "dashboard.stockOut"
        case .preorder: return "dashboard.stockPreorder"
        }
    }
}

/// The dashboard's small rules, the TypeScript's own (`Shared/commerce/dashboard.ts`,
/// `Shared/ai/copilot.ts`), tested on their cases in `PortalDashboardTests`.
enum DashboardRules {
    /// The reorder point the co-pilot and the stock page suggest covers this many days.
    static let reorderCoverDays = 14
    static let maxReorderPoint = 100_000
    static let maxQuestion = 1000
    /// The co-pilot is sent at most this many turns of a conversation (`COPILOT_TURNS`, twice).
    static let maxTurns = 16
    static let ranges = [7, 30, 90]

    /// How many days a shelf lasts at the last four weeks' pace; nil with nothing on it or no sales.
    static func daysOfCover(stock: Int, soldLast28: Int) -> Int? {
        guard stock > 0, soldLast28 > 0 else { return nil }
        return stock * 28 / soldLast28
    }

    /// Two weeks of sales at the last four weeks' pace; nil with no sales.
    static func reorderFor(soldLast28: Int) -> Int? {
        guard soldLast28 > 0 else { return nil }
        let level = (soldLast28 * reorderCoverDays + 27) / 28
        return min(maxReorderPoint, max(1, level))
    }

    /// Each part's share in whole percentages that add up to a hundred, by the
    /// largest remainder (`wholePercents`), so a bar's labels never sum to 99.
    static func wholePercents(_ amounts: [Int]) -> [Int] {
        let whole = amounts.reduce(0, +)
        guard whole > 0 else { return amounts.map { _ in 0 } }
        let exact = amounts.map { Double($0) * 100 / Double(whole) }
        var out = exact.map { Int($0.rounded(.down)) }
        var given = out.reduce(0, +)
        let order = exact.enumerated().sorted { left, right in
            let a = left.element - left.element.rounded(.down)
            let b = right.element - right.element.rounded(.down)
            return a == b ? left.offset < right.offset : a > b
        }
        var index = 0
        while given < 100, index < order.count {
            out[order[index].offset] += 1
            given += 1
            index += 1
        }
        return out
    }

    /// What is wrong with a question before it is sent (`copilotProblem`), or nil.
    static func questionProblem(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "copilot.empty" }
        if trimmed.count > maxQuestion { return "copilot.tooLong" }
        if !ContactFilter.findings(trimmed).isEmpty { return "copilot.contact" }
        return nil
    }

    /// A department's name key by its slug, "Not in a department" for none (`departmentLabel`).
    static func departmentLabel(_ slug: String?) -> String {
        ReferenceData.shared.departments.first { $0.slug == slug }?.label ?? "dashboard.unfiled"
    }
}

// MARK: The co-pilot

/// The co-pilot's brief and whether a question can be asked (`inventory.copilot.brief`).
struct CopilotBrief: Decodable, Hashable, Sendable {
    let insights: [CopilotInsight]
    let ask: Bool
    /// How many customers wait on NetLet, so the sheet offers to summarise them.
    let inquiries: Int
}

/// One line of the brief: a message key with its parameters, a tone, perhaps a
/// count, and the one act that answers it (`Insight`).
struct CopilotInsight: Decodable, Hashable, Sendable {
    let tone: String
    let key: String
    let params: [String: CopilotParam]
    /// Parameters that are themselves words, said in the page's language.
    let words: [String: String]?
    let count: Int?
    let action: CopilotAction?
}

/// A parameter is a word or a number on the wire.
struct CopilotParam: Decodable, Hashable, Sendable {
    let text: String

    init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if let number = try? single.decode(Int.self) {
            text = "\(number)"
        } else if let number = try? single.decode(Double.self) {
            text = number.rounded() == number ? "\(Int(number))" : "\(number)"
        } else {
            text = try single.decode(String.self)
        }
    }
}

/// An act the co-pilot proposes: open a page, or set a variant's reorder
/// point. The page does it, only on Confirm (`CopilotAction`).
struct CopilotAction: Decodable, Hashable, Sendable {
    let kind: String
    let page: String?
    let variantId: Int?
    let level: Int?
    let product: String?
}

/// One answer from the model, or why there is none (`CopilotAnswer`).
struct CopilotAnswer: Decodable, Sendable {
    let kind: String
    let text: String?
    let actions: [CopilotAction]?
    let reason: String?
}

/// A reorder point as the server saved it.
struct ReorderSaved: Decodable, Sendable {
    let variantId: Int
    let lowStockAt: Int?
}
