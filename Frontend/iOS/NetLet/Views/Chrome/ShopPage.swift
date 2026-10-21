import SwiftUI
import UIKit

/// The shop's frame on every shopping screen — the web's `StorefrontShell` and
/// `StoreHeader` as a phone draws them.
///
/// The logo row (the logo at the start, the language at the end) scrolls away
/// with the page and the search row stays, pinned under the status bar, so
/// somebody four screens in still has the one way to look for something. Both
/// sit on the header's liquid glass, and so does the strip under the status
/// bar. A page draws its content and nothing else; the footer follows it, and
/// the system's tab bar sits over it all (drawn once by `RootView`).
///
/// A screen pushed onto a stack gets a back chevron before the logo: the web
/// leaves going back to the browser, and the app has no browser around it.
struct ShopPage<Content: View>: View {
    /// A tab's first screen, which has nothing to go back to.
    var root = false
    var footer = true
    var refresh: (() async -> Void)?
    /// The assistant's button in the end corner; off where the page's own
    /// floating bar has that corner, the web's rule that the thing a page is for wins.
    var assistant = true
    /// The product on screen, so the conversation starts about it.
    var assistantProduct: Product?
    @ViewBuilder var content: () -> Content

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let back: (() -> Void)? = root ? nil : { dismiss() }
        return ScrollViewReader { proxy in
            GeometryReader { screen in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        LogoRow(back: back) {
                            if root && app.selectedTab == .home {
                                withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo(ShopPageTop.id, anchor: .top) }
                            } else {
                                app.goHome()
                            }
                        }
                        .id(ShopPageTop.id)
                        Section {
                            if footer {
                                // At least a screen tall, the web's `min-h-[100svh]`:
                                // the footer starts below the fold, so the tab bar
                                // never rests over its navy (see `SiteFooter`).
                                VStack(alignment: .leading, spacing: 0) { content() }
                                    .frame(maxWidth: .infinity, minHeight: screen.size.height, alignment: .topLeading)
                                SiteFooter().id(ShopPageTop.foot)
                            } else {
                                content()
                            }
                        } header: {
                            SearchRow()
                        }
                    }
                }
                .task(id: app.startAtFoot) {
                    // The screenshot of the tab bar over the footer; asked for once
                    // the launch has settled, after the home page has appeared.
                    guard root, footer, app.startAtFoot else { return }
                    app.startAtFoot = false
                    try? await Task.sleep(for: .seconds(2))
                    proxy.scrollTo(ShopPageTop.foot, anchor: .bottom)
                }
                .modifier(OptionalRefresh(action: refresh))
                .modifier(NoBottomEdge())
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .background(Brand.ground.ignoresSafeArea())
        .overlay(alignment: .bottomTrailing) {
            if assistant {
                ShopAssistantButton(product: assistantProduct)
                    .padding(.trailing, 16)
                    .padding(.bottom, 16)
            }
        }
        .animation(.easeOut(duration: 0.2), value: assistant)
        .safeAreaInset(edge: .top, spacing: 0) {
            // The strip under the status bar wears the header's glass too, at
            // the tint the bar's top has, so the two meet with no step.
            Color.clear.frame(height: 0).background(GlassSurface(top: 0.6, foot: 0.6).ignoresSafeArea(edges: .top))
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

private enum ShopPageTop {
    static let id = "shop-page-top"
    static let foot = "shop-page-foot"
}

/// Nothing behind the tab bar but the page itself, on the owner's word: on
/// iOS 26 a scroll view draws an edge effect under the bar — a blur, or a
/// nearly opaque band in its hard style, which build 17 used — and the owner
/// asked for the glass behind the menu to go. The bar floats over the page as
/// the web's pill does. Hidden for every scroll view in the tabs (`RootView`).
struct NoBottomEdge: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            content.scrollEdgeEffectHidden(true, for: .bottom)
        } else {
            content
        }
    }
}

private struct OptionalRefresh: ViewModifier {
    let action: (() async -> Void)?

    func body(content: Content) -> some View {
        if let action {
            content.refreshable { await action() }
        } else {
            content
        }
    }
}

/// The phone header's first row: the logo at the start, 40 tall, on the line
/// every page's title starts from, and the language at the end — the language
/// you would get, spoken in it ("العربية" on the English app).
struct LogoRow: View {
    var back: (() -> Void)?
    let onLogo: () -> Void

    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 4) {
            if let back {
                Button(action: back) {
                    Image(systemName: "chevron.backward")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 36, height: 44)
                }
                .accessibilityLabel(l.t("ios.back"))
            }
            Button(action: onLogo) {
                BundledImage(image: WebAssets.logo)
                    .frame(maxWidth: 130, maxHeight: 40, alignment: .leading)
                    .frame(height: 40)
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("header.home"))
            Spacer(minLength: 12)
            Button {
                app.setLanguage(l.current.other)
            } label: {
                // `.pressable`'s type, as every control on the web's bar.
                Text(l.t("header.language"))
                    .font(.inter(14, .medium))
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 12))
            .environment(\.locale, l.current.other.locale)
            .accessibilityHint(l.t("header.changeLanguage"))
        }
        .padding(.horizontal, 16)
        .frame(height: 58)
        // The top of one surface that runs 60% to 45% across both rows, as the
        // web's header does; the rim is the strip's above it.
        .background(GlassSurface(top: 0.6, foot: 0.53, rim: false))
    }
}

/// The header's second row: the search field, the width of the screen — the
/// web's phone field. The words open the search over the page
/// (`SearchOverlay`), the way the web's field grows its sheet; with nothing
/// typed the microphone and the camera stand where clear would, each only
/// where it works, and a hairline keeps them apart from the navy search disc.
struct SearchRow: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let empty = app.searchText.isEmpty
        HStack(spacing: 0) {
            Button {
                app.searchOpen = true
            } label: {
                Text(empty ? placeholder : app.searchText)
                    .font(.inter(16))
                    .foregroundStyle(empty ? Brand.muted : Brand.navy)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("header.searchAria"))
            .accessibilityValue(app.searchText)
            .accessibilityAddTraits(.isSearchField)
            if !empty {
                Button {
                    app.searchText = ""
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Brand.muted)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(Color.white))
                        .overlay(Circle().strokeBorder(Brand.line, lineWidth: 1))
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("header.searchClear"))
            } else if voiceOn || photoOn {
                if voiceOn { otherWay("mic", label: "search.voice", start: .voice) }
                if photoOn { otherWay("camera", label: "search.photo", start: .photo) }
                Rectangle()
                    .fill(Color(red: 201 / 255, green: 214 / 255, blue: 230 / 255))
                    .frame(width: 1, height: 20)
                    .padding(.horizontal, 2)
                    .accessibilityHidden(true)
            }
            Button {
                let words = app.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
                if words.isEmpty { app.searchOpen = true } else { app.search(words) }
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Brand.navy))
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("header.searchSubmit"))
            .padding(.leading, 6)
        }
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .frame(height: 44)
        .background(Capsule().fill(Color.white))
        .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            GlassSurface(top: 0.53, foot: 0.45, rim: false)
                .ignoresSafeArea(edges: .top)
        )
        .overlay(alignment: .bottom) {
            Rectangle().fill(Brand.navy.opacity(0.08)).frame(height: 1)
        }
    }

    private var voiceOn: Bool { app.features.isOn("voiceSearch") && Dictation.isAvailable }
    private var photoOn: Bool { app.features.isOn("photoSearch") && app.photoSearchReady }

    /// The microphone or the camera: flat, in the muted ink, opening the
    /// search already listening or already choosing a photo.
    private func otherWay(_ symbol: String, label: String, start: SearchStart) -> some View {
        Button {
            app.searchStart = start
            app.searchOpen = true
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 17))
                .foregroundStyle(Brand.muted)
                .frame(width: 36, height: 36)
                .contentShape(Circle())
        }
        .buttonStyle(.tap)
        .accessibilityLabel(l.t(label))
    }

    /// The field's example comes from the live catalogue — the first product
    /// type it holds, in the page's language — and asks plainly without one.
    private var placeholder: String {
        guard let example = app.shelf.searchExample(language: l) else { return l.t("header.searchAria") }
        return l.t("header.searchPlaceholder", ["example": example])
    }
}

/// A screen's breadcrumbs, the web's `Breadcrumbs`: Home, then the trail, the
/// last step the page itself.
struct Breadcrumbs: View {
    let trail: [String]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 6) {
            Button(l.t("nav.home")) { app.goHome() }
                .foregroundStyle(Brand.muted)
            ForEach(Array(trail.enumerated()), id: \.offset) { index, step in
                Image(systemName: "chevron.forward")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
                Text(step)
                    .foregroundStyle(index == trail.count - 1 ? Brand.body : Brand.muted)
                    .lineLimit(1)
            }
        }
        .font(.inter(13))
        .padding(.bottom, 12)
    }
}

/// A page's own room: the container's 16 either side and the same space
/// above and below everywhere (`PageBody`), its title 24 with any note under it.
struct PageBody<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Lets the navigation bar's swipe back keep working on screens that draw
/// their own header and hide the bar — which turns the gesture off otherwise.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        viewControllers.count > 1
    }
}
