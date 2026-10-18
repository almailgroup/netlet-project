import SwiftUI

@main
struct NetLetApp: App {
    @State private var app = AppModel.live()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(app.language)
                .environment(\.layoutDirection, app.language.layoutDirection)
                .environment(\.locale, app.language.current.locale)
                .tint(Brand.navy)
                .task { await app.start() }
        }
    }
}
