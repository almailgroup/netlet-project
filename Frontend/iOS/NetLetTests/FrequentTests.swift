import XCTest
@testable import NetLet

/// Frequently bought (migration 0073): the recorded answers decode, and the
/// app's rules are `Shared/commerce/frequentItems.ts`'s, on its own cases.
final class FrequentTests: XCTestCase {
    let client = Fixtures.client

    func testTheListAndItsSuggestionsDecode() async throws {
        let list = try await client.call(API.frequentList, .init(locale: "en"))
        XCTAssertTrue(list.ready)
        XCTAssertEqual(list.items.count, 2)
        let kettle = try XCTUnwrap(list.items.first { $0.product?.handle == "copper-kettle" })
        XCTAssertEqual(kettle.quantity, 4, "the usual amount the shopper set")
        XCTAssertNotNil(kettle.product?.variants.first { $0.id == kettle.variantId }, "the item names one of its product's options")

        let suggestions = try await client.call(API.frequentSuggestions, .init(locale: "en"))
        XCTAssertFalse(suggestions.isEmpty)
        XCTAssertFalse(suggestions.contains { suggestion in list.items.contains { $0.variantId == suggestion.variantId } },
                       "what is on the list is not suggested again")
        let counts = suggestions.map(\.timesBought)
        XCTAssertEqual(counts, counts.sorted(by: >), "most often bought first")

        let forProduct = try await client.call(API.frequentForProduct, .init(productId: 1))
        XCTAssertTrue(forProduct.ready)
        XCTAssertEqual(forProduct.entries.first?.quantity, 2)

        let saved = try await client.call(API.frequentAdd, .init(productId: 1, variantId: 1, quantity: 2))
        XCTAssertEqual(saved.quantity, 2)
        let changed = try await client.call(API.frequentSetQuantity, .init(id: saved.id, quantity: 4))
        XCTAssertEqual(changed.quantity, 4)
        _ = try await client.call(API.frequentRemove, .init(id: saved.id))
    }

    func testTheUsualAmountIsAWholeNumberFromOneToTheLineCeiling() {
        XCTAssertEqual(FrequentRules.quantity(0), 1)
        XCTAssertEqual(FrequentRules.quantity(3), 3)
        XCTAssertEqual(FrequentRules.quantity(500), 99)
    }

    func testOnePressAddsTheUsualAmountLessWhatIsInTheBagNeverPastWhatThereIs() {
        XCTAssertEqual(FrequentRules.addable(usual: 3, maxQuantity: 10, inBag: 0), 3)
        XCTAssertEqual(FrequentRules.addable(usual: 3, maxQuantity: 10, inBag: 8), 2)
        XCTAssertEqual(FrequentRules.addable(usual: 3, maxQuantity: 2, inBag: 0), 2)
        XCTAssertEqual(FrequentRules.addable(usual: 3, maxQuantity: 4, inBag: 4), 0)
    }

    func testAnItemIsReadySoldOutOrGone() async throws {
        let list = try await client.call(API.frequentList, .init(locale: "en"))
        let item = try XCTUnwrap(list.items.first)
        let product = try XCTUnwrap(item.product)
        XCTAssertEqual(FrequentRules.state(product, variantId: item.variantId), .ready)
        XCTAssertEqual(FrequentRules.state(product, variantId: "no-such-option"), .gone)
        XCTAssertEqual(FrequentRules.state(nil, variantId: item.variantId), .gone)
    }
}
