import Foundation
import Observation
import UIKit

/// What the Profile tab draws beside who is signed in — the tiles' pictures,
/// the points, the phone, and which rows the account needs — kept by the app
/// rather than by the tab, so the tab opens on it, on the owner's word ("when
/// I first open my profile page, it takes a few seconds for everything to
/// load").
///
/// It took seconds because the tab asked one thing after another as it
/// opened: the unread counts, then the photo and the tiles, then the member
/// code, then whether there were standing orders, then price requests, then
/// the affiliate account — nine round trips in a row, each across to the
/// server and back. Now every read starts at once (`load`), the app's client
/// sends the ones asked together as one request (`ReadBatch`), and it is all
/// asked as soon as the app knows who is signed in (`AppModel.warmAccount`),
/// so by the time somebody presses Profile it is usually here. Opening the
/// tab again asks behind what it shows, at most once in `freshFor`.
@Observable
@MainActor
final class AccountHome {
    /// Whether the shopper holds a standing order, a price request or an
    /// affiliate account — what decides whether those rows are drawn.
    struct Holdings: Equatable {
        var subscriptions = false
        var offers = false
        var affiliate = false
    }

    private(set) var holdings = Holdings()
    private(set) var orderPhotos: [String]?
    private(set) var savedPhotos: [String]?
    private(set) var frequentPhotos: [String]?
    private(set) var points: Int?
    /// The phone the driver calls, saved under Your profile — nil until asked.
    private(set) var phone: String??

    /// How long an answer is drawn without asking again when the tab opens.
    static let freshFor: TimeInterval = 30

    private let api: APICalling
    private let account: AccountServicing
    /// Fetches the tiles' pictures as soon as their addresses are known, so
    /// the tab draws them rather than outlines; nothing in a test.
    private let warm: @MainActor ([String]) -> Void
    private var loadedFor: Int?
    private var loadedAt: Date?

    init(api: APICalling, account: AccountServicing, warm: @escaping @MainActor ([String]) -> Void = { _ in }) {
        self.api = api
        self.account = account
        self.warm = warm
    }

    /// Fetches pictures into the image pipeline ahead of the tab, resolved
    /// against the shop's address — what `AppModel` hands `warm`.
    static func warmPhotos(resolve: @escaping (String?) -> URL?) -> @MainActor ([String]) -> Void {
        { references in
            let pixels = ImagePipeline.cardPixels(scale: UITraitCollection.current.displayScale)
            var seen = Set<URL>()
            let urls = references.compactMap { resolve($0) }.filter { seen.insert($0).inserted }
            guard !urls.isEmpty else { return }
            Task(priority: .utility) { await ImagePipeline.shared.prefetch(urls, pixels: pixels) }
        }
    }

    /// Whether what is held is this account's and recent enough to draw alone.
    func isFresh(for userId: Int, now: Date = Date()) -> Bool {
        guard loadedFor == userId, let loadedAt else { return false }
        return now.timeIntervalSince(loadedAt) < Self.freshFor
    }

    /// Everything the tab draws, asked at once. An answer that does not come
    /// leaves what was there, so a dropped connection never empties a tile
    /// that was drawn.
    func load(userId: Int, savedIds: [String], language: Language, affiliatesOn: Bool) async {
        if loadedFor != userId { forget() }
        let api = api
        let account = account
        let locale = language.rawValue
        let orders = Task { try? await api.call(API.orders, .init(page: 1, pageSize: 4)) }
        let rewards = Task { try? await api.call(API.rewards) }
        let details = Task { try? await account.profileDetails() }
        let frequent = Task { try? await api.call(API.frequentList, API.LocaleOnly(locale: locale)) }
        let standing = Task { try? await api.call(API.standingOrders) }
        let offers = Task { try? await api.call(API.priceRequests) }
        // The programme's own account matters only while its switch is off:
        // on, its row is drawn for everybody.
        let affiliate = Task { () -> AffiliateDashboard? in
            guard !affiliatesOn else { return nil }
            return (try? await api.call(API.affiliate)) ?? nil
        }
        let saved = Task { await Self.savedPhotos(api: api, ids: savedIds, locale: locale) }

        if let page = await orders.value {
            var seen = Set<String>()
            orderPhotos = page.rows.flatMap(\.summary.photos).filter { seen.insert($0).inserted }.prefix(4).map { $0 }
        } else if orderPhotos == nil {
            orderPhotos = []
        }
        if let photos = await saved.value { savedPhotos = photos } else if savedPhotos == nil { savedPhotos = [] }
        if let list = await frequent.value {
            var seen = Set<String>()
            frequentPhotos = list.items.compactMap { $0.product?.images.first?.url }.filter { seen.insert($0).inserted }.prefix(4).map { $0 }
        } else if frequentPhotos == nil {
            frequentPhotos = []
        }
        if let found = await details.value { phone = .some(found.phone) } else if phone == nil { phone = .some(nil) }
        if let balance = await rewards.value?.balance { points = balance }
        if let list = await standing.value { holdings.subscriptions = !list.isEmpty }
        if let list = await offers.value { holdings.offers = !list.isEmpty }
        if !affiliatesOn { holdings.affiliate = await affiliate.value != nil }
        warm((orderPhotos ?? []) + (savedPhotos ?? []) + (frequentPhotos ?? []))
        loadedFor = userId
        loadedAt = Date()
    }

    /// The Saved tile's pictures again, when the hearts change.
    func reloadSaved(ids: [String], language: Language) async {
        if let photos = await Self.savedPhotos(api: api, ids: ids, locale: language.rawValue) { savedPhotos = photos }
    }

    /// The phone the profile saved, when "Your profile" changes it.
    func setPhone(_ value: String?) {
        phone = .some(value)
    }

    /// Asked again the next time the tab opens — after an order is placed,
    /// whose pictures the Orders tile should show.
    func markStale() {
        loadedAt = nil
    }

    /// Nothing of the last account is drawn for the next.
    func forget() {
        holdings = Holdings()
        orderPhotos = nil
        savedPhotos = nil
        frequentPhotos = nil
        points = nil
        phone = nil
        loadedFor = nil
        loadedAt = nil
    }

    /// The first saved hearts' pictures (`commerce.products.byIds`); none to
    /// draw for none saved, and nil when the read did not answer.
    private static func savedPhotos(api: APICalling, ids: [String], locale: String) async -> [String]? {
        let first = Array(ids.prefix(4))
        guard !first.isEmpty else { return [] }
        guard let products = try? await api.call(API.productsByIds, .init(ids: first, locale: locale)) else { return nil }
        return products.compactMap { $0.images.first?.url }
    }
}
