import SwiftUI

/// The web's liquid glass (`.glass-bar-surface` in `index.css`): what passes
/// under it blurred and brightened, under a white tint that is thicker at the
/// top than the foot, with a bright rim along its top edge.
///
/// The tint is the phone's — 60% white at the top and 45% at the foot, the
/// figures the owner chose for the phone's bar and tab bar — and is what keeps
/// the words on it legible over anything dark that scrolls under them. Every
/// control drawn on it stays solid; the glass is only ever the background.
struct GlassSurface: View {
    var top: Double = 0.6
    var foot: Double = 0.45
    /// The bright top edge — only where the surface is the top of the glass,
    /// or two rows of one header read as two strips.
    var rim = true
    /// How far the same glass reaches up past the view's top — behind the
    /// status bar, for the header row at the top of the screen — at the top's
    /// tint. One blur and one tint from the clock to the row's foot: two panes
    /// of glass meeting under the status bar drew a line where they met, and
    /// the strip above read darker than the row (the owner's screenshot).
    var reach: CGFloat = 0

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            VStack(spacing: 0) {
                Color.white.opacity(top).frame(height: reach)
                LinearGradient(colors: [Color.white.opacity(top), Color.white.opacity(foot)], startPoint: .top, endPoint: .bottom)
            }
        }
        .padding(.top, -reach)
        .overlay(alignment: .top) {
            if rim { Rectangle().fill(Color.white.opacity(0.95)).frame(height: 1) }
        }
    }
}

/// The same glass inside a capsule, with the tab bar's hairline rim and its
/// soft shadow — `MobileTabBar`'s floating pill.
struct GlassCapsule: View {
    var body: some View {
        GlassSurface()
            .clipShape(Capsule())
            .overlay(Capsule().strokeBorder(Color.black.opacity(0.12), lineWidth: 1))
            .overlay(Capsule().inset(by: 1).strokeBorder(Color.white.opacity(0.6), lineWidth: 1))
            .shadow(color: Brand.navy.opacity(0.12), radius: 14, x: 0, y: 8)
            .shadow(color: Brand.navy.opacity(0.06), radius: 1.5, x: 0, y: 1)
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
        case .frost: return Color.white.opacity(0.55)
        case .navy: return Brand.navy.opacity(enabled ? 1 : 0.35)
        case .orange: return Brand.orange.opacity(enabled ? 1 : 0.45)
        case .danger: return Brand.danger.opacity(enabled ? 1 : 0.35)
        case .success: return Brand.success
        case .bright: return Color.white.opacity(0.82)
        }
    }

    /// iOS 17 and 18: the fill the button had before the glass.
    @ViewBuilder
    private var earlier: some View {
        switch tone {
        case .clear:
            shape.fill(pressed ? Brand.pressFill : Color.white)
                .shadow(color: Brand.navy.opacity(lifted ? 0.16 : 0), radius: 7, y: 3)
                .overlay(shape.strokeBorder(Brand.navy.opacity(0.2), lineWidth: 1))
        case .frost:
            ZStack {
                shape.fill(Color.white.opacity(0.01)).shadow(color: Brand.navy.opacity(lifted ? 0.2 : 0.14), radius: lifted ? 10 : 6, y: lifted ? 5 : 2)
                shape.fill(.ultraThinMaterial)
                shape.fill(Color.white.opacity(pressed ? 0.75 : 0.62))
                shape.strokeBorder(Color.black.opacity(0.1), lineWidth: 1)
            }
        case .navy:
            shape.fill(enabled ? (pressed ? Brand.navyPressed : Brand.navy) : Brand.navy.opacity(0.35))
                .shadow(color: Brand.navy.opacity(lifted ? 0.28 : 0), radius: 15, y: 10)
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
            shape.fill(Color.white)
                .shadow(color: Brand.navy.opacity(lifted ? 0.12 : 0), radius: 12, y: 6)
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
}
