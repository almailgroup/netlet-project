import SwiftUI

/// The web's liquid glass (`.glass-bar-surface` in `index.css`): what passes
/// under it blurred and brightened, under a white tint that is thicker at the
/// top than the foot, with a bright rim along its top edge.
///
/// The tint is the phone's — 60% white at the top and 45% at the foot, the
/// figures the owner chose for the phone's bar and tab bar — and is what keeps
/// the words on it legible over anything dark that scrolls under them. Every
/// control drawn on it stays solid; the glass is only ever the background.
struct GlassSurface: View {
    var top: Double = 0.6
    var foot: Double = 0.45
    /// The bright top edge — only where the surface is the top of the glass,
    /// or two rows of one header read as two strips.
    var rim = true
    /// How far the same glass reaches up past the view's top — behind the
    /// status bar, for the header row at the top of the screen — at the top's
    /// tint. One blur and one tint from the clock to the row's foot: two panes
    /// of glass meeting under the status bar drew a line where they met, and
    /// the strip above read darker than the row (the owner's screenshot).
    var reach: CGFloat = 0

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            VStack(spacing: 0) {
                Color.white.opacity(top).frame(height: reach)
                LinearGradient(colors: [Color.white.opacity(top), Color.white.opacity(foot)], startPoint: .top, endPoint: .bottom)
            }
        }
        .padding(.top, -reach)
        .overlay(alignment: .top) {
            if rim { Rectangle().fill(Color.white.opacity(0.95)).frame(height: 1) }
        }
    }
}

/// The same glass inside a capsule, with the tab bar's hairline rim and its
/// soft shadow — `MobileTabBar`'s floating pill.
struct GlassCapsule: View {
    var body: some View {
        GlassSurface()
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(Color.black.opacity(0.12), lineWidth: 1))
            .overlay(Capsule().inset(by: 1).strokeBorder(Color.white.opacity(0.6), lineWidth: 1))
            .shadow(color: Brand.navy.opacity(0.12), radius: 14, x: 0, y: 8)
            .shadow(color: Brand.navy.opacity(0.06), radius: 1.5, x: 0, y: 1)
    }
}
