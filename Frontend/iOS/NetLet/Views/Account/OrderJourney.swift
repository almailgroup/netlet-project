import SwiftUI

/// Where an order is, drawn under it on My orders, on the owner's word ("for
/// the products shown in the orders page, a design for their status of
/// delivery below them — if it's on the way, a delivery icon animation to the
/// house; if it's still processing, a processing animation — simple for the
/// user to understand"). The web's `OrderJourney`, drawn the same.
///
/// One road from the store's box to the shopper's house, with three words
/// under it — Processing, On the way, Delivered — and the stage it is at
/// moving: the box rocks inside a turning ring of dashes while it is got
/// ready, the van drives the road toward the house while it is on the way
/// (the road filling behind it, a ring going out from the house), and the
/// house is green with a tick once it has arrived. The word under the stage
/// it is at is the order's own phrase. An order that left the road —
/// cancelled, returned — has no road, only its word.
///
/// The motion is a pure function of the clock (`JourneyRoad`), drawn by a
/// timeline that runs only while something moves and never under Reduce
/// Motion, when the van stands half-way. VoiceOver hears it as one element:
/// "Order status", then where it is.
struct OrderJourney: View {
    let progress: OrderProgress
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let stage = ReceiptRules.journeyStage(progress.kind)
        let phrase = OrderWording.progress(progress, language: l)
        if let at = stage.step {
            let moving = !reduceMotion && stage != .delivered
            VStack(alignment: .leading, spacing: 6) {
                TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !moving)) { context in
                    JourneyRoad(
                        stage: stage,
                        time: moving ? context.date.timeIntervalSinceReferenceDate : nil,
                        rightToLeft: l.current.isRightToLeft
                    )
                }
                .frame(height: 48)
                HStack(alignment: .top, spacing: 8) {
                    ForEach(Array(JourneyStage.road.enumerated()), id: \.offset) { index, entry in
                        let alignment: Alignment = index == 0 ? .leading : index == 2 ? .trailing : .center
                        let text: TextAlignment = index == 0 ? .leading : index == 2 ? .trailing : .center
                        Text(index == at ? phrase : l.t(JourneyRoad.word(entry)))
                            .font(.inter(12, index == at ? .heavy : .semibold))
                            .foregroundStyle(index == at ? Brand.navy : index < at ? JourneyRoad.passed : Brand.muted)
                            .multilineTextAlignment(text)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: alignment)
                    }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(l.t("orders.journeyLabel"))
            .accessibilityValue(phrase)
        } else {
            let cancelled = stage == .cancelled
            Label {
                Text(phrase).font(.inter(13, .bold))
            } icon: {
                Image(systemName: cancelled ? "xmark.circle" : "arrow.uturn.backward").font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(cancelled ? JourneyRoad.stoppedInk : JourneyRoad.passed)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Capsule().fill(cancelled ? JourneyRoad.stoppedFill : JourneyRoad.overFill))
        }
    }
}

/// The road itself at one moment: the box, the road with its fill and the
/// van, and the house. Laid out left to right and mirrored by hand on the
/// Arabic page, so the van's place on the road is the same arithmetic in
/// both languages.
struct JourneyRoad: View {
    let stage: JourneyStage
    /// The clock, while something moves; nil draws it still.
    let time: TimeInterval?
    let rightToLeft: Bool

    static let wait = Color(red: 198 / 255, green: 209 / 255, blue: 224 / 255)
    static let grey = Color(red: 138 / 255, green: 153 / 255, blue: 176 / 255)
    static let green = Color(red: 47 / 255, green: 125 / 255, blue: 58 / 255)
    static let amber = Color(red: 224 / 255, green: 169 / 255, blue: 46 / 255)
    static let amberFill = Color(red: 1, green: 248 / 255, blue: 220 / 255)
    static let amberInk = Color(red: 112 / 255, green: 85 / 255, blue: 35 / 255)
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

    private var done: Color { stage == .delivered ? Self.green : Brand.navy }

    var body: some View {
        let motion = JourneyMotion(time: time)
        HStack(spacing: 4) {
            box(motion)
            road(motion)
            house(motion)
        }
        .scaleEffect(x: rightToLeft ? -1 : 1)
        .environment(\.layoutDirection, .leftToRight)
    }

    /// The store's box: rocking amber in a turning ring while it is got
    /// ready, navy with a tick once it has left.
    private func box(_ motion: JourneyMotion) -> some View {
        let processing = stage == .processing
        return ZStack {
            Circle().fill(processing ? Self.amberFill : .white)
            Circle().strokeBorder(processing ? Self.amber : done, lineWidth: 2)
            if processing {
                Circle()
                    .strokeBorder(Self.amber, style: StrokeStyle(lineWidth: 2, dash: [4, 3.5]))
                    .frame(width: 48, height: 48)
                    .rotationEffect(.degrees(motion.ringTurn))
            }
            Image(systemName: "shippingbox")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(processing ? Self.amberInk : done)
                .rotationEffect(.degrees(processing ? motion.bob.angle : 0))
                .offset(y: CGFloat(processing ? motion.bob.lift : 0))
                // A picture with a handedness: unmirror it on the Arabic page.
                .scaleEffect(x: rightToLeft ? -1 : 1)
            if stage != .processing { tick(navy: true) }
        }
        .frame(width: 36, height: 36)
    }

    /// The dashed road, filled behind the van as it goes.
    private func road(_ motion: JourneyMotion) -> some View {
        GeometryReader { space in
            let width = space.size.width
            let fill: Double = stage == .delivered ? 1 : stage == .onTheWay ? motion.drive.distance : 0
            ZStack(alignment: .leading) {
                Path { path in
                    path.move(to: CGPoint(x: 0, y: 2))
                    path.addLine(to: CGPoint(x: width, y: 2))
                }
                .stroke(Self.wait, style: StrokeStyle(lineWidth: 4, dash: [7, 5]))
                .frame(height: 4)
                Capsule()
                    .fill(done)
                    .frame(width: max(0, width * CGFloat(fill)), height: 4)
                    .opacity(stage == .onTheWay ? motion.drive.roadOpacity : 1)
            }
            .frame(maxHeight: .infinity)
            .overlay(alignment: .leading) {
                if stage != .delivered {
                    van(motion)
                        .offset(x: max(0, width - 32) * CGFloat(stage == .onTheWay ? motion.drive.distance : 0))
                        .opacity(stage == .onTheWay ? motion.drive.vanOpacity : 1)
                }
            }
        }
    }

    /// The van on a white plate, so the road's dashes never run through it.
    private func van(_ motion: JourneyMotion) -> some View {
        Image(systemName: "box.truck")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(stage == .onTheWay ? done : Self.grey)
            .offset(y: CGFloat(stage == .onTheWay ? motion.bump : 0))
            .frame(width: 32, height: 26)
            .background(Capsule().fill(.white))
    }

    /// The shopper's house: waiting with a ring going out while the van is on
    /// the road, green with a tick once it has arrived.
    private func house(_ motion: JourneyMotion) -> some View {
        let arrived = stage == .delivered
        return ZStack {
            if stage == .onTheWay {
                Circle()
                    .strokeBorder(Brand.navy.opacity(0.3), lineWidth: 2)
                    .scaleEffect(CGFloat(motion.wait.scale))
                    .opacity(motion.wait.opacity)
            }
            Circle().fill(arrived ? done : .white)
            Circle().strokeBorder(arrived ? done : Self.wait, lineWidth: 2)
            Image(systemName: "house")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(arrived ? .white : Self.grey)
            if arrived { tick(navy: false) }
        }
        .frame(width: 36, height: 36)
    }

    /// The small tick on a stop's corner — on the box once it has left, on
    /// the house once it has arrived (white on the green house).
    private func tick(navy: Bool) -> some View {
        ZStack {
            Circle().fill(navy ? done : .white)
            Circle().strokeBorder(navy ? .white : done, lineWidth: 2)
            Image(systemName: "checkmark")
                .font(.system(size: 8, weight: .black))
                .foregroundStyle(navy ? .white : done)
        }
        .frame(width: 18, height: 18)
        // The tick's own glyph unmirrored; its place on the stop's end corner
        // is mirrored with the road, which is the corner the web's is on.
        .scaleEffect(x: rightToLeft ? -1 : 1)
        .offset(x: 14, y: -14)
    }
}

/// The journey's motion at one moment — the web's keyframes as arithmetic,
/// so a picture of it at any time is the same picture.
struct JourneyMotion: Equatable {
    /// The van's trip, every 3.4 seconds: it fades in, drives the road over
    /// the first 80% easing in and out, and fades at the house.
    struct Drive: Equatable {
        var distance: Double
        var vanOpacity: Double
        var roadOpacity: Double
    }

    struct Bob: Equatable {
        var angle: Double
        var lift: Double
    }

    struct Wait: Equatable {
        var scale: Double
        var opacity: Double
    }

    var drive: Drive
    var bump: Double
    var ringTurn: Double
    var bob: Bob
    var wait: Wait

    static let tripSeconds = 3.4

    init(time: TimeInterval?) {
        guard let time else {
            // Still: the van half-way, nothing turning.
            drive = Drive(distance: 0.5, vanOpacity: 1, roadOpacity: 1)
            bump = 0
            ringTurn = 0
            bob = Bob(angle: 0, lift: 0)
            wait = Wait(scale: 1, opacity: 0)
            return
        }
        drive = JourneyMotion.drive(at: time)
        let sway = 0.5 - 0.5 * cos(2 * .pi * time / 0.6)
        bump = -1.5 * sway
        ringTurn = 360 * time.truncatingRemainder(dividingBy: 3.2) / 3.2
        let rock = 0.5 - 0.5 * cos(2 * .pi * time / 2.8)
        bob = Bob(angle: -6 + 12 * rock, lift: 1 - 3 * rock)
        let pulse = time.truncatingRemainder(dividingBy: 1.7) / 1.7
        let eased = 1 - pow(1 - pulse, 3)
        wait = Wait(scale: 1 + 0.55 * eased, opacity: 0.9 * (1 - pulse))
    }

    static func drive(at time: TimeInterval) -> Drive {
        let phase = time.truncatingRemainder(dividingBy: tripSeconds) / tripSeconds
        let along = min(phase / 0.8, 1)
        let distance = 0.5 - 0.5 * cos(.pi * along)
        let vanOpacity = phase < 0.1 ? phase / 0.1 : phase > 0.8 ? max(0, 1 - (phase - 0.8) / 0.2) : 1
        let roadOpacity = phase > 0.8 ? max(0, 1 - (phase - 0.8) / 0.2) : 1
        return Drive(distance: distance, vanOpacity: vanOpacity, roadOpacity: roadOpacity)
    }
}
