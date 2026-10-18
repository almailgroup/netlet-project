import SwiftUI

/// The home page, the web's `Home` as a phone draws it: the front door, the
/// departments as cards, Deals as a navy band led by the deepest saving,
/// Bestsellers ranked, the brands, the stores, the new arrivals as a grid, and
/// the footer. Every shelf after the departments is drawn only when it has
/// something true to show (`shelvesFor`, in `HomeShelf`).
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let shelf = app.shelf
        let shelves = shelf.shelves
        ShopPage(root: true, refresh: { await shelf.load(language: l.current, force: true) }) {
            HomeHero(dealsDrawn: shelf.dealsDrawn)
            VStack(alignment: .leading, spacing: 16) {
                Text(l.t("home.shopByCategory")).shelfTitle()
                DepartmentCardGrid()
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            switch shelf.catalogue {
            case .idle, .loading:
                VStack(alignment: .leading, spacing: 16) {
                    Text(l.t("rail.deals.title")).shelfTitle().padding(.horizontal, 16)
                    ShelfSkeleton()
                }
                .padding(.vertical, 24)
            case .failed:
                Text(l.t("home.catalogSlow"))
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 40)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color(red: 242 / 255, green: 182 / 255, blue: 158 / 255), lineWidth: 1))
                    .padding(16)
            case .loaded:
                if !shelves.deals.isEmpty {
                    DealsBand(products: shelves.deals)
                }
                if !shelves.bestsellers.isEmpty {
                    ProductRail(title: l.t("rail.bestsellers.title"), products: shelves.bestsellers, ranked: true)
                }
                if shelf.brands.count >= HomeShelf.minimumRow {
                    BrandShelf(brands: shelf.brands)
                }
                if shelf.stores.count >= HomeShelf.minimumRow {
                    StoreShelf(stores: shelf.stores)
                }
                if !shelves.newest.isEmpty {
                    VStack(alignment: .leading, spacing: 16) {
                        ShelfHeading(title: l.t("rail.newest.title")) { app.push(.newest) }
                        ProductGrid(products: Array(shelves.newest.prefix(15)))
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 24)
                }
            }
        }
    }
}

/// The front door: a navy band with NetLet's pictures on it, one line saying
/// what the shop is, and two ways in — Today's deals only while the home page
/// draws a Deals shelf, New arrivals otherwise, so the first press never lands
/// on a half-empty page (`HomeHero`).
///
/// The pictures are a slideshow, on the owner's word: each stays three
/// seconds, the next fades in over the last, which stays whole underneath so
/// the navy never shows through mid-change. Only the pictures move; the words
/// and the buttons hold still. Nobody who asked for less motion sees it move.
/// The band ends in a fade into the page rather than a line.
struct HomeHero: View {
    let dealsDrawn: Bool
    @State private var current = 0
    @State private var previous: Int?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    /// How long each picture stays before the next fades in (`SLIDE_MS`).
    static let slideSeconds = 3.0
    private let slides = WebAssets.manifest.heroSlides

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !slides.isEmpty {
                pictures
            }
            VStack(alignment: .leading, spacing: 0) {
                (Text(l.t("home.heroTitle") + " ").foregroundStyle(.white) + Text(l.t("home.heroTitleAccent")).foregroundStyle(Brand.orange))
                    .font(.inter(30, .heavy))
                    .tracking(-0.6)
                    .lineSpacing(-2)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(l.t("home.heading") + ": " + l.t("home.heroTitle") + " " + l.t("home.heroTitleAccent"))
                    .accessibilityAddTraits(.isHeader)
                Text(l.t("home.heroNote"))
                    .font(.inter(15))
                    .lineSpacing(3)
                    .foregroundStyle(Color(red: 201 / 255, green: 212 / 255, blue: 226 / 255))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { buttons }
                    VStack(spacing: 12) { buttons }
                }
                .padding(.top, 20)
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 128)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.navy)
        .overlay(alignment: .bottom) {
            Self.foot.frame(height: 144).allowsHitTesting(false)
        }
        .task(id: still) { await run() }
    }

    @ViewBuilder
    private var buttons: some View {
        Button {
            app.push(dealsDrawn ? .deals : .newest)
        } label: {
            HStack(spacing: 8) {
                Text(l.t(dealsDrawn ? "home.heroDeals" : "home.heroNew"))
                Image(systemName: "arrow.forward").font(.system(size: 14, weight: .bold))
            }
            .font(.inter(15, .bold))
            .foregroundStyle(Brand.navy)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 48)
            .background(Capsule().fill(Brand.orange))
            .contentShape(Capsule())
        }
        .buttonStyle(PressFillStyle(cornerRadius: 24))
        Button {
            app.push(.department(slug: nil))
        } label: {
            Text(l.t("nav.allDepartments"))
                .font(.inter(15, .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 20)
                .frame(maxWidth: .infinity, minHeight: 48)
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.4), lineWidth: 1.5))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var pictures: some View {
        ZStack {
            if let previous { slide(previous).zIndex(1) }
            slide(current)
                .id(current)
                .transition(.opacity)
                .zIndex(2)
            // Into the navy under the pictures, where the words begin.
            Self.shade.zIndex(3)
        }
        .frame(height: 220)
        .frame(maxWidth: .infinity)
        .clipped()
        .accessibilityHidden(true)
    }

    private func slide(_ index: Int) -> some View {
        Color.clear
            .overlay {
                BundledImage(image: WebAssets.image(slides[index % slides.count]), contentMode: .fill)
            }
            .clipped()
    }

    /// Changes the picture every three seconds while the band is on screen.
    private func run() async {
        guard slides.count > 1, !still else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(Self.slideSeconds))
            guard !Task.isCancelled else { return }
            let next = (current + 1) % slides.count
            // Decoded before it is shown, so its fade has a picture to fade.
            _ = WebAssets.image(slides[next])
            previous = current
            withAnimation(.easeInOut(duration: 1)) { current = next }
        }
    }

    /// `.hero-shade`: the navy rising into the pictures from their foot, eased.
    static let shade = LinearGradient(
        stops: easedStops(color: Brand.navy, reach: 0.45, fromBottom: true),
        startPoint: .bottom,
        endPoint: .top
    )

    /// `.hero-foot`: the band into the page's own ground, eased.
    static let foot = LinearGradient(
        stops: easedStops(color: Brand.ground, reach: 1, fromBottom: true),
        startPoint: .bottom,
        endPoint: .top
    )

    /// A smoothstep fade as a stop every tenth: a straight gradient starts at
    /// a visible line and spends its middle in one flat grey.
    nonisolated static func easedStops(color: Color, reach: Double, fromBottom: Bool) -> [Gradient.Stop] {
        (0...10).map { step in
            let t = Double(step) / 10
            let eased = 1 - (t * t * (3 - 2 * t))
            return Gradient.Stop(color: color.opacity(eased), location: t * reach)
        }
    }
}

/// Deals, as a navy band across the page: the deepest saving leads, the whole
/// row wide, and two more sit under it — never three with one left alone.
struct DealsBand: View {
    let products: [Product]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ShelfHeading(title: l.t("rail.deals.title"), onDark: true) { app.push(.deals) }
            if let lead = products.first {
                ProductCard(product: lead, feature: true)
            }
            let rest = Array(products.dropFirst().prefix(2))
            if !rest.isEmpty {
                ProductGrid(products: rest)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 32)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.navy)
        .padding(.top, 24)
    }
}
