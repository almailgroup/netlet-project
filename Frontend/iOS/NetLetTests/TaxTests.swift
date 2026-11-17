import XCTest
@testable import NetLet

/// Tax added at checkout (migration 0087), recorded off a local server with
/// the `tax` switch on at the shop's 5%: the bag, the order and the invoice
/// each say it, and the till adds it before the code, the points and the card.
final class TaxTests: XCTestCase {
    let client = Fixtures.client

    private func recorded(_ variant: String) -> TRPCClient {
        TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: variant))
    }

    private func money(_ text: String) -> Money { Money(fils: Money.parseFils(text)!) }

    func testTheRateReadsAsAPersonSaysIt() {
        XCTAssertEqual(TaxWording.rateLabel("5.00"), "5%")
        XCTAssertEqual(TaxWording.rateLabel("2.50"), "2.5%")
        XCTAssertEqual(TaxWording.rateLabel("2.25"), "2.25%")
        XCTAssertEqual(TaxWording.rateLabel("15"), "15%")
    }

    func testTaxIsAddedBeforeTheCodeThePointsAndTheCard() {
        let bill = Till.settle(goods: money("20.000"), delivery: money("2.000"), tax: money("1.000"), discount: money("3.000"), points: money("1.000"), giftCard: money("50.000"))
        XCTAssertEqual(bill.discount, money("3.000"))
        XCTAssertEqual(bill.points, money("1.000"))
        XCTAssertEqual(bill.giftCard, money("19.000"))
        XCTAssertEqual(bill.payable, .zero)
        XCTAssertEqual(Till.settle(goods: money("20.000"), delivery: money("2.000"), tax: money("1.000")).payable, money("23.000"))
    }

    func testTheBagSaysItsTaxAndItsTotalCarriesIt() async throws {
        let read = try await recorded("taxed").call(API.cart, .init(cartId: "QZ8zieEc5AEGx_H4rkeUdSChrqq5Eg21"))
        let cart = try XCTUnwrap(read)
        let tax = try XCTUnwrap(cart.tax)
        XCTAssertEqual(tax.ratePercent, "5.00")
        XCTAssertEqual(tax.amount, money("2.069"))
        XCTAssertEqual(cart.total.fils, cart.subtotal.fils + cart.delivery.total.fils + tax.amount.fils - (cart.codeDiscount?.fils ?? 0))
        // The till comes to the server's total.
        XCTAssertEqual(Till.bill(for: cart, discount: nil, gift: nil, balance: 0, usePoints: false).payable, cart.total)
        // A press drawn before the answer keeps the last tax in the total, as the delivery.
        let line = try XCTUnwrap(cart.items.first)
        let guessed = try XCTUnwrap(BagOps.apply(cart, .set(lineId: line.lineId, quantity: line.quantity + 1)))
        XCTAssertEqual(guessed.total.fils, guessed.subtotal.fils + cart.delivery.total.fils + tax.amount.fils)
    }

    func testTheOrderAndItsInvoiceSayTheTaxFrozen() async throws {
        let taxed = recorded("taxed")
        let read = try await taxed.call(API.order, .init(reference: "NL-20261117-EJQNE"))
        let order = try XCTUnwrap(read)
        let tax = try XCTUnwrap(order.tax)
        XCTAssertEqual(tax.rate, "5.00")
        XCTAssertEqual(tax.amount, money("2.069"))
        XCTAssertEqual(order.order.grandTotal.fils, order.order.itemsTotal.fils + order.order.deliveryTotal.fils + tax.amount.fils)

        let number = try XCTUnwrap(order.documents.first?.number)
        let invoice = try await taxed.call(API.invoice, .init(number: number)).document
        XCTAssertEqual(invoice.tax, money("2.069"))
        XCTAssertEqual(invoice.total.fils, invoice.goods.fils + invoice.delivery.fils + (invoice.tax?.fils ?? 0) - invoice.discount.fils)
        let lineTaxes = invoice.sellers.flatMap(\.lines).compactMap(\.tax)
        XCTAssertEqual(lineTaxes.count, 2, "each taxed line says its own")
        XCTAssertEqual(lineTaxes.reduce(0) { $0 + $1.amount.fils }, money("2.069").fils)
        XCTAssertTrue(Phrasebook.shared.has("invoice.lineTax") && Phrasebook.shared.has("invoice.tax") && Phrasebook.shared.has("summary.tax"))
    }

    func testAnUntaxedBagAndOrderCarryNoTax() async throws {
        let cart = try await client.call(API.cart, .init(cartId: "demo"))
        XCTAssertNil(cart?.tax)
        let order = try await client.call(API.order, .init(reference: "NL-20261001-J7MWY"))
        XCTAssertNil(order?.tax)
    }

    func testAProductsTaxSaysWhoMayChangeIt() async throws {
        let store = try await client.call(API.productTax, .init(id: 1))
        XCTAssertTrue(store.ready && store.on && store.taxed)
        XCTAssertNil(store.choice, "it follows the shop's setting")
        XCTAssertFalse(store.mayChange, "only NetLet decides which products are taxed")
        let netlet = try await recorded("admin").call(API.productTax, .init(id: 1))
        XCTAssertTrue(netlet.mayChange)
        XCTAssertEqual(TaxChoicePicker.choices, ["taxed", "exempt", "follow"])
        XCTAssertTrue(TaxChoicePicker.choices.allSatisfy { Phrasebook.shared.has(TaxChoicePicker.label($0)) })
        XCTAssertEqual(try TRPCClient.encodeInput(API.SetProductTax(id: 4, choice: "exempt")), #"{"json":{"choice":"exempt","id":4}}"#)
    }
}
