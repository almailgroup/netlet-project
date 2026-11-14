import XCTest
@testable import NetLet

/// Warranty and installation (3.1.2): the app's rules are
/// `Shared/commerce/addons.ts`'s, on `addons.test.ts`'s own cases.
final class AddonRulesTests: XCTestCase {
    private func draft(_ kind: String = "installation", label: String = "", labelAr: String = "", price: String = "5.000", months: Int? = nil) -> AddonRules.Draft {
        AddonRules.Draft(kind: kind, label: label, labelAr: labelAr, price: price, warrantyMonths: months)
    }

    func testTheLengthsAndCeilingsComeFromTheSharedRules() {
        XCTAssertEqual(AddonRules.warrantyMonths, [6, 12, 24, 36, 48, 60])
        XCTAssertEqual(AddonRules.maxAddons, 10)
        XCTAssertEqual(AddonRules.nameMax, 160)
    }

    func testAFreeExtraAndAPriceThatIsNotOneAreRefused() {
        XCTAssertEqual(AddonRules.problems([draft(price: "0.000")]), [[.price]])
        XCTAssertEqual(AddonRules.problems([draft(price: "abc")]), [[.price]])
        XCTAssertEqual(AddonRules.problems([draft(price: "1.2345")]), [[.price]])
        XCTAssertEqual(AddonRules.problems([draft(price: "12.5")]), [[]])
    }

    func testInstallationAndAPlanWithALengthAreNamedForTheSeller() {
        XCTAssertEqual(AddonRules.problems([draft()]), [[]])
        XCTAssertEqual(AddonRules.problems([draft("warranty", months: 24)]), [[]])
        XCTAssertEqual(AddonRules.problems([draft("other")]), [[.name]])
        XCTAssertEqual(AddonRules.problems([draft("other", labelAr: "تغليف هدية")]), [[]])
    }

    func testAPlanAsksForItsLengthUnlessItHasAName() {
        XCTAssertEqual(AddonRules.problems([draft("warranty")]), [[.warrantyLength]])
        XCTAssertEqual(AddonRules.problems([draft("warranty", label: "Two extra years")]), [[]])
        XCTAssertEqual(AddonRules.problems([draft("warranty", months: 7)]), [[.warrantyLength]])
    }

    func testTwoPlansOfOneLengthAreRefusedOnTheSecond() {
        XCTAssertEqual(AddonRules.problems([
            draft("warranty", months: 12), draft("warranty", months: 24), draft("warranty", price: "9.000", months: 12),
        ]), [[], [], [.warrantyTwice]])
    }

    func testANamePastTheColumnIsRefused() {
        XCTAssertEqual(AddonRules.problems([draft("other", label: String(repeating: "x", count: 161))]), [[.nameLong]])
    }

    func testDefaultNamesCountTheLengthInEachLanguage() {
        XCTAssertEqual(AddonRules.defaultName(kind: "installation", months: nil, language: .ar), "التركيب")
        XCTAssertEqual(AddonRules.defaultName(kind: "warranty", months: 12, language: .en), "1-year extended warranty")
        XCTAssertEqual(AddonRules.defaultName(kind: "warranty", months: 12, language: .ar), "ضمان ممتد لمدة سنة")
        XCTAssertEqual(AddonRules.defaultName(kind: "warranty", months: 24, language: .ar), "ضمان ممتد لمدة سنتين")
        XCTAssertEqual(AddonRules.defaultName(kind: "warranty", months: 36, language: .ar), "ضمان ممتد لمدة 3 سنوات")
        XCTAssertEqual(AddonRules.defaultName(kind: "warranty", months: 6, language: .en), "6-month extended warranty")
        XCTAssertEqual(AddonRules.defaultName(kind: "warranty", months: 6, language: .ar), "ضمان ممتد لمدة 6 أشهر")
        XCTAssertNil(AddonRules.defaultName(kind: "other", months: nil, language: .en))
        XCTAssertEqual(AddonRules.lengthWords(24, language: .ar), "سنتان")
    }

    /// The editor shows a default name blank again, so a new length renames the plan.
    func testADefaultNameIsBlankInTheEditorAndASellersOwnIsKept() {
        XCTAssertEqual(AddonRules.draft(kind: "warranty", label: "2-year extended warranty", labelAr: "ضمان ممتد لمدة سنتين", price: "12.500", months: 24),
                       draft("warranty", price: "12.500", months: 24))
        XCTAssertEqual(AddonRules.draft(kind: "warranty", label: "Gold care", labelAr: nil, price: "9.000", months: 36),
                       draft("warranty", label: "Gold care", price: "9.000", months: 36))
        XCTAssertEqual(AddonRules.draft(kind: "installation", label: "Installation", labelAr: "التركيب", price: "5.000", months: 24),
                       draft(), "a length belongs to a warranty alone")
    }

    func testABlankRowIsAnAbandonedEdit() {
        XCTAssertTrue(AddonRules.isBlank(draft(price: "")))
        XCTAssertFalse(AddonRules.isBlank(draft("warranty", price: "", months: 12)))
        XCTAssertFalse(AddonRules.isBlank(draft()))
    }
}
