import Foundation
import WidgetKit

/// Keeps the home screen widgets supplied, on the owner's word (option 8 of
/// the list, "a home screen widget"). The deals widget asks NetLet itself —
/// deals are public — and needs only the app's language from here; the order
/// widget can ask nothing, having no session, so the app reads the newest
/// order still coming (else the newest order at all) and leaves its words,
/// composed by the Lock Screen's own rules (`OrderActivityContent`), in the
/// Keychain group the two share (`SharedShelf`). It runs when the app opens or
/// comes back, after a sign-in, a sign-out, a change of language and a
/// background refresh — never in the recorded demo, a UI test or a
/// screenshot run, which would leave a stranger's order on a developer's
/// home screen.
@MainActor
final class WidgetFeed {
    static let dealsKind = "NetLetDeals"
    static let orderKind = "NetLetOrder"
    /// A refresh sooner than this after the last is skipped, unless asked for.
    static let resting: TimeInterval = 60

    private let api: APICalling
    private let language: LanguageSettings
    private let isDemo: Bool
    private var last: WidgetSnapshot?
    private var lastRead: Date?
    private var reading = false

    init(api: APICalling, language: LanguageSettings, isDemo: Bool) {
        self.api = api
        self.language = language
        self.isDemo = isDemo
    }

    private var allowed: Bool {
        !isDemo && !UITestHooks.on && UserDefaults.standard.string(forKey: "NetLetOpen") == nil
    }

    /// Which order the widget follows, decided apart from the reads so it can
    /// be tested: one on its way first, else the newest of all.
    static func reference(onTheWay: [String], newest: [String]) -> String? {
        onTheWay.first ?? newest.first
    }

    /// Reads the order and writes what the widgets show. A read that fails
    /// changes nothing: the widget keeps what it had, and says it is old once
    /// it is.
    func refresh(signedIn: Bool, force: Bool = false) async {
        guard allowed, !reading else { return }
        if !force, let lastRead, Date().timeIntervalSince(lastRead) < Self.resting, last?.language == language.current.rawValue, last?.signedIn == signedIn {
            return
        }
        reading = true
        defer { reading = false }
        var order: WidgetSnapshot.Order?
        if signedIn {
            let api = api
            guard let coming = try? await api.call(API.orders, .init(page: 1, pageSize: 1, view: "onTheWay")) else { return }
            var newest: [String] = []
            if coming.rows.isEmpty {
                guard let all = try? await api.call(API.orders, .init(page: 1, pageSize: 1)) else { return }
                newest = all.rows.map(\.reference)
            }
            if let reference = Self.reference(onTheWay: coming.rows.map(\.reference), newest: newest) {
                let tracked = Task { (try? await api.call(API.tracking, .init(reference: reference))) ?? [] }
                let read: OrderDetail?
                do {
                    read = try await api.call(API.order, .init(reference: reference))
                } catch {
                    return
                }
                let parcels = await tracked.value
                if let detail = read, let state = OrderActivityContent.state(for: detail, tracked: parcels, language: language) {
                    order = .init(reference: reference, state: state)
                }
            }
        }
        lastRead = Date()
        write(WidgetSnapshot(language: language.current.rawValue, signedIn: signedIn, order: order, written: Date()))
    }

    /// Whether the order widget follows an order that has not arrived, which
    /// is worth a background refresh.
    var followsAnOrder: Bool {
        last?.order.map { !$0.state.arrived } ?? false
    }

    /// Signing out takes the order off the home screen at once.
    func signedOut() {
        guard allowed else { return }
        lastRead = nil
        write(WidgetSnapshot(language: language.current.rawValue, signedIn: false, order: nil, written: Date()))
    }

    private func write(_ snapshot: WidgetSnapshot) {
        let languageMoved = last?.language != snapshot.language
        guard SharedShelf.write(snapshot) else { return }
        last = snapshot
        WidgetCenter.shared.reloadTimelines(ofKind: Self.orderKind)
        if languageMoved { WidgetCenter.shared.reloadTimelines(ofKind: Self.dealsKind) }
    }
}
