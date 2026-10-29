import SwiftUI

/// The count on the heart, the bell, the cart page and a department's filters
/// — a small rounded badge lit from above, on the owner's word, who asked for
/// a modern 3D look in place of the pixel art the badges wore. The web's
/// `CountBadge`, the same surface.
///
/// The brand orange, lighter at the top and `#f2683a` at the foot, a soft
/// gloss on the upper half, a fine light edge above and a darker one below,
/// inside a white rim and lifted by a small navy shadow. The number is navy —
/// 4.65:1 at the darkest orange, more where it is lighter — and reads left to
/// right in either language. A new number hops at once, a smooth rise and a
/// small settle, and again every five seconds, the rhythm the owner asked for;
/// nobody who asked for less motion sees it move. A zero draws nothing.
struct CountBadge: View {
    let value: Int

    var body: some View {
        if value > 0 {
            let text = value > 99 ? "99+" : String(value)
            Text(text)
                .font(.inter(11, .heavy))
                .monospacedDigit()
                .foregroundStyle(Brand.navy)
                .lineLimit(1)
                .padding(.horizontal, text.count > 1 ? 5 : 0)
                .frame(minWidth: 18, minHeight: 18)
                .background(BadgeSurface())
                .modifier(BadgeHop())
                .id(text)
                .environment(\.layoutDirection, .leftToRight)
                .accessibilityHidden(true)
        }
    }
}

/// Something is waiting, without a number: the same surface as a small dot.
struct NoticeDot: View {
    var body: some View {
        BadgeSurface()
            .frame(width: 10, height: 10)
            .modifier(BadgeHop())
            .accessibilityHidden(true)
    }
}

/// The badge's body: the orange lit from above, the gloss, the edges, the rim
/// and the shadow — the web's `.count-badge`.
private struct BadgeSurface: View {
    private static let top = Color(red: 248 / 255, green: 149 / 255, blue: 109 / 255)
    private static let middle = Color(red: 244 / 255, green: 122 / 255, blue: 78 / 255)
    private static let edge = Color(red: 176 / 255, green: 62 / 255, blue: 24 / 255)

    var body: some View {
        Capsule()
            .fill(LinearGradient(colors: [Self.top, Self.middle, Brand.orange], startPoint: .top, endPoint: .bottom))
            .overlay {
                Capsule()
                    .fill(LinearGradient(colors: [Color.white.opacity(0.55), Color.white.opacity(0)], startPoint: .top, endPoint: .center))
                    .padding(.horizontal, 2)
                    .padding(.top, 1)
            }
            .overlay {
                Capsule()
                    .strokeBorder(LinearGradient(colors: [Color.white.opacity(0.55), Self.edge.opacity(0.35)], startPoint: .top, endPoint: .bottom), lineWidth: 1)
            }
            .background(Capsule().fill(Color.white).padding(-1.5))
            .shadow(color: Brand.navy.opacity(0.28), radius: 2.5, x: 0, y: 2)
    }
}

/// The hop: up, a small squash, a spring back, and still for the rest of five
/// seconds — smooth where the pixel badge's poses were held.
private struct BadgeHop: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var still

    private enum Phase: CaseIterable {
        case rest, up, squash, settle

        var scale: CGSize {
            switch self {
            case .up: return CGSize(width: 1.08, height: 1.08)
            case .squash: return CGSize(width: 1.06, height: 0.94)
            case .rest, .settle: return CGSize(width: 1, height: 1)
            }
        }

        var lift: CGFloat { self == .up ? -5 : 0 }
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if still {
            content
        } else {
            content.phaseAnimator(Phase.allCases) { view, phase in
                view
                    .scaleEffect(phase.scale, anchor: .bottom)
                    .offset(y: phase.lift)
            } animation: { phase in
                switch phase {
                case .up: return .easeOut(duration: 0.18)
                case .squash: return .easeIn(duration: 0.14)
                case .settle: return .spring(response: 0.32, dampingFraction: 0.55)
                // Held at rest for the rest of five seconds, then up again.
                case .rest: return .linear(duration: 0.01).delay(4.3)
                }
            }
        }
    }
}
