import UIKit
import XCTest

/// Dark mode is a choice in Preferences (`AppearanceCard`): Light, Dark, or
/// as the phone is. It starts Light, pressing Dark turns the page dark at
/// once, and pressing Light turns it back — read off the screenshot's own
/// pixels, the page's ground beside the cards, so a colour that did not
/// follow the choice fails here rather than in a picture nobody opened.
///
/// A UI test launch forgets any choice an earlier test left (`NetLetApp`), so
/// a test that presses Dark changes only its own launch.
final class AppearanceUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testDarkFromPreferencesTurnsThePageDarkAndLightTurnsItBack() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES",
                               "-NetLetOpen", "section:preferences", "-NetLetDemoAs", "shopper"]
        app.launch()

        let light = app.buttons["appearance-light"]
        let dark = app.buttons["appearance-dark"]
        XCTAssertTrue(light.waitForExistence(timeout: 20), "Preferences has no Appearance choice.")
        var swipes = 0
        while !(dark.isHittable && dark.frame.maxY < app.frame.height - 120) && swipes < 8 {
            app.swipeUp(velocity: .slow)
            swipes += 1
        }
        XCTAssertTrue(dark.isHittable, "The Dark choice could not be reached.")
        XCTAssertTrue(light.isSelected, "A new install does not start Light.")

        let before = try ground(app)
        XCTAssertGreaterThan(before.mean, 200, "The page is not light before Dark is pressed (\(before)).")

        dark.tap()
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(dark.isSelected, "Dark does not read as chosen once pressed.")
        let darkGround = try ground(app)
        XCTAssertLessThan(darkGround.mean, 60, "Pressing Dark left the page light (\(darkGround)).")

        light.tap()
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(light.isSelected, "Light does not read as chosen once pressed again.")
        let after = try ground(app)
        XCTAssertGreaterThan(after.mean, 200, "Pressing Light did not turn the page back (\(after)).")
        print("TEST-NOTE appearance ground light \(before) dark \(darkGround) light again \(after)")
    }

    /// The page's ground at the screen's start edge, half way down, where no
    /// card reaches (the cards keep a 16-point margin).
    private func ground(_ app: XCUIApplication) throws -> Pixel {
        let image = XCUIScreen.main.screenshot().image
        let read = try XCTUnwrap(PixelReader(image, points: app.frame.size), "The screenshot could not be read.")
        return read.mean(at: CGPoint(x: 5, y: app.frame.height * 0.5))
    }
}

/// A colour off the screen, 0 to 255 a channel.
private struct Pixel: CustomStringConvertible {
    let r: Double, g: Double, b: Double
    var mean: Double { (r + g + b) / 3 }
    var description: String { "\(Int(r.rounded())),\(Int(g.rounded())),\(Int(b.rounded()))" }
}

/// A screenshot's pixels in sRGB, top row first.
private struct PixelReader {
    let width: Int
    let height: Int
    let scale: CGFloat
    let pixels: [UInt8]

    init?(_ image: UIImage, points: CGSize) {
        guard let cg = image.cgImage, points.width > 0, let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let width = cg.width
        let height = cg.height
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = data.withUnsafeMutableBytes { raw -> Bool in
            guard let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        self.width = width
        self.height = height
        self.scale = CGFloat(width) / points.width
        self.pixels = data
    }

    /// The mean of a 5 × 5 patch round a point in points.
    func mean(at point: CGPoint) -> Pixel {
        let cx = Int(point.x * scale)
        let cy = Int(point.y * scale)
        var sum = (0.0, 0.0, 0.0)
        var count = 0.0
        for y in (cy - 2)...(cy + 2) where y >= 0 && y < height {
            for x in (cx - 2)...(cx + 2) where x >= 0 && x < width {
                let i = (y * width + x) * 4
                sum.0 += Double(pixels[i])
                sum.1 += Double(pixels[i + 1])
                sum.2 += Double(pixels[i + 2])
                count += 1
            }
        }
        guard count > 0 else { return Pixel(r: 0, g: 0, b: 0) }
        return Pixel(r: sum.0 / count, g: sum.1 / count, b: sum.2 / count)
    }
}
