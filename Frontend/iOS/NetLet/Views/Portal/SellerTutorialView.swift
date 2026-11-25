import SwiftUI

/// "Show me" beside a step of a new listing, the editor's variants or the
/// import, opening that step's mini tutorial — the web's `ShowMe`, on the
/// owner's word ("Add video/mini tutorials for adding products").
struct ShowMeButton: View {
    let tutorial: String
    @State private var open = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if let lesson = SellerTutorial.named(tutorial) {
            Button { open = true } label: {
                Label(l.t("howTo.showMe"), systemImage: "play.circle")
            }
            .buttonStyle(PortalSmallButtonStyle())
            .accessibilityLabel(l.t("howTo.showMeName", ["title": l.t(lesson.title)]))
            .accessibilityIdentifier("show-me-\(tutorial)")
            .sheet(isPresented: $open) {
                SellerTutorialSheet(tutorial: lesson).languageDirection()
            }
        }
    }
}

/// The player: a tutorial's scenes, each drawn from its clock and holding its
/// last frame, with Back, Next and Play again. Under Reduce Motion each scene
/// is shown finished. The drawing is hidden from VoiceOver; the caption is the step.
struct SellerTutorialSheet: View {
    let tutorial: SellerTutorial
    @State private var index = 0
    @State private var round = 0
    @State private var start = Date()
    @State private var finished = false
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var still

    private var scene: TutorialScene { tutorial.scenes[min(index, tutorial.scenes.count - 1)] }
    private var last: Bool { index >= tutorial.scenes.count - 1 }
    private var end: Double { TutorialClock.sceneEnd(scene) { words in words.text(l).count } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(l.t("howTo.stepOf", ["n": "\(index + 1)", "total": "\(tutorial.scenes.count)"]))
                        .font(.inter(13)).foregroundStyle(Brand.muted)
                    TimelineView(.animation(paused: still || finished)) { context in
                        let now = still || finished ? Double.infinity : context.date.timeIntervalSince(start) * 1000
                        VStack(alignment: .leading, spacing: 14) {
                            if tutorial.scenes.count > 1 { bars(now) }
                            stage(now)
                        }
                    }
                    Text(scene.caption.text(l))
                        .font(.inter(15, .medium))
                        .foregroundStyle(Brand.navy)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("tutorial-caption")
                    Text(l.t("howTo.example")).font(.inter(12)).foregroundStyle(Brand.muted)
                }
                .padding(16)
            }
            .background(PortalLook.ground.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) { footer }
            .navigationTitle(l.t(tutorial.title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { BarButton(l.t("common.close")) { dismiss() } }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task(id: "\(index)-\(round)") {
            start = Date()
            finished = false
            guard !still else { return }
            try? await Task.sleep(for: .milliseconds(Int(end) + 250))
            if !Task.isCancelled { finished = true }
        }
    }

    private func bars(_ now: Double) -> some View {
        HStack(spacing: 6) {
            ForEach(tutorial.scenes.indices, id: \.self) { step in
                let fill = step < index ? 1 : step > index ? 0 : TutorialClock.progress(0, now, span: max(1, end))
                Capsule().fill(Calm.track)
                    .overlay(alignment: .leading) {
                        GeometryReader { box in Capsule().fill(Brand.navy).frame(width: box.size.width * fill) }
                    }
                    .frame(height: 4)
            }
        }
        .accessibilityHidden(true)
    }

    private func stage(_ now: Double) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(scene.parts.enumerated()), id: \.offset) { _, part in
                TutorialPartView(part: part, now: now)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 210, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Brand.photo))
        .accessibilityHidden(true)
        .id("\(index)-\(round)")
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if !still {
                Button { round += 1 } label: { Label(l.t("howTo.replay"), systemImage: "arrow.counterclockwise") }
                    .buttonStyle(PortalSmallButtonStyle())
            }
            Spacer(minLength: 0)
            if index > 0 {
                Button(l.t("howTo.back")) { index -= 1 }
                    .buttonStyle(PortalSmallButtonStyle())
            }
            Button(l.t(last ? "howTo.done" : "howTo.next")) {
                if last { dismiss() } else { index += 1 }
            }
            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
            .accessibilityIdentifier("tutorial-next")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassBar()
    }
}

/// One part of a scene at one moment of its clock.
private struct TutorialPartView: View {
    let part: TutorialPart
    let now: Double
    @Environment(LanguageSettings.self) private var l

    private func say(_ words: TutorialWords?) -> String { words?.text(l) ?? "" }

    var body: some View {
        switch part.kind {
        case "field": field
        case "select": select
        case "button": button
        case "photos": photos
        case "fix": fix
        case "rows": rows
        case "bullets": bullets
        case "chips": chips
        case "status": status
        case "card": TutorialCard(was: part.was).appearing(part.at, now)
        case "search": search
        case "note": note
        default: EmptyView()
        }
    }

    private func label(_ words: TutorialWords?) -> some View {
        Text(say(words)).font(.inter(12, .semibold)).foregroundStyle(Brand.navy)
    }

    private var field: some View {
        let text = say(part.value)
        let count = text.count
        let shown = part.fill ? (now >= part.at ? text : "") : String(text.prefix(TutorialClock.typedCount(count, at: part.at, t: now)))
        let typingEnd = TutorialClock.partEnd(part) { _ in count }
        let focused = now >= part.at - 200 && now < typingEnd + 300
        let flash = part.fill ? 1 - TutorialClock.progress(part.at, now, span: 700) : 0
        let direction: LayoutDirection = part.direction == "ltr" ? .leftToRight : part.direction == "rtl" ? .rightToLeft : l.layoutDirection
        return VStack(alignment: .leading, spacing: 4) {
            label(part.label)
            HStack(spacing: 0) {
                Text(shown).font(.inter(13)).foregroundStyle(Brand.ink).lineLimit(part.lines > 1 ? nil : 1)
                if focused && !part.fill && now.isFinite && Int(now / 380) % 2 == 0 {
                    Rectangle().fill(Brand.navy).frame(width: 1.5, height: 15)
                }
                Spacer(minLength: 0)
            }
            .environment(\.layoutDirection, direction)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: part.lines > 1 ? 62 : 34, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(flash > 0 && flash < 1 ? Brand.orange.opacity(0.14 * flash) : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(focused ? Brand.navy : Brand.line, lineWidth: 1))
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Brand.navy.opacity(focused ? 0.12 : 0), lineWidth: 6))
        }
    }

    private var select: some View {
        let chosen = now >= part.at + 220
        return VStack(alignment: .leading, spacing: 4) {
            label(part.label)
            HStack {
                Text(chosen ? say(part.value) : "—").font(.inter(13)).foregroundStyle(chosen ? Brand.ink : Brand.chevron)
                Spacer(minLength: 0)
                Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.muted)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 34)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            .pressRing(part.at, now, cornerRadius: 10)
        }
    }

    private static let symbols = ["sparkles": "sparkles", "upload": "square.and.arrow.up", "plus": "plus", "download": "arrow.down.doc", "check": "checkmark", "send": "paperplane"]

    private var button: some View {
        let primary = part.tone == "primary"
        return HStack(spacing: 6) {
            if let icon = part.icon, let symbol = Self.symbols[icon] { Image(systemName: symbol).font(.system(size: 12, weight: .semibold)) }
            Text(say(part.label)).font(.inter(13, .semibold)).lineLimit(1)
        }
        .foregroundStyle(primary ? Color.white : Brand.navy)
        .padding(.horizontal, 14)
        .frame(minHeight: 34)
        .background(Capsule().fill(primary ? Brand.navy : Color.white))
        .overlay(Capsule().strokeBorder(primary ? Color.clear : Brand.line, lineWidth: 1))
        .pressRing(part.at, now, cornerRadius: 17)
    }

    private var photos: some View {
        HStack(spacing: 8) {
            ForEach(Array(part.times.enumerated()), id: \.offset) { slot, at in
                let p = TutorialClock.progress(at, now, span: 360)
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(Brand.line, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .frame(width: 60, height: 60)
                    .overlay {
                        if p > 0 {
                            TutorialPhoto(look: "fixed")
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay(alignment: .topLeading) {
                                    if slot == 0 {
                                        Text(l.t("admin.newPhotoCover")).font(.inter(9, .semibold)).foregroundStyle(.white)
                                            .padding(.horizontal, 4).padding(.vertical, 1)
                                            .background(RoundedRectangle(cornerRadius: 4).fill(Brand.navy)).padding(3)
                                    }
                                }
                                .opacity(p)
                                .scaleEffect(0.9 + 0.1 * p)
                                .offset(y: (1 - p) * -10)
                        }
                    }
            }
        }
    }

    private var fix: some View {
        let chosen = now >= part.at ? part.pick : 0
        return HStack(alignment: .top, spacing: 10) {
            ForEach(Array(part.options.enumerated()), id: \.offset) { slot, option in
                VStack(alignment: .leading, spacing: 4) {
                    TutorialPhoto(look: option.look)
                        .frame(width: 84, height: option.look == "square" ? 84 : 63)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(slot == chosen ? Brand.navy : Brand.cardLine, lineWidth: 2))
                        .pressRing(slot == part.pick ? part.at : -10_000, now, cornerRadius: 8)
                    Text(say(option.label)).font(.inter(11, slot == chosen ? .semibold : .regular))
                        .foregroundStyle(slot == chosen ? Brand.navy : Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(width: 84, alignment: .leading)
                }
            }
        }
    }

    @ViewBuilder
    private var rows: some View {
        if part.style == "list" {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(part.rows.enumerated()), id: \.offset) { _, row in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Brand.success)
                        Text(say(row.cells.first)).font(.inter(13)).foregroundStyle(Brand.muted)
                        Text(say(row.cells.dropFirst().first)).font(.inter(13, .semibold)).foregroundStyle(Brand.ink).lineLimit(1)
                    }
                    .appearing(row.at, now)
                }
            }
        } else {
            let sheet = part.style == "sheet"
            let headFill = sheet ? Color(red: 233 / 255, green: 240 / 255, blue: 230 / 255) : Brand.tint
            Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(part.head.enumerated()), id: \.offset) { _, cell in
                        Text(say(cell)).font(.inter(11, .semibold)).foregroundStyle(Brand.body)
                            .padding(6)
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                            .background(headFill)
                    }
                }
                ForEach(Array(part.rows.enumerated()), id: \.offset) { _, row in
                    Divider().gridCellUnsizedAxes(.horizontal)
                    GridRow {
                        ForEach(Array(row.cells.enumerated()), id: \.offset) { slot, cell in
                            Text(say(cell)).font(.inter(12)).foregroundStyle(Brand.ink).lineLimit(1)
                                .environment(\.layoutDirection, slot == 0 ? l.layoutDirection : .leftToRight)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(6)
                                .appearing(row.at, now)
                        }
                    }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: sheet ? 6 : 10, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: sheet ? 6 : 10, style: .continuous))
        }
    }

    private var bullets: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(say(part.title)).font(.inter(11, .semibold)).foregroundStyle(Brand.muted)
            ForEach(Array(part.items.enumerated()), id: \.offset) { _, item in
                HStack(spacing: 8) {
                    Circle().fill(Brand.navy).frame(width: 5, height: 5)
                    Text(say(item.words)).font(.inter(13)).foregroundStyle(Brand.ink)
                }
                .appearing(item.at, now)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.photo))
    }

    private var chips: some View {
        let chosen = now >= part.at ? part.pick : -1
        return VStack(alignment: .leading, spacing: 4) {
            label(part.label)
            HStack(spacing: 8) {
                ForEach(Array(part.items.enumerated()), id: \.offset) { slot, item in
                    Text(say(item.words)).font(.inter(12, .semibold))
                        .foregroundStyle(slot == chosen ? Color.white : Brand.navy)
                        .padding(.horizontal, 12).padding(.vertical, 5)
                        .background(Capsule().fill(slot == chosen ? Brand.navy : Color.white))
                        .overlay(Capsule().strokeBorder(slot == chosen ? Brand.navy : Brand.line, lineWidth: 1))
                        .pressRing(slot == part.pick ? part.at : -10_000, now, cornerRadius: 14)
                }
            }
        }
        .appearing(part.at - 400, now)
    }

    private var status: some View {
        let current = TutorialClock.statusAt(part.items.map(\.at), now)
        return HStack(spacing: 6) {
            ForEach(Array(part.items.prefix(current + 1).enumerated()), id: \.offset) { slot, item in
                HStack(spacing: 6) {
                    if slot > 0 { Image(systemName: "chevron.forward").font(.system(size: 10, weight: .semibold)).foregroundStyle(Brand.chevron) }
                    Text(say(item.words)).font(.inter(12, .semibold))
                        .foregroundStyle(Self.statusInk[item.tone ?? ""] ?? Brand.body)
                        .padding(.horizontal, 10).padding(.vertical, 3)
                        .background(Capsule().fill(Self.statusFill[item.tone ?? ""] ?? Brand.tint))
                        .opacity(slot < current ? 0.55 : 1)
                }
                .appearing(item.at, now)
            }
        }
    }

    private static let statusFill: [String: Color] = [
        "muted": Brand.tint, "waiting": Color(red: 1, green: 241 / 255, blue: 214 / 255), "live": Brand.successFill,
    ]
    private static let statusInk: [String: Color] = [
        "muted": Brand.body, "waiting": Color(red: 122 / 255, green: 79 / 255, blue: 0), "live": Brand.success,
    ]

    private var search: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("netlet.net › products › brass-table-lamp").font(.inter(11)).foregroundStyle(Brand.body)
                .environment(\.layoutDirection, .leftToRight)
            Text("\(l.t("howTo.sample.title")) — NetLet").font(.inter(15)).foregroundStyle(Color(red: 26 / 255, green: 13 / 255, blue: 171 / 255))
            Text(l.t("howTo.sample.snippet")).font(.inter(12)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .appearing(part.at, now)
    }

    private var note: some View {
        let ok = part.tone == "ok"
        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: ok ? "checkmark" : "info.circle").font(.system(size: 11, weight: .semibold))
            Text(say(part.text)).font(.inter(12)).fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(ok ? Brand.success : Brand.body)
        .appearing(part.at, now)
    }
}

private extension View {
    /// Rises into place as it appears.
    func appearing(_ at: Double, _ now: Double) -> some View {
        let p = TutorialClock.progress(at, now, span: 300)
        return opacity(p).offset(y: (1 - p) * 6)
    }

    /// The ring a press leaves, and the dip of the press itself.
    func pressRing(_ at: Double, _ now: Double, cornerRadius: CGFloat) -> some View {
        let p = TutorialClock.progress(at, now, span: 520)
        let pressing = p > 0 && p < 1
        return scaleEffect(pressing && p < 0.35 ? 0.96 : 1)
            .overlay {
                if pressing {
                    RoundedRectangle(cornerRadius: cornerRadius + 4, style: .continuous)
                        .stroke(Brand.orange.opacity(0.4 * (1 - p)), lineWidth: 3 + 6 * p)
                        .padding(-(3 + 9 * p) / 2)
                }
            }
    }
}

/// The example lamp in one of its three looks: as taken, fixed, made square.
private struct TutorialPhoto: View {
    let look: String

    var body: some View {
        let raw = look == "raw"
        ZStack {
            (raw ? Color(red: 214 / 255, green: 208 / 255, blue: 197 / 255) : Color.white)
            GeometryReader { box in
                TutorialLamp()
                    .scaleEffect(raw ? 0.7 : look == "square" ? 0.92 : 0.84)
                    .rotationEffect(.degrees(raw ? -7 : 0))
                    .offset(x: raw ? box.size.width * 0.14 : 0, y: raw ? box.size.height * 0.12 : 0)
                    .brightness(raw ? -0.15 : 0)
                    .saturation(raw ? 0.7 : 1)
            }
        }
    }
}

/// A brass table lamp, in the web's `Lamp` points on a 100-unit square.
struct TutorialLamp: View {
    var body: some View {
        Canvas { context, size in
            let unit = min(size.width, size.height) / 100
            let left = (size.width - 100 * unit) / 2
            let top = (size.height - 100 * unit) / 2
            func point(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: left + x * unit, y: top + y * unit) }
            func rect(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> CGRect { CGRect(x: left + x * unit, y: top + y * unit, width: w * unit, height: h * unit) }
            func color(_ hex: UInt32) -> GraphicsContext.Shading {
                .color(Color(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255))
            }
            context.fill(Path(ellipseIn: rect(47.4, 14.4, 5.2, 5.2)), with: color(0xb5873a))
            var shade = Path()
            shade.move(to: point(31, 22)); shade.addLine(to: point(69, 22)); shade.addLine(to: point(80, 50)); shade.addLine(to: point(20, 50)); shade.closeSubpath()
            context.fill(shade, with: color(0xf4e6c8))
            context.stroke(shade, with: color(0xd9c39a), style: StrokeStyle(lineWidth: 1.2 * unit, lineJoin: .round))
            var band = Path()
            band.move(to: point(22.5, 44)); band.addLine(to: point(77.5, 44)); band.addLine(to: point(80, 50)); band.addLine(to: point(20, 50)); band.closeSubpath()
            context.fill(band, with: color(0xe8d4ac))
            context.fill(Path(roundedRect: rect(44, 50, 12, 3.4), cornerRadius: 1.4 * unit), with: color(0xa77a2c))
            context.fill(Path(rect(47.2, 53, 5.6, 27)), with: color(0xc4963f))
            context.fill(Path(ellipseIn: rect(32, 78.8, 36, 10.4)), with: color(0xa77a2c))
            context.fill(Path(ellipseIn: rect(34.5, 79.2, 31, 6.4)), with: color(0xcfa14b))
        }
    }
}

/// The product's card as shoppers see it, with the saving when it has one.
private struct TutorialCard: View {
    let was: Bool
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TutorialPhoto(look: "fixed")
                .frame(width: 140, height: 140)
                .overlay(alignment: .topLeading) {
                    if was {
                        Text("−17%").font(.inter(11, .bold)).foregroundStyle(Brand.navy)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(RoundedRectangle(cornerRadius: 5).fill(Brand.orange)).padding(6)
                            .environment(\.layoutDirection, .leftToRight)
                    }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t("howTo.sample.title")).font(.inter(12, .semibold)).foregroundStyle(Brand.ink).lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(Money(fils: 12_500).formatted(l.current)).font(.inter(13, .bold)).foregroundStyle(Brand.navy)
                    if was { Text(Money(fils: 15_000).formatted(l.current)).font(.inter(11)).strikethrough().foregroundStyle(Brand.muted) }
                }
            }
            .padding(8)
        }
        .frame(width: 140, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
