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
                .tint(Brand.navy)
                .buttonStyle(HapticDefaultStyle())
                .task { await app.start() }
        }
    }
}
