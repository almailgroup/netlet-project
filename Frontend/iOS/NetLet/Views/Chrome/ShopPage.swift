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
    @ViewBuilder var content: () -> Content

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let back: (() -> Void)? = root ? nil : { dismiss() }
        return ScrollViewReader { proxy in
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
                        content()
                        if footer { SiteFooter() }
                    } header: {
                        SearchRow()
                    }
                }
            }
            .modifier(OptionalRefresh(action: refresh))
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Brand.ground.ignoresSafeArea())
        .safeAreaInset(edge: .top, spacing: 0) {
            // The strip under the status bar wears the header's glass too.
            Color.clear.frame(height: 0).background(GlassSurface().ignoresSafeArea(edges: .top))
        }
        .toolbar(.hidden, for: .navigationBar)
    }
}

private enum ShopPageTop {
    static let id = "shop-page-top"
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
                Text(l.t("header.language"))
                    .font(.inter(13, .heavy))
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
        .background(GlassSurface(top: 0.6, foot: 0.6))
    }
}

/// The header's second row: the search field, the width of the screen, with
/// the navy search disc at its end. A press anywhere on it opens the search
/// over the page (`SearchOverlay`), the way the web's field grows its sheet.
struct SearchRow: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button {
            app.searchOpen = true
        } label: {
            HStack(spacing: 0) {
                Text(app.searchText.isEmpty ? placeholder : app.searchText)
                    .font(.inter(16))
                    .foregroundStyle(app.searchText.isEmpty ? Brand.muted : Brand.navy)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Brand.navy))
            }
            .padding(.leading, 8)
            .padding(.trailing, 4)
            .frame(height: 44)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .accessibilityLabel(l.t("header.searchAria"))
        .accessibilityAddTraits(.isSearchField)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            GlassSurface(top: 0.6, foot: 0.45)
                .ignoresSafeArea(edges: .top)
        )
        .overlay(alignment: .bottom) {
            Rectangle().fill(Brand.navy.opacity(0.08)).frame(height: 1)
        }
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
