import SwiftUI

/// The home page, the web's `Home` as a phone draws it: the front door, the
/// departments as a sideways row, the paid banners and placements, Deals as a navy band
/// led by the deepest saving, Bestsellers ranked, Picked for you, the brands,
/// the stores, the new arrivals as a grid, the newest guides, and the footer. Every shelf after the departments is drawn only when it has
/// something true to show (`shelvesFor`, in `HomeShelf`).
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let shelf = app.shelf
        let shelves = shelf.shelves
        ShopPage(root: true, footer: true, refresh: { await shelf.load(language: l.current, force: true) }) {
            HomeHero()
            VStack(alignment: .leading, spacing: 16) {
                Text(l.t("home.shopByCategory")).shelfTitle()
                    .padding(.horizontal, 16)
                DepartmentCardGrid(row: true)
            }
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
                if shelf.showingEarlier {
                    EarlierShelfNote { await shelf.load(language: l.current, force: true) }
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                }
                // Paid banners and placements, approved and labelled; absent when none runs today.
                HomeBanners()
                SponsoredShelf(slot: "home")
                if !shelves.deals.isEmpty {
                    DealsBand(products: shelves.deals)
                }
                if !shelves.bestsellers.isEmpty {
                    ProductRail(title: l.t("rail.bestsellers.title"), products: shelves.bestsellers, ranked: true)
                }
                // What is about this shopper sits between what sold and what is new.
                RecommendedRail(quiet: true)
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
                GuideShelf()
            }
        }
    }
}

/// The front door: a navy band with NetLet's pictures on it and one line
/// saying what the shop is (`HomeHero`). **No buttons, on the owner's word**:
/// "See what's new" and "All departments" offered again what the departments'
/// row directly under the band offers.
///
/// The pictures are a slideshow, on the owner's word: each stays three
/// seconds, the next fades in over the last, which stays whole underneath so
/// the navy never shows through mid-change. Only the pictures move; the words
/// hold still. Nobody who asked for less motion sees it move.
/// The band ends in a fade into the page rather than a line.
struct HomeHero: View {
    @State private var current = 0
    @State private var previous: Int?
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
                    // `max-w-[15ch]`: the line breaks before "one cart." as it does on the web.
                    .frame(maxWidth: 270, alignment: .leading)
                    .accessibilityLabel(l.t("home.heading") + ": " + l.t("home.heroTitle") + " " + l.t("home.heroTitleAccent"))
                    .accessibilityAddTraits(.isHeader)
                Text(l.t("home.heroNote"))
                    .font(.inter(15))
                    .lineSpacing(3)
                    .foregroundStyle(Color(red: 201 / 255, green: 212 / 255, blue: 226 / 255))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
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

/// This morning's shelves are on screen and the server could not be asked
/// again: said in a line, with a way to try again.
private struct EarlierShelfNote: View {
    let retry: () async -> Void
    @Environment(LanguageSettings.self) private var l
    @State private var retrying = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .accessibilityHidden(true)
            Text(l.t("ios.home.earlierShelf"))
                .font(.inter(13))
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                Task {
                    retrying = true
                    await retry()
                    retrying = false
                }
            } label: {
                if retrying { ProgressView().tint(Brand.navy) } else { Text(l.t("home.refreshCatalog")).font(.inter(13, .semibold)) }
            }
            .buttonStyle(.tap)
            .foregroundStyle(Brand.navy)
            .disabled(retrying)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }
}
