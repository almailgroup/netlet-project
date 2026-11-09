import XCTest
import UIKit
@testable import NetLet

/// The portal's dashboard, stock page and co-pilot: the recordings decode the
/// way the app reads them, and the small rules it keeps are the web's own, on
/// `Shared/commerce/dashboard.test.ts`' and `Shared/ai/copilot.test.ts`' cases.
final class PortalDashboardTests: XCTestCase {
    let client = Fixtures.client

    func testTheDashboardDecodesForAStoreAndForNetLet() async throws {
        let board = try await client.call(API.dashboard, .init(range: 30))
        XCTAssertEqual(board.range, 30)
        XCTAssertEqual(board.days.count, 30, "a point for each Kuwaiti day of the period")
        XCTAssertEqual(board.previousDays.count, 30, "the period before, day for day")
        XCTAssertEqual(board.forecast.count, 7, "a week's estimate after it")
        XCTAssertNil(board.newAccounts, "a store is not shown who joined NetLet")
        XCTAssertEqual(board.departments.reduce(0) { $0 + $1.percent }, 100)
        XCTAssertEqual(board.days.reduce(0) { $0 + $1.sales.fils }, board.totals.sales.current.fils, "the line adds up to the figure above it")
        XCTAssertFalse(board.top.isEmpty)

        let admin = TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: "admin"))
        let shop = try await admin.call(API.dashboard, .init(range: 30))
        XCTAssertEqual(shop.newAccounts?.count, 30, "NetLet's administrator sees accounts opened")
        XCTAssertGreaterThan(shop.departments.count, board.departments.count)
    }

    func testTheShelfAndItsLowRowsDecode() async throws {
        let shelf = try await client.call(API.shelfHealth)
        let low = try await client.call(API.lowStock, .init(page: 1))
        XCTAssertEqual(low.rows.filter { $0.state == .out }.count, shelf.out)
        XCTAssertEqual(low.rows.filter { $0.state == .low }.count, shelf.low)
        let watch = try XCTUnwrap(low.rows.first { $0.productTitle == "Smart watch" })
        XCTAssertEqual(watch.daysOfCover, 5, "two left at eleven a month lasts about five days")
        XCTAssertEqual(watch.suggestedReorderAt, 6, "two weeks of sales")
        let counts = try await client.call(API.portalCounts, .init())
        XCTAssertEqual(counts.outOfStock, shelf.out, "the overview's tile and the shelf agree")
    }

    func testTheCopilotsBriefAndAnswerDecode() async throws {
        let brief = try await client.call(API.copilotBrief)
        XCTAssertTrue(brief.ask)
        XCTAssertEqual(brief.insights.first?.key, "copilot.insight.out")
        XCTAssertEqual(brief.insights.first?.params["count"]?.text, "1")
        let reorder = try XCTUnwrap(brief.insights.compactMap(\.action).first { $0.kind == "reorder" })
        XCTAssertEqual(reorder.variantId, 3)
        XCTAssertEqual(reorder.level, 6)
        XCTAssertTrue(brief.insights.allSatisfy { Phrasebook.shared.has($0.key) }, "every line of the brief is a key the app can say")
        XCTAssertTrue(brief.insights.compactMap(\.words).flatMap(\.values).allSatisfy(Phrasebook.shared.has))

        let answer = try await client.call(API.copilotAsk, .init(turns: [.init(role: "admin", text: "What should I restock?")], locale: "en"))
        XCTAssertEqual(answer.kind, "unavailable", "the demo never stands in for the model")
        let saved = try await client.call(API.setReorderPoint, .init(variantId: 3, lowStockAt: OrNull(6)))
        XCTAssertEqual(saved.lowStockAt, 6)
    }

    func testTheShelfStatesAreTheWebs() {
        XCTAssertEqual(ShelfState(stock: 0, reorderAt: 5, preorderStock: 0), .out)
        XCTAssertEqual(ShelfState(stock: -1, reorderAt: nil, preorderStock: 4), .preorder)
        XCTAssertEqual(ShelfState(stock: 5, reorderAt: 5, preorderStock: 0), .low)
        XCTAssertEqual(ShelfState(stock: 6, reorderAt: 5, preorderStock: 0), .healthy)
        XCTAssertEqual(ShelfState(stock: 1, reorderAt: nil, preorderStock: 0), .healthy)
        XCTAssertTrue(ShelfState.allCases.allSatisfy { Phrasebook.shared.has($0.label) })
    }

    func testThePaceAndTheSuggestionAreTheWebs() {
        XCTAssertEqual(DashboardRules.daysOfCover(stock: 10, soldLast28: 28), 10)
        XCTAssertEqual(DashboardRules.daysOfCover(stock: 3, soldLast28: 28), 3)
        XCTAssertNil(DashboardRules.daysOfCover(stock: 10, soldLast28: 0))
        XCTAssertNil(DashboardRules.daysOfCover(stock: 0, soldLast28: 50))
        XCTAssertEqual(DashboardRules.reorderFor(soldLast28: 28), 14)
        XCTAssertEqual(DashboardRules.reorderFor(soldLast28: 1), 1)
        XCTAssertNil(DashboardRules.reorderFor(soldLast28: 0))
    }

    func testSharesAddUpToAHundred() {
        XCTAssertEqual(DashboardRules.wholePercents([1, 1, 1]), [34, 33, 33])
        XCTAssertEqual(DashboardRules.wholePercents([0, 0]), [0, 0])
        XCTAssertEqual(DashboardRules.wholePercents([2, 1]).reduce(0, +), 100)
        XCTAssertEqual(DashboardRules.wholePercents([7, 2, 1, 0]).reduce(0, +), 100)
    }

    func testAQuestionIsHeldToTheWebsRules() {
        XCTAssertEqual(DashboardRules.questionProblem("  "), "copilot.empty")
        XCTAssertEqual(DashboardRules.questionProblem(String(repeating: "x", count: 1001)), "copilot.tooLong")
        XCTAssertEqual(DashboardRules.questionProblem("email noura@example.com about it"), "copilot.contact")
        XCTAssertNil(DashboardRules.questionProblem("What should I restock?"))
    }

    func testEveryPageOfTheMenuHasAnIconThatDraws() {
        for href in PortalRules.shared.menu.flatMap(\.links).map(\.href) {
            XCTAssertNotNil(PortalIcons.byPage[href], "\(href) has an icon")
            XCTAssertNotNil(UIImage(systemName: PortalIcons.symbol(href)), "\(href)'s icon draws")
        }
    }
}
