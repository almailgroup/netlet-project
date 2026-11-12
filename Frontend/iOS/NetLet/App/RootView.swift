import SwiftUI

/// The app's frame: the web's five phone tabs — Home, Categories, Deals,
/// Profile, Cart, in the order of the owner's picture — each its own stack,
/// in the system's own tab bar, drawn as icons alone.
///
/// **The tab bar is Apple's, on the owner's word**, not a copy of the web's
/// floating pill: a `TabView` built with the iOS 26 SDK is drawn in Liquid
/// Glass on iOS 26 — floating, refracting what scrolls under it, the selected
/// tab lit in the shop's navy — and as the standard tab bar on iOS 17 and 18,
/// so it is the bar every other app on the phone has. Its icons are the
/// web's own drawing (`TabIcon`), an outline and a filled form for the tab
/// that is showing, as template images the system tints — but Deals, a red
/// bag drawn a little larger, which keeps its red. Its badge is the
/// system's, its order follows the page's direction, and VoiceOver reads it
/// as a tab bar. A press still ticks at the tab bar's strength, and pressing
/// the tab you are on takes you to its top, both through the selection's own
/// setter, which the system calls for a press and never for the app's own
/// changes.
///
/// Every stack stays alive while another tab shows, so a tab comes back where
/// it was left. Selling is in the account, as on the web, rather than a tab
/// of its own; searching is the header's field on every screen, grown down
/// over the page while it is open (`SearchOverlay`). Deals is the shop's
/// on-offer shelf (`DepartmentView`'s `.deals`) as a tab's first screen.
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        @Bindable var app = app
        TabView(selection: selection) {
            NavigationStack(path: $app.homePath) { HomeView().routes() }
                .tabItem { tabFace(.home, name: "nav.home", chosen: app.selectedTab == .home) }
                .tag(AppModel.Tab.home)
            NavigationStack(path: $app.categoriesPath) { CategoriesView().routes() }
                .tabItem { tabFace(.categories, name: "nav.categories", chosen: app.selectedTab == .categories) }
                .tag(AppModel.Tab.categories)
            NavigationStack(path: $app.dealsPath) { DepartmentView(slug: nil, view: .deals, root: true).routes() }
                .tabItem { tabFace(.deals, name: "nav.deals", chosen: app.selectedTab == .deals) }
                .tag(AppModel.Tab.deals)
            NavigationStack(path: $app.accountPath) { AccountView().routes() }
                .tabItem { tabFace(.profile, name: "nav.profile", chosen: app.selectedTab == .account) }
                .badge(app.signals.total)
                .tag(AppModel.Tab.account)
            NavigationStack(path: $app.cartPath) {
                CartView(path: $app.cartPath).routes(path: $app.cartPath)
            }
            .tabItem { tabFace(.cart, name: "nav.cart", chosen: app.selectedTab == .cart) }
            .badge(app.cart.itemCount)
            .tag(AppModel.Tab.cart)
        }
        .modifier(NoBottomEdge())
        // The Deals tab's burst, over every page and taking no touch.
        .overlay { DealsBurst() }
        .overlay {
            if app.searchOpen {
                SearchOverlay()
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .top) {
            if let toast = app.toastMessage {
                ToastView(text: toast.text, undo: toast.undo) { app.dismissToast() }
                .padding(.top, 72)
                .padding(.horizontal, 16)
                .transition(.move(edge: .top).combined(with: .opacity))
                .id(toast.id)
            }
        }
        .animation(.easeOut(duration: 0.2), value: app.searchOpen)
        .animation(.easeOut(duration: 0.25), value: app.toastMessage)
        .task(id: l.current) { await app.shelf.load(language: l.current) }
        // The day's rates, once prices are read in another currency.
        .task(id: l.currency) { await app.refreshRates() }
        .sheet(isPresented: $app.chatOpen) {
            ShopChatSheet()
                .environment(\.layoutDirection, l.layoutDirection)
                .buttonStyle(HapticDefaultStyle())
        }
        .sheet(item: $app.previewing) { product in
            QuickViewSheet(product: product)
                .environment(\.layoutDirection, l.layoutDirection)
                .buttonStyle(HapticDefaultStyle())
        }
        .sheet(item: $app.wishAsking) { target in
            WishSheet(target: target)
                .environment(\.layoutDirection, l.layoutDirection)
                .buttonStyle(HapticDefaultStyle())
        }
        .sheet(item: $app.faceIdOffer) { offer in
            FaceIDOfferSheet(offer: offer)
        }
        .sheet(isPresented: $app.deliveryOpen) {
            DeliverySheet()
                .environment(\.layoutDirection, l.layoutDirection)
                .buttonStyle(HapticDefaultStyle())
        }
        .sheet(isPresented: $app.authPresented, onDismiss: {
            // Closed without signing in: the wishlist or the reminder that was waiting goes too.
            if !app.session.isSignedIn {
                app.wishAfterSignIn = nil
                app.reminders.afterSignIn = nil
            }
        }) {
            NavigationStack {
                AuthView(inSheet: true)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            BarButton(l.t("common.close")) { app.authPresented = false }
                        }
                    }
            }
            .environment(\.layoutDirection, l.layoutDirection)
            .buttonStyle(HapticDefaultStyle())
        }
    }

    /// A tab's face: its icon alone, bold, after the owner's picture — the
    /// word is its name to VoiceOver and never drawn.
    private func tabFace(_ icon: TabIcon, name: String, chosen: Bool) -> some View {
        icon.image(filled: chosen)
            .accessibilityLabel(Text(l.t(name)))
    }

    /// The tab bar's selection. The system sets it only for a press — the
    /// tab you are on included, which `select` answers by going to its top —
    /// so this is where a press ticks; the app's own moves set `selectedTab`
    /// directly and stay silent.
    private var selection: Binding<AppModel.Tab> {
        Binding(
            get: { app.selectedTab },
            set: { tab in
                Haptics.tab()
                app.select(tab)
            }
        )
    }
}

/// A short message, the web's toast: a white card with a soft shadow, and an
/// Undo beside the words where what was done can be taken back.
private struct ToastView: View {
    let text: String
    var undo: (@MainActor () -> Void)? = nil
    /// Puts the toast away once its Undo is pressed.
    var dismiss: @MainActor () -> Void = {}
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 14) {
            Text(text)
                .font(.inter(14, .medium))
                .foregroundStyle(Brand.ink)
                .multilineTextAlignment(undo == nil ? .center : .leading)
            if let undo {
                Button(l.t("cart.undo")) {
                    undo()
                    dismiss()
                }
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                    .frame(minHeight: 32)
                    .buttonStyle(.tap)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        // A pane of bright Liquid Glass floating over the page: bright, so
        // its words keep their contrast over whatever is under it; still, as
        // it is said and not pressed.
        .liquidGlass(.bright, in: RoundedRectangle(cornerRadius: 18, style: .continuous), lifted: true, interactive: false)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.updatesFrequently)
        .onAppear { announce(text) }
    }
}

extension View {
    /// Every screen a `Route` names, so any stack can open any of them — and
    /// a product opened from its card (`CardOpening`), which is the same
    /// product page growing out of the card's photo.
    func routes(path: Binding<NavigationPath>? = nil) -> some View {
        navigationDestination(for: Route.self) { route in
            RouteDestination(route: route, path: path)
        }
        .navigationDestination(for: CardOpening.self) { opening in
            RouteDestination(route: .product(handle: opening.handle), path: path)
                .modifier(ZoomFromCard(namespace: opening.namespace))
        }
    }
}

/// A product opened by a press on its card, on the owner's word ("when
/// tapping on a product in homepage, put an animation for it, which will
/// expand the image of the product into product page … when tapping on any
/// product card"). It is the system's own zoom, from iOS 18: the card's photo
/// grows into the product page, and going back the page shrinks into the card
/// it came from — by the back arrow, a swipe from the edge, or a drag down
/// from the top of the page, which the zoom brings with it (so a page opened
/// this way is put away by that drag rather than refreshed by it). iOS 17
/// pushes the page as it always did, and Reduce Motion is the system's to
/// honour.
///
/// **The card's own namespace travels with the press**, rather than one
/// namespace for the app: a product can be on a page twice — a shelf and
/// Previously viewed — and two sources under one name in one namespace would
/// leave the system to pick which card the page grows from. In its own
/// namespace a card's photo is the only thing called `photo`. The page is
/// opened by the product's handle, so everything else about it is `Route`'s.
struct CardOpening: Hashable {
    let handle: String
    /// The namespace of the card that was pressed.
    let namespace: Namespace.ID

    /// What a card's photo is called in the card's namespace.
    static let photo = "photo"
}

/// On a card's photo: where its product's page grows from (`CardOpening`).
struct ZoomSource: ViewModifier {
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.matchedTransitionSource(id: CardOpening.photo, in: namespace)
        } else {
            content
        }
    }
}

/// On the product page a card opened: it grows out of that card's photo.
private struct ZoomFromCard: ViewModifier {
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.navigationTransition(.zoom(sourceID: CardOpening.photo, in: namespace))
        } else {
            content
        }
    }
}

private struct RouteDestination: View {
    let route: Route
    let path: Binding<NavigationPath>?
    @Environment(AppModel.self) private var app

    /// **No system back button on a pushed page, ever, on the owner's word**
    /// ("this Liquid Glass arrow appears for a split second and then
    /// disappears … the arrows are already there"). Every shop and account
    /// page draws its own way back and hides the bar from inside (`ShopPage`),
    /// but a page made through `ModelHost` draws a plain ground for its first
    /// frame, before its model exists, and for that frame the bar was there
    /// with its glass back button over the page's own "‹ Your account". So
    /// the bar is hidden here, on the pushed page itself, from its first frame.
    /// The swipe back still works (`UINavigationController`'s delegate in
    /// `ShopPage.swift`). The portal, checkout and the seller's two screens
    /// keep the system bar: it is their title and their only way back, and it
    /// stays rather than flashing.
    var body: some View {
        if usesSystemBar {
            destination
        } else {
            destination
                .toolbar(.hidden, for: .navigationBar)
                .navigationBarBackButtonHidden(true)
        }
    }

    private var usesSystemBar: Bool {
        switch route {
        case .portal, .checkout, .listings, .newListing: return true
        default: return false
        }
    }

    @ViewBuilder
    private var destination: some View {
        switch route {
        case .product(let handle): ProductDetailView(handle: handle)
        case .department(let slug): DepartmentView(slug: slug)
        case .subcategory(let department, let sub): DepartmentView(slug: department, sub: sub)
        case .occasion(let slug): DepartmentView(slug: nil, occasion: slug)
        case .deals: DepartmentView(slug: nil, view: .deals)
        case .dealsIn(let department, let sub): DepartmentView(slug: department, view: .deals, sub: sub)
        case .newest: DepartmentView(slug: nil, view: .newest)
        case .newestIn(let department): DepartmentView(slug: department, view: .newest)
        case .topRatedIn(let department): DepartmentView(slug: department, view: .topRated)
        case .brandIn(let department, let name): DepartmentView(slug: department, view: .brand(name))
        case .brand(let name): DepartmentView(slug: nil, view: .brand(name))
        case .stores: StoresView()
        case .brands: BrandsView()
        case .search(let query, let department): SearchResultsView(query: query, department: department)
        case .store(let slug): StoreView(slug: slug)
        case .saved: SavedView()
        case .checkout: CheckoutView(path: path)
        case .orderPlaced(let reference):
            OrderPlacedView(reference: reference, onView: {
                path?.wrappedValue = NavigationPath([Route.order(reference: reference)])
            }, onShop: {
                path?.wrappedValue = NavigationPath()
                app.selectedTab = .home
            })
            .navigationBarBackButtonHidden()
            .toolbar(.hidden, for: .tabBar)
        case .orders: OrdersView()
        case .order(let reference): OrderDetailView(reference: reference)
        // Returns and Reviews are tabs of My orders, on the owner's word.
        case .returns: OrdersView(initialTab: "returns")
        case .frequent: FrequentView()
        case .profile: ProfileView()
        case .listings: SellerListingsView()
        case .newListing: NewListingView()
        case .addresses: AddressBookView()
        case .preferences: PreferencesView()
        case .history: BrowsingHistoryView()
        case .notifications: NotificationsView()
        case .wishlists: SavedView(initialTab: .wishlists)
        case .wishlist(let id): WishlistDetailView(listId: id)
        case .offers: PriceRequestsView()
        case .reviews: OrdersView(initialTab: "reviews")
        case .help: SupportView()
        case .supportThread(let id): SupportThreadView(conversationId: id)
        case .wallet: WalletView()
        case .affiliate: AffiliateView()
        case .subscriptions: SubscriptionsView()
        case .helpCentre: HelpCentreView()
        case .returnsPolicy: ReturnsPolicyView()
        case .legal(let document): LegalView(document: document)
        case .guides: GuidesView()
        case .guide(let slug): GuideView(slug: slug)
        case .gifts: GiftLookupView()
        case .gift(let token): GiftListView(token: token)
        case .invoice(let number): InvoiceView(number: number)
        case .portal(let path): PortalRouter(path: path)
        case .verifyInvoice(let number, let code): InvoiceVerifyView(number: number, code: code)
        case .sell: SellView()
        // Opened by switching tabs, never pushed.
        case .tab: EmptyView()
        }
    }
}
