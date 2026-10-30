import SwiftUI

/// What the UI tests (`NetLetUITests`) need from the app and nobody else does,
/// switched on by `-NetLetUITest YES` in a Debug build and never in a release.
enum UITestHooks {
    #if DEBUG
    static let on = UserDefaults.standard.bool(forKey: "NetLetUITest")
    #else
    static let on = false
    #endif
}

/// A point at the top of a page's content that a UI test can find and follow
/// as the page scrolls ("page-top"). Drawn only under `UITestHooks.on`, so a
/// shopper's VoiceOver never meets an element that says nothing.
struct PageTopMarker: View {
    var body: some View {
        if UITestHooks.on {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel("page top")
                .accessibilityIdentifier("page-top")
        }
    }
}
