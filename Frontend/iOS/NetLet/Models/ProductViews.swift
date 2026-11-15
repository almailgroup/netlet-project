import Foundation

/// How many people opened a store's product pages, in the app or on the
/// website, where they came from, and what came of it (`inventory.views`,
/// `ViewsReport` in `Shared/commerce/productViews.ts`). Every figure and every
/// reading of demand is the server's; the app only draws it.
struct ViewsReport: Decodable, Hashable, Sendable {
    /// Views by channel, with the website's two as the server names them.
    struct Channels: Decodable, Hashable, Sendable {
        let app: Int
        let webPhone: Int
        let webComputer: Int

        enum CodingKeys: String, CodingKey {
            case app
            case webPhone = "web_phone"
            case webComputer = "web_computer"
        }

        func value(_ channel: String) -> Int {
            switch channel {
            case "app": app
            case "web_phone": webPhone
            default: webComputer
            }
        }
    }

    struct Day: Decodable, Hashable, Identifiable, Sendable {
        let day: String
        let views: Int
        let visitors: Int
        let channels: Channels

        var id: String { day }
    }

    struct Before: Decodable, Hashable, Sendable {
        let day: String
        let views: Int
    }

    struct CountChange: Decodable, Hashable, Sendable {
        let current: Int
        let previous: Int
        let change: Double?
    }

    struct Totals: Decodable, Hashable, Sendable {
        let views: CountChange
        let visitors: CountChange
        let orders: CountChange
    }

    struct Channel: Decodable, Hashable, Identifiable, Sendable {
        let channel: String
        let views: Int
        let visitors: Int
        let percent: Int

        var id: String { channel }
    }

    struct Source: Decodable, Hashable, Identifiable, Sendable {
        let source: String
        let views: Int
        let visitors: Int
        let percent: Int

        var id: String { source }
    }

    struct ProductRow: Decodable, Hashable, Identifiable, Sendable {
        let productId: Int
        let title: String
        let titleAr: String?
        let handle: String
        let image: String?
        /// The store's name, on an administrator's list across stores.
        let vendorName: String?
        let published: Bool
        let views: Int
        let visitors: Int
        let previousViews: Int
        let change: Double?
        let channels: Channels
        let inCarts: Int
        let units: Int
        let orders: Int
        let conversion: Double?
        /// unseen, few, notBuying, some or strong.
        let demand: String

        var id: Int { productId }
    }

    let range: Int
    /// False before migration 0084 is pasted: nothing is counted yet.
    let ready: Bool
    let days: [Day]
    let previousDays: [Before]
    let totals: Totals
    let channels: [Channel]
    let sources: [Source]
    let conversion: Double?
    let products: [ProductRow]
    let productCount: Int
}
