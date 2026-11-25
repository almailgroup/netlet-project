import XCTest
@testable import NetLet

/// Who a gift off somebody's list is from (migration 0092): the app's rule is
/// `giverNameProblem` in `Shared/commerce/wishlist.ts`, on `wishlist.test.ts`'s
/// own cases, and the gift list's answer carries the choice.
final class GiverNameTests: XCTestCase {
    func testTheCeilingComesFromTheSharedRules() {
        XCTAssertEqual(GiverName.maxLength, 60)
    }

    func testANameIsKeptAsTypedItsSpacesTidied() {
        XCTAssertEqual(GiverName.clean("  Aunt   Mona "), "Aunt Mona")
        XCTAssertNil(GiverName.problem("Aunt Mona"))
        XCTAssertNil(GiverName.problem("خالتك منى"))
        XCTAssertNil(GiverName.problem("The Al-Sabah family"))
    }

    func testANameIsNeededToShowOne() {
        XCTAssertEqual(GiverName.problem(""), "giverNameNeeded")
        XCTAssertEqual(GiverName.problem("   "), "giverNameNeeded")
        XCTAssertEqual(GiverName.problem(nil), "giverNameNeeded")
    }

    func testWhatAPersonSeesIsCountedSoAnArabicNameIsNotCutShort() {
        XCTAssertNil(GiverName.problem(String(repeating: "م", count: 60)))
        XCTAssertEqual(GiverName.problem(String(repeating: "م", count: 61)), "giverNameTooLong")
    }

    func testAWayToReachSomebodyOffTheShopIsRefused() {
        XCTAssertEqual(GiverName.problem("Mona 99887766"), "giverNameContact")
        XCTAssertEqual(GiverName.problem("mona@example.com"), "giverNameContact")
        XCTAssertEqual(GiverName.problem("٩٩٨٨٧٧٦٦"), "giverNameContact")
        XCTAssertEqual(GiverName.problem("insta @mona.k"), "giverNameContact")
    }

    func testTheBoxStartsAtTheAccountsFirstNameNeverMore() {
        XCTAssertEqual(GiverName.suggested("Noura Al-Sabah"), "Noura")
        XCTAssertEqual(GiverName.suggested("  منى   الكندري "), "منى")
        XCTAssertEqual(GiverName.suggested(nil), "")
        XCTAssertEqual(GiverName.suggested(""), "")
    }

    /// A list from a server before 0092 has neither field; one after it says
    /// whether names are open and what the viewer chose for their own claim.
    func testAGiftListDecodesWithAndWithoutTheChoice() throws {
        let before = #"{"token":"t","title":"Birthday","ownerName":null,"items":[{"productId":"1","note":null,"quantity":1,"state":"available","claimedByYou":false}]}"#
        let old = try JSONDecoder().decode(GiftList.self, from: Data(before.utf8))
        XCTAssertNil(old.namesOpen)
        XCTAssertNil(old.items[0].yourName)

        let after = #"{"token":"t","title":"Birthday","ownerName":"Noura","namesOpen":true,"items":[{"productId":"1","note":null,"quantity":1,"state":"claimed","claimedByYou":true,"yourName":"Uncle Salem"}]}"#
        let new = try JSONDecoder().decode(GiftList.self, from: Data(after.utf8))
        XCTAssertEqual(new.namesOpen, true)
        XCTAssertEqual(new.items[0].yourName, "Uncle Salem")
    }

    /// The owner's list says who a delivered gift is from, "someone" being a
    /// name of nil, and nothing at all before it arrives.
    func testTheOwnersListCarriesWhoADeliveredGiftIsFrom() throws {
        let json = #"{"list":{"id":1,"title":"Birthday","visibility":"public","ownerName":"Noura"},"items":[{"id":1,"productId":"1","note":null,"quantity":1,"giftFrom":{"name":"Uncle Salem"}},{"id":2,"productId":"2","note":null,"quantity":1,"giftFrom":{"name":null}},{"id":3,"productId":"3","note":null,"quantity":1,"giftFrom":null},{"id":4,"productId":"4","note":null,"quantity":1}]}"#
        let detail = try JSONDecoder().decode(WishlistDetail.self, from: Data(json.utf8))
        XCTAssertEqual(detail.items[0].giftFrom?.name, "Uncle Salem")
        XCTAssertNotNil(detail.items[1].giftFrom)
        XCTAssertNil(detail.items[1].giftFrom?.name)
        XCTAssertNil(detail.items[2].giftFrom)
        XCTAssertNil(detail.items[3].giftFrom)
    }
}
