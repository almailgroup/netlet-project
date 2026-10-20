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
    // The account's sections, each the web's `/account/<section>`.
    case addresses
    case preferences
    case notifications
    case wishlists
    case wishlist(id: Int)
    case offers
    case reviews
    case messages
    case sellerThread(id: Int)
    case help
    case supportThread(id: Int)
    case rewards
    case affiliate
    case subscriptions
    // The pages the footer leads to.
    case helpCentre
    case returnsPolicy
    case legal(LegalDocument)
    case guides
    case guide(slug: String)
    case gifts
    case gift(token: String)
    case sell
    /// An invoice or credit note as issued, the web's `/invoices/<number>`.
    case invoice(number: String)
    /// Is a printed document genuine? `/invoices/verify/<number>?code=`.
    case verifyInvoice(number: String, code: String)

    /// The screen a link on the site names — a notice's link, an answer's,
    /// the footer's — or nil for one the app has no screen for. Nothing
    /// opens a browser: a link the app cannot draw goes nowhere.
    static func from(link: String) -> Route? {
        guard let components = URLComponents(string: link) else { return nil }
        let segments = components.path.split(separator: "/").map { $0.removingPercentEncoding ?? String($0) }
        let query = Dictionary((components.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { first, _ in first })
        switch (segments.first, segments.count) {
        case ("products"?, 2): return .product(handle: segments[1])
        case ("category"?, 2): return segments[1] == "all" ? .department(slug: nil) : .department(slug: segments[1])
        case ("stores"?, 1): return .stores
        case ("stores"?, 2): return .store(slug: segments[1])
        case ("search"?, _): return .search(query: query["q"] ?? "")
        case ("saved"?, _): return .saved
        case ("checkout"?, _): return .checkout
        case ("help"?, _): return .helpCentre
        case ("returns"?, _): return .returnsPolicy
        case ("terms"?, _): return .legal(.terms)
        case ("privacy"?, _): return .legal(.privacy)
        case ("seller-agreement"?, _): return .legal(.sellers)
        case ("guides"?, 1): return .guides
        case ("guides"?, 2): return .guide(slug: segments[1])
        case ("gifts"?, 1): return .gifts
        case ("gifts"?, 2): return .gift(token: segments[1])
        case ("sell"?, _): return .sell
        case ("invoices"?, 3) where segments[1] == "verify": return .verifyInvoice(number: segments[2], code: query["code"] ?? "")
        case ("invoices"?, 2): return .invoice(number: segments[1])
        case ("account"?, 1): return nil
        case ("account"?, _):
            switch segments[1] {
            case "orders": return query["order"].map { .order(reference: $0) } ?? .orders
            case "details": return .profile
            case "addresses": return .addresses
            case "preferences": return .preferences
            case "notifications": return .notifications
            case "wishlists": return .wishlists
            case "offers": return .offers
            case "reviews": return .reviews
            case "messages": return .messages
            case "help": return .help
            case "rewards": return .rewards
            case "affiliate": return .affiliate
            case "subscriptions": return .subscriptions
            case "selling": return .listings
            default: return nil
            }
        default: return nil
        }
    }
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
    /// Which of the shop's switchable features are on (`features.states`).
    private(set) var features = FeatureStates.unknown
    /// What is waiting in the account: unread notices and messages, parcels on the way.
    let signals: AccountSignals
    /// The one short message showing, top-centre under the header (`sonner`).
    private(set) var toastMessage: Toast?
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
        signals = AccountSignals(api: services.api)
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
        async let features: Void = loadFeatures()
        _ = await (session, cart, features)
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
        case "section":
            // `section:addresses` — any account section, by its web address.
            guard let value, let route = Route.from(link: "/account/\(value)") else { return }
            openAccount(route)
        case "wishlist":
            guard let id = value.flatMap(Int.init) else { return }
            accountPath = NavigationPath([Route.wishlists, Route.wishlist(id: id)])
            selectedTab = .account
        case "sellerThread":
            guard let id = value.flatMap(Int.init) else { return }
            accountPath = NavigationPath([Route.messages, Route.sellerThread(id: id)])
            selectedTab = .account
        case "page":
            // `page:help`, `page:terms`, `page:guides/how-to-return-an-item` — a footer page, by its web address.
            guard let value, let route = Route.from(link: "/\(value)") else { return }
            selectedTab = .home
            homePath = NavigationPath([route])
        case "supportThread":
            guard let id = value.flatMap(Int.init) else { return }
            accountPath = NavigationPath([Route.help, Route.supportThread(id: id)])
            selectedTab = .account
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

    /// A link on the site, opened in the app: an account screen on the Profile
    /// tab, a shopping screen on the tab that is showing.
    func open(_ route: Route) {
        switch route {
        case .orders, .order, .profile, .addresses, .preferences, .notifications, .wishlists, .wishlist, .offers,
             .reviews, .messages, .sellerThread, .help, .supportThread, .rewards, .affiliate, .subscriptions, .listings, .newListing,
             .invoice:
            if selectedTab == .account { accountPath.append(route) } else { openAccount(route) }
        case .checkout:
            openCheckout()
        default:
            push(route)
        }
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

    /// The switches, asked at launch; a switch that cannot be read stays on,
    /// since the server refuses regardless.
    func loadFeatures() async {
        if let states = try? await services.api.call(API.features) { features = states }
    }

    func signOut() async {
        signals.clear()
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
        await signals.refresh()
    }
}
