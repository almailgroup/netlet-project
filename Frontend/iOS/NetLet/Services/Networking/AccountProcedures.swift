import Foundation

/// The account's sections — the address book, preferences, notifications,
/// wishlists, price requests, reviews, messages, help, rewards, the affiliate
/// programme and Subscribe & Save — as the procedures of
/// `Backend/src/routes/{customer,notifications,wishlists,offers,reviews,chat,
/// support,rewards,affiliates,subscriptions}.ts`.
extension API {
    // MARK: Switches

    static let features = Procedure<NoInput, FeatureStates>(query: "features.states")

    // MARK: What is waiting

    static let unreadNotices = Procedure<NoInput, Int>(query: "notifications.unread")
    static let unreadSupport = Procedure<NoInput, Int>(query: "support.unread")
    static let onTheWay = Procedure<NoInput, AccountSignals.OnTheWay>(query: "orders.onTheWay")

    // MARK: Address book

    /// An address as the book's form sends it. A part left empty is not sent;
    /// the line is sent only for an address saved before the parts existed,
    /// so re-saving it does not lose the line.
    struct AddressInput: Encodable, Sendable {
        var id: Int?
        let label: String
        var contactName: String?
        var contactPhone: String?
        var governorate: String?
        var addressLine: String?
        var addressNotes: String?
        /// Sent whenever there is one: an update without it clears the pin.
        var pin: Pin?
        let parts: AddressParts
    }

    struct RowId: Encodable, Sendable {
        let id: Int
    }

    static let addAddress = Procedure<AddressInput, SavedAddress>(mutation: "customer.addresses.add")
    static let updateAddress = Procedure<AddressInput, SavedAddress>(mutation: "customer.addresses.update")
    static let removeAddress = Procedure<RowId, Acknowledged>(mutation: "customer.addresses.remove")

    // MARK: Preferences

    struct NoticeSwitch: Encodable, Sendable {
        let kind: String
        let enabled: Bool
    }

    struct DeliveryArea: Encodable, Sendable {
        let deliveryZoneId: String
    }

    static let noticePreferences = Procedure<NoInput, [NoticePreference]>(query: "customer.notifications.list")
    static let setNoticePreference = Procedure<NoticeSwitch, Acknowledged>(mutation: "customer.notifications.set")
    static let setDeliveryArea = Procedure<DeliveryArea, Profile>(mutation: "customer.profile.update")

    // MARK: Notifications

    struct Page: Encodable, Sendable {
        let page: Int
    }

    struct MarkRead: Encodable, Sendable {
        var ids: [Int]?
        var all: Bool?
    }

    struct EmailChoice: Encodable, Sendable {
        let allows: Bool
    }

    /// A pin to read the address at, in the page's language.
    struct PlaceQuery: Encodable, Sendable {
        let lat: Double
        let lng: Double
        let locale: String
    }

    static let notices = Procedure<Page, NoticePage>(query: "notifications.list")
    static let markNoticesRead = Procedure<MarkRead, Acknowledged>(mutation: "notifications.markRead")
    static let noticeChannels = Procedure<NoInput, NoticeChannels>(query: "notifications.channels")
    static let mapAvailability = Procedure<NoInput, MapAvailability>(query: "maps.providers")
    static let placeAt = Procedure<PlaceQuery, PlaceAnswer?>(query: "maps.placeAt")
    static let noticeEmail = Procedure<NoInput, Bool>(query: "notifications.email")
    static let setNoticeEmail = Procedure<EmailChoice, Acknowledged>(mutation: "notifications.setEmail")

    // MARK: Wishlists

    struct ListId: Encodable, Sendable {
        let listId: Int
    }

    struct ListTitle: Encodable, Sendable {
        let title: String
    }

    /// A change to a list; only what is set is sent. An empty owner name is
    /// sent as an empty string, which the server stores as none.
    struct ListChange: Encodable, Sendable {
        let listId: Int
        var title: String?
        var visibility: String?
        var ownerName: String?
    }

    struct ListItem: Encodable, Sendable {
        let listId: Int
        let productId: String
        var note: String?
    }

    struct ListItemId: Encodable, Sendable {
        let listId: Int
        let itemId: Int
    }

    /// The number lists are found by, or null to stop being findable.
    struct ListPhone: Encodable, Sendable {
        let phone: String?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(phone, forKey: .phone)
        }

        private enum CodingKeys: String, CodingKey {
            case phone
        }
    }

    static let wishlists = Procedure<NoInput, [WishlistSummary]>(query: "wishlists.mine")
    static let wishlist = Procedure<ListId, WishlistDetail>(query: "wishlists.get")
    /// The list's share token, or null while it is private.
    static let wishlistShareToken = Procedure<ListId, String?>(query: "wishlists.shareLink")
    static let createWishlist = Procedure<ListTitle, CreatedList>(mutation: "wishlists.create")
    static let updateWishlist = Procedure<ListChange, Acknowledged>(mutation: "wishlists.update")
    static let removeWishlist = Procedure<ListId, Acknowledged>(mutation: "wishlists.remove")
    static let addToWishlist = Procedure<ListItem, Acknowledged>(mutation: "wishlists.addItem")
    static let removeFromWishlist = Procedure<ListItemId, Acknowledged>(mutation: "wishlists.removeItem")
    /// The heart's answer: a private or a public wishlist (made if there is
    /// none, under `title`), and Saved.
    struct Wish: Encodable, Sendable {
        let productId: String
        let visibility: String
        let title: String
    }

    struct Unwish: Encodable, Sendable {
        let productId: String
    }

    /// Onto a private or a public wishlist — never into Saved, which is the
    /// heart's other answer and a different thing.
    static let wish = Procedure<Wish, WishAnswer>(mutation: "wishlists.wish")
    /// Every product on the shopper's wishlists, once each, so a heart fills
    /// for what is on a list as well as for what is saved.
    static let wishedIds = Procedure<NoInput, [String]>(query: "wishlists.wishedIds")
    /// A filled heart: out of Saved and off every list of the shopper's.
    static let unwish = Procedure<Unwish, UnwishAnswer>(mutation: "wishlists.unwish")
    static let wishlistPhone = Procedure<NoInput, String?>(query: "wishlists.phone")
    static let setWishlistPhone = Procedure<ListPhone, String?>(mutation: "wishlists.setPhone")

    struct ProductIds: Encodable, Sendable {
        let ids: [String]
        let locale: String
    }

    /// Products by the storefront's id, whatever their age — a list's items
    /// and the saved hearts are read this way, never looked up in a shelf.
    static let productsByIds = Procedure<ProductIds, [Product]>(query: "commerce.products.byIds")

    // MARK: Price requests

    struct OfferId: Encodable, Sendable {
        let offerId: Int
    }

    static let priceRequests = Procedure<NoInput, [PriceRequest]>(query: "offers.list")
    static let withdrawPriceRequest = Procedure<OfferId, Acknowledged>(mutation: "offers.withdraw")

    // MARK: Reviews

    struct WriteReview: Encodable, Sendable {
        let orderItemId: Int
        let rating: Int
        var title: String?
        var body: String?
    }

    struct EditReview: Encodable, Sendable {
        let reviewId: Int
        let rating: Int
        var title: String?
        var body: String?
    }

    struct ReviewId: Encodable, Sendable {
        let reviewId: Int
    }

    static let reviewableLines = Procedure<NoInput, [ReviewableLine]>(query: "reviews.mine")
    static let writeReview = Procedure<WriteReview, Acknowledged>(mutation: "reviews.write")
    static let editReview = Procedure<EditReview, Acknowledged>(mutation: "reviews.edit")
    static let removeReview = Procedure<ReviewId, Acknowledged>(mutation: "reviews.remove")

    // MARK: Help

    struct OpenSupport: Encodable, Sendable {
        let topic: String
        var orderReference: String?
        let body: String
    }

    struct SupportReply: Encodable, Sendable {
        let id: Int
        let body: String
    }

    static let supportConversations = Procedure<NoInput, [SupportConversation]>(query: "support.mine")
    static let supportThread = Procedure<RowId, SupportThread>(query: "support.thread")
    static let openSupport = Procedure<OpenSupport, OpenedSupport>(mutation: "support.open")
    static let replyToSupport = Procedure<SupportReply, Acknowledged>(mutation: "support.reply")
    static let resolveSupport = Procedure<RowId, Acknowledged>(mutation: "support.resolve")

    // MARK: Rewards and affiliates

    struct JoinAffiliates: Encodable, Sendable {
        /// Nil is the account's first name, the server's default.
        var displayName: String?
        let acceptDisclosure: Bool
    }

    static let rewards = Procedure<NoInput, Rewards>(query: "rewards.mine")
    static let cashOutRewards = Procedure<NoInput, Acknowledged>(mutation: "rewards.cashOut")
    static let affiliate = Procedure<NoInput, AffiliateDashboard?>(query: "affiliates.mine")
    /// The code a member's Share carries, or nil (3.7).
    static let memberCode = Procedure<NoInput, MemberCode?>(query: "affiliates.code")
    static let joinAffiliates = Procedure<JoinAffiliates, Acknowledged>(mutation: "affiliates.join")
    static let requestAffiliatePayout = Procedure<NoInput, PayoutRequested>(mutation: "affiliates.payout")
    /// The products stores offer to affiliates, each at its own rate (3.7.1); nil until approved.
    static let affiliateProducts = Procedure<PageOnly, AffiliateProductPage?>(query: "affiliates.products")

    // MARK: Subscribe & Save

    /// A change to a standing order, the server's discriminated union.
    struct StandingOrderChange: Encodable, Sendable {
        enum Action: Sendable {
            case pause, resume, skip, cancel
            /// The price the page showed, so a price that moved again is not accepted for them.
            case acceptPrice(String)
        }

        let id: Int
        let action: Action

        private enum CodingKeys: String, CodingKey {
            case id, change
        }

        private enum ChangeKeys: String, CodingKey {
            case action, price
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(id, forKey: .id)
            var change = container.nestedContainer(keyedBy: ChangeKeys.self, forKey: .change)
            switch action {
            case .pause: try change.encode("pause", forKey: .action)
            case .resume: try change.encode("resume", forKey: .action)
            case .skip: try change.encode("skip", forKey: .action)
            case .cancel: try change.encode("cancel", forKey: .action)
            case .acceptPrice(let price):
                try change.encode("acceptPrice", forKey: .action)
                try change.encode(price, forKey: .price)
            }
        }
    }

    static let standingOrders = Procedure<NoInput, [StandingOrder]>(query: "subscriptions.mine")
    static let changeStandingOrder = Procedure<StandingOrderChange, Acknowledged>(mutation: "subscriptions.change")
}

/// The product page's own calls, beyond the product itself.
extension API {
    struct ProductReviewsInput: Encodable, Sendable {
        let productId: String
        let limit: Int
    }

    struct ProductId: Encodable, Sendable {
        let productId: String
    }

    struct TogetherInput: Encodable, Sendable {
        let productId: String
        let limit: Int
        let locale: String
    }

    struct VariantIds: Encodable, Sendable {
        let variantIds: [Int]
    }

    struct VariantId: Encodable, Sendable {
        let variantId: Int
    }

    struct VariantText: Encodable, Sendable {
        let variantId: String
    }

    struct AskPrice: Encodable, Sendable {
        let variantId: Int
        let askedPrice: String
        let quantity: Int
        let note: String?

        private enum CodingKeys: String, CodingKey { case variantId, askedPrice, quantity, note }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(variantId, forKey: .variantId)
            try container.encode(askedPrice, forKey: .askedPrice)
            try container.encode(quantity, forKey: .quantity)
            try container.encode(note, forKey: .note)
        }
    }

    struct Follow: Encodable, Sendable {
        let productId: String
        var priceDrop: Bool?
        var backInStock: Bool?
    }

    struct Subscribe: Encodable, Sendable {
        let variantId: Int
        let quantity: Int
        let intervalWeeks: Int
        let addressId: Int
        let firstRunOn: String
    }

    static let productReviews = Procedure<ProductReviewsInput, ProductReviewsPage>(query: "reviews.forProduct")
    static let boughtTogether = Procedure<TogetherInput, [Complement]>(query: "together.forProduct")
    static let bundles = Procedure<VariantText, [ProductBundle]>(query: "commerce.bundlesForVariant")
    /// Which of these variants take price requests.
    static let priceRequestsOpen = Procedure<VariantIds, [Int]>(query: "offers.openOn")
    static let myPriceRequest = Procedure<VariantId, HeldPriceRequest?>(query: "offers.mine")
    static let askForPrice = Procedure<AskPrice, Acknowledged>(mutation: "offers.request")
    static let follows = Procedure<NoInput, [ProductFollow]>(query: "customer.follows.list")
    static let setFollow = Procedure<Follow, Acknowledged>(mutation: "customer.follows.set")
    static let followers = Procedure<ProductId, Int>(query: "customer.follows.demand")
    static let fit = Procedure<ProductId, FitFeedback>(query: "returns.fit")
    /// The signed-in shopper's own past lines in a product's department.
    static let mySizes = Procedure<ProductId, [PastSizeLine]>(query: "returns.mySizes")
    static let subscribe = Procedure<Subscribe, StartedSubscription>(mutation: "subscriptions.create")
}
