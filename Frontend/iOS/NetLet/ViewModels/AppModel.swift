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
    /// A search over the whole catalogue, or within one department — the web's
    /// `/search?q=` and `/category/<slug>?q=`.
    case search(query: String, department: String? = nil)
    case store(slug: String)
    /// Every store with something on sale, the web's `/stores`.
    case stores
    /// Every brand on the shelf, the web's `/brands`.
    case brands
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
    /// A page of the seller and admin portal, by its web address (`/admin/...`).
    case portal(String)
    /// A tab's own first screen — the web's `/`, `/account`, `/cart` and
    /// `/categories`, which the app draws as tabs rather than pushes.
    case tab(AppModel.Tab)

    /// The screen a link on the site names — a notice's link, an answer's,
    /// the footer's — or nil for one the app has no screen for. Nothing
    /// opens a browser: a link the app cannot draw goes nowhere.
    static func from(link: String) -> Route? {
        guard let components = URLComponents(string: link) else { return nil }
        let segments = components.path.split(separator: "/").map { $0.removingPercentEncoding ?? String($0) }
        let query = Dictionary((components.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { first, _ in first })
        switch (segments.first, segments.count) {
        case (nil, 0): return .tab(.home)
        case ("cart"?, 1): return .tab(.cart)
        case ("categories"?, 1): return .tab(.categories)
        case ("products"?, 2): return .product(handle: segments[1])
        case ("category"?, 2):
            let slug = segments[1] == "all" ? nil : segments[1]
            if let words = query["q"], !words.isEmpty { return .search(query: words, department: slug) }
            return .department(slug: slug)
        case ("stores"?, 1): return .stores
        case ("brands"?, 1): return .brands
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
        case ("admin"?, _):
            let path = components.path.hasSuffix("/") && components.path.count > 1 ? String(components.path.dropLast()) : components.path
            return .portal(path + (components.percentEncodedQuery.map { "?" + $0 } ?? ""))
        case ("account"?, 1): return .tab(.account)
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
            case "help": return .help
            case "rewards": return .rewards
            case "affiliate": return .affiliate
            case "subscriptions": return .subscriptions
            case "selling": return .portal("/admin")
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
    /// What the search opens on from the header's microphone or camera.
    var searchStart: SearchStart?
    /// The photo viewer a product page opens on — for the screenshots CI takes.
    var photoViewerStart: PhotoViewerStart?
    /// Which of the shop's switchable features are on (`features.states`).
    private(set) var features = FeatureStates.unknown
    /// What is waiting in the account: unread notices and messages, parcels on the way.
    let signals: AccountSignals
    /// Where the shop delivers, for the header's location button.
    let delivery: DeliveryModel
    /// The code, gift card and points chosen for the bag, in the cart or at
    /// checkout (`BagSavingsCard`).
    let savings: SavingsModel
    /// The header's "Deliver to" sheet.
    var deliveryOpen = false
    /// The product whose heart is asking Saved or a wishlist, and which
    /// (`WishSheet`).
    var wishAsking: WishTarget?
    /// How far the tab bar has slid down out of the way (`TabBarSlide`), for
    /// what floats over a page to ride down with it; zero while it is there.
    var tabBarRide: CGFloat = 0
    /// A guest who chose a wishlist is signing in; which list is asked once
    /// the session exists, and forgotten if they close sign-in instead.
    var wishAfterSignIn: WishTarget?
    /// The product a hold on its card is previewing (`QuickViewSheet`).
    var previewing: Product?
    /// For the screenshots: the address book opens a new address on the map
    /// ("pin") or at its confirmation ("confirm"). Debug builds only set it.
    var addressStep: String?
    /// What the AI gateway is set up for here (`ai.available`); nil until asked.
    private(set) var ai: AIAvailability?
    /// Whether a model can read a photo for search (`search.photoAvailable`),
    /// so the camera is drawn only where it does something.
    private(set) var photoSearchReady = false
    /// The code a member of the affiliate programme shares on a product's
    /// address (3.7), or nil for anybody whose links would earn nothing — the
    /// web's `useMemberCode`. Asked on sign-in and after joining.
    private(set) var memberCode: String?
    /// Whether this account has joined the affiliate programme, a suspended
    /// member included — what decides whether "Join" is offered. Nil until
    /// asked, or when asking failed, so nothing is offered on a guess.
    private(set) var affiliateJoined: Bool?
    /// The gateway, holding one token for every conversation.
    let gateway: AIGateway
    /// The shop's conversation, kept while the app runs — the web keeps it
    /// for the tab — and emptied by New chat.
    let shopChat: ChatModel
    var chatOpen = false
    /// An answer finished while the conversation was closed.
    var chatUnread = false

    /// Whether the shop's conversations are drawn: only with a gateway behind
    /// them and the assistant switched on, since a button that can only
    /// apologise is worse than none.
    var assistantOn: Bool { ai?.chat == true }
    /// The one short message showing, top-centre under the header (`sonner`).
    private(set) var toastMessage: Toast?
    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let text: String
        /// A press that takes back what was just done — the bag's Undo.
        var undo: (@MainActor () -> Void)? = nil

        static func == (lhs: Toast, rhs: Toast) -> Bool { lhs.id == rhs.id }
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
        shelf = HomeShelf(catalog: services.catalog, warm: HomeShelf.warmPhotos(resolve: services.configuration.resolve))
        signals = AccountSignals(api: services.api)
        delivery = DeliveryModel(api: services.api, account: services.account, defaults: cartDefaults)
        savings = SavingsModel(api: services.api)
        let api = services.api
        let gateway = AIGateway(mint: { try await api.call(API.chatSession) })
        self.gateway = gateway
        let settings = self.language
        shopChat = ChatModel(gateway: gateway, language: { settings.current })
        shopChat.onAnswered = { [weak self] in
            guard let self, !self.chatOpen else { return }
            self.chatUnread = true
        }
    }

    /// A conversation about one product, the product page's own assistant.
    func productChat(_ product: Product) -> ChatModel {
        let settings = language
        return ChatModel(gateway: gateway, product: ProductBrief(product), language: { settings.current })
    }

    /// The help page's box: one question, one answer.
    func helpChat() -> ChatModel {
        let settings = language
        return ChatModel(gateway: gateway, single: true, language: { settings.current })
    }

    /// Opens the shop's conversation, about the product on screen when there is one.
    func openChat(about product: Product? = nil) {
        shopChat.product = product.map(ProductBrief.init)
        chatUnread = false
        chatOpen = true
    }

    /// The real server, or the recorded demo when launched with `-NetLetDemo YES`.
    static func live(arguments: [String] = ProcessInfo.processInfo.arguments, defaults: UserDefaults = .standard) -> AppModel {
        let configuration = APIConfiguration.current(defaults: defaults)
        let demo = defaults.bool(forKey: "NetLetDemo") || arguments.contains("-NetLetDemo")
        // `-NetLetDemoAs shopper` answers as a signed-in shopper who also runs a store.
        let transport: HTTPTransport = demo ? DemoTransport(variant: defaults.string(forKey: "NetLetDemoAs")) : URLSessionTransport()
        let client = TRPCClient(configuration: configuration, transport: transport, memory: demo ? nil : .shared)
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
        case "chat":
            // `chat:product-handle` opens it about that product, on its page.
            if let value {
                selectedTab = .home
                homePath = NavigationPath([Route.product(handle: value)])
            }
            openChat()
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
        case "tabBarAway":
            // The home page with the tab bar slid away, as a scroll down leaves
            // it — the picture that says the slide moves the bar on this iOS.
            selectedTab = .home
            Task {
                try? await Task.sleep(for: .seconds(4))
                if let ride = TabBarSlide.slide(away: true, animated: false) { tabBarRide = ride }
            }
        case "photos", "zoom":
            // Every photo of a product, or one of them full screen.
            guard let value else { return }
            selectedTab = .home
            photoViewerStart = parts[0] == "zoom" ? .zoom : .photos
            homePath = NavigationPath([Route.product(handle: value)])
        case "preview":
            // The sheet a hold on a card opens, over the home page.
            guard let value else { return }
            selectedTab = .home
            Task {
                if let found = try? await services.catalog.product(handle: value, language: language.current) { previewing = found }
            }
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
            if session.seller?.inPortal == true { accountPath = NavigationPath([Route.portal("/admin")]) }
        case "portal":
            // `portal:/admin/orders` — a page of the portal, over its front page.
            selectedTab = .account
            let page = value ?? "/admin"
            accountPath = NavigationPath(page == "/admin" ? [Route.portal("/admin")] : [Route.portal("/admin"), Route.portal(page)])
        case "newListing":
            guard session.seller?.isStoreMember == true else { return }
            selectedTab = .account
            accountPath = NavigationPath([Route.listings, Route.newListing])
        case "address":
            // `address:pin` or `address:confirm` — a new address in the book,
            // on its map or at "Is this your address?"; `address:edit` — a
            // saved one opened for editing, its pin on the map.
            addressStep = value ?? "pin"
            openAccount(.addresses)
        case "section":
            // `section:addresses` — any account section, by its web address.
            guard let value, let route = Route.from(link: "/account/\(value)") else { return }
            openAccount(route)
        case "wishlist":
            guard let id = value.flatMap(Int.init) else { return }
            accountPath = NavigationPath([Route.wishlists, Route.wishlist(id: id)])
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

    /// The heart, wherever it is drawn — the web's `toggleSaved`. An empty
    /// heart asks first, on the owner's word: **Saved items or a wishlist?**,
    /// and for a wishlist which one (`WishSheet`) — a guest too, who is asked
    /// to sign in for a wishlist. A filled one comes off the lists and out of
    /// Saved if it is on a list, and out of Saved otherwise. With wishlists
    /// switched off it saves without asking.
    func heart(_ product: Product) async {
        let name = "\u{2068}\(product.title)\u{2069}"
        if saved.isHearted(product.id) {
            if session.isSignedIn && saved.wished.contains(product.id) {
                await saved.unwish(product.id)
                toast(language.t("wish.unwished", ["name": name]))
            } else {
                await saved.unsave(product.id)
                toast(language.t("saved.removed", ["name": name]))
            }
        } else if features.isOn("wishlists") {
            wishAsking = WishTarget(productId: product.id, title: product.title)
        } else {
            await saved.save(product.id)
            toast(language.t("saved.savedForLater", ["name": name]))
        }
    }

    /// Says something briefly — a heart saved, an add that failed — and takes
    /// it away again.
    func toast(_ text: String, undo: (@MainActor () -> Void)? = nil) {
        let shown = Toast(text: text, undo: undo)
        toastMessage = shown
        Task {
            // Longer with an Undo, so there is time to reach it.
            try? await Task.sleep(for: .seconds(undo == nil ? 2.6 : 5))
            if toastMessage == shown { toastMessage = nil }
        }
    }

    /// Puts the toast away — once its Undo has been pressed.
    func dismissToast() { toastMessage = nil }

    /// A link on the site, opened in the app: a shopping screen, or an
    /// account screen for somebody signed in, on the tab that is showing, so
    /// Back returns to the page it was opened from — on the owner's word; it
    /// used to switch to the Profile tab, where Back led to the account's home.
    /// The seller's tools still open on the Profile tab, and a guest is shown
    /// the sign-in there.
    func open(_ route: Route) {
        switch route {
        case .orders, .order, .profile, .addresses, .preferences, .notifications, .wishlists, .wishlist, .offers,
             .reviews, .help, .supportThread, .rewards, .affiliate, .subscriptions, .invoice:
            if session.isSignedIn { push(route) } else { openAccount(route) }
        case .listings, .newListing, .portal:
            if selectedTab == .account { accountPath.append(route) } else { openAccount(route) }
        case .checkout:
            openCheckout()
        case .tab(let tab):
            // The tab's first screen, as a press on it from another tab gives.
            selectedTab = tab
            select(tab)
        default:
            push(route)
        }
    }

    /// Where a finished form leads, in the form's place, so Back does not
    /// return to a form already sent — a store just opened, for one.
    func replace(with route: Route) {
        if selectedTab == .account, !accountPath.isEmpty {
            accountPath.removeLast()
            accountPath.append(route)
        } else {
            open(route)
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
        if let pending = wishAfterSignIn {
            wishAfterSignIn = nil
            // Once the sign-in sheet has gone.
            try? await Task.sleep(for: .milliseconds(450))
            wishAsking = pending
        }
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
        async let states = try? services.api.call(API.features)
        async let available = try? services.api.call(API.aiAvailable)
        async let photo = try? services.api.call(API.photoAvailable)
        if let states = await states { features = states }
        ai = await available ?? AIAvailability(chat: false, catalog: false)
        photoSearchReady = await photo?.available ?? false
    }

    /// Asks again whether this account's links earn: on sign-in, and after
    /// joining or being suspended.
    func refreshMemberCode() async {
        guard session.isSignedIn else { memberCode = nil; affiliateJoined = nil; return }
        do {
            let answer = try await services.api.call(API.memberCode)
            memberCode = answer?.code
            affiliateJoined = answer?.joined ?? false
        } catch {
            memberCode = nil
            affiliateJoined = nil
        }
    }

    func signOut() async {
        memberCode = nil
        affiliateJoined = nil
        signals.clear()
        delivery.signedOut()
        await session.signOut()
        cart.forget()
        saved.signedOut()
        accountPath = NavigationPath()
    }

    /// Switches the language, and writes it to the account so the web and
    /// another device follow — a stored language is the shopper's choice.
    /// The day's rates for the display currency (`commerce.currencyRates`);
    /// the reference table stands until they come, and when they do not.
    func refreshRates() async {
        guard language.currency != CurrencyTable.shop,
              let answer = try? await services.api.call(API.currencyRates) else { return }
        language.rates.merge(answer.rates) { _, new in new }
    }

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
        await delivery.refresh(signedIn: true)
        await refreshMemberCode()
    }
}

/// Where a product page's photo viewer starts.
enum PhotoViewerStart: Identifiable {
    case photos, zoom

    var id: Self { self }
}

/// What the search opens on when the header's field is not what was pressed.
enum SearchStart {
    case voice, photo
}

