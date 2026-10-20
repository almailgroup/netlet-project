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
