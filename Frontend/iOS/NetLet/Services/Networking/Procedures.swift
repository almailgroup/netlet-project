import Foundation

/// Every server procedure the app calls, with the shape it takes and the shape
/// it answers — the names and inputs of `Backend/src/routes/*`. An input field
/// left nil is not sent, which is what the server's `.optional()` expects.
enum API {
    // MARK: Catalogue

    struct ProductList: Encodable, Sendable {
        var first: Int?
        var collectionHandle: String?
        var locale: String?
    }

    struct ProductHandle: Encodable, Sendable {
        let handle: String
        let locale: String
    }

    struct Search: Encodable, Sendable {
        let q: String
        var department: String?
        let locale: String
        var limit: Int?
    }

    struct LocaleOnly: Encodable, Sendable {
        let locale: String
    }

    struct StoreSlug: Encodable, Sendable {
        let slug: String
        let locale: String
    }

    struct StoreList: Encodable, Sendable {
        let locale: String
        var limit: Int?
    }

    static let products = Procedure<ProductList, [Product]>(query: "commerce.products.list")
    /// The home page's Bestsellers: units sold over the last ninety days.
    static let bestsellers = Procedure<LocaleOnly, [Product]>(query: "commerce.bestsellers")
    /// Stores with something on sale, the busiest first.
    static let stores = Procedure<StoreList, [StoreCard]>(query: "commerce.stores")
    /// One store's public page, or nil for an address no approved store answers to.
    static let store = Procedure<StoreSlug, StorePage?>(query: "commerce.store")
    /// The Brand rows of the live catalogue, counted.
    static let brands = Procedure<NoInput, [BrandCount]>(query: "commerce.brands")
    /// How to reach a person at NetLet, and who the shop is — the footer's.
    static let contact = Procedure<NoInput, ShopContact>(query: "support.channels")
    static let product = Procedure<ProductHandle, Product?>(query: "commerce.products.byHandle")
    static let departmentCounts = Procedure<NoInput, [String: Int]>(query: "commerce.departmentCounts")
    static let search = Procedure<Search, SearchResult>(query: "search.products")

    // MARK: Bag

    struct CartLine: Encodable, Sendable {
        let variantId: String
        let quantity: Int
        /// The extras ticked on this line, by id; their price is the catalogue's.
        var addonIds: [String]? = nil
        /// The set that put this line here; the server splits its price.
        var bundleId: Int? = nil
    }

    struct CartCreate: Encodable, Sendable {
        let lines: [CartLine]
    }

    struct CartId: Encodable, Sendable {
        let cartId: String
    }

    struct CartAdd: Encodable, Sendable {
        let cartId: String
        let lines: [CartLine]
    }

    struct CartLineUpdate: Encodable, Sendable {
        let lineId: String
        /// Zero removes the line.
        let quantity: Int
    }

    struct CartUpdate: Encodable, Sendable {
        let cartId: String
        let lines: [CartLineUpdate]
    }

    static let createCart = Procedure<CartCreate, Cart>(mutation: "commerce.cart.create")
    static let cart = Procedure<CartId, Cart?>(query: "commerce.cart.get")
    /// Both answer null for a bag the server no longer has.
    static let addToCart = Procedure<CartAdd, Cart?>(mutation: "commerce.cart.addLines")

    /// One line to another door; `addressId` nil sends it back to the order's.
    struct LineDestination: Encodable, Sendable {
        let cartId: String
        let lineId: String
        let addressId: Int?

        // The server takes an explicit null to mean "the order's address".
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(cartId, forKey: .cartId)
            try container.encode(lineId, forKey: .lineId)
            try container.encode(addressId, forKey: .addressId)
        }

        private enum CodingKeys: String, CodingKey { case cartId, lineId, addressId }
    }

    static let setLineDestination = Procedure<LineDestination, Cart?>(mutation: "commerce.cart.setDestination")

    struct LineDeliveryChoice: Encodable, Sendable {
        let cartId: String
        let lineId: String
        /// "regular" or "fast" (3.2.5).
        let choice: String
    }

    static let setLineDeliveryChoice = Procedure<LineDeliveryChoice, Cart?>(mutation: "commerce.cart.setDeliveryChoice")
    static let updateCart = Procedure<CartUpdate, Cart?>(mutation: "commerce.cart.updateLines")

    // MARK: Accounts

    struct SignIn: Encodable, Sendable {
        let email: String
        let password: String
        let remember: Bool
    }

    struct Register: Encodable, Sendable {
        let email: String
        let password: String
        var name: String?
        var captcha: String?
    }

    struct Verify: Encodable, Sendable {
        let email: String
        let password: String
        let code: String
        var name: String?
        let remember: Bool
    }

    struct Email: Encodable, Sendable {
        let email: String
    }

    struct Name: Encodable, Sendable {
        let name: String
    }

    struct ChangePassword: Encodable, Sendable {
        let currentPassword: String
        let newPassword: String
    }

    struct ChangeEmail: Encodable, Sendable {
        let email: String
        let currentPassword: String
    }

    struct ProfileUpdate: Encodable, Sendable {
        var locale: String?
        var cartId: String?
    }

    static let me = Procedure<NoInput, User?>(query: "auth.me")
    static let signupOptions = Procedure<NoInput, SignupOptions>(query: "auth.signupOptions")
    static let signIn = Procedure<SignIn, User>(mutation: "auth.login")
    static let register = Procedure<Register, RegistrationResult>(mutation: "auth.register")
    static let verifyEmail = Procedure<Verify, User>(mutation: "auth.verifyEmail")
    static let resendCode = Procedure<Email, Acknowledged>(mutation: "auth.resendCode")
    static let requestPasswordReset = Procedure<Email, Acknowledged>(mutation: "auth.requestPasswordReset")
    static let signOut = Procedure<NoInput, Acknowledged>(mutation: "auth.logout")
    static let updateName = Procedure<Name, User>(mutation: "auth.updateName")

    struct NameParts: Encodable, Sendable {
        let firstName: String
        let lastName: String
    }

    /// Only the fields set are sent, and a null clears one — each card on
    /// "Your profile" saves its own field.
    struct DetailsPatch: Encodable, Sendable {
        var phone: OrNull<String>?
        var gender: OrNull<String>?
        var birthday: OrNull<String>?
        var nationality: OrNull<String>?
    }

    /// The name in its parts; the server writes the display name from them.
    static let updateNameParts = Procedure<NameParts, User>(mutation: "auth.updateNameParts")
    static let profileDetails = Procedure<NoInput, ProfileDetails>(query: "customer.details.get")
    static let saveProfileDetails = Procedure<DetailsPatch, ProfileDetails>(mutation: "customer.details.save")
    static let changePassword = Procedure<ChangePassword, Acknowledged>(mutation: "auth.changePassword")
    static let changeEmail = Procedure<ChangeEmail, User>(mutation: "auth.changeEmail")
    static let profile = Procedure<NoInput, Profile>(query: "customer.profile.get")
    static let updateProfile = Procedure<ProfileUpdate, Profile>(mutation: "customer.profile.update")
    static let addresses = Procedure<NoInput, [SavedAddress]>(query: "customer.addresses.list")

    struct SavedChange: Encodable, Sendable {
        let productId: String
        let saved: Bool
    }

    /// The account's saved products, by the storefront's product id.
    static let savedList = Procedure<NoInput, [String]>(query: "customer.saved.list")
    /// Saves or unsaves one, answering the whole list as it now stands.
    static let setSaved = Procedure<SavedChange, [String]>(mutation: "customer.saved.set")

    // MARK: Orders

    struct OrderList: Encodable, Sendable {
        var page: Int?
        var pageSize: Int?
    }

    struct Reference: Encodable, Sendable {
        let reference: String
    }

    /// Placing an order: the bag, how it is paid and where it goes. Prices,
    /// delivery and whether cash is even possible are the server's to decide.
    struct PlaceOrder: Encodable, Sendable {
        let cartId: String
        let paymentMethod: String
        var contactName: String?
        var contactPhone: String?
        var deliveryZoneId: String?
        var addressNotes: String?
        var addressParts: AddressParts?
        /// The presents a guest took on this phone, so the order marks them bought.
        var giftClaims: [GiftClaim]?
        /// Where the door is on the map, when the shopper pinned it.
        var pin: Pin?
        /// Spend the referral balance on this order, capped at what it owes.
        var usePoints: Bool?
        /// A discount code or a gift card, as typed and quoted.
        var voucherCode: String?
    }

    /// What a code would do to this bag (`orders.quoteVoucher`): a discount
    /// off the goods, or a gift card paying toward what is left, or why not.
    struct VoucherQuote: Decodable, Hashable, Sendable {
        let ok: Bool
        let kind: String?
        let amount: Money?
        let remaining: Money?
        let reason: String?
    }

    struct VoucherAsk: Encodable, Sendable {
        let cartId: String
        let code: String
    }

    static let quoteVoucher = Procedure<VoucherAsk, VoucherQuote>(query: "orders.quoteVoucher")

    static let orders = Procedure<OrderList, OrderPage>(query: "orders.list")
    static let order = Procedure<Reference, OrderDetail>(query: "orders.get")
    static let placeOrder = Procedure<PlaceOrder, PlacedOrder>(mutation: "orders.place")

    // MARK: Selling

    struct SellerList: Encodable, Sendable {
        /// Which store, for somebody who belongs to more than one.
        var vendorId: Int?
        var page: Int?
        var pageSize: Int?
        var query: String?
        var status: String?
        var categoryId: Int?
        /// "out" or "low".
        var stock: String?
    }

    struct NewListing: Encodable, Sendable {
        struct Variant: Encodable, Sendable {
            let price: String
            var compareAtPrice: String?
            var sku: String?
            let stock: Int
        }

        struct Photo: Encodable, Sendable {
            let url: String
        }

        /// A specification row by the department's own key.
        struct Spec: Encodable, Sendable {
            let key: String
            let value: String
        }

        let vendorId: Int
        let title: String
        let titleAr: String
        var description: String?
        var descriptionAr: String?
        var categoryId: Int?
        var tags: [String]?
        var warranty: String?
        var specs: [Spec]?
        let variant: Variant
        let images: [Photo]
    }

    struct ListingStatus: Encodable, Sendable {
        let id: Int
        let status: String
    }

    static let sellerIdentity = Procedure<NoInput, SellerIdentity>(query: "inventory.me")
    static let categories = Procedure<NoInput, [Category]>(query: "inventory.categories")
    static let sellerProducts = Procedure<SellerList, SellerProductPage>(query: "inventory.products.list")
    static let createListing = Procedure<NewListing, CreatedListing>(mutation: "inventory.products.create")

    /// Whether "Draft with AI" can offer the Arabic name at all.
    static let arabicDraftAvailable = Procedure<NoInput, Bool>(query: "inventory.products.arabicDraftAvailable")

    struct EnglishName: Encodable, Sendable {
        let vendorId: Int
        let title: String
    }

    /// A draft of the Arabic name for the seller to read and keep or change.
    static let draftArabicTitle = Procedure<EnglishName, DraftAnswer>(mutation: "inventory.products.draftArabicTitle")

    /// The store a store's own people act for, with whether its listings are
    /// checked before they go live; nil for anybody else.
    static let myStore = Procedure<NoInput, OwnStore?>(query: "inventory.myStore")
    /// Answers the status the product is now in — `pending_review` when the
    /// store's listings are checked before they go live.
    static let setListingStatus = Procedure<ListingStatus, String>(mutation: "inventory.products.setStatus")
}
