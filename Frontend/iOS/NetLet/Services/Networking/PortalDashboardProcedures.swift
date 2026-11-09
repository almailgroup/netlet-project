import Foundation

/// The portal's dashboard, the shelf's health, the co-pilot and the reorder
/// point — each the procedure the web's overview, stock page and co-pilot call.
/// Scope is the server's: a store reads its own lines and shelf, NetLet's
/// administrator the whole shop, and the co-pilot is told only what the
/// person's own pages would show.
extension API {
    struct DashboardPeriod: Encodable, Sendable {
        let range: Int
    }

    struct CopilotQuestion: Encodable, Sendable {
        struct Turn: Encodable, Sendable {
            /// "admin" for the person asking, "copilot" for an earlier answer.
            let role: String
            let text: String
        }

        let turns: [Turn]
        let locale: String
    }

    struct ReorderPoint: Encodable, Sendable {
        let variantId: Int
        let lowStockAt: OrNull<Int>
    }

    static let dashboard = Procedure<DashboardPeriod, PortalDashboard>(query: "inventory.dashboard")
    static let shelfHealth = Procedure<NoInput, ShelfHealth>(query: "inventory.stockHealth")
    static let copilotBrief = Procedure<NoInput, CopilotBrief>(query: "inventory.copilot.brief")
    static let copilotAsk = Procedure<CopilotQuestion, CopilotAnswer>(mutation: "inventory.copilot.ask")
    static let setReorderPoint = Procedure<ReorderPoint, ReorderSaved>(mutation: "inventory.variants.setReorderPoint")
}
