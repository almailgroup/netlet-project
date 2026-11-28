import SwiftUI
import UIKit
import XCTest
@testable import NetLet

/// What the dark pictures showed: the header's logo had navy letters on the
/// dark ground, nearly invisible, and two of the portal's chart lines were
/// under 3:1 on the dark card. Both are read here off what the app draws.
final class DarkModeTests: XCTestCase {
    /// The header's logo on a dark page has light letters, and on a light
    /// page dark ones — measured on the letters (the opaque, uncoloured
    /// pixels), not the orange roof, which is the same in both.
    func testTheHeaderLogoHasLightLettersOnADarkPage() throws {
        let dark = try XCTUnwrap(WebAssets.headerLogo(.dark), "No logo for a dark page.")
        let light = try XCTUnwrap(WebAssets.headerLogo(.light), "No logo for a light page.")
        let onDark = try XCTUnwrap(letterLuminance(dark))
        let onLight = try XCTUnwrap(letterLuminance(light))
        XCTAssertGreaterThan(onDark, 0.7, "The dark page's logo letters are not light (\(onDark)).")
        XCTAssertLessThan(onLight, 0.3, "The light page's logo letters are not dark (\(onLight)).")
        // And the two are as wide as each other, so the row does not move.
        XCTAssertEqual(dark.size, light.size)
    }

    /// Every chart colour, as the portal draws it in dark mode, stands out
    /// at 3:1 on the dark card and on the dark ground; and in light mode the
    /// colours are the validated light set, unchanged.
    func testEveryChartColourStandsOutOnTheDarkCard() {
        let darkTraits = UITraitCollection(userInterfaceStyle: .dark)
        let lightTraits = UITraitCollection(userInterfaceStyle: .light)
        let card = UIColor(hex: 0x171C27)
        let ground = UIColor(hex: 0x0E121B)
        XCTAssertEqual(PortalLook.series.count, 6)
        for (index, colour) in PortalLook.series.enumerated() {
            let inDark = UIColor(colour).resolvedColor(with: darkTraits)
            XCTAssertGreaterThanOrEqual(contrast(inDark, card), 3, "Series \(index) is \(contrast(inDark, card)):1 on the dark card.")
            XCTAssertGreaterThanOrEqual(contrast(inDark, ground), 3, "Series \(index) is \(contrast(inDark, ground)):1 on the dark ground.")
            let inLight = UIColor(colour).resolvedColor(with: lightTraits)
            XCTAssertEqual(hex(inLight), PortalLook.seriesLight[index], "Series \(index) changed in light mode.")
        }
    }

    /// Words in navy are white in the dark, on the owner's word ("all the
    /// text should be white color, not blue") — they were a periwinkle,
    /// #8fb3f4 — and stay the brand's navy in the light. A switch's track and
    /// a calendar's chosen day are the one place navy stays a blue in the
    /// dark (`Brand.control`), since they sit under white: white keeps 4.5:1
    /// on it, and it is never white itself. The quieter words lean no bluer
    /// than a few steps, so nothing on a dark page reads blue.
    func testNavyWordsAreWhiteInTheDark() {
        let darkTraits = UITraitCollection(userInterfaceStyle: .dark)
        let lightTraits = UITraitCollection(userInterfaceStyle: .light)
        XCTAssertEqual(hex(UIColor(Brand.navy).resolvedColor(with: darkTraits)), 0xFFFFFF, "Navy words are not white in the dark.")
        XCTAssertEqual(hex(UIColor(Brand.navy).resolvedColor(with: lightTraits)), 0x0A285A, "Navy words changed in the light.")
        XCTAssertEqual(hex(UIColor(PortalLook.indigoInk).resolvedColor(with: darkTraits)), 0xFFFFFF, "The indigo series' words are not white in the dark.")
        let control = UIColor(Brand.control).resolvedColor(with: darkTraits)
        XCTAssertNotEqual(hex(control), 0xFFFFFF, "A switch's track is white under its white knob.")
        XCTAssertGreaterThanOrEqual(contrast(.white, control), 4.5, "White is \(contrast(.white, control)):1 on a control in the dark.")
        XCTAssertEqual(hex(UIColor(Brand.control).resolvedColor(with: lightTraits)), 0x0A285A)
        let (r, _, b) = components(UIColor(Brand.muted).resolvedColor(with: darkTraits))
        XCTAssertLessThanOrEqual((b - r) * 255, 16, "Quieter words lean blue in the dark.")
        XCTAssertGreaterThanOrEqual(contrast(UIColor(Brand.muted).resolvedColor(with: darkTraits), UIColor(hex: 0x171C27)), 4.5)
    }

    // MARK: - Measuring

    /// The mean luminance (0…1) of the logo's letters: its opaque pixels
    /// whose channels are close together, which leaves the orange roof out.
    private func letterLuminance(_ image: UIImage) -> Double? {
        guard let cg = image.cgImage, let space = CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
        let width = cg.width, height = cg.height
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = data.withUnsafeMutableBytes { raw -> Bool in
            guard let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return nil }
        var sum = 0.0, count = 0.0
        for i in stride(from: 0, to: data.count, by: 4) {
            let a = Double(data[i + 3])
            guard a > 230 else { continue }
            let r = Double(data[i]), g = Double(data[i + 1]), b = Double(data[i + 2])
            guard max(r, g, b) - min(r, g, b) < 90 || b > r else { continue }
            sum += luminance(r / 255, g / 255, b / 255)
            count += 1
        }
        return count > 0 ? sum / count : nil
    }

    private func luminance(_ r: Double, _ g: Double, _ b: Double) -> Double {
        func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }

    private func components(_ colour: UIColor) -> (Double, Double, Double) {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        colour.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b))
    }

    private func contrast(_ one: UIColor, _ two: UIColor) -> Double {
        let a = components(one), b = components(two)
        let la = luminance(a.0, a.1, a.2), lb = luminance(b.0, b.1, b.2)
        let ratio = (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
        return (ratio * 100).rounded() / 100
    }

    private func hex(_ colour: UIColor) -> UInt32 {
        let (r, g, b) = components(colour)
        func byte(_ c: Double) -> UInt32 { UInt32((c * 255).rounded()) }
        return byte(r) << 16 | byte(g) << 8 | byte(b)
    }
}
