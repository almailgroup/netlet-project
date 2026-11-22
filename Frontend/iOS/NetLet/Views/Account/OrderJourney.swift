import SwiftUI

/// Where an order is, drawn under it on My orders, on the owner's word ("for
/// the products shown in the orders page, a design for their status of
/// delivery below them … simple for the user to understand"), and made richer
/// on their word again ("high quality animations and icons … an animation for
/// its tires running, going to its destination"). The web's `OrderJourney`,
/// drawn the same.
///
/// A little street: NetLet's store at the road's start, the shopper's house
/// at its end, the van on the road between, and three words under it —
/// Processing, On the way, Delivered.
///
/// - **Being got ready**, the van waits outside the store with its engine
///   running — a shiver in its body, puffs from its exhaust — while parcels
///   hop from the store's door into its back, the van dipping as each lands; a
///   small amber disc turns on the store's corner.
/// - **On the way**, it drives the road to the house: its wheels turning, its
///   body riding the bumps, puffs and speed lines behind it and the road
///   filling navy, while a pin bobs over the house and its window is lit.
/// - **Delivered**, the van has gone and the parcel is at the door; the road
///   and the tick are green, and a burst goes off round the house once.
///
/// The word under the stage it is at is the order's own phrase. An order that
/// left the road — cancelled, returned — has no road, only its word.
///
/// The street is one `Canvas` drawn from `JourneyMotion`, a pure function of
/// the clock, by a timeline that runs only while something moves and never
/// under Reduce Motion, when the van stands where it waits or half-way. It is
/// drawn left to right and mirrored whole on the Arabic page, so the van
/// drives to the house on the left there and faces it; only the ticks are
/// turned back. VoiceOver hears it as one element: "Order status", then where
/// it is.
struct OrderJourney: View {
    let progress: OrderProgress
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// When a delivered order was first drawn, for its burst, which plays once.
    @State private var landedAt: Date?
    @State private var landing = false

    var body: some View {
        let stage = ReceiptRules.journeyStage(progress.kind)
        let phrase = OrderWording.progress(progress, language: l)
        if let at = stage.step {
            let driving = !reduceMotion && stage != .delivered
            VStack(alignment: .leading, spacing: 6) {
                TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !(driving || landing))) { context in
                    JourneyStreet(
                        stage: stage,
                        motion: JourneyMotion(time: driving ? context.date.timeIntervalSinceReferenceDate : nil),
                        landed: landedFraction(at: context.date),
                        rightToLeft: l.current.isRightToLeft
                    )
                }
                .frame(height: 58)
                HStack(alignment: .top, spacing: 8) {
                    ForEach(Array(JourneyStage.road.enumerated()), id: \.offset) { index, entry in
                        let alignment: Alignment = index == 0 ? .leading : index == 2 ? .trailing : .center
                        let text: TextAlignment = index == 0 ? .leading : index == 2 ? .trailing : .center
                        Text(index == at ? phrase : l.t(JourneyStreet.word(entry)))
                            .font(.inter(12, index == at ? .heavy : .semibold))
                            .foregroundStyle(index == at ? Brand.navy : index < at ? JourneyStreet.passed : Brand.muted)
                            .multilineTextAlignment(text)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: alignment)
                    }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(l.t("orders.journeyLabel"))
            .accessibilityValue(phrase)
            .onAppear {
                guard stage == .delivered, !reduceMotion, landedAt == nil else { return }
                landedAt = Date()
                landing = true
            }
            .task(id: landing) {
                guard landing else { return }
                try? await Task.sleep(for: .milliseconds(1200))
                landing = false
            }
        } else {
            let cancelled = stage == .cancelled
            Label {
                Text(phrase).font(.inter(13, .bold))
            } icon: {
                Image(systemName: cancelled ? "xmark.circle" : "arrow.uturn.backward").font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(cancelled ? JourneyStreet.stoppedInk : JourneyStreet.passed)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(cancelled ? JourneyStreet.stoppedFill : JourneyStreet.overFill))
        }
    }

    /// How far a delivered order's arrival has played: 0 as it is first drawn, 1 once done.
    private func landedFraction(at now: Date) -> Double {
        guard let landedAt, !reduceMotion else { return 1 }
        return min(1, max(0, now.timeIntervalSince(landedAt) / JourneyMotion.landingSeconds))
    }
}

/// The street at one moment, drawn left to right in a `Canvas` and mirrored
/// whole on the Arabic page.
struct JourneyStreet: View {
    let stage: JourneyStage
    let motion: JourneyMotion
    /// A delivered order's arrival, 0 to 1 (`JourneyMotion.landing`).
    let landed: Double
    let rightToLeft: Bool

    static let passed = Color(red: 61 / 255, green: 81 / 255, blue: 112 / 255)
    static let stoppedFill = Color(red: 253 / 255, green: 236 / 255, blue: 235 / 255)
    static let stoppedInk = Color(red: 140 / 255, green: 47 / 255, blue: 34 / 255)
    static let overFill = Color(red: 231 / 255, green: 237 / 255, blue: 245 / 255)

    static func word(_ stage: JourneyStage) -> String {
        switch stage {
        case .onTheWay: return "orders.journeyOnTheWay"
        case .delivered: return "orders.journeyDelivered"
        default: return "orders.journeyProcessing"
        }
    }

    var body: some View {
        Canvas { context, size in
            var street = context
            if rightToLeft {
                street.translateBy(x: size.width, y: 0)
                street.scaleBy(x: -1, y: 1)
            }
            JourneyArt.draw(in: &street, size: size, stage: stage, motion: motion, landed: landed, mirrored: rightToLeft)
        }
        .accessibilityHidden(true)
    }
}

/// The pictures, drawn for this street rather than taken from a symbol set, so
/// the van can turn its wheels and the store can be NetLet's — the web's SVGs
/// in the same coordinates.
enum JourneyArt {
    static let navy = Brand.navy
    static let orange = Brand.orange
    static let green = Color(red: 47 / 255, green: 125 / 255, blue: 58 / 255)
    static let amber = Color(red: 224 / 255, green: 169 / 255, blue: 46 / 255)
    static let sky = Color(red: 219 / 255, green: 231 / 255, blue: 251 / 255)
    static let glass = Color(red: 207 / 255, green: 224 / 255, blue: 245 / 255)
    static let lane = Color(red: 227 / 255, green: 233 / 255, blue: 242 / 255)
    static let tyre = Color(red: 22 / 255, green: 24 / 255, blue: 29 / 255)
    static let hub = Color(red: 223 / 255, green: 230 / 255, blue: 240 / 255)
    static let lamp = Color(red: 1, green: 214 / 255, blue: 107 / 255)
    static let slate = Color(red: 61 / 255, green: 81 / 255, blue: 112 / 255)
    static let kraft = Color(red: 217 / 255, green: 160 / 255, blue: 102 / 255)
    static let tape = Color(red: 138 / 255, green: 90 / 255, blue: 43 / 255)
    static let smoke = Color(red: 198 / 255, green: 209 / 255, blue: 224 / 255)
    static let streak = Color(red: 159 / 255, green: 176 / 255, blue: 200 / 255)

    static let place: CGFloat = 44
    static let vanWidth: CGFloat = 48
    static let vanHeight: CGFloat = 28

    static func draw(in c: inout GraphicsContext, size: CGSize, stage: JourneyStage, motion: JourneyMotion, landed: Double, mirrored: Bool) {
        let height = size.height
        let placeY = height - 2 - place
        let roadX = place + 3
        let roadWidth = max(0, size.width - 2 * place - 6)
        let laneY = height - 12
        let done = stage == .delivered ? green : navy

        // The road, its white line, and how far the van has come.
        let road = Path(roundedRect: CGRect(x: roadX, y: laneY, width: roadWidth, height: 6), cornerRadius: 3)
        c.fill(road, with: .color(lane))
        var line = Path()
        var dash = roadX + 5
        while dash < roadX + roadWidth - 5 {
            line.addRect(CGRect(x: dash, y: laneY + 2.5, width: min(5, roadX + roadWidth - 5 - dash), height: 1))
            dash += 10
        }
        c.fill(line, with: .color(.white))
        let filled: Double = stage == .delivered ? 1 : stage == .onTheWay ? motion.drive.distance : 0
        if filled > 0 {
            let fill = Path(roundedRect: CGRect(x: roadX, y: laneY, width: roadWidth * CGFloat(filled), height: 6), cornerRadius: 3)
            c.fill(fill, with: .color(done.opacity(stage == .onTheWay ? motion.drive.roadOpacity : 1)))
        }

        // The store, and its corner: a turning amber disc while it is got ready, a tick once it has left.
        c.drawLayer { layer in
            layer.translateBy(x: 0, y: placeY)
            store(&layer)
            if stage == .processing {
                spinner(&layer, center: CGPoint(x: 39, y: 4), angle: motion.spinner)
            } else {
                badge(&layer, center: CGPoint(x: 39, y: 4), fill: done, mirrored: mirrored)
            }
        }

        // The parcels hopping into the van while it is loaded.
        if stage == .processing {
            for hop in [JourneyMotion.hop(phase: motion.loadPhase), JourneyMotion.hop(phase: (motion.loadPhase + 0.5).truncatingRemainder(dividingBy: 1))] where hop.opacity > 0 {
                c.drawLayer { layer in
                    layer.opacity = hop.opacity
                    layer.translateBy(x: roadX + CGFloat(hop.x) + 6, y: height - 8 - 6 + CGFloat(hop.y))
                    layer.rotate(by: .degrees(hop.angle))
                    layer.scaleBy(x: CGFloat(hop.scale), y: CGFloat(hop.scale))
                    layer.translateBy(x: -6, y: -6)
                    parcel(&layer, size: 12)
                }
            }
        }

        // The van, until it has gone.
        if stage != .delivered {
            let travel = max(0, roadWidth - 53)
            let vanX = stage == .onTheWay ? roadX + 3 + travel * CGFloat(motion.drive.distance) : roadX + 3
            let vanY = height - 8 - vanHeight
            c.drawLayer { layer in
                layer.opacity = stage == .onTheWay ? motion.drive.vanOpacity : 1
                layer.translateBy(x: vanX, y: vanY)
                if stage == .processing {
                    // The dip as a parcel lands, about its front wheel.
                    let pivot = CGPoint(x: vanWidth * 0.8, y: vanHeight)
                    layer.translateBy(x: pivot.x, y: pivot.y)
                    layer.rotate(by: .degrees(motion.dip))
                    layer.translateBy(x: -pivot.x, y: -pivot.y)
                }
                for puff in motion.puffs(onTheWay: stage == .onTheWay) where puff.opacity > 0 {
                    let radius = 3 * CGFloat(puff.scale)
                    let center = CGPoint(x: CGFloat(puff.x), y: 20 + CGFloat(puff.y))
                    layer.fill(Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)), with: .color(smoke.opacity(puff.opacity)))
                }
                if stage == .onTheWay {
                    for streak in motion.streaks() where streak.opacity > 0 {
                        let bar = Path(roundedRect: CGRect(x: streak.x + CGFloat(streak.dx), y: streak.y, width: streak.width, height: 2), cornerRadius: 1)
                        layer.fill(bar, with: .color(streak.opacity == 0 ? .clear : JourneyArt.streak.opacity(streak.opacity)))
                    }
                }
                layer.scaleBy(x: vanWidth / 52, y: vanHeight / 30)
                van(&layer, lift: CGFloat(motion.bodyLift(onTheWay: stage == .onTheWay)), wheelTurn: stage == .onTheWay ? motion.wheel : 0)
            }
        }

        // The house: the pin over it while the van comes, the parcel at its door and a burst once it has.
        let houseX = size.width - place
        c.drawLayer { layer in
            layer.translateBy(x: houseX, y: placeY)
            house(&layer, windowLit: stage == .onTheWay ? motion.window : 0)
            if stage == .onTheWay {
                layer.drawLayer { pin in
                    pin.translateBy(x: 15, y: -15 + CGFloat(motion.pin))
                    pin.scaleBy(x: 14 / 16, y: 18 / 20)
                    self.pin(&pin)
                }
            }
            if stage == .delivered {
                let arrival = JourneyMotion.landing(landed)
                layer.drawLayer { step in
                    step.opacity = arrival.parcelOpacity
                    step.translateBy(x: 12, y: 30 + CGFloat(arrival.parcelDrop))
                    parcel(&step, size: 12)
                }
                if arrival.burstOpacity > 0 {
                    for ray in 0..<8 {
                        layer.drawLayer { spoke in
                            spoke.opacity = arrival.burstOpacity
                            spoke.translateBy(x: 22, y: 22)
                            spoke.rotate(by: .degrees(Double(ray) * 45))
                            let length = 6 * CGFloat(arrival.burstStretch)
                            spoke.fill(Path(roundedRect: CGRect(x: -1, y: -21 - length + CGFloat(arrival.burstOut), width: 2, height: length), cornerRadius: 1), with: .color(green))
                        }
                    }
                }
                if arrival.tickScale > 0 {
                    layer.drawLayer { tick in
                        tick.translateBy(x: 39, y: 4)
                        tick.scaleBy(x: CGFloat(arrival.tickScale), y: CGFloat(arrival.tickScale))
                        badge(&tick, center: .zero, fill: green, mirrored: mirrored)
                    }
                }
            }
        }
    }

    private static func box(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat, _ radius: CGFloat) -> Path {
        Path(roundedRect: CGRect(x: x, y: y, width: width, height: height), cornerRadius: radius)
    }

    private static func dot(_ x: CGFloat, _ y: CGFloat, _ radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
    }

    /// NetLet's store, in a 44 square: a navy roof line, an awning in the brand's orange, two windows and a door.
    static func store(_ c: inout GraphicsContext) {
        let wall = box(7, 16, 30, 25, 2.5)
        c.fill(wall, with: .color(.white))
        c.stroke(wall, with: .color(navy), lineWidth: 2)
        c.fill(box(10, 22, 6, 6, 1.2), with: .color(sky))
        c.fill(box(28, 22, 6, 6, 1.2), with: .color(sky))
        let door = box(18, 26, 8, 15, 1.5)
        c.fill(door, with: .color(sky))
        c.stroke(door, with: .color(navy), lineWidth: 1.6)
        c.fill(dot(24, 34, 0.9), with: .color(navy))
        c.fill(box(4, 5, 36, 5, 2), with: .color(navy))
        for index in 0..<6 {
            let x = 4 + CGFloat(index) * 6
            let colour: Color = index % 2 == 0 ? orange : .white
            c.fill(Path(CGRect(x: x, y: 10, width: 6, height: 6)), with: .color(colour))
            c.fill(Path(ellipseIn: CGRect(x: x, y: 13, width: 6, height: 6)), with: .color(colour))
        }
        var edge = Path()
        edge.move(to: CGPoint(x: 4, y: 10))
        edge.addLine(to: CGPoint(x: 40, y: 10))
        c.stroke(edge, with: .color(navy), lineWidth: 1)
    }

    /// The shopper's house, in a 44 square, under the brand's own roof — the two bars of the logo.
    static func house(_ c: inout GraphicsContext, windowLit: Double) {
        var walls = Path()
        walls.move(to: CGPoint(x: 10, y: 22))
        walls.addLine(to: CGPoint(x: 10, y: 39.5))
        walls.addQuadCurve(to: CGPoint(x: 11.5, y: 41), control: CGPoint(x: 10, y: 41))
        walls.addLine(to: CGPoint(x: 32.5, y: 41))
        walls.addQuadCurve(to: CGPoint(x: 34, y: 39.5), control: CGPoint(x: 34, y: 41))
        walls.addLine(to: CGPoint(x: 34, y: 22))
        c.fill(walls, with: .color(.white))
        c.stroke(walls, with: .color(navy), lineWidth: 2)
        let window = box(13, 25, 7, 6.5, 1.2)
        c.fill(window, with: .color(sky))
        if windowLit > 0 { c.fill(window, with: .color(lamp.opacity(windowLit))) }
        c.fill(box(24.5, 28, 7, 13, 1.4), with: .color(navy))
        c.fill(dot(30, 35, 0.9), with: .color(.white))
        var roof = Path()
        roof.move(to: CGPoint(x: 5.5, y: 23.5))
        roof.addLine(to: CGPoint(x: 22, y: 8.5))
        roof.addLine(to: CGPoint(x: 38.5, y: 23.5))
        c.stroke(roof, with: .color(orange), style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
    }

    /// NetLet's van in a 52 by 30 box, facing the house: navy with the brand's orange stripe, and wheels that turn.
    static func van(_ c: inout GraphicsContext, lift: CGFloat, wheelTurn: Double) {
        c.drawLayer { body in
            body.translateBy(x: 0, y: lift)
            body.fill(box(2, 3, 32, 19, 3.5), with: .color(navy))
            body.fill(Path(CGRect(x: 2, y: 13.5, width: 32, height: 3)), with: .color(orange))
            var cab = Path()
            cab.move(to: CGPoint(x: 34.5, y: 8.5))
            cab.addLine(to: CGPoint(x: 42.7, y: 8.5))
            cab.addQuadCurve(to: CGPoint(x: 46.2, y: 10.6), control: CGPoint(x: 45, y: 8.5))
            cab.addLine(to: CGPoint(x: 49.5, y: 16.7))
            cab.addQuadCurve(to: CGPoint(x: 50, y: 18.3), control: CGPoint(x: 50, y: 17.4))
            cab.addLine(to: CGPoint(x: 50, y: 21))
            cab.addQuadCurve(to: CGPoint(x: 48, y: 23), control: CGPoint(x: 50, y: 23))
            cab.addLine(to: CGPoint(x: 34.5, y: 23))
            cab.closeSubpath()
            body.fill(cab, with: .color(navy))
            var pane = Path()
            pane.move(to: CGPoint(x: 37, y: 10.8))
            pane.addLine(to: CGPoint(x: 42.6, y: 10.8))
            pane.addQuadCurve(to: CGPoint(x: 44, y: 11.6), control: CGPoint(x: 43.5, y: 10.9))
            pane.addLine(to: CGPoint(x: 46.6, y: 16.8))
            pane.addLine(to: CGPoint(x: 37, y: 16.8))
            pane.closeSubpath()
            body.fill(pane, with: .color(glass))
            body.fill(box(47.3, 18.3, 2.4, 2.2, 1), with: .color(lamp))
            body.fill(box(0.5, 19, 3, 2, 0.8), with: .color(slate))
        }
        for x in [CGFloat(12), CGFloat(40)] {
            let center = CGPoint(x: x, y: 23.5)
            c.fill(dot(center.x, center.y, 5.2), with: .color(tyre))
            c.fill(dot(center.x, center.y, 2.6), with: .color(hub))
            var spokes = Path()
            for step in 0..<3 {
                let angle = (wheelTurn + Double(step) * 60) * .pi / 180
                let reach = CGPoint(x: CGFloat(sin(angle)) * 2.4, y: CGFloat(-cos(angle)) * 2.4)
                spokes.move(to: CGPoint(x: center.x + reach.x, y: center.y + reach.y))
                spokes.addLine(to: CGPoint(x: center.x - reach.x, y: center.y - reach.y))
            }
            c.stroke(spokes, with: .color(tyre), style: StrokeStyle(lineWidth: 0.9, lineCap: .round))
        }
    }

    /// A parcel in kraft card with its tape, drawn into a square of `size`.
    static func parcel(_ c: inout GraphicsContext, size: CGFloat) {
        c.scaleBy(x: size / 14, y: size / 14)
        let card = box(1, 2.5, 12, 10.5, 1.6)
        c.fill(card, with: .color(kraft))
        c.stroke(card, with: .color(tape), lineWidth: 1)
        var crease = Path()
        crease.move(to: CGPoint(x: 1, y: 6))
        crease.addLine(to: CGPoint(x: 13, y: 6))
        c.stroke(crease, with: .color(tape), lineWidth: 0.8)
        c.fill(Path(CGRect(x: 5.6, y: 2.5, width: 2.8, height: 10.5)), with: .color(orange))
    }

    /// Where it is going: a pin in the brand's orange, in a 16 by 20 box.
    static func pin(_ c: inout GraphicsContext) {
        let head = Path(ellipseIn: CGRect(x: 1.5, y: 1.5, width: 13, height: 13))
        var tail = Path()
        tail.move(to: CGPoint(x: 2.4, y: 11))
        tail.addLine(to: CGPoint(x: 13.6, y: 11))
        tail.addLine(to: CGPoint(x: 8, y: 19))
        tail.closeSubpath()
        let shape = Path(head.cgPath.union(tail.cgPath))
        c.fill(shape, with: .color(orange))
        c.stroke(shape, with: .color(navy), lineWidth: 1.4)
        c.fill(dot(8, 8, 2.4), with: .color(.white))
    }

    /// A tick on a stop's corner, its own way round on the Arabic page.
    static func badge(_ c: inout GraphicsContext, center: CGPoint, fill: Color, mirrored: Bool) {
        c.fill(dot(center.x, center.y, 11), with: .color(.white))
        c.fill(dot(center.x, center.y, 9), with: .color(fill))
        let turn: CGFloat = mirrored ? -1 : 1
        var tick = Path()
        tick.move(to: CGPoint(x: center.x - 3.5 * turn, y: center.y + 0.2))
        tick.addLine(to: CGPoint(x: center.x - 1 * turn, y: center.y + 2.6))
        tick.addLine(to: CGPoint(x: center.x + 3.6 * turn, y: center.y - 2.4))
        c.stroke(tick, with: .color(.white), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
    }

    /// The amber disc turning on the store's corner while it is got ready.
    static func spinner(_ c: inout GraphicsContext, center: CGPoint, angle: Double) {
        c.fill(dot(center.x, center.y, 11), with: .color(.white))
        c.fill(dot(center.x, center.y, 9), with: .color(amber))
        c.stroke(dot(center.x, center.y, 4), with: .color(.white.opacity(0.4)), lineWidth: 2)
        var arc = Path()
        arc.addArc(center: center, radius: 4, startAngle: .degrees(angle - 90), endAngle: .degrees(angle), clockwise: false)
        c.stroke(arc, with: .color(.white), style: StrokeStyle(lineWidth: 2, lineCap: .round))
    }
}

/// The journey's motion at one moment — the web's keyframes as arithmetic, so
/// a picture of it at any time is the same picture, and the keyframes can be
/// tested.
struct JourneyMotion: Equatable {
    /// The van's trip, every `tripSeconds`: it fades in, drives the road over
    /// the first 80% easing in and out, and fades at the house.
    struct Drive: Equatable {
        var distance: Double
        var vanOpacity: Double
        var roadOpacity: Double
    }

    /// A parcel on its way from the store's door into the van's back.
    struct Hop: Equatable {
        var x: Double
        var y: Double
        var angle: Double
        var scale: Double
        var opacity: Double
    }

    struct Puff: Equatable {
        var x: Double
        var y: Double
        var scale: Double
        var opacity: Double
    }

    struct Streak: Equatable {
        var x: CGFloat
        var y: CGFloat
        var width: CGFloat
        var dx: Double
        var opacity: Double
    }

    /// A delivered order's arrival: the parcel set down, the tick, the burst.
    struct Landing: Equatable {
        var parcelDrop: Double
        var parcelOpacity: Double
        var tickScale: Double
        var burstOut: Double
        var burstStretch: Double
        var burstOpacity: Double
    }

    /// The clock, or nil for a still picture.
    let time: TimeInterval?
    var drive: Drive

    static let tripSeconds = 3.6
    /// One parcel every half of this, the van dipping as each lands.
    static let loadSeconds = 1.9
    static let landingSeconds = 1.0

    init(time: TimeInterval?) {
        self.time = time
        // Still: the van half-way on the road.
        drive = time.map(JourneyMotion.drive(at:)) ?? Drive(distance: 0.5, vanOpacity: 1, roadOpacity: 1)
    }

    private static func cycle(_ time: TimeInterval, _ seconds: Double) -> Double {
        let phase = time.truncatingRemainder(dividingBy: seconds) / seconds
        return phase < 0 ? phase + 1 : phase
    }

    /// 0 → 1 → 0 over a cycle, smoothly: what CSS's `alternate` with `ease-in-out` draws.
    private static func swing(_ time: TimeInterval, _ seconds: Double) -> Double {
        0.5 - 0.5 * cos(2 * .pi * cycle(time, seconds))
    }

    private static func smooth(_ value: Double) -> Double {
        let t = min(1, max(0, value))
        return t * t * (3 - 2 * t)
    }

    /// Between two keyframes, eased within the segment.
    private static func tween(_ phase: Double, _ frames: [(Double, Double)]) -> Double {
        guard let first = frames.first, let last = frames.last else { return 0 }
        if phase <= first.0 { return first.1 }
        if phase >= last.0 { return last.1 }
        for (from, to) in zip(frames, frames.dropFirst()) where phase <= to.0 {
            let t = smooth((phase - from.0) / (to.0 - from.0))
            return from.1 + (to.1 - from.1) * t
        }
        return last.1
    }

    static func drive(at time: TimeInterval) -> Drive {
        let phase = cycle(time, tripSeconds)
        let along = min(phase / 0.8, 1)
        let distance = 0.5 - 0.5 * cos(.pi * along)
        let fade = phase > 0.8 ? max(0, 1 - (phase - 0.8) / 0.14) : 1
        let vanOpacity = phase < 0.1 ? phase / 0.1 : fade
        return Drive(distance: distance, vanOpacity: vanOpacity, roadOpacity: fade)
    }

    /// A parcel's hop at a point of its cycle (the web's `journey-hop`).
    static func hop(phase: Double) -> Hop {
        Hop(
            x: tween(phase, [(0, -24), (0.45, -8), (0.74, 5), (0.84, 7)]),
            y: tween(phase, [(0, 0), (0.45, -17), (0.74, -5)]),
            angle: tween(phase, [(0, 0), (0.45, -25), (0.74, -50), (0.84, -55)]),
            scale: tween(phase, [(0.74, 1), (0.84, 0.5)]),
            opacity: tween(phase, [(0, 0), (0.12, 1), (0.74, 1), (0.84, 0)])
        )
    }

    /// The van's dip, in degrees, at a point of half a loading cycle: a parcel landed just before.
    static func dip(phase: Double) -> Double {
        tween(phase, [(0, 0), (0.48, 0), (0.56, -3), (0.64, 1), (0.78, 0)])
    }

    /// A delivered order's arrival at a fraction of `landingSeconds`.
    static func landing(_ fraction: Double) -> Landing {
        let seconds = fraction * landingSeconds
        let drop = min(1, seconds / 0.45)
        let back = 1 + 2.2 * pow(drop - 1, 3) + 1.2 * pow(drop - 1, 2)
        let pop = min(1, max(0, (seconds - 0.15) / 0.5))
        let popped = pop == 0 ? 0 : 1 + 2.6 * pow(pop - 1, 3) + 1.6 * pow(pop - 1, 2)
        let burst = min(1, max(0, (seconds - 0.25) / 0.7))
        return Landing(
            parcelDrop: -14 * (1 - back),
            parcelOpacity: min(1, drop * 2.5),
            tickScale: popped,
            burstOut: 6 - 11 * burst,
            burstStretch: 0.3 + 0.7 * burst,
            burstOpacity: burst <= 0 || burst >= 1 ? 0 : (burst < 0.35 ? burst / 0.35 : 1 - (burst - 0.35) / 0.65)
        )
    }

    /// Where the loading is, 0 to 1, over `loadSeconds`.
    var loadPhase: Double { time.map { JourneyMotion.cycle($0, JourneyMotion.loadSeconds) } ?? 0.95 }
    var dip: Double { time.map { JourneyMotion.dip(phase: JourneyMotion.cycle($0, JourneyMotion.loadSeconds / 2)) } ?? 0 }
    /// The wheels' turn, a turn every 0.42s.
    var wheel: Double { time.map { 360 * JourneyMotion.cycle($0, 0.42) } ?? 0 }
    var spinner: Double { time.map { 360 * JourneyMotion.cycle($0, 0.9) } ?? 0 }
    var pin: Double { time.map { -3 * JourneyMotion.swing($0, 1.6) } ?? 0 }
    var window: Double { time.map { 0.55 + 0.45 * JourneyMotion.swing($0, 3.2) } ?? 1 }

    /// The body's shiver with the engine running, or its ride over the bumps.
    func bodyLift(onTheWay: Bool) -> Double {
        guard let time else { return 0 }
        return onTheWay ? -1 * JourneyMotion.swing(time, 0.52) : -0.6 * JourneyMotion.swing(time, 0.28)
    }

    /// Three puffs from the exhaust: slow and upward while it waits, quick and behind it on the road.
    func puffs(onTheWay: Bool) -> [Puff] {
        guard let time else { return [] }
        let seconds = onTheWay ? 0.75 : 1.5
        return (0..<3).map { index in
            let t = JourneyMotion.cycle(time + Double(index) * seconds / 3, seconds)
            let out = 1 - pow(1 - t, 3)
            return onTheWay
                ? Puff(x: -18 * out, y: -5 * out, scale: 0.5 + 1.1 * out, opacity: 0.8 * (1 - out))
                : Puff(x: -9 * out, y: -10 * out, scale: 0.4 + 1.3 * out, opacity: 0.75 * (1 - out))
        }
    }

    /// The two speed lines behind the van on the road.
    func streaks() -> [Streak] {
        guard let time else { return [] }
        return [(CGFloat(-13), CGFloat(9), CGFloat(9), 0.0), (CGFloat(-10), CGFloat(15), CGFloat(6), 0.3)].map { x, y, width, offset in
            let t = JourneyMotion.cycle(time + offset, 0.6)
            let opacity = t < 0.3 ? 0.9 * t / 0.3 : 0.9 * (1 - (t - 0.3) / 0.7)
            return Streak(x: x, y: y, width: width, dx: 4 - 12 * t, opacity: opacity)
        }
    }
}
