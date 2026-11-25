import XCTest
@testable import NetLet

/// The seller's mini tutorials for adding products: the website's scenes,
/// exported to `sellerTutorials.json`, and its clock in Swift, on
/// `sellerTutorials.test.ts`'s own cases.
final class SellerTutorialTests: XCTestCase {
    func testTheTenTutorialsArriveInTheWebsitesOrder() {
        XCTAssertEqual(SellerTutorial.all.map(\.id), ["generate", "basics", "photos", "price", "extras", "description", "search", "publish", "variants", "import"])
        for tutorial in SellerTutorial.all {
            XCTAssertFalse(tutorial.scenes.isEmpty, tutorial.id)
            XCTAssertLessThanOrEqual(tutorial.scenes.count, 4, tutorial.id)
        }
        XCTAssertEqual(SellerTutorial.File.shared.motionLimit, 4600)
        XCTAssertEqual(SellerTutorial.File.shared.settle, 400)
    }

    func testEveryWordIsOneTheAppCanSay() {
        for tutorial in SellerTutorial.all {
            XCTAssertTrue(Phrasebook.shared.has(tutorial.title), tutorial.title)
            for scene in tutorial.scenes {
                for words in [scene.caption] + scene.parts.flatMap(\.words) {
                    for key in words.keys { XCTAssertTrue(Phrasebook.shared.has(key), "\(tutorial.id): \(key)") }
                    if case .department(let slug) = words.kind {
                        XCTAssertNotNil(ReferenceData.shared.department(slug: slug), slug)
                    }
                }
            }
        }
    }

    @MainActor
    func testNoSceneMovesForMoreThanFiveSecondsInEitherLanguage() {
        for language in [Language.en, Language.ar] {
            let settings = LanguageSettings(defaults: UserDefaults(suiteName: "SellerTutorialTests-\(language.rawValue)")!)
            settings.set(language)
            for tutorial in SellerTutorial.all {
                for (index, scene) in tutorial.scenes.enumerated() {
                    let end = TutorialClock.sceneEnd(scene) { words in words.text(settings).unicodeScalars.count }
                    XCTAssertLessThanOrEqual(end, TutorialClock.motionLimit, "\(language) \(tutorial.id) \(index + 1)")
                    let text = scene.caption.text(settings)
                    XCTAssertFalse(text.contains("{"), "a placeholder left unfilled: \(text)")
                    XCTAssertFalse(text.hasPrefix("howTo."), "a key left unread: \(text)")
                }
            }
        }
    }

    func testPhotosReadEveryDropAndTheOthersOneTime() throws {
        let photos = try XCTUnwrap(SellerTutorial.named("photos"))
        let part = try XCTUnwrap(photos.scenes.flatMap(\.parts).first { $0.kind == "photos" })
        XCTAssertGreaterThan(part.times.count, 1)
        XCTAssertEqual(part.at, part.times.first)
        let status = try XCTUnwrap(SellerTutorial.named("publish")?.scenes.flatMap(\.parts).first { $0.kind == "status" })
        XCTAssertFalse(status.items.isEmpty)
    }

    // The clock, on the website's cases.

    func testTypingIsQuickForLongTextAndSlowForShort() {
        XCTAssertEqual(TutorialClock.msPerCharacter(0), 60)
        XCTAssertEqual(TutorialClock.msPerCharacter(10), 60)
        XCTAssertEqual(TutorialClock.msPerCharacter(25), 60)
        XCTAssertEqual(TutorialClock.msPerCharacter(30), 50)
        XCTAssertEqual(TutorialClock.msPerCharacter(50), 30)
        XCTAssertEqual(TutorialClock.msPerCharacter(100), 18)
    }

    func testACharacterArrivesAtTheStartAndTheRestOneStepAtATime() {
        XCTAssertEqual(TutorialClock.typedCount(16, at: 300, t: 0), 0)
        XCTAssertEqual(TutorialClock.typedCount(16, at: 300, t: 299), 0)
        XCTAssertEqual(TutorialClock.typedCount(16, at: 300, t: 300), 1)
        XCTAssertEqual(TutorialClock.typedCount(16, at: 300, t: 359), 1)
        XCTAssertEqual(TutorialClock.typedCount(16, at: 300, t: 360), 2)
        XCTAssertEqual(TutorialClock.typedCount(16, at: 300, t: 5000), 16)
        XCTAssertEqual(TutorialClock.typedCount(50, at: 0, t: 300), 11)
        // Reduce Motion draws the last frame: the whole text at once.
        XCTAssertEqual(TutorialClock.typedCount(16, at: 300, t: .infinity), 16)
    }

    func testASettleCountsFromNothingToWholeAndHolds() {
        XCTAssertEqual(TutorialClock.progress(1000, 900), 0)
        XCTAssertEqual(TutorialClock.progress(1000, 1000), 0)
        XCTAssertEqual(TutorialClock.progress(1000, 1200), 0.5)
        XCTAssertEqual(TutorialClock.progress(1000, 1400), 1)
        XCTAssertEqual(TutorialClock.progress(1000, 9000), 1)
        XCTAssertEqual(TutorialClock.progress(1000, 1250, span: 500), 0.5)
        XCTAssertEqual(TutorialClock.progress(1000, 999, span: 0), 0)
        XCTAssertEqual(TutorialClock.progress(1000, 1000, span: 0), 1)
        XCTAssertEqual(TutorialClock.progress(1000, .infinity), 1)
    }

    func testTheLatestStatusThatHasArrivedIsShown() {
        XCTAssertEqual(TutorialClock.statusAt([0, 1100, 2600], 0), 0)
        XCTAssertEqual(TutorialClock.statusAt([0, 1100, 2600], 1099), 0)
        XCTAssertEqual(TutorialClock.statusAt([0, 1100, 2600], 1100), 1)
        XCTAssertEqual(TutorialClock.statusAt([0, 1100, 2600], 4000), 2)
        XCTAssertEqual(TutorialClock.statusAt([1200], 0), 0)
    }

    func testASceneEndsWhenItsLastPartHasSettled() throws {
        let decoder = JSONDecoder()
        let typed = try decoder.decode(TutorialScene.self, from: Data(#"""
            {"caption":{"raw":""},"parts":[
              {"kind":"field","label":{"raw":""},"value":{"raw":"abcdefghij"},"at":300},
              {"kind":"button","label":{"raw":""},"at":1500,"tone":"primary"}
            ]}
            """#.utf8))
        let length: (TutorialWords) -> Int = { words in
            if case .raw(let text) = words.kind { return text.unicodeScalars.count }
            return 0
        }
        XCTAssertEqual(TutorialClock.sceneEnd(typed, length: length), 1900)
        let dropped = try decoder.decode(TutorialScene.self, from: Data(#"{"caption":{"raw":""},"parts":[{"kind":"photos","at":[900,2100]}]}"#.utf8))
        XCTAssertEqual(TutorialClock.sceneEnd(dropped, length: length), 2500)
    }
}
