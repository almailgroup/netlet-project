import SwiftUI

/// What the UI tests (`NetLetUITests`) need from the app and nobody else does,
/// switched on by `-NetLetUITest YES` in a Debug build and never in a release.
enum UITestHooks {
    #if DEBUG
    static let on = UserDefaults.standard.bool(forKey: "NetLetUITest")
    #else
    static let on = false
    #endif
}

/// A point at the top of a page's content that a UI test can find and follow
/// as the page scrolls ("page-top"). Drawn only under `UITestHooks.on`, so a
/// shopper's VoiceOver never meets an element that says nothing.
struct PageTopMarker: View {
    var body: some View {
        if UITestHooks.on {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel("page top")
                .accessibilityIdentifier("page-top")
        }
    }
}

/// The foot of a page's content, for a UI test to scroll to ("page-foot").
struct PageFootMarker: View {
    var body: some View {
        if UITestHooks.on {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel("page foot")
                .accessibilityIdentifier("page-foot")
        }
    }
}

/// What a page's scroll did, for a UI test that finds a page standing still
/// to say why (`ScrollingUITests`). The home page sometimes stands still
/// under three drags right after launch and moves under a fourth five seconds
/// later, and reading the code could not tell two causes apart: the drags
/// never reaching the scroll, or the scroll moving and being put back at its
/// top. So under `UITestHooks.on` this keeps the scroll's phases (a drag the
/// scroll took is "interacting"), when it left its top and when it came back
/// to it, when the home page's shelves arrived, and when the main thread was
/// held for more than a quarter of a second — and a shopper's app records
/// nothing. A lock rather than an actor: the scroll's callbacks, a background
/// watch and the accessibility read all write or read it.
enum ScrollTrace {
    private static let lock = NSLock()
    private static var events: [String] = []
    private static let began = Date()
    private static var lastY: CGFloat = 0
    private static var furthest: CGFloat = 0
    private static var watching = false

    static func note(_ what: String) {
        guard UITestHooks.on else { return }
        let at = String(format: "%.2fs", Date().timeIntervalSince(began))
        lock.lock()
        events.append("\(at) \(what)")
        if events.count > 60 { events.removeFirst(events.count - 60) }
        lock.unlock()
    }

    /// The page's scroll is `y` from its top, in content `height` tall seen
    /// through a `viewport`.
    static func scrolled(to y: CGFloat, height: CGFloat, viewport: CGFloat) {
        guard UITestHooks.on else { return }
        lock.lock()
        let was = lastY
        lastY = y
        furthest = max(furthest, y)
        lock.unlock()
        if was <= 1, y > 1 { note("left the top (content \(Int(height)) in \(Int(viewport)))") }
        if was > 20, y <= 1 { note("back at the top from \(Int(was))") }
    }

    static var summary: String {
        lock.lock()
        defer { lock.unlock() }
        return "furthest \(Int(furthest)), now \(Int(lastY)); " + events.joined(separator: " · ")
    }

    /// Notes each time, in the first half minute, that the main thread could
    /// not take a turn for more than a quarter of a second.
    static func watchMainThread() {
        guard UITestHooks.on else { return }
        lock.lock()
        let started = watching
        watching = true
        lock.unlock()
        guard !started else { return }
        Task.detached {
            for _ in 0..<120 {
                let sent = Date()
                await MainActor.run {
                    let held = Date().timeIntervalSince(sent)
                    if held > 0.25 { ScrollTrace.note("main thread held \(Int(held * 1000))ms") }
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
    }
}

/// The trace as an element a UI test reads ("scroll-trace"), its value read
/// live each time it is asked rather than drawn.
struct ScrollTraceMarker: UIViewRepresentable {
    func makeUIView(context: Context) -> TraceView { TraceView(frame: .zero) }
    func updateUIView(_ view: TraceView, context: Context) {}

    final class TraceView: UIView {
        override init(frame: CGRect) {
            super.init(frame: frame)
            isAccessibilityElement = true
            accessibilityIdentifier = "scroll-trace"
            accessibilityLabel = "scroll trace"
            isUserInteractionEnabled = false
        }

        required init?(coder: NSCoder) { nil }

        override var accessibilityValue: String? {
            get { ScrollTrace.summary }
            set {}
        }
    }
}

/// The scroll's phases into the trace, from iOS 18; nothing otherwise.
struct ScrollPhaseTrace: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 18, *) {
            if UITestHooks.on {
                content.onScrollPhaseChange { _, phase in ScrollTrace.note("phase \(phase)") }
            } else {
                content
            }
        } else {
            content
        }
    }
}
