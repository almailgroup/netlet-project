import ActivityKit
import BackgroundTasks
import Foundation

/// Which orders are followed on the Lock Screen, decided apart from ActivityKit
/// so the rule can be tested: the newest orders on their way, at most
/// `limit`, each shown once — started where the app may start one (only in
/// the foreground) and brought up to date where one is already up — and every
/// activity whose order is no longer on its way settled, which says how it
/// ended.
enum LiveTrackingPlan {
    enum Act: Equatable {
        case show(reference: String, start: Bool)
        case settle(reference: String)
    }

    static func acts(onTheWay: [String], showing: [String], canStart: Bool, limit: Int) -> [Act] {
        var seen = Set<String>()
        let wanted = Array(onTheWay.filter { seen.insert($0).inserted }.prefix(max(limit, 0)))
        var acts: [Act] = []
        for reference in wanted {
            if showing.contains(reference) {
                acts.append(.show(reference: reference, start: false))
            } else if canStart {
                acts.append(.show(reference: reference, start: true))
            }
        }
        var settled = Set<String>()
        for reference in showing where !wanted.contains(reference) && settled.insert(reference).inserted {
            acts.append(.settle(reference: reference))
        }
        return acts
    }
}

/// The words on the Lock Screen, composed from what the order page reads —
/// the order's parcels (`orders.get`) and the driver's position
/// (`orders.tracking`) — in the shop's language, by the order page's own
/// rules: where the parcel is, the driver's minutes while one is sharing a
/// position, otherwise the store's estimate.
@MainActor
enum OrderActivityContent {
    static let labelKeys = ["track.placed", "track.preparing", "track.onTheWay", "track.delivered"]

    static func state(for detail: OrderDetail, tracked: [TrackedParcel], language l: LanguageSettings) -> OrderActivityAttributes.ContentState? {
        guard let steps = detail.steps, !steps.cancelled, let first = steps.parcels.first else { return nil }
        let coming = steps.parcels.filter { $0.step != "delivered" }
        let arrived = coming.isEmpty
        // The parcel on the road, else the one furthest behind, else the last to arrive.
        let parcel = coming.first { $0.step == "onTheWay" } ?? coming.min { $0.reached < $1.reached } ?? first
        let eta = arrived ? nil : etaFor(parcel, in: tracked)
        let labels = labelKeys.map { l.t($0) }
        let headline: String
        if arrived {
            let last = steps.parcels.compactMap(\.deliveredAt).max()
            headline = last.map { l.t("track.deliveredOn", ["date": DeliveryLine.shortDay($0, l.current)]) } ?? l.t("track.delivered")
        } else if let eta, eta.kind == "arriving" {
            headline = l.t("tracking.arriving")
        } else if let eta, eta.kind == "band", let low = eta.low, let high = eta.high {
            headline = l.t("tracking.band", ["low": "\(low)", "high": "\(high)"])
        } else {
            headline = labels[min(max(parcel.reached, 0), labels.count - 1)]
        }
        var parts: [String] = []
        if let store = parcel.vendorName, !store.isEmpty {
            parts.append(l.t("track.from", ["store": "\u{2068}\(store)\u{2069}"]))
        }
        if !arrived, eta == nil, let promise = ParcelStepsCard.promiseText(parcel.promise, l) {
            parts.append(promise.text)
        }
        if coming.count > 1 { parts.append(l.t("ios.live.moreParcels")) }
        var minutes: String?
        if let eta, eta.kind == "arriving" {
            minutes = l.t("ios.live.now")
        } else if let eta, eta.kind == "band", let low = eta.low, let high = eta.high {
            minutes = l.t("ios.live.minutes", ["low": "\(low)", "high": "\(high)"])
        }
        return .init(
            step: arrived ? labels.count - 1 : parcel.reached,
            arrived: arrived,
            headline: headline,
            detail: parts.isEmpty ? nil : parts.joined(separator: " · "),
            minutes: minutes,
            labels: labels,
            rightToLeft: l.current.isRightToLeft,
            staleLine: l.t("ios.live.stale"),
            title: l.t("ios.live.title", ["reference": detail.order.reference])
        )
    }

    /// The driver's estimate for this parcel: the tracked parcel its store is
    /// among, else the first one with an estimate.
    static func etaFor(_ parcel: ParcelSteps, in tracked: [TrackedParcel]) -> TrackedParcel.Eta? {
        let named = tracked.first { carried in
            carried.eta != nil && parcel.vendorName.map { carried.sellers.contains($0) } == true
        }
        return (named ?? tracked.first { $0.eta != nil })?.eta
    }
}

/// Follows orders on their way on the Lock Screen and in the Dynamic Island —
/// option 6 of the owner's list, "live tracking on the lock screen". An app may
/// start a Live Activity only while it is open, and change one only while it
/// runs, so this reads the orders when the app opens or comes back, every
/// `followEvery` while it stays open, and whenever iOS gives it a background
/// refresh (`refreshTask`); until NetLet sends pushes (an APNs key), that is
/// as live as it gets, and the card says so once it is half an hour old
/// (`staleAfter`). Never in the recorded demo, a UI test or a screenshot run,
/// and not when the shopper or the iPhone's Settings turned it off.
@MainActor
final class LiveTracking {
    static let refreshTask = "com.netlet.marketplace.tracking"
    static let switchKey = "netlet.liveTracking"
    static let mostOrders = 3
    static let staleAfter: TimeInterval = 30 * 60
    /// How long a delivered order stays on the Lock Screen.
    static let keepDelivered: TimeInterval = 60 * 60
    static let followEvery: Duration = .seconds(90)
    static let backgroundEvery: TimeInterval = 15 * 60

    private let api: APICalling
    private let language: LanguageSettings
    private let defaults: UserDefaults
    private let isDemo: Bool
    private var following: Task<Void, Never>?
    private var syncing = false

    init(api: APICalling, language: LanguageSettings, defaults: UserDefaults = .standard, isDemo: Bool) {
        self.api = api
        self.language = language
        self.defaults = defaults
        self.isDemo = isDemo
    }

    /// The shopper's own switch in Preferences, on until turned off.
    var switchedOn: Bool {
        defaults.object(forKey: Self.switchKey) as? Bool ?? true
    }

    /// Whether the iPhone lets NetLet show Live Activities (Settings → NetLet).
    var systemAllows: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    private var allowed: Bool {
        !isDemo && !UITestHooks.on && UserDefaults.standard.string(forKey: "NetLetOpen") == nil && switchedOn && systemAllows
    }

    private var showing: [Activity<OrderActivityAttributes>] {
        Activity<OrderActivityAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
    }

    var isShowing: Bool { !showing.isEmpty }

    /// The switch turned: off ends what is up; on reads the orders at once.
    func setSwitchedOn(_ on: Bool, signedIn: Bool) async {
        defaults.set(on, forKey: Self.switchKey)
        if on {
            await sync(signedIn: signedIn, canStart: true)
        } else {
            stopFollowing()
            await endAll()
        }
    }

    /// Brings the Lock Screen in line with the orders on their way.
    func sync(signedIn: Bool, canStart: Bool) async {
        guard !syncing else { return }
        syncing = true
        defer { syncing = false }
        guard signedIn, allowed else {
            if !isShowing { return }
            await endAll()
            return
        }
        let api = api
        // A list that could not be read changes nothing: the cards stay as they were.
        guard let page = try? await api.call(API.orders, .init(page: 1, pageSize: Self.mostOrders, view: "onTheWay")) else { return }
        let current = showing
        let acts = LiveTrackingPlan.acts(
            onTheWay: page.rows.map(\.reference),
            showing: current.map(\.attributes.reference),
            canStart: canStart,
            limit: Self.mostOrders
        )
        for act in acts {
            switch act {
            case .show(let reference, let start):
                guard case .found(let detail, let tracked) = await read(reference, tracking: true),
                      let state = OrderActivityContent.state(for: detail, tracked: tracked, language: language) else { continue }
                let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter))
                if start {
                    _ = try? Activity.request(attributes: OrderActivityAttributes(reference: reference), content: content, pushType: nil)
                } else {
                    for activity in current where activity.attributes.reference == reference {
                        await activity.update(content)
                    }
                }
            case .settle(let reference):
                let found = await read(reference, tracking: false)
                for activity in current where activity.attributes.reference == reference {
                    switch found {
                    case .failed:
                        // Not read: left as it is, to say it is old when it is.
                        break
                    case .missing:
                        await activity.end(nil, dismissalPolicy: .immediate)
                    case .found(let detail, _):
                        guard let state = OrderActivityContent.state(for: detail, tracked: [], language: language) else {
                            // Cancelled: nothing left to follow.
                            await activity.end(nil, dismissalPolicy: .immediate)
                            continue
                        }
                        if state.arrived {
                            await activity.end(ActivityContent(state: state, staleDate: nil), dismissalPolicy: .after(Date().addingTimeInterval(Self.keepDelivered)))
                        } else {
                            await activity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(Self.staleAfter)))
                        }
                    }
                }
            }
        }
    }

    /// Every NetLet activity put away at once: signing out, or the switch off.
    func endAll() async {
        for activity in Activity<OrderActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// While the app stays open and something is on the Lock Screen, reads
    /// the orders again every `followEvery`.
    func follow() {
        following?.cancel()
        guard isShowing else { following = nil; return }
        following = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: LiveTracking.followEvery)
                guard !Task.isCancelled, let self, self.isShowing else { return }
                await self.sync(signedIn: true, canStart: true)
            }
        }
    }

    func stopFollowing() {
        following?.cancel()
        following = nil
    }

    /// Asks iOS for a background refresh while something is on the Lock
    /// Screen, or (`alsoFor`) the order widget follows an order still coming.
    func scheduleRefresh(alsoFor widgetOrder: Bool = false) {
        guard isShowing || widgetOrder else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTask)
        request.earliestBeginDate = Date().addingTimeInterval(Self.backgroundEvery)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// A background refresh: the cards brought up to date (nothing new can be
    /// started from the background), and the next one asked for.
    func refreshInBackground(alsoFor widgetOrder: Bool = false) async {
        await sync(signedIn: true, canStart: false)
        scheduleRefresh(alsoFor: widgetOrder)
    }

    private enum Read {
        case found(OrderDetail, [TrackedParcel])
        case missing
        case failed
    }

    /// The order and, while it is on its way, the driver's position — asked together.
    private func read(_ reference: String, tracking: Bool) async -> Read {
        let api = api
        let detail = Task { try await api.call(API.order, .init(reference: reference)) }
        let parcels = Task { () -> [TrackedParcel] in
            guard tracking else { return [] }
            return (try? await api.call(API.tracking, .init(reference: reference))) ?? []
        }
        do {
            guard let found = try await detail.value else { return .missing }
            return .found(found, await parcels.value)
        } catch {
            return .failed
        }
    }
}
