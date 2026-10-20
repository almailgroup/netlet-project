import Foundation

/// The portal's menu and the permission model it is filtered by — the web's
/// `ADMIN_MENU` and `Shared/inventory/permissions.ts`, written to
/// `portal.json` by `pnpm ios:resources`, so the app's portal offers exactly
/// the pages the web's does to the same person. A hidden link is a courtesy,
/// never a control: the server refuses whatever the person may not do.
struct PortalRules: Decodable, Sendable {
    struct Link: Decodable, Hashable, Sendable {
        let href: String
        let label: String
        /// Any one of these is enough.
        let need: [String]

        private enum CodingKeys: String, CodingKey { case href, label, need }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            href = try container.decode(String.self, forKey: .href)
            label = try container.decode(String.self, forKey: .label)
            if let one = try? container.decode(String.self, forKey: .need) {
                need = [one]
            } else {
                need = try container.decode([String].self, forKey: .need)
            }
        }
    }

    struct Group: Decodable, Hashable, Sendable {
        let label: String?
        let links: [Link]
    }

    /// What the products list may do to many at once (`productBulk.ts`).
    struct Bulk: Decodable, Sendable {
        let actions: [String]
        let limit: Int
        let minPercent: Double
        let maxPercent: Double
        let maxRestock: Int

        func percentProblem(_ percent: Double) -> Bool { !(percent.isFinite && percent != 0 && percent >= minPercent && percent <= maxPercent) }
        func restockProblem(_ amount: Int) -> Bool { !(amount >= 1 && amount <= maxRestock) }
    }

    let menu: [Group]
    let ranks: [String: Int]
    let needs: [String: String]
    let adminOnly: [String]
    let courier: [String]
    var bulk: Bulk?
    /// Where a line may move from each state (`nextStates`).
    var fulfilment: [String: [String]]?
    var settlement: Settlement?
    var maxBankReference: Int?

    /// How long after the sale a seller's money comes due (`SETTLEMENT_DAYS`).
    struct Settlement: Decodable, Sendable {
        let cod: Int
        let cardMin: Int
        let cardMax: Int
    }

    func nextStates(_ state: String) -> [String] { fulfilment?[state] ?? [] }

    static let shared: PortalRules = {
        let data = Bundle.main.resource("portal", "json")
        return (try? JSONDecoder().decode(PortalRules.self, from: data))
            ?? PortalRules(menu: [], ranks: ["staff": 0, "manager": 1, "owner": 2], needs: [:], adminOnly: [], courier: ["delivery.view", "delivery.move"])
    }()

    init(menu: [Group], ranks: [String: Int], needs: [String: String], adminOnly: [String], courier: [String]) {
        self.menu = menu
        self.ranks = ranks
        self.needs = needs
        self.adminOnly = adminOnly
        self.courier = courier
    }

    /// `can`: an administrator reaches everything, a delivery company's
    /// people their board, and a store's people their own store at their rank.
    func can(_ actor: SellerIdentity, _ capability: String, vendorId: Int? = nil) -> Bool {
        switch actor.kind {
        case "admin": return true
        case "courier": return courier.contains(capability)
        case "vendor":
            if adminOnly.contains(capability) { return false }
            if let vendorId, vendorId != actor.vendorId { return false }
            guard let needed = needs[capability], let role = actor.role else { return false }
            return (ranks[role] ?? -1) >= (ranks[needed] ?? Int.max)
        default: return false
        }
    }

    func canAny(_ actor: SellerIdentity, _ capabilities: [String]) -> Bool {
        let own = actor.kind == "vendor" ? actor.vendorId : nil
        return capabilities.contains { can(actor, $0, vendorId: own) }
    }

    /// The menu this person may use, keeping only pages the app draws.
    func menu(for actor: SellerIdentity) -> [Group] {
        menu.map { group in
            Group(label: group.label, links: group.links.filter { PortalPage.draws($0.href) && canAny(actor, $0.need) })
        }
        .filter { !$0.links.isEmpty }
    }
}

/// A page of the portal the app draws, read off the web address that names
/// it, so a link, a tile and the menu all agree on what opens natively. An
/// address the app does not draw is nil, and nothing offers it.
enum PortalPage: Hashable, Sendable {
    case home
    case products(vendorId: Int?)
    case newProduct(vendorId: Int?)
    case orders
    case stock
    case offers
    case messages
    /// One shopper's conversation with the store — the app's own address for
    /// what the web opens beside the list.
    case thread(Int)
    case returns
    case team
    case payouts

    init?(_ href: String) {
        let parts = href.split(separator: "?", maxSplits: 1).map(String.init)
        let segments = parts[0].split(separator: "/").map(String.init)
        var query: [String: String] = [:]
        if parts.count > 1 {
            for pair in parts[1].split(separator: "&") {
                let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
                if kv.count == 2 { query[kv[0]] = kv[1].removingPercentEncoding ?? kv[1] }
            }
        }
        guard segments.first == "admin" else { return nil }
        let rest = Array(segments.dropFirst())
        let vendor = query["vendor"].flatMap(Int.init)
        switch rest.count {
        case 0: self = .home
        case 1 where rest[0] == "products": self = .products(vendorId: vendor)
        case 2 where rest[0] == "products" && rest[1] == "new": self = .newProduct(vendorId: vendor)
        case 2 where rest[0] == "messages":
            guard let id = Int(rest[1]) else { return nil }
            self = .thread(id)
        case 1:
            switch rest[0] {
            case "orders": self = .orders
            case "stock": self = .stock
            case "offers": self = .offers
            case "messages": self = .messages
            case "returns": self = .returns
            case "team": self = .team
            case "payouts": self = .payouts
            default: return nil
            }
        default: return nil
        }
    }

    static func draws(_ href: String) -> Bool { PortalPage(href) != nil }
}

extension SellerIdentity {
    /// Whether this account has a portal at all: a store's people, a
    /// delivery company's, or an administrator.
    var inPortal: Bool { kind == "vendor" || kind == "courier" || kind == "admin" }

    func can(_ capability: String, vendorId: Int? = nil) -> Bool {
        PortalRules.shared.can(self, capability, vendorId: vendorId)
    }

    /// The store this person acts for, when they act for one.
    var ownVendor: Int? { kind == "vendor" ? vendorId : nil }
}
