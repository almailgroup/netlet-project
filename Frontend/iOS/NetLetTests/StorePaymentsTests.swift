import XCTest
@testable import NetLet

/// The ways a store lets its shoppers pay (migration 0093): the app's rules
/// are `Shared/commerce/storePayments.ts` in Swift, on `storePayments.test.ts`'s
/// own cases, and the answers were recorded off a local server — the store's
/// own page, NetLet reading another store's, and a cart whose two stores
/// share no way to pay.
final class StorePaymentsTests: XCTestCase {
    let client = Fixtures.client

    private func recorded(_ variant: String) -> TRPCClient {
        TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: variant))
    }

    func testTheWaysComeFromTheSharedRulesInTheShopsOrder() {
        XCTAssertEqual(StorePaymentRules.shared.methods, ["cod", "knet", "card", "apple_pay"])
        XCTAssertFalse(StorePaymentRules.shared.onlineLive, "checkout takes no online way yet")
        XCTAssertEqual(StorePaymentRules.shared.methods.map(StorePay.key), ["storePay.method.cod", "storePay.method.knet", "storePay.method.card", "storePay.method.apple_pay"])
        XCTAssertTrue(StorePaymentRules.shared.methods.allSatisfy { Phrasebook.shared.has(StorePay.key($0)) })
    }

    func testOnlyTheOnlineWaysAreKeptOnceEach() {
        XCTAssertEqual(StorePay.clean(["card", "cod", "card", "paypal", "knet"]), ["knet", "card"])
        XCTAssertEqual(StorePay.clean([]), [])
    }

    func testAStoreKeepsOneWayAtLeast() {
        XCTAssertEqual(StorePay.problem(cod: false, online: []), "storePay.needOne")
        XCTAssertEqual(StorePay.problem(cod: false, online: ["bitcoin"]), "storePay.needOne")
        XCTAssertNil(StorePay.problem(cod: true, online: []))
        XCTAssertNil(StorePay.problem(cod: false, online: ["knet"]))
    }

    func testCashIsNowAndTheOnlineWaysAreComingUntilTheyAreLive() {
        let today = StorePay.line(["cod", "knet", "apple_pay"], live: false)
        XCTAssertEqual(today.now, ["cod"])
        XCTAssertEqual(today.soon, ["knet", "apple_pay"])
        XCTAssertEqual(StorePay.line(["knet"], live: false).now, [])
        let live = StorePay.line(["cod", "knet"], live: true)
        XCTAssertEqual(live.now, ["cod", "knet"])
        XCTAssertEqual(live.soon, [])
    }

    func testABasketIsOfferedWhatEveryStoreTakes() {
        XCTAssertEqual(StorePay.shared([(1, ["cod", "knet", "card"]), (2, ["knet", "card", "apple_pay"])]).methods, ["knet", "card"])
        XCTAssertNil(StorePay.shared([(1, ["cod", "knet", "card"]), (2, ["knet", "card", "apple_pay"])]).differs)
        XCTAssertEqual(StorePay.shared([]).methods, ["cod", "knet", "card", "apple_pay"])
        let apart = StorePay.shared([(1, ["cod", "knet"]), (2, ["cod"]), (3, ["apple_pay"]), (4, ["card"])])
        XCTAssertEqual(apart.methods, [])
        XCTAssertEqual(apart.differs, 3, "the first store that leaves nothing in common is the one named")
    }

    func testTheStoresOwnPageDecodes() async throws {
        let mine = try await client.call(API.storePayments, .init())
        XCTAssertTrue(mine.ready)
        XCTAssertTrue(mine.cod)
        XCTAssertEqual(mine.codCeiling, "250.000")
        XCTAssertEqual(mine.online, ["knet", "card"])
        XCTAssertEqual(mine.methods, ["cod", "knet", "card"])
        XCTAssertFalse(mine.live)

        let saved = try await client.call(API.setStorePayments, .init(cod: true, codCeiling: "250.000", online: ["knet", "card"]))
        XCTAssertEqual(saved.methods, mine.methods)

        let theirs = try await recorded("admin").call(API.storePayments, .init(vendorId: 4))
        XCTAssertEqual(theirs.vendorId, 4)
        XCTAssertFalse(theirs.cod)
        XCTAssertEqual(theirs.methods, ["apple_pay"])
    }

    func testACartNamesTheStoreItCannotShareAWayWith() async throws {
        let cart = try await recorded("paydiffers").call(API.cart, .init(cartId: "paydiffers"))
        let payments = try XCTUnwrap(cart.payments)
        XCTAssertEqual(payments.shared, [])
        XCTAssertEqual(payments.differs?.vendorName, "Rival Home")
        XCTAssertEqual(payments.differs?.vendorNameAr, "رايفل هوم")
        XCTAssertEqual(payments.methods(of: 2), ["cod", "knet", "card"])
        XCTAssertEqual(payments.methods(of: 4), ["apple_pay"])
        XCTAssertNil(payments.methods(of: nil))
        // The rule the app holds agrees with the server's answer.
        let together = StorePay.shared(payments.stores.map { (vendorId: $0.vendorId, methods: $0.methods) })
        XCTAssertEqual(together.methods, payments.shared)
        XCTAssertEqual(together.differs, payments.differs?.vendorId)
    }

    func testAnswersFromBeforeTheWaysToPayStillDecode() async throws {
        let cart = try await client.call(API.cart, .init(cartId: "demo"))
        XCTAssertNil(cart.payments, "an older answer has none, and the cart is drawn as it was")
    }

    func testThePortalOpensTheWaysToPayPage() {
        XCTAssertEqual(PortalPage("/admin/payment-methods"), .paymentMethods)
    }
}
