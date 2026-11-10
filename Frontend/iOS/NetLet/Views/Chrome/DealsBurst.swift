import SwiftUI
import UIKit

/// The Deals tab's own moment, on the owner's word ("when you tap on the
/// deals icon in the bottom menu, it would display a cool animation for deals,
/// to make it more appealing"): the tab's red bag leaps out of the bar to the
/// middle of the screen, lands with a squash and a tap, and bursts — percent
/// chips, price tags, coins and streamers in the shop's colours fanning out
/// and falling away while two rings spread from it — then lifts off and is
/// gone, about a second and a half in all, as the page's shelves rise in
/// under it (`DealRise`).
///
/// It is drawn over the whole app in one `Canvas` by the clock, so it lays
/// nothing out and re-renders no page, runs at the screen's own rate, and
/// **takes no touch**: the Deals page under it is usable from the first
/// frame. A press on the tab plays it — the tab you are on too — and the
/// app's own moves to the tab never do. Reduce Motion plays nothing, and
/// VoiceOver is told nothing, since nothing it says has changed.
///
/// The bag is the tab icon's own drawing (`tabIcons.json`), its percent in
/// white rather than cut clear, so it reads over whatever the page shows.
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
        Task { @MainActor in
            // The bag lands: felt, as a press on a product is.
            try? await Task.sleep(for: .milliseconds(Int(DealsBurstScene.landing * 1000)))
            guard started == now else { return }
            Haptics.action()
            try? await Task.sleep(for: .milliseconds(Int((DealsBurstScene.length - DealsBurstScene.landing) * 1000) + 60))
            // A second press began another: that one ends itself.
            if started == now { started = nil }
        }
    }
}

/// The burst's drawing, a pure function of the time since it began — so one
/// frame can be drawn for a picture, and a test can ask where things are.
enum DealsBurstScene {
    /// The bag reaches the middle and lands.
    static let landing: Double = 0.44
    /// The pieces leave the bag, a moment before it has settled.
    static let pop: Double = 0.40
    /// The bag starts to lift away.
    static let leaving: Double = 1.05
    /// Nothing is drawn after this.
    static let length: Double = 1.5
    /// The bag's side at rest, in points.
    static let bagSide: CGFloat = 132

    struct Piece: Sendable {
        /// 0 a percent chip, 1 a price tag, 2 a coin, 3 a streamer.
        let kind: Int
        /// Where it flies, in radians; negative sine is up the screen.
        let angle: Double
        let speed: Double
        let spin: Double
        let size: CGFloat
        let delay: Double
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
        let count = 30
        for index in 0..<count {
            // A fan over the bag, a little wider than a half circle.
            let spread = -Double.pi * (0.08 + 0.84 * (Double(index) + next() * 0.8) / Double(count))
            let kind = index % 5 == 0 ? 2 : index % 3 == 0 ? 1 : index % 2 == 0 ? 0 : 3
            made.append(Piece(
                kind: kind,
                angle: spread,
                speed: 520 + next() * 520,
                spin: (next() - 0.5) * 14,
                size: CGFloat(0.8 + next() * 0.5),
                delay: next() * 0.09,
                colour: index
            ))
        }
        return made
    }()

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

    private static let red = Color(red: 214 / 255, green: 32 / 255, blue: 31 / 255)
    private static let deepRed = Color(red: 163 / 255, green: 24 / 255, blue: 27 / 255)
    private static let amber = Color(red: 245 / 255, green: 184 / 255, blue: 61 / 255)
    private static let amberRim = Color(red: 201 / 255, green: 140 / 255, blue: 24 / 255)
    private static let sky = Color(red: 157 / 255, green: 179 / 255, blue: 214 / 255)

    // MARK: Curves

    static func clamp(_ value: Double) -> Double { min(1, max(0, value)) }
    static func easeOut(_ value: Double) -> Double { 1 - pow(1 - clamp(value), 3) }
    static func easeIn(_ value: Double) -> Double { pow(clamp(value), 3) }
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
        let leap = time / landing
        let along = overshoot(leap)
        var centre = CGPoint(
            x: origin.x + (rest.x - origin.x) * CGFloat(along),
            y: origin.y + (rest.y - origin.y) * CGFloat(along)
        )
        var scale = CGFloat(0.2 + 0.8 * easeOut(leap))
        let turn = (1 - easeOut(leap)) * -0.42 + sin(clamp(leap) * .pi) * 0.12
        // The landing: wider and shorter for a moment, then itself.
        let squash = sin(clamp((time - landing) / 0.24) * .pi)
        let stretch = CGSize(width: 1 + 0.16 * squash, height: 1 - 0.13 * squash)
        // A breath after it lands, dying away.
        if time > landing {
            let since = time - landing
            centre.y += CGFloat(sin(since * 7) * 5 * exp(-since * 2.4))
        }
        // Lifting off.
        let gone = easeIn((time - leaving) / (length - leaving))
        centre.y -= CGFloat(70 * gone)
        scale *= CGFloat(1 - 0.5 * gone)
        return BagState(centre: centre, scale: scale, stretch: stretch, turn: turn, opacity: 1 - gone)
    }

    // MARK: Drawing

    static func draw(_ context: inout GraphicsContext, size: CGSize, time: Double, bottomInset: CGFloat, barOnTop: Bool = false) {
        guard time >= 0, time <= length else { return }
        let from = origin(in: size, bottomInset: bottomInset, barOnTop: barOnTop)
        let to = rest(in: size)
        let state = bagState(at: time, from: from, to: to)

        drawRings(&context, at: to, time: time)
        // What flew first is behind the bag; it is the bag they came out of.
        drawPieces(&context, from: CGPoint(x: to.x, y: to.y - bagSide * 0.18), time: time, width: size.width)
        drawShadow(&context, under: to, state: state, time: time)
        drawBag(&context, state: state)
    }

    private static func drawRings(_ context: inout GraphicsContext, at centre: CGPoint, time: Double) {
        for (index, colour) in [red, Brand.orange].enumerated() {
            let age = (time - pop - Double(index) * 0.13) / 0.7
            guard age > 0, age < 1 else { continue }
            let radius = CGFloat(50 + 190 * easeOut(age))
            let circle = Path(ellipseIn: CGRect(x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2))
            context.stroke(circle, with: .color(colour.opacity(0.5 * (1 - age))), lineWidth: CGFloat(4 - 3 * age))
        }
    }

    private static func drawShadow(_ context: inout GraphicsContext, under rest: CGPoint, state: BagState, time: Double) {
        let near = clamp(time / landing) * state.opacity
        guard near > 0.05 else { return }
        let width = bagSide * 0.62 * state.scale
        let oval = Path(ellipseIn: CGRect(x: state.centre.x - width / 2, y: rest.y + bagSide * 0.5, width: width, height: 12))
        context.drawLayer { layer in
            layer.addFilter(.blur(radius: 7))
            layer.fill(oval, with: .color(Brand.navy.opacity(0.22 * near)))
        }
    }

    private static func drawBag(_ context: inout GraphicsContext, state: BagState) {
        guard state.opacity > 0.01, !bagPaths.isEmpty else { return }
        var drawn = context
        drawn.opacity = state.opacity
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

    private static func drawPieces(_ context: inout GraphicsContext, from mouth: CGPoint, time: Double, width: CGFloat) {
        let life = 1.0
        // A narrow phone throws them a little less far, so they stay on it.
        let reach = Double(min(1, max(0.72, width / 390)))
        for piece in pieces {
            let age = time - pop - piece.delay
            guard age > 0, age < life else { continue }
            let moved = flight(piece, age: age)
            let fade = age < life * 0.55 ? 1 : 1 - (age - life * 0.55) / (life * 0.45)
            let grown = CGFloat(min(1, age / 0.09)) * piece.size
            var drawn = context
            drawn.opacity = fade
            drawn.translateBy(x: mouth.x + moved.x * CGFloat(reach), y: mouth.y + moved.y * CGFloat(reach))
            drawn.rotate(by: .radians(piece.spin * age))
            drawn.scaleBy(x: grown, y: grown)
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
/// in the page is laid out again. Still under Reduce Motion, and on the app's
/// own moves to the tab, which play no burst.
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
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.8).delay(0.3 + Double(order) * 0.07)) { down = false }
                }
            }
    }
}
