import SwiftUI

/// The count on the cart and the profile tab, drawn as pixel art — the web's
/// `PixelBadge`, square for square.
///
/// One sprite of unit squares, two points to a unit: a navy outline stepped
/// at the corners the way a pixel-art circle is, the orange inside, one pale
/// pixel of shine, and the number in a 3 × 5 pixel font from the table below,
/// read left to right in either language. A new number hops at once — it
/// crouches, jumps and lands with a squash, throwing four pixels off its
/// corners at the top — and hops again every ten seconds, on the owner's word;
/// every pose is held rather than tweened, which is what makes it move like a
/// sprite. Nobody who asked for less motion sees it move. A zero draws nothing.
struct PixelBadge: View {
    let value: Int

    var body: some View {
        if value > 0 {
            let text = value > 99 ? "99+" : String(value)
            HoppingSprite(sprite: PixelSprite.badge(text))
                .id(text)
                .accessibilityHidden(true)
        }
    }
}

/// The account's dot: the same sprite with no number, six units square.
struct PixelDot: View {
    var body: some View {
        HoppingSprite(sprite: PixelSprite.dot())
            .accessibilityHidden(true)
    }
}

/// Which squares are lit, in which colour, on a grid of `width` × `height` units.
struct PixelSprite {
    let width: Int
    let height: Int
    var outline: [(Int, Int)] = []
    var body: [(Int, Int)] = []
    var shine: (Int, Int)
    var glyphs: [(Int, Int)] = []

    static let unit: CGFloat = 2

    private static let font: [Character: [String]] = [
        "0": ["111", "101", "101", "101", "111"],
        "1": ["010", "110", "010", "010", "111"],
        "2": ["111", "001", "111", "100", "111"],
        "3": ["111", "001", "111", "001", "111"],
        "4": ["101", "101", "111", "001", "001"],
        "5": ["111", "100", "111", "001", "111"],
        "6": ["111", "100", "111", "101", "111"],
        "7": ["111", "001", "001", "001", "001"],
        "8": ["111", "101", "111", "101", "111"],
        "9": ["111", "101", "111", "001", "111"],
        "+": ["000", "010", "111", "010", "000"],
    ]

    /// A pill: an outline, a unit of orange, the glyphs a unit apart, the same
    /// on the far side, and a second unit of orange either side so one digit is square.
    static func badge(_ text: String) -> PixelSprite {
        let width = 1 + 2 + text.count * 4 - 1 + 2 + 1
        var sprite = shape(width: width, height: 9, steps: 2, shine: (2, 1))
        for (index, character) in text.enumerated() {
            guard let rows = font[character] else { continue }
            for (y, row) in rows.enumerated() {
                for (x, on) in row.enumerated() where on == "1" {
                    sprite.glyphs.append((3 + index * 4 + x, 2 + y))
                }
            }
        }
        return sprite
    }

    static func dot() -> PixelSprite {
        shape(width: 6, height: 6, steps: 1, shine: (1, 1))
    }

    private static func shape(width: Int, height: Int, steps: Int, shine: (Int, Int)) -> PixelSprite {
        var sprite = PixelSprite(width: width, height: height, shine: shine)
        for y in 0..<height {
            let from = max(0, steps - min(y, height - 1 - y))
            let to = width - 1 - from
            guard from <= to else { continue }
            for x in from...to {
                if x == from || x == to || y == 0 || y == height - 1 {
                    sprite.outline.append((x, y))
                } else {
                    sprite.body.append((x, y))
                }
            }
        }
        return sprite
    }

    var size: CGSize { CGSize(width: CGFloat(width) * Self.unit, height: CGFloat(height) * Self.unit) }
}

private struct SpriteCanvas: View {
    let sprite: PixelSprite

    var body: some View {
        Canvas { context, _ in
            func fill(_ cells: [(Int, Int)], _ color: Color) {
                var path = Path()
                for (x, y) in cells {
                    path.addRect(CGRect(x: CGFloat(x) * PixelSprite.unit, y: CGFloat(y) * PixelSprite.unit, width: PixelSprite.unit, height: PixelSprite.unit))
                }
                context.fill(path, with: .color(color))
            }
            fill(sprite.outline, Brand.navy)
            fill(sprite.body, Brand.orange)
            fill([sprite.shine], Color(red: 1, green: 195 / 255, blue: 166 / 255))
            fill(sprite.glyphs, Brand.navy)
        }
        .frame(width: sprite.size.width, height: sprite.size.height)
        // A sprite reads the same either way round; the digits never mirror.
        .environment(\.layoutDirection, .leftToRight)
    }
}

/// The hop: seven held poses in the first 0.7 seconds of every ten.
private struct HoppingSprite: View {
    let sprite: PixelSprite
    @Environment(\.accessibilityReduceMotion) private var still

    private enum Pose: CaseIterable {
        case crouch, rise, top, fall, land, settle, rest

        /// How long the pose before this one is held — the keyframes' spacing.
        var wait: Double {
            switch self {
            case .crouch: return 0.096
            case .rise, .top, .land, .settle: return 0.096
            case .fall: return 0.112
            case .rest: return 0.096
            }
        }

        var scale: CGSize {
            switch self {
            case .crouch, .land: return CGSize(width: 1.18, height: 0.82)
            case .rise: return CGSize(width: 0.88, height: 1.14)
            case .top: return CGSize(width: 1.12, height: 1.12)
            case .settle: return CGSize(width: 0.95, height: 1.05)
            case .fall, .rest: return CGSize(width: 1, height: 1)
            }
        }

        var lift: CGFloat {
            switch self {
            case .rise, .fall: return -4
            case .top: return -7
            default: return 0
            }
        }

        /// How far the four sparks have flown, or nil when they are not drawn.
        var spark: CGFloat? {
            switch self {
            case .top: return 3
            case .fall: return 6
            case .land: return 9
            default: return nil
            }
        }
    }

    var body: some View {
        if still {
            SpriteCanvas(sprite: sprite)
        } else {
            PhaseAnimator(Pose.allCases) { pose in
                SpriteCanvas(sprite: sprite)
                    .scaleEffect(pose.scale, anchor: .bottom)
                    .offset(y: pose.lift)
                    .overlay { sparks(pose.spark) }
            } animation: { pose in
                // Held, not tweened: each pose arrives at once after the last
                // one's time; the rest holds for the remainder of ten seconds.
                .linear(duration: 0.001).delay(pose == .crouch ? 9.408 : pose.wait)
            }
        }
    }

    @ViewBuilder
    private func sparks(_ distance: CGFloat?) -> some View {
        if let distance {
            let size = sprite.size
            ZStack {
                ForEach(0..<4, id: \.self) { corner in
                    let dx: CGFloat = corner % 2 == 0 ? -1 : 1
                    let dy: CGFloat = corner < 2 ? -1 : 1
                    Rectangle()
                        .fill(Brand.orange)
                        .frame(width: 2, height: 2)
                        .offset(x: dx * (size.width / 2 + distance), y: dy * (size.height / 2 + distance))
                }
            }
        }
    }
}
