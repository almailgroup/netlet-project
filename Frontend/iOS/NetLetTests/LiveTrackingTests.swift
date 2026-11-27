import XCTest
@testable import NetLet

/// An order on its way, followed on the Lock Screen (option 6 of the owner's
/// list): which orders show, and what the card says, composed from the
/// recorded orders by the order page's own rules in both languages.
final class LiveTrackingTests: XCTestCase {
    let client = Fixtures.client

    private func recorded(_ variant: String?) -> TRPCClient {
        TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: variant))
    }

    @MainActor
    private func language(_ language: Language) -> LanguageSettings {
        let settings = LanguageSettings(defaults: UserDefaults(suiteName: "LiveTrackingTests-\(language.rawValue)")!)
        settings.set(language)
        return settings
    }

    func testTheNewestOrdersOnTheirWayShowAndTheRestAreSettled() {
        XCTAssertEqual(
            LiveTrackingPlan.acts(onTheWay: ["A", "B", "C", "D"], showing: ["B", "Z"], canStart: true, limit: 3),
            [.show(reference: "A", start: true), .show(reference: "B", start: false), .show(reference: "C", start: true), .settle(reference: "Z")]
        )
        // From the background nothing new can start; what is up is still brought up to date.
        XCTAssertEqual(
            LiveTrackingPlan.acts(onTheWay: ["A", "B"], showing: ["B"], canStart: false, limit: 3),
            [.show(reference: "B", start: false)]
        )
        // An order listed twice is shown once, and one past the limit is settled rather than left.
        XCTAssertEqual(
            LiveTrackingPlan.acts(onTheWay: ["A", "A", "B"], showing: ["C"], canStart: true, limit: 1),
            [.show(reference: "A", start: true), .settle(reference: "C")]
        )
        XCTAssertEqual(LiveTrackingPlan.acts(onTheWay: [], showing: [], canStart: true, limit: 3), [])
    }

    /// The recorded order on its way, with no driver sharing a position: the
    /// card says "On the way", from which store, and the store's estimate —
    /// later than it, as the order page says.
    @MainActor
    func testTheCardSaysWhereTheRecordedOrderIs() async throws {
        let read = try await recorded("ontheway").call(API.order, .init(reference: "NL-20261104-HMGQQ"))
        let order = try XCTUnwrap(read)
        let english = language(.en)
        let state = try XCTUnwrap(OrderActivityContent.state(for: order, tracked: [], language: english))
        XCTAssertEqual(state.step, 2)
        XCTAssertFalse(state.arrived)
        XCTAssertEqual(state.headline, english.t("track.onTheWay"))
        XCTAssertEqual(state.labels, OrderActivityContent.labelKeys.map { english.t($0) })
        XCTAssertNil(state.minutes, "no driver is sharing a position")
        let detail = try XCTUnwrap(state.detail)
        XCTAssertTrue(detail.contains("Acme Electronics"), detail)
        let promise = try XCTUnwrap(order.steps?.parcels.first?.promise)
        let late = try XCTUnwrap(ParcelStepsCard.promiseText(promise, english))
        XCTAssertTrue(late.late)
        XCTAssertTrue(detail.contains(late.text), "the store's estimate, as the order page words it: \(detail)")
        XCTAssertFalse(state.rightToLeft)
        XCTAssertEqual(state.title, english.t("ios.live.title", ["reference": "NL-20261104-HMGQQ"]))
        XCTAssertNotEqual(state.staleLine, "ios.live.stale")

        let arabic = language(.ar)
        let inArabic = try XCTUnwrap(OrderActivityContent.state(for: order, tracked: [], language: arabic))
        XCTAssertTrue(inArabic.rightToLeft)
        XCTAssertEqual(inArabic.headline, arabic.t("track.onTheWay"))
        XCTAssertNotEqual(inArabic.headline, state.headline, "the card is in the shop's language")
    }

    /// Once a driver shares a position, their minutes lead the card and the
    /// Dynamic Island carries them short; close by, it says the parcel is arriving.
    @MainActor
    func testTheDriversMinutesLeadOnceADriverSharesAPosition() async throws {
        let read = try await recorded("ontheway").call(API.order, .init(reference: "NL-20261104-HMGQQ"))
        let order = try XCTUnwrap(read)
        let english = language(.en)
        let driving = TrackedParcel(courierName: "Fast Couriers", sellers: ["Acme Electronics"], doorLabel: nil, driver: nil, recordedAt: Date(), door: nil, eta: .init(kind: "band", low: 15, high: 20, source: "traffic"))
        let state = try XCTUnwrap(OrderActivityContent.state(for: order, tracked: [driving], language: english))
        XCTAssertEqual(state.headline, english.t("tracking.band", ["low": "15", "high": "20"]))
        XCTAssertEqual(state.minutes, english.t("ios.live.minutes", ["low": "15", "high": "20"]))
        let detail = try XCTUnwrap(state.detail)
        let promise = try XCTUnwrap(order.steps?.parcels.first?.promise)
        let estimate = try XCTUnwrap(ParcelStepsCard.promiseText(promise, english)).text
        XCTAssertFalse(detail.contains(estimate), "the driver's minutes stand in for the store's estimate: \(detail)")

        let close = TrackedParcel(courierName: "", sellers: ["Acme Electronics"], doorLabel: nil, driver: nil, recordedAt: Date(), door: nil, eta: .init(kind: "arriving", low: nil, high: nil, source: nil))
        let arriving = try XCTUnwrap(OrderActivityContent.state(for: order, tracked: [close], language: english))
        XCTAssertEqual(arriving.headline, english.t("tracking.arriving"))
        XCTAssertEqual(arriving.minutes, english.t("ios.live.now"))
    }

    /// A delivered order says so, with the day, and its card ends on that.
    @MainActor
    func testADeliveredOrderSaysSo() async throws {
        let read = try await recorded(nil).call(API.order, .init(reference: "NL-20261001-J7MWY"))
        let order = try XCTUnwrap(read)
        let english = language(.en)
        let state = try XCTUnwrap(OrderActivityContent.state(for: order, tracked: [], language: english))
        XCTAssertTrue(state.arrived)
        XCTAssertEqual(state.step, 3)
        let arrived = try XCTUnwrap(order.steps?.parcels.first?.deliveredAt)
        XCTAssertEqual(state.headline, english.t("track.deliveredOn", ["date": DeliveryLine.shortDay(arrived, english.current)]))
        XCTAssertNil(state.minutes)
    }

    /// A press on the card opens the order in the app.
    @MainActor
    func testAPressOnTheCardOpensTheOrder() {
        let url = OrderActivityLink.url("NL-20261104-HMGQQ")
        XCTAssertEqual(url.absoluteString, "netlet:///account/orders?order=NL-20261104-HMGQQ")
        let link = url.path + (url.query.map { "?\($0)" } ?? "")
        XCTAssertEqual(Route.from(link: link), .order(reference: "NL-20261104-HMGQQ"))
    }
}
