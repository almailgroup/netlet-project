import XCTest
@testable import NetLet

/// Money is held in whole fils, so a total equals its parts to the fil.
final class MoneyTests: XCTestCase {
    func testReadsTheDecimalStringsTheServerSends() {
        XCTAssertEqual(Money(amount: "24.375")?.fils, 24_375)
        XCTAssertEqual(Money(amount: "72")?.fils, 72_000)
        XCTAssertEqual(Money(amount: "0.5")?.fils, 500)
        XCTAssertEqual(Money(amount: "-3.250")?.fils, -3_250)
        XCTAssertNil(Money(amount: "12.3456"))
        XCTAssertNil(Money(amount: "1e3"))
        XCTAssertNil(Money(amount: ""))
    }

    func testWritesThreeDecimalsBack() {
        XCTAssertEqual(Money(fils: 24_375).amount, "24.375")
        XCTAssertEqual(Money(fils: 5).amount, "0.005")
        XCTAssertEqual(Money(fils: -1_500).amount, "-1.500")
    }

    func testAddsInFilsWithoutDrift() {
        let tenth = Money(fils: 100)
        XCTAssertEqual((tenth + Money(fils: 200)).fils, 300)
        XCTAssertEqual((Money(fils: 1_250) * 3).fils, 3_750)
        XCTAssertTrue(Money(fils: 1) > .zero)
    }

    func testDrawsAWholeAmountCleanAndAFractionWithThreeDecimals() {
        let whole = Money(fils: 129_000).formatted(.en)
        XCTAssertTrue(whole.contains("129"))
        XCTAssertFalse(whole.contains("129.000"))
        XCTAssertTrue(Money(fils: 24_375).formatted(.en).contains("24.375"))
        // Latin digits on the Arabic page too, as the web writes prices.
        XCTAssertTrue(Money(fils: 24_375).formatted(.ar).contains("24"))
    }

    func testDecodesBothShapesTheAPIUses() throws {
        let decoder = JSONDecoder()
        let object = try decoder.decode(Money.self, from: Data(#"{"amount":"4.750","currencyCode":"KWD"}"#.utf8))
        XCTAssertEqual(object.fils, 4_750)
        let bare = try decoder.decode(Money.self, from: Data(#""72.000""#.utf8))
        XCTAssertEqual(bare.fils, 72_000)
    }
}

/// The dictionary the web uses, read by the app.
final class PhrasebookTests: XCTestCase {
    let book = Phrasebook.shared

    func testHasBothLanguagesFromTheBundle() {
        XCTAssertEqual(book.text("cart.title", language: .en), "Your cart")
        XCTAssertNotEqual(book.text("cart.title", language: .ar), "Your cart")
        XCTAssertTrue(book.has("ios.order.view"))
    }

    func testFillsPlaceholders() {
        XCTAssertEqual(book.text("cart.added", language: .en, params: ["name": "Lamp"]), "Lamp added to your cart")
        XCTAssertEqual(book.text("cart.added", language: .en), "{name} added to your cart")
    }

    func testFallsBackToTheKeyRatherThanNothing() {
        XCTAssertEqual(book.text("no.such.key", language: .ar), "no.such.key")
    }

    /// The forms `Intl.PluralRules` answers, which `plurals.ts` is written against.
    func testArabicCountsTakeTheFormTheirNumberNeeds() {
        XCTAssertEqual(Phrasebook.pluralCategory(0, language: .ar), "zero")
        XCTAssertEqual(Phrasebook.pluralCategory(2, language: .ar), "two")
        XCTAssertEqual(Phrasebook.pluralCategory(3, language: .ar), "few")
        XCTAssertEqual(Phrasebook.pluralCategory(11, language: .ar), "many")
        XCTAssertEqual(Phrasebook.pluralCategory(100, language: .ar), "other")
        XCTAssertEqual(Phrasebook.pluralCategory(103, language: .ar), "few")
        XCTAssertEqual(book.text("browse.countMany", language: .ar, params: ["count": "2"]), "منتجان")
        XCTAssertEqual(book.text("browse.countMany", language: .ar, params: ["count": "3"]), "3 منتجات")
        XCTAssertEqual(book.text("browse.countMany", language: .ar, params: ["count": "11"]), "11 منتجاً")
        XCTAssertEqual(book.text("browse.countMany", language: .en, params: ["count": "3"]), "3 products")
    }
}

/// The rules exported from `Shared/`.
final class ReferenceDataTests: XCTestCase {
    let reference = ReferenceData.shared

    func testHasTheDepartmentsInTheirOrder() {
        XCTAssertEqual(reference.departments.first?.slug, "electronics")
        XCTAssertEqual(reference.departments.count, 5)
        XCTAssertEqual(reference.department(named: "electronics")?.slug, "electronics")
    }

    func testKnowsEveryGovernorateAndItsAreas() {
        XCTAssertEqual(reference.governorates.count, 6)
        XCTAssertEqual(reference.governorate(ofArea: "Salmiya"), "hawalli")
        XCTAssertEqual(reference.requiredParts, ["area", "block", "street", "building"])
    }

    func testCarriesTheServersLimits() {
        XCTAssertEqual(reference.rules.sessionCookie, "app_session_id")
        XCTAssertEqual(reference.rules.listing.warrantyRequiredDepartments, ["electronics"])
        XCTAssertGreaterThan(reference.rules.media.maxUploadBytes, 0)
    }
}

final class ValidationTests: XCTestCase {
    func testEmail() {
        XCTAssertEqual(Validation.emailProblem(""), "auth.emailRequired")
        XCTAssertEqual(Validation.emailProblem("noura@"), "auth.emailInvalid")
        XCTAssertEqual(Validation.emailProblem("noura@shop"), "auth.emailInvalid")
        XCTAssertNil(Validation.emailProblem(" noura@shop.test "))
    }

    func testANewPasswordNeedsTenCharacters() {
        XCTAssertEqual(Validation.newPasswordProblem("short"), "auth.ruleLength")
        XCTAssertNil(Validation.newPasswordProblem("long enough phrase"))
    }

    func testFoldsArabicIndicDigitsInACode() {
        XCTAssertEqual(Validation.normaliseCode("١٢٣ ٤٥٦"), "123456")
    }

    func testReadsAKuwaitiNumberTheWayPeopleTypeOne() {
        XCTAssertEqual(PhoneNumber.normalise("5000 0000"), "+96550000000")
        XCTAssertEqual(PhoneNumber.normalise("+965 5000 0000"), "+96550000000")
        XCTAssertEqual(PhoneNumber.normalise("00965 50000000"), "+96550000000")
        XCTAssertEqual(PhoneNumber.normalise("٥٠٠٠٠٠٠٠"), "+96550000000")
        XCTAssertNil(PhoneNumber.normalise("1234"))
    }

    func testAListingAsksForWhatTheServerRefuses() {
        let rules = ReferenceData.shared.rules.listing
        var draft = Validation.ListingDraft()
        var problems = Validation.listingProblems(draft, departmentSlug: "electronics", rules: rules)
        XCTAssertEqual(problems[.title], "admin.newTitleRequired")
        XCTAssertEqual(problems[.titleAr], "admin.newTitleArRequired")
        XCTAssertEqual(problems[.price], "admin.newPriceRequired")
        XCTAssertEqual(problems[.warranty], "admin.newWarrantyRequired")

        draft = Validation.ListingDraft(title: "Lamp", titleAr: "مصباح", price: "0", stock: "x", description: "", warranty: "")
        problems = Validation.listingProblems(draft, departmentSlug: "home-and-kitchen", rules: rules)
        XCTAssertEqual(problems[.price], "admin.newPricePositive")
        XCTAssertEqual(problems[.stock], "admin.newStockShape")
        XCTAssertNil(problems[.warranty])

        draft.price = "12.5005"
        XCTAssertEqual(Validation.listingProblems(draft, departmentSlug: nil, rules: rules)[.price], "admin.newPriceShape")
        draft.price = "12.500"
        draft.stock = "4"
        XCTAssertTrue(Validation.listingProblems(draft, departmentSlug: nil, rules: rules).isEmpty)

        draft.compareAtPrice = "12.500"
        XCTAssertEqual(Validation.listingProblems(draft, departmentSlug: nil, rules: rules)[.compareAtPrice], "admin.newWasHigher",
                       "a was-price no higher than the price is not a saving")
        draft.compareAtPrice = "15"
        XCTAssertNil(Validation.listingProblems(draft, departmentSlug: nil, rules: rules)[.compareAtPrice])
        draft.sku = String(repeating: "A", count: rules.maxSku + 1)
        XCTAssertEqual(Validation.listingProblems(draft, departmentSlug: nil, rules: rules)[.sku], "admin.newTooLong")
        XCTAssertEqual(Validation.ListingField.allCases.first, .title, "a refusal is pointed at the form's first box first")
        XCTAssertEqual(SearchPreview.handle("Brass Lamp — 40cm!"), "brass-lamp-40cm", "the address a draft's name makes")
        XCTAssertEqual(SearchPreview.text("- Warm light\n- Brass", limit: 160), "Warm light · Brass")
    }

    func testDeliverySaysTheFirstThingMissing() {
        let required = ReferenceData.shared.requiredParts
        var parts = AddressParts()
        XCTAssertEqual(Validation.deliveryProblem(governorate: nil, parts: parts, phone: "", requiredParts: required), "checkout.needGovernorate")
        XCTAssertEqual(Validation.deliveryProblem(governorate: "hawalli", parts: parts, phone: "", requiredParts: required), "checkout.needAddress")
        parts = AddressParts(area: "Salmiya", block: "4", street: "12", building: "15", paciNumber: "123")
        XCTAssertEqual(Validation.deliveryProblem(governorate: "hawalli", parts: parts, phone: "", requiredParts: required), "address.badPaci")
        parts.paciNumber = "١٢٣٤٥٦٧٨"
        XCTAssertEqual(Validation.deliveryProblem(governorate: "hawalli", parts: parts, phone: "", requiredParts: required), "checkout.needPhone")
        XCTAssertEqual(Validation.deliveryProblem(governorate: "hawalli", parts: parts, phone: "123", requiredParts: required), "checkout.badPhone")
        XCTAssertNil(Validation.deliveryProblem(governorate: "hawalli", parts: parts, phone: "50000000", requiredParts: required))
    }
}

final class DescriptionAndSortTests: XCTestCase {
    func testReadsListsAndParagraphsTheWayTheWebDoes() {
        let blocks = DescriptionBlock.parse("A lamp.\nWarm light.\n\n- Brass\n• Dimmable\n\nFor the bedside.")
        XCTAssertEqual(blocks, [.paragraph("A lamp. Warm light."), .list(["Brass", "Dimmable"]), .paragraph("For the bedside.")])
    }

    func testSortingByPriceKeepsTiesInTheServersOrder() async throws {
        let products = try await Fixtures.products()
        let low = ProductSort.priceLow.apply(to: products)
        let prices = low.compactMap { $0.leadVariant?.price.fils }
        XCTAssertEqual(prices, prices.sorted())
        XCTAssertEqual(ProductSort.relevance.apply(to: products).map(\.id), products.map(\.id))
    }
}

final class TillTests: XCTestCase {
    private func money(_ text: String) -> Money { Money(amount: text)! }

    func testEachReductionIsCappedAtWhatIsStillOwed() {
        // The web's `settle`: code, then points, then the card, none below zero.
        let bill = Till.settle(goods: money("20.000"), delivery: money("1.500"), discount: money("5.000"), points: money("30.000"), giftCard: money("4.000"))
        XCTAssertEqual(bill.discount, money("5.000"))
        XCTAssertEqual(bill.points, money("16.500"), "points pay at most what the code left")
        XCTAssertEqual(bill.giftCard, .zero)
        XCTAssertEqual(bill.payable, .zero)
        let card = Till.settle(goods: money("10.000"), delivery: .zero, giftCard: money("3.250"))
        XCTAssertEqual(card.payable, money("6.750"))
    }

    func testPointsAreADiscountNotADeposit() {
        XCTAssertEqual(Till.pointsSpendable(500, on: money("0.200")), 200)
        XCTAssertEqual(Till.pointsSpendable(150, on: money("10.000")), 150)
        XCTAssertEqual(Till.pointsSpendable(-5, on: money("10.000")), 0)
        XCTAssertEqual(Till.spendValue(150), money("0.150"))
        XCTAssertEqual(Till.giftCardPayment(remaining: money("2.000"), owed: money("5.000")), money("2.000"))
        XCTAssertEqual(Till.giftCardPayment(remaining: money("9.000"), owed: money("5.000")), money("5.000"))
    }
}

/// The web's `chatText.test.ts`, the parts the app draws from.
final class ChatTextTests: XCTestCase {
    func testAnAnswerSplitsIntoWordsSearchesAndQuestions() {
        let answer = "Here are some kettles.\n[[search: electric kettle]]\n[[ask: Which one boils fastest?]]"
        XCTAssertEqual(ChatText.pieces(answer), [.text("Here are some kettles."), .search("electric kettle"), .ask("Which one boils fastest?")])
    }

    func testAHalfWrittenMarkerIsHeldBackWhileItStreams() {
        XCTAssertEqual(ChatText.pieces("Try these [[sea", streaming: true), [.text("Try these")])
    }

    func testASuggestionCarryingContactDetailsIsDropped() {
        XCTAssertEqual(ChatText.pieces("[[search: call 99887766]]"), [])
        XCTAssertEqual(ChatText.pieces("[[search: kettle]] [[search: Kettle]]"), [.search("kettle")], "the same search twice is one")
    }

    func testTheRowOffersStartersThenFollowUpsThenWhatIsLeft() {
        let starters = ["How can I pay?", "How do returns work?"]
        XCTAssertEqual(ChatText.nextQuestions([], starters: starters).questions, starters)
        let asked = ChatText.Turn(fromShopper: true, text: "How can I pay?", state: "done")
        XCTAssertEqual(ChatText.nextQuestions([asked], starters: starters).questions, [], "nothing while an answer is coming")
        let answered = ChatText.Turn(fromShopper: false, text: "Cash at the door.\n[[ask: Can I pay by card?]]", state: "done")
        let offer = ChatText.nextQuestions([asked, answered], starters: starters)
        XCTAssertEqual(offer.questions, ["Can I pay by card?"])
        XCTAssertTrue(offer.followUps)
        let plain = ChatText.Turn(fromShopper: false, text: "Cash at the door.", state: "done")
        XCTAssertEqual(ChatText.nextQuestions([asked, plain], starters: starters).questions, ["How do returns work?"], "the starters not yet asked")
    }

    func testTheStreamIsReadLineByLine() {
        XCTAssertEqual(ChatEvent.parse(#"data: {"type":"delta","text":"Hi"}"#), .delta("Hi"))
        XCTAssertEqual(ChatEvent.parse(#"data: {"type":"done","finish":"blocked"}"#), .done(finish: "blocked"))
        XCTAssertEqual(ChatEvent.parse(#"data: {"type":"error","code":"rate_limited"}"#), .failed(code: "rate_limited"))
        XCTAssertNil(ChatEvent.parse(": keep-alive"))
        XCTAssertNil(ChatEvent.parse(#"data: {"type":"done","finish":"whatever"}"#))
        XCTAssertEqual(GatewayRefusal(code: "rate_limited").messageKey, "ai.error.tooMany")
        XCTAssertEqual(GatewayRefusal(code: "anything").messageKey, "ai.error.unavailable")
    }

    func testADraftWithContactDetailsDoesNotGo() {
        XCTAssertEqual(ChatModel.draftProblem("   "), "empty")
        XCTAssertEqual(ChatModel.draftProblem("my number is 99887766"), "contact_details")
        XCTAssertNil(ChatModel.draftProblem("Is it dishwasher safe?"))
        XCTAssertEqual(ChatModel.draftProblem(String(repeating: "a", count: 1001)), "too_large")
    }
}

/// The product photos' arithmetic, held to the web's `gallery.ts` and the
/// numbers `ZoomViewer` zooms by.
final class GalleryRulesTests: XCTestCase {
    func testStepsRoundTheEndBothWays() {
        XCTAssertEqual(GalleryRules.step(0, by: 1, count: 3), 1)
        XCTAssertEqual(GalleryRules.step(2, by: 1, count: 3), 0)
        XCTAssertEqual(GalleryRules.step(0, by: -1, count: 3), 2)
        XCTAssertEqual(GalleryRules.step(4, by: 1, count: 1), 0, "one photo goes nowhere")
    }

    func testTheRailDrawsFourAndCountsTheRestOnce() {
        XCTAssertEqual(GalleryRules.rail(count: 3).shown, 3)
        XCTAssertEqual(GalleryRules.rail(count: 3).more, 0)
        XCTAssertEqual(GalleryRules.rail(count: 4).more, 0)
        XCTAssertEqual(GalleryRules.rail(count: 7).shown, 4)
        XCTAssertEqual(GalleryRules.rail(count: 7).more, 3)
    }

    func testTheButtonsZoomAsTheWebDoes() {
        XCTAssertEqual(GalleryRules.zoomedIn(from: 1), 2.5, "in from the photo's own size is a double tap's")
        XCTAssertEqual(GalleryRules.zoomedIn(from: 2.5), 3)
        XCTAssertEqual(GalleryRules.zoomedIn(from: 3.8), 4, "never past the most")
        XCTAssertEqual(GalleryRules.zoomedOut(from: 2.5), 2)
        XCTAssertEqual(GalleryRules.zoomedOut(from: 1.2), 1, "never under the photo's own size")
    }

    func testADoubleTapKeepsTheSpotUnderTheFinger() {
        let rect = GalleryRules.zoomRect(around: CGPoint(x: 100, y: 200), scale: 2.5, viewport: CGSize(width: 400, height: 800))
        XCTAssertEqual(rect.width, 160)
        XCTAssertEqual(rect.height, 320)
        XCTAssertEqual(rect.midX, 100)
        XCTAssertEqual(rect.midY, 200)
    }

    func testAPhotoFitsWholeAndAsLargeAsItCan() {
        XCTAssertEqual(GalleryRules.fitted(CGSize(width: 1000, height: 500), in: CGSize(width: 400, height: 800)), CGSize(width: 400, height: 200))
        XCTAssertEqual(GalleryRules.fitted(CGSize(width: 300, height: 600), in: CGSize(width: 400, height: 400)), CGSize(width: 200, height: 400))
    }

    func testAColourShowsItsPhotoByWholeWordAndNeverAVideo() {
        let gallery = [
            ProductMedia(kind: "image", url: "/a.webp", altText: "Smart watch, front", posterUrl: nil),
            ProductMedia(kind: "video", url: "/b.mp4", altText: "Black strap close up", posterUrl: nil),
            ProductMedia(kind: "image", url: "/c.webp", altText: "Smart watch in black", posterUrl: nil),
            ProductMedia(kind: "image", url: "/d.webp", altText: "ساعة باللون الأسود", posterUrl: nil),
        ]
        XCTAssertEqual(GalleryRules.photoIndex(naming: "Black", in: gallery), 2, "the video names it first and is skipped")
        XCTAssertNil(GalleryRules.photoIndex(naming: "S", in: gallery), "a size is not a letter inside a word")
        XCTAssertEqual(GalleryRules.photoIndex(naming: "أسود", in: gallery), 3, "the article comes off")
    }
}

/// The shop's search rule, ported from `Shared/commerce/search.ts` and held
/// to the same cases its own tests use.
final class SearchRankTests: XCTestCase {
    func testFoldsWhatKeyboardsAndSpellersDisagreeOn() {
        XCTAssertEqual(SearchRank.fold("أإآٱ"), "اااا")
        XCTAssertEqual(SearchRank.fold("ساعة"), "ساعه")
        XCTAssertEqual(SearchRank.fold("مستشفى"), "مستشفي")
        XCTAssertEqual(SearchRank.fold("مُكيّف"), "مكيف")
        XCTAssertEqual(SearchRank.fold("مـــكيف"), "مكيف")
        XCTAssertEqual(SearchRank.fold("S٢٦ ۱۲"), "s26 12")
    }

    func testTakesOffTheArticleAndThePlural() {
        XCTAssertEqual(SearchRank.words("الساعة"), ["ساعه"])
        XCTAssertEqual(SearchRank.words("والهواتف للبيع"), ["هواتف", "بيع"])
        XCTAssertEqual(SearchRank.stem("ساعات"), "ساع")
        XCTAssertEqual(SearchRank.stem("ال"), "ال")
        XCTAssertEqual(SearchRank.words("watches batteries battery cookies cookie phones glasses"), ["watch", "batteri", "batteri", "cooki", "cooki", "phon", "glass"])
        XCTAssertEqual(SearchRank.words("bus 65W S26"), ["bus", "65w", "s26"])
    }

    func testFindsAProductWhicheverWayItIsSpelt() {
        let watch = SearchRank.Doc(title: "ساعة ذكية", department: "Electronics")
        for term in ["ساعه", "الساعة", "ساعات", "الساعات"] {
            XCTAssertGreaterThan(SearchRank.score(watch, SearchRank.queryWords(term)), 0, term)
        }
        XCTAssertGreaterThan(SearchRank.score(SearchRank.Doc(title: "Three-seat sofas"), SearchRank.queryWords("sofa")), 0)
    }

    func testFindsTheSellersWordThroughASynonym() {
        let phone = SearchRank.Doc(title: "Galaxy phone")
        XCTAssertGreaterThan(SearchRank.score(phone, SearchRank.queryWords("جوال")), 0)
        XCTAssertGreaterThan(SearchRank.score(phone, SearchRank.queryWords("mobile")), 0)
        XCTAssertGreaterThan(SearchRank.score(SearchRank.Doc(title: "Basmati rice 5kg"), SearchRank.queryWords("عيش")), 0)
        XCTAssertEqual(SearchRank.queryWords("ph").first?.synonyms, [], "a fragment is never expanded")
    }

    func testRanksTheWordTypedAboveASynonymAndNeedsEveryWord() {
        let words = SearchRank.queryWords("mobile holder")
        XCTAssertGreaterThan(SearchRank.score(SearchRank.Doc(title: "Mobile holder"), words), SearchRank.score(SearchRank.Doc(title: "Phone holder"), words))
        XCTAssertEqual(SearchRank.score(SearchRank.Doc(title: "Mobile case"), words), 0, "every word, somewhere")
        let title = SearchRank.Doc(title: "Brass lamp")
        let described = SearchRank.Doc(title: "Desk light", description: "A brass lamp for reading")
        XCTAssertGreaterThan(SearchRank.score(title, SearchRank.queryWords("lamp")), SearchRank.score(described, SearchRank.queryWords("lamp")))
    }
}

/// The approved round's rules (A–H), each the Swift twin of a shared function,
/// held to that function's own cases.
final class ApprovedRoundRuleTests: XCTestCase {
    /// `referralCodeFor`: the values `Shared/commerce/referral.ts` gives.
    func testAReferralCodeIsTheWebsOwn() {
        XCTAssertEqual([1, 31, 900, 123_456].map(ReferralCode.code(for:)), ["NLAAAB", "NLAABB", "NLABAA", "NLEVFG"])
        XCTAssertEqual(ReferralCode.productPath(handle: "brass lamp", userId: 31), "/products/brass%20lamp?ref=NLAABB")
        XCTAssertEqual(ReferralCode.productPath(handle: "lamp", userId: nil), "/products/lamp")
    }

    /// `proposalFigureProblem`: one figure, a percentage or an amount.
    func testAProposalIsOneFigure() {
        XCTAssertNil(ProposalRules.problem(percent: "8", fixed: nil))
        XCTAssertNil(ProposalRules.problem(percent: nil, fixed: "0.500"))
        XCTAssertEqual(ProposalRules.problem(percent: "8", fixed: "1"), "commission.oneFigure")
        XCTAssertEqual(ProposalRules.problem(percent: " ", fixed: nil), "commission.oneFigure")
        XCTAssertEqual(ProposalRules.problem(percent: "101", fixed: nil), "commission.badPercent")
        XCTAssertEqual(ProposalRules.problem(percent: "8.123", fixed: nil), "commission.badPercent")
        XCTAssertEqual(ProposalRules.problem(percent: nil, fixed: "1.2345"), "commission.badFixed")
    }

    /// `storeAffiliateRate`: above nothing, at most the ceiling, two decimals.
    func testAStoresAffiliateRate() {
        XCTAssertEqual(AffiliateRules.storeRate("5", ceiling: 20), "5.00")
        XCTAssertEqual(AffiliateRules.storeRate("12.5", ceiling: 20), "12.50")
        XCTAssertNil(AffiliateRules.storeRate("0", ceiling: 20))
        XCTAssertNil(AffiliateRules.storeRate("21", ceiling: 20))
        XCTAssertNil(AffiliateRules.storeRate("5.123", ceiling: 20))
    }

    /// `overallOf`: the parts' average, half up.
    func testADeliverysOverallIsItsPartsAverage() {
        XCTAssertEqual(DeliveryRatingParts.overall(speed: 3, condition: 5, conduct: 5), 4)
        XCTAssertEqual(DeliveryRatingParts.overall(speed: 4, condition: 5, conduct: 5), 5)
        XCTAssertEqual(DeliveryRatingParts.overall(speed: 1, condition: 1, conduct: 2), 1)
    }

    /// `warningReasonProblem`.
    func testAWarningNeedsAReason() {
        let rules = WarningRules()
        XCTAssertEqual(rules.reasonProblem("  "), "warnings.needsReason")
        XCTAssertEqual(rules.reasonProblem(String(repeating: "x", count: 401)), "warnings.tooLong")
        XCTAssertNil(rules.reasonProblem("Listed a counterfeit"))
        XCTAssertEqual(rules.suspendAt, 3)
        XCTAssertEqual(rules.days, 365)
    }

    /// `normaliseSetting`.
    func testASettingIsAPercentageInsideItsRange() {
        let setting = PlatformSetting(key: "referral.productPercent", value: "20.00", defaultValue: "20.00", min: 0, max: 50)
        XCTAssertEqual(setting.normalise("15"), "15.00")
        XCTAssertEqual(setting.normalise("12.5"), "12.50")
        XCTAssertNil(setting.normalise("51"))
        XCTAssertNil(setting.normalise("-1"))
        XCTAssertNil(setting.normalise("abc"))
    }

    /// One capability granted on its own (3.3.9) reaches that and nothing else.
    func testAGrantReachesOneThing() {
        let clerk = SellerIdentity(kind: "customer", userId: 9, vendorId: nil, role: nil, grants: ["vendor.setCommission"])
        XCTAssertTrue(clerk.inPortal)
        XCTAssertTrue(clerk.can("vendor.setCommission"))
        XCTAssertFalse(clerk.can("platform.viewAll"))
        XCTAssertFalse(SellerIdentity(kind: "customer", userId: 9, vendorId: nil, role: nil).inPortal)
        XCTAssertEqual(PortalPage("/admin/commission"), .commission)
    }
}

/// "Your profile"'s rules — `Shared/commerce/profileDetails.ts`, on its own test's cases.
final class ProfileRulesTests: XCTestCase {
    func testADisplayNameIsOfferedBackAsAFirstWordAndTheRest() {
        XCTAssertEqual(ProfileDetails.split("Noura Al-Sabah").first, "Noura")
        XCTAssertEqual(ProfileDetails.split("Noura Al-Sabah").last, "Al-Sabah")
        XCTAssertEqual(ProfileDetails.split("  Mohammed  Abdullah Al-Mutairi ").last, "Abdullah Al-Mutairi")
        XCTAssertEqual(ProfileDetails.split("Fahad").last, "")
        XCTAssertEqual(ProfileDetails.split(nil).first, "")
    }

    func testBothNamesAreNeededAndEachIsShort() {
        XCTAssertEqual(Validation.nameProblem(first: "Noura", last: ""), "profile.nameRequired")
        XCTAssertEqual(Validation.nameProblem(first: " ", last: "Al-Sabah"), "profile.nameRequired")
        XCTAssertEqual(Validation.nameProblem(first: String(repeating: "N", count: 61), last: "Al-Sabah"), "profile.nameTooLong")
        XCTAssertNil(Validation.nameProblem(first: "Noura", last: "Al-Sabah"))
    }

    func testAPhoneIsReadAsTheWishlistNumberIs() {
        XCTAssertNil(Validation.profilePhoneProblem("٥٠١٢ ٣٤٥٦"))
        XCTAssertNil(Validation.profilePhoneProblem(""), "an empty box clears it")
        XCTAssertEqual(Validation.profilePhoneProblem("123"), "wishlist.phoneInvalid")
    }

    func testABirthdayIsARealDateNoLaterThanToday() {
        XCTAssertNil(Validation.birthdayProblem("1990-05-17", today: "2026-10-27"))
        XCTAssertNil(Validation.birthdayProblem("2026-10-27", today: "2026-10-27"))
        XCTAssertEqual(Validation.birthdayProblem("2026-10-28", today: "2026-10-27"), "profile.birthdayInvalid")
        XCTAssertEqual(Validation.birthdayProblem("1899-12-31", today: "2026-10-27"), "profile.birthdayInvalid")
        XCTAssertEqual(Validation.birthdayProblem("2023-02-29", today: "2026-10-27"), "profile.birthdayInvalid")
        XCTAssertNil(Validation.birthdayProblem("2024-02-29", today: "2026-10-27"))
        XCTAssertEqual(Validation.birthdayProblem("17/05/1990", today: "2026-10-27"), "profile.birthdayInvalid")
    }

    func testEveryCountryIsKnownOnceAndHasAName() {
        let rules = ReferenceData.shared.rules.profileRules
        XCTAssertEqual(Set(rules.countries).count, rules.countries.count)
        XCTAssertGreaterThan(rules.countries.count, 200, "the export reached the app, not the fallback")
        XCTAssertTrue(rules.commonNationalities.allSatisfy(rules.countries.contains))
        XCTAssertEqual(CountryNames.name("KW", language: .en), "Kuwait")
        XCTAssertNotEqual(CountryNames.name("KW", language: .ar), "KW", "the phone names it in Arabic too")
    }
}

/// The bag by store — `lib/bagGroups.ts`, on its own test's cases.
final class BagGroupTests: XCTestCase {
    func testTheRecordedBagIsOneStoreWithItsOwnParcel() async throws {
        let cart = try await Fixtures.cart()
        let groups = try XCTUnwrap(BagGroup.groups(cart))
        XCTAssertEqual(groups.map(\.store.slug), ["gulf-grocers"])
        XCTAssertEqual(groups.first?.items.count, cart.items.count)
        XCTAssertEqual(groups.first?.delivery.count, 1, "the store's own parcel is beside its lines")
    }

    func testTheWayToFreeDeliveryIsTheServersOwnFigures() throws {
        let json = #"""
        {"vendorId":4,"vendorName":"Acme","vendorNameAr":null,"goods":{"amount":"6.500","currencyCode":"KWD"},"fee":{"amount":"1.000","currencyCode":"KWD"},"free":false,"toFree":{"amount":"3.500","currencyCode":"KWD"}}
        """#
        let line = try JSONDecoder().decode(CartDeliveryLine.self, from: Data(json.utf8))
        XCTAssertEqual(try XCTUnwrap(BagGroup.freeProgress(line)), 0.65, accuracy: 0.0001)
        let none = try JSONDecoder().decode(CartDeliveryLine.self, from: Data(json.replacingOccurrences(of: #""toFree":{"amount":"3.500","currencyCode":"KWD"}"#, with: #""toFree":null"#).utf8))
        XCTAssertNil(BagGroup.freeProgress(none))
    }
}

/// The web's `tabBarScroll.test.ts`, case for case.
final class TabBarScrollTests: XCTestCase {
    private let viewport: CGFloat = 800
    private let height: CGFloat = 5000

    /// Rests at the first position, then scrolls through the rest a frame at a time.
    private func scroll(_ positions: [CGFloat]) -> TabBarScroll {
        positions.dropFirst().reduce(TabBarScroll(y: positions[0])) { state, y in
            state.next(y: y, viewport: viewport, height: height)
        }
    }

    func testItStaysWhileTheScrollDownIsStillShort() {
        let start = TabBarScroll.topZone + 100
        XCTAssertFalse(scroll([start, start + 20, start + 40, start + TabBarScroll.tuckAfter - 1]).away)
    }

    func testItSlidesAwayOnceTheScrollDownHasGoneFarEnough() {
        let start = TabBarScroll.topZone + 100
        XCTAssertTrue(scroll([start, start + 30, start + TabBarScroll.tuckAfter]).away)
    }

    func testOnlyTheDistanceSinceTheDirectionTurnedCounts() {
        let start = TabBarScroll.topZone + 200
        XCTAssertFalse(scroll([start, start + 50, start + 45, start + 95]).away)
    }

    func testItComesBackOnAScrollUpAndNotOnABounce() {
        let start = TabBarScroll.topZone + 400
        let away = scroll([start, start + 200])
        XCTAssertTrue(away.away)
        XCTAssertTrue(away.next(y: start + 200 - (TabBarScroll.showAfter - 1), viewport: viewport, height: height).away)
        XCTAssertFalse(away.next(y: start + 200 - TabBarScroll.showAfter, viewport: viewport, height: height).away)
    }

    func testItStartsCountingAtTheEdgeOfTheTopZone() {
        let steps = (0..<20).map { CGFloat($0 * 8) }
        XCTAssertFalse(scroll(steps).away)
        XCTAssertTrue(scroll(steps + [TabBarScroll.topZone + TabBarScroll.tuckAfter]).away)
    }

    func testItIsAlwaysThereNearTheTop() {
        let away = scroll([TabBarScroll.topZone + 300, TabBarScroll.topZone + 600])
        XCTAssertTrue(away.away)
        XCTAssertFalse(away.next(y: TabBarScroll.topZone, viewport: viewport, height: height).away)
    }

    func testItIsThereAtTheFootOfThePage() {
        let away = scroll([1000, 1400])
        XCTAssertTrue(away.away)
        XCTAssertFalse(away.next(y: height - viewport, viewport: viewport, height: height).away)
    }

    func testAJumpLongerThanAScreenIsNotAScroll() {
        let state = scroll([TabBarScroll.topZone + 10, 3000])
        XCTAssertFalse(state.away)
        XCTAssertFalse(state.next(y: 3000 + TabBarScroll.tuckAfter - 1, viewport: viewport, height: height).away)
    }

    func testNothingChangesWhenNothingMoved() {
        let away = scroll([500, 700])
        XCTAssertEqual(away.next(y: 700, viewport: viewport, height: height), away)
    }
}

/// What the bag looks like the moment a button is pressed — the web's
/// `bagOps.test.ts`, on the recorded bag: one line of rice, 2 × 4.750, with
/// 0.750 delivery.
final class BagOpsTests: XCTestCase {
    func testAPlusOnACardDrawsTheLineFromTheCardsOwnProduct() async throws {
        let dates = try XCTUnwrap(try await Fixtures.products().first { $0.handle == "medjool-dates" })
        let ghost = BagOps.ghostLine(dates, variantId: "144", quantity: 2)
        let bag = try XCTUnwrap(BagOps.apply(try await Fixtures.cart(), .add(variantId: "144", quantity: 2, ghost: ghost)))
        XCTAssertEqual(bag.items.count, 2)
        XCTAssertEqual(bag.items.last?.lineId, "pending:144")
        XCTAssertEqual(bag.items.last?.lineTotal.fils, 12_500)
        XCTAssertEqual(bag.items.last?.vendor?.slug, "gulf-grocers", "drawn under its store before the server says")
        XCTAssertEqual(bag.itemCount, 4)
        XCTAssertEqual(bag.subtotal.fils, 22_000)
        XCTAssertEqual(bag.total.fils, 22_750, "the delivery stays the server's last until it answers")
    }

    func testAnAddOntoALineAddsToItUpToTheCeiling() async throws {
        let rice = try await Fixtures.cart()
        let more = try XCTUnwrap(BagOps.apply(rice, .add(variantId: "145", quantity: 1, ghost: nil)))
        XCTAssertEqual(more.items.count, 1)
        XCTAssertEqual(more.items[0].quantity, 3)
        XCTAssertEqual(more.items[0].lineTotal.fils, 14_250)
        XCTAssertEqual(more.subtotal.fils, 14_250)
        let ceiling = ReferenceData.shared.rules.maxLineQuantity
        let full = BagOps.apply(rice, .add(variantId: "145", quantity: ceiling + 5, ghost: nil))
        XCTAssertEqual(full?.items[0].quantity, ceiling)
    }

    func testAnAddWithNothingToDrawMovesOnlyTheCount() async throws {
        let rice = try await Fixtures.cart()
        let bag = try XCTUnwrap(BagOps.apply(rice, .add(variantId: "999", quantity: 2, ghost: nil)))
        XCTAssertEqual(bag.items.count, 1)
        XCTAssertEqual(bag.itemCount, 4)
        // The count the lines do not explain is carried over while the line waits.
        let stepped = try XCTUnwrap(BagOps.apply(bag, .set(lineId: "115", quantity: 1)))
        XCTAssertEqual(stepped.itemCount, 3)
        XCTAssertNil(BagOps.apply(nil, .set(lineId: "115", quantity: 1)), "no bag, nothing to step")
    }

    func testAPressOnADrawnAheadLineFollowsItToTheRealOne() async throws {
        let rice = try await Fixtures.cart()
        XCTAssertEqual(BagOps.realLineId(rice, "pending:145"), "115")
        XCTAssertNil(BagOps.realLineId(rice, "pending:144"), "not made yet")
        XCTAssertEqual(BagOps.realLineId(rice, "115"), "115")
        let stepped = try XCTUnwrap(BagOps.apply(rice, .set(lineId: "pending:145", quantity: 5)))
        XCTAssertEqual(stepped.items[0].quantity, 5)
        let gone = try XCTUnwrap(BagOps.apply(rice, .remove(lineId: "115")))
        XCTAssertTrue(gone.items.isEmpty)
        XCTAssertEqual(gone.itemCount, 0)
        XCTAssertEqual(gone.subtotal.fils, 0)
    }
}
