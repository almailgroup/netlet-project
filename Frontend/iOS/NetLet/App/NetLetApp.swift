import SwiftUI

@main
struct NetLetApp: App {
    @State private var app: AppModel

    // Made in the initialiser, which is on the main actor, rather than as the
    // property's initial value, which Swift 5 mode evaluates outside it.
    init() {
        let model = AppModel.live()
        _app = State(initialValue: model)
        // "Hide keyboard" over every field the app has (`KeyboardBar`).
        KeyboardBar.install(language: model.language)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
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
