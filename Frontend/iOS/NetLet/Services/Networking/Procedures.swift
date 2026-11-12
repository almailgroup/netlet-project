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

    struct OccasionSlug: Encodable, Sendable {
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
    /// The home page's Trending: what was bought, bagged, hearted and wished for this week.
    static let trending = Procedure<LocaleOnly, [Product]>(query: "commerce.trending")
    /// NetLet's own occasions running today, each with the products chosen for it.
    static let liveOccasions = Procedure<LocaleOnly, LiveOccasions>(query: "occasions.live")
    /// One occasion's page: NetLet's published occasion at an address, or nothing.
    static let occasionPage = Procedure<OccasionSlug, OccasionPage>(query: "occasions.bySlug")
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
    /// Each department's subcategories' counts, by the department's slug and then the subcategory's.
    static let subcategoryCounts = Procedure<NoInput, [String: [String: Int]]>(query: "commerce.subcategoryCounts")
    /// The pictures an administrator kept for the subcategories, `department/slug` → `/media` path.
    static let subcategoryPictures = Procedure<NoInput, [String: String]>(query: "subcategoryPictures.list")
    /// The day's rates for the display currency; prices are still charged in dinars.
    static let currencyRates = Procedure<NoInput, CurrencyRatesAnswer>(query: "commerce.currencyRates")
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
        /// The lines left out of this checkout (`CartChoice`); nil is none.
        var skip: [String]? = nil
    }

    struct CartAdd: Encodable, Sendable {
        let cartId: String
        let lines: [CartLine]
        var skip: [String]? = nil
    }

    struct CartLineUpdate: Encodable, Sendable {
        let lineId: String
        /// Zero removes the line.
        let quantity: Int
    }

    struct CartUpdate: Encodable, Sendable {
        let cartId: String
        let lines: [CartLineUpdate]
        var skip: [String]? = nil
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
        var skip: [String]? = nil

        // The server takes an explicit null to mean "the order's address".
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(cartId, forKey: .cartId)
            try container.encode(lineId, forKey: .lineId)
            try container.encode(addressId, forKey: .addressId)
            try container.encodeIfPresent(skip, forKey: .skip)
        }

        private enum CodingKeys: String, CodingKey { case cartId, lineId, addressId, skip }
    }

    static let setLineDestination = Procedure<LineDestination, Cart?>(mutation: "commerce.cart.setDestination")

    struct LineDeliveryChoice: Encodable, Sendable {
        let cartId: String
        let lineId: String
        /// "regular" or "fast" (3.2.5).
        let choice: String
        var skip: [String]? = nil
    }

    static let setLineDeliveryChoice = Procedure<LineDeliveryChoice, Cart?>(mutation: "commerce.cart.setDeliveryChoice")

    /// A store's or a product's discount code on one line (migration 0074).
    struct LineCodeInput: Encodable, Sendable {
        let cartId: String
        let lineId: String
        let code: String
        var skip: [String]? = nil
    }

    /// The bag with the code on the line, or why it does not fit (a message key).
    struct LineCodeAnswer: Decodable, Sendable {
        let ok: Bool
        let cart: Cart?
        let reason: String?
    }

    struct LineCodeClear: Encodable, Sendable {
        let cartId: String
        let lineId: String
        var skip: [String]? = nil
    }

    static let setLineCode = Procedure<LineCodeInput, LineCodeAnswer>(mutation: "commerce.cart.setLineCode")
    static let clearLineCode = Procedure<LineCodeClear, Cart?>(mutation: "commerce.cart.clearLineCode")
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
        /// A friend's invitation code (`InviteCode`), when one was typed.
        var referral: String?
    }

    struct Verify: Encodable, Sendable {
        let email: String
        let password: String
        let code: String
        var name: String?
        let remember: Bool
        var referral: String?
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

    /// Deleting the account asks for the password again — or, for an account
    /// that signs in with Apple, Apple's confirmation, whose code lets the
    /// server unlink the Apple ID once the account is gone.
    struct DeleteAccount: Encodable, Sendable {
        var currentPassword: String?
        var apple: AppleProof?
        var google: GoogleProof?
        /// An account made with a phone: the code texted to it.
        var phoneCode: String?
    }

    /// "Continue with phone number" (`auth.phoneStart`, `auth.phoneVerify`).
    struct PhoneStart: Encodable, Sendable {
        let phone: String
    }
    struct PhoneStarted: Decodable, Sendable {
        let phone: String
    }
    struct PhoneVerify: Encodable, Sendable {
        let phone: String
        let code: String
        let remember: Bool
        var referral: String?
    }
    /// Signing in with a one-time code emailed to the account
    /// (`auth.codeStart`, `auth.codeSignIn`). The answer to the first is the
    /// same whether or not the address has an account.
    struct CodeStarted: Decodable, Sendable {
        let sent: Bool
        let email: String
    }
    struct CodeSignIn: Encodable, Sendable {
        let email: String
        let code: String
        let remember: Bool
    }
    /// Signing in with Face ID (`auth.biometricChallenge`, `auth.biometricSignIn`,
    /// `auth.biometricRegister`, `auth.biometricKeys`, `auth.biometricRemove`):
    /// a challenge for this phone's key, the challenge signed, and the phones
    /// the account has it on. `active` says whether NetLet still holds the key.
    struct BiometricKeyInput: Encodable, Sendable {
        let keyId: String
    }
    struct BiometricChallenge: Decodable, Sendable {
        let challenge: String
        let active: Bool
    }
    struct BiometricSignIn: Encodable, Sendable {
        let keyId: String
        let challenge: String
        let signature: String
        let remember: Bool
    }
    struct BiometricRegister: Encodable, Sendable {
        let keyId: String
        let publicKey: String
        let deviceName: String?
    }
    struct BiometricRegistered: Decodable, Sendable {
        let ok: Bool
    }
    /// `ready` is false until migration 0078 is pasted, and the phone offers nothing.
    struct BiometricKeyList: Decodable, Sendable {
        let ready: Bool
        let keys: [BiometricKey]
    }
    struct BiometricKey: Decodable, Sendable, Identifiable, Equatable {
        let keyId: String
        let deviceName: String?
        let createdAt: Date
        let lastUsedAt: Date?
        var id: String { keyId }
    }
    struct BiometricRemoved: Decodable, Sendable {
        let removed: Bool
    }
    /// Adding an email to an account made with a phone (`auth.addEmailStart`,
    /// `auth.addEmailVerify`): the address, then the code emailed to it.
    struct AddEmailStart: Encodable, Sendable {
        let email: String
    }
    struct AddEmailStarted: Decodable, Sendable {
        let email: String
    }
    struct AddEmailVerify: Encodable, Sendable {
        let email: String
        let code: String
    }

    /// Signing in — or opening an account — with Apple (`auth.appleSignIn`).
    /// The name is Apple's, given only the first time an Apple ID meets NetLet.
    struct AppleSignInInput: Encodable, Sendable {
        let idToken: String
        let nonce: String
        var code: String?
        var firstName: String?
        var lastName: String?
        let remember: Bool
        var referral: String?
    }

    /// What stands between the shopper and deleting their account, and the
    /// points that go with it.
    struct AccountDeletionCheck: Decodable, Sendable {
        let blockers: [String]
        let points: Int
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
    /// Named for what it answers: `providers` alone reads like the maps'.
    static let signInWays = Procedure<NoInput, SignInWays>(query: "auth.providers")
    static let appleSignIn = Procedure<AppleSignInInput, User>(mutation: "auth.appleSignIn")
    /// The same input, Google's token in it; the name comes from the token.
    static let googleSignIn = Procedure<AppleSignInInput, User>(mutation: "auth.googleSignIn")
    static let phoneStart = Procedure<PhoneStart, PhoneStarted>(mutation: "auth.phoneStart")
    static let phoneVerify = Procedure<PhoneVerify, PhoneVerified>(mutation: "auth.phoneVerify")
    static let codeStart = Procedure<Email, CodeStarted>(mutation: "auth.codeStart")
    static let codeSignIn = Procedure<CodeSignIn, User>(mutation: "auth.codeSignIn")
    static let biometricChallenge = Procedure<BiometricKeyInput, BiometricChallenge>(mutation: "auth.biometricChallenge")
    static let biometricSignIn = Procedure<BiometricSignIn, User>(mutation: "auth.biometricSignIn")
    static let biometricRegister = Procedure<BiometricRegister, BiometricRegistered>(mutation: "auth.biometricRegister")
    static let biometricKeys = Procedure<NoInput, BiometricKeyList>(query: "auth.biometricKeys")
    static let biometricRemove = Procedure<BiometricKeyInput, BiometricRemoved>(mutation: "auth.biometricRemove")
    static let addEmailStart = Procedure<AddEmailStart, AddEmailStarted>(mutation: "auth.addEmailStart")
    static let addEmailVerify = Procedure<AddEmailVerify, User>(mutation: "auth.addEmailVerify")
    static let accountSignInWays = Procedure<NoInput, AccountSignInWays>(query: "auth.myProviders")
    static let signIn = Procedure<SignIn, User>(mutation: "auth.login")
    static let register = Procedure<Register, RegistrationResult>(mutation: "auth.register")
    static let verifyEmail = Procedure<Verify, User>(mutation: "auth.verifyEmail")
    static let resendCode = Procedure<Email, Acknowledged>(mutation: "auth.resendCode")
    static let requestPasswordReset = Procedure<Email, Acknowledged>(mutation: "auth.requestPasswordReset")

    /// The reset mail's code and the new password, on one screen (`auth.resetWithCode`).
    struct ResetWithCode: Encodable, Sendable {
        let email: String
        let code: String
        let password: String
        let remember: Bool
    }

    static let resetWithCode = Procedure<ResetWithCode, RegistrationResult>(mutation: "auth.resetWithCode")
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
    }

    /// The name in its parts; the server writes the display name from them.
    static let updateNameParts = Procedure<NameParts, User>(mutation: "auth.updateNameParts")
    static let profileDetails = Procedure<NoInput, ProfileDetails>(query: "customer.details.get")
    static let profilePhoto = Procedure<NoInput, ProfilePhotoInfo>(query: "customer.photo.get")
    static let removeProfilePhoto = Procedure<NoInput, ProfilePhotoInfo>(mutation: "customer.photo.remove")
    static let saveProfileDetails = Procedure<DetailsPatch, ProfileDetails>(mutation: "customer.details.save")
    static let changePassword = Procedure<ChangePassword, Acknowledged>(mutation: "auth.changePassword")
    /// Named for the account: `deletionCheck` is a product's (`PortalProcedures`).
    static let accountDeletionCheck = Procedure<NoInput, AccountDeletionCheck>(query: "auth.deletionCheck")
    static let deleteAccount = Procedure<DeleteAccount, Acknowledged>(mutation: "auth.deleteAccount")
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
        /// One of `ORDER_VIEWS`; nil is every order.
        var view: String?
        var q: String?
        /// One of `ORDER_PERIODS`; nil is any time.
        var period: String?
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
        /// The address as one line, for a saved address kept before the parts existed.
        var addressLine: String? = nil
        /// The presents a guest took on this phone, so the order marks them bought.
        var giftClaims: [GiftClaim]?
        /// Where the door is on the map, when the shopper pinned it.
        var pin: Pin?
        /// Spend the referral balance on this order, capped at what it owes.
        var usePoints: Bool?
        /// A discount code (or a gift card, when the gift box is empty), as
        /// typed and quoted.
        var voucherCode: String?
        /// A gift card from its own box, beside a discount code.
        var giftCardCode: String? = nil
        /// The lines left out of this checkout (`CartChoice`); they stay in the bag.
        var skip: [String]? = nil
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
        /// Of the lines chosen for this checkout, as the order will be.
        var skip: [String]? = nil
    }

    static let quoteVoucher = Procedure<VoucherAsk, VoucherQuote>(query: "orders.quoteVoucher")

    static let orders = Procedure<OrderList, OrderPage>(query: "orders.list")
    static let order = Procedure<Reference, OrderDetail?>(query: "orders.get")
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
        /// Only products filed under no department.
        var noDepartment: Bool?
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
