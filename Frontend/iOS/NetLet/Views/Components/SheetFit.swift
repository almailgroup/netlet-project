import SwiftUI

/// A sheet as tall as what it holds, never taller than the screen — for a
/// short sheet that read as half empty at `.large`: "Is this your address?"
/// was a map, a card and two buttons over half a screen of blank ground. The
/// content's height is measured as it is laid out and handed to a `.height`
/// detent, which the system holds to the screen; a sheet whose content grows
/// past that scrolls, so the content is a `ScrollView`'s.
struct SheetFit: ViewModifier {
    /// The first guess, until the content has been measured once.
    var initial: CGFloat = 560
    @State private var height: CGFloat?

    func body(content: Content) -> some View {
        content
            .background {
                GeometryReader { proxy in
                    Color.clear
                        .onChange(of: proxy.size.height.rounded(), initial: true) { _, measured in
                            if measured > 0, measured != height { height = measured }
                        }
                }
            }
            .presentationDetents([.height((height ?? initial) + 8)])
    }
}

extension View {
    /// Sizes the sheet this view is the content of to the view's own height.
    /// Apply to the content inside the sheet's `ScrollView`, padding included.
    func sheetFit(initial: CGFloat = 560) -> some View { modifier(SheetFit(initial: initial)) }
}
