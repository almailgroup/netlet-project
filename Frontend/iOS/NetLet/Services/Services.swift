import Foundation

/// Everything the screens call, behind protocols, built once by `AppModel`.
struct Services: Sendable {
    let configuration: APIConfiguration
    let catalog: CatalogServicing
    let cart: CartServicing
    let account: AccountServicing
    let orders: OrderServicing
    let seller: SellerServicing

    init(client: TRPCClient) {
        configuration = client.configuration
        catalog = CatalogService(client: client)
        cart = CartService(client: client)
        account = AccountService(client: client)
        orders = OrderService(client: client)
        seller = SellerService(client: client)
    }

    init(
        configuration: APIConfiguration,
        catalog: CatalogServicing,
        cart: CartServicing,
        account: AccountServicing,
        orders: OrderServicing,
        seller: SellerServicing
    ) {
        self.configuration = configuration
        self.catalog = catalog
        self.cart = cart
        self.account = account
        self.orders = orders
        self.seller = seller
    }
}
