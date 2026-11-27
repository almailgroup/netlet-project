import SwiftUI

// The app's and the widgets' one palette: this folder (`NetLetShared/`) is
// compiled into the app and into its widget extension (`NetLetWidgets/`),
// so the Lock Screen, the Dynamic Island and the home screen widget wear the
// shop's own colours. Nothing here may reach for what an extension cannot
// use (`UIApplication.shared`, the app's models).

/// NetLet's palette, the web's own values (`index.css` and the components):
/// navy, the brand orange as a fill, and the page's near-white ground. The
/// orange is never used for words — on white it is 3.08:1 — so words that
/// would be orange use `accentInk` instead, and words on it are navy.
enum Brand {
    static let navy = Color(red: 10 / 255, green: 40 / 255, blue: 90 / 255)
    static let navyPressed = Color(red: 13 / 255, green: 51 / 255, blue: 114 / 255)
    static let orange = Color(red: 242 / 255, green: 104 / 255, blue: 58 / 255)
    static let pearl = Color(red: 243 / 255, green: 242 / 255, blue: 237 / 255)
    /// The page's own background, `--background` (#fafafa).
    static let ground = Color(red: 250 / 255, green: 250 / 255, blue: 250 / 255)
    static let ink = Color(red: 31 / 255, green: 34 / 255, blue: 41 / 255)
    /// Body copy under a heading (#404553).
    static let body = Color(red: 64 / 255, green: 69 / 255, blue: 83 / 255)
    static let muted = Color(red: 83 / 255, green: 107 / 255, blue: 140 / 255)
    static let accentInk = Color(red: 164 / 255, green: 74 / 255, blue: 43 / 255)
    /// The pale orange an icon in the accent ink sits on (#fdf3ee).
    static let accentWash = Color(red: 253 / 255, green: 243 / 255, blue: 238 / 255)
    /// The rim of a card on that pale orange (#f0d3c6): the bag's reminder.
    static let accentLine = Color(red: 240 / 255, green: 211 / 255, blue: 198 / 255)
    /// The orange's words over navy, where darkening it would make it worse.
    static let accentOnDark = Color(red: 255 / 255, green: 171 / 255, blue: 133 / 255)
    static let success = Color(red: 47 / 255, green: 93 / 255, blue: 51 / 255)
    static let successFill = Color(red: 227 / 255, green: 239 / 255, blue: 228 / 255)
    /// The refurbished section's green — its badge, its note — the web's
    /// `#1f4d36` on `#e3f1e8` (9.6:1) and `#f1f8f4` for a note's ground.
    static let renewed = Color(red: 31 / 255, green: 77 / 255, blue: 54 / 255)
    static let renewedFill = Color(red: 227 / 255, green: 241 / 255, blue: 232 / 255)
    static let renewedWash = Color(red: 241 / 255, green: 248 / 255, blue: 244 / 255)
    static let danger = Color(red: 140 / 255, green: 47 / 255, blue: 34 / 255)
    /// The shop's red made deep enough to read straight on the floating glass
    /// (#7f1d1d, 4.8:1 over black behind an even 70% tint, where `danger` is 3.9).
    static let dangerOnGlass = Color(red: 127 / 255, green: 29 / 255, blue: 29 / 255)
    /// NetLet's test payment page (0086): its note's words, ground and dashed rim
    /// (#6b4a12 on #fff8eb, 8.3:1; #e4b363).
    static let testInk = Color(red: 107 / 255, green: 74 / 255, blue: 18 / 255)
    static let testWash = Color(red: 255 / 255, green: 248 / 255, blue: 235 / 255)
    static let testRim = Color(red: 228 / 255, green: 179 / 255, blue: 99 / 255)
    /// A field's or a panel's rim (#d5dfeb).
    static let line = Color(red: 213 / 255, green: 223 / 255, blue: 235 / 255)
    /// A card's rim, `CARD` (#e6e9ef).
    static let cardLine = Color(red: 230 / 255, green: 233 / 255, blue: 239 / 255)
    /// The pale navy an icon sits on (#eef2f8).
    static let tint = Color(red: 238 / 255, green: 242 / 255, blue: 248 / 255)
    /// Behind a product photograph (#f4f6f9).
    static let photo = Color(red: 244 / 255, green: 246 / 255, blue: 249 / 255)
    /// The hover and press fill on white (#f0f2f5).
    static let pressFill = Color(red: 240 / 255, green: 242 / 255, blue: 245 / 255)
    static let star = Color(red: 255 / 255, green: 184 / 255, blue: 0 / 255)
    /// The stars a score does not reach (#dfe3ea), the web's `StarRow`.
    static let starEmpty = Color(red: 223 / 255, green: 227 / 255, blue: 234 / 255)
    static let chevron = Color(red: 138 / 255, green: 160 / 255, blue: 189 / 255)
    /// A box a dropped pin filled (`.from-pin`): pale orange until it is changed (#fff6f0).
    static let fromPin = Color(red: 255 / 255, green: 246 / 255, blue: 240 / 255)
    /// That box's rim (#f0b391).
    static let fromPinRim = Color(red: 240 / 255, green: 179 / 255, blue: 145 / 255)
    /// The words of the line saying the pin filled them (#7a3a1f).
    static let fromPinInk = Color(red: 122 / 255, green: 58 / 255, blue: 31 / 255)
}
