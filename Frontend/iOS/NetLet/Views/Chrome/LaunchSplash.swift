import AVFoundation
import SwiftUI

/// The app opening, on the owner's word ("a cool animation when opening the
/// app … use the logo to zoom out", then "make it more dynamic and premium
/// … with a short sound synced to it"): NetLet's mark on the navy the phone
/// showed while it launched, then the shop.
///
/// One clock, staggered beats, each on a curve of its own:
/// - **0.00** — the launch screen's own navy, so nothing changes where the
///   system hands over; a warm glow blooms behind where the mark will be, and
///   the sound starts with its rising whoosh.
/// - **0.04** — the mark springs up out of a blur, a little past its size
///   and back (`spring`, a light bounce).
/// - **0.30** — it lands: the chime's first bell, a light tap, and an orange
///   ring ripples out from behind it, a second ring a beat after with the
///   chime's second bell.
/// - **0.45** — a band of light sweeps across the mark.
/// - **0.55** — "Kuwait's stores," and then "one cart." rise in under it, a
///   beat apart, the home page's own line.
/// - **1.35** — it all zooms past the viewer as the navy clears, slow to
///   start and fast at the end, and the shop is there.
///
/// **The sound is `launch-chime.wav`, made for this** — a soft whoosh into
/// two bells, E6 then B6, with a low thump under the landing — and its
/// landing is at 0.30s, the moment the mark lands, so the two are one event.
/// It plays in the `.ambient` audio category, so the phone's silent switch
/// silences it and somebody's music keeps playing under it.
///
/// A cold launch only: coming back from the background finds the app where it
/// was. The shop loads underneath the whole time, so the wait is the
/// animation rather than added to it. Under Reduce Motion it is the mark and
/// the line, faded in and out, with the same sound. The UI tests and the
/// screenshots open straight onto their screen (`NetLetApp`).
struct LaunchSplash: View {
    let done: () -> Void
    @Environment(\.accessibilityReduceMotion) private var still
    @Environment(LanguageSettings.self) private var l

    @State private var glow = false
    @State private var landed = false
    @State private var firstRing = false
    @State private var secondRing = false
    @State private var shine = false
    @State private var firstLine = false
    @State private var secondLine = false
    @State private var leaving = false
    @State private var player: AVAudioPlayer?

    /// Where the sound's landing is, and so where the mark's is.
    static let landing: Duration = .milliseconds(300)

    var body: some View {
        ZStack {
            Brand.navy
            RadialGradient(colors: [Brand.orange.opacity(0.26), Brand.orange.opacity(0.08), .clear], center: .center, startRadius: 8, endRadius: 280)
                .scaleEffect(glow ? 1 : 0.35)
                .opacity(glow && !leaving ? 1 : 0)
            ring(firstRing, width: 3)
            ring(secondRing, width: 1.5)
            VStack(spacing: 22) {
                mark
                    .frame(width: 210)
                    .overlay { shineBand }
                    .scaleEffect(markScale)
                    .blur(radius: landed || still ? 0 : 14)
                    .opacity(landed ? 1 : 0)
                    .offset(y: landed || still ? 0 : 26)
                VStack(spacing: 2) {
                    Text(l.t("home.heroTitle"))
                        .foregroundStyle(.white)
                        .opacity(firstLine ? 1 : 0)
                        .offset(y: firstLine || still ? 0 : 10)
                    Text(l.t("home.heroTitleAccent"))
                        .foregroundStyle(Brand.orange)
                        .opacity(secondLine ? 1 : 0)
                        .offset(y: secondLine || still ? 0 : 10)
                }
                .font(.inter(20, .bold))
                .opacity(leaving ? 0 : 1)
            }
        }
        .opacity(leaving ? 0 : 1)
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

    /// A band of light across the mark, drawn only where the mark is.
    private var shineBand: some View {
        GeometryReader { box in
            LinearGradient(colors: [.clear, .white.opacity(0.85), .clear], startPoint: .leading, endPoint: .trailing)
                .frame(width: box.size.width * 0.35)
                .rotationEffect(.degrees(16))
                .offset(x: shine ? box.size.width * 1.15 : -box.size.width * 0.55)
                .frame(maxHeight: .infinity)
        }
        .mask(mark)
        .opacity(still ? 0 : 1)
        .allowsHitTesting(false)
    }

    private func ring(_ out: Bool, width: CGFloat) -> some View {
        Circle()
            .stroke(Brand.orange, lineWidth: width)
            .frame(width: 150, height: 150)
            .scaleEffect(out ? 2.6 : 0.75)
            .opacity(still ? 0 : (out ? 0 : (landed ? 0.6 : 0)))
    }

    private var markScale: CGFloat {
        if leaving { return still ? 1 : 7 }
        return landed ? 1 : (still ? 1 : 0.5)
    }

    /// The chime, ready before the clock starts, so the bell and the landing
    /// are the same instant. Silent with the phone's switch, and mixed under
    /// whatever else is playing.
    private func prepareSound() {
        guard let url = Bundle.main.url(forResource: "launch-chime", withExtension: "wav") else { return }
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        guard let sound = try? AVAudioPlayer(contentsOf: url) else { return }
        sound.volume = 0.7
        sound.prepareToPlay()
        player = sound
    }

    private func play() async {
        prepareSound()
        player?.play()
        if still {
            withAnimation(.easeOut(duration: 0.35)) {
                landed = true
                firstLine = true
                secondLine = true
            }
            try? await Task.sleep(for: Self.landing)
            Haptics.tap()
            try? await Task.sleep(for: .milliseconds(700))
            withAnimation(.easeOut(duration: 0.3)) { leaving = true }
            try? await Task.sleep(for: .milliseconds(320))
            done()
            return
        }
        withAnimation(.easeOut(duration: 0.5)) { glow = true }
        try? await Task.sleep(for: .milliseconds(40))
        // Up out of the blur, a little past its size and back.
        withAnimation(.spring(response: 0.5, dampingFraction: 0.62)) { landed = true }
        try? await Task.sleep(for: Self.landing - .milliseconds(40))
        // The landing: the first bell, a tap and the first ring together.
        Haptics.tap()
        withAnimation(.easeOut(duration: 0.8)) { firstRing = true }
        try? await Task.sleep(for: .milliseconds(110))
        // The second bell, and the second ring with it.
        withAnimation(.easeOut(duration: 0.9)) { secondRing = true }
        try? await Task.sleep(for: .milliseconds(40))
        withAnimation(.easeInOut(duration: 0.7)) { shine = true }
        try? await Task.sleep(for: .milliseconds(100))
        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { firstLine = true }
        try? await Task.sleep(for: .milliseconds(120))
        withAnimation(.spring(response: 0.45, dampingFraction: 0.8)) { secondLine = true }
        try? await Task.sleep(for: .milliseconds(680))
        // Past the viewer: slow to start, fast at the end, as a thing coming
        // at you does; the navy goes with it and the shop is there.
        withAnimation(.timingCurve(0.6, 0, 0.8, 0.4, duration: 0.5)) { leaving = true }
        try? await Task.sleep(for: .milliseconds(520))
        done()
    }
}
