import UIKit

/// The system tab bar slid down off the screen and back, on the owner's word —
/// "it should slide down smoothly instead of vanishing".
///
/// SwiftUI can only hide the tab bar (`.toolbar(.hidden, for: .tabBar)`),
/// which on a phone makes it vanish where it stands; the web's bar slides by a
/// transform (`.tab-bar` in index.css). So on a phone what the bar `TabView`
/// is built on draws is moved down by the bar layer's `sublayerTransform`, by
/// the distance the web's moves — its height, its gap from the foot of the
/// screen and a little for its shadow — on the web's curve and its 380ms.
///
/// **The sublayers, never the view's own transform**: UIKit lays the bar out
/// by setting its frame, and a frame set under a transform is undefined — the
/// bar could jump back into view while "away", and then land above its place
/// on the way back. Nothing in UIKit's layout touches `sublayerTransform`.
/// While it is away the bar takes no touches, so a press where it was reaches
/// the page under it; it takes them again the moment it starts back. A
/// transform of either kind leaves the safe area alone, so nothing on the page
/// moves when it goes.
///
/// An iPad's tab bar is along the top, so it is not slid (`available`), and
/// `ShopPage` hides it there as before.
@MainActor
enum TabBarSlide {
    private static let key = "netlet.tabBarSlide"

    /// Whether the bar sits along the foot of the screen to slide down from.
    static var available: Bool { UIDevice.current.userInterfaceIdiom == .phone }

    /// Slides the bar away or back. Answers how far what floats over the page
    /// should follow it down — into the room it left — or nil when there is no
    /// bar to slide, for `ShopPage` to hide it the system's way instead.
    @discardableResult
    static func slide(away: Bool, animated: Bool) -> CGFloat? {
        guard available, let bar = tabBar(), let window = bar.window else { return nil }
        let top = bar.convert(bar.bounds, to: window).minY
        let ride = max(0, window.bounds.height - window.safeAreaInsets.bottom - top)
        let drop = away ? window.bounds.height - top + 12 : 0
        bar.isUserInteractionEnabled = !away
        move(bar.layer, to: CATransform3DMakeTranslation(0, drop, 0), animated: animated)
        return away ? ride : 0
    }

    private static func move(_ layer: CALayer, to target: CATransform3D, animated: Bool) {
        // From wherever it is drawn now, so a slide turned round mid-way
        // starts from where the eye sees it.
        let shown = layer.presentation()?.sublayerTransform ?? layer.sublayerTransform
        layer.removeAnimation(forKey: key)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.sublayerTransform = target
        CATransaction.commit()
        guard animated, !CATransform3DEqualToTransform(shown, target) else { return }
        let slide = CABasicAnimation(keyPath: "sublayerTransform")
        slide.fromValue = NSValue(caTransform3D: shown)
        slide.toValue = NSValue(caTransform3D: target)
        slide.duration = 0.38
        // The web's curve, a phone's own sheets' (`cubic-bezier(0.32, 0.72, 0, 1)`).
        slide.timingFunction = CAMediaTimingFunction(controlPoints: 0.32, 0.72, 0, 1)
        layer.add(slide, forKey: key)
    }

    /// The bar of the window's tab bar controller — the one `RootView`'s
    /// `TabView` is built on.
    private static func tabBar() -> UITabBar? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
        return controller(in: window?.rootViewController)?.tabBar
    }

    private static func controller(in parent: UIViewController?) -> UITabBarController? {
        guard let parent else { return nil }
        if let tabs = parent as? UITabBarController { return tabs }
        for child in parent.children {
            if let found = controller(in: child) { return found }
        }
        return nil
    }
}
