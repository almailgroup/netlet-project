import Foundation

/// Everything the screens call, behind protocols, built once by `AppModel`.
///
/// The shopping flow — the catalogue, the bag, the account, orders and
/// selling — has a service each, because its screens share them. The
/// account's sections (addresses, notifications, wishlists, messages, help,
/// rewards…) each make a few calls of their own and share none, so they call
/// through `api`, one typed caller: eleven one-screen protocols would be
/// boilerplate that tests nothing a stub transport does not.
struct Services: Sendable {
    let configuration: APIConfiguration
    let catalog: CatalogServicing
    let cart: CartServicing
    let account: AccountServicing
    let orders: OrderServicing
    let seller: SellerServicing
    let api: APICalling

    init(client: TRPCClient) {
        configuration = client.configuration
        catalog = CatalogService(client: client)
        cart = CartService(client: client)
        account = AccountService(client: client)
        orders = OrderService(client: client)
        seller = SellerService(client: client)
        api = client
    }

    init(
        configuration: APIConfiguration,
        catalog: CatalogServicing,
        cart: CartServicing,
        account: AccountServicing,
        orders: OrderServicing,
        seller: SellerServicing,
        api: APICalling
    ) {
        self.configuration = configuration
        self.catalog = catalog
        self.cart = cart
        self.account = account
        self.orders = orders
        self.seller = seller
        self.api = api
    }
}

/// Calls one procedure, typed by what it takes and answers — what `TRPCClient`
/// does, as a protocol so a screen's model can be handed a stand-in.
protocol APICalling: Sendable {
    func call<Input, Output>(_ procedure: Procedure<Input, Output>, _ input: Input) async throws -> Output
    func call<Output>(_ procedure: Procedure<NoInput, Output>) async throws -> Output
}

extension TRPCClient: APICalling {}
