import SwiftUI

@main
struct NetLetApp: App {
    @State private var app: AppModel
    /// The opening animation is on screen (`LaunchSplash`) — on every cold
    /// launch but a UI test's or a screenshot's, which open on their screen.
    @State private var opening: Bool

    // Made in the initialiser, which is on the main actor, rather than as the
    // property's initial value, which Swift 5 mode evaluates outside it.
    init() {
        let model = AppModel.live()
        _app = State(initialValue: model)
        _opening = State(initialValue: !UITestHooks.on && UserDefaults.standard.string(forKey: "NetLetOpen") == nil)
        // "Hide keyboard" over every field the app has (`KeyboardBar`).
        KeyboardBar.install(language: model.language)
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                RootView()
                if opening {
                    LaunchSplash { opening = false }
                        .zIndex(1)
                }
            }
            .environment(app)
            .environment(app.language)
            .environment(\.layoutDirection, app.language.layoutDirection)
            .environment(\.locale, app.language.current.locale)
            .tint(Brand.navy)
            .buttonStyle(HapticDefaultStyle())
            .task { await app.start() }
        }
    }
}
