import UIKit
import XCTest

/// The app's glass is never greyer than what it sits on, and the words on a
/// floating bar keep 4.5:1 over the darkest thing that can pass under it.
///
/// It blurred through the system's `.ultraThinMaterial`, which pulls white
/// toward grey: off the CI's pictures the product page's header read 243 over
/// a page of 250, and the cart's floating bar darkened toward its foot. The
/// owner asked for the website's clean glass in the app too. This reads the
/// glass off a screenshot of `GlassProbe` — the header's glass, the light blur
/// alone and the floating bars' capsule over the page's ground and over black
/// — and says what each measured as a `TEST-NOTE`, so the face's figures can
/// be checked against the web's 60% and 45%.
final class GlassUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    func testTheGlassIsNeverGreyerThanThePageUnderIt() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-NetLetDemo", "YES", "-netlet.language", "en", "-NetLetUITest", "YES", "-NetLetOpen", "glassProbe"]
        app.launch()
        let last = mark(app, "probe-black-capsule")
        XCTAssertTrue(last.waitForExistence(timeout: 20), "The glass probe did not open.")
        // The blur draws a frame or two after the views are laid out.
        Thread.sleep(forTimeInterval: 2)
        let screen = try XCTUnwrap(Screen(XCUIScreen.main.screenshot().image, points: app.frame.size), "The screenshot could not be read.")

        var notes: [String] = []
        for swatch in ["ground", "black"] {
            // Read on each column's far side from the other, so no blur
            // reaches across the seam between the two swatches.
            func across(_ frame: CGRect, by inset: CGFloat) -> CGFloat {
                swatch == "ground" ? frame.minX + inset : frame.maxX - inset
            }
            let bare = screen.colour(at: centre(mark(app, "probe-\(swatch)-bare").frame))
            let bar = mark(app, "probe-\(swatch)-bar").frame
            let barTop = screen.colour(at: CGPoint(x: across(bar, by: 40), y: bar.minY + 5))
            let barFoot = screen.colour(at: CGPoint(x: across(bar, by: 40), y: bar.maxY - 5))
            let blurFrame = mark(app, "probe-\(swatch)-blur").frame
            let blur = screen.colour(at: CGPoint(x: across(blurFrame, by: 40), y: blurFrame.midY))
            let capsule = mark(app, "probe-\(swatch)-capsule").frame
            let capsuleTop = screen.colour(at: CGPoint(x: across(capsule, by: 40), y: capsule.minY + 10))
            let capsuleFoot = screen.colour(at: CGPoint(x: across(capsule, by: 40), y: capsule.maxY - 14))
            notes.append("\(swatch): bare \(bare) bar \(barTop)→\(barFoot) blur \(blur) capsule \(capsuleTop)→\(capsuleFoot)")

            if swatch == "ground" {
                for (name, glass) in [("header top", barTop), ("header foot", barFoot), ("capsule top", capsuleTop), ("capsule foot", capsuleFoot)] {
                    XCTAssertGreaterThanOrEqual(glass.darkest, bare.darkest - 1.5, "The \(name) glass is greyer (\(glass)) than the page under it (\(bare)).")
                }
            } else {
                // Over black, the glass's white is its value: what to compare
                // with the web's 60% and 45%, and the worst case for words.
                notes.append("black white: header \(percent(barTop))→\(percent(barFoot)) blur alone \(percent(blur)) capsule \(percent(capsuleTop))")
                for (name, ink) in [("ink", Colour(r: 31, g: 34, b: 41)), ("navy", Colour(r: 10, g: 40, b: 90))] {
                    for glass in [capsuleTop, capsuleFoot] {
                        XCTAssertGreaterThanOrEqual(contrast(ink, glass), 4.5, "The \(name) words on the floating bar fall under 4.5:1 over black (\(glass)).")
                    }
                }
            }
        }
        print("TEST-NOTE glass \(notes.joined(separator: " | "))")
    }

    private func mark(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func centre(_ frame: CGRect) -> CGPoint {
        CGPoint(x: frame.midX, y: frame.midY)
    }

    private func percent(_ colour: Colour) -> String {
        "\(Int((colour.mean / 255 * 100).rounded()))%"
    }

    /// WCAG's contrast ratio.
    private func contrast(_ a: Colour, _ b: Colour) -> Double {
        let (lighter, darker) = (max(a.luminance, b.luminance), min(a.luminance, b.luminance))
        return (lighter + 0.05) / (darker + 0.05)
    }
}

/// A colour read off the screen, 0 to 255 a channel.
private struct Colour: CustomStringConvertible {
    let r: Double, g: Double, b: Double

    var darkest: Double { min(r, g, b) }
    var mean: Double { (r + g + b) / 3 }

    var luminance: Double {
        func linear(_ value: Double) -> Double {
            let c = value / 255
            return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }

    var description: String { "\(Int(r.rounded())),\(Int(g.rounded())),\(Int(b.rounded()))" }
}

/// A screenshot's pixels, read in sRGB, top row first.
private struct Screen {
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

    /// The mean of a 5 × 5 patch of pixels round a point in points.
    func colour(at point: CGPoint) -> Colour {
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
        guard count > 0 else { return Colour(r: 0, g: 0, b: 0) }
        return Colour(r: sum.0 / count, g: sum.1 / count, b: sum.2 / count)
    }
}
