import SwiftUI

/// The home page's shelves that depend on something besides the catalogue —
/// the web's `HomeBanners`, `SponsoredShelf`, `RecommendedRail` and
/// `GuideShelf`. Each asks for its own answer and is absent until it has
/// something true to show: no house banner standing in, no "picked for you"
/// over a list that is nobody's, no guides heading over none.

// MARK: - Paid banners

/// A store's 3:1 picture and headline, approved by NetLet (`ads.banners`).
struct HomeBanner: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let imageUrl: String
    let headline: String
    let productHandle: String
    let storeName: String
}

extension API {
    struct SponsoredQuery: Encodable, Sendable {
        let slot: String
        var departmentSlug: String?
        let locale: String
    }

    struct ForMe: Encodable, Sendable {
        let cartId: String?
        let limit: Int
        let locale: String
    }

    static let homeBanners = Procedure<LocaleOnly, [HomeBanner]>(query: "ads.banners")
    static let sponsored = Procedure<SponsoredQuery, [Product]>(query: "ads.sponsored")
    static let forMe = Procedure<ForMe, Recommendations>(query: "recommendations.forMe")
}

/// The paid banners as a carousel that never moves on its own — a swipe, the
/// arrows, a count — with Sponsored and the store under every slide, and
/// absent when nothing approved runs today.
struct HomeBanners: View {
    @State private var banners: [HomeBanner] = []
    @State private var shown = 0
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !banners.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    TabView(selection: $shown) {
                        ForEach(Array(banners.enumerated()), id: \.element.id) { index, banner in
                            slide(banner, index: index)
                                .tag(index)
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    .aspectRatio(3, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay {
                        if banners.count > 1 {
                            HStack {
                                arrow(previous: true)
                                Spacer()
                                arrow(previous: false)
                            }
                            .padding(.horizontal, 8)
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(l.t("ads.bannersTitle"))
                    if banners.count > 1 {
                        Text(l.t("ads.slideOf", ["index": "\(shown + 1)", "total": "\(banners.count)"]))
                            .font(.inter(12, .semibold))
                            .foregroundStyle(Brand.muted)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
        }
        .task(id: l.current) {
            banners = (try? await app.services.api.call(API.homeBanners, .init(locale: l.current.rawValue))) ?? []
            shown = min(shown, max(0, banners.count - 1))
        }
    }

    private func slide(_ banner: HomeBanner, index: Int) -> some View {
        Button {
            app.push(.product(handle: banner.productHandle))
        } label: {
            ZStack(alignment: .bottomLeading) {
                RemoteImage(reference: banner.imageUrl)
                LinearGradient(colors: [Color.black.opacity(0), Color.black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 2) {
                    Text(banner.headline)
                        .font(.inter(15, .heavy))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(l.t("ads.sponsored") + " · " + banner.storeName)
                        .font(.inter(11, .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(1)
                }
                .padding(12)
            }
        }
        .buttonStyle(.tap)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(banner.headline + ", " + l.t("ads.sponsored") + ", " + banner.storeName)
        .accessibilityValue(banners.count > 1 ? l.t("ads.slideOf", ["index": "\(index + 1)", "total": "\(banners.count)"]) : "")
    }

    private func arrow(previous: Bool) -> some View {
        let disabled = previous ? shown == 0 : shown >= banners.count - 1
        return Button {
            withAnimation(still ? nil : .easeOut(duration: 0.25)) {
                shown = max(0, min(banners.count - 1, shown + (previous ? -1 : 1)))
            }
        } label: {
            Image(systemName: previous ? "chevron.backward" : "chevron.forward")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.white))
                .shadow(color: Brand.navy.opacity(0.18), radius: 5, x: 0, y: 2)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .opacity(disabled ? 0 : 1)
        .disabled(disabled)
        .accessibilityLabel(l.t(previous ? "ads.previousBanner" : "ads.nextBanner"))
    }
}

// MARK: - Sponsored products

/// Paid placements, on a shelf of their own and labelled — never folded into
/// a sort. On the home page a rail under its own heading; at the top of a
/// department a strip above the grid, which stays in the shopper's order.
struct SponsoredShelf: View {
    /// `home` or `department`.
    let slot: String
    var departmentSlug: String?
    @State private var products: [Product] = []
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !products.isEmpty {
                if slot == "home" {
                    VStack(alignment: .leading, spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 10) {
                                Text(l.t("ads.homeTitle")).shelfTitle()
                                Text(l.t("ads.sponsored"))
                                    .font(.inter(11, .bold))
                                    .foregroundStyle(Brand.navy)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(Capsule().fill(Brand.navy.opacity(0.08)))
                            }
                            disclosure
                        }
                        .padding(.horizontal, 16)
                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(alignment: .top, spacing: 12) {
                                ForEach(products) { product in
                                    ProductCard(product: product, note: note(product)).frame(width: 164)
                                }
                            }
                            .padding(.horizontal, 16)
                        }
                    }
                    .padding(.vertical, 24)
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(l.t("ads.sponsored"))
                            .font(.inter(15, .heavy))
                            .foregroundStyle(Brand.navy)
                            .accessibilityAddTraits(.isHeader)
                        disclosure
                        ProductGrid(products: products, note: note)
                            .padding(.top, 4)
                    }
                    .padding(.bottom, 24)
                }
            }
        }
        .task(id: "\(slot)|\(departmentSlug ?? "")|\(l.current.rawValue)") {
            guard slot == "home" || departmentSlug != nil else {
                products = []
                return
            }
            products = (try? await app.services.api.call(API.sponsored, .init(slot: slot, departmentSlug: departmentSlug, locale: l.current.rawValue))) ?? []
        }
    }

    private var disclosure: some View {
        Text(l.t("ads.disclosure"))
            .font(.inter(12))
            .foregroundStyle(Brand.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func note(_ product: Product) -> String? {
        l.t("ads.sponsored") + (product.vendor.map { " · " + $0 } ?? "")
    }
}

// MARK: - Picked for you

/// What the shop recommends, and why (`recommendations.forMe`).
struct Recommendations: Decodable, Sendable {
    struct Item: Decodable, Sendable {
        struct Reason: Decodable, Sendable {
            let key: String
            var value: String? = nil
        }

        let product: Product
        let reasons: [Reason]
    }

    let items: [Item]
    /// Whether this is about the shopper at all; otherwise nothing is drawn.
    let personalised: Bool
    let terms: [String]
    let refinedByModel: Bool
}

/// "Picked for you", drawn only when it is personal — a rail with that title
/// over a list that is nobody's is a claim checked once and never trusted
/// again — with each card's reason and the terms it learnt from. `quiet`, on
/// the home page, draws nothing while it loads and nothing under a full row.
struct RecommendedRail: View {
    var quiet = false
    @State private var answer: Recommendations?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let answer, answer.personalised, !answer.items.isEmpty, !quiet || answer.items.count >= HomeShelf.floor {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(l.t("taste.railPersonal")).shelfTitle()
                            Text(l.t("taste.railNotePersonal", ["terms": answer.terms.prefix(4).joined(separator: l.current == .ar ? "، " : ", ")]))
                                .font(.inter(13))
                                .foregroundStyle(Brand.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if answer.refinedByModel {
                            Label(l.t("taste.refined"), systemImage: "sparkles")
                                .font(.inter(11, .bold))
                                .foregroundStyle(Brand.navy)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Capsule().fill(Brand.navy.opacity(0.08)))
                        }
                    }
                    let items = Array(answer.items.prefix(4))
                    ProductGrid(products: items.map(\.product)) { product in
                        items.first { $0.product.id == product.id }?.reasons.first.map(reason)
                    }
                }
                .padding(.horizontal, quiet ? 16 : 0)
                .padding(.vertical, 24)
            }
        }
        .task(id: "\(l.current.rawValue)|\(app.cart.cartId ?? "")|\(app.saved.ids.count)") {
            guard app.features.isOn("recommendations") else {
                answer = nil
                return
            }
            answer = try? await app.services.api.call(API.forMe, .init(cartId: app.cart.cartId, limit: 8, locale: l.current.rawValue))
        }
    }

    private func reason(_ reason: Recommendations.Item.Reason) -> String {
        reason.key == "taste.becausePrice" ? l.t(reason.key) : l.t(reason.key, ["value": reason.value ?? ""])
    }
}

// MARK: - Guides

/// The newest three shoppers' guides, once one is published and while the
/// `articles` switch is on.
struct GuideShelf: View {
    @State private var guides: [GuideCard] = []
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !guides.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    ShelfHeading(title: l.t("guides.homeTitle"), viewAllKey: "guides.all") { app.push(.guides) }
                    ForEach(guides) { guide in GuideCardView(guide: guide) }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 24)
            }
        }
        .task {
            guard app.features.isOn("articles") else {
                guides = []
                return
            }
            let all = (try? await app.services.api.call(API.guides)) ?? []
            guides = Array(all.filter { $0.audience == "shopper" }.prefix(3))
        }
    }
}
