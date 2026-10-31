import SwiftUI

/// The count on the heart, the bell, the cart page and a department's filters
/// — a flat 2D badge drawn like a sketch, on the owner's word ("fix the fade
/// which is on top of it, make it high quality 2D sketch design"). It wore a
/// 3D look for a while — the orange lit from above with a gloss fading across
/// its upper half — and the gloss was the fade the owner asked to lose. The
/// web's `CountBadge`, the same drawing.
///
/// The brand orange, flat, inside a navy ink line, on a white sticker edge —
/// no gradient, no blur and no shadow (the hard navy one dropped down and to
/// the side went too, on the owner's word), so it reads as drawn rather than
/// rendered. The number is
/// navy, 4.65:1 on the orange, and reads left to right in either language.
/// **It hops when it has news and again every five seconds**, on the owner's
/// word: a jump, a squash as it lands and a spring back, on a five-second
/// clock — it was a looping animation whose rest had nothing to animate, so
/// whether it waited the five seconds was the system's guess. Nobody who asked
/// for less motion sees it move. A zero draws nothing.
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

/// The badge's body: flat orange in a navy ink line, a white sticker edge and
/// a hard navy drop — the web's `.count-badge`.
private struct BadgeSurface: View {
    var body: some View {
        Capsule()
            .fill(Brand.orange)
            .overlay(Capsule().strokeBorder(Brand.navy, lineWidth: 1.5))
            .background(Capsule().fill(Color.white).padding(-1.5))
    }
}

/// The hop: up, a squash as it lands, a spring back — once as the badge
/// appears (a new number is a new badge) and then every five seconds by the
/// clock, still in between.
private struct BadgeHop: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var beat = 0

    private struct Pose {
        var lift: CGFloat = 0
        var width: CGFloat = 1
        var height: CGFloat = 1
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if still {
            content
        } else {
            content
                .keyframeAnimator(initialValue: Pose(), trigger: beat) { view, pose in
                    view
                        .scaleEffect(x: pose.width, y: pose.height, anchor: .bottom)
                        .offset(y: pose.lift)
                } keyframes: { _ in
                    KeyframeTrack(\.lift) {
                        CubicKeyframe(-6, duration: 0.16)
                        CubicKeyframe(0, duration: 0.14)
                        CubicKeyframe(-1.5, duration: 0.1)
                        CubicKeyframe(0, duration: 0.12)
                    }
                    KeyframeTrack(\.width) {
                        CubicKeyframe(0.94, duration: 0.16)
                        CubicKeyframe(1.12, duration: 0.14)
                        SpringKeyframe(1, duration: 0.3)
                    }
                    KeyframeTrack(\.height) {
                        CubicKeyframe(1.08, duration: 0.16)
                        CubicKeyframe(0.88, duration: 0.14)
                        SpringKeyframe(1, duration: 0.3)
                    }
                }
                .task {
                    try? await Task.sleep(for: .milliseconds(150))
                    beat += 1
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(5))
                        guard !Task.isCancelled else { return }
                        beat += 1
                    }
                }
        }
    }
}
