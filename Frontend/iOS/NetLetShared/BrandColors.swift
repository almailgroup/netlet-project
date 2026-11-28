import SwiftUI
import UIKit

// The app's and the widgets' one palette: this folder (`NetLetShared/`) is
// compiled into the app and into its widget extension (`NetLetWidgets/`),
// so the Lock Screen, the Dynamic Island and the home screen widget wear the
// shop's own colours. Nothing here may reach for what an extension cannot
// use (`UIApplication.shared`, the app's models).

/// NetLet's palette, the web's own values (`index.css` and the components):
/// navy, the brand orange as a fill, and the page's near-white ground. The
/// orange is never used for words — on white it is 3.08:1 — so words that
/// would be orange use `accentInk` instead, and words on it are navy.
///
/// **Every colour has a dark-mode value, on the owner's word** ("dark mode",
/// option 9 of the list), resolved by the view's own colour scheme. Navy is
/// three colours in the dark: words in navy (`navy`) **turn white, on the
/// owner's word** ("for dark mode, all the text should be white color, not
/// blue" — they were a light periwinkle, #8fb3f4, for one build); a navy
/// *fill* under white words (`navyFill`) stays a deep blue the white still
/// reads on; and a switch's track or a calendar's chosen day (`control`) is a
/// brighter blue, since a white track under a white knob is no switch at all —
/// light, all three are the same navy. What must stay navy in either mode —
/// the Lock Screen's card, words on the orange, words and rims drawn on a
/// photograph's white frame — is `deepNavy`. A product photograph keeps its
/// white frame in the dark, the way it was taken (`photoFrame`).
enum Brand {
    /// Navy words and marks: white in the dark, never a blue.
    static let navy = Color(light: 0x0A285A, dark: 0xFFFFFF)
    /// Navy as a surface under white words: a button, a chosen chip, a band.
    static let navyFill = Color(light: 0x0A285A, dark: 0x2B57AB)
    static let navyPressed = Color(light: 0x0D3372, dark: 0x244A93)
    /// A system control's colour — a switch's track, the chosen day of a
    /// calendar — which sits under a white knob or white digits: navy, and a
    /// blue in the dark that white keeps 5.1:1 on (`navy` would be white on
    /// white there). Every `Toggle` takes it through `NetLetSwitchStyle`, and
    /// every `DatePicker` wears it by hand.
    static let control = Color(light: 0x0A285A, dark: 0x3D6BC4)
    /// The brand's navy in either mode: the Lock Screen's card and widget,
    /// words on the orange (4.65:1).
    static let deepNavy = Color(red: 10 / 255, green: 40 / 255, blue: 90 / 255)
    static let orange = Color(red: 242 / 255, green: 104 / 255, blue: 58 / 255)
    static let pearl = Color(light: 0xF3F2ED, dark: 0x121722)
    /// The page's own background, `--background` (#fafafa).
    static let ground = Color(light: 0xFAFAFA, dark: 0x0E121B)
    /// A card, a sheet, a row: white, and a raised dark slate in dark mode.
    static let surface = Color(light: 0xFFFFFF, dark: 0x171C27)
    /// What a product photograph is fitted on: white in either mode.
    static let photoFrame = Color.white
    static let ink = Color(light: 0x1F2229, dark: 0xE8ECF3)
    /// Body copy under a heading (#404553).
    static let body = Color(light: 0x404553, dark: 0xC4CBD7)
    /// Quieter words: a navy-grey, and in the dark a plain grey with no blue
    /// in it (#a8aeb8, 7.5:1 on the dark card), the owner's "not blue".
    static let muted = Color(light: 0x536B8C, dark: 0xA8AEB8)
    static let accentInk = Color(light: 0xA44A2B, dark: 0xFFAA85)
    /// The pale orange an icon in the accent ink sits on (#fdf3ee).
    static let accentWash = Color(light: 0xFDF3EE, dark: 0x3A2219)
    /// The rim of a card on that pale orange (#f0d3c6): the bag's reminder.
    static let accentLine = Color(light: 0xF0D3C6, dark: 0x5C3526)
    /// The orange's words over navy, where darkening it would make it worse.
    static let accentOnDark = Color(red: 255 / 255, green: 171 / 255, blue: 133 / 255)
    static let success = Color(light: 0x2F5D33, dark: 0x7CCB86)
    static let successFill = Color(light: 0xE3EFE4, dark: 0x183223)
    /// The refurbished section's green — its badge, its note — the web's
    /// `#1f4d36` on `#e3f1e8` (9.6:1) and `#f1f8f4` for a note's ground.
    static let renewed = Color(light: 0x1F4D36, dark: 0x8ED3AD)
    static let renewedFill = Color(light: 0xE3F1E8, dark: 0x163428)
    static let renewedWash = Color(light: 0xF1F8F4, dark: 0x102219)
    static let danger = Color(light: 0x8C2F22, dark: 0xFF8E7E)
    /// The shop's red made deep enough to read straight on the floating glass
    /// (#7f1d1d, 4.8:1 over black behind an even 70% tint, where `danger` is 3.9).
    static let dangerOnGlass = Color(light: 0x7F1D1D, dark: 0xFFB1A6)
    /// NetLet's test payment page (0086): its note's words, ground and dashed rim
    /// (#6b4a12 on #fff8eb, 8.3:1; #e4b363).
    static let testInk = Color(light: 0x6B4A12, dark: 0xF0CD8A)
    static let testWash = Color(light: 0xFFF8EB, dark: 0x2E2612)
    static let testRim = Color(light: 0xE4B363, dark: 0x8A6A2E)
    /// A field's or a panel's rim (#d5dfeb).
    static let line = Color(light: 0xD5DFEB, dark: 0x364056)
    /// A card's rim, `CARD` (#e6e9ef).
    static let cardLine = Color(light: 0xE6E9EF, dark: 0x2A3245)
    /// The pale navy an icon sits on (#eef2f8).
    static let tint = Color(light: 0xEEF2F8, dark: 0x1E2A40)
    /// Behind a product photograph (#f4f6f9), in either mode: the photo is
    /// on white, and what stands in for it while it comes is nearly white.
    static let photo = Color(red: 244 / 255, green: 246 / 255, blue: 249 / 255)
    /// A grey well a panel or a chip sits in (#f4f6f9) — `photo`'s grey, which
    /// stays nearly white for a photograph, made dark in dark mode.
    static let well = Color(light: 0xF4F6F9, dark: 0x202736)
    /// The glass's face over its blur: white, and in dark mode a deep slate
    /// over the dark blur, so the words on it keep their contrast either way.
    static let glassFace = Color(light: 0xFFFFFF, dark: 0x141925)
    /// The light along the glass's edges: white, and a muted slate line in
    /// dark mode, where white would draw a bright hairline.
    static let glassRim = Color(light: 0xFFFFFF, dark: 0x56627A)
    /// What a raised thing casts: navy in the light, black in the dark, where a
    /// navy shadow would be a glow.
    static let shadow = Color(light: 0x0A285A, dark: 0x000000)
    /// The hover and press fill on white (#f0f2f5).
    static let pressFill = Color(light: 0xF0F2F5, dark: 0x232C3D)
    static let star = Color(red: 255 / 255, green: 184 / 255, blue: 0 / 255)
    /// The stars a score does not reach (#dfe3ea), the web's `StarRow`.
    static let starEmpty = Color(light: 0xDFE3EA, dark: 0x3A4357)
    static let chevron = Color(light: 0x8AA0BD, dark: 0x6F809B)
    /// A box a dropped pin filled (`.from-pin`): pale orange until it is changed (#fff6f0).
    static let fromPin = Color(light: 0xFFF6F0, dark: 0x3A2419)
    /// That box's rim (#f0b391).
    static let fromPinRim = Color(light: 0xF0B391, dark: 0x8A5236)
    /// The words of the line saying the pin filled them (#7a3a1f).
    static let fromPinInk = Color(light: 0x7A3A1F, dark: 0xFFB894)
}

extension Color {
    /// One colour for light mode and another for dark, resolved by the
    /// view's own colour scheme (a sheet's, a widget's, the Lock Screen's).
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}
