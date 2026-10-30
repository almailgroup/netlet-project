import SwiftUI

/// The app opening, on the owner's word ("a cool animation when opening the
/// app … use the logo to zoom out"): NetLet's mark on the navy the phone
/// showed while it launched, then the shop.
///
/// The first frame is the launch screen's own navy, so nothing changes where
/// the system hands over. The mark — the white letters under the orange roof —
/// springs up into place with a little bounce, an orange ring breathes out
/// from behind it with a light tap, and then it zooms past the viewer and
/// fades as the navy clears, so the shop comes up from behind it. About a
/// second and a half from a cold launch, and only a cold launch: coming back
/// to the app from the background finds it where it was. The shop loads
/// underneath the whole time, so the wait is the animation rather than added
/// to it.
///
/// Under Reduce Motion it is the mark on the navy, faded away. The UI tests
/// and the screenshots open straight onto their screen (`NetLetApp`).
struct LaunchSplash: View {
    let done: () -> Void
    @Environment(\.accessibilityReduceMotion) private var still
    /// The mark has sprung into place.
    @State private var landed = false
    /// The ring has breathed out from behind it.
    @State private var rang = false
    /// Zooming past the viewer, the navy clearing.
    @State private var leaving = false

    var body: some View {
        ZStack {
            Brand.navy
                .opacity(leaving ? 0 : 1)
            Circle()
                .stroke(Brand.orange, lineWidth: 3)
                .frame(width: 150, height: 150)
                .scaleEffect(rang ? 2.4 : 0.7)
                .opacity(rang ? 0 : (landed ? 0.55 : 0))
            mark
                .frame(width: 210)
                .scaleEffect(scale)
                .opacity(leaving ? 0 : (landed ? 1 : 0))
                .offset(y: landed ? 0 : 18)
        }
        .ignoresSafeArea()
        .allowsHitTesting(!leaving)
        .accessibilityHidden(true)
        .task { await play() }
    }

    @ViewBuilder
    private var mark: some View {
        if let logo = WebAssets.footerLogo {
            Image(uiImage: logo)
                .resizable()
                .aspectRatio(contentMode: .fit)
        } else {
            Text("NetLet")
                .font(.inter(44, .heavy))
                .foregroundStyle(.white)
        }
    }

    private var scale: CGFloat {
        if leaving { return still ? 1 : 7 }
        return landed ? 1 : (still ? 1 : 0.55)
    }

    private func play() async {
        if still {
            landed = true
            try? await Task.sleep(for: .milliseconds(500))
            withAnimation(.easeOut(duration: 0.3)) { leaving = true }
            try? await Task.sleep(for: .milliseconds(320))
            done()
            return
        }
        // A frame on the launch screen's navy first, so the spring starts from
        // what the eye already sees.
        try? await Task.sleep(for: .milliseconds(60))
        withAnimation(.spring(duration: 0.6, bounce: 0.38)) { landed = true }
        try? await Task.sleep(for: .milliseconds(320))
        Haptics.tap()
        withAnimation(.easeOut(duration: 0.75)) { rang = true }
        try? await Task.sleep(for: .milliseconds(520))
        // Past the viewer: slow to start, fast at the end, as a thing coming
        // at you does; the navy goes with it and the shop is there.
        withAnimation(.timingCurve(0.6, 0, 0.8, 0.4, duration: 0.5)) { leaving = true }
        try? await Task.sleep(for: .milliseconds(520))
        done()
    }
}
