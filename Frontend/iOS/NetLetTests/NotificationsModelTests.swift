import XCTest
@testable import NetLet

/// The email switch is the shopper's own setting or none: it was drawn on
/// (the model's default) whenever the setting had not come back, over a
/// shopper who had turned email off.
@MainActor
final class NotificationsModelTests: XCTestCase {
    /// NetLet sends email; the shopper's setting answers `emailAnswer`, or
    /// fails when it is nil. Everything else is offline.
    private struct EmailAPI: APICalling {
        let emailAnswer: Bool?

        func call<Input, Output>(_ procedure: Procedure<Input, Output>, _ input: Input) async throws -> Output {
            throw APIError.offline
        }

        func call<Output>(_ procedure: Procedure<NoInput, Output>) async throws -> Output {
            switch procedure.path {
            case "notifications.channels":
                guard let answer = NoticeChannels(email: true) as? Output else { throw APIError.offline }
                return answer
            case "notifications.email":
                guard let emailAnswer, let answer = emailAnswer as? Output else { throw APIError.offline }
                return answer
            default:
                throw APIError.offline
            }
        }
    }

    func testASettingThatCouldNotBeReadIsNotDrawnOn() async {
        let model = NotificationsModel(api: EmailAPI(emailAnswer: nil))
        await model.load()
        XCTAssertTrue(model.emailOffered)
        XCTAssertFalse(model.emailRead, "A switch was drawn over a setting nobody read.")
        XCTAssertTrue(model.emailUnread)
    }

    func testTheShoppersOwnSettingIsDrawn() async {
        let model = NotificationsModel(api: EmailAPI(emailAnswer: false))
        await model.load()
        XCTAssertTrue(model.emailRead)
        XCTAssertFalse(model.email)
        XCTAssertFalse(model.emailUnread)
    }
}
