import SwiftUI

/// The app's frame: the web's four phone tabs — Home, Profile, Cart,
/// Categories — each its own stack, in the system's own tab bar.
///
/// **The tab bar is Apple's, on the owner's word**, not a copy of the web's
/// floating pill: a `TabView` built with the iOS 26 SDK is drawn in Liquid
/// Glass on iOS 26 — floating, refracting what scrolls under it, the selected
/// tab lit in the shop's navy — and as the standard tab bar on iOS 17 and 18,
/// so it is the bar every other app on the phone has. Its badge is the
/// system's, its order follows the page's direction, and VoiceOver reads it
/// as a tab bar. A press still ticks at the tab bar's strength, and pressing
/// the tab you are on takes you to its top, both through the selection's own
/// setter, which the system calls for a press and never for the app's own
/// changes.
///
/// Every stack stays alive while another tab shows, so a tab comes back where
/// it was left. Selling is in the account, as on the web, rather than a fifth
/// tab; searching is the header's field on every screen, grown down over the
/// page while it is open (`SearchOverlay`).
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        @Bindable var app = app
        TabView(selection: selection) {
            NavigationStack(path: $app.homePath) { HomeView().routes() }
                .tabItem { Label(l.t("nav.home"), systemImage: "house") }
                .tag(AppModel.Tab.home)
            NavigationStack(path: $app.accountPath) { AccountView().routes() }
                .tabItem { Label(l.t("nav.profile"), systemImage: "person") }
                .badge(app.signals.total)
                .tag(AppModel.Tab.account)
            NavigationStack(path: $app.cartPath) {
                CartView(path: $app.cartPath).routes(path: $app.cartPath)
            }
            .tabItem { Label(l.t("nav.cart"), systemImage: "cart") }
            .badge(app.cart.itemCount)
            .tag(AppModel.Tab.cart)
            NavigationStack(path: $app.categoriesPath) { CategoriesView().routes() }
                .tabItem { Label(l.t("nav.categories"), systemImage: "square.grid.2x2") }
                .tag(AppModel.Tab.categories)
        }
        .modifier(NoBottomEdge())
        .overlay {
            if app.searchOpen {
                SearchOverlay()
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .top) {
            if let toast = app.toastMessage {
                ToastView(text: toast.text)
                    .padding(.top, 72)
                    .padding(.horizontal, 16)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .id(toast.id)
            }
        }
        .animation(.easeOut(duration: 0.2), value: app.searchOpen)
        .animation(.easeOut(duration: 0.25), value: app.toastMessage)
        .task(id: l.current) { await app.shelf.load(language: l.current) }
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
        .sheet(item: $app.wishAsking) { product in
            WishSheet(product: product)
                .environment(\.layoutDirection, l.layoutDirection)
                .buttonStyle(HapticDefaultStyle())
        }
        .sheet(isPresented: $app.deliveryOpen) {
            DeliverySheet()
                .environment(\.layoutDirection, l.layoutDirection)
                .buttonStyle(HapticDefaultStyle())
        }
        .sheet(isPresented: $app.authPresented) {
            NavigationStack {
                AuthView(inSheet: true)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button(l.t("auth.close")) { app.authPresented = false }
                        }
                    }
            }
            .environment(\.layoutDirection, l.layoutDirection)
            .buttonStyle(HapticDefaultStyle())
        }
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

/// A short message, the web's toast: a white card with a soft shadow.
private struct ToastView: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.inter(14, .medium))
            .foregroundStyle(Brand.ink)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .shadow(color: Brand.navy.opacity(0.12), radius: 12, x: 0, y: 6)
            .accessibilityAddTraits(.updatesFrequently)
            .onAppear { announce(text) }
    }
}

extension View {
    /// Every screen a `Route` names, so any stack can open any of them.
    func routes(path: Binding<NavigationPath>? = nil) -> some View {
        navigationDestination(for: Route.self) { route in
            RouteDestination(route: route, path: path)
        }
    }
}

private struct RouteDestination: View {
    let route: Route
    let path: Binding<NavigationPath>?

    var body: some View {
        switch route {
        case .product(let handle): ProductDetailView(handle: handle)
        case .department(let slug): DepartmentView(slug: slug)
        case .deals: DepartmentView(slug: nil, view: .deals)
        case .newest: DepartmentView(slug: nil, view: .newest)
        case .brand(let name): DepartmentView(slug: nil, view: .brand(name))
        case .stores: StoresView()
        case .search(let query, let department): SearchResultsView(query: query, department: department)
        case .store(let slug): StoreView(slug: slug)
        case .saved: SavedView()
        case .checkout: CheckoutView(path: path)
        case .orderPlaced(let reference): OrderPlacedView(reference: reference, path: path)
        case .orders: OrdersView()
        case .order(let reference): OrderDetailView(reference: reference)
        case .profile: ProfileView()
        case .listings: SellerListingsView()
        case .newListing: NewListingView()
        case .addresses: AddressBookView()
        case .preferences: PreferencesView()
        case .notifications: NotificationsView()
        case .wishlists: WishlistsView()
        case .wishlist(let id): WishlistDetailView(listId: id)
        case .offers: PriceRequestsView()
        case .reviews: ReviewsView()
        case .help: SupportView()
        case .supportThread(let id): SupportThreadView(conversationId: id)
        case .rewards: RewardsView()
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
        }
    }
}
