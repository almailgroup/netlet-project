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

        // The first press's answer waits until the other two are pressed.
        service.held = true
        let first = Task { await cart.setQuantity(lineId: line.lineId, to: 3) }
        await settle { service.quantities.count == 1 }
        let second = Task { await cart.setQuantity(lineId: line.lineId, to: 4) }
        await settle { drawn() == 4 }
        let third = Task { await cart.setQuantity(lineId: line.lineId, to: 5) }
        await settle { drawn() == 5 }
        XCTAssertEqual(drawn(), 5, "every press is drawn while the first is on its way")
        service.held = false
        _ = await first.value
        _ = await second.value
        _ = await third.value
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
        let took = await cart.setQuantity(lineId: line.lineId, to: 7)
        XCTAssertFalse(took, "the caller is told, so the bag can say so in words")
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

    /// The reset's code and the new password: held to the floor before
    /// anything is sent, a wrong code said on the code box, and the right one
    /// signing in — or handing a sign-up still waiting to its own code step.
    func testAResetByCodeChecksFirstAndSignsIn() async {
        let account = FakeAccountService()
        let model = ResetByCodeModel(email: "noura@shop.test", account: account)
        model.code = "12"
        model.password = "short"
        let refused = await model.finish()
        XCTAssertNil(refused)
        XCTAssertEqual(model.codeProblem, "auth.codeShape")
        XCTAssertEqual(model.passwordProblem, "auth.passwordNeedsRules")
        XCTAssertTrue(account.codeResets.isEmpty, "nothing is sent the server would refuse")

        model.code = "١٢٣٤٥٦"
        model.password = "a long new password"
        let wrong = await model.finish()
        XCTAssertNil(wrong)
        XCTAssertEqual(account.codeResets.last?.code, "123456", "Arabic-Indic digits are read as digits")
        XCTAssertEqual(model.refusal, "auth.codeWrong")
        XCTAssertTrue(model.refusalIsCode)
        model.codeChanged()
        XCTAssertNil(model.refusal, "the refusal leaves with the fix")

        account.resetWithCodeResult = .success(.signedIn(FakeAccountService.user))
        let signed = await model.finish()
        XCTAssertEqual(signed, .signedIn(FakeAccountService.user))

        account.resetWithCodeResult = .success(.verify(email: "noura@shop.test"))
        let waiting = await model.finish()
        XCTAssertEqual(waiting, .verify(email: "noura@shop.test", password: "a long new password"))
    }

    /// Continue with Apple is drawn only while the server says Apple is on.
    func testAppleIsOfferedOnlyWhileTheServerSaysSo() async {
        let account = FakeAccountService()
        let off = AuthViewModel(account: account)
        await off.prepare()
        XCTAssertFalse(off.appleOffered)
        account.appleOn = true
        let on = AuthViewModel(account: account)
        await on.prepare()
        XCTAssertTrue(on.appleOffered)
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

    /// Signing in with a one-time code: no password asked for, the code
    /// step whatever the address, a wrong code said, the right one signing
    /// in, and the way chosen remembered for the next sign-in.
    func testSigningInWithACodeAsksForNoPassword() async {
        let account = FakeAccountService()
        let defaults = isolatedDefaults()
        let model = AuthViewModel(account: account, defaults: defaults)
        XCTAssertEqual(model.method, .password)
        model.method = .code
        XCTAssertTrue(model.usesCode)
        model.email = " Noura@Shop.test "
        XCTAssertNil(model.passwordProblem, "a code needs no password")
        let user = await model.submit()
        XCTAssertNil(user)
        XCTAssertEqual(account.codeRequests, ["Noura@Shop.test"])
        XCTAssertEqual(model.step, .signInCode(email: "noura@shop.test"))
        XCTAssertEqual(model.resendWait, AuthViewModel.signInCodeWaitSeconds)

        model.code = "١٢٣٤٥٦"
        let wrong = await model.confirm()
        XCTAssertNil(wrong)
        XCTAssertEqual(model.refusal, "auth.codeWrong")
        XCTAssertEqual(account.codeSignIns.last?.code, "123456", "Arabic-Indic digits are read as digits")

        account.codeSignInResult = .success(FakeAccountService.user)
        let signed = await model.confirm()
        XCTAssertEqual(signed?.id, 2)
        XCTAssertEqual(account.codeSignIns.last?.email, "noura@shop.test")

        let next = AuthViewModel(account: account, defaults: defaults)
        XCTAssertEqual(next.method, .code, "the next sign-in starts on the way chosen last")
        XCTAssertEqual(AuthViewModel(account: account, defaults: isolatedDefaults()).method, .password)
    }

    /// Only the throttle stops the code step; any other answer reads the same,
    /// so the step cannot be used to ask who is registered.
    func testACodeIsAskedForTheSameWayWhoeverTheAddressBelongsTo() async {
        let account = FakeAccountService()
        let model = AuthViewModel(account: account, defaults: isolatedDefaults())
        model.method = .code
        model.email = "nobody@shop.test"
        account.codeStartError = .server(code: "INTERNAL_SERVER_ERROR", message: "boom", status: 500)
        _ = await model.submit()
        XCTAssertEqual(model.step, .signInCode(email: "nobody@shop.test"))

        model.backToForm()
        account.codeStartError = .server(code: "TOO_MANY_REQUESTS", message: "auth.tooManyAttempts", status: 429)
        _ = await model.submit()
        XCTAssertEqual(model.step, .form)
        XCTAssertEqual(model.refusal, "auth.tooManyAttempts")
    }

    /// An inbox whose account signs in with a password NetLet keeps is sent
    /// back to the password, with the box open.
    func testACodeForAPasswordAccountOffersThePassword() async {
        let account = FakeAccountService()
        account.codeSignInResult = .failure(.server(code: "CONFLICT", message: "auth.codeUsePassword", status: 409))
        let model = AuthViewModel(account: account, defaults: isolatedDefaults())
        model.method = .code
        model.email = "noura@shop.test"
        _ = await model.submit()
        model.code = "123456"
        _ = await model.confirm()
        XCTAssertTrue(model.offersPassword)
        model.usePassword()
        XCTAssertEqual(model.method, .password)
        XCTAssertEqual(model.step, .form)
        XCTAssertFalse(model.usesCode)
        XCTAssertNil(model.refusal)
        XCTAssertEqual(model.email, "noura@shop.test", "the address typed is kept")
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

/// Saved and the wishlists are two different things, on the owner's word: a
/// heart fills for either, and choosing a wishlist never puts it in Saved.
@MainActor
final class SavedModelTests: XCTestCase {
    func testAWishlistIsNotSaved() async throws {
        let account = FakeAccountService()
        let saved = SavedModel(account: account, defaults: isolatedDefaults())
        await saved.adoptAccount()
        _ = try await saved.wish("41", visibility: "private", title: "My wishlist")
        XCTAssertEqual(saved.ids, [], "a wish is not a save")
        XCTAssertEqual(saved.wished, ["41"])
        XCTAssertTrue(saved.isHearted("41"), "the heart fills for something on a list")
        XCTAssertEqual(saved.ids.count, 0, "the header's heart counts Saved items, and a wish is not one")

        await saved.save("42")
        XCTAssertEqual(saved.ids, ["42"])
        XCTAssertFalse(saved.wished.contains("42"), "a save is not a wish")
        XCTAssertEqual(saved.ids.count, 1)
    }

    func testAFilledHeartOnAListComesOffEverything() async throws {
        let account = FakeAccountService()
        account.saved = ["41"]
        let saved = SavedModel(account: account, defaults: isolatedDefaults())
        await saved.adoptAccount()
        _ = try await saved.wish("41", visibility: "public", title: "Wishes")
        await saved.unwish("41")
        XCTAssertEqual(account.unwished, ["41"])
        XCTAssertFalse(saved.isHearted("41"))
    }

    func testAGuestsHeartsJoinTheAccountAndLeaveTheDevice() async {
        let account = FakeAccountService()
        let defaults = isolatedDefaults()
        let guest = SavedModel(account: account, defaults: defaults)
        await guest.save("7")
        await guest.save("9")
        await guest.adoptAccount()
        XCTAssertEqual(account.saved, ["7", "9"], "an account with nothing saved takes the device's hearts")
        XCTAssertNil(defaults.stringArray(forKey: SavedModel.key), "and the device keeps none of them")
        await guest.unsave("7")
        // The next launch: nothing on the device brings the heart back.
        let relaunched = SavedModel(account: account, defaults: defaults)
        await relaunched.adoptAccount()
        XCTAssertEqual(relaunched.ids, ["9"])
        relaunched.signedOut()
        XCTAssertEqual(relaunched.ids, [], "signing out leaves no account's hearts on the phone")
    }

    func testAGuestCountsTheirSaved() async {
        let saved = SavedModel(account: FakeAccountService(), defaults: isolatedDefaults())
        await saved.save("7")
        XCTAssertEqual(saved.ids.count, 1, "the heart counts Saved, for a guest as for anybody")
        XCTAssertTrue(saved.isHearted("7"))
        saved.signedOut()
        XCTAssertEqual(saved.wished, [])
    }
}

@MainActor
final class CheckoutViewModelTests: XCTestCase {
    private let home = SavedAddress(id: 8, label: "Home", contactName: "Noura", contactPhone: "٥٠٠٠ ٠٠٠٠", governorate: "hawalli", addressLine: nil, addressNotes: " Ring twice ",
                                    parts: AddressParts(area: "Salmiya", block: " 4 ", street: "12", building: "15"))

    func testSaysWhatIsMissingFirstReasonFirst() async throws {
        let model = CheckoutViewModel(orders: FakeOrderService(), account: FakeAccountService(), defaults: isolatedDefaults())
        let cart = try await Fixtures.cart()
        XCTAssertEqual(model.blocker(for: nil, address: home), "checkout.needItems")
        XCTAssertEqual(model.blocker(for: cart, address: nil), "checkout.needAddressChoice", "checkout confirms an address the cart chose")
        let unfinished = SavedAddress(id: 2, label: "Office", contactName: nil, contactPhone: "50000000", governorate: "capital", addressLine: nil, addressNotes: nil,
                                      parts: AddressParts(area: "Sharq"))
        XCTAssertEqual(model.blocker(for: cart, address: unfinished), "address.needsParts")
        XCTAssertNil(model.blocker(for: cart, address: home))
    }

    func testPlacesACashOrderFromTheSavedAddress() async throws {
        let orders = FakeOrderService()
        let defaults = isolatedDefaults()
        let model = CheckoutViewModel(orders: orders, account: FakeAccountService(), defaults: defaults)
        let cart = try await Fixtures.cart()
        let placed = await model.place(cart: cart, address: home)
        XCTAssertEqual(placed?.reference, "NL-20261018-YNTM9")
        let sent = try XCTUnwrap(orders.placed.first)
        XCTAssertEqual(sent.paymentMethod, "cod")
        XCTAssertEqual(sent.contactName, "Noura")
        XCTAssertEqual(sent.contactPhone, "+96550000000", "the number is read as Kuwaiti, Arabic-Indic digits and all")
        XCTAssertEqual(sent.addressParts?.block, "4")
        XCTAssertNil(sent.addressParts?.avenue)
        XCTAssertNil(sent.addressLine, "an address in parts is sent as its parts")
        XCTAssertEqual(sent.addressNotes, "Ring twice")
        XCTAssertEqual(sent.deliveryZoneId, "hawalli")
        XCTAssertEqual(defaults.object(forKey: CheckoutViewModel.lastAddressKey) as? Int, 8, "the next order starts from it")
    }

    func testAnAddressKeptAsALineIsSentAsItsLine() async throws {
        let orders = FakeOrderService()
        let model = CheckoutViewModel(orders: orders, account: FakeAccountService(), defaults: isolatedDefaults())
        let old = SavedAddress(id: 3, label: "Old", contactName: nil, contactPhone: "50000000", governorate: "hawalli", addressLine: "Block 4, Street 12, House 15", addressNotes: nil, parts: nil)
        let cart = try await Fixtures.cart()
        _ = await model.place(cart: cart, address: old, accountName: "Noura Al-Sabah")
        let sent = try XCTUnwrap(orders.placed.first)
        XCTAssertNil(sent.addressParts)
        XCTAssertEqual(sent.addressLine, "Block 4, Street 12, House 15")
        XCTAssertEqual(sent.contactName, "Noura Al-Sabah", "an address naming nobody is for the account")
    }

    func testABookWithNothingInTheAreaStartsFromTheAddressUsedLast() {
        let book = [
            SavedAddress(id: 1, label: "Office", contactName: nil, contactPhone: nil, governorate: "capital", addressLine: nil, addressNotes: nil, parts: nil),
            home,
        ]
        XCTAssertEqual(CheckoutViewModel.fallback(book, lastUsed: 8)?.id, 8)
        XCTAssertEqual(CheckoutViewModel.fallback(book, lastUsed: 99)?.id, 1, "else the first")
        XCTAssertNil(CheckoutViewModel.fallback([], lastUsed: 8))
    }

    func testARefusalIsKeptForTheScreenToSay() async throws {
        let orders = FakeOrderService()
        orders.refusal = .server(code: "BAD_REQUEST", message: "order.outOfStock", status: 400)
        let model = CheckoutViewModel(orders: orders, account: FakeAccountService(), defaults: isolatedDefaults())
        let cart = try await Fixtures.cart()
        let placed = await model.place(cart: cart, address: home)
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
        account.details = ProfileDetails(firstName: "Abdul Rahman", lastName: "Al-Ali", phone: "+96555001122", gender: "male", birthday: "1990-05-17")
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
        await model.removeBirthday()
        XCTAssertEqual(try TRPCClient.encodeInput(try XCTUnwrap(account.detailPatches.last)), #"{"json":{"birthday":null}}"#)
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

    func testCheckoutRingsTheAccountsPhoneWhereTheAddressHasNone() async {
        let account = FakeAccountService()
        account.details.phone = "+96555001122"
        let office = SavedAddress(id: 1, label: "Office", contactName: nil, contactPhone: nil, governorate: "capital", addressLine: nil, addressNotes: nil, parts: nil)
        let home = SavedAddress(id: 2, label: "Home", contactName: nil, contactPhone: "50000000", governorate: "hawalli", addressLine: nil, addressNotes: nil, parts: nil)
        let model = CheckoutViewModel(orders: FakeOrderService(), account: account, defaults: isolatedDefaults())
        await model.load(user: FakeAccountService.user)
        XCTAssertEqual(model.phone(for: office), "5500 1122")
        XCTAssertFalse(model.asksPhone(for: office), "the account's number is enough")
        XCTAssertEqual(model.phone(for: home), "50000000", "the address's own number wins")

        account.details.phone = nil
        let other = CheckoutViewModel(orders: FakeOrderService(), account: account, defaults: isolatedDefaults())
        await other.load(user: FakeAccountService.user)
        XCTAssertTrue(other.asksPhone(for: office), "no number anywhere: the driver's is asked for")
        other.typedPhone = " 5000 1111 "
        XCTAssertEqual(other.phone(for: office), "5000 1111")
    }
}

@MainActor
final class OrderDetailViewModelTests: XCTestCase {
    /// An order link opened while signed in as somebody else: the server
    /// answers nothing, and the page says the order is not found rather than
    /// offering Try again over a read that will never find it.
    func testAnOrderThatIsNotThisAccountsIsNotFoundRatherThanFailed() async {
        let model = OrderDetailViewModel(reference: "NL-20261001-ZZZZZ", service: FakeOrderService())
        await model.load()
        XCTAssertTrue(model.missing)
        XCTAssertNil(model.detail.value)
        if case .failed = model.detail { XCTFail("not found is not a failure") }
    }
}

/// Face ID, the third way to sign in: shown only for an address this phone
/// holds a key for, signing the server's challenge, and forgetting a key
/// NetLet no longer holds.
@MainActor
final class FaceIDTests: XCTestCase {
    private func setUp(email: String = "noura@shop.test") async throws -> (FakeAccountService, FakeKeychain, FaceIDModel) {
        let account = FakeAccountService()
        let keychain = FakeKeychain()
        let faceID = FaceIDModel(keychain: keychain, defaults: isolatedDefaults())
        try await faceID.turnOn(email: email, account: account, reason: "Set up")
        return (account, keychain, faceID)
    }

    func testTurningOnMakesAKeyAndRegistersItsPublicHalf() async throws {
        let (account, keychain, faceID) = try await setUp()
        XCTAssertEqual(keychain.prompts, ["Set up"], "the face is asked for once before the key is made")
        let id = try XCTUnwrap(faceID.keyId(for: " NOURA@shop.test "), "the address is compared folded")
        XCTAssertEqual(account.registeredKeys.map(\.keyId), [id])
        XCTAssertEqual(Data(base64Encoded: account.registeredKeys[0].publicKey)?.count, 65)
        XCTAssertNotNil(id.range(of: "^[A-Za-z0-9_-]{22,64}$", options: .regularExpression), "the server's BIOMETRIC_KEY_ID")
        XCTAssertNil(faceID.keyId(for: "someone@shop.test"))
    }

    func testTheTileShowsOnlyForAnAddressThisPhoneHasAKeyFor() async throws {
        let (account, _, faceID) = try await setUp()
        let model = AuthViewModel(account: account, defaults: isolatedDefaults(), faceID: faceID)
        model.method = .faceID
        model.email = "someone@shop.test"
        XCTAssertNil(model.faceIdKind)
        XCTAssertEqual(model.shownMethod, .password, "Face ID chosen last time is the password for another address")
        XCTAssertFalse(model.usesFaceID)
        model.email = "noura@shop.test"
        XCTAssertEqual(model.faceIdKind, .faceID)
        XCTAssertTrue(model.usesFaceID)
        XCTAssertNil(model.passwordProblem, "Face ID needs no password")
    }

    func testSigningInSignsTheServersChallenge() async throws {
        let (account, keychain, faceID) = try await setUp()
        let model = AuthViewModel(account: account, defaults: isolatedDefaults(), faceID: faceID)
        model.email = "noura@shop.test"
        model.method = .faceID
        let user = await model.signInWithFaceID(reason: "Sign in to NetLet")
        XCTAssertEqual(user?.id, 2)
        let id = try XCTUnwrap(faceID.keyId(for: "noura@shop.test"))
        XCTAssertEqual(account.biometricSignIns.map(\.keyId), [id])
        XCTAssertEqual(account.biometricSignIns.first?.challenge, "a-challenge-from-the-server")
        XCTAssertEqual(keychain.signed.last?.message, "netlet-face-id:a-challenge-from-the-server", "Shared/auth/biometricKey.ts's biometricMessage")
    }

    func testClosingThePromptSaysNothing() async throws {
        let (account, keychain, faceID) = try await setUp()
        let model = AuthViewModel(account: account, defaults: isolatedDefaults(), faceID: faceID)
        model.email = "noura@shop.test"
        model.method = .faceID
        keychain.cancels = true
        let user = await model.signInWithFaceID(reason: "Sign in")
        XCTAssertNil(user)
        XCTAssertNil(model.refusal)
        XCTAssertTrue(account.biometricSignIns.isEmpty)
        XCTAssertNotNil(faceID.keyId(for: "noura@shop.test"), "the key stays")
    }

    func testAKeyNetLetNoLongerHoldsIsForgotten() async throws {
        let (account, _, faceID) = try await setUp()
        let model = AuthViewModel(account: account, defaults: isolatedDefaults(), faceID: faceID)
        model.email = "noura@shop.test"
        model.method = .faceID
        account.challengeAnswer = .success(API.BiometricChallenge(challenge: "c", active: false))
        _ = await model.signInWithFaceID(reason: "Sign in")
        XCTAssertEqual(model.refusal, "auth.faceIdOff")
        XCTAssertNil(faceID.keyId(for: "noura@shop.test"))
        XCTAssertNil(faceID.storedId(for: "noura@shop.test"))
        XCTAssertEqual(model.shownMethod, .password, "the tile goes and the password is offered")

        let (other, _, otherFaceID) = try await setUp()
        let again = AuthViewModel(account: other, defaults: isolatedDefaults(), faceID: otherFaceID)
        again.email = "noura@shop.test"
        again.method = .faceID
        other.biometricSignInResult = .failure(.server(code: "NOT_FOUND", message: "auth.faceIdOff", status: 404))
        _ = await again.signInWithFaceID(reason: "Sign in")
        XCTAssertEqual(again.refusal, "auth.faceIdOff")
        XCTAssertNil(otherFaceID.storedId(for: "noura@shop.test"))
    }

    func testFacesThatChangedPutTheKeyAwayAndSetUpAgainReusesItsId() async throws {
        let (account, keychain, faceID) = try await setUp()
        let id = try XCTUnwrap(faceID.keyId(for: "noura@shop.test"))
        let model = AuthViewModel(account: account, defaults: isolatedDefaults(), faceID: faceID)
        model.email = "noura@shop.test"
        model.method = .faceID
        keychain.changed.insert(id)
        _ = await model.signInWithFaceID(reason: "Sign in")
        XCTAssertEqual(model.refusal, "ios.biometric.changed")
        XCTAssertNil(faceID.keyId(for: "noura@shop.test"), "a key that can never sign again is not offered")
        XCTAssertEqual(faceID.storedId(for: "noura@shop.test"), id)

        try await faceID.turnOn(email: "noura@shop.test", account: account, reason: "Set up")
        XCTAssertEqual(faceID.keyId(for: "noura@shop.test"), id, "set up again under the same id, so the server replaces the old key")
        XCTAssertEqual(account.registeredKeys.map(\.keyId), [id, id])
    }

    func testTurningOffForgetsTheKeyHereAndOnTheServer() async throws {
        let (account, keychain, faceID) = try await setUp()
        let id = try XCTUnwrap(faceID.keyId(for: "noura@shop.test"))
        try await faceID.turnOff(email: "noura@shop.test", account: account)
        XCTAssertEqual(account.removedKeys, [id])
        XCTAssertFalse(keychain.hasKey(id))
        XCTAssertFalse(faceID.isOn(for: "noura@shop.test"))
    }

    func testARefusedRegistrationLeavesNoKey() async throws {
        let account = FakeAccountService()
        account.biometricRegisterError = .server(code: "PRECONDITION_FAILED", message: "auth.faceIdUnavailable", status: 412)
        let keychain = FakeKeychain()
        let faceID = FaceIDModel(keychain: keychain, defaults: isolatedDefaults())
        do {
            try await faceID.turnOn(email: "noura@shop.test", account: account, reason: "Set up")
            XCTFail("the server refused it")
        } catch {}
        XCTAssertTrue(keychain.keys.isEmpty)
        XCTAssertFalse(faceID.isOn(for: "noura@shop.test"))
    }

    func testNotNowIsRememberedForTheAddress() {
        let faceID = FaceIDModel(keychain: FakeKeychain(), defaults: isolatedDefaults())
        XCTAssertFalse(faceID.declined("noura@shop.test"))
        faceID.decline("Noura@shop.test")
        XCTAssertTrue(faceID.declined("noura@shop.test"))
        XCTAssertFalse(faceID.declined("someone@shop.test"))
    }
}
