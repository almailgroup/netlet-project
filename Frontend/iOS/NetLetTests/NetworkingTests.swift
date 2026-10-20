import XCTest
@testable import NetLet

/// The wire format: tRPC over HTTP with superjson, as the server speaks it.
final class TRPCClientTests: XCTestCase {
    let configuration = APIConfiguration(baseURL: URL(string: "https://shop.example")!)

    func testAQuerySendsItsInputInTheAddressPercentEncoded() async throws {
        let transport = StubTransport { _ in (200, #"{"result":{"data":{"json":{"products":[],"total":0,"correctedTo":null}}}}"#) }
        let client = TRPCClient(configuration: configuration, transport: transport)
        _ = try await client.call(API.search, .init(q: "tea & cups", locale: "en"))
        let request = try XCTUnwrap(transport.sent.first)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertEqual(request.url?.path, "/api/trpc/search.products")
        let url = try XCTUnwrap(request.url)
        let query = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery)
        XCTAssertTrue(query.hasPrefix("input="))
        XCTAssertFalse(query.dropFirst(6).contains("&"), "an & inside the JSON must not read as a separator")
        let json = try XCTUnwrap(query.dropFirst(6).removingPercentEncoding)
        XCTAssertEqual(json, #"{"json":{"locale":"en","q":"tea & cups"}}"#)
    }

    func testAMutationPostsItsInputWrapped() async throws {
        let transport = StubTransport { _ in (200, #"{"result":{"data":{"json":{"sent":true}}}}"#) }
        let client = TRPCClient(configuration: configuration, transport: transport)
        try await AccountService(client: client).resendCode(email: "noura@shop.test")
        let request = try XCTUnwrap(transport.sent.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(String(decoding: request.httpBody ?? Data(), as: UTF8.self), #"{"json":{"email":"noura@shop.test"}}"#)
    }

    func testAMutationWithNoInputStillSendsAnObject() async throws {
        let transport = StubTransport { _ in (200, #"{"result":{"data":{"json":{"success":true}}}}"#) }
        try await AccountService(client: TRPCClient(configuration: configuration, transport: transport)).signOut()
        XCTAssertEqual(String(decoding: transport.sent.first?.httpBody ?? Data(), as: UTF8.self), #"{"json":null}"#)
    }

    func testARefusalCarriesTheServersMessageKey() async throws {
        let transport = StubTransport { _ in
            (401, #"{"error":{"json":{"message":"auth.invalidCredentials","code":-32001,"data":{"code":"UNAUTHORIZED","httpStatus":401,"path":"auth.login"}}}}"#)
        }
        let client = TRPCClient(configuration: configuration, transport: transport)
        do {
            _ = try await AccountService(client: client).signIn(email: "a@b.co", password: "x")
            XCTFail("a refusal must throw")
        } catch let error as APIError {
            XCTAssertEqual(error, .server(code: "UNAUTHORIZED", message: "auth.invalidCredentials", status: 401))
            XCTAssertEqual(error.messageKey(knownKey: Phrasebook.shared.has), "auth.invalidCredentials")
        }
    }

    func testAMessageThatIsNotAKeyIsDescribedByItsCode() {
        let known = Phrasebook.shared.has
        XCTAssertEqual(APIError.server(code: "INTERNAL_SERVER_ERROR", message: "column x does not exist", status: 500).messageKey(knownKey: known), "error.serverProblem")
        XCTAssertEqual(APIError.server(code: "UNAUTHORIZED", message: "UNAUTHORIZED", status: 401).messageKey(knownKey: known), "ios.error.signIn")
        XCTAssertEqual(APIError.offline.messageKey(knownKey: known), "ios.error.offline")
        XCTAssertEqual(APIError.from(URLError(.notConnectedToInternet)), .offline)
        XCTAssertEqual(APIError.from(CancellationError()), .cancelled)
    }

    func testANullAnswerIsNil() async throws {
        let transport = StubTransport { _ in (200, #"{"result":{"data":{"json":null}}}"#) }
        let user = try await AccountService(client: TRPCClient(configuration: configuration, transport: transport)).currentUser()
        XCTAssertNil(user)
    }

    func testResolvesPicturesOnTheSiteAndLeavesFullAddressesAlone() {
        XCTAssertEqual(configuration.resolve("/departments/grocery.webp")?.absoluteString, "https://shop.example/departments/grocery.webp")
        XCTAssertEqual(configuration.resolve("https://cdn.example/a.jpg")?.absoluteString, "https://cdn.example/a.jpg")
        XCTAssertNil(configuration.resolve("javascript:alert(1)"))
        XCTAssertNil(configuration.resolve(nil))
    }
}

/// Every recorded answer the demo serves decodes into the app's models — the
/// shapes were captured off a real NetLet server, so this is the contract test.
final class FixtureDecodingTests: XCTestCase {
    let client = Fixtures.client

    func testTheCatalogue() async throws {
        let products = try await client.call(API.products, .init(first: 24))
        XCTAssertFalse(products.isEmpty)
        XCTAssertTrue(products.allSatisfy { !$0.variants.isEmpty })
        let product = try await client.call(API.product, .init(handle: products[0].handle, locale: "en"))
        XCTAssertNotNil(product)
        let counts = try await client.call(API.departmentCounts)
        XCTAssertFalse(counts.isEmpty)
        let found = try await client.call(API.search, .init(q: "rice", locale: "en"))
        XCTAssertGreaterThanOrEqual(found.total, found.products.count)
    }

    func testTheFootersContact() async throws {
        let contact = try await client.call(API.contact)
        XCTAssertEqual(contact.phone, "96550808606")
        XCTAssertEqual(ShopContact.display(contact.phone ?? ""), "+965 5080 8606")
        XCTAssertNotNil(contact.visit)
        // The shop's own defaults say the same before the server answers.
        XCTAssertEqual(ShopContact.fallback.phone, contact.phone)
    }

    func testTheBag() async throws {
        let cart = try await Fixtures.cart()
        XCTAssertFalse(cart.isEmpty)
        XCTAssertEqual(cart.itemCount, cart.items.reduce(0) { $0 + $1.quantity })
        XCTAssertEqual(cart.subtotal + cart.delivery.total, cart.total)
    }

    func testTheAccount() async throws {
        let signedOut = try await client.call(API.me)
        XCTAssertNil(signedOut)
        let user = try await client.call(API.signIn, .init(email: "noura@shop.test", password: "x", remember: true))
        XCTAssertEqual(user.firstName, "Noura")
        XCTAssertNotNil(user.createdAt)
        let book = try await client.call(API.addresses)
        XCTAssertEqual(book.first?.parts?.area, "Salmiya")
        let profile = try await client.call(API.profile)
        XCTAssertEqual(profile.deliveryZoneId, "hawalli")
    }

    func testOrders() async throws {
        let page = try await client.call(API.orders, .init(page: 1, pageSize: 20))
        XCTAssertFalse(page.rows.isEmpty)
        let detail = try await client.call(API.order, .init(reference: page.rows[0].reference))
        XCTAssertFalse(detail.lines.isEmpty)
        XCTAssertEqual(detail.lines.reduce(Money.zero) { $0 + $1.lineTotal }, detail.order.itemsTotal)
        let placed = try await client.call(API.placeOrder, .init(cartId: "x", paymentMethod: "cod"))
        XCTAssertTrue(placed.reference.hasPrefix("NL-"))
    }

    func testWhatCanBeDoneAboutAnOrder() async throws {
        let detail = try await client.call(API.order, .init(reference: "NL-20261001-J7MWY"))
        let line = try XCTUnwrap(detail.lines.first)
        XCTAssertEqual(line.returnState?.returnable, true)
        XCTAssertTrue(detail.mayAskReturn(for: line), "a delivered line in its window with nothing asked may be sent back")
        XCTAssertEqual(detail.windowDays, ReferenceData.shared.rules.returnWindowDays)
        let parcel = try XCTUnwrap(detail.caredFor.first, "an arrived parcel has a card")
        XCTAssertTrue(parcel.ratingState.allowed)
        XCTAssertEqual(parcel.ceiling([line.id]), line.lineTotal, "a claim is capped by what the lines were sold for")
        XCTAssertEqual(parcel.ceiling([]), .zero)
        XCTAssertEqual(detail.documents.first?.isCredit, false)

        let invoice = try await client.call(API.invoice, .init(number: try XCTUnwrap(detail.documents.first).number))
        XCTAssertEqual(invoice.document.orderReference, detail.order.reference)
        XCTAssertEqual(invoice.document.sellers.flatMap(\.lines).reduce(Money.zero) { $0 + $1.lineTotal }, invoice.document.goods)
        XCTAssertEqual(invoice.document.paidWith.cash, invoice.document.total)
        let checked = try await client.call(API.verifyInvoice, .init(number: invoice.document.number, code: invoice.verifyCode))
        XCTAssertEqual(checked?.total, invoice.document.total)
        _ = try await client.call(API.tracking, .init(reference: detail.order.reference))

        // A line that has had its refund is not offered a second.
        let refunded = ReturnRequest(id: 1, orderItemId: line.id, kind: "refund", reason: "damaged", status: "refunded", decidedBy: "auto",
                                     declineReason: nil, refundAmount: line.lineTotal, refundPaidAt: Date(), replacementReference: nil, createdAt: Date())
        XCTAssertFalse(refunded.isOpen)
        XCTAssertFalse(refunded.mayWithdraw)
        let data = Data(#"{"order":{},"lines":[]}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(OrderDetail.self, from: data), "an order without its record is not an order")
    }

    func testAnInvoiceIsCheckableAndDatedInBothCalendars() throws {
        XCTAssertTrue(InvoiceWording.isNumber("INV-2026-000002"))
        XCTAssertTrue(InvoiceWording.isNumber("CRN-2026-000010"))
        XCTAssertFalse(InvoiceWording.isNumber("INV-26-2"))
        let url = InvoiceWording.verifyURL(base: try XCTUnwrap(URL(string: "https://netlet.example/")), number: "INV-2026-000002", code: "ABC123")
        XCTAssertEqual(url.absoluteString, "https://netlet.example/invoices/verify/INV-2026-000002?code=ABC123")
        XCTAssertEqual(Route.from(link: url.absoluteString), .verifyInvoice(number: "INV-2026-000002", code: "ABC123"))
        XCTAssertEqual(Route.from(link: "/invoices/INV-2026-000002"), .invoice(number: "INV-2026-000002"))
        XCTAssertNotNil(InvoiceWording.qr(url.absoluteString))
        // October 2026 falls in 1448 by Umm al-Qura.
        let issued = try XCTUnwrap(ISO8601.withFraction.date(from: "2026-10-02T11:49:17.598Z"))
        XCTAssertTrue(InvoiceWording.gregorian(issued, .en).contains("2026"))
        XCTAssertTrue(InvoiceWording.hijri(issued, .en).contains("1448"))
        XCTAssertFalse(InvoiceWording.hijri(issued, .ar).contains("٤"), "Latin digits on the Arabic page, as the web writes them")
    }

    func testSelling() async throws {
        let identity = try await client.call(API.sellerIdentity)
        XCTAssertTrue(identity.isStoreMember)
        let categories = try await client.call(API.categories)
        XCTAssertTrue(categories.contains { $0.slug == "electronics" })
        let listings = try await client.call(API.sellerProducts, .init(vendorId: identity.vendorId, page: 1))
        XCTAssertFalse(listings.rows.isEmpty)
    }

    func testTheAccountSections() async throws {
        let features = try await client.call(API.features)
        XCTAssertTrue(features.isOn("wishlists"))
        XCTAssertFalse(features.isOn("subscriptions"))
        XCTAssertTrue(features.isOn("a switch the server never named"), "an unnamed switch reads as on")

        let inbox = try await client.call(API.notices, .init(page: 1))
        XCTAssertEqual(inbox.entries.count, inbox.total)
        let offer = try XCTUnwrap(inbox.entries.first { $0.kind == "offer_answered" })
        XCTAssertEqual(offer.values(.ar)["store"], "أكمي للإلكترونيات", "an Arabic twin is used on the Arabic page")
        XCTAssertEqual(offer.values(.en)["store"], "Acme Electronics")
        XCTAssertNil(offer.values(.en)["storeAr"])
        XCTAssertNotNil(Route.from(link: inbox.entries[0].link ?? ""))
        _ = try await client.call(API.noticeChannels)
        _ = try await client.call(API.noticePreferences)
        _ = try await client.call(API.unreadNotices)
        _ = try await client.call(API.onTheWay)

        let lists = try await client.call(API.wishlists)
        let list = try XCTUnwrap(lists.first)
        let detail = try await client.call(API.wishlist, .init(listId: list.id))
        XCTAssertEqual(detail.items.count, list.itemCount)
        let products = try await client.call(API.productsByIds, .init(ids: detail.items.map(\.productId), locale: "en"))
        XCTAssertTrue(detail.items.allSatisfy { item in products.contains { $0.id == item.productId } })
        let token = try await client.call(API.wishlistShareToken, .init(listId: list.id))
        XCTAssertNotNil(token)
        let phone = try await client.call(API.wishlistPhone)
        XCTAssertEqual(phone.map(PhoneNumber.display), "5500 1122")

        let offers = try await client.call(API.priceRequests)
        XCTAssertEqual(offers.first?.state, "offered")
        XCTAssertLessThan(try XCTUnwrap(offers.first?.offeredPrice), try XCTUnwrap(offers.first?.listPrice))

        let reviewable = try await client.call(API.reviewableLines)
        XCTAssertFalse(reviewable.isEmpty)

        let conversations = try await client.call(API.sellerConversations)
        let thread = try await client.call(API.sellerThread, .init(conversationId: try XCTUnwrap(conversations.first).id))
        XCTAssertFalse(thread.messages.isEmpty)

        let help = try await client.call(API.supportConversations)
        let opened = try await client.call(API.supportThread, .init(id: try XCTUnwrap(help.first).id))
        let automatic = try XCTUnwrap(opened.messages.first { $0.author == "automatic" })
        XCTAssertEqual(automatic.answer?.first?.params["reference"], opened.orderReference, "a number param is read as text")

        let rewards = try await client.call(API.rewards)
        XCTAssertFalse(rewards.code.isEmpty)
        let affiliate = try await client.call(API.affiliate)
        XCTAssertEqual(affiliate?.status, "active")
        let standing = try await client.call(API.standingOrders)
        XCTAssertTrue(standing.isEmpty)
    }

    func testTheFootersPages() async throws {
        let content = try XCTUnwrap(SiteContent.shared, "content.json is bundled")
        XCTAssertFalse(content.help.groups.isEmpty)
        XCTAssertEqual(content.legal.figures["days"], "\(ReferenceData.shared.rules.returnWindowDays)")
        XCTAssertNotNil(content.legal.documents["terms"])
        XCTAssertNotNil(content.legal.documents["sellers"])
        XCTAssertTrue(content.selling.documentTypes.contains("application/pdf"))

        let guides = try await client.call(API.guides)
        let guide = try await client.call(API.guide, .init(slug: try XCTUnwrap(guides.first { $0.audience == "shopper" }).slug))
        XCTAssertEqual(guide?.steps.count, guides.first { $0.slug == guide?.slug }?.stepCount)
        XCTAssertEqual(pickGuideText(.ar, en: "Return", ar: "").language, .en, "an Arabic page falls back to the English that was written")

        let list = try await client.call(API.giftList, .init(token: "3Uw_z-D7MEV5zRx9dULTA3MyjvZLZnm9"))
        XCTAssertEqual(list?.items.first?.state, "available")
        let byPhone = try await client.call(API.giftListsByPhone, .init(phone: "+96555001122"))
        XCTAssertEqual(byPhone.first?.token, list?.token)

        let found = try await client.call(API.lookupOrder, .init(reference: "NL-20261019-GNVRV", email: "noura@shop.test"))
        XCTAssertFalse(try XCTUnwrap(found).lines.isEmpty)

        let application = try await client.call(API.myApplication)
        XCTAssertNil(application)
        _ = try await client.call(API.applicationDocuments)
    }

    func testTheProductPagesPanels() async throws {
        let reviews = try await client.call(API.productReviews, .init(productId: "1", limit: 20))
        XCTAssertEqual(reviews.summary?.distribution["5"], reviews.total)
        let together = try await client.call(API.boughtTogether, .init(productId: "2", limit: 4, locale: "en"))
        XCTAssertFalse(together.isEmpty)
        let open = try await client.call(API.priceRequestsOpen, .init(variantIds: [2]))
        XCTAssertEqual(open, [2])
        let held = try await client.call(API.myPriceRequest, .init(variantId: 2))
        XCTAssertEqual(held?.state, "offered")
        _ = try await client.call(API.follows)
        _ = try await client.call(API.followers, .init(productId: "2"))
        _ = try await client.call(API.bundles, .init(variantId: "2"))
        let fit = try await client.call(API.fit, .init(productId: "10"))
        XCTAssertEqual(fit.tendency, "runsSmall", "four returns all too small is a tendency")
    }

    func testTheSizeGuideShowsItsWorking() {
        let chart = SizeChart(axis: "Size", measures: ["chest"], rows: [
            .init(size: "S", ranges: ["chest": [86, 91]]),
            .init(size: "M", ranges: ["chest": [92, 97]]),
            .init(size: "L", ranges: ["chest": [98, 104]]),
        ])
        XCTAssertEqual(SizeAnswer.recommend(chart, measurements: ["chest": 94]).size, "M")
        XCTAssertEqual(SizeAnswer.recommend(chart, measurements: [:]), .nothingToCompare)
        XCTAssertEqual(SizeAnswer.recommend(chart, measurements: ["chest": 70]), .belowChart)
        XCTAssertEqual(SizeAnswer.recommend(chart, measurements: ["chest": 120]), .aboveChart)
        // Between sizes it takes the nearer, and on a tie the larger: a little loose is worn.
        XCTAssertEqual(SizeAnswer.recommend(chart, measurements: ["chest": 91.5]).size, "M")
        let runsSmall = FitFeedback(tooSmall: 4, tooLarge: 0)
        XCTAssertEqual(runsSmall.advice(chart, answer: SizeAnswer.recommend(chart, measurements: ["chest": 96])), "L")
        XCTAssertNil(runsSmall.advice(chart, answer: SizeAnswer.recommend(chart, measurements: ["chest": 92])))
    }

    func testALinkOnTheSiteOpensItsScreen() {
        XCTAssertEqual(Route.from(link: "/help"), .helpCentre)
        XCTAssertEqual(Route.from(link: "/seller-agreement"), .legal(.sellers))
        XCTAssertEqual(Route.from(link: "/guides/how-to-return-an-item"), .guide(slug: "how-to-return-an-item"))
        XCTAssertEqual(Route.from(link: "/gifts/abc12345"), .gift(token: "abc12345"))
        XCTAssertEqual(Route.from(link: "/account/orders?order=NL-1"), .order(reference: "NL-1"))
        XCTAssertEqual(Route.from(link: "/account/messages"), .messages)
        XCTAssertEqual(Route.from(link: "/products/basmati-rice-5kg"), .product(handle: "basmati-rice-5kg"))
        XCTAssertEqual(Route.from(link: "/category/all"), .department(slug: nil))
        XCTAssertNil(Route.from(link: "/somewhere/else"))
    }

    func testTheShopperVariantIsSignedInAndFallsBackElsewhere() async throws {
        let shopper = TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: "shopper"))
        let user = try await shopper.call(API.me)
        XCTAssertEqual(user?.firstName, "Noura")
        let products = try await shopper.call(API.products, .init(first: 24))
        XCTAssertFalse(products.isEmpty, "a procedure with no variant answers from the shared recording")
    }

    func testAProcedureWithNoRecordingIsNotFoundRatherThanInvented() async {
        do {
            _ = try await client.call(API.changeEmail, .init(email: "a@b.co", currentPassword: "x"))
            XCTFail("expected not found")
        } catch let error as APIError {
            XCTAssertEqual(error.messageKey(knownKey: Phrasebook.shared.has), "ios.error.notFound")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }
}
