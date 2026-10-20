import Foundation
import Observation
import SwiftUI

/// Where a screen can lead. Every stack in the app pushes these, so a product
/// opens the same way from Home, a department, a search or an order.
enum Route: Hashable {
    case product(handle: String)
    case department(slug: String?)
    /// The shelf a department view narrows to: what is on offer, deepest first.
    case deals
    /// The newest products, the home page's "View all" under New arrivals.
    case newest
    /// Everything of one brand, from the home page's brand tiles.
    case brand(name: String)
    case search(query: String)
    case store(slug: String)
    /// Every store with something on sale, the web's `/stores`.
    case stores
    case saved
    case checkout
    case orderPlaced(reference: String)
    case orders
    case order(reference: String)
    case profile
    case listings
    case newListing
}

/// The app's one composition root: the services, the language, who is signed
/// in and the bag, built once and handed to every screen through the environment.
@Observable
@MainActor
final class AppModel {
    let services: Services
    let language: LanguageSettings
    let session: SessionModel
    let cart: CartModel
    let saved: SavedModel
    /// The home page's catalogue and shelves, shared with the header and the categories page.
    let shelf: HomeShelf
    let isDemo: Bool

    /// Set while the sign-in sheet is up, for the screens that need an account
    /// to go on (checkout, selling). Signed out, the Account tab is the form itself.
    var authPresented = false
    /// The web's phone tabs, in its order: Home, Profile, Cart, Categories.
    var selectedTab: Tab = .home
    /// Each tab's stack, held here so one tab can open another's screen — Buy
    /// now opening checkout, a launch argument opening a product.
    var homePath = NavigationPath()
    var accountPath = NavigationPath()
    var cartPath = NavigationPath()
    var categoriesPath = NavigationPath()
    /// The header's search, grown down over the page while it is open.
    var searchOpen = false
    var searchText = ""
    /// The one short message showing, top-centre under the header (`sonner`).
    private(set) var toastMessage: Toast?
    /// A page the app does not draw itself — help, returns, selling, the
    /// terms — shown from the website in a sheet over the app.
    var webPage: WebPage?

    struct WebPage: Identifiable {
        let url: URL
        var id: String { url.absoluteString }
    }

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let text: String
    }

    enum Tab: Hashable, CaseIterable {
        case home, account, cart, categories
    }

    /// `language` is optional rather than defaulted: a default argument is
    /// evaluated outside the main actor, where `LanguageSettings` cannot be made.
    init(services: Services, language: LanguageSettings? = nil, cartDefaults: UserDefaults = .standard, isDemo: Bool = false) {
        self.services = services
        self.language = language ?? LanguageSettings()
        self.isDemo = isDemo
        session = SessionModel(account: services.account)
        cart = CartModel(service: services.cart, defaults: cartDefaults)
        saved = SavedModel(account: services.account, defaults: cartDefaults)
        shelf = HomeShelf(catalog: services.catalog)
    }

    /// The real server, or the recorded demo when launched with `-NetLetDemo YES`.
    static func live(arguments: [String] = ProcessInfo.processInfo.arguments, defaults: UserDefaults = .standard) -> AppModel {
        let configuration = APIConfiguration.current(defaults: defaults)
        let demo = defaults.bool(forKey: "NetLetDemo") || arguments.contains("-NetLetDemo")
        // `-NetLetDemoAs shopper` answers as a signed-in shopper who also runs a store.
        let transport: HTTPTransport = demo ? DemoTransport(variant: defaults.string(forKey: "NetLetDemoAs")) : URLSessionTransport()
        let client = TRPCClient(configuration: configuration, transport: transport)
        return AppModel(services: Services(client: client), isDemo: demo)
    }

    /// Who is signed in and what is in the bag, asked together at launch.
    func start() async {
        async let session: Void = self.session.restore()
        async let cart: Void = self.cart.restore()
        _ = await (session, cart)
        if self.session.isSignedIn { await linkAccount() }
        #if DEBUG
        openScreen(UserDefaults.standard.string(forKey: "NetLetOpen"))
        #endif
    }

    /// A screen to start on, for development and the screenshots CI takes:
    /// `-NetLetOpen product:basmati-rice-5kg`, `search:rice`, `checkout`,
    /// `orders`, `categories`, `newListing`… Debug builds only; a release ignores it.
    func openScreen(_ target: String?) {
        guard let target, !target.isEmpty else { return }
        let parts = target.split(separator: ":", maxSplits: 1).map(String.init)
        let value = parts.count > 1 ? parts[1] : nil
        switch parts[0] {
        case "department":
            selectedTab = .categories
            categoriesPath = NavigationPath([Route.department(slug: value)])
        case "categories":
            selectedTab = .categories
        case "stores":
            selectedTab = .home
            homePath = NavigationPath([Route.stores])
        case "store":
            guard let value else { return }
            selectedTab = .home
            homePath = NavigationPath([Route.store(slug: value)])
        case "deals":
            selectedTab = .home
            homePath = NavigationPath([Route.deals])
        case "product":
            guard let value else { return }
            selectedTab = .home
            homePath = NavigationPath([Route.product(handle: value)])
        case "search":
            selectedTab = .home
            homePath = NavigationPath([Route.search(query: value ?? "")])
        case "searchOpen":
            selectedTab = .home
            searchText = value ?? ""
            searchOpen = true
        case "saved":
            selectedTab = .account
            accountPath = NavigationPath([Route.saved])
        case "cart":
            selectedTab = .cart
        case "checkout":
            selectedTab = .cart
            cartPath = NavigationPath([Route.checkout])
        case "account":
            selectedTab = .account
        case "orders":
            selectedTab = .account
            accountPath = NavigationPath([Route.orders])
        case "order":
            guard let value else { return }
            selectedTab = .account
            accountPath = NavigationPath([Route.orders, Route.order(reference: value)])
        case "profile":
            selectedTab = .account
            accountPath = NavigationPath([Route.profile])
        case "sell":
            selectedTab = .account
            if session.seller?.isStoreMember == true { accountPath = NavigationPath([Route.listings]) }
        case "newListing":
            guard session.seller?.isStoreMember == true else { return }
            selectedTab = .account
            accountPath = NavigationPath([Route.listings, Route.newListing])
        default:
            selectedTab = .home
        }
    }

    /// Opens a screen on top of the tab that is showing — the way a link on
    /// the web opens a page from wherever the shopper is.
    func push(_ route: Route) {
        switch selectedTab {
        case .home: homePath.append(route)
        case .account: accountPath.append(route)
        case .cart: cartPath.append(route)
        case .categories: categoriesPath.append(route)
        }
    }

    /// Says something briefly — a heart saved, an add that failed — and takes
    /// it away again.
    func toast(_ text: String) {
        let shown = Toast(text: text)
        toastMessage = shown
        Task {
            try? await Task.sleep(for: .seconds(2.6))
            if toastMessage == shown { toastMessage = nil }
        }
    }

    /// Opens one of the website's own pages over the app: what the app does
    /// not draw itself is still a press away, never a dead link.
    func openWeb(_ path: String) {
        webPage = WebPage(url: services.configuration.url(path: path))
    }

    /// A screen of the account, on the Profile tab, from anywhere — or the
    /// account's home with none.
    func openAccount(_ route: Route?) {
        accountPath = route.map { NavigationPath([$0]) } ?? NavigationPath()
        selectedTab = .account
    }

    /// The logo's press: home, from the top of its own stack.
    func goHome() {
        homePath = NavigationPath()
        selectedTab = .home
    }

    /// A tab's press: that tab, or the top of it when it is already showing,
    /// as a phone's own tab bars do.
    func select(_ tab: Tab) {
        if selectedTab == tab {
            switch tab {
            case .home: homePath = NavigationPath()
            case .account: accountPath = NavigationPath()
            case .cart: cartPath = NavigationPath()
            case .categories: categoriesPath = NavigationPath()
            }
        }
        selectedTab = tab
    }

    /// The search the header's field sends: its results page, on the tab
    /// that is showing, and the words remembered for the field.
    func search(_ words: String) {
        let trimmed = words.trimmingCharacters(in: .whitespacesAndNewlines)
        searchOpen = false
        guard !trimmed.isEmpty else { return }
        searchText = trimmed
        push(.search(query: trimmed))
    }

    /// The account just proved: it takes on its stored language, claims the
    /// bag on this device, and adopts the account's own bag when it has one.
    func signedIn(_ user: User) async {
        await session.adopt(user)
        authPresented = false
        await linkAccount()
    }

    /// Buy now: the item is in the bag like any other, and the bag is skipped
    /// on the way to checkout — leaving checkout finds it waiting.
    func openCheckout() {
        cartPath = NavigationPath([Route.checkout])
        selectedTab = .cart
    }

    func signOut() async {
        await session.signOut()
        cart.forget()
        saved.signedOut()
        accountPath = NavigationPath()
    }

    /// Switches the language, and writes it to the account so the web and
    /// another device follow — a stored language is the shopper's choice.
    func setLanguage(_ next: Language) {
        language.set(next)
        guard session.isSignedIn else { return }
        Task { try? await services.account.saveLanguage(next) }
    }

    private func linkAccount() async {
        if let stored = try? await services.account.profile(), let locale = stored.locale.flatMap(Language.init(rawValue:)) {
            language.set(locale)
        }
        if let profile = try? await services.account.claimCart(cart.cartId, language: language.current) {
            await cart.adopt(cartId: profile.cartId)
        }
        await saved.adoptAccount()
    }
}
