import XCTest
@testable import NetLet

/// The web's own cases (`contactFilter.test.ts`): the ways people write a
/// number or an address to get round a filter, and the ordinary messages it
/// must let through.
final class ContactFilterTests: XCTestCase {
    private func assertFinds(_ kind: String, in texts: [String], file: StaticString = #filePath, line: UInt = #line) {
        for text in texts {
            XCTAssertTrue(ContactFilter.findings(text).contains(kind), "\(kind) in \(text)", file: file, line: line)
        }
    }

    func testPhoneNumbers() {
        assertFinds("phone", in: [
            "call me on 99887766", "+965 9988 7766", "00965 99887766", "99 88 77 66", "9988-7766", "99.88.77.66",
            "9-9-8-8-7-7-6-6", "(9988) 7766", "٩٩٨٨٧٧٦٦", "رقمي ٩٩٨٨ ٧٧٦٦", "۹۹۸۸۷۷۶۶",
            "nine nine eight eight seven seven six six", "9 nine 8 eight 7 seven 6 six",
            "تسعة تسعة ثمانية ثمانية سبعة سبعة ستة ستة", "خمسة وخمسة وستة وستة وسبعة وسبعة وثمانية وثمانية",
            "９９８８７７６６", "+44 20 7946 0958", "9988/77/66",
        ])
    }

    func testEmailAddresses() {
        assertFinds("email", in: [
            "noura@gmail.com", "noura @ gmail . com", "noura at gmail dot com", "noura (at) gmail (dot) com",
            "noura [at] gmail [dot] com", "n o u r a @ g m a i l . c o m", "NOURA@GMAIL.COM",
            "noura آت gmail نقطة com", "my gmail is noura1990", "send it to my hotmail",
        ])
        XCTAssertEqual(ContactFilter.findings("noura@gmail.com"), ["email"], "an address is one finding, not also a link")
    }

    func testLinks() {
        assertFinds("link", in: [
            "https://example.com/deal", "www.cheaper-sofas.com", "cheaper-sofas.com", "wa.me/96599887766",
            "wa dot me slash 96599887766", "t.me/noura_shop", "bit.ly/abc123", "my shop is sofas.kw",
        ])
    }

    func testHandles() {
        assertFinds("handle", in: [
            "follow @noura.shop", "add me on whatsapp", "Whats App me", "dm me on insta", "my instagram is noura",
            "snapchat: noura", "telegram please", "كلمني واتساب", "على الواتس", "تابعني انستا", "سنابي noura", "تيك توك",
        ])
    }

    func testTheObfuscations() {
        assertFinds("phone", in: [
            "9️⃣9️⃣8️⃣8️⃣7️⃣7️⃣6️⃣6️⃣", "99\u{200B}88\u{200B}77\u{200B}66", "9\u{200D}9\u{200D}8\u{200D}8\u{200D}7\u{200D}7\u{200D}6\u{200D}6",
            "99\u{2060}88\u{2060}77\u{2060}66", "٩٩\u{200F}٨٨\u{200F}٧٧\u{200F}٦٦", "9988\u{00AD}7766",
            "99O8 7766", "9988 77l6", "nine9eight8seven7six6",
        ])
        assertFinds("handle", in: ["whats\u{200B}app me", "IG: noura.home", "ig noura_home"])
        assertFinds("link", in: ["noura . shop"])
    }

    func testOrdinaryMessagesGoThrough() {
        for text in [
            "Is the IG model in stock?", "I got 2 of them, size 10 and 12", "Model ABC-1234, is it the 2026 one?",
            "Does someone answer on weekends?", "Grade A, size L, in olive",
            "Hello, is the sofa still available?", "I need two by Thursday.", "Can you do one, two or three cushions?",
            "It was KWD 12,500.000 at the other shop", "السعر 12,500.000 د.ك",
            "My order is NL-20260915-QRTVW and it has not arrived", "It was delivered on 2026-09-15",
            "delivered 15/09/2026, box was fine", "The lamp is 45 cm tall and weighs 1500 g",
            "I'll be at home after 5. Thanks!", "Meet at the shop. Come early", "هل يتوفر باللون الأزرق؟ أحتاج اثنين",
            "Is it compatible with model 7840?", "The install guide says insert the battery first",
            "Grade A, 100% cotton, 3 sizes", "Thanks — 5 stars from me", "Email confirmation came through, thank you",
        ] {
            XCTAssertEqual(ContactFilter.findings(text), [], text)
        }
    }

    func testWhatItReports() {
        XCTAssertEqual(ContactFilter.findings("whatsapp 99887766 or noura@gmail.com or sofas.com"), ["phone", "email", "link", "handle"])
        XCTAssertEqual(ContactFilter.normalise("٩٩ nine"), "99 9")
    }
}
