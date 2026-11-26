import XCTest
@testable import NetLet

/// An application whose papers could not be read says so: every paper
/// offered "Upload", as though nothing had been sent.
@MainActor
final class ApplicationDocumentsFailedTests: XCTestCase {
    /// A draft application; its papers fail, or answer `papers`.
    private struct ApplicationAPI: APICalling {
        let papers: [ApplicationDocument]?

        func call<Input, Output>(_ procedure: Procedure<Input, Output>, _ input: Input) async throws -> Output {
            throw APIError.offline
        }

        func call<Output>(_ procedure: Procedure<NoInput, Output>) async throws -> Output {
            switch procedure.path {
            case "inventory.applications.mine":
                let row: StoreApplication? = StoreApplication(
                    id: 1, storeName: "Noura's", storeNameAr: nil, contactEmail: nil, contactPhone: nil,
                    governorate: nil, addressLine: nil, licenceNumber: nil, licenceDocUrl: nil, identityDocUrl: nil,
                    payoutIban: nil, underPlatformLicence: false, proposedCommissionPercent: nil,
                    proposedCommissionFixed: nil, commissionNote: nil, agreementVersion: nil, status: "draft",
                    rejectionReason: nil, updatedAt: Date()
                )
                guard let answer = row as? Output else { throw APIError.offline }
                return answer
            case "inventory.applications.myDocuments":
                guard let papers, let answer = papers as? Output else { throw APIError.offline }
                return answer
            default:
                throw APIError.offline
            }
        }
    }

    private func model(_ papers: [ApplicationDocument]?) -> ApplicationModel {
        ApplicationModel(api: ApplicationAPI(papers: papers), seller: SellerService(client: Fixtures.client))
    }

    func testPapersThatCouldNotBeReadAreNotNoneSent() async {
        let application = model(nil)
        await application.load()
        XCTAssertNotNil(application.application.value ?? nil)
        XCTAssertTrue(application.documentsUnread, "Every paper would offer “Upload”.")
    }

    func testPapersReadAreDrawn() async {
        let application = model([])
        await application.load()
        XCTAssertFalse(application.documentsUnread)
    }
}
