import AVFoundation
import SwiftUI
import UIKit

/// The Deals tab's own moment, on the owner's word — first "when you tap on
/// the deals icon in the bottom menu, it would display a cool animation for
/// deals, to make it more appealing", then "work on the deals animation to
/// make it better. Add a sound effect". The tab's red bag leaps out of the bar
/// turning over once, three fainter bags behind it where it just was; lands in
/// the middle with a crouch and a tap as a sunburst opens behind it; springs,
/// and throws its deals — percent chips, price tags, coins and streamers,
/// tumbling, in two throws a beat apart — while rings spread and sparkles
/// twinkle round it; then crouches once more and hops home into the tab it
/// came from, where a small ring marks the landing. Just under two seconds,
/// as the page's shelves rise in under it (`DealRise`).
///
/// It is drawn over the whole app in one `Canvas` by the clock, so it lays
/// nothing out and re-renders no page, runs at the screen's own rate, and
/// **takes no touch**: the Deals page under it is usable from the first
/// frame. A press on the tab plays it — the tab you are on too — and the
/// app's own moves to the tab never do. Reduce Motion plays nothing, sound
/// included, and VoiceOver is told nothing, since nothing it says has changed.
///
/// The bag is the tab icon's own drawing (`tabIcons.json`), its percent in
/// white rather than cut clear, so it reads over whatever the page shows. It
/// leaves at the icon's own size and comes home to it, so the drawn bag and
/// the tab's are one bag.
struct DealsBurst: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var still
    /// When the burst on screen began; nil while there is none.
    @State private var started: Date?

    var body: some View {
        GeometryReader { proxy in
            let inset = proxy.safeAreaInsets.bottom
            ZStack {
                if let frozen = app.dealsBurstFrozen {
                    // A screenshot's frame (`-NetLetOpen dealsBurst`).
                    scene(at: frozen, inset: inset)
                } else if let started {
                    TimelineView(.animation) { timeline in
                        scene(at: timeline.date.timeIntervalSince(started), inset: inset)
                    }
                }
            }
            .ignoresSafeArea()
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        // A picture of a bag: never mirrored on the Arabic page.
        .environment(\.layoutDirection, .leftToRight)
        .onChange(of: app.dealsBurst) { _, _ in play() }
        .task {
            // The sound made ready once the app has settled, so the first
            // press starts it with the leap rather than a moment into it.
            try? await Task.sleep(for: .seconds(3))
            if !still { DealsChime.shared.prepare() }
        }
    }

    private func scene(at time: Double, inset: CGFloat) -> some View {
        // Read here, on the main actor: the drawing itself runs wherever the
        // canvas is rendered and may ask the device nothing.
        let barOnTop = UIDevice.current.userInterfaceIdiom == .pad
        return Canvas { context, size in
            DealsBurstScene.draw(&context, size: size, time: time, bottomInset: inset, barOnTop: barOnTop)
        }
    }

    private func play() {
        guard !still else { return }
        let now = Date()
        started = now
        DealsChime.shared.play()
        Task { @MainActor in
            // The bag lands: felt, as a press on a product is.
            try? await Task.sleep(for: .milliseconds(Int(DealsBurstScene.landing * 1000)))
            guard started == now else { return }
            Haptics.action()
            // And it is home in the tab: a lighter tap.
            try? await Task.sleep(for: .milliseconds(Int((DealsBurstScene.home - DealsBurstScene.landing) * 1000)))
            guard started == now else { return }
            Haptics.tap()
            try? await Task.sleep(for: .milliseconds(Int((DealsBurstScene.length - DealsBurstScene.home) * 1000) + 60))
            // A second press began another: that one ends itself.
            if started == now { started = nil }
        }
    }
}

/// The burst's sound: `deals-burst.wav`, made for this animation beat for
/// beat — air rising as the bag leaps, a low thump as it lands
/// (`DealsBurstScene.landing`), a bright bell with a metallic tick as it
/// bursts (`pop`), a higher bell on the second throw (`second`) with small
/// high pings scattered after it like coins, a soft falling whistle as it hops
/// home and a small pock as it lands in the tab (`home`). E major, the key of
/// the launch and the order sounds. It plays in the ambient category, so the
/// Ring/Silent switch silences it and music keeps playing, the launch chime's
/// rule; it keeps its player, since the tab is pressed again and again.
final class DealsChime {
    static let shared = DealsChime()
    private var player: AVAudioPlayer?

    func prepare() {
        guard player == nil, let url = Bundle.main.url(forResource: "deals-burst", withExtension: "wav") else { return }
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
        guard let sound = try? AVAudioPlayer(contentsOf: url) else { return }
        sound.volume = 0.8
        sound.prepareToPlay()
        player = sound
    }

    /// From its start each time: a second press starts the burst again, and
    /// its sound with it.
    func play() {
        prepare()
        guard let sound = player else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        sound.currentTime = 0
        sound.play()
    }
}

/// The burst's drawing, a pure function of the time since it began — so one
/// frame can be drawn for a picture, and a test can ask where things are.
enum DealsBurstScene {
    /// The bag reaches the middle and lands.
    static let landing: Double = 0.42
    /// It springs out of the landing's crouch and the pieces leave it.
    static let pop: Double = 0.52
    /// A second, smaller throw, on the sound's second bell.
    static let second: Double = 0.70
    /// The bag starts its hop back to the tab.
    static let leaving: Double = 1.28
    /// It is home in the tab.
    static let home: Double = 1.66
    /// Nothing is drawn after this.
    static let length: Double = 1.95
    /// The bag's side at rest, in points.
    static let bagSide: CGFloat = 132
    /// The tab icon's own side, which the bag leaves at and comes home to.
    static let tabSide: CGFloat = 38

    struct Piece: Sendable {
        /// 0 a percent chip, 1 a price tag, 2 a coin, 3 a streamer.
        let kind: Int
        /// Where it flies, in radians; negative sine is up the screen.
        let angle: Double
        let speed: Double
        let spin: Double
        /// How fast it tumbles: its width narrows and comes back as it turns.
        let flip: Double
        let size: CGFloat
        /// After the pop; the second throw's pieces wait for it.
        let delay: Double
        /// 0 the first throw, 1 the second.
        let wave: Int
        let colour: Int
    }

    /// Fixed rather than random, so every burst is the same burst.
    static let pieces: [Piece] = {
        var seed: UInt64 = 0x2545F4914F6CDD1D
        func next() -> Double {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Double((seed >> 33) % 10_000) / 10_000
        }
        var made: [Piece] = []
        let first = 28
        let later = 18
        for index in 0..<(first + later) {
            let wave = index < first ? 0 : 1
            let slot = wave == 0 ? index : index - first
            let count = wave == 0 ? first : later
            // A fan over the bag, a little wider than a half circle.
            let along: Double = (Double(slot) + next() * 0.8) / Double(count)
            let angle: Double = -Double.pi * (0.08 + 0.84 * along)
            let kind = index % 5 == 0 ? 2 : index % 3 == 0 ? 1 : index % 2 == 0 ? 0 : 3
            let base: Double = wave == 0 ? 560 : 380
            let more: Double = wave == 0 ? 560 : 420
            let speed: Double = base + next() * more
            let spin: Double = (next() - 0.5) * 14
            let flip: Double = 6 + next() * 9
            let least: Double = wave == 0 ? 0.85 : 0.62
            let size: Double = least + next() * 0.5
            let wait: Double = wave == 0 ? 0 : second - pop
            let delay: Double = wait + next() * 0.09
            made.append(Piece(kind: kind, angle: angle, speed: speed, spin: spin, flip: flip, size: CGFloat(size), delay: delay, wave: wave, colour: index))
        }
        return made
    }()

    /// A sparkle that twinkles beside the bag: where, in bag sides from its
    /// middle; when it begins, after the pop; how large; which colour.
    struct Sparkle: Sendable {
        let x: Double
        let y: Double
        let begin: Double
        let size: Double
        let tone: Int
    }

    static let sparkles: [Sparkle] = [
        Sparkle(x: -0.86, y: -0.52, begin: 0.02, size: 1.0, tone: 0),
        Sparkle(x: 0.92, y: -0.38, begin: 0.10, size: 0.8, tone: 1),
        Sparkle(x: -0.62, y: 0.38, begin: 0.18, size: 0.7, tone: 1),
        Sparkle(x: 0.70, y: 0.46, begin: 0.26, size: 0.9, tone: 0),
        Sparkle(x: -1.06, y: -0.02, begin: 0.34, size: 0.6, tone: 2),
        Sparkle(x: 0.30, y: -0.98, begin: 0.14, size: 0.75, tone: 2),
        Sparkle(x: -0.26, y: -1.02, begin: 0.40, size: 0.6, tone: 0),
        Sparkle(x: 1.08, y: 0.06, begin: 0.46, size: 0.65, tone: 1),
    ]

    private struct BagPath {
        let path: Path
        let mode: String
        let deep: Bool
        let knockout: Bool
    }

    /// The tab icon's filled bag, parsed once.
    private static let bagPaths: [BagPath] = {
        guard let drawing = TabIcon.file?.icons["deals"] else { return [] }
        return drawing.filled.map {
            BagPath(path: Path(TabIcon.cgPath($0.d)), mode: $0.mode, deep: $0.deep == true, knockout: $0.knockout == true)
        }
    }()

    /// A four-pointed sparkle, 22 points from its middle to a tip.
    private static let starPath: Path = {
        var path = Path()
        for index in 0..<8 {
            let angle: Double = Double(index) * Double.pi / 4 - Double.pi / 2
            let reach: Double = index % 2 == 0 ? 22 : 7.5
            let point = CGPoint(x: cos(angle) * reach, y: sin(angle) * reach)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        path.closeSubpath()
        return path
    }()

    private static let red = Color(red: 214 / 255, green: 32 / 255, blue: 31 / 255)
    private static let deepRed = Color(red: 163 / 255, green: 24 / 255, blue: 27 / 255)
    private static let amber = Color(red: 245 / 255, green: 184 / 255, blue: 61 / 255)
    private static let amberRim = Color(red: 201 / 255, green: 140 / 255, blue: 24 / 255)
    private static let sky = Color(red: 157 / 255, green: 179 / 255, blue: 214 / 255)

    // MARK: Curves

    static func clamp(_ value: Double) -> Double { min(1, max(0, value)) }
    static func easeOut(_ value: Double) -> Double { 1 - pow(1 - clamp(value), 3) }
    static func easeIn(_ value: Double) -> Double { pow(clamp(value), 3) }
    /// Slow at both ends.
    static func smooth(_ value: Double) -> Double {
        let x = clamp(value)
        return x * x * (3 - 2 * x)
    }
    /// Up to one at the middle and back to nothing: a crouch, a pulse.
    static func bump(_ value: Double) -> Double { sin(Double.pi * clamp(value)) }
    /// Past its end and back: the leap's overshoot.
    static func overshoot(_ value: Double) -> Double {
        let x = clamp(value) - 1
        let c: Double = 1.70158
        return 1 + (c + 1) * x * x * x + c * x * x
    }

    /// Where the bag's middle is, how large it is and how far it has faded.
    struct BagState: Equatable {
        var centre: CGPoint
        var scale: CGFloat
        var stretch: CGSize
        var turn: Double
        var opacity: Double
    }

    /// Where the tab's icon is: the middle of the bar — the third of five, on
    /// either page — at the screen's foot on a phone and its top on an iPad.
    static func origin(in size: CGSize, bottomInset: CGFloat, barOnTop: Bool = false) -> CGPoint {
        if barOnTop { return CGPoint(x: size.width / 2, y: 44) }
        return CGPoint(x: size.width / 2, y: size.height - bottomInset - 28)
    }

    /// Where the bag rests: the middle of the screen, a little above centre.
    static func rest(in size: CGSize) -> CGPoint {
        CGPoint(x: size.width / 2, y: size.height * 0.42)
    }

    static func bagState(at time: Double, from origin: CGPoint, to rest: CGPoint) -> BagState {
        let small = Double(tabSide / bagSide)
        var centre: CGPoint
        var scale: Double
        var turn: Double
        if time <= leaving {
            // The leap: past where it rests and back, turning over once, with
            // a little sway to one side on the way.
            let leap = time / landing
            let along = CGFloat(overshoot(leap))
            let sway = CGFloat(26 * bump(leap))
            centre = CGPoint(
                x: origin.x + (rest.x - origin.x) * along - sway,
                y: origin.y + (rest.y - origin.y) * along
            )
            scale = small + (1 - small) * easeOut(leap)
            turn = (1 - easeOut(leap)) * -2 * Double.pi
        } else {
            // The hop home: up a little first, then down into the tab,
            // shrinking to the icon's size and turning over the other way.
            let hop = (time - leaving) / (home - leaving)
            let along = CGFloat(smooth(hop) * smooth(hop) * 0.35 + easeIn(hop) * 0.65)
            let sway = CGFloat(26 * bump(hop))
            let lift = CGFloat(54 * bump(hop) * (1 - clamp(hop)))
            centre = CGPoint(
                x: rest.x + (origin.x - rest.x) * along + sway,
                y: rest.y + (origin.y - rest.y) * along - lift
            )
            scale = 1 - (1 - small) * smooth(hop)
            turn = smooth(hop) * 2 * Double.pi
        }
        // The landing is a crouch, and the spring out of it throws the pieces;
        // it crouches once more before it hops home.
        let crouch = bump((time - landing) / 0.16)
        let spring = bump((time - pop) / 0.24)
        let ready = bump((time - (leaving - 0.12)) / 0.16)
        let stretch = CGSize(
            width: 1 + 0.18 * crouch - 0.09 * spring + 0.10 * ready,
            height: 1 - 0.15 * crouch + 0.15 * spring - 0.09 * ready
        )
        if time > landing, time <= leaving {
            // A breath after it lands, dying away, and a small jump as it bursts.
            let since = time - landing
            centre.y += CGFloat(sin(since * 7) * 4 * exp(-since * 2.4))
            centre.y -= CGFloat(16 * bump((time - pop) / 0.28))
        }
        if time > pop, time <= leaving {
            // It shakes as the pieces leave.
            let since = time - pop
            turn += 0.12 * sin(since * 20) * exp(-since * 6)
        }
        // A beat on the second throw.
        scale *= 1 + 0.09 * bump((time - second) / 0.2)
        // Home, the tab's own bag is the bag: the drawn one goes.
        let opacity = 1 - clamp((time - home) / 0.1)
        return BagState(centre: centre, scale: CGFloat(scale), stretch: stretch, turn: turn, opacity: opacity)
    }

    // MARK: Drawing

    static func draw(_ context: inout GraphicsContext, size: CGSize, time: Double, bottomInset: CGFloat, barOnTop: Bool = false) {
        guard time >= 0, time <= length else { return }
        let from = origin(in: size, bottomInset: bottomInset, barOnTop: barOnTop)
        let to = rest(in: size)
        let state = bagState(at: time, from: from, to: to)

        drawRays(&context, at: to, time: time)
        drawFlash(&context, at: CGPoint(x: to.x, y: to.y - bagSide * 0.12), time: time)
        drawRings(&context, at: to, time: time)
        // What flew first is behind the bag; it is the bag they came out of.
        drawPieces(&context, from: CGPoint(x: to.x, y: to.y - bagSide * 0.18), time: time, width: size.width)
        drawSparkles(&context, about: to, time: time)
        drawShadow(&context, under: to, state: state, time: time)
        // What it leaves behind while it flies: three fainter bags where it
        // just was.
        if time < landing || (time > leaving && time < home) {
            for step in [3, 2, 1] {
                let before = time - Double(step) * 0.028
                if before < 0 || (time > leaving && before < leaving) { continue }
                drawBag(&context, state: bagState(at: before, from: from, to: to), fade: 0.2 / Double(step))
            }
        }
        drawBag(&context, state: state, fade: 1)
        drawHomeRing(&context, at: from, time: time)
    }

    private static func disc(at centre: CGPoint, radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
    }

    private static func point(from centre: CGPoint, angle: Double, radius: Double) -> CGPoint {
        CGPoint(x: centre.x + CGFloat(cos(angle) * radius), y: centre.y + CGFloat(sin(angle) * radius))
    }

    /// A sunburst behind the bag from the landing: twelve flat rays in the
    /// coin's amber and the brand's orange, opening past their length and
    /// back, turning slowly, gone before the bag leaves. Flat colour, no glow.
    private static func drawRays(_ context: inout GraphicsContext, at centre: CGPoint, time: Double) {
        let age = time - landing
        guard age > 0, time < leaving else { return }
        let fade = 1 - clamp((time - (leaving - 0.3)) / 0.3)
        let inner: Double = 58
        let outer: Double = 58 + 150 * overshoot(age / 0.3)
        let count = 12
        let pitch: Double = Double.pi * 2 / Double(count)
        let half: Double = pitch * 0.21
        let turned: Double = age * 0.7
        for index in 0..<count {
            let angle: Double = turned + Double(index) * pitch
            var ray = Path()
            ray.move(to: point(from: centre, angle: angle - half * 0.5, radius: inner))
            ray.addLine(to: point(from: centre, angle: angle - half, radius: outer))
            ray.addLine(to: point(from: centre, angle: angle + half, radius: outer))
            ray.addLine(to: point(from: centre, angle: angle + half * 0.5, radius: inner))
            ray.closeSubpath()
            let even = index % 2 == 0
            let colour: Color = even ? amber : Brand.orange
            let strength: Double = even ? 0.30 : 0.20
            context.fill(ray, with: .color(colour.opacity(strength * fade)))
        }
    }

    /// The burst itself, for a fifth of a second: a disc of amber opening
    /// from the bag's mouth and thinning to nothing.
    private static func drawFlash(_ context: inout GraphicsContext, at centre: CGPoint, time: Double) {
        let age = (time - pop) / 0.2
        guard age > 0, age < 1 else { return }
        let radius = CGFloat(26 + 84 * easeOut(age))
        context.fill(disc(at: centre, radius: radius), with: .color(amber.opacity(0.5 * (1 - age))))
    }

    private static func drawRings(_ context: inout GraphicsContext, at centre: CGPoint, time: Double) {
        for (index, colour) in [red, Brand.orange].enumerated() {
            let age = (time - pop - Double(index) * 0.13) / 0.7
            guard age > 0, age < 1 else { continue }
            let radius = CGFloat(50 + 200 * easeOut(age))
            context.stroke(disc(at: centre, radius: radius), with: .color(colour.opacity(0.5 * (1 - age))), lineWidth: CGFloat(4 - 3 * age))
        }
    }

    /// Where the bag came home: one small ring from the tab.
    private static func drawHomeRing(_ context: inout GraphicsContext, at tab: CGPoint, time: Double) {
        let age = (time - home) / (length - home)
        guard age > 0, age < 1 else { return }
        let radius = CGFloat(16 + 26 * easeOut(age))
        context.stroke(disc(at: tab, radius: radius), with: .color(red.opacity(0.55 * (1 - age))), lineWidth: CGFloat(3 - 2 * age))
    }

    private static func drawSparkles(_ context: inout GraphicsContext, about centre: CGPoint, time: Double) {
        let tones: [Color] = [amber, Brand.orange, red]
        for sparkle in sparkles {
            let age = (time - pop - sparkle.begin) / 0.46
            guard age > 0, age < 1 else { continue }
            let grown = CGFloat(bump(age) * sparkle.size)
            guard grown > 0.01 else { continue }
            var drawn = context
            drawn.translateBy(x: centre.x + CGFloat(sparkle.x) * bagSide, y: centre.y + CGFloat(sparkle.y) * bagSide)
            drawn.rotate(by: .radians(age * 1.4))
            drawn.scaleBy(x: grown, y: grown)
            drawn.fill(starPath, with: .color(tones[sparkle.tone % tones.count]))
        }
    }

    private static func drawShadow(_ context: inout GraphicsContext, under rest: CGPoint, state: BagState, time: Double) {
        let near = clamp(time / landing) * (1 - smooth((time - leaving) / (home - leaving)))
        guard near > 0.05 else { return }
        let width = bagSide * 0.62 * state.scale
        let oval = Path(ellipseIn: CGRect(x: state.centre.x - width / 2, y: rest.y + bagSide * 0.5, width: width, height: 12))
        context.drawLayer { layer in
            layer.addFilter(.blur(radius: 7))
            layer.fill(oval, with: .color(Brand.navy.opacity(0.22 * near)))
        }
    }

    private static func drawBag(_ context: inout GraphicsContext, state: BagState, fade: Double) {
        guard state.opacity * fade > 0.01, state.scale > 0.01, !bagPaths.isEmpty else { return }
        var drawn = context
        drawn.opacity = state.opacity * fade
        drawn.translateBy(x: state.centre.x, y: state.centre.y)
        drawn.rotate(by: .radians(state.turn))
        let unit = bagSide / 24 * state.scale
        drawn.scaleBy(x: unit * state.stretch.width, y: unit * state.stretch.height)
        drawn.translateBy(x: -12, y: -12)
        let line = StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round)
        for piece in bagPaths where !piece.knockout {
            let paint = GraphicsContext.Shading.color(piece.deep ? deepRed : red)
            if piece.mode == "fill" || piece.mode == "both" { drawn.fill(piece.path, with: paint) }
            if piece.mode != "fill" { drawn.stroke(piece.path, with: paint, style: line) }
        }
        // The percent, white on the red, where the tab's icon cuts it clear.
        for piece in bagPaths where piece.knockout {
            if piece.mode == "fill" || piece.mode == "both" { drawn.fill(piece.path, with: .color(.white)) }
            if piece.mode != "fill" { drawn.stroke(piece.path, with: .color(.white), style: line) }
        }
    }

    /// Where a piece is `age` seconds after it left: thrown, slowing, falling.
    static func flight(_ piece: Piece, age: Double) -> CGPoint {
        let thrown = piece.speed * (1 - exp(-2.8 * age)) / 2.8
        return CGPoint(
            x: CGFloat(cos(piece.angle) * thrown),
            y: CGFloat(sin(piece.angle) * thrown + 0.5 * 560 * age * age)
        )
    }

    /// How long a piece is drawn after it leaves.
    static let pieceLife: Double = 1.1

    private static func drawPieces(_ context: inout GraphicsContext, from mouth: CGPoint, time: Double, width: CGFloat) {
        let life = pieceLife
        // A narrow phone throws them a little less far, so they stay on it.
        let reach = CGFloat(min(1, max(0.72, Double(width) / 390)))
        for piece in pieces {
            let age = time - pop - piece.delay
            guard age > 0, age < life else { continue }
            let moved = flight(piece, age: age)
            let fade: Double = age < life * 0.55 ? 1 : 1 - (age - life * 0.55) / (life * 0.45)
            let grown = CGFloat(min(1, age / 0.09)) * piece.size
            // Tumbling: all but the percent chip narrow and widen as they turn.
            let turned: Double = piece.kind == 0 ? 1 : 0.3 + 0.7 * abs(cos(piece.flip * age))
            var drawn = context
            drawn.opacity = fade
            drawn.translateBy(x: mouth.x + moved.x * reach, y: mouth.y + moved.y * reach)
            drawn.rotate(by: .radians(piece.spin * age))
            drawn.scaleBy(x: grown * CGFloat(turned), y: grown)
            switch piece.kind {
            case 0: percentChip(&drawn)
            case 1: priceTag(&drawn, colour: piece.colour % 2 == 0 ? Brand.orange : Brand.navy)
            case 2: coin(&drawn)
            default: streamer(&drawn, colour: [Brand.navy, sky, red, Brand.orange][piece.colour % 4])
            }
        }
    }

    /// A red disc with a white percent.
    private static func percentChip(_ context: inout GraphicsContext) {
        let r: CGFloat = 13
        context.fill(Path(ellipseIn: CGRect(x: -r, y: -r, width: r * 2, height: r * 2)), with: .color(red))
        let dot = r * 0.2
        context.fill(Path(ellipseIn: CGRect(x: -r * 0.36 - dot, y: -r * 0.34 - dot, width: dot * 2, height: dot * 2)), with: .color(.white))
        context.fill(Path(ellipseIn: CGRect(x: r * 0.36 - dot, y: r * 0.34 - dot, width: dot * 2, height: dot * 2)), with: .color(.white))
        var slash = Path()
        slash.move(to: CGPoint(x: -r * 0.36, y: r * 0.46))
        slash.addLine(to: CGPoint(x: r * 0.36, y: -r * 0.46))
        context.stroke(slash, with: .color(.white), style: StrokeStyle(lineWidth: r * 0.2, lineCap: .round))
    }

    /// A price tag: a rounded label with its string hole.
    private static func priceTag(_ context: inout GraphicsContext, colour: Color) {
        let tag = Path(roundedRect: CGRect(x: -12, y: -8, width: 24, height: 16), cornerRadius: 5, style: .continuous)
        context.fill(tag, with: .color(colour))
        context.fill(Path(ellipseIn: CGRect(x: -8.6, y: -2.4, width: 4.8, height: 4.8)), with: .color(.white))
        var mark = Path()
        mark.move(to: CGPoint(x: -0.5, y: 0))
        mark.addLine(to: CGPoint(x: 7, y: 0))
        context.stroke(mark, with: .color(Color.white.opacity(0.85)), style: StrokeStyle(lineWidth: 2.4, lineCap: .round))
    }

    /// A NetLet point: the coin's amber, with its darker rim.
    private static func coin(_ context: inout GraphicsContext) {
        let r: CGFloat = 9
        let disc = Path(ellipseIn: CGRect(x: -r, y: -r, width: r * 2, height: r * 2))
        context.fill(disc, with: .color(amber))
        context.stroke(Path(ellipseIn: CGRect(x: -r + 2.4, y: -r + 2.4, width: (r - 2.4) * 2, height: (r - 2.4) * 2)), with: .color(amberRim), lineWidth: 1.4)
    }

    private static func streamer(_ context: inout GraphicsContext, colour: Color) {
        context.fill(Path(roundedRect: CGRect(x: -3, y: -8, width: 6, height: 16), cornerRadius: 3), with: .color(colour))
    }
}

/// A shelf of the Deals page rising into place as the burst plays over it,
/// each a little after the one above: opacity and an offset alone, so nothing
/// in the page is laid out again: they come up as the bag bursts, under the
/// pieces it throws. Still under Reduce Motion, and on the app's own moves to
/// the tab, which play no burst.
struct DealRise: ViewModifier {
    let order: Int
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var down = false

    func body(content: Content) -> some View {
        content
            .opacity(down ? 0 : 1)
            .offset(y: down ? 26 : 0)
            .onChange(of: app.dealsBurst) { _, _ in
                guard !still else { return }
                var cut = Transaction()
                cut.disablesAnimations = true
                withTransaction(cut) { down = true }
                Task { @MainActor in
                    // A frame later, or the two changes are one and nothing moves.
                    try? await Task.sleep(for: .milliseconds(40))
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.8).delay(0.46 + Double(order) * 0.07)) { down = false }
                }
            }
    }
}
