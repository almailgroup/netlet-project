import SwiftUI

/// The tabs: Home, Search, Cart, Account — and Sell for somebody whose
/// account belongs to a store, drawn only for them because the server decides
/// (a tab a shopper can see leads to a screen refusing them).
struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        @Bindable var app = app
        TabView(selection: $app.selectedTab) {
            NavigationStack { HomeView().routes() }
                .tabItem { Label(l.t("nav.home"), systemImage: "house") }
                .tag(AppModel.Tab.home)

            NavigationStack { SearchView().routes() }
                .tabItem { Label(l.t("browse.searchCrumb"), systemImage: "magnifyingglass") }
                .tag(AppModel.Tab.search)

            CartTab()
                .tabItem { Label(l.t("nav.cart"), systemImage: "bag") }
                .badge(app.cart.itemCount)
                .tag(AppModel.Tab.cart)

            NavigationStack { AccountView().routes() }
                .tabItem { Label(l.t("nav.profile"), systemImage: "person") }
                .tag(AppModel.Tab.account)

            if app.session.seller?.isStoreMember == true {
                NavigationStack { SellerListingsView().routes() }
                    .tabItem { Label(l.t("ios.sell.tab"), systemImage: "storefront") }
                    .tag(AppModel.Tab.sell)
            }
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
        }
    }
}

/// The cart's own stack, which checkout and the placed order push onto.
struct CartTab: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        NavigationStack(path: $app.cartPath) {
            CartView(path: $app.cartPath).routes(path: $app.cartPath)
        }
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
