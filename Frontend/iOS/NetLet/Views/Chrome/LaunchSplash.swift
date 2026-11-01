import AVFoundation
import SwiftUI

/// The app opening, on the owner's word ("make the opening intro animation
/// better, don't add glow … a zoom into the logo as it reveals the app
/// itself"): the app icon's orange roof on the navy the phone showed while it
/// launched, and then the shop seen *through* the roof as it rushes at the
/// viewer — the roof is a window onto the app, and it grows until the window
/// is the screen.
///
/// One clock, three beats, nothing that glows:
/// - **0.00** — the launch screen's own navy, so nothing changes where the
///   system hands over, and the roof springs up into its place, a little past
///   its size and back. The sound starts with its rising whoosh.
/// - **0.30** — it lands: the chime's first bell and a light tap together.
/// - **0.62** — a breath in (the roof draws back a touch, as something does
///   before it moves), then the zoom: the orange fades out of the roof as it
///   grows, so the roof's shape is a window and the shop is in it, and it
///   grows into the apex — where the two bars of the roof meet — slow to
///   start and fast at the end, until the screen is all window. The shop
///   settles from a little large to its own size behind it.
///
/// **The roof is drawn, not a picture** (`RoofMark`): the icon's own
/// geometry, two bars at forty-five degrees with a hole near each foot, so it
/// is as sharp at eighty times its size as at its own. The curtain is one
/// path — the screen with the roof cut out of it, even-odd — so growing it
/// is redrawing a few curves a frame, never a mask over the whole screen.
///
/// **The sound is `launch-chime.wav`, made for this animation, on the owner's
/// word** ("add a sound effect for the opening"), beat for beat with the
/// clock above: a soft rising pop as the roof springs up, a warm bell and a
/// low thump as it lands at 0.30s (the haptic tap's instant), a short breath
/// in at 0.62s, a whoosh through the zoom that rises and widens as the roof
/// rushes at the viewer, and a bright chord as the shop appears at 1.42s.
/// **It rings on under the home page and fades slowly, on the owner's word**
/// ("it cuts off at the end; let it continue and fade slowly while the app
/// opens"): the chord's long tail over a soft low pad, five seconds in all,
/// down to nothing over the last 1.6. It was cut at about 1.4s because the
/// player was the splash's own state, and the splash leaves as the shop
/// appears; `LaunchChime` holds it now, past the splash, until it has finished.
/// It plays in the `.ambient` category, so
/// the silent switch silences it — Apple's rule for a sound nobody needs — and
/// somebody's music keeps playing under it.
///
/// A cold launch only: coming back from the background finds the app where it
/// was. The shop loads underneath the whole time, so the wait is the
/// animation rather than added to it. Under Reduce Motion the roof fades in
/// and the curtain fades away, with the same sound. The UI tests and the
/// screenshots open straight onto their screen (`NetLetApp`).
struct LaunchSplash: View {
    /// The zoom has begun: the shop behind settles to its own size with it.
    let revealing: () -> Void
    let done: () -> Void
    @Environment(\.accessibilityReduceMotion) private var still

    /// How large the roof is drawn, by its own scale: 1 is its size at rest.
    @State private var zoom: CGFloat = 0.7
    /// The roof is on screen.
    @State private var shown = false
    /// The roof is a window onto the shop rather than orange.
    @State private var open = false
    /// The orange has gone out of the window.
    @State private var clear = false
    /// Reduce Motion's way out: the curtain fades.
    @State private var gone = false
    /// The screen's size, read as it is laid out, for how far the zoom goes.
    @State private var screen: CGSize = .zero

    /// Where the sound's landing is, and so where the roof's is.
    static let landing: Duration = .milliseconds(300)
    /// The roof's width at rest.
    static let width: CGFloat = 150

    var body: some View {
        GeometryReader { box in
            ZStack {
                // The screen with the roof cut out of it, once the roof is a window.
                RoofCurtain(zoom: zoom, width: Self.width, cut: open)
                    .fill(Brand.navy, style: FillStyle(eoFill: true))
                // The roof in orange over the window, until the zoom fades it out.
                RoofShape(zoom: zoom, width: Self.width)
                    .fill(Brand.orange)
                    .opacity(shown && !clear ? 1 : 0)
            }
            .onChange(of: box.size, initial: true) { _, size in screen = size }
        }
        .task { await play() }
        .opacity(gone ? 0 : 1)
        .ignoresSafeArea()
        .allowsHitTesting(!open && !gone)
        .accessibilityHidden(true)
    }

    private func play() async {
        LaunchChime.shared.play()
        if still {
            zoom = 1
            withAnimation(.easeOut(duration: 0.35)) { shown = true }
            try? await Task.sleep(for: Self.landing)
            Haptics.tap()
            try? await Task.sleep(for: .milliseconds(600))
            revealing()
            withAnimation(.easeOut(duration: 0.35)) { gone = true }
            try? await Task.sleep(for: .milliseconds(380))
            done()
            return
        }
        // Up into its place, a little past its size and back.
        withAnimation(.spring(response: 0.42, dampingFraction: 0.66)) {
            shown = true
            zoom = 1
        }
        try? await Task.sleep(for: Self.landing)
        // The landing: the first bell and a tap together.
        Haptics.tap()
        try? await Task.sleep(for: .milliseconds(320))
        // A breath in before it moves.
        withAnimation(.easeInOut(duration: 0.16)) { zoom = 0.9 }
        try? await Task.sleep(for: .milliseconds(160))
        // The roof becomes a window and rushes at the viewer: slow to start,
        // fast at the end, as a thing coming at you does.
        open = true
        revealing()
        withAnimation(.easeIn(duration: 0.14)) { clear = true }
        withAnimation(.timingCurve(0.7, 0, 0.84, 0, duration: 0.62)) {
            zoom = RoofMark.zoomToCover(screen, width: Self.width)
        }
        try? await Task.sleep(for: .milliseconds(640))
        done()
    }
}

/// NetLet's roof, the app icon's mark, as a vector in the icon's own
/// 1024-point grid: two bars at forty-five degrees meeting at the apex, their
/// caps making the notch on top, with a hole near each foot.
enum RoofMark {
    /// The mark's box in the icon's grid.
    static let box = CGRect(x: 145, y: 312, width: 734, height: 400)
    /// Inside the roof where its two bars overlap, under the notch and over
    /// the inside corner — the point the zoom goes into.
    static let apex = CGPoint(x: 512, y: 390)
    /// How far the nearest edge of the roof is from `apex`, in the grid: the
    /// notch above and the inside corner below are both this close.
    static let apexReach: CGFloat = 28

    /// The roof, holes cut, in the grid.
    static let path: Path = {
        let s = 1 / 2.squareRoot()
        // A bar laid flat — along it, then across it — before it is turned.
        let flat = Path(roundedRect: CGRect(x: -490 * s, y: 775 * s, width: 640 * s, height: 155 * s), cornerRadius: 22, style: .continuous)
        // Turned forty-five degrees up to the right: the left bar.
        let left = flat.applying(CGAffineTransform(a: s, b: -s, c: s, d: s, tx: 0, ty: 0))
        // Mirrored across the middle: the right bar.
        let right = left.applying(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: 1024, ty: 0))
        var holes = Path()
        holes.addEllipse(in: CGRect(x: 189, y: 605, width: 62, height: 62))
        holes.addEllipse(in: CGRect(x: 773, y: 605, width: 62, height: 62))
        return left.union(right).subtracting(holes)
    }()

    /// Where the grid goes on screen: the mark `width` wide and centred at
    /// zoom 1, and scaled by `zoom` about the apex, which stays where it is.
    static func placement(in rect: CGRect, width: CGFloat, zoom: CGFloat) -> CGAffineTransform {
        let rest = width / box.width
        let anchor = CGPoint(
            x: rect.midX + (apex.x - box.midX) * rest,
            y: rect.midY + (apex.y - box.midY) * rest
        )
        let scale = rest * zoom
        return CGAffineTransform(translationX: anchor.x, y: anchor.y)
            .scaledBy(x: scale, y: scale)
            .translatedBy(x: -apex.x, y: -apex.y)
    }

    /// The zoom at which the roof round the apex covers the whole screen: the
    /// nearest edge of the roof has to be past the farthest edge of the
    /// screen, with room to spare.
    static func zoomToCover(_ size: CGSize, width: CGFloat) -> CGFloat {
        let rest = width / box.width
        let farthest = max(size.width, size.height) / 2 + abs(apex.y - box.midY) * rest + 60
        return max(1, farthest / (apexReach * rest))
    }
}

/// The roof at a zoom, animatable by it.
private struct RoofShape: Shape {
    var zoom: CGFloat
    let width: CGFloat

    var animatableData: CGFloat {
        get { zoom }
        set { zoom = newValue }
    }

    func path(in rect: CGRect) -> Path {
        RoofMark.path.applying(RoofMark.placement(in: rect, width: width, zoom: zoom))
    }
}

/// The navy over the shop, with the roof cut out of it once `cut` — drawn
/// even-odd, so the roof's own holes are navy again inside the window, as
/// they are on the icon.
private struct RoofCurtain: Shape {
    var zoom: CGFloat
    let width: CGFloat
    let cut: Bool

    var animatableData: CGFloat {
        get { zoom }
        set { zoom = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path(rect)
        if cut {
            path.addPath(RoofMark.path.applying(RoofMark.placement(in: rect, width: width, zoom: zoom)))
        }
        return path
    }
}

/// The opening's sound, held apart from the splash so it outlives it: the
/// splash leaves as the shop appears, and a player that was its state went
/// with it, cutting the chord off. This keeps the player until the sound has
/// run to its end, then lets it go.
final class LaunchChime {
    static let shared = LaunchChime()
    private var player: AVAudioPlayer?

    /// Ready and playing at once, so the bell and the landing are the same
    /// instant. Silent with the phone's switch, and mixed under whatever else
    /// is playing.
    func play() {
        guard player == nil, let url = Bundle.main.url(forResource: "launch-chime", withExtension: "wav") else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, options: [.mixWithOthers])
        try? session.setActive(true)
        guard let sound = try? AVAudioPlayer(contentsOf: url) else { return }
        sound.volume = 0.85
        sound.prepareToPlay()
        sound.play()
        player = sound
        DispatchQueue.main.asyncAfter(deadline: .now() + sound.duration + 0.5) { [weak self] in
            self?.player?.stop()
            self?.player = nil
        }
    }
}
