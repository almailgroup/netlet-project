import Foundation
import Observation
import SwiftUI

/// Where a screen can lead. Every stack in the app pushes these, so a product
/// opens the same way from Home, a department, a search or an order.
enum Route: Hashable {
    case product(handle: String)
    case department(slug: String?)
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
    let isDemo: Bool

    /// Set while the sign-in sheet is up, for the screens that need an account
    /// to go on (checkout, selling). Signed out, the Account tab is the form itself.
    var authPresented = false
    var selectedTab: Tab = .home
    /// Each tab's stack, held here so one tab can open another's screen — Buy
    /// now opening checkout, a launch argument opening a product.
    var homePath = NavigationPath()
    var searchPath = NavigationPath()
    var cartPath = NavigationPath()
    var accountPath = NavigationPath()
    var sellPath = NavigationPath()
    /// Words the Search tab should search for when it next appears.
    var pendingSearch: String?

    enum Tab: Hashable {
        case home, search, cart, account, sell
    }

    /// `language` is optional rather than defaulted: a default argument is
    /// evaluated outside the main actor, where `LanguageSettings` cannot be made.
    init(services: Services, language: LanguageSettings? = nil, cartDefaults: UserDefaults = .standard, isDemo: Bool = false) {
        self.services = services
        self.language = language ?? LanguageSettings()
        self.isDemo = isDemo
        session = SessionModel(account: services.account)
        cart = CartModel(service: services.cart, defaults: cartDefaults)
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
    /// `orders`, `newListing`… Debug builds only; a release ignores it.
    func openScreen(_ target: String?) {
        guard let target, !target.isEmpty else { return }
        let parts = target.split(separator: ":", maxSplits: 1).map(String.init)
        let value = parts.count > 1 ? parts[1] : nil
        switch parts[0] {
        case "department":
            selectedTab = .home
            homePath = NavigationPath([Route.department(slug: value)])
        case "product":
            guard let value else { return }
            selectedTab = .home
            homePath = NavigationPath([Route.product(handle: value)])
        case "search":
            selectedTab = .search
            pendingSearch = value
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
            selectedTab = session.seller?.isStoreMember == true ? .sell : .account
        case "newListing":
            guard session.seller?.isStoreMember == true else { return }
            selectedTab = .sell
            sellPath = NavigationPath([Route.newListing])
        default:
            selectedTab = .home
        }
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
        if selectedTab == .sell { selectedTab = .account }
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
    }
}
