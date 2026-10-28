import Foundation
@testable import NetLet

/// A transport that answers from a closure and remembers what it was sent.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    var sent: [URLRequest] = []
    var answer: (URLRequest) -> (Int, String)

    init(answer: @escaping (URLRequest) -> (Int, String)) {
        self.answer = answer
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        sent.append(request)
        let (status, body) = answer(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
        return (Data(body.utf8), response)
    }
}

enum Fixtures {
    /// The recorded demo answers, decoded the way the app decodes them.
    static let client = TRPCClient(configuration: APIConfiguration(baseURL: URL(string: "https://demo.invalid")!), transport: DemoTransport())

    static func cart() async throws -> Cart {
        try await client.call(API.createCart, .init(lines: [.init(variantId: "1", quantity: 1)]))
    }

    static func products() async throws -> [Product] {
        try await client.call(API.products, .init(first: 24))
    }
}

/// A bag on a pretend server: one bag at most, and it can be made to vanish.
final class FakeCartService: CartServicing, @unchecked Sendable {
    var stored: Cart?
    var vanished = false
    var created = 0
    var added: [(String, Int)] = []
    let template: Cart

    init(template: Cart) {
        self.template = template
    }

    func create(variantId: String, quantity: Int) async throws -> Cart {
        created += 1
        let cart = template.with(id: "cart-\(created)")
        stored = cart
        vanished = false
        return cart
    }

    func get(_ cartId: String) async throws -> Cart? {
        vanished || stored?.id != cartId ? nil : stored
    }

    func add(_ cartId: String, variantId: String, quantity: Int) async throws -> Cart? {
        guard !vanished, stored?.id == cartId else { return nil }
        added.append((variantId, quantity))
        return stored
    }

    func setQuantity(_ cartId: String, lineId: String, quantity: Int) async throws -> Cart? {
        guard !vanished, stored?.id == cartId else { return nil }
        if quantity == 0 { stored = stored?.with(items: []) }
        return stored
    }
}

/// A bag on a pretend server that takes its time to answer, so a test can see
/// what a press draws before it does, and can be made to refuse.
final class SlowCartService: CartServicing, @unchecked Sendable {
    let template: Cart
    let pause: Duration
    var stored: Cart?
    var refuse = false
    var reads = 0
    var quantities: [Int] = []

    init(template: Cart, pause: Duration = .milliseconds(80)) {
        self.template = template
        self.pause = pause
    }

    func create(variantId: String, quantity: Int) async throws -> Cart {
        try await Task.sleep(for: pause)
        if refuse { throw URLError(.badServerResponse) }
        let cart = template.with(id: "cart-1")
        stored = cart
        return cart
    }

    func get(_ cartId: String) async throws -> Cart? {
        reads += 1
        return stored?.id == cartId ? stored : nil
    }

    func add(_ cartId: String, variantId: String, quantity: Int) async throws -> Cart? {
        try await Task.sleep(for: pause)
        if refuse { throw URLError(.badServerResponse) }
        return stored
    }

    func setQuantity(_ cartId: String, lineId: String, quantity: Int) async throws -> Cart? {
        quantities.append(quantity)
        try await Task.sleep(for: pause)
        if refuse { throw URLError(.badServerResponse) }
        return stored
    }
}

extension Cart {
    /// The same bag under another id or with other lines, for the fakes.
    func with(id: String? = nil, items: [CartItem]? = nil) -> Cart {
        let lines = items ?? self.items
        return Cart(
            id: id ?? self.id,
            items: lines,
            itemCount: lines.reduce(0) { $0 + $1.quantity },
            subtotal: subtotal,
            delivery: delivery,
            cod: cod,
            total: total
        )
    }
}

/// An account service whose answers each test sets.
final class FakeAccountService: AccountServicing, @unchecked Sendable {
    var signInResult: Result<User, APIError> = .failure(.server(code: "UNAUTHORIZED", message: "auth.invalidCredentials", status: 401))
    var registerResult: Result<RegistrationResult, APIError> = .success(.verify(email: "noura@shop.test"))
    var verifyResult: Result<User, APIError> = .failure(.server(code: "BAD_REQUEST", message: "auth.codeWrong", status: 400))
    var resetError: APIError?
    var book: [SavedAddress] = []
    var resent: [String] = []
    var verified: [(email: String, password: String, code: String)] = []

    static let user = User(id: 2, email: "noura@shop.test", name: "Noura Al-Sabah", role: "user", createdAt: nil)

    func currentUser() async throws -> User? { nil }
    func signupOptions() async throws -> SignupOptions { SignupOptions(captchaSiteKey: nil) }
    func signIn(email: String, password: String) async throws -> User { try signInResult.get() }

    func register(email: String, password: String, name: String?, captcha: String?) async throws -> RegistrationResult {
        try registerResult.get()
    }

    func verify(email: String, password: String, code: String, name: String?) async throws -> User {
        verified.append((email, password, code))
        return try verifyResult.get()
    }

    func resendCode(email: String) async throws { resent.append(email) }

    func requestPasswordReset(email: String) async throws {
        if let resetError { throw resetError }
    }

    func signOut() async throws {}
    func updateName(_ name: String) async throws -> User { Self.user }

    var details = ProfileDetails.none
    var detailPatches: [API.DetailsPatch] = []
    var nameParts: [(String, String)] = []

    func updateNameParts(first: String, last: String) async throws -> User {
        nameParts.append((first, last))
        details.firstName = first
        details.lastName = last
        return Self.user
    }

    func profileDetails() async throws -> ProfileDetails { details }

    func saveProfileDetails(_ patch: API.DetailsPatch) async throws -> ProfileDetails {
        detailPatches.append(patch)
        if let phone = patch.phone { details.phone = phone.value.flatMap(PhoneNumber.normalise) }
        if let gender = patch.gender { details.gender = gender.value }
        if let birthday = patch.birthday { details.birthday = birthday.value }
        if let nationality = patch.nationality { details.nationality = nationality.value }
        return details
    }
    func changePassword(current: String, new: String) async throws {}
    func changeEmail(_ email: String, currentPassword: String) async throws -> User { Self.user }
    func profile() async throws -> Profile { Profile(locale: nil, deliveryZoneId: nil, cartId: nil) }
    func claimCart(_ cartId: String?, language: Language) async throws -> Profile { Profile(locale: nil, deliveryZoneId: nil, cartId: cartId) }
    func saveLanguage(_ language: Language) async throws {}
    func addresses() async throws -> [SavedAddress] { book }
    func sellerIdentity() async throws -> SellerIdentity { SellerIdentity(kind: "customer", userId: 2, vendorId: nil, role: nil) }

    var saved: [String] = []
    var savedWrites: [(String, Bool)] = []

    func savedProducts() async throws -> [String] { saved }

    func setSaved(_ productId: String, saved isSaved: Bool) async throws -> [String] {
        savedWrites.append((productId, isSaved))
        saved = isSaved ? Array(Set(saved + [productId])).sorted() : saved.filter { $0 != productId }
        return saved
    }

    var wishes: [(String, String)] = []
    var unwished: [String] = []

    func wish(_ productId: String, visibility: String, title: String) async throws -> WishAnswer {
        wishes.append((productId, visibility))
        saved = Array(Set(saved + [productId])).sorted()
        return WishAnswer(listId: visibility == "public" ? 2 : 1, title: title, created: true)
    }

    func unwish(_ productId: String) async throws {
        unwished.append(productId)
        saved = saved.filter { $0 != productId }
    }
}

/// Orders that remember what was placed.
final class FakeOrderService: OrderServicing, @unchecked Sendable {
    var placed: [API.PlaceOrder] = []
    var refusal: APIError?

    func orders(page: Int) async throws -> OrderPage { OrderPage(rows: [], total: 0, page: page, pageSize: 20) }

    func order(reference: String) async throws -> OrderDetail {
        throw APIError.server(code: "NOT_FOUND", message: "orders.detailMissing", status: 404)
    }

    func place(_ order: API.PlaceOrder) async throws -> PlacedOrder {
        if let refusal { throw refusal }
        placed.append(order)
        return PlacedOrder(reference: "NL-20261018-YNTM9", total: Money(fils: 10_250))
    }
}

/// A catalogue whose search answers what it was asked, after a delay a test chooses.
final class FakeCatalogService: CatalogServicing, @unchecked Sendable {
    var asked: [String] = []
    var delays: [String: Duration] = [:]

    func products(first: Int, department: String?, language: Language) async throws -> [Product] { [] }
    func product(handle: String, language: Language) async throws -> Product? { nil }
    func departmentCounts() async throws -> [String: Int] { [:] }
    func bestsellers(language: Language) async throws -> [Product] { [] }
    func stores(language: Language) async throws -> [StoreCard] { [] }
    func store(slug: String, language: Language) async throws -> StorePage? { nil }
    func brands() async throws -> [BrandCount] { [] }
    func contact() async throws -> ShopContact { ShopContact.fallback }

    func search(_ query: String, department: String?, limit: Int, language: Language) async throws -> SearchResult {
        asked.append(query)
        if let delay = delays[query] { try await Task.sleep(for: delay) }
        return SearchResult(products: [], total: query.count, correctedTo: nil)
    }
}

/// A suite of its own per test, so stored ids never leak between tests.
func isolatedDefaults(_ name: String = UUID().uuidString) -> UserDefaults {
    let defaults = UserDefaults(suiteName: "netlet.tests.\(name)")!
    defaults.removePersistentDomain(forName: "netlet.tests.\(name)")
    return defaults
}
