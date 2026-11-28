import PDFKit
import XCTest
@testable import NetLet

/// My orders' journey and receipt: `ReceiptRules` held to the cases of
/// `orderReceipt.test.ts` and `orderProgress.test.ts`, the journey's motion
/// to its keyframes, and the receipt drawn from a recorded order into a PDF.
final class OrderReceiptTests: XCTestCase {
    private func money(_ text: String) -> Money { Money(fils: Money.parseFils(text)!) }

    private var plain: ReceiptRules.Figures {
        ReceiptRules.Figures(
            itemsTotal: money("39.900"), deliveryTotal: money("1.500"), grandTotal: money("41.400"),
            discountCode: nil, discountValue: .zero, pointsSpent: 0, pointsValue: .zero,
            giftCardCode: nil, giftCardValue: .zero
        )
    }

    // MARK: The journey

    func testEveryProgressLandsOnOneOfFiveStages() {
        XCTAssertEqual(ReceiptRules.journeyStage("received"), .processing)
        XCTAssertEqual(ReceiptRules.journeyStage("preparing"), .processing)
        XCTAssertEqual(ReceiptRules.journeyStage("onTheWay"), .onTheWay)
        XCTAssertEqual(ReceiptRules.journeyStage("partlyDelivered"), .onTheWay)
        XCTAssertEqual(ReceiptRules.journeyStage("delivered"), .delivered)
        XCTAssertEqual(ReceiptRules.journeyStage("cancelled"), .cancelled)
        XCTAssertEqual(ReceiptRules.journeyStage("returned"), .returned)
        XCTAssertEqual(JourneyStage.processing.step, 0)
        XCTAssertEqual(JourneyStage.delivered.step, 2)
        XCTAssertNil(JourneyStage.cancelled.step)
    }

    /// The band's strip: `journeyStep`'s cases in `orderReceipt.test.ts`.
    func testAnItemSitsOnOneOfTheTrackersFourSteps() {
        XCTAssertEqual(ReceiptRules.journeyStep("received"), 0)
        XCTAssertEqual(ReceiptRules.journeyStep("preparing"), 1)
        XCTAssertEqual(ReceiptRules.journeyStep("onTheWay"), 2)
        XCTAssertEqual(ReceiptRules.journeyStep("partlyDelivered"), 2)
        XCTAssertEqual(ReceiptRules.journeyStep("delivered"), 3)
        XCTAssertNil(ReceiptRules.journeyStep("cancelled"))
        XCTAssertNil(ReceiptRules.journeyStep("returned"))
    }

    func testTheVanDrivesTheRoadAndFadesAtTheHouse() {
        let start = JourneyMotion.drive(at: 0)
        XCTAssertEqual(start.distance, 0, accuracy: 0.0001)
        XCTAssertEqual(start.vanOpacity, 0, accuracy: 0.0001)
        let arrived = JourneyMotion.drive(at: JourneyMotion.tripSeconds * 0.8)
        XCTAssertEqual(arrived.distance, 1, accuracy: 0.0001)
        XCTAssertEqual(arrived.vanOpacity, 1, accuracy: 0.0001)
        // The web's keyframes: gone by 94%.
        let fading = JourneyMotion.drive(at: JourneyMotion.tripSeconds * 0.87)
        XCTAssertEqual(fading.distance, 1, accuracy: 0.0001)
        XCTAssertEqual(fading.vanOpacity, 0.5, accuracy: 0.0001)
        XCTAssertEqual(fading.roadOpacity, 0.5, accuracy: 0.0001)
        XCTAssertEqual(JourneyMotion.drive(at: JourneyMotion.tripSeconds * 0.95).vanOpacity, 0, accuracy: 0.0001)
        // Half-way along the drive, half-way along the road.
        XCTAssertEqual(JourneyMotion.drive(at: JourneyMotion.tripSeconds * 0.4).distance, 0.5, accuracy: 0.0001)
        // Still (Reduce Motion): the van half-way, nothing turning, no parcel in the air.
        let still = JourneyMotion(time: nil)
        XCTAssertEqual(still.drive.distance, 0.5)
        XCTAssertEqual(still.wheel, 0)
        XCTAssertEqual(still.dip, 0)
        XCTAssertTrue(still.puffs(onTheWay: true).isEmpty)
        XCTAssertEqual(JourneyMotion.hop(phase: still.loadPhase).opacity, 0, accuracy: 0.0001)
    }

    /// The wheels turn a whole turn every 0.42s, so a picture a fifth of a turn later differs.
    func testTheWheelsTurnAndThePuffsTrailBehind() {
        XCTAssertEqual(JourneyMotion(time: 0).wheel, 0, accuracy: 0.0001)
        XCTAssertEqual(JourneyMotion(time: 0.21).wheel, 180, accuracy: 0.0001)
        XCTAssertEqual(JourneyMotion(time: 0.42).wheel, 0, accuracy: 0.0001)
        // On the road the puffs go back behind the van; while it waits they rise.
        let driving = JourneyMotion(time: 10.3).puffs(onTheWay: true)
        XCTAssertEqual(driving.count, 3)
        XCTAssertTrue(driving.allSatisfy { $0.x <= 0 && $0.opacity <= 0.8 })
        let waiting = JourneyMotion(time: 10.3).puffs(onTheWay: false)
        XCTAssertTrue(waiting.allSatisfy { $0.y <= 0 })
        XCTAssertEqual(JourneyMotion(time: 0).streaks().count, 2)
    }

    /// A parcel hops from the store's door into the van's back: the web's `journey-hop` keyframes.
    func testAParcelHopsFromTheStoreIntoTheVan() {
        let leaving = JourneyMotion.hop(phase: 0)
        XCTAssertEqual(leaving.x, -24)
        XCTAssertEqual(leaving.opacity, 0)
        let top = JourneyMotion.hop(phase: 0.45)
        XCTAssertEqual(top.x, -8, accuracy: 0.0001)
        XCTAssertEqual(top.y, -17, accuracy: 0.0001)
        XCTAssertEqual(top.opacity, 1, accuracy: 0.0001)
        let landed = JourneyMotion.hop(phase: 0.9)
        XCTAssertEqual(landed.x, 7, accuracy: 0.0001)
        XCTAssertEqual(landed.scale, 0.5, accuracy: 0.0001)
        XCTAssertEqual(landed.opacity, 0, accuracy: 0.0001)
        // The van dips as it lands and is level again before the next.
        XCTAssertEqual(JourneyMotion.dip(phase: 0.56), -3, accuracy: 0.0001)
        XCTAssertEqual(JourneyMotion.dip(phase: 0.9), 0, accuracy: 0.0001)
    }

    /// Delivered: the parcel set down, the tick popped, the burst over — and drawn so from the start under Reduce Motion.
    func testADeliveredOrderArrivesOnce() {
        let first = JourneyMotion.landing(0)
        XCTAssertEqual(first.parcelOpacity, 0)
        XCTAssertEqual(first.tickScale, 0)
        XCTAssertEqual(first.parcelDrop, -14, accuracy: 0.0001)
        let mid = JourneyMotion.landing(0.5)
        XCTAssertGreaterThan(mid.burstOpacity, 0)
        let done = JourneyMotion.landing(1)
        XCTAssertEqual(done.parcelOpacity, 1)
        XCTAssertEqual(done.parcelDrop, 0, accuracy: 0.0001)
        XCTAssertEqual(done.tickScale, 1, accuracy: 0.0001)
        XCTAssertEqual(done.burstOpacity, 0)
    }

    func testTheProgressIsReadOffTheLinesAsTheServerReadsIt() {
        typealias Line = (fulfilment: String, deliveredAt: Date?, preordered: Bool)
        func line(_ state: String, preordered: Bool = false, at: Date? = nil) -> Line { (state, at, preordered) }
        XCTAssertEqual(ReceiptRules.progress(status: "pending_payment", lines: [line("pending"), line("pending")]).kind, "received")
        XCTAssertEqual(ReceiptRules.progress(status: "pending_payment", lines: [line("pending", preordered: true)]).preordered, true)
        XCTAssertEqual(ReceiptRules.progress(status: "pending_payment", lines: [line("pending", preordered: true), line("pending")]).preordered, false)
        XCTAssertEqual(ReceiptRules.progress(status: "pending_payment", lines: [line("preparing"), line("pending")]).kind, "preparing")
        XCTAssertEqual(ReceiptRules.progress(status: "pending_payment", lines: [line("shipped"), line("preparing")]).kind, "onTheWay")
        let partly = ReceiptRules.progress(status: "pending_payment", lines: [line("delivered"), line("shipped")])
        XCTAssertEqual(partly.kind, "partlyDelivered")
        XCTAssertEqual(partly.delivered, 1)
        XCTAssertEqual(partly.of, 2)
        let early = Date(timeIntervalSince1970: 1_759_665_600)
        let late = early.addingTimeInterval(86_400)
        let delivered = ReceiptRules.progress(status: "paid", lines: [line("delivered", at: late), line("delivered", at: early)])
        XCTAssertEqual(delivered.kind, "delivered")
        XCTAssertEqual(delivered.at, ISO8601.withFraction.string(from: late))
        XCTAssertEqual(ReceiptRules.progress(status: "paid", lines: [line("delivered"), line("cancelled")]).kind, "delivered")
        XCTAssertEqual(ReceiptRules.progress(status: "pending_payment", lines: [line("cancelled"), line("shipped")]).kind, "onTheWay")
        XCTAssertEqual(ReceiptRules.progress(status: "pending_payment", lines: [line("cancelled"), line("cancelled")]).kind, "cancelled")
        XCTAssertEqual(ReceiptRules.progress(status: "cancelled", lines: [line("pending")]).kind, "cancelled")
        XCTAssertEqual(ReceiptRules.progress(status: "pending_payment", lines: []).kind, "cancelled")
        XCTAssertEqual(ReceiptRules.progress(status: "refunded", lines: [line("returned"), line("cancelled")]).kind, "returned")
        XCTAssertEqual(ReceiptRules.progress(status: "paid", lines: [line("returned"), line("delivered")]).kind, "delivered")
    }

    // MARK: The receipt's sum

    func testAPlainOrderPrintsTheGoodsDeliveryAndTotal() {
        XCTAssertEqual(ReceiptRules.rows(plain, tax: nil), [
            .init(kind: .subtotal, amount: money("39.900")),
            .init(kind: .delivery, amount: money("1.500")),
            .init(kind: .total, amount: money("41.400"), strong: true),
        ])
    }

    func testFreeDeliveryIsSaidRatherThanLeftOut() {
        var free = plain
        free.deliveryTotal = .zero
        free.grandTotal = money("39.900")
        XCTAssertEqual(ReceiptRules.rows(free, tax: nil)[1], .init(kind: .delivery, amount: .zero, free: true))
    }

    func testTheTillsOrderIsKept() {
        var full = plain
        full.discountCode = "SAVE5"
        full.discountValue = money("2.000")
        full.pointsSpent = 1500
        full.pointsValue = money("1.500")
        full.giftCardCode = "GIFT-ABCD-9F2K"
        full.giftCardValue = money("5.000")
        full.grandTotal = money("34.895")
        let rows = ReceiptRules.rows(full, tax: (amount: money("1.995"), rate: "5"))
        XCTAssertEqual(rows.map(\.kind), [.subtotal, .delivery, .tax, .discount, .points, .giftCard, .total])
        XCTAssertEqual(rows[2].params, ["rate": "5"])
        XCTAssertEqual(rows[3].params, ["code": "SAVE5"])
        XCTAssertTrue(rows[3].minus)
        XCTAssertEqual(rows[4].params, ["points": "1500"])
        // The card's code is a bearer value: only its last four characters.
        XCTAssertEqual(rows[5].params, ["code": "•••• 9F2K"])
    }

    func testNothingTakenAndNoTaxAreNotPrinted() {
        XCTAssertEqual(ReceiptRules.rows(plain, tax: (amount: .zero, rate: "5")).map(\.kind), [.subtotal, .delivery, .total])
    }

    func testHowItStandsWithTheMoney() {
        let total = money("41.400")
        XCTAssertEqual(ReceiptRules.payment(status: "paid", paymentMethod: "cod", grandTotal: total, owedNow: .zero), .paid)
        XCTAssertEqual(ReceiptRules.payment(status: "refunded", paymentMethod: "cod", grandTotal: total, owedNow: total), .refunded)
        XCTAssertEqual(ReceiptRules.payment(status: "cancelled", paymentMethod: "cod", grandTotal: total, owedNow: total), .cancelled)
        XCTAssertEqual(ReceiptRules.payment(status: "pending_payment", paymentMethod: "cod", grandTotal: total, owedNow: total), .onDelivery(amount: total, reduced: false))
        XCTAssertEqual(ReceiptRules.payment(status: "pending_payment", paymentMethod: "cod", grandTotal: total, owedNow: money("30.000")), .onDelivery(amount: money("30.000"), reduced: true))
        XCTAssertEqual(ReceiptRules.payment(status: "pending_payment", paymentMethod: "cod", grandTotal: total, owedNow: .zero), .nothingDue)
        XCTAssertEqual(ReceiptRules.payment(status: "pending_payment", paymentMethod: "knet", grandTotal: total, owedNow: total), .paidOnline)
    }

    func testTheMethodTheMaskAndTheFileName() {
        XCTAssertEqual(ReceiptRules.method("cod"), .cod)
        XCTAssertEqual(ReceiptRules.method(nil), .cod)
        XCTAssertEqual(ReceiptRules.method("knet"), .knet)
        XCTAssertEqual(ReceiptRules.method("card"), .card)
        XCTAssertEqual(ReceiptRules.method("apple_pay"), .applePay)
        XCTAssertEqual(ReceiptRules.maskedCardCode("AB"), "AB")
        XCTAssertEqual(ReceiptRules.maskedCardCode("GIFT-1234"), "•••• 1234")
        XCTAssertEqual(ReceiptRules.fileName("NL-20261012-3NJA9"), "NetLet-receipt-NL-20261012-3NJA9.pdf")
        XCTAssertEqual(ReceiptRules.fileName("NL/../x"), "NetLet-receipt-NLx.pdf")
    }

    // MARK: The receipt drawn

    @MainActor
    func testARecordedOrderIsDrawnIntoAOnePagePDF() async throws {
        let read = try await Fixtures.client.call(API.order, .init(reference: "NL-20261001-J7MWY"))
        let detail = try XCTUnwrap(read)
        for language in [Language.en, Language.ar] {
            let settings = LanguageSettings(defaults: UserDefaults(suiteName: "OrderReceiptTests-\(language.rawValue)")!)
            settings.set(language)
            let words = ReceiptWords.make(detail, language: settings)
            XCTAssertEqual(words.rightToLeft, language == .ar)
            XCTAssertEqual(words.items.count, detail.lines.count)
            XCTAssertEqual(words.facts.count, 4)
            XCTAssertTrue(words.sums.last?.strong == true)
            XCTAssertEqual(words.sums.last?.amount, detail.order.grandTotal.formatted(language))
            XCTAssertFalse(words.title.contains("receipt."), "a key left unread: \(words.title)")
            XCTAssertEqual(words.fileName, "NetLet-receipt-NL-20261001-J7MWY.pdf")

            let url = try XCTUnwrap(OrderReceiptPDF.write(words))
            XCTAssertEqual(url.lastPathComponent, words.fileName)
            let pdf = try XCTUnwrap(PDFDocument(url: url))
            XCTAssertEqual(pdf.pageCount, 1)
            let page = try XCTUnwrap(pdf.page(at: 0))
            let box = page.bounds(for: .mediaBox)
            XCTAssertEqual(box.width, ReceiptPage.width, accuracy: 1)
            XCTAssertGreaterThan(box.height, 400)
            // Its words are words: the order's number can be found in it.
            XCTAssertTrue((pdf.string ?? "").contains("J7MWY"), "the order's number is not in the PDF's text")
            if language == .en {
                XCTAssertTrue((pdf.string ?? "").contains("Order receipt"))
            }
        }
    }
}
