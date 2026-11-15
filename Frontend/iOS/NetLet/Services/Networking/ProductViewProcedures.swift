import Foundation

/// Product views (migration 0084, `Shared/commerce/productViews.ts`): one
/// opening counted for its store, and the store's report of them — the
/// procedures the web's product page and `/admin/views` call.
extension API {
    struct ViewRecord: Encodable, Sendable {
        let productId: Int
        /// "app" — the app is one channel; the website counts phone and computer apart.
        let channel: String
        let source: String
        let firstToday: Bool
    }

    struct ViewCounted: Decodable, Sendable {
        let counted: Bool
    }

    struct ViewsQuery: Encodable, Sendable {
        let range: Int
        var vendorId: Int? = nil
        var productId: Int? = nil
    }

    static let recordView = Procedure<ViewRecord, ViewCounted>(mutation: "commerce.recordView")
    static let productViews = Procedure<ViewsQuery, ViewsReport>(query: "inventory.views")
}
