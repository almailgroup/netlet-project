import XCTest
@testable import NetLet

@MainActor
final class CartModelTests: XCTestCase {
    func testTheFirstAddMakesTheBagAndKeepsItsId() async throws {
        let template = try await Fixtures.cart()
        let service = FakeCartService(template: template)
        let defaults = isolatedDefaults()
        let cart = CartModel(service: service, defaults: defaults)
        let added = await cart.add(variantId: "145")
        XCTAssertTrue(added)
        XCTAssertEqual(service.created, 1)
        XCTAssertEqual(defaults.string(forKey: CartModel.storageKey), "cart-1")

        _ = await cart.add(variantId: "146", quantity: 2)
        XCTAssertEqual(service.created, 1, "a second add goes into the same bag")
        XCTAssertEqual(service.added.last?.0, "146")
        XCTAssertEqual(service.added.last?.1, 2)
    }

    func testABagTheServerNoLongerHasIsReplacedRatherThanFailing() async throws {
        let template = try await Fixtures.cart()
        let service = FakeCartService(template: template)
        let cart = CartModel(service: service, defaults: isolatedDefaults())
        _ = await cart.add(variantId: "145")
        service.vanished = true
        let added = await cart.add(variantId: "145")
        XCTAssertTrue(added)
        XCTAssertEqual(service.created, 2)
        XCTAssertEqual(cart.cartId, "cart-2")
    }

    func testRestoringABagThatIsGoneForgetsIt() async throws {
        let template = try await Fixtures.cart()
        let service = FakeCartService(template: template)
        let defaults = isolatedDefaults()
        defaults.set("old", forKey: CartModel.storageKey)
        let cart = CartModel(service: service, defaults: defaults)
        await cart.restore()
        XCTAssertNil(cart.cart)
        XCTAssertNil(defaults.string(forKey: CartModel.storageKey))
        XCTAssertEqual(cart.itemCount, 0)
    }

    func testAfterAnOrderEmptiesTheBagItIsForgotten() async throws {
        let template = try await Fixtures.cart()
        let service = FakeCartService(template: template)
        let cart = CartModel(service: service, defaults: isolatedDefaults())
        _ = await cart.add(variantId: "145")
        XCTAssertGreaterThan(cart.itemCount, 0)
        service.stored = service.stored?.with(items: [])
        await cart.refresh()
        XCTAssertNil(cart.cart)
        XCTAssertNil(cart.cartId)
    }

    func testSigningOutLeavesTheBagBehindOnTheServer() async throws {
        let template = try await Fixtures.cart()
        let service = FakeCartService(template: template)
        let defaults = isolatedDefaults()
        let cart = CartModel(service: service, defaults: defaults)
        _ = await cart.add(variantId: "145")
        cart.forget()
        XCTAssertNil(cart.cart)
        XCTAssertNil(defaults.string(forKey: CartModel.storageKey))
        XCTAssertNotNil(service.stored, "the account keeps it for the next sign-in")
    }
}

/// The bag a press draws before the server has answered — the web's
/// `CartContext` queue, against a server that takes its time.
@MainActor
final class CartQueueTests: XCTestCase {
    /// Yields to the queue until the condition holds, or gives up after a while.
    private func settle(_ condition: () -> Bool) async {
        for _ in 0..<200 where !condition() {
            try? await Task.sleep(for: .milliseconds(5))
        }
    }

    func testAPlusDrawsTheLineBeforeTheServerAnswers() async throws {
        let template = try await Fixtures.cart()
        let products = try await Fixtures.products()
        let rice = try XCTUnwrap(products.first { $0.handle == "basmati-rice-5kg" })
        let service = SlowCartService(template: template)
        let cart = CartModel(service: service, defaults: isolatedDefaults())
        let pending = Task { await cart.add(variantId: "145", product: rice) }
        await settle { cart.syncing }
        XCTAssertEqual(cart.quantity(of: "145"), 1, "the press is drawn at once")
        XCTAssertEqual(cart.itemCount, 1)
        XCTAssertFalse(cart.settling, "a line to draw is not a bag to wait for")
        let took = await pending.value
        XCTAssertTrue(took)
        XCTAssertFalse(cart.syncing)
        XCTAssertEqual(cart.cart?.id, "cart-1", "the server's answer replaces the guess")
    }

    func testPressesNotYetSentOnOneLineAreOneChangeAndGoInOrder() async throws {
        let template = try await Fixtures.cart()
        let service = SlowCartService(template: template)
        let cart = CartModel(service: service, defaults: isolatedDefaults())
        _ = await cart.add(variantId: "145")
        let line = try XCTUnwrap(cart.cart?.items.first)
        func drawn() -> Int? { cart.cart?.items.first { $0.lineId == line.lineId }?.quantity }

        let first = Task { await cart.setQuantity(lineId: line.lineId, to: 3) }
        await settle { service.quantities.count == 1 }
        let second = Task { await cart.setQuantity(lineId: line.lineId, to: 4) }
        await settle { drawn() == 4 }
        let third = Task { await cart.setQuantity(lineId: line.lineId, to: 5) }
        await settle { drawn() == 5 }
        XCTAssertEqual(drawn(), 5, "every press is drawn while the first is on its way")
        await first.value
        await second.value
        await third.value
        XCTAssertEqual(service.quantities, [3, 5], "the two waiting presses went as one, after the first")
    }

    func testARefusalPutsTheBagBackAndReadsItAgain() async throws {
        let template = try await Fixtures.cart()
        let service = SlowCartService(template: template)
        let cart = CartModel(service: service, defaults: isolatedDefaults())
        _ = await cart.add(variantId: "145")
        let line = try XCTUnwrap(cart.cart?.items.first)
        service.refuse = true
        let readsBefore = service.reads
        await cart.setQuantity(lineId: line.lineId, to: 7)
        XCTAssertEqual(cart.cart?.items.first?.quantity, line.quantity, "the refused press is dropped")
        XCTAssertNotNil(cart.lastError)
        // The bag is read again just after the caller is told.
        await settle { service.reads > readsBefore }
        XCTAssertGreaterThan(service.reads, readsBefore, "a refusal may have half-happened, so the bag is read again")
    }

    func testABuyThatFailsIsSaid() async throws {
        let template = try await Fixtures.cart()
        let service = SlowCartService(template: template)
        service.refuse = true
        let cart = CartModel(service: service, defaults: isolatedDefaults())
        let took = await cart.add(variantId: "145")
        XCTAssertFalse(took)
        XCTAssertNil(cart.cart, "nothing drawn ahead stays once the server refused it")
        XCTAssertEqual(cart.itemCount, 0)
    }
}

@MainActor
final class SearchViewModelTests: XCTestCase {
    func testWaitsForTypingToPauseAndAsksOnce() async throws {
        let catalog = FakeCatalogService()
        let model = SearchViewModel(catalog: catalog, defaults: isolatedDefaults())
        model.debounce = .milliseconds(50)
        for typed in ["r", "ri", "rice"] {
            model.query = typed
            model.queryChanged()
        }
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(catalog.asked, ["rice"])
        XCTAssertEqual(model.answered, "rice")
    }

    func testAnAnswerToOlderWordsIsNeverDrawnUnderNewerOnes() async throws {
        let catalog = FakeCatalogService()
        catalog.delays["slow"] = .milliseconds(300)
        let model = SearchViewModel(catalog: catalog, defaults: isolatedDefaults())
        model.debounce = .milliseconds(10)
        model.query = "slow"
        model.queryChanged()
        try await Task.sleep(for: .milliseconds(60))
        model.query = "fast"
        model.queryChanged()
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertEqual(model.answered, "fast")
        XCTAssertEqual(model.result.value?.total, 4)
    }

    /// The web's `shelvedProducts`: what the app already holds answers the
    /// words at once, by the shop's own ranking, while the server is asked.
    func testProductsAlreadyHeldAnswerAtOnceWhileTheServerIsAsked() async throws {
        let catalog = FakeCatalogService()
        let model = SearchViewModel(catalog: catalog, defaults: isolatedDefaults())
        let products = try await Fixtures.products()
        model.held = { products }
        model.debounce = .milliseconds(50)
        model.query = "rice"
        model.queryChanged()
        XCTAssertEqual(model.interim?.first?.handle, "basmati-rice-5kg", "drawn before the server is asked")
        XCTAssertTrue(catalog.asked.isEmpty)
        model.query = "zzqxv"
        model.queryChanged()
        XCTAssertNil(model.interim, "nothing held answers a misspelling; the server's correction does")
        model.query = ""
        model.queryChanged()
        XCTAssertNil(model.interim)
    }

    func testWordsAlreadyAnsweredAreDrawnAtOnce() async throws {
        let catalog = FakeCatalogService()
        let model = SearchViewModel(catalog: catalog, defaults: isolatedDefaults())
        model.debounce = .milliseconds(10)
        model.query = "rice"
        model.queryChanged()
        try await Task.sleep(for: .milliseconds(200))
        model.query = "ric"
        model.queryChanged()
        model.query = "rice"
        model.queryChanged()
        XCTAssertEqual(model.answered, "rice", "the answer it already gave is drawn without waiting")
        XCTAssertNotNil(model.result.value)
    }

    func testRemembersRecentSearchesOnThisDeviceOnly() async {
        let defaults = isolatedDefaults()
        let model = SearchViewModel(catalog: FakeCatalogService(), defaults: defaults)
        for term in ["tea", "rice", "Tea"] {
            model.query = term
            await model.submit()
        }
        XCTAssertEqual(model.recent, ["Tea", "rice"])
        model.clearRecent()
        XCTAssertTrue(model.recent.isEmpty)
        XCTAssertNil(defaults.stringArray(forKey: SearchViewModel.recentKey))
    }
}

@MainActor
final class AuthViewModelTests: XCTestCase {
    func testNothingIsSentUntilTheFormIsWhole() async {
        let account = FakeAccountService()
        let model = AuthViewModel(account: account)
        model.email = "noura@"
        let user = await model.submit()
        XCTAssertNil(user)
        XCTAssertEqual(model.emailProblem, "auth.emailInvalid")
        XCTAssertEqual(model.passwordProblem, "auth.passwordRequired")
    }

    func testAWrongPasswordOffersTheReset() async {
        let model = AuthViewModel(account: FakeAccountService())
        model.email = "noura@shop.test"
        model.password = "wrong"
        _ = await model.submit()
        XCTAssertEqual(model.refusal, "auth.invalidCredentials")
        XCTAssertTrue(model.offersReset)
    }

    func testTheRightPasswordOnAnUnconfirmedAccountGoesToTheCodeStep() async {
        let account = FakeAccountService()
        account.signInResult = .failure(.server(code: "FORBIDDEN", message: "auth.emailNotConfirmed", status: 403))
        let model = AuthViewModel(account: account)
        model.email = "noura@shop.test"
        model.password = "a long password"
        _ = await model.submit()
        XCTAssertEqual(model.step, .code(email: "noura@shop.test", password: "a long password", name: nil, fromRegister: false))
        XCTAssertEqual(account.resent, ["noura@shop.test"])
    }

    func testCreatingAnAccountKeepsThePasswordTypedWithTheCode() async {
        let account = FakeAccountService()
        account.verifyResult = .success(FakeAccountService.user)
        let model = AuthViewModel(account: account)
        model.mode = .register
        model.email = "noura@shop.test"
        model.password = "a long password"
        _ = await model.submit()
        guard case .code = model.step else { return XCTFail("expected the code step") }
        model.code = "١٢٣٤٥٦"
        let user = await model.confirm()
        XCTAssertEqual(user?.id, 2)
        XCTAssertEqual(account.verified.first?.password, "a long password")
        XCTAssertEqual(account.verified.first?.code, "123456")
    }

    func testAResetReadsTheSameWhoeverTheAddressBelongsTo() async {
        let account = FakeAccountService()
        account.resetError = .server(code: "INTERNAL_SERVER_ERROR", message: "boom", status: 500)
        let model = AuthViewModel(account: account)
        model.mode = .reset
        model.email = "nobody@shop.test"
        _ = await model.submit()
        XCTAssertEqual(model.step, .resetSent(email: "nobody@shop.test"))

        account.resetError = .server(code: "TOO_MANY_REQUESTS", message: "auth.tooManyAttempts", status: 429)
        model.backToForm()
        _ = await model.submit()
        XCTAssertEqual(model.refusal, "auth.tooManyAttempts")
    }
}

@MainActor
final class CheckoutViewModelTests: XCTestCase {
    func testSaysWhatIsMissingFirstReasonFirst() async throws {
        let model = CheckoutViewModel(orders: FakeOrderService(), account: FakeAccountService(), defaults: isolatedDefaults())
        let cart = try await Fixtures.cart()
        XCTAssertEqual(model.blocker(for: nil), "checkout.needItems")
        XCTAssertEqual(model.blocker(for: cart), "checkout.needGovernorate")
        model.chooseArea(Area(en: "Salmiya", ar: "السالمية"))
        XCTAssertEqual(model.governorate, "hawalli", "an area chooses its governorate")
        XCTAssertEqual(model.blocker(for: cart), "checkout.needAddress")
    }

    func testPlacesACashOrderWithTheNumberReadAsKuwaiti() async throws {
        let orders = FakeOrderService()
        let model = CheckoutViewModel(orders: orders, account: FakeAccountService(), defaults: isolatedDefaults())
        let cart = try await Fixtures.cart()
        model.chooseGovernorate("hawalli")
        model.parts = AddressParts(area: "Salmiya", block: " 4 ", street: "12", building: "15")
        model.contactPhone = "٥٠٠٠ ٠٠٠٠"
        let placed = await model.place(cart: cart)
        XCTAssertEqual(placed?.reference, "NL-20261018-YNTM9")
        let sent = try XCTUnwrap(orders.placed.first)
        XCTAssertEqual(sent.paymentMethod, "cod")
        XCTAssertEqual(sent.contactPhone, "+96550000000")
        XCTAssertEqual(sent.addressParts?.block, "4")
        XCTAssertNil(sent.addressParts?.avenue)
        XCTAssertEqual(sent.deliveryZoneId, "hawalli")
    }

    func testStartsFromTheAddressUsedLastOnThisDevice() async {
        let account = FakeAccountService()
        account.book = [
            SavedAddress(id: 1, label: "Office", contactName: nil, contactPhone: nil, governorate: "capital", addressLine: nil, addressNotes: nil, parts: nil),
            SavedAddress(id: 8, label: "Home", contactName: "Noura", contactPhone: "50000000", governorate: "hawalli", addressLine: nil, addressNotes: nil,
                         parts: AddressParts(area: "Salmiya", block: "4", street: "12", building: "15")),
        ]
        let defaults = isolatedDefaults()
        defaults.set(8, forKey: CheckoutViewModel.lastAddressKey)
        let model = CheckoutViewModel(orders: FakeOrderService(), account: account, defaults: defaults)
        await model.load(user: FakeAccountService.user)
        XCTAssertEqual(model.chosenAddress, 8)
        XCTAssertEqual(model.governorate, "hawalli")
        XCTAssertEqual(model.contactPhone, "50000000")
        XCTAssertFalse(model.typedArea)
    }

    func testARefusalIsKeptForTheScreenToSay() async throws {
        let orders = FakeOrderService()
        orders.refusal = .server(code: "BAD_REQUEST", message: "order.outOfStock", status: 400)
        let model = CheckoutViewModel(orders: orders, account: FakeAccountService(), defaults: isolatedDefaults())
        model.chooseGovernorate("hawalli")
        model.parts = AddressParts(area: "Salmiya", block: "4", street: "12", building: "15")
        model.contactPhone = "50000000"
        let cart = try await Fixtures.cart()
        let placed = await model.place(cart: cart)
        XCTAssertNil(placed)
        XCTAssertEqual(model.refusal?.serverMessage, "order.outOfStock")
    }
}

/// The header's location: the web's `addressInUse` over the book and the area.
final class DeliveryRuleTests: XCTestCase {
    private let book = [
        SavedAddress(id: 1, label: "Office", contactName: nil, contactPhone: nil, governorate: "capital", addressLine: nil, addressNotes: nil, parts: nil),
        SavedAddress(id: 8, label: "Home", contactName: nil, contactPhone: nil, governorate: "hawalli", addressLine: nil, addressNotes: nil, parts: nil),
        SavedAddress(id: 9, label: "Mum's", contactName: nil, contactPhone: nil, governorate: "hawalli", addressLine: nil, addressNotes: nil, parts: nil),
    ]

    func testTheAddressUsedLastWinsWhileItIsInTheArea() {
        XCTAssertEqual(DeliveryModel.addressInUse(book, lastUsed: 9, zone: "hawalli")?.label, "Mum's")
    }

    func testOtherwiseTheAreasFirstAddress() {
        XCTAssertEqual(DeliveryModel.addressInUse(book, lastUsed: 1, zone: "hawalli")?.label, "Home")
        XCTAssertEqual(DeliveryModel.addressInUse(book, lastUsed: nil, zone: "capital")?.label, "Office")
    }

    func testNoAreaOrNoAddressThereIsNone() {
        XCTAssertNil(DeliveryModel.addressInUse(book, lastUsed: 8, zone: nil))
        XCTAssertNil(DeliveryModel.addressInUse(book, lastUsed: 8, zone: "jahra"))
    }
}

@MainActor
final class ProfileViewModelTests: XCTestCase {
    func testAnAccountWithNoPartsStartsFromItsDisplayNameSplit() async {
        let model = ProfileViewModel(account: FakeAccountService(), user: FakeAccountService.user)
        await model.load()
        XCTAssertEqual(model.firstName, ProfileDetails.split(FakeAccountService.user.name).first)
        XCTAssertFalse(model.nameChanged, "a guess shown is not a change")
    }

    func testStoredPartsAndDetailsFillTheCards() async {
        let account = FakeAccountService()
        account.details = ProfileDetails(firstName: "Abdul Rahman", lastName: "Al-Ali", phone: "+96555001122", gender: "male", birthday: "1990-05-17", nationality: "KW")
        let model = ProfileViewModel(account: account, user: FakeAccountService.user)
        await model.load()
        XCTAssertEqual(model.firstName, "Abdul Rahman")
        XCTAssertEqual(model.lastName, "Al-Ali")
        XCTAssertEqual(model.phone, "5500 1122")
        XCTAssertEqual(model.birthday, "1990-05-17")
        XCTAssertFalse(model.phoneChanged)
    }

    func testTheNameNeedsBothPartsBeforeAnythingIsSent() async {
        let account = FakeAccountService()
        let model = ProfileViewModel(account: account, user: FakeAccountService.user)
        model.firstName = "Noura"
        model.lastName = "  "
        let user = await model.saveName()
        XCTAssertNil(user)
        XCTAssertEqual(model.problems[.name], "profile.nameRequired")
        XCTAssertTrue(account.nameParts.isEmpty)
        model.lastName = " Al-Sabah "
        _ = await model.saveName()
        XCTAssertEqual(account.nameParts.last?.1, "Al-Sabah")
        XCTAssertFalse(model.nameChanged)
    }

    func testEachCardSendsOnlyItsOwnField() async throws {
        let account = FakeAccountService()
        let model = ProfileViewModel(account: account, user: FakeAccountService.user)
        await model.load()
        await model.choose(gender: "female")
        XCTAssertEqual(try TRPCClient.encodeInput(try XCTUnwrap(account.detailPatches.last)), #"{"json":{"gender":"female"}}"#)
        await model.choose(gender: "female")
        XCTAssertEqual(try TRPCClient.encodeInput(try XCTUnwrap(account.detailPatches.last)), #"{"json":{"gender":null}}"#, "the chosen one pressed again takes it away")
        await model.toggle(nationality: "KW")
        XCTAssertEqual(model.details.nationality, "KW")
        await model.toggle(nationality: "KW")
        XCTAssertNil(model.details.nationality)
    }

    func testAPhoneThatIsNotKuwaitiIsSaidRatherThanSent() async {
        let account = FakeAccountService()
        let model = ProfileViewModel(account: account, user: FakeAccountService.user)
        model.phone = "123"
        await model.savePhone()
        XCTAssertEqual(model.problems[.phone], "wishlist.phoneInvalid")
        XCTAssertTrue(account.detailPatches.isEmpty)
        model.phone = "٥٥٠٠ ١١٢٢"
        await model.savePhone()
        XCTAssertEqual(model.details.phone, "+96555001122")
        XCTAssertEqual(model.phone, "5500 1122")
    }

    func testCheckoutStartsWithTheAccountsPhoneWhereTheAddressHasNone() async {
        let account = FakeAccountService()
        account.details.phone = "+96555001122"
        account.book = [SavedAddress(id: 1, label: "Office", contactName: nil, contactPhone: nil, governorate: "capital", addressLine: nil, addressNotes: nil, parts: nil)]
        let model = CheckoutViewModel(orders: FakeOrderService(), account: account, defaults: isolatedDefaults())
        await model.load(user: FakeAccountService.user)
        XCTAssertEqual(model.contactPhone, "5500 1122")

        account.book = [SavedAddress(id: 2, label: "Home", contactName: nil, contactPhone: "50000000", governorate: "hawalli", addressLine: nil, addressNotes: nil, parts: nil)]
        let other = CheckoutViewModel(orders: FakeOrderService(), account: account, defaults: isolatedDefaults())
        await other.load(user: FakeAccountService.user)
        XCTAssertEqual(other.contactPhone, "50000000", "the address's own number wins")
    }
}
