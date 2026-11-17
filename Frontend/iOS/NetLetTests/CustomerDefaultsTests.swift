import XCTest
@testable import NetLet

/// What every order starts from (0088): the recorded answer decodes, the way
/// to pay starts from the one kept while it can be chosen — the TypeScript's
/// `defaultPayment`, on its cases — and the address the header delivers to is
/// the account's default once the phone has adopted it.
@MainActor
final class CustomerDefaultsTests: XCTestCase {
    let client = Fixtures.client

    func testTheAccountsDefaultsDecode() async throws {
        let kept = try await client.call(API.customerDefaults)
        XCTAssertTrue(kept.ready)
        XCTAssertEqual(kept.addressId, 8)
        XCTAssertEqual(kept.governorate, "hawalli")
        XCTAssertEqual(kept.payment, "cod")
        XCTAssertEqual(kept.choosable, ["cod"])
        let saved = try await client.call(API.setDefaultAddress, .init(addressId: 8))
        XCTAssertTrue(saved.saved)
    }

    func testTheWayToPayStartsFromTheOneKeptWhileItCanBeChosen() {
        XCTAssertEqual(CustomerDefaults.startingPayment("cod", choosable: ["cod"]), "cod")
        XCTAssertEqual(CustomerDefaults.startingPayment("knet", choosable: ["cod"]), "cod")
        XCTAssertEqual(CustomerDefaults.startingPayment(nil, choosable: ["cod"]), "cod")
        XCTAssertEqual(CustomerDefaults.startingPayment("bitcoin", choosable: ["cod"]), "cod")
        XCTAssertNil(CustomerDefaults.startingPayment("cod", choosable: []))
        XCTAssertEqual(CustomerDefaults.paymentMethods, ["cod", "knet", "card", "apple_pay"])
        for method in CustomerDefaults.paymentMethods {
            XCTAssertTrue(Phrasebook.shared.has(CustomerDefaults.nameKey(method)), method)
        }
    }

    func testTheHeaderDeliversToTheAccountsDefault() async {
        let defaults = UserDefaults(suiteName: "CustomerDefaultsTests")!
        defaults.removePersistentDomain(forName: "CustomerDefaultsTests")
        let model = DeliveryModel(api: client, account: AccountService(client: client), defaults: defaults)
        await model.refresh(signedIn: true)
        XCTAssertEqual(model.accountDefaults?.addressId, 8)
        XCTAssertEqual(model.lastAddressId, 8)
        XCTAssertEqual(model.inUse?.id, 8)
        XCTAssertEqual(model.payment, "cod")
        XCTAssertEqual(defaults.object(forKey: CheckoutViewModel.lastAddressKey) as? Int, 8)
    }
}
