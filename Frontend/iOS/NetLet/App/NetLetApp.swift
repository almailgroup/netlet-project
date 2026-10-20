import SwiftUI

@main
struct NetLetApp: App {
    @State private var app: AppModel

    // Made in the initialiser, which is on the main actor, rather than as the
    // property's initial value, which Swift 5 mode evaluates outside it.
    init() {
        _app = State(initialValue: AppModel.live())
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(app.language)
                .environment(\.layoutDirection, app.language.layoutDirection)
                .environment(\.locale, app.language.current.locale)
                // The tint is the asset catalogue's AccentColor — navy, which
                // is what every control here draws in, the app being light only
                // — and not a `.tint`, which would fix the tab bar's selected
                // tab at navy over dark glass too (see `RootView`).
                .buttonStyle(HapticDefaultStyle())
                .task { await app.start() }
        }
    }
}
