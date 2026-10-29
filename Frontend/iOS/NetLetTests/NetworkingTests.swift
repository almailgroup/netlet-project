import UIKit
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

    func testAProcedureThatReturnsNothingIsReadAsDone() async throws {
        // superjson writes a void result as `null` with a note that it was undefined.
        let transport = StubTransport { _ in (200, #"{"result":{"data":{"json":null,"meta":{"values":["undefined"]}}}}"#) }
        let client = TRPCClient(configuration: configuration, transport: transport)
        _ = try await client.call(API.rejectApplication, .init(id: 2, reason: "No licence"))
        _ = try await client.call(API.markAuditSeen)
        XCTAssertEqual(transport.sent.count, 2)
    }

    func testANullAnswerIsNil() async throws {
        let transport = StubTransport { _ in (200, #"{"result":{"data":{"json":null}}}"#) }
        let user = try await AccountService(client: TRPCClient(configuration: configuration, transport: transport)).currentUser()
        XCTAssertNil(user)
    }

    /// The web client's rule: a read that met the server's own trouble is
    /// asked once more, and a refusal or a mutation never is.
    func testAReadThatMetTheServersTroubleIsAskedOnceMore() async throws {
        var calls = 0
        let transport = StubTransport { _ in
            calls += 1
            return calls == 1
                ? (500, #"{"error":{"json":{"message":"error.serverProblem","code":-32603,"data":{"code":"INTERNAL_SERVER_ERROR","httpStatus":500}}}}"#)
                : (200, #"{"result":{"data":{"json":{"beauty":27}}}}"#)
        }
        let client = TRPCClient(configuration: configuration, transport: transport, retryPause: .zero)
        let counts = try await client.call(API.departmentCounts)
        XCTAssertEqual(counts, ["beauty": 27])
        XCTAssertEqual(transport.sent.count, 2)
    }

    func testARefusalAndAMutationAreAskedOnce() async {
        let refused = StubTransport { _ in
            (404, #"{"error":{"json":{"message":"ios.error.notFound","code":-32004,"data":{"code":"NOT_FOUND","httpStatus":404}}}}"#)
        }
        _ = try? await TRPCClient(configuration: configuration, transport: refused, retryPause: .zero).call(API.departmentCounts)
        XCTAssertEqual(refused.sent.count, 1)

        let broken = StubTransport { _ in
            (500, #"{"error":{"json":{"message":"error.serverProblem","code":-32603,"data":{"code":"INTERNAL_SERVER_ERROR","httpStatus":500}}}}"#)
        }
        _ = try? await AccountService(client: TRPCClient(configuration: configuration, transport: broken, retryPause: .zero)).signOut()
        XCTAssertEqual(broken.sent.count, 1, "a mutation may have landed; a second would do it twice")
        _ = try? await TRPCClient(configuration: configuration, transport: broken, retryPause: .zero).call(API.departmentCounts)
        XCTAssertEqual(broken.sent.count, 3, "a read is asked twice and no more")
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

    /// The pieces the PDF audit added: fraud watch, the placement calendar,
    /// the model's import filing, past sizes and "Find similar".
    func testTheRequirementFixesDecode() async throws {
        let reviews = try await client.call(API.reviewWatch)
        XCTAssertFalse(reviews.isEmpty)
        XCTAssertTrue(reviews.flatMap(\.flags).allSatisfy { Phrasebook.shared.has("fraud.\($0.signal)") }, "every flag the server raises has its words")
        _ = try await client.call(API.referralWatch)
        let calendar = try await client.call(API.adCalendar, .init(productId: 1, slot: "home"))
        XCTAssertEqual(calendar.days.count, WarehouseRules.shared.ads.maxLeadDays + WarehouseRules.shared.ads.maxDays, "every day a run may start on, and the last run's tail")
        XCTAssertTrue(calendar.days.allSatisfy { $0.free + $0.taken == calendar.capacity })
        let filed = try await client.call(API.categoriseImport, .init(rows: [.init(line: 2, text: "Mystery widget")]))
        XCTAssertFalse(filed.available)
        let past = try await client.call(API.mySizes, .init(productId: "10"))
        XCTAssertFalse(past.isEmpty)
        let similar = try await client.call(API.findSimilar, .init(productId: "10", locale: "en"))
        XCTAssertEqual(similar.route, .department(slug: "style"))
        // The second round: fraud alerts per desk, and whether tracking asks Apple.
        let alerts = try await client.call(API.fraudUnseen)
        XCTAssertEqual(alerts.orders + alerts.watch, 3)
        let maps = try await client.call(API.mapAvailability)
        XCTAssertEqual(maps.drivingTimes, false)
    }

    /// The approved round (A–H): the commission desk and its proposals, a
    /// store's warnings, the referral rates, the affiliates' products and a
    /// return's reading — each as the server answered it.
    func testTheApprovedRoundDecodes() async throws {
        let proposals = try await client.call(API.commissionProposals, .init(status: "pending"))
        XCTAssertEqual(proposals.rows.first?.status, "pending")
        let waiting = try await client.call(API.proposalsWaiting)
        XCTAssertEqual(waiting, proposals.total)
        let stores = try await client.call(API.commissionStores, .init())
        XCTAssertFalse(stores.rows.isEmpty)
        let warnings = try await client.call(API.storeWarnings, .init(vendorId: 2))
        XCTAssertEqual(warnings.standing, warnings.rows.filter { $0.state == "standing" }.count)
        XCTAssertEqual(warnings.suspendAt, WarningRules().suspendAt)
        let settings = try await client.call(API.platformSettings)
        XCTAssertEqual(settings.map(\.key), ["referral.productPercent", "referral.invitePercent"])
        XCTAssertTrue(settings.allSatisfy { $0.normalise($0.value) == $0.value })
        _ = try await client.call(API.affiliateProducts, .init())
        let reading = try await client.call(API.returnReadAvailable)
        XCTAssertFalse(reading)
        let rewards = try await client.call(API.rewards)
        // What is held is the entries still waiting on their return window,
        // and the next to free is the earliest of them.
        let stillHeld = rewards.entries.filter { $0.availableAt != nil }
        let heldPoints: Int = stillHeld.reduce(0) { $0 + $1.points }
        let firstRelease: Date? = stillHeld.compactMap { $0.availableAt }.min()
        XCTAssertEqual(rewards.held, heldPoints)
        XCTAssertEqual(rewards.nextRelease, firstRelease)
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

    func testTheAssistantIsDrawnOnlyWithAGatewayBehindIt() async throws {
        let available = try await client.call(API.aiAvailable)
        XCTAssertTrue(available.chat)
        let session = try await client.call(API.chatSession)
        XCTAssertFalse(session.available, "the demo has no gateway, so a question says it could not be answered")
        let photo = try await client.call(API.photoAvailable)
        XCTAssertFalse(photo.available)
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

        let help = try await client.call(API.supportConversations)
        let opened = try await client.call(API.supportThread, .init(id: try XCTUnwrap(help.first).id))
        let automatic = try XCTUnwrap(opened.messages.first { $0.author == "automatic" })
        XCTAssertEqual(automatic.answer?.first?.params["reference"], opened.orderReference, "a number param is read as text")

        let rewards = try await client.call(API.rewards)
        XCTAssertFalse(rewards.code.isEmpty)
        let affiliate = try await client.call(API.affiliate)
        XCTAssertEqual(affiliate?.status, "active")
        // A member's links earn NetLet points (3.7): the sales add up to what
        // was earned, the held part is the points page's held, and the code a
        // member's Share carries is the dashboard's own.
        let sales = try XCTUnwrap(affiliate?.sales)
        XCTAssertFalse(sales.isEmpty)
        XCTAssertEqual(affiliate?.earnedPoints, sales.filter { !$0.reversed }.reduce(0) { $0 + $1.points })
        XCTAssertEqual(affiliate?.heldPoints, rewards.held)
        XCTAssertNil(affiliate?.earlier)
        let code = try await client.call(API.memberCode)
        XCTAssertEqual(code?.code, affiliate?.code)
        XCTAssertEqual(code?.joined, true)
        XCTAssertEqual(ReferralCode.productPath(handle: "linen-cushion-pair", code: code?.code), "/products/linen-cushion-pair?ref=\(rewards.code)")
        XCTAssertEqual(ReferralCode.productPath(handle: "linen-cushion-pair", code: nil), "/products/linen-cushion-pair")
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

    /// `sizeFromPurchases` and `sizeOnChart`, the TypeScript's own cases.
    func testTheShoppersOwnPurchasesSuggestASize() {
        let shirts = SizeChart(axis: "Size", measures: ["chest"], rows: [
            .init(size: "S", ranges: ["chest": [86, 91]]),
            .init(size: "M", ranges: ["chest": [92, 97]]),
            .init(size: "L", ranges: ["chest": [98, 103]]),
            .init(size: "XL", ranges: ["chest": [104, 109]]),
        ])
        func day(_ text: String) -> Date { ISO8601DateFormatter().date(from: text + "T00:00:00Z")! }
        XCTAssertEqual(shirts.size(named: "M"), "M")
        XCTAssertEqual(shirts.size(named: "Navy / xl"), "XL")
        XCTAssertNil(shirts.size(named: "Large"))
        XCTAssertNil(shirts.size(named: nil))
        XCTAssertEqual(shirts.fromPurchases([
            .init(variantTitle: "M", outcome: "kept", at: day("2026-05-01")),
            .init(variantTitle: "White / M", outcome: "kept", at: day("2026-07-01")),
            .init(variantTitle: "L", outcome: "kept", at: day("2026-02-01")),
        ]), PurchaseSuggestion(size: "M", kept: 2, tooSmall: 0, tooLarge: 0))
        XCTAssertEqual(shirts.fromPurchases([.init(variantTitle: "S", outcome: "tooSmall", at: day("2026-05-01"))]),
                       PurchaseSuggestion(size: "M", kept: 0, tooSmall: 1, tooLarge: 0))
        XCTAssertEqual(shirts.fromPurchases([.init(variantTitle: "XL", outcome: "tooLarge", at: day("2026-05-01"))]),
                       PurchaseSuggestion(size: "L", kept: 0, tooSmall: 0, tooLarge: 1))
        XCTAssertNil(shirts.fromPurchases([.init(variantTitle: "XL", outcome: "tooSmall", at: day("2026-05-01"))]), "nothing above the largest")
        XCTAssertEqual(shirts.fromPurchases([
            .init(variantTitle: "M", outcome: "kept", at: day("2026-01-01")),
            .init(variantTitle: "L", outcome: "kept", at: day("2026-09-01")),
        ])?.size, "L", "a tie goes to the most recent")
        XCTAssertNil(shirts.fromPurchases([.init(variantTitle: "42", outcome: "kept", at: day("2026-01-01"))]))
        XCTAssertNil(shirts.fromPurchases([]))
    }

    func testALinkOnTheSiteOpensItsScreen() {
        XCTAssertEqual(Route.from(link: "/help"), .helpCentre)
        XCTAssertEqual(Route.from(link: "/seller-agreement"), .legal(.sellers))
        XCTAssertEqual(Route.from(link: "/guides/how-to-return-an-item"), .guide(slug: "how-to-return-an-item"))
        XCTAssertEqual(Route.from(link: "/gifts/abc12345"), .gift(token: "abc12345"))
        XCTAssertEqual(Route.from(link: "/account/orders?order=NL-1"), .order(reference: "NL-1"))
        // The shopper–store messages went on the owner's word; an old link opens nothing.
        XCTAssertNil(Route.from(link: "/account/messages"))
        XCTAssertEqual(Route.from(link: "/products/basmati-rice-5kg"), .product(handle: "basmati-rice-5kg"))
        XCTAssertEqual(Route.from(link: "/category/all"), .department(slug: nil))
        XCTAssertEqual(Route.from(link: "/category/style?q=shirt"), .search(query: "shirt", department: "style"))
        XCTAssertEqual(Route.from(link: "/search?q=kettle"), .search(query: "kettle"))
        XCTAssertNil(Route.from(link: "/somewhere/else"))
    }

    func testThePortal() async throws {
        let actor = try await client.call(API.portalIdentity, .init())
        XCTAssertEqual(actor.kind, "vendor")
        XCTAssertTrue(actor.inPortal)
        let counts = try await client.call(API.portalCounts, .init())
        XCTAssertGreaterThan(counts.published, 0)
        let health = try await client.call(API.storeHealth, .init())
        XCTAssertEqual(health?.components.map(\.key), ["catalog", "stock", "compliance", "rating"])
        let sales = try await client.call(API.sales)
        XCTAssertEqual(sales.daily.count, 30, "a bar for each of the last thirty Kuwaiti days")
        XCTAssertNotNil(sales.periods["week"])
        let waiting = try await client.call(API.offersWaiting, .init(vendorId: actor.vendorId))
        XCTAssertEqual(waiting, 0)
        let page = try await client.call(API.sellerProducts, .init(vendorId: actor.vendorId, page: 1, pageSize: 30))
        XCTAssertGreaterThanOrEqual(page.total, page.rows.count)
        XCTAssertNotNil(page.rows.first?.vendorName)
        XCTAssertNotNil(page.rows.first?.cover, "a row is drawn with its first still picture")
        let check = try await client.call(API.deletionCheck, .init(id: page.rows[0].id))
        XCTAssertEqual(check.id, page.rows[0].id)
        XCTAssertTrue(check.blockers.isEmpty)
    }

    func testTheSellersDesk() async throws {
        let orders = try await client.call(API.deskOrders, .init(page: 1))
        XCTAssertFalse(orders.rows.isEmpty)
        let detail = try await client.call(API.deskOrder, .init(orderId: orders.rows[0].id))
        XCTAssertEqual(detail?.order.reference, orders.rows[0].reference)
        XCTAssertTrue(detail?.order.mayRecordCash == true, "a cash order still owed records its cash once")
        let risk = try await client.call(API.orderRisk, .init(ids: [41]))
        XCTAssertTrue(risk.contains { $0.flags.contains { $0.signal == "highValueCash" } })
        let moves = try await client.call(API.stockHistory, .init(limit: 30))
        XCTAssertFalse(moves.isEmpty)
        let low = try await client.call(API.lowStock, .init(page: 1))
        XCTAssertGreaterThanOrEqual(low.total, low.rows.count)
        let asks = try await client.call(API.askInbox, .init(page: 1, open: false))
        XCTAssertEqual(asks.rows.first?.askedPrice, Money(fils: 7500))
        let returns = try await client.call(API.deskReturns, .init(open: false))
        XCTAssertFalse(returns.isEmpty)
        let members = try await client.call(API.storeMembers, .init(vendorId: 2))
        XCTAssertEqual(members.first?.role, "owner")
        let batches = try await client.call(API.payoutBatches)
        XCTAssertTrue(batches.first?.lines.contains { $0.kind == "fee" && $0.amount.fils < 0 } == true, "a placement fee comes off the batch")
        let files = try await client.call(API.payoutFiles, .init())
        XCTAssertNotNil(files.pain001)
        let prepared = try await client.call(API.preparedPayouts, .init())
        XCTAssertEqual(prepared.unfiled, 0)
        let due = try await client.call(API.payoutsDue, .init())
        XCTAssertTrue(due.contains { $0.due.state == "due" && $0.due.window != nil })
        let history = try await client.call(API.payoutHistory, .init(page: 1))
        XCTAssertFalse(history.rows.isEmpty)
    }

    func testTheProductEditorReadsTheWholeProduct() async throws {
        let product = try await client.call(API.editableProduct, .init(id: 10))
        XCTAssertEqual(product?.variants.first?.options?["Size"], "S")
        XCTAssertEqual(product?.sizeChart?.measures, ["chest", "waist"])
        XCTAssertEqual(product?.variants.first?.step, 1)
    }

    func testTheEditorsRulesAreTheShopsOwn() throws {
        let rules = ListingRules.shared
        XCTAssertEqual(rules.fields("electronics").map(\.key), ["brand", "model", "ram", "storage", "warranty"])
        let existing = [
            ProductAttribute(namespace: "spec", key: "brand", label: "Brand", value: "Old"),
            ProductAttribute(namespace: "spec", key: "colourway", label: "Colourway", value: "Teal"),
            ProductAttribute(namespace: "reviews", key: "score", label: "Score", value: "4.5"),
        ]
        let merged = rules.mergeAttributes(existing, departmentSlug: "electronics", values: ["brand": "Acme", "ram": " "])
        XCTAssertEqual(merged.first?.namespace, "reviews", "the review score stays where it was")
        XCTAssertTrue(merged.contains { $0.key == "brand" && $0.value == "Acme" })
        XCTAssertFalse(merged.contains { $0.key == "ram" }, "a blank clears its row rather than storing nothing")
        XCTAssertTrue(merged.contains { $0.key == "colourway" }, "a row the schema does not know is kept")

        XCTAssertEqual(rules.optionProblem([.init(name: "Size", value: "")]), "admin.optionHalf")
        XCTAssertEqual(rules.optionProblem([.init(name: "Colour", value: "Red"), .init(name: "colour", value: "Blue")]), "admin.optionDuplicate")
        XCTAssertNil(rules.optionProblem([.init(name: "", value: ""), .init(name: "Size", value: "M")]))
        XCTAssertEqual(rules.optionsRecord([.init(name: " Size ", value: "M "), .init(name: "", value: "")]), ["Size": "M"])
        XCTAssertTrue(ListingRules.optionsDistinguish([["Size": "S"], ["Size": "M"]]))
        XCTAssertFalse(ListingRules.optionsDistinguish([["Size": "S"], ["Size": "S"]]))

        XCTAssertEqual(ListingRules.stockMoveProblem(0, reason: "correction"), "stock.zeroChange")
        XCTAssertEqual(ListingRules.stockMoveProblem(-1, reason: "received"), "stock.wrongDirection")
        XCTAssertNil(ListingRules.stockMoveProblem(-2, reason: "correction"))

        XCTAssertTrue(rules.isValidMeasure(unit: "g", step: 250))
        XCTAssertFalse(rules.isValidMeasure(unit: "g", step: 0.5), "half a gram would put the float back in")
        XCTAssertFalse(rules.isValidMeasure(unit: "each", step: 2))
        let perKilo = rules.unitPrice(Money(fils: 600), unit: "g", step: 250)
        XCTAssertEqual(perKilo?.price, Money(fils: 2400))
        XCTAssertEqual(perKilo?.unit, "kg")
        XCTAssertNil(rules.unitPrice(Money(fils: 600), unit: "each", step: 1), "a counted product's unit price is just its price")
        // `measureOf`: grams under a kilo, kilos from one up, never a float in the label.
        XCTAssertEqual(rules.measureOf(unit: "g", step: 250, quantity: 3)?.value, 750)
        XCTAssertEqual(rules.measureOf(unit: "g", step: 250, quantity: 3)?.unit, "g")
        XCTAssertEqual(rules.measureOf(unit: "g", step: 250, quantity: 6)?.value, 1.5)
        XCTAssertEqual(rules.measureOf(unit: "g", step: 250, quantity: 6)?.unit, "kg")
        XCTAssertNil(rules.measureOf(unit: "each", step: 1, quantity: 4), "a count says itself")
        XCTAssertEqual(UnitWording.number(1.5), "1.5")
        XCTAssertEqual(UnitWording.number(800), "800")
        XCTAssertEqual(UnitWording.number(1.25), "1.25")

        XCTAssertEqual(rules.vehicle(forSizeClass: "large"), "van")
        XCTAssertEqual(memberPriceProblem(list: Money(fils: 10_000), member: "10.000"), "membership.priceNotBelow")
        XCTAssertEqual(memberPriceProblem(list: Money(fils: 10_000), member: "0"), "membership.priceZero")
        XCTAssertNil(memberPriceProblem(list: Money(fils: 10_000), member: ""))

        let good = SizeChart(axis: "Size", measures: ["chest"], rows: [.init(size: "S", ranges: ["chest": [86, 91]])])
        XCTAssertNil(rules.chartProblem(good))
        let backwards = SizeChart(axis: "Size", measures: ["chest"], rows: [.init(size: "S", ranges: ["chest": [91, 86]])])
        XCTAssertEqual(rules.chartProblem(backwards), "sizeGuide.badRange")
        XCTAssertEqual(PortalPage("/admin/products/12"), .product(12))
        XCTAssertEqual(PortalPage("/admin/products/new?vendor=3"), .newProduct(vendorId: 3))
    }

    func testAnEmptiedBoxIsSentAsNull() throws {
        let input = API.ProductSpeed(productId: 4, speed: OrNull(nil))
        XCTAssertEqual(try TRPCClient.encodeInput(input), #"{"json":{"productId":4,"speed":null}}"#)
        let untouched = API.VariantInput(productId: 4, title: "M", price: "1.000")
        XCTAssertFalse(try TRPCClient.encodeInput(untouched).contains("sku"), "a field not given is left alone")
    }

    func testTheWarehouseAndPlacementsDecode() async throws {
        let board = try await client.call(API.dispatchBoard, .init(state: "waiting"))
        XCTAssertFalse(board.parcels.isEmpty)
        XCTAssertEqual(board.parcels.first?.courierMoves, ["shipped"], "a parcel being prepared is collected next")
        XCTAssertNotNil(board.parcels.first?.collectFrom, "NetLet's shelf names the centre to collect from")
        let companies = try await client.call(API.deliveryCompanies)
        XCTAssertEqual(companies.map(\.name), ["Desert Express", "Fast Riders", "Gulf Couriers"], "the companies in the order the server lists them")
        _ = try await client.call(API.deliveryScores)
        _ = try await client.call(API.claimLedger)
        _ = try await client.call(API.damageClaims, .init(status: "open"))
        let open = try await client.call(API.fulfilmentOpen)
        XCTAssertTrue(open)
        let centres = try await client.call(API.centres)
        XCTAssertEqual(centres.first?.packFeePerUnit, "0.250")
        _ = try await client.call(API.sendable, .init(query: ""))
        let held = try await client.call(API.heldStock, .init(page: 1))
        XCTAssertEqual(held.rows.first?.centreName, "Shuwaikh centre")
        let shipments = try await client.call(API.shipments, .init(page: 1))
        XCTAssertNil(shipments.rows.first?.note, "a note that was never written is no note")
        _ = try await client.call(API.packingCharges, .init(page: 1))
        let picks = try await client.call(API.pickList)
        XCTAssertFalse(picks.orders.isEmpty)
        let ads = try await client.call(API.adBookings, .init(page: 1))
        XCTAssertEqual(ads.rows.first?.banner?.permit, "valid")
        let bundles = try await client.call(API.bundleRows)
        XCTAssertEqual(bundles.count, 0)
    }

    func testASpreadsheetIsReadOnThePhoneFirst() {
        let csv = "\u{FEFF}Name,Price,Qty,SKU,Description\r\n"
            + "Brass lamp,24.500,12,LAMP-01,\"A warm lamp, for a side table\"\r\n"
            + ",3.000,1,,\r\n"
            + "Kettle,free,1,,\r\n"
            + "Second lamp,20,2,lamp-01,\r\n"
            + "Basmati rice 5kg,4.750,,,\r\n"
        let plan = UploadPlan.plan(csv)
        XCTAssertEqual(plan.products.map(\.title), ["Brass lamp", "Basmati rice 5kg"])
        XCTAssertEqual(plan.products.first?.description, "A warm lamp, for a side table", "a quoted comma is part of the field")
        XCTAssertEqual(plan.problems.map(\.reason), ["bulk.noTitle", "bulk.badPrice", "bulk.duplicateSku"])
        XCTAssertEqual(plan.problems.map(\.line), [3, 4, 5])
        XCTAssertEqual(plan.products.last?.category, "Grocery", "rice is guessed into the grocery department")
        XCTAssertTrue(plan.products.last?.categoryGuessed == true)
        XCTAssertEqual(plan.products.last?.stock, 0, "an empty stock is none")
        XCTAssertEqual(UploadPlan.plan("title\nOnly a title").problems.first?.reason, "bulk.missingColumns")
        XCTAssertFalse(WarehouseRules.shared.upload.template.isEmpty)
    }

    func testWarehouseAndBannerRules() {
        let rules = WarehouseRules.shared
        XCTAssertEqual(rules.inboundProblem([]), "fulfilment.noLines")
        XCTAssertEqual(rules.inboundProblem([(variantId: 1, quantity: 0)]), "fulfilment.badQuantity")
        XCTAssertEqual(rules.inboundProblem([(variantId: 1, quantity: 2), (variantId: 1, quantity: 3)]), "fulfilment.duplicateLine")
        XCTAssertNil(rules.inboundProblem([(variantId: 1, quantity: 2)]))
        XCTAssertEqual(rules.headlineProblem("  ", required: true), "ads.bannerNeedsHeadline")
        XCTAssertNil(rules.headlineProblem("", required: false))
        XCTAssertEqual(rules.headlineProblem("Call 99887766 today", required: true), "ads.bannerContact", "a phone number on the front page is refused")
        XCTAssertEqual(AdWords.approvalStart("2026-10-01", today: "2026-10-05"), "2026-10-05")
        XCTAssertEqual(AdWords.addDays("2026-10-30", 3), "2026-11-02")
        XCTAssertEqual(PortalPage("/admin/import"), .importProducts)
        XCTAssertEqual(PortalPage("/admin/fulfilment"), .fulfilment)
    }

    func testALineMovesOnlyWhereTheServerWouldTakeIt() {
        let rules = PortalRules.shared
        XCTAssertEqual(rules.nextStates("returned"), [], "a returned line is over")
        XCTAssertEqual(rules.nextStates("cancelled"), ["pending"], "a cancelled line can only be restored")
        XCTAssertFalse(rules.nextStates("pending").contains("returned"), "returning is the return's, never a button")
        XCTAssertEqual(PortalPage("/admin/support/3"), .supportThread(3))
        XCTAssertEqual(PortalPage("/admin/payouts"), .payouts)
    }

    func testThePortalOffersWhatThePersonMayUse() {
        let rules = PortalRules.shared
        let owner = SellerIdentity(kind: "vendor", userId: 5, vendorId: 2, role: "owner")
        let staff = SellerIdentity(kind: "vendor", userId: 6, vendorId: 2, role: "staff")
        let admin = SellerIdentity(kind: "admin", userId: 1, vendorId: nil, role: nil)
        let courier = SellerIdentity(kind: "courier", userId: 7, vendorId: nil, role: nil, courierId: 1)
        XCTAssertTrue(rules.can(owner, "product.edit", vendorId: 2))
        XCTAssertFalse(rules.can(owner, "product.edit", vendorId: 3), "a store's people reach their own store and nothing else")
        XCTAssertFalse(rules.can(owner, "vendor.setCommission", vendorId: 2), "commission is outside a vendor's control at any rank")
        XCTAssertTrue(rules.can(staff, "stock.adjust", vendorId: 2))
        XCTAssertFalse(rules.can(staff, "product.publish", vendorId: 2), "staff move stock and publish nothing")
        XCTAssertTrue(rules.can(admin, "platform.manageUsers"))
        XCTAssertTrue(rules.can(courier, "delivery.view"))
        XCTAssertFalse(rules.can(courier, "product.view"))
        XCTAssertTrue(rules.menu(for: owner).flatMap(\.links).contains { $0.href == "/admin/products" })
        XCTAssertFalse(rules.menu(for: courier).flatMap(\.links).contains { $0.href == "/admin/products" })
        XCTAssertTrue(rules.menu(for: admin).flatMap(\.links).allSatisfy { PortalPage.draws($0.href) }, "the menu offers only pages the app draws")
        XCTAssertEqual(PortalPage("/admin/products?vendor=4"), .products(vendorId: 4))
        XCTAssertEqual(PortalPage("/admin/products/new"), .newProduct(vendorId: nil))
        XCTAssertNil(PortalPage("/account"))
        XCTAssertEqual(Route.from(link: "/admin/products?vendor=4"), .portal("/admin/products?vendor=4"))
    }

    func testTheShopperVariantIsSignedInAndFallsBackElsewhere() async throws {
        let shopper = TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: "shopper"))
        let user = try await shopper.call(API.me)
        XCTAssertEqual(user?.firstName, "Noura")
        let products = try await shopper.call(API.products, .init(first: 24))
        XCTAssertFalse(products.isEmpty, "a procedure with no variant answers from the shared recording")
    }

    func testNetLetsOwnDesksDecode() async throws {
        let overview = try await client.call(API.subscriptionOverview)
        XCTAssertFalse(overview.scheduled)
        let trail = try await client.call(API.auditTrail, .init(limit: 100))
        XCTAssertFalse(trail.isEmpty)
        XCTAssertEqual(trail.first { $0.action == "guide.delete" }?.change?.field, "status", "a deleted guide says what it was")
        let changes = try await client.call(API.sellerChanges, .init(limit: 100))
        XCTAssertEqual(changes.rows.first?.actorRole, "owner")
        let switches = try await client.call(API.featureSwitches)
        XCTAssertTrue(switches.contains { $0.key == "ai" })
        XCTAssertTrue(switches.allSatisfy { Phrasebook.shared.has(FeatureWords.name($0.key)) && Phrasebook.shared.has(FeatureWords.whenOff($0.key)) },
                      "every switch the server lists has its words")
        XCTAssertNotNil(switches.first { $0.why != nil }?.why?.reason)
        let people = try await client.call(API.people, .init())
        XCTAssertEqual(people.total, people.rows.count)
        XCTAssertTrue(people.rows.contains { $0.role == "admin" })
        XCTAssertTrue(people.rows.contains { !$0.vendors.isEmpty })
        let applications = try await client.call(API.pendingApplications, .init(status: "submitted"))
        let application = try XCTUnwrap(applications.rows.first)
        XCTAssertEqual(application.missing(currentAgreement: application.agreementVersion ?? ""), [], "a complete application lacks nothing")
        let papers = try await client.call(API.reviewerDocuments, .init(applicationId: application.id))
        XCTAssertFalse(papers.isEmpty)
        let flags = try await client.call(API.reviewFlags, .init(ids: [1, 2, 3, 4, 5]))
        XCTAssertTrue(flags.contains { !$0.flags.isEmpty })
        XCTAssertTrue(flags.flatMap(\.flags).allSatisfy { Phrasebook.shared.has($0.label) })
        _ = try await client.call(API.modelReviewAvailable)
        let admin = TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: "admin"))
        let identity = try await admin.call(API.sellerIdentity)
        XCTAssertEqual(identity.kind, "admin")
        XCTAssertTrue(identity.can("platform.manageUsers"))
    }

    func testTheDesksRulesAreTheWebs() throws {
        let data = Data(#"{"id":1,"action":"product.setStatus","before":{"status":"published","price":"12.500"},"after":{"status":"draft","price":"12.500"},"createdAt":"2026-10-11T20:37:36.630Z"}"#.utf8)
        let decoder = TRPCClient.makeDecoder()
        let entry = try decoder.decode(AuditEntry.self, from: data)
        XCTAssertEqual(entry.change?.from, "published")
        XCTAssertEqual(entry.change?.to, "draft")
        XCTAssertFalse(entry.automatic)
        let odd = try decoder.decode(AuditEntry.self, from: Data(#"{"id":2,"action":"x","before":[1,2],"after":{"automatic":true,"commissionPercent":10},"createdAt":"2026-10-11T20:37:36Z"}"#.utf8))
        XCTAssertNil(odd.before, "an act that wrote a list is simply not summarised")
        XCTAssertEqual(odd.change?.to, "10")
        XCTAssertTrue(odd.automatic)
        XCTAssertEqual(FeatureWords.group("tryOn"), "shopping")
        XCTAssertEqual(FeatureWords.group("articles"), "content")
        XCTAssertNil(PendingApplication.webAddress("javascript:alert(1)"))
        XCTAssertNotNil(PendingApplication.webAddress("https://example.com/licence.pdf"))
    }

    func testTheStoresDecode() async throws {
        let list = try await client.call(API.storeList, .init())
        XCTAssertFalse(list.rows.isEmpty)
        XCTAssertEqual(list.counts["all"], list.total)
        XCTAssertTrue(list.rows.contains { $0.productCount > 0 && $0.liveCount <= $0.productCount })
        let names = try await client.call(API.vendorRows, .init(pageSize: 200))
        XCTAssertEqual(names.rows.count, list.rows.count, "the store picker reads the same recording")
        let store = try await client.call(API.storeDetail, .init(vendorId: 2))
        XCTAssertEqual(store.slug, "acme")
        XCTAssertGreaterThanOrEqual(store.stats.products, store.stats.live)
        XCTAssertNotNil(store.discountLicenceExpiresAt)
        XCTAssertEqual(store.missing, ["admin.addressLine"], "a store with no street is told so")
        XCTAssertNotNil(PortalRules.shared.badges, "the badge floors come from the shop")
    }

    func testTheStoresRulesAreTheWebs() {
        XCTAssertEqual(StoreRules.slug("Fahad's Lighting & Co."), "fahad-s-lighting-and-co")
        XCTAssertEqual(StoreRules.slug("متجر"), "", "a name with nothing to spell an address with gives none")
        XCTAssertTrue(StoreRules.isValidIban("KW81 CBKU 0000 0000 0000 1234 5601 01"))
        XCTAssertFalse(StoreRules.isValidIban("KW81CBKU0000000000001234560110"), "a transposed pair is caught")
        XCTAssertTrue(StoreRules.isValidIban("KW09 NB0K 0000 0000 0000 1234 5678 90"), "a 0 in the bank code is its O")
        XCTAssertEqual(StoreRules.normaliseIban("kw57 kfh0 0000 0000 0000 9876 5432 10"), "KW57KFHO0000000000009876543210")
        XCTAssertEqual(StoreRules.normaliseIban("DE89 3704 0044 0532 0130 00"), "DE89370400440532013000", "only a Kuwaiti bank code is read")
        XCTAssertEqual(StoreRules.ibanReadAs("KW09NB0K0000000000001234567890"), "KW09NBOK0000000000001234567890")
        XCTAssertNil(StoreRules.ibanReadAs("kw09 nbok 0000 0000 0000 1234 5678 90"), "spaces and case are not a change")
        XCTAssertTrue(StoreRules.isValidKuwaitPhone("+965 5000 1111"))
        XCTAssertFalse(StoreRules.isValidKuwaitPhone("5000111"))
        let now = Date()
        XCTAssertEqual(StoreRules.permit(number: " ", expiresAt: nil, now: now), .missing)
        XCTAssertEqual(StoreRules.permit(number: "MOCI-1", expiresAt: nil, now: now), .noExpiry)
        XCTAssertEqual(StoreRules.permit(number: "MOCI-1", expiresAt: now.addingTimeInterval(-60), now: now), .expired(now.addingTimeInterval(-60)))
        XCTAssertEqual(StoreRules.kuwaitDay(Date(timeIntervalSince1970: 1_791_493_260)), "2026-10-09", "21:00 UTC is already the next day in Kuwait")
    }

    func testTheMoneyDesksDecode() async throws {
        let report = try await client.call(API.financeReport)
        let totals = report.totals
        XCTAssertEqual(totals.commission.fils + totals.vendorNet.fils, totals.net.fils, "commission and what the sellers are owed add up to the net")
        XCTAssertEqual(totals.gross.fils - totals.refunded.fils, totals.net.fils, "sales less refunds is the net")
        XCTAssertEqual(totals.takeRate, "11.9")
        XCTAssertFalse(report.vendors.isEmpty)
        XCTAssertFalse(report.months.isEmpty)
        let weekly = try await client.call(API.weeklyPayouts)
        let seller = try XCTUnwrap(weekly.vendors.first)
        XCTAssertEqual(seller.weeks.reduce(0) { $0 + $1.owed.fils }, seller.owed.fils, "a seller's weeks add up to what they are owed")
        let cashOuts = try await client.call(API.pendingCashOuts)
        XCTAssertEqual(cashOuts.first?.value, Money(fils: 120))
        let invoices = try await client.call(API.invoiceList, .init())
        XCTAssertTrue(invoices.rows.contains { $0.kind == "credit_note" })
        let vouchers = try await client.call(API.vouchers)
        XCTAssertEqual(vouchers.codes.first?.code, "WELCOME10")
        XCTAssertEqual(vouchers.cards.count, 2)
        let affiliates = try await client.call(API.affiliateList, .init())
        XCTAssertFalse(affiliates.rows.isEmpty)
        XCTAssertTrue(affiliates.rows.contains { $0.points > 0 }, "a member's links earned points")
        let grants = try await client.call(API.membershipList, .init(current: false))
        XCTAssertEqual(grants.rows.first?.state(), "ended", "a cancelled grant reads as ended whatever its dates")
        let terms = try await client.call(API.membershipTerms)
        XCTAssertNil(terms.freeDeliveryOver)
        _ = try await client.call(API.membershipReport)
        XCTAssertEqual(PortalRules.shared.money?.voucherKinds, ["percent", "fixed"])
    }

    func testTheHelpDeskGuidesAndCouriersDecode() async throws {
        let inbox = try await client.call(API.staffInbox, .init())
        XCTAssertEqual(inbox.rows.first?.status, "open", "the conversations waiting on NetLet come first")
        let thread = try await client.call(API.staffThread, .init(id: 5))
        XCTAssertEqual(Set(thread.messages.map(\.author)), ["shopper", "automatic", "staff"])
        XCTAssertNotNil(thread.messages.first { $0.author == "automatic" }?.answer, "the automatic answer is message keys")
        let guides = try await client.call(API.guideList, .init())
        XCTAssertEqual(guides.total, guides.rows.count)
        let guide = try await client.call(API.guideGet, .init(id: 1))
        XCTAssertEqual(guide.status, "published")
        XCTAssertEqual(GuideRules.problems(guide.content), [], "a published guide passes the rules it was published under")
        let couriers = try await client.call(API.deliveryCompanies)
        XCTAssertTrue(couriers.contains { $0.status == "suspended" })
        let members = try await client.call(API.courierMembers, .init(courierId: 1))
        XCTAssertEqual(members.first?.email, "rider@courier.test")
    }

    func testTheGuideAndReplyRulesAreTheWebs() throws {
        var guide = GuideContent.empty
        XCTAssertEqual(GuideRules.problems(guide), ["guides.needTitle", "guides.stepIncomplete"])
        guide.title = "Paying"
        guide.titleAr = "الدفع"
        guide.steps = [.init(title: "Order", titleAr: "اطلب", body: "Place it.", bodyAr: "ضعه.", imageUrl: "/media/LbtfvtL9lnOShrXz_N_cCXYF.webp")]
        XCTAssertEqual(GuideRules.problems(guide), [])
        guide.steps[0].imageUrl = "https://elsewhere.example/a.jpg"
        XCTAssertEqual(GuideRules.problems(guide), ["guides.badPicture"], "a guide's pictures are NetLet's own uploads only")
        guide.steps[0].imageUrl = nil
        guide.summary = "Call 99887766 to pay"
        XCTAssertEqual(GuideRules.problems(guide), ["guides.contactDetails"], "a guide is NetLet talking, under the contact filter")
        guide.steps = []
        XCTAssertTrue(GuideRules.problems(guide).contains("guides.needSteps"))
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(API.GuideSave(id: OrNull(nil), guide: .empty))) as? [String: Any]
        XCTAssertTrue(body?["id"] is NSNull, "a new guide is saved with a null id")
        let step = ((body?["guide"] as? [String: Any])?["steps"] as? [[String: Any]])?.first
        XCTAssertTrue(step?["imageUrl"] is NSNull, "a step without a picture says so rather than leaving the key out")
        XCTAssertEqual(SupportRules.problem("   ", limit: 10), "support.empty")
        XCTAssertEqual(SupportRules.problem(String(repeating: "a", count: 11), limit: 10), "support.tooLong")
        XCTAssertNil(SupportRules.problem("On its way", limit: 10))
    }

    func testEveryPageOfThePortalIsDrawnInTheApp() {
        let links = PortalRules.shared.menu.flatMap(\.links)
        XCTAssertFalse(links.isEmpty)
        XCTAssertEqual(links.filter { !PortalPage.draws($0.href) }.map(\.href), [], "no page of the web's portal opens a browser")
        XCTAssertEqual(PortalPage("/admin/support/5"), .supportThread(5))
        XCTAssertEqual(PortalPage("/admin/guides/new"), .guide(nil))
        XCTAssertEqual(PortalPage("/admin/guides/2"), .guide(2))
        XCTAssertEqual(PortalPage("/admin/couriers"), .couriers)
    }

    /// "Your profile"'s details, as the server answered the demo shopper.
    func testTheProfilesDetailsDecode() async throws {
        let shopper = TRPCClient(configuration: client.configuration, transport: DemoTransport(variant: "shopper"))
        let details = try await shopper.call(API.profileDetails)
        XCTAssertEqual(details.firstName, "Noura")
        XCTAssertEqual(details.phone, "+96555001122")
        XCTAssertEqual(details.nationality, "KW")
        XCTAssertTrue(ReferenceData.shared.rules.profileRules.countries.contains(details.nationality ?? ""))
        let saved = try await shopper.call(API.saveProfileDetails, .init(nationality: OrNull("KW")))
        XCTAssertEqual(saved.gender, "female")
        let named = try await shopper.call(API.updateNameParts, .init(firstName: "Noura", lastName: "Al-Sabah"))
        XCTAssertEqual(named.name, "Noura Al-Sabah")
        XCTAssertEqual(try TRPCClient.encodeInput(API.DetailsPatch()), #"{"json":{}}"#, "nothing set, nothing sent")
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

/// The app's one image pipeline: what made 23 of 24 live photos never appear
/// under `AsyncImage`, each answered here.
final class ImagePipelineTests: XCTestCase {
    let photo = URL(string: "https://photos.example/serum.jpg")!

    /// A photo of a given size, as a seller's server would send it.
    func jpeg(width: Int, height: Int) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let image = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format).image { context in
            UIColor.orange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        return image.jpegData(compressionQuality: 0.8)!
    }

    func answer(_ data: Data, status: Int = 200) -> (Data, URLResponse) {
        (data, HTTPURLResponse(url: photo, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "image/jpeg"])!)
    }

    func testAPictureIsDecodedAtTheSizeItIsDrawnAt() throws {
        let decoded = try XCTUnwrap(ImagePipeline.decode(jpeg(width: 2400, height: 1800), pixels: 512))
        XCTAssertEqual(max(decoded.size.width * decoded.scale, decoded.size.height * decoded.scale), 512, accuracy: 1)
        XCTAssertNil(ImagePipeline.decode(Data("<svg/>".utf8), pixels: 512))
    }

    func testTheSizeRoundsUpToAFewSteps() {
        XCTAssertEqual(ImagePipeline.pixels(for: CGSize(width: 48, height: 48), scale: 3), 256)
        XCTAssertEqual(ImagePipeline.pixels(for: CGSize(width: 173, height: 216), scale: 3), 1024)
        XCTAssertEqual(ImagePipeline.pixels(for: CGSize(width: 390, height: 390), scale: 3), 1536)
        XCTAssertEqual(ImagePipeline.pixels(for: CGSize(width: 2000, height: 2000), scale: 3), 3072)
    }

    /// A slow seller's server drops a connection: tried again, not given up on.
    func testADroppedConnectionIsTriedAgain() async {
        let calls = CallCounter()
        let data = jpeg(width: 800, height: 800)
        let pipeline = ImagePipeline(fetch: { _ in
            if await calls.next() < 3 { throw URLError(.networkConnectionLost) }
            return self.answer(data)
        }, disk: nil, pauses: [.milliseconds(1), .milliseconds(1)])
        let image = await pipeline.image(photo, pixels: 256)
        XCTAssertNotNil(image)
        let count = await calls.value
        XCTAssertEqual(count, 3)
    }

    /// A box that scrolls off and back, or two boxes showing one photo: one fetch.
    func testEveryoneAskingForOnePictureSharesOneFetch() async {
        let calls = CallCounter()
        let data = jpeg(width: 600, height: 600)
        let pipeline = ImagePipeline(fetch: { _ in
            _ = await calls.next()
            try await Task.sleep(for: .milliseconds(50))
            return self.answer(data)
        }, disk: nil)
        async let first = pipeline.image(photo, pixels: 256)
        async let second = pipeline.image(photo, pixels: 256)
        let (a, b) = await (first, second)
        XCTAssertNotNil(a)
        XCTAssertNotNil(b)
        XCTAssertNotNil(pipeline.cached(photo, pixels: 256), "kept for the next frame that asks")
        let count = await calls.value
        XCTAssertEqual(count, 1)
    }

    /// A view that stops waiting does not stop the fetch: the picture is kept
    /// for when the box comes back.
    func testAViewGoingAwayDoesNotStopThePicture() async throws {
        let data = jpeg(width: 600, height: 600)
        let pipeline = ImagePipeline(fetch: { _ in
            try await Task.sleep(for: .milliseconds(80))
            return self.answer(data)
        }, disk: nil)
        let waiting = Task { await pipeline.image(photo, pixels: 256) }
        try await Task.sleep(for: .milliseconds(10))
        waiting.cancel()
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertNotNil(pipeline.cached(photo, pixels: 256))
    }

    func testAMissingPictureIsNotAskedForAgainAndAgain() async {
        let calls = CallCounter()
        let pipeline = ImagePipeline(fetch: { _ in
            _ = await calls.next()
            return self.answer(Data("gone".utf8), status: 404)
        }, disk: nil, pauses: [.milliseconds(1)])
        let first = await pipeline.image(photo, pixels: 256)
        let second = await pipeline.image(photo, pixels: 256)
        XCTAssertNil(first)
        XCTAssertNil(second)
        let count = await calls.value
        XCTAssertEqual(count, 1, "a 404 is final, and asked again only after a while")
    }

    /// The bytes outlive the app: a second launch draws from the disk.
    func testTheBytesAreKeptOnDisk() async {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("images-\(UUID().uuidString)")
        let disk = URLCache(memoryCapacity: 4 * 1024 * 1024, diskCapacity: 16 * 1024 * 1024, directory: folder)
        let data = jpeg(width: 400, height: 400)
        let first = ImagePipeline(fetch: { _ in self.answer(data) }, disk: disk)
        _ = await first.image(photo, pixels: 256)
        let offline = ImagePipeline(fetch: { _ in throw URLError(.notConnectedToInternet) }, disk: disk, pauses: [])
        let again = await offline.image(photo, pixels: 512)
        XCTAssertNotNil(again)
    }
}

/// A count several tasks can add to.
actor CallCounter {
    private(set) var value = 0
    func next() -> Int {
        value += 1
        return value
    }
}

/// Today's public shelves, kept on the phone so the home page opens on them.
final class ShelfMemoryTests: XCTestCase {
    let configuration = APIConfiguration(baseURL: URL(string: "https://shop.example")!)
    let catalogue = #"{"result":{"data":{"json":{"recorded":true}}}}"#

    func memory(at date: Date) -> ShelfMemory {
        ShelfMemory(folder: FileManager.default.temporaryDirectory.appendingPathComponent("shelves-\(UUID().uuidString)"), now: { date })
    }

    func request(_ path: String, method: String = "GET") -> URLRequest {
        var request = URLRequest(url: URL(string: "https://shop.example/api/trpc/\(path)?input=%7B%7D")!)
        request.httpMethod = method
        return request
    }

    /// Kuwait is UTC+3: nine in the evening UTC is already tomorrow there.
    func testTheDayIsKuwaits() {
        let evening = ISO8601DateFormatter().date(from: "2026-10-27T21:00:00Z")!
        XCTAssertEqual(ShelfMemory.kuwaitDay(evening), "2026-10-28")
        XCTAssertEqual(ShelfMemory.kuwaitDay(evening.addingTimeInterval(-1)), "2026-10-27")
    }

    /// A saving is permitted for a day; a remembered one never outlives it.
    func testAnAnswerIsKeptForTheDayItWasReadOn() {
        let morning = ISO8601DateFormatter().date(from: "2026-10-27T06:00:00Z")!
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("shelves-\(UUID().uuidString)")
        ShelfMemory(folder: folder, now: { morning }).remember(Data(catalogue.utf8), for: request("commerce.products.list"))
        XCTAssertNotNil(ShelfMemory(folder: folder, now: { morning.addingTimeInterval(8 * 3600) }).recall(request("commerce.products.list")))
        XCTAssertNil(ShelfMemory(folder: folder, now: { morning.addingTimeInterval(20 * 3600) }).recall(request("commerce.products.list")))
    }

    /// Nothing about the shopper is kept: the bag, the account, a search, a write.
    func testOnlyThePublicShelvesAreKept() {
        let memory = memory(at: Date())
        for path in ["commerce.cart.get", "auth.me", "search.products", "orders.list"] {
            memory.remember(Data(catalogue.utf8), for: request(path))
            XCTAssertNil(memory.recall(request(path)), path)
        }
        memory.remember(Data(catalogue.utf8), for: request("commerce.products.list", method: "POST"))
        XCTAssertNil(memory.recall(request("commerce.products.list", method: "POST")))
    }

    /// Through the client: an answer read today comes back without a round trip.
    func testTheClientRemembersTheCatalogue() async throws {
        let body = #"{"result":{"data":{"json":{"beauty":27,"electronics":2}}}}"#
        let transport = StubTransport { _ in (200, body) }
        let client = TRPCClient(configuration: configuration, transport: transport, memory: memory(at: Date()))
        XCTAssertNil(client.remembered(API.departmentCounts))
        _ = try await client.call(API.departmentCounts)
        XCTAssertEqual(client.remembered(API.departmentCounts), ["beauty": 27, "electronics": 2])
    }

    /// A refusal is never drawn tomorrow morning as if it were the shelf.
    func testARefusalIsNotKept() async {
        let transport = StubTransport { _ in (500, #"{"error":{"json":{"message":"error.serverProblem","code":-32603,"data":{"code":"INTERNAL_SERVER_ERROR","httpStatus":500}}}}"#) }
        let client = TRPCClient(configuration: configuration, transport: transport, memory: memory(at: Date()), retryPause: .zero)
        _ = try? await client.call(API.departmentCounts)
        XCTAssertNil(client.remembered(API.departmentCounts))
    }
}

/// A catalogue that remembers this morning's shelf and cannot reach the server now.
final class RememberingCatalog: CatalogServicing, @unchecked Sendable {
    let kept: [Product]
    init(kept: [Product]) { self.kept = kept }

    func products(first: Int, department: String?, language: Language) async throws -> [Product] { throw URLError(.notConnectedToInternet) }
    func product(handle: String, language: Language) async throws -> Product? { nil }
    func departmentCounts() async throws -> [String: Int] { throw URLError(.notConnectedToInternet) }
    func bestsellers(language: Language) async throws -> [Product] { throw URLError(.notConnectedToInternet) }
    func stores(language: Language) async throws -> [StoreCard] { throw URLError(.notConnectedToInternet) }
    func store(slug: String, language: Language) async throws -> StorePage? { nil }
    func brands() async throws -> [BrandCount] { throw URLError(.notConnectedToInternet) }
    func contact() async throws -> ShopContact { ShopContact.fallback }
    func search(_ query: String, department: String?, limit: Int, language: Language) async throws -> SearchResult {
        SearchResult(products: [], total: 0, correctedTo: nil)
    }
    func rememberedProducts(first: Int, department: String?, language: Language) -> [Product]? { kept }
}

final class HomeShelfMemoryTests: XCTestCase {
    /// Offline at launch, the home page is this morning's shelf rather than "slow".
    @MainActor
    func testTheHomePageOpensOnTodaysShelfWhenTheServerIsSlow() async throws {
        let products = try await Fixtures.products()
        var warmed: [Product] = []
        let shelf = HomeShelf(catalog: RememberingCatalog(kept: products), warm: { warmed += $0 })
        await shelf.load(language: .en)
        XCTAssertEqual(shelf.catalogue.value?.count, products.count)
        XCTAssertFalse(warmed.isEmpty, "the remembered shelf's photos are fetched ahead too")
        XCTAssertTrue(shelf.showingEarlier, "the page says the shelf is this morning's")
    }
}
