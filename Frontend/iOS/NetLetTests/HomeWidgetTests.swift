import XCTest
@testable import NetLet

/// The home screen widgets (option 8 of the owner's list): which products are
/// today's deals, what the order widget shows from what the app left, which
/// order the app hands it, and where a press on either opens the app.
final class HomeWidgetTests: XCTestCase {
    private func listed(_ json: String) throws -> [DealPicker.Listed] {
        try JSONDecoder().decode([DealPicker.Listed].self, from: Data(json.utf8))
    }

    func testTheDeepestSavingsComeFirstAndOnlyWhatCanBeBought() throws {
        let products = try listed("""
        [
          {"handle": "plain", "title": "No saving", "variants": [{"price": {"amount": "5.000"}, "compareAtPrice": null, "availableForSale": true}]},
          {"handle": "fifth", "title": "A fifth off", "images": [{"url": "/media/a.webp"}], "variants": [{"price": {"amount": "8.000"}, "compareAtPrice": {"amount": "10.000"}, "availableForSale": true}]},
          {"handle": "half", "title": "Half off, sold out", "variants": [
            {"price": {"amount": "5.000"}, "compareAtPrice": {"amount": "10.000"}, "availableForSale": false},
            {"price": {"amount": "9.000"}, "compareAtPrice": {"amount": "10.000"}, "availableForSale": true}
          ]},
          {"handle": "third", "title": "A third off", "variants": [{"price": {"amount": "20"}, "compareAtPrice": {"amount": "30.000"}, "availableForSale": true}]},
          {"handle": "same", "title": "Was the same", "variants": [{"price": {"amount": "4.000"}, "compareAtPrice": {"amount": "4.000"}}]},
          {"handle": "broken", "title": "Unreadable price", "variants": [{"price": {"amount": "four"}, "compareAtPrice": {"amount": "9.000"}}]},
          {"title": "No address", "variants": [{"price": {"amount": "1.000"}, "compareAtPrice": {"amount": "9.000"}}]},
          {"handle": "fifth-too", "title": "Another fifth off", "variants": [{"price": {"amount": "4.000"}, "compareAtPrice": {"amount": "5.000"}}]}
        ]
        """)
        let deals = DealPicker.deals(in: products)
        XCTAssertEqual(deals.map(\.handle), ["third", "fifth", "fifth-too", "half"], "deepest first, the catalogue's order between equals")
        XCTAssertEqual(deals.map(\.percent), [33, 20, 20, 10])
        // The sold-out option's half off is not offered; the one in stock is.
        XCTAssertEqual(deals.last?.priceFils, 9_000)
        XCTAssertEqual(deals[1], DealPicker.Deal(handle: "fifth", title: "A fifth off", priceFils: 8_000, wasFils: 10_000, percent: 20, photo: "/media/a.webp"))
    }

    func testAPriceIsReadInWholeFilsOrNotAtAll() {
        XCTAssertEqual(DealPicker.fils("4.750"), 4_750)
        XCTAssertEqual(DealPicker.fils("72"), 72_000)
        XCTAssertEqual(DealPicker.fils("0.5"), 500)
        XCTAssertNil(DealPicker.fils("4.7501"))
        XCTAssertNil(DealPicker.fils("-1.000"))
        XCTAssertNil(DealPicker.fils("٤.٧٥٠"), "the server writes Latin digits; anything else is not a price")
        XCTAssertNil(DealPicker.fils(nil))
    }

    /// The recorded catalogue reads as the widget reads it.
    func testTheRecordedCatalogueReadsAsTheWidgetReadsIt() throws {
        let url = try XCTUnwrap(Bundle.main.url(forResource: "demo.commerce.products.list", withExtension: "json"))
        struct Answer: Decodable {
            struct Result: Decodable { struct Payload: Decodable { let json: [DealPicker.Listed] }; let data: Payload }
            let result: Result
        }
        let products = try JSONDecoder().decode(Answer.self, from: Data(contentsOf: url)).result.data.json
        XCTAssertFalse(products.isEmpty)
        XCTAssertTrue(products.allSatisfy { $0.handle?.isEmpty == false })
        for deal in DealPicker.deals(in: products) {
            XCTAssertGreaterThan(deal.wasFils, deal.priceFils)
        }
    }

    private func state(arrived: Bool) -> OrderActivityAttributes.ContentState {
        .init(step: arrived ? 3 : 2, arrived: arrived, headline: "On the way", detail: nil, minutes: nil, labels: ["a", "b", "c", "d"], rightToLeft: false, staleLine: "old", title: "Order NL-1")
    }

    func testTheOrderWidgetSaysWhyThereIsNoOrderAndGoesStaleAfterHalfAnHour() {
        let written = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(OrderWidgetPlan.plan(snapshot: nil, now: written).map(\.showing), [.open])
        XCTAssertEqual(OrderWidgetPlan.plan(snapshot: WidgetSnapshot(language: "en", signedIn: false, order: nil, written: written), now: written).map(\.showing), [.signIn])
        XCTAssertEqual(OrderWidgetPlan.plan(snapshot: WidgetSnapshot(language: "en", signedIn: true, order: nil, written: written), now: written).map(\.showing), [.nothing])

        let coming = WidgetSnapshot(language: "en", signedIn: true, order: .init(reference: "NL-1", state: state(arrived: false)), written: written)
        let fresh = OrderWidgetPlan.plan(snapshot: coming, now: written.addingTimeInterval(60))
        XCTAssertEqual(fresh.map(\.showing), [.order(stale: false), .order(stale: true)])
        XCTAssertEqual(fresh.last?.at, written.addingTimeInterval(OrderWidgetPlan.staleAfter), "old half an hour after the app read it, the Lock Screen's rule")
        XCTAssertEqual(OrderWidgetPlan.plan(snapshot: coming, now: written.addingTimeInterval(40 * 60)).map(\.showing), [.order(stale: true)])

        let delivered = WidgetSnapshot(language: "ar", signedIn: true, order: .init(reference: "NL-1", state: state(arrived: true)), written: written)
        XCTAssertEqual(OrderWidgetPlan.plan(snapshot: delivered, now: written.addingTimeInterval(5 * 3600)).map(\.showing), [.order(stale: false)], "a delivered order is going nowhere")
        XCTAssertTrue(delivered.rightToLeft)
    }

    @MainActor
    func testTheWidgetFollowsAnOrderOnItsWayBeforeTheNewest() {
        XCTAssertEqual(WidgetFeed.reference(onTheWay: ["NL-B"], newest: ["NL-A"]), "NL-B")
        XCTAssertEqual(WidgetFeed.reference(onTheWay: [], newest: ["NL-A"]), "NL-A")
        XCTAssertNil(WidgetFeed.reference(onTheWay: [], newest: []))
    }

    /// The snapshot round-trips as the extension reads it.
    func testTheSnapshotKeepsItsWordsThroughJSON() throws {
        let snapshot = WidgetSnapshot(language: "ar", signedIn: true, order: .init(reference: "NL-20261104-HMGQQ", state: state(arrived: false)), written: Date(timeIntervalSince1970: 1_700_000_000))
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        XCTAssertEqual(try decoder.decode(WidgetSnapshot.self, from: encoder.encode(snapshot)), snapshot)
    }

    /// A press on a widget opens the app where the website's own address would.
    func testAPressOnAWidgetOpensTheRightPage() {
        let open: (URL) -> Route? = { url in Route.from(link: url.path + (url.query.map { "?\($0)" } ?? "")) }
        XCTAssertEqual(open(WidgetLink.product("medjool-dates")), .product(handle: "medjool-dates"))
        XCTAssertEqual(open(WidgetLink.deals), .tab(.deals))
        XCTAssertEqual(open(WidgetLink.orders), .orders)
        XCTAssertEqual(open(WidgetLink.account), .tab(.account))
        XCTAssertEqual(open(OrderActivityLink.url("NL-20261104-HMGQQ")), .order(reference: "NL-20261104-HMGQQ"))
        // An occasion's address with offers ticked is still the occasion, not the Deals page.
        XCTAssertEqual(Route.from(link: "/category/all?offer=1&occasion=ramadan"), .occasion(slug: "ramadan"))
    }
}
