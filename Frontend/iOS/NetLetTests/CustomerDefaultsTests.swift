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

    /// A book that could not be read is said as that (`bookError`), never as
    /// an empty book the sheet would offer to start; asking again clears it,
    /// and a later failure leaves the book already on the phone as it was.
    func testAnAddressBookThatCouldNotBeReadIsNotAnEmptyOne() async {
        let defaults = UserDefaults(suiteName: "DeliveryBookTests")!
        defaults.removePersistentDomain(forName: "DeliveryBookTests")
        let account = FakeAccountService()
        account.bookError = .offline
        let model = DeliveryModel(api: client, account: account, defaults: defaults)
        await model.refresh(signedIn: true)
        XCTAssertTrue(model.loaded)
        XCTAssertTrue(model.addresses.isEmpty)
        XCTAssertEqual(model.bookError, .offline)

        account.bookError = nil
        account.book = [SavedAddress(id: 8, label: "Home", contactName: nil, contactPhone: "50000000", governorate: "hawalli",
                                     addressLine: "Salmiya", addressNotes: nil, parts: nil)]
        await model.refresh(signedIn: true)
        XCTAssertNil(model.bookError)
        XCTAssertEqual(model.addresses.map(\.id), [8])

        account.bookError = .timedOut
        await model.refresh(signedIn: true)
        XCTAssertNil(model.bookError, "a book on the phone stays drawn")
        XCTAssertEqual(model.addresses.map(\.id), [8])

        model.signedOut()
        XCTAssertNil(model.bookError)
    }
}
