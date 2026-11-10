import UIKit
import XCTest
@testable import NetLet

/// The photo fixes (`PhotoFixer`) on the shared rule's own cases
/// (`Shared/commerce/media.test.ts`), so a photo added from the phone is
/// trimmed, squared and levelled by the rule the website applies — and then
/// one whole picture through `prepare`, fixed and as taken.
final class PhotoFixerTests: XCTestCase {
    /// A width × height RGBA frame of one colour with a coloured block inside.
    private func frame(_ width: Int, _ height: Int, background: [UInt8], block: (x: Int, y: Int, w: Int, h: Int, colour: [UInt8])? = nil) -> [UInt8] {
        var data = [UInt8](repeating: 255, count: width * height * 4)
        for y in 0..<height {
            for x in 0..<width {
                var colour = background
                if let block, x >= block.x, x < block.x + block.w, y >= block.y, y < block.y + block.h { colour = block.colour }
                let i = (y * width + x) * 4
                data[i] = colour[0]
                data[i + 1] = colour[1]
                data[i + 2] = colour[2]
            }
        }
        return data
    }

    func testFindsAUniformBackgroundAndTheProductInsideIt() throws {
        let data = frame(200, 100, background: [245, 245, 245], block: (120, 30, 40, 50, [40, 60, 90]))
        let background = try XCTUnwrap(PhotoFixer.uniformBackground(data, width: 200, height: 100))
        XCTAssertEqual(background, PhotoFixer.Rgb(r: 245, g: 245, b: 245))
        let box = try XCTUnwrap(PhotoFixer.contentBox(data, width: 200, height: 100, background: background))
        XCTAssertEqual(box, PhotoFixer.Box(x: 119, y: 29, width: 42, height: 52))
        XCTAssertEqual(PhotoFixer.squareAround(box), 60)
    }

    func testClaimsNoBorderWhereTheCornersDisagree() {
        let data = frame(100, 100, background: [245, 245, 245], block: (0, 0, 30, 30, [20, 20, 20]))
        XCTAssertNil(PhotoFixer.uniformBackground(data, width: 100, height: 100))
    }

    func testFindsNothingInABlankFrame() {
        let data = frame(50, 50, background: [255, 255, 255])
        XCTAssertNil(PhotoFixer.contentBox(data, width: 50, height: 50, background: PhotoFixer.Rgb(r: 255, g: 255, b: 255)))
    }

    func testStretchesAFlatPhotoGentlyAndLeavesAFullRangeOneAlone() throws {
        var flat = [Int](repeating: 0, count: 256)
        for value in 60...190 { flat[value] = 10 }
        // Capped: the black point no higher than 40, the white no lower than 215.
        let capped = try XCTUnwrap(PhotoFixer.levels(for: flat, total: 131 * 10))
        XCTAssertEqual(capped.low, 40)
        XCTAssertEqual(capped.high, 215)
        var slightly = [Int](repeating: 0, count: 256)
        for value in 30...230 { slightly[value] = 10 }
        // Inside the caps the points are the measured ones, after the half-percent clip.
        let measured = try XCTUnwrap(PhotoFixer.levels(for: slightly, total: 201 * 10))
        XCTAssertEqual(measured.low, 31)
        XCTAssertEqual(measured.high, 229)
        XCTAssertNil(PhotoFixer.levels(for: [Int](repeating: 10, count: 256), total: 2560))
        let table = PhotoFixer.levelsTable(low: 60, high: 190)
        XCTAssertEqual([table[60], table[190], table[0], table[255]], [0, 255, 0, 255])
    }

    /// A product photographed off-centre on a pale sheet: a 1600 × 800 picture
    /// with a dark block to one side.
    private func photo() -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: CGSize(width: 1600, height: 800), format: format).image { context in
            UIColor(red: 245 / 255, green: 245 / 255, blue: 245 / 255, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 1600, height: 800))
            UIColor(red: 40 / 255, green: 60 / 255, blue: 90 / 255, alpha: 1).setFill()
            context.fill(CGRect(x: 960, y: 200, width: 320, height: 400))
        }
    }

    func testAPhotoIsTrimmedAndSquaredOnItsOwnBackground() throws {
        let fixed = try PhotoFixer.prepare(photo(), fix: true, minEdge: 300, maxEdge: 1200, maxBytes: 1_500_000)
        XCTAssertTrue(fixed.fixes.contains(.trimmed), "\(fixed.fixes)")
        XCTAssertTrue(fixed.fixes.contains(.squared), "\(fixed.fixes)")
        XCTAssertTrue(fixed.changed)
        XCTAssertEqual(fixed.width, fixed.height)
        // The block is 400 tall: its square, with the margin, is about 469.
        XCTAssertEqual(Double(fixed.width), 469, accuracy: 8)
        let image = try XCTUnwrap(UIImage(data: fixed.jpeg))
        XCTAssertEqual(Int(image.size.width * image.scale), fixed.width)
        XCTAssertLessThanOrEqual(fixed.jpeg.count, 1_500_000)
        // The product is in the middle of it now: dark at the centre, pale at the corner.
        let pixels = try XCTUnwrap(PhotoFixer.rgba(of: try XCTUnwrap(image.cgImage)))
        let centre = PhotoFixer.pixel(pixels, width: fixed.width, x: fixed.width / 2, y: fixed.height / 2)
        let corner = PhotoFixer.pixel(pixels, width: fixed.width, x: 4, y: 4)
        XCTAssertLessThan(centre.r, 110)
        XCTAssertGreaterThan(corner.r, 200)
    }

    func testAsTakenItIsOnlyMadeTheShopsSize() throws {
        let taken = try PhotoFixer.prepare(photo(), fix: false, minEdge: 300, maxEdge: 1200, maxBytes: 1_500_000)
        XCTAssertEqual(taken.fixes, [.resized])
        XCTAssertFalse(taken.changed)
        XCTAssertEqual(taken.width, 1200)
        XCTAssertEqual(taken.height, 600)
    }

    func testAPhotoTooSmallToLookSharpIsRefused() {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: CGSize(width: 200, height: 150), format: format).image { context in
            UIColor.gray.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 200, height: 150))
        }
        XCTAssertThrowsError(try PhotoFixer.prepare(small, fix: false, minEdge: 300, maxEdge: 1200, maxBytes: 1_500_000)) { error in
            XCTAssertEqual(error as? ImagePreparation.Problem, .tooSmall)
        }
    }

    func testAnInvitationCodeIsShapedAndKeptOnce() {
        let defaults = UserDefaults(suiteName: "invite-\(UUID().uuidString)")!
        XCTAssertTrue(InviteCode.isShaped("NLABCD"))
        XCTAssertTrue(InviteCode.isShaped(" nl12ab "))
        XCTAssertFalse(InviteCode.isShaped("N"))
        XCTAssertFalse(InviteCode.isShaped("NL AB"))
        XCTAssertFalse(InviteCode.isShaped("NL-AB"))
        XCTAssertFalse(InviteCode.isShaped(String(repeating: "A", count: 33)))
        InviteCode.keep("nlabcd", in: defaults)
        XCTAssertEqual(InviteCode.stored(in: defaults), "NLABCD")
        // A code that is not one changes nothing; an empty box forgets it.
        InviteCode.keep("not a code!", in: defaults)
        XCTAssertEqual(InviteCode.stored(in: defaults), "NLABCD")
        InviteCode.keep("  ", in: defaults)
        XCTAssertNil(InviteCode.stored(in: defaults))
        InviteCode.keep("NLXY", in: defaults)
        InviteCode.clear(in: defaults)
        XCTAssertNil(InviteCode.stored(in: defaults))
    }
}
