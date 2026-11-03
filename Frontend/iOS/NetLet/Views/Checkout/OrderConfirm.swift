import AVFoundation
import SwiftUI

/// "Confirm your order" — the web's `ConfirmOrderDialog`, on the owner's
/// word: Place order "should ask you for confirmation … you should either
/// confirm your purchase or back out. But it should stay in the checkout
/// page." What is coming, where it goes, how it is paid and what the driver
/// collects, with Confirm order and Back; only Confirm places anything, and
/// while it is being placed the sheet cannot be put away.
struct ConfirmOrderSheet: View {
    let cart: Cart
    let address: SavedAddress
    let contact: String
    let total: Money
    let placing: Bool
    let onConfirm: () -> Void
    let onBack: () -> Void
    @Environment(LanguageSettings.self) private var l

    /// How many pictures the strip draws before "+N".
    private static let pictures = 4

    var body: some View {
        let items = cart.items
        let stores = BagGroup.groups(cart)?.count ?? 1
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(l.t("checkout.confirmTitle"))
                        .font(.inter(20, .heavy))
                        .foregroundStyle(Brand.navy)
                        .accessibilityAddTraits(.isHeader)
                    Text(l.t("checkout.confirmBody"))
                        .font(.inter(14))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(spacing: 0) {
                    HStack(spacing: 12) {
                        HStack(spacing: -8) {
                            ForEach(items.prefix(Self.pictures)) { item in
                                Color.clear
                                    .frame(width: 44, height: 44)
                                    .overlay { RemoteImage(reference: item.image?.url, label: item.title(l.current)) }
                                    .background(Brand.photo)
                                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.white, lineWidth: 2))
                            }
                            if items.count > Self.pictures {
                                Text("+\(items.count - Self.pictures)")
                                    .font(.inter(13, .heavy))
                                    .foregroundStyle(Brand.navy)
                                    .frame(width: 44, height: 44)
                                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
                                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.white, lineWidth: 2))
                            }
                        }
                        .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.t("cart.itemCount", ["count": "\(cart.itemCount)"]))
                                .font(.inter(15, .heavy))
                                .foregroundStyle(Brand.navy)
                            Text(stores > 1 ? l.t("checkout.confirmStores", ["count": "\(stores)"]) : (items.first?.title(l.current) ?? ""))
                                .font(.inter(13))
                                .foregroundStyle(Brand.muted)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(14)
                    .accessibilityElement(children: .combine)
                    Divider().overlay(Brand.cardLine)
                    row(icon: "mappin.and.ellipse", tint: Brand.orange, fill: Color(red: 253 / 255, green: 243 / 255, blue: 238 / 255),
                        caption: l.t("home.deliverTo"), title: address.label,
                        lines: [address.line(l.current), contact].filter { !$0.isEmpty })
                    Divider().overlay(Brand.cardLine)
                    row(icon: "banknote", tint: .white, fill: Brand.navy,
                        caption: l.t("checkout.paymentMethod"), title: l.t("checkout.payCod"), lines: [])
                    Divider().overlay(Brand.cardLine)
                    HStack(alignment: .firstTextBaseline) {
                        Text(l.t("checkout.confirmCollected")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                        Spacer(minLength: 8)
                        Text(total.formatted(l.current)).font(.inter(20, .heavy)).foregroundStyle(Brand.navy)
                    }
                    .padding(14)
                    .accessibilityElement(children: .combine)
                }
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                VStack(spacing: 10) {
                    Button(action: onConfirm) {
                        HStack(spacing: 8) {
                            if placing {
                                ProgressView().tint(Brand.navy)
                                Text(l.t("checkout.placing"))
                            } else {
                                Image(systemName: "shippingbox").font(.system(size: 16, weight: .semibold))
                                Text(l.t("checkout.confirmPlace"))
                            }
                        }
                    }
                    .buttonStyle(OrderButtonStyle())
                    .disabled(placing)
                    Button(l.t("checkout.confirmBack"), action: onBack)
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(placing)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 24)
            .padding(.bottom, 16)
        }
        .background(Color(red: 1, green: 253 / 255, blue: 249 / 255).ignoresSafeArea())
        .environment(\.layoutDirection, l.layoutDirection)
        .interactiveDismissDisabled(placing)
        .onAppear { OrderChime.shared.prepare() }
    }

    private func row(icon: String, tint: Color, fill: Color, caption: String, title: String, lines: [String]) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(fill))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(caption).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                Text(title).font(.inter(15, .heavy)).foregroundStyle(Brand.navy)
                ForEach(lines, id: \.self) { line in
                    Text(line).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .accessibilityElement(children: .combine)
    }
}

/// An order just placed — the web's `OrderPlaced`, on the owner's word ("for
/// the order confirmation, add a sound and animation for it"): a navy disc
/// springs in, a ring spreads from it, the tick draws itself and a burst of
/// the brand's colours flies out and falls away, the words rising after, with
/// a success tap and `order-placed.wav`, its bells timed to the tick. Drawn
/// over checkout, so the shopper leaves by their own press. Reduce Motion
/// draws it finished.
struct OrderPlacedView: View {
    let reference: String
    /// What the driver collects; nil from a link that opened it.
    var total: Money? = nil
    let onView: () -> Void
    let onShop: () -> Void
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown = false
    @State private var ticked = false
    @State private var burst = false
    @AccessibilityFocusState private var titleFocused: Bool

    private struct Bit: Identifiable {
        let id: Int
        let angle: Double
        let reach: CGFloat
        let turn: Double
        let bar: Bool
        let colour: Color
    }

    /// Fixed rather than random, the web's own list, so every order looks the same.
    private static let bits: [Bit] = {
        let amber = Color(red: 245 / 255, green: 184 / 255, blue: 61 / 255)
        let sky = Color(red: 157 / 255, green: 179 / 255, blue: 214 / 255)
        let rows: [(Double, CGFloat, Double, Bool, Color)] = [
            (-90, 96, 160, true, Brand.orange), (-62, 84, -120, false, Brand.navy), (-35, 104, 200, true, amber),
            (-8, 88, -180, false, Brand.orange), (18, 100, 140, true, sky), (44, 86, -150, false, Brand.navy),
            (70, 98, 220, true, Brand.orange), (96, 82, -100, false, amber), (122, 102, 180, true, Brand.navy),
            (148, 88, -210, false, sky), (174, 100, 130, true, Brand.orange), (200, 84, -160, false, Brand.navy),
            (226, 104, 190, true, amber), (252, 90, -140, false, Brand.orange),
        ]
        return rows.enumerated().map { Bit(id: $0.offset, angle: $0.element.0, reach: $0.element.1, turn: $0.element.2, bar: $0.element.3, colour: $0.element.4) }
    }()

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                mark
                    .padding(.top, 56)
                Text(l.t("checkout.doneTitle"))
                    .font(.inter(26, .heavy))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.center)
                    .padding(.top, 28)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($titleFocused)
                    .modifier(Rise(shown: shown, delay: 0.38))
                Text(l.t("checkout.doneBody"))
                    .font(.inter(15))
                    .foregroundStyle(Brand.body)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
                    .modifier(Rise(shown: shown, delay: 0.46))
                VStack(spacing: 4) {
                    Text(l.t("checkout.doneNumber")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                    Text(reference)
                        .font(.inter(20, .heavy))
                        .tracking(0.6)
                        .foregroundStyle(Brand.navy)
                        .textSelection(.enabled)
                        .environment(\.layoutDirection, .leftToRight)
                    if let total {
                        Divider().overlay(Brand.cardLine).padding(.vertical, 6)
                        Text(l.t("checkout.donePay", ["amount": total.formatted(l.current)]))
                            .font(.inter(14))
                            .foregroundStyle(Brand.body)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                .accessibilityElement(children: .combine)
                .padding(.top, 20)
                .modifier(Rise(shown: shown, delay: 0.54))
                VStack(spacing: 10) {
                    Button(action: onView) {
                        HStack(spacing: 8) {
                            Text(l.t("checkout.doneView"))
                            Image(systemName: "arrow.forward").font(.system(size: 14, weight: .bold)).flipsForRightToLeftLayoutDirection(true)
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button(l.t("header.continueShopping"), action: onShop)
                        .buttonStyle(SecondaryButtonStyle())
                }
                .padding(.top, 24)
                .modifier(Rise(shown: shown, delay: 0.62))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
        }
        .background(Brand.ground.ignoresSafeArea())
        .environment(\.layoutDirection, l.layoutDirection)
        .task { await play() }
    }

    /// The disc, its ring, the tick and the burst.
    private var mark: some View {
        ZStack {
            ForEach(Self.bits) { bit in
                let radians = bit.angle * .pi / 180
                RoundedRectangle(cornerRadius: bit.bar ? 2 : 4, style: .continuous)
                    .fill(bit.colour)
                    .frame(width: bit.bar ? 6 : 8, height: bit.bar ? 12 : 8)
                    .rotationEffect(.degrees(burst ? bit.turn : 0))
                    .offset(x: burst ? CGFloat(cos(radians)) * bit.reach : 0,
                            y: burst ? CGFloat(sin(radians)) * bit.reach + 26 : 0)
                    .scaleEffect(burst ? 1 : 0.4)
                    .opacity(burst ? 0 : 1)
                    .opacity(shown && !reduceMotion ? 1 : 0)
            }
            Circle()
                .strokeBorder(Brand.orange, lineWidth: 3)
                .frame(width: 112, height: 112)
                .scaleEffect(burst ? 1.9 : 0.75)
                .opacity(burst ? 0 : (shown && !reduceMotion ? 0.6 : 0))
            Circle()
                .fill(Brand.navy)
                .frame(width: 96, height: 96)
                .shadow(color: Brand.navy.opacity(0.35), radius: 14, y: 10)
                .overlay {
                    Tick()
                        .trim(from: 0, to: ticked ? 1 : 0)
                        .stroke(Color.white, style: StrokeStyle(lineWidth: 5.2, lineCap: .round, lineJoin: .round))
                        .frame(width: 48, height: 48)
                }
                .scaleEffect(shown ? 1 : 0.3)
                .opacity(shown ? 1 : 0)
        }
        .frame(width: 112, height: 112)
        .accessibilityHidden(true)
    }

    private func play() async {
        Haptics.succeeded()
        OrderChime.shared.play()
        if reduceMotion {
            shown = true
            ticked = true
            titleFocused = true
            return
        }
        withAnimation(.spring(response: 0.5, dampingFraction: 0.55)) { shown = true }
        try? await Task.sleep(for: .milliseconds(200))
        withAnimation(.timingCurve(0.12, 0.75, 0.3, 1, duration: 1.0)) { burst = true }
        try? await Task.sleep(for: .milliseconds(60))
        withAnimation(.timingCurve(0.65, 0, 0.35, 1, duration: 0.42)) { ticked = true }
        try? await Task.sleep(for: .milliseconds(500))
        titleFocused = true
    }

    /// Words rising into place after the mark, each a little later.
    private struct Rise: ViewModifier {
        let shown: Bool
        let delay: Double
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        func body(content: Content) -> some View {
            content
                .opacity(shown || reduceMotion ? 1 : 0)
                .offset(y: shown || reduceMotion ? 0 : 10)
                .animation(reduceMotion ? nil : .timingCurve(0.2, 0.8, 0.2, 1, duration: 0.46).delay(delay), value: shown)
        }
    }

    /// The tick, in a 24 grid — the web's own path.
    private struct Tick: Shape {
        func path(in rect: CGRect) -> Path {
            let scale = rect.width / 24
            var path = Path()
            path.move(to: CGPoint(x: 6.5 * scale, y: 12.5 * scale))
            path.addLine(to: CGPoint(x: 10.5 * scale, y: 16.5 * scale))
            path.addLine(to: CGPoint(x: 17.5 * scale, y: 8.5 * scale))
            return path
        }
    }
}

/// The sound an order makes when it is placed: `order-placed.wav`, the same
/// file as the web's — a soft thump as the disc springs in, a rising bell
/// arpeggio as the tick draws, an E major chord that rings out. Readied as
/// "Confirm your order" opens, so it strikes with the disc. Silent with the
/// phone's switch and mixed under whatever else is playing, the launch
/// chime's rule; it keeps its player until the sound has run to its end.
final class OrderChime {
    static let shared = OrderChime()
    private var player: AVAudioPlayer?

    func prepare() {
        guard player == nil, let url = Bundle.main.url(forResource: "order-placed", withExtension: "wav") else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, options: [.mixWithOthers])
        guard let sound = try? AVAudioPlayer(contentsOf: url) else { return }
        sound.volume = 0.85
        sound.prepareToPlay()
        player = sound
    }

    func play() {
        prepare()
        guard let sound = player, !sound.isPlaying else { return }
        try? AVAudioSession.sharedInstance().setActive(true)
        sound.currentTime = 0
        sound.play()
        DispatchQueue.main.asyncAfter(deadline: .now() + sound.duration + 0.5) { [weak self] in
            guard self?.player === sound else { return }
            self?.player?.stop()
            self?.player = nil
        }
    }
}
