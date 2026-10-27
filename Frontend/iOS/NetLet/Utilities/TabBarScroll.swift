import SwiftUI

/// When the tab bar steps out of the way, on the owner's word: it slides away
/// once the shopper has scrolled *down a little* and comes back as soon as
/// they scroll up — never on the first point of a scroll. The web's
/// `tabBarScroll.ts`, number for number, and tested on its cases.
///
/// The rule is the distance travelled in one direction, reset whenever the
/// direction turns: `tuckAfter` down sends it away, `showAfter` up brings it
/// back, so a small bounce either way changes nothing. Near the top of a page
/// it is always there, and at its foot too, where there is nothing more to
/// scroll to. A single move longer than a screen is a jump (the logo taking
/// the page to its top, a restored position), not somebody scrolling, and
/// shows it.
struct TabBarScroll: Equatable {
    /// Out of the way.
    var away = false
    /// Distance travelled since the direction last turned: down is positive.
    var travel: CGFloat = 0
    /// The scroll position this was decided at.
    var y: CGFloat = 0

    /// How far down, in one go, before the bar slides away.
    static let tuckAfter: CGFloat = 64
    /// How far back up before it returns.
    static let showAfter: CGFloat = 12
    /// Within this of the top of a page the bar is always shown.
    static let topZone: CGFloat = 96

    func next(y: CGFloat, viewport: CGFloat, height: CGFloat) -> TabBarScroll {
        let delta = y - self.y
        if y <= Self.topZone { return TabBarScroll(y: y) }
        if y + viewport >= height - 2 { return TabBarScroll(y: y) }
        if abs(delta) > viewport { return TabBarScroll(y: y) }
        if delta == 0 { return self }
        if delta > 0 {
            let travel = max(self.travel, 0) + delta
            return TabBarScroll(away: away || travel >= Self.tuckAfter, travel: travel, y: y)
        }
        let travel = min(self.travel, 0) + delta
        return TabBarScroll(away: away && -travel < Self.showAfter, travel: travel, y: y)
    }
}

/// Where a scroll view is: how far down, how tall its window, how tall its
/// content — what `TabBarScroll` decides from.
struct ScrollPlace: Equatable {
    var y: CGFloat
    var viewport: CGFloat
    var height: CGFloat
}

/// Reads a scroll view's place as it scrolls, by the system's own reading —
/// iOS 18 and later; goes on the scroll view. On 17, `ScrollContentPlace` reads
/// it from the content instead.
struct ScrollPlaceReader: ViewModifier {
    let changed: (ScrollPlace) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content.onScrollGeometryChange(for: ScrollPlace.self) { geometry in
                ScrollPlace(
                    y: geometry.contentOffset.y + geometry.contentInsets.top,
                    viewport: geometry.containerSize.height,
                    height: geometry.contentSize.height + geometry.contentInsets.top + geometry.contentInsets.bottom
                )
            } action: { _, place in
                changed(place)
            }
        } else {
            content
        }
    }
}

/// The iOS 17 reading: the content's frame in the scroll view's named space,
/// measured behind the whole content so a lazy stack never drops the thing
/// being measured. Goes on the scroll view's content; nothing from iOS 18.
struct ScrollContentPlace: ViewModifier {
    let space: String
    let viewport: CGFloat
    let changed: (ScrollPlace) -> Void

    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            content
        } else {
            content.background {
                GeometryReader { proxy in
                    let frame = proxy.frame(in: .named(space))
                    Color.clear.onChange(of: frame) { _, frame in
                        changed(ScrollPlace(y: -frame.minY, viewport: viewport, height: frame.height))
                    }
                }
            }
        }
    }
}
