import SwiftUI
import UIKit

/// The shop's frame on every shopping screen — the web's `StorefrontShell` and
/// `StoreHeader` as a phone draws them.
///
/// The logo row (the logo at the start, where the shop delivers at the end)
/// scrolls away
/// with the page and the search row stays, pinned under the status bar, so
/// somebody four screens in still has the one way to look for something. Both
/// sit on the header's liquid glass, and so does the strip under the status
/// bar. A page draws its content and nothing else, and the system's tab bar
/// sits over it all (drawn once by `RootView`).
///
/// **There is no footer, on the owner's word** ("there is no need for a
/// footer in app"): the home page drew one for a while, as the web's phone
/// does, and what it carried that the app had nowhere else — the help centre,
/// the policies, the stores, selling, and a guest's language — is a card on
/// the Profile tab now (`MoreFromNetLet`).
///
/// A screen pushed onto a stack gets a back chevron before the logo: the web
/// leaves going back to the browser, and the app has no browser around it.
///
/// **The Profile and Cart tabs have no header**, on the owner's word
/// (`header: false`) — the web's phone draws `/account` and `/cart` with
/// neither header nor footer: the page starts under the status bar, ends with
/// its own content, and the tab bar is the way anywhere else. The account's
/// sections carry their own "← Your account". **The assistant's button is on
/// every page, those two included, on the owner's word** — it went with the
/// header for a while, having covered the ends of the Profile page's rows; a
/// page without the header now keeps room under its content for it.
///
/// **A product, a department and the departments have no logo row**, on the
/// owner's word (`logo: false`): the search field is the whole header there,
/// as on the web's phone, and a pushed screen's back chevron moves to the
/// start of the search row, since the row that carried it is not drawn.
///
/// **The tab bar slides away on a scroll down and back on a scroll up**, on
/// the owner's word — once the page has gone down a little, never on the first
/// point (`TabBarScroll`, the web's rule number for number) — and **it slides
/// down off the screen rather than vanishing**, also on the owner's word
/// (`TabBarSlide`, the bar moved by its own transform; an iPad, whose bar is
/// along the top, hides it the system's way). What floats over the page rides
/// down with it into the room it left (`AppModel.tabBarRide`), and the
/// assistant's button folds to its mark while it is away: "Need help?" goes
/// out toward the screen's end edge and comes back with the bar. The scroll is
/// followed in a box nothing observes, so only the bar's coming and going
/// draws the page again; it stays put for VoiceOver, which reads it as the
/// way around the app, and comes and goes with no slide under Reduce Motion.
struct ShopPage<Content: View>: View {
    /// A tab's first screen, which has nothing to go back to.
    var root = false
    /// The logo row and the search row; off for Profile and Cart.
    var header = true
    /// The logo row — the logo, where the shop delivers and the heart — over
    /// the search row; off on a product and the category pages.
    var logo = true
    var refresh: (() async -> Void)?
    /// The assistant's button in the end corner; off where the page's own
    /// floating bar has that corner, the web's rule that the thing a page is for wins.
    var assistant = true
    /// The product on screen, so the conversation starts about it.
    var assistantProduct: Product?
    /// The words a results page is for. The field shows them there and
    /// nothing on any other page — the web's header starting each page from
    /// the address's `q` — so a product opened from a search does not go on
    /// showing it, and a search reached from a chat or "Find similar" says
    /// what it searched.
    var searchTerm: String?
    @ViewBuilder var content: () -> Content

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var still
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    /// Where the scroll is, kept where changing it draws nothing.
    @State private var scroll = ScrollFollower()
    /// Whether the tab bar is out of the way: the one thing that does draw.
    @State private var barAway = false
    /// Hidden the system's way, where there is no bar along the foot to slide.
    @State private var barHidden = false
    /// The page has been on screen a moment. The assistant waits for it: a
    /// page whose own floating bar takes the corner (a long cart's Checkout)
    /// knows so only once it is laid out, and the button was drawn on the
    /// first frame and then animated away — a flash on every visit.
    @State private var settled = false
    /// Whether the logo row has gone and the search row is the top of the
    /// screen — which row's glass reaches up behind the status bar.
    @State private var searchAtTop = false

    /// The assistant floats on every page but where the page's own floating
    /// bar has its corner, once the page has settled — and never under the
    /// search, which covers the page to the keyboard.
    private var showsAssistant: Bool { assistant && settled && !app.searchOpen }

    var body: some View {
        let back: (() -> Void)? = root ? nil : { dismiss() }
        return ScrollViewReader { proxy in
            GeometryReader { screen in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        if header && logo {
                            LogoRow(back: back, reach: logoReaches ? statusBar : 0) {
                                if root && app.selectedTab == .home {
                                    withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo(ShopPageTop.id, anchor: .top) }
                                } else {
                                    app.goHome()
                                }
                            }
                            .id(ShopPageTop.id)
                        } else {
                            Color.clear.frame(height: 0).id(ShopPageTop.id)
                        }
                        Section {
                            PageTopMarker()
                            content()
                            if app.assistantOn {
                                // Room under the last row for the assistant's button —
                                // kept while it steps aside too, so the page's height
                                // never changes under a scroll when it does.
                                Color.clear.frame(height: 64).accessibilityHidden(true)
                            }
                            PageFootMarker()
                        } header: {
                            if header { SearchRow(back: logo ? nil : back, reach: logoReaches ? 0 : statusBar) }
                        }
                    }
                    .modifier(ScrollContentPlace(space: ShopPageTop.space, viewport: screen.size.height, changed: follow))
                }
                .coordinateSpace(.named(ShopPageTop.space))
                .modifier(ScrollPlaceReader(changed: follow))
                .modifier(OptionalRefresh(action: refresh))
                .modifier(NoBottomEdge())
                .scrollDismissesKeyboard(.interactively)
            }
        }
        .background(Brand.ground.ignoresSafeArea())
        .overlay(alignment: .bottomTrailing) {
            // The button's own animation, never the page's: on the whole page
            // it animated whatever else changed in that frame — the scroll's
            // content included — along with it.
            ZStack(alignment: .bottomTrailing) {
                if showsAssistant {
                    ShopAssistantButton(product: assistantProduct, folded: barAway)
                        .padding(.trailing, 16)
                        .padding(.bottom, 16)
                        .offset(y: app.tabBarRide)
                }
            }
            .animation(still ? nil : .easeOut(duration: 0.2), value: showsAssistant)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            // With a header, the strip under the status bar is the header's
            // own glass reaching up (`GlassSurface`'s `reach`) — the logo row's
            // while it is in view, the search row's once it is the top of the
            // screen — and nothing is drawn here: a pane of its own met the
            // row under it in a visible line. With no header it is the page's
            // own ground, solid, so what scrolls up goes under it rather than
            // under the clock and the battery.
            if header {
                Color.clear.frame(height: 0)
            } else {
                Color.clear.frame(height: 0).background(Brand.ground.ignoresSafeArea(edges: .top))
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(barHidden ? .hidden : .visible, for: .tabBar)
        .task {
            guard !settled else { return }
            try? await Task.sleep(for: .milliseconds(250))
            settled = true
        }
        .onAppear {
            // Back on this page, from one pushed over it or another tab: the
            // bar is there, and the scroll counts afresh from where it is.
            scroll.state = TabBarScroll(y: scroll.state.y)
            barAway = false
            barHidden = false
            TabBarSlide.slide(away: false, animated: !still)
            app.tabBarRide = 0
            if header { app.searchText = searchTerm ?? "" }
        }
        // A screen that is not a shop page — the portal's — never inherits a
        // bar slid away here.
        .onDisappear {
            TabBarSlide.slide(away: false, animated: !still)
            app.tabBarRide = 0
        }
    }

    /// The logo row's glass reaches behind the status bar until the row has
    /// as good as gone; then the search row's does. The handover comes a few
    /// points early, under the logo row's empty foot, so a frame read late
    /// never leaves the strip uncovered.
    private var logoReaches: Bool { logo && !searchAtTop }

    /// The status bar's height, which the top row's glass reaches up behind.
    private var statusBar: CGFloat {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        let window = scene?.windows.first(where: \.isKeyWindow) ?? scene?.windows.first
        return window?.safeAreaInsets.top ?? 0
    }

    private func follow(_ place: ScrollPlace) {
        let atTop = place.y > ShopPageTop.logoHandover
        if atTop != searchAtTop { searchAtTop = atTop }
        let next = scroll.state.next(y: place.y, viewport: place.viewport, height: place.height)
        scroll.state = next
        let away = next.away && !voiceOver
        guard away != barAway else { return }
        let motion: Animation? = still ? nil : .smooth(duration: 0.38)
        withAnimation(motion) { barAway = away }
        if let ride = TabBarSlide.slide(away: away, animated: !still) {
            withAnimation(motion) { app.tabBarRide = ride }
        } else {
            withAnimation(motion) { barHidden = away }
        }
    }
}

/// The scroll's running state, in a class so that following it every frame
/// never asks SwiftUI to draw the page again.
private final class ScrollFollower {
    var state = TabBarScroll()
}

private enum ShopPageTop {
    static let id = "shop-page-top"
    static let space = "shop-page-scroll"
    /// How far down the logo row's 58 points the search row takes over the
    /// status bar's glass: past the logo and the location, into the padding.
    static let logoHandover: CGFloat = 50
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
/// every page's title starts from, and **where the shop delivers at the end**,
/// on the owner's word — the saved address in use ("Home"), else the area —
/// which opens "Deliver to" (`DeliverySheet`) and is felt at the product
/// strength. It was the language; that is a row on the Profile page now.
struct LogoRow: View {
    var back: (() -> Void)?
    /// How far its glass reaches up behind the status bar.
    var reach: CGFloat = 0
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
            let place = app.delivery.label(l.current) ?? l.t("home.chooseAreaShort")
            Button {
                app.deliveryOpen = true
            } label: {
                // `.pressable`'s type, as every control on the web's bar.
                HStack(spacing: 6) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Brand.accentInk)
                    Text(place)
                        .font(.inter(14, .medium))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Brand.navy)
                }
                .padding(.horizontal, 10)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 12, strength: Haptics.actionStrength))
            .accessibilityLabel("\(l.t("home.deliverTo")) \(place)")
            .accessibilityHint(l.t("delivery.buttonTitle"))
            // Saved items — the hearts — counted, for everybody, on the
            // owner's word: it opened the wishlists for somebody signed in for
            // a while, and the wishlists are a row of the account page now.
            let signedIn = app.session.isSignedIn
            let saved = app.saved.ids.count
            Button {
                app.push(.saved)
            } label: {
                Image(systemName: "heart")
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 40, height: 44)
                    .overlay(alignment: .topTrailing) {
                        CountBadge(value: saved).fixedSize().offset(x: 2, y: 2)
                    }
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 12, strength: Haptics.actionStrength))
            .accessibilityLabel(l.t("header.savedItems", ["count": "\(saved)"]))
            // The notifications follow the heart, on the owner's word, with
            // what is unread counted; signed out it is the sign-in, the web's
            // inbox address being its sign-in form.
            let unread = app.signals.unreadNotices
            Button {
                if signedIn { app.push(.notifications) } else { app.openAccount(nil) }
            } label: {
                Image(systemName: "bell")
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 40, height: 44)
                    .overlay(alignment: .topTrailing) {
                        CountBadge(value: unread).fixedSize().offset(x: 2, y: 2)
                    }
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 12, strength: Haptics.actionStrength))
            .accessibilityLabel(l.t("notices.menu"))
            .accessibilityValue(unread == 0 ? "" : l.t("header.unreadCount", ["count": "\(unread)"]))
            .padding(.trailing, -6)
        }
        .padding(.horizontal, 16)
        .frame(height: 58)
        // The top of one surface that runs 60% to 45% across both rows, as the
        // web's header does; the rim is the strip's above it.
        .background(GlassSurface(top: 0.6, foot: 0.53, rim: false, reach: reach))
    }
}

/// The header's second row: the search field, the width of the screen — the
/// web's phone field. The words open the search over the page
/// (`SearchOverlay`), the way the web's field grows its sheet; with nothing
/// typed the microphone and the camera stand where clear would, each only
/// where it works, and a hairline keeps them apart from the navy search disc.
struct SearchRow: View {
    /// A pushed screen's way back, when there is no logo row to carry it.
    var back: (() -> Void)?
    /// How far its glass reaches up behind the status bar — the status bar's
    /// height once it is the top of the screen, nothing under the logo row.
    /// Reaching, its tint starts at the top's 60% rather than going on from
    /// the logo row's foot.
    var reach: CGFloat = 0
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 2) {
            if let back {
                Button(action: back) {
                    Image(systemName: "chevron.backward")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 36, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("ios.back"))
                .padding(.leading, -8)
            }
            field
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(
            GlassSurface(top: reach > 0 ? 0.6 : 0.53, foot: 0.45, rim: false, reach: reach)
        )
        .overlay(alignment: .bottom) {
            Rectangle().fill(Brand.navy.opacity(0.08)).frame(height: 1)
        }
    }

    /// The field itself: what was typed or the example, the other ways in or
    /// clear, and the navy search disc.
    private var field: some View {
        let empty = app.searchText.isEmpty
        return HStack(spacing: 0) {
            Button {
                app.searchOpen = true
            } label: {
                Group {
                    if empty {
                        // The shop's own examples in turn, rolling up one to the next.
                        CyclingExample(examples: app.shelf.searchExamples(language: l))
                    } else {
                        Text(app.searchText)
                    }
                }
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
