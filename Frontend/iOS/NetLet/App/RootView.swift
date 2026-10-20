import SafariServices
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
        .sheet(item: $app.webPage) { page in
            WebPageView(url: page.url)
                .ignoresSafeArea()
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

/// One of the website's own pages, in the system's browser sheet — help,
/// returns, selling, the terms — with the shop's navy for its controls.
private struct WebPageView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.preferredControlTintColor = UIColor(Brand.navy)
        controller.dismissButtonStyle = .close
        return controller
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
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
        case .search(let query): SearchResultsView(query: query)
        case .store(let slug): StoreView(slug: slug)
        case .saved: SavedView()
        case .checkout: CheckoutView(path: path)
        case .orderPlaced(let reference): OrderPlacedView(reference: reference, path: path)
        case .orders: OrdersView()
        case .order(let reference): OrderDetailView(reference: reference)
        case .profile: ProfileView()
        case .listings: SellerListingsView()
        case .newListing: NewListingView()
        }
    }
}
