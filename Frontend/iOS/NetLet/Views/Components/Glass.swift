import SwiftUI

/// The web's liquid glass (`.glass-bar-surface` in `index.css`): what passes
/// under it blurred and brightened, under a white tint that is thicker at the
/// top than the foot.
///
/// The tint is the phone's — 60% white at the top and 45% at the foot, the
/// figures the owner chose for the phone's bar and tab bar — and is what keeps
/// the words on it legible over anything dark that scrolls under them. Every
/// control drawn on it stays solid; the glass is only ever the background.
///
/// **Clean glass, on the owner's word** ("do the same liquid glass cleanup in
/// the iOS app"), after the website's. It blurred through the system's
/// `.ultraThinMaterial`, which keeps its vibrancy by pulling white toward
/// grey: read off the CI's pictures, the product page's header was 243 over a
/// page of 250 — the glass greyer than what it sat on — and the cart's
/// floating bar darkened toward its foot. The blur is now UIKit's light one
/// (`GlassBlur`), which only ever lightens, as the web's does, and the
/// figures here are what the eye gets: the face under them is worked out from
/// the light blur's own white (`GlassBlur.face`), so 60 and 45 read as the
/// web's 60 and 45. `GlassUITests` reads both off a screenshot.
struct GlassSurface: View {
    var top: Double = 0.6
    var foot: Double = 0.45
    /// The light along the top edge — a bright line and a glow fading over
    /// its first 10 points, the web's face — only where the surface is the
    /// top of the glass, or two rows of one header read as two strips.
    var rim = true
    /// How far the same glass reaches up past the view's top — behind the
    /// status bar, for the header row at the top of the screen — at the top's
    /// tint. One blur and one tint from the clock to the row's foot: two panes
    /// of glass meeting under the status bar drew a line where they met, and
    /// the strip above read darker than the row (the owner's screenshot).
    var reach: CGFloat = 0
    /// Its corners. The blur rounds itself and the face is clipped on its
    /// own, never the whole surface (see `GlassBlur`).
    var corners: GlassCorners = .square
    /// Inside a SwiftUI clip of its own — the search sheet's unroll — the
    /// surface keeps the system's material, which a clip cannot break.
    var material = false

    var body: some View {
        ZStack {
            if material {
                Rectangle().fill(.ultraThinMaterial)
            } else {
                GlassBlur(corners: corners).allowsHitTesting(false)
            }
            shaped(tint)
        }
        .padding(.top, -reach)
    }

    /// The white laid over the blur: over the light blur only what it does
    /// not lay down itself.
    private var faceTop: Double { material ? top : GlassBlur.face(top) }
    private var faceFoot: Double { material ? foot : GlassBlur.face(foot) }

    private var tint: some View {
        VStack(spacing: 0) {
            Brand.glassFace.opacity(faceTop).frame(height: reach)
            LinearGradient(colors: [Brand.glassFace.opacity(faceTop), Brand.glassFace.opacity(faceFoot)], startPoint: .top, endPoint: .bottom)
        }
        .overlay(alignment: .top) {
            if rim {
                // The web's face: a glow over the first 10 points and a bright
                // line along the very top.
                LinearGradient(colors: [Brand.glassRim.opacity(0.35), Brand.glassRim.opacity(0)], startPoint: .top, endPoint: .bottom)
                    .frame(height: 10)
                    .overlay(alignment: .top) { Rectangle().fill(Brand.glassRim.opacity(0.9)).frame(height: 1) }
            }
        }
        .allowsHitTesting(false)
    }

    /// The face in the surface's corners — the face alone, never the blur.
    @ViewBuilder private func shaped<V: View>(_ face: V) -> some View {
        switch corners {
        case .square: face
        case .capsule: face.clipShape(Capsule())
        case .radius(let radius): face.clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        }
    }
}

/// A glass surface's corners.
enum GlassCorners: Sendable {
    case square
    case capsule
    case radius(CGFloat)
}

/// What passes under the glass, blurred and saturated and made a little
/// lighter — never darker: UIKit's `.light` blur, which Apple documents as
/// lighter than what is under it. That is the website's bend
/// (`.glass-bar-bend`: a blur and a saturation, the white all in the face).
/// The system's materials pull white toward grey to keep their vibrancy, and
/// under a tint of 45% that grey showed.
///
/// **It rounds itself** (a corner radius on the effect view), because a
/// SwiftUI clip or mask on a UIKit effect view, or on anything holding one,
/// can stop the blur rendering: nothing that wears it is clipped by SwiftUI.
/// It takes no touches, so a drag that starts on the glass is the page's.
struct GlassBlur: UIViewRepresentable {
    var corners: GlassCorners = .square

    /// The white the light blur lays down itself, as a fraction — what
    /// `GlassUITests` reads over black ("blur alone"). The face only adds the
    /// rest.
    nonisolated static var ownWhite: Double { 0.3 }

    /// The face that, over the light blur, gives `total` white in all.
    nonisolated static func face(_ total: Double) -> Double {
        max(0, min(1, (total - ownWhite) / (1 - ownWhite)))
    }

    /// Light, or in dark mode UIKit's dark blur, which only ever darkens.
    private static func style(_ context: Context) -> UIBlurEffect.Style {
        context.environment.colorScheme == .dark ? .dark : .light
    }

    func makeUIView(context: Context) -> RoundedBlurView {
        let style = Self.style(context)
        let view = RoundedBlurView(effect: UIBlurEffect(style: style))
        view.isUserInteractionEnabled = false
        view.corners = corners
        view.style = style
        return view
    }

    func updateUIView(_ view: RoundedBlurView, context: Context) {
        view.corners = corners
        let style = Self.style(context)
        if view.style != style {
            view.style = style
            view.effect = UIBlurEffect(style: style)
        }
    }
}

/// An effect view that rounds its own corners — the one clip UIKit's blur
/// keeps rendering under.
final class RoundedBlurView: UIVisualEffectView {
    /// The blur it was made with, so a change of scheme makes it again once.
    var style: UIBlurEffect.Style = .light
    var corners: GlassCorners = .square {
        didSet { setNeedsLayout() }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        switch corners {
        case .square:
            layer.cornerRadius = 0
            clipsToBounds = false
        case .capsule:
            layer.cornerCurve = .circular
            layer.cornerRadius = min(bounds.width, bounds.height) / 2
            clipsToBounds = true
        case .radius(let radius):
            layer.cornerCurve = .continuous
            layer.cornerRadius = radius
            clipsToBounds = true
        }
    }
}

/// The same glass inside a capsule — the cart's floating Checkout bar and the
/// product page's buy bar — with `MobileTabBar`'s rim and shadow and the web's
/// rounded face: a thin bright rim all round, a brighter line along the top
/// and a touch of depth at the foot, so it reads as a piece of glass rather
/// than a tinted hole. An even 70%, the web's panel and chip, because words
/// sit straight on it; they are in the dark ink, never the muted one.
struct GlassCapsule: View {
    var body: some View {
        FloatingGlass(shape: Capsule(), corners: .capsule)
    }
}

/// The same floating glass in a rounded box — the order's chosen-items bar,
/// on the owner's word ("can you make this Liquid Glass design?").
struct GlassPane: View {
    var radius: CGFloat = 24

    var body: some View {
        FloatingGlass(shape: RoundedRectangle(cornerRadius: radius, style: .continuous), corners: .radius(radius))
    }
}

/// A floating piece of the clean glass in any shape: the even 70% surface,
/// the rim all round with a brighter line along the top and a touch of depth
/// at the foot, a dark hairline outside it and the shadow it casts outside its
/// edge only.
struct FloatingGlass<S: InsettableShape>: View {
    let shape: S
    let corners: GlassCorners

    var body: some View {
        GlassSurface(top: 0.7, foot: 0.7, rim: false, corners: corners)
            .overlay {
                ZStack {
                    shape.inset(by: 1).fill(LinearGradient(stops: [
                        .init(color: Brand.shadow.opacity(0), location: 0.82),
                        .init(color: Brand.shadow.opacity(0.06), location: 1),
                    ], startPoint: .top, endPoint: .bottom))
                    shape.inset(by: 1).strokeBorder(Brand.glassRim.opacity(0.5), lineWidth: 1)
                    shape.inset(by: 1).strokeBorder(LinearGradient(colors: [Brand.glassRim.opacity(0.95), Brand.glassRim.opacity(0)], startPoint: .top, endPoint: .center), lineWidth: 1.5)
                    shape.strokeBorder(Color.black.opacity(0.12), lineWidth: 1)
                }
                .allowsHitTesting(false)
            }
            .background { OuterShadow(shape: shape) }
    }
}

/// The shadow a floating piece of glass casts, outside its edge only — the
/// web's `box-shadow`. A shadow drawn under the glass is part of what the glass
/// blurs, and the cart's bar went grey toward its foot with its own shadow
/// seen through it. The shape casts it and is then cut away (a compositing
/// group, `destinationOut`), a point wider than itself so no dark fringe is
/// left at its edge.
struct OuterShadow<S: InsettableShape>: View {
    let shape: S

    var body: some View {
        ZStack {
            shape.fill(Color.black).shadow(color: Brand.shadow.opacity(0.12), radius: 14, x: 0, y: 8)
            shape.fill(Color.black).shadow(color: Brand.shadow.opacity(0.06), radius: 1.5, x: 0, y: 1)
            shape.inset(by: -1).fill(Color.black).blendMode(.destinationOut)
        }
        .compositingGroup()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

extension View {
    /// A bar at the foot of a page or a sheet in the clean glass: even 82%,
    /// thick enough for the muted words some of them carry, with the light
    /// along its top and a hairline above it — where `.regularMaterial` drew a
    /// grey bar under a system divider.
    func glassBar() -> some View {
        background {
            GlassSurface(top: 0.82, foot: 0.82)
                .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            Rectangle().fill(Brand.navy.opacity(0.08)).frame(height: 1).allowsHitTesting(false)
        }
    }
}

/// Which Liquid Glass a control wears — **most of the app's buttons, on the
/// owner's word** ("make most of the buttons that will look good in Liquid
/// Glass, to make the app look new and up to date"). The system's own glass
/// from iOS 26 (`glassEffect`), tinted so each keeps the colour it had and
/// its words keep their contrast; on iOS 17 and 18 the fills the buttons had
/// before. The glass is the control's surface, never a page's or a card's:
/// what is read stays on white.
enum GlassTone: Sendable {
    /// Light glass under dark words, with a breath of navy so it reads as a
    /// control on the page's white: Buy now, Cancel, a pill beside a line.
    case clear
    /// Light glass that stays bright over anything — a control on a
    /// photograph, a map or a moving page: the tab bar's white tint.
    case frost
    /// The brand's navy under white words: the main action.
    case navy
    /// The brand orange under navy words (4.65:1): Place order, Checkout.
    case orange
    /// The shop's red under white words: an act that cannot be taken back.
    case danger
    /// Green, for the moment a button says it worked.
    case success
    /// Nearly white glass under words that are typed and read on it: the
    /// search field. Bright enough that the muted example keeps its contrast
    /// over whatever the header's glass is carrying, glass at its rim.
    case bright
}

/// A control's surface in Liquid Glass. Interactive while the control is
/// live, so it gives and lights under the finger the way the tab bar does;
/// dimmer and still while it is not.
struct LiquidGlass<S: InsettableShape>: ViewModifier {
    let tone: GlassTone
    let shape: S
    var enabled = true
    /// A finger is on it — what the iOS 17 and 18 drawing shades by; the
    /// system's glass answers a touch by itself.
    var pressed = false
    /// It floats over the page: a soft shadow under it before iOS 26, whose
    /// glass brings its own.
    var lifted = false
    /// Off for glass that is a surface rather than a button — a field, a
    /// toast, a switch's thumb — which should not swell under a finger.
    var interactive = true

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .contentShape(shape)
                .glassEffect(glass, in: shape)
        } else {
            content
                .contentShape(shape)
                .background { earlier }
        }
    }

    @available(iOS 26.0, *)
    private var glass: Glass {
        let tinted = Glass.regular.tint(tint)
        return enabled && interactive ? tinted.interactive() : tinted
    }

    /// The tint the system's glass takes. A whole colour gives glass of that
    /// colour; a faint one only leans it.
    private var tint: Color {
        switch tone {
        case .clear: return Brand.navy.opacity(enabled ? 0.07 : 0.03)
        case .frost: return Brand.glassFace.opacity(0.55)
        case .navy: return Brand.navyFill.opacity(enabled ? 1 : 0.35)
        case .orange: return Brand.orange.opacity(enabled ? 1 : 0.45)
        case .danger: return Brand.danger.opacity(enabled ? 1 : 0.35)
        case .success: return Brand.success
        case .bright: return Brand.glassFace.opacity(0.82)
        }
    }

    /// iOS 17 and 18: the fill the button had before the glass.
    @ViewBuilder
    private var earlier: some View {
        switch tone {
        case .clear:
            shape.fill(pressed ? Brand.pressFill : Brand.surface)
                .shadow(color: Brand.shadow.opacity(lifted ? 0.16 : 0), radius: 7, y: 3)
                .overlay(shape.strokeBorder(Brand.navy.opacity(0.2), lineWidth: 1))
        case .frost:
            ZStack {
                shape.fill(Color.white.opacity(0.01)).shadow(color: Brand.shadow.opacity(lifted ? 0.2 : 0.14), radius: lifted ? 10 : 6, y: lifted ? 5 : 2)
                shape.fill(.ultraThinMaterial)
                shape.fill(Brand.glassFace.opacity(pressed ? 0.75 : 0.62))
                shape.strokeBorder(Color.black.opacity(0.1), lineWidth: 1)
            }
        case .navy:
            shape.fill(enabled ? (pressed ? Brand.navyPressed : Brand.navyFill) : Brand.navyFill.opacity(0.35))
                .shadow(color: Brand.shadow.opacity(lifted ? 0.28 : 0), radius: 15, y: 10)
        case .orange:
            ZStack {
                shape.fill(Brand.orange.opacity(enabled ? 1 : 0.45))
                shape.fill(Brand.navy.opacity(pressed ? 0.06 : 0))
            }
        case .danger:
            shape.fill(Brand.danger.opacity(enabled ? (pressed ? 0.85 : 1) : 0.35))
        case .success:
            shape.fill(Brand.success)
        case .bright:
            shape.fill(Brand.surface)
                .shadow(color: Brand.shadow.opacity(lifted ? 0.12 : 0), radius: 12, y: 6)
                .overlay(shape.strokeBorder(Brand.line, lineWidth: 1))
        }
    }
}

/// Glass controls that sit beside each other — a row of chips, a switch —
/// drawn by the system in one pass (`GlassEffectContainer`), which is what
/// Apple asks for wherever several glass effects share a screen: each effect
/// on its own samples what is behind it again. The spacing is nothing, so two
/// chips never run into one shape; before iOS 26 it is only its content.
/// **One child**, a stack or a layout: how the container lays out several is
/// the system's to decide.
struct GlassGroup<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 0) { content }
        } else {
            content
        }
    }
}

extension View {
    /// The control's surface in Liquid Glass, a capsule unless told otherwise.
    func liquidGlass(_ tone: GlassTone, enabled: Bool = true, pressed: Bool = false, lifted: Bool = false, interactive: Bool = true) -> some View {
        modifier(LiquidGlass(tone: tone, shape: Capsule(), enabled: enabled, pressed: pressed, lifted: lifted, interactive: interactive))
    }

    /// The same in a shape of its own — a disc, a rounded box.
    func liquidGlass<S: InsettableShape>(_ tone: GlassTone, in shape: S, enabled: Bool = true, pressed: Bool = false, lifted: Bool = false, interactive: Bool = true) -> some View {
        modifier(LiquidGlass(tone: tone, shape: shape, enabled: enabled, pressed: pressed, lifted: lifted, interactive: interactive))
    }

    /// A chip that narrows a list — a shelf's department, a subcategory, a
    /// size: navy glass under white words once chosen, clear glass otherwise.
    func glassChip(chosen: Bool) -> some View {
        liquidGlass(chosen ? .navy : .clear)
    }

    /// On a sideways scroll of glass chips: the row draws past the scroll's
    /// own frame. The system's glass brings a soft shadow round each control,
    /// and a scroll view clips at its bounds — a row's are its chips' height —
    /// so the shadows were cut in a hard line a couple of points above and
    /// below the chips, a grey band the width of the row (the CI's pictures of
    /// a department's two rows, enlarged). The row is the screen's width, so
    /// what scrolls out sideways still leaves by the screen's edge.
    func glassRow() -> some View {
        scrollClipDisabled()
    }
}
