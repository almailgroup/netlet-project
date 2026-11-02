import SwiftUI

/// A shelf's title and its way to everything else: the heading, and "View all"
/// in the orange's darker ink (`ShelfHeading`).
struct ShelfHeading: View {
    let title: String
    var onDark = false
    var viewAllKey = "home.viewAll"
    /// The chevron says the press goes somewhere; off for one that does something here (Clear).
    var viewAllChevron = true
    var viewAll: (() -> Void)?
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 16) {
            Text(title)
                .shelfTitle(onDark: onDark)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let viewAll {
                Button(action: viewAll) {
                    HStack(spacing: 2) {
                        Text(l.t(viewAllKey))
                        if viewAllChevron {
                            Image(systemName: "chevron.forward")
                                .font(.system(size: 12, weight: .bold))
                        }
                    }
                    .font(.inter(14, .bold))
                    .foregroundStyle(onDark ? Brand.accentOnDark : Brand.accentInk)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
            }
        }
    }
}

/// One shelf of products, scrolled sideways — 164 wide on a phone, or 200 with
/// each card's place beside it in large outlined figures when the shelf's
/// order is a ranking (Bestsellers).
struct ProductRail: View {
    let title: String
    let products: [Product]
    var ranked = false
    var viewAll: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ShelfHeading(title: title, viewAll: viewAll)
                .padding(.horizontal, 16)
            ProductStrip(products: products, ranked: ranked)
        }
        .padding(.vertical, 24)
    }
}

/// The cards of a shelf, scrolled sideways: a strip's twelve at most.
struct ProductStrip: View {
    let products: [Product]
    var ranked = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .bottom, spacing: 12) {
                ForEach(Array(products.prefix(HomeShelf.most).enumerated()), id: \.element.id) { index, product in
                    if ranked {
                        HStack(alignment: .bottom, spacing: -8) {
                            RankFigure(place: index + 1)
                            ProductCard(product: product)
                        }
                        .frame(width: 200)
                    } else {
                        ProductCard(product: product)
                            .frame(width: 164)
                    }
                }
            }
            .padding(.horizontal, 16)
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
    }
}

/// A shelf with a row of department tabs over it — the web's `TabbedShelf`,
/// Noon's bestsellers, on the owner's word ("category tabs at the top …
/// allowing customers to switch between categories without leaving the
/// section. Apply the same concept to other relevant sections").
///
/// **A tab narrows the shelf and is not a tab**: the row is the department
/// page's subcategory chips, the chosen one navy and `.isSelected` to
/// VoiceOver, and it is drawn only where it could change something
/// (`HomeShelf.departmentTabs`). "All" leads and is the shelf as decided; the
/// choice is the shelf's own while the page is open. A ranked shelf
/// renumbers inside the tab, so the places read "first among the
/// electronics". The strip holds a strip's twelve; the grid, the web's fifteen.
struct TabbedShelf: View {
    let title: String
    let products: [Product]
    var grid = false
    var ranked = false
    /// Off for a shelf that is the shopper's own rather than the shop's.
    var tabs = true
    var viewAllKey = "home.viewAll"
    var viewAllChevron = true
    /// A line under the heading saying what the shelf is.
    var note: String? = nil
    /// On a panel of the brand's pale orange, for a season's shelf.
    var tinted = false
    var viewAll: (() -> Void)?
    @State private var chosen: String?
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    /// The web's `#fff3ec`, the pale orange a season's shelf sits on.
    static let paleOrange = Color(red: 1, green: 243 / 255, blue: 236 / 255)

    var body: some View {
        if tinted {
            content
                .padding(.vertical, 20)
                .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Self.paleOrange))
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
        } else {
            content.padding(.vertical, 24)
        }
    }

    private var content: some View {
        let rows = tabs ? HomeShelf.departmentTabs(products) : []
        // A department that left the shelf leaves the row; the shelf is "All" again.
        let current = rows.first { $0.slug == chosen }
        let shown = current?.products ?? products
        return VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                ShelfHeading(title: title, viewAllKey: viewAllKey, viewAllChevron: viewAllChevron, viewAll: viewAll)
                if let note {
                    Text(note)
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 16)
            if !rows.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        chip(title: l.t("categories.allSub"), count: products.count, slug: nil, chosen: current?.slug)
                        ForEach(rows) { row in
                            chip(title: l.t(row.label), count: row.products.count, slug: row.slug, chosen: current?.slug)
                        }
                    }
                    .padding(.horizontal, 16)
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(l.t("home.shelfTabs", ["title": title]))
            }
            if grid {
                ProductGrid(products: Array(shown.prefix(15)))
                    .padding(.horizontal, 16)
            } else {
                ProductStrip(products: shown, ranked: ranked)
            }
        }
    }

    /// The department page's subcategory chip, in the same clothes.
    private func chip(title: String, count: Int, slug: String?, chosen: String?) -> some View {
        let pressed = chosen == slug
        return Button {
            withAnimation(still ? nil : .snappy(duration: 0.2)) { self.chosen = slug }
        } label: {
            HStack(spacing: 6) {
                Text(title).lineLimit(1)
                Text("\(count)").foregroundStyle(pressed ? Color.white.opacity(0.8) : Brand.muted)
            }
            .font(.inter(14, .semibold))
            .foregroundStyle(pressed ? Color.white : Brand.navy)
            .padding(.horizontal, 16)
            .frame(minHeight: 40)
            .background(Capsule().fill(pressed ? Brand.navy : Color.white))
            .overlay(Capsule().strokeBorder(pressed ? Brand.navy : Brand.line, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(pressed ? .isSelected : [])
    }
}

/// A place on the Bestsellers shelf as a large figure with a pale navy outline
/// and nothing inside (`.rank-figure`): order, not a second price. Drawn, not
/// said — the shelf's own order is the ranking for VoiceOver.
struct RankFigure: View {
    let place: Int

    var body: some View {
        let digits = String(place)
        let size: CGFloat = digits.count > 1 ? 58 : 84
        let outline = Color(red: 159 / 255, green: 177 / 255, blue: 204 / 255)
        ZStack {
            // A stroke drawn as the figure nudged a hair each way, under the
            // figure in the page's own colour.
            ForEach(Array(Self.nudges.enumerated()), id: \.offset) { _, nudge in
                figure(digits, size: size).foregroundStyle(outline).offset(x: nudge.width, y: nudge.height)
            }
            figure(digits, size: size).foregroundStyle(Brand.ground)
        }
        .frame(width: 58, height: size * 0.82, alignment: .bottom)
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityHidden(true)
    }

    private func figure(_ digits: String, size: CGFloat) -> some View {
        Text(digits)
            .font(.inter(size, .bold))
            .tracking(digits.count > 1 ? -size * 0.1 : 0)
            .monospacedDigit()
            .fixedSize()
    }

    private static let nudges: [CGSize] = [
        CGSize(width: -1, height: 0), CGSize(width: 1, height: 0), CGSize(width: 0, height: -1), CGSize(width: 0, height: 1),
        CGSize(width: -0.7, height: -0.7), CGSize(width: 0.7, height: -0.7), CGSize(width: -0.7, height: 0.7), CGSize(width: 0.7, height: 0.7),
    ]
}

/// The departments as white tiles with their art — the home page's row. All
/// six, always: they are the shop's shape. (The Categories tab draws its own
/// tiles over the subcategories, `DepartmentBrowser`.)
///
/// **On the home page they are one row that scrolls sideways, on the owner's
/// word** (`row`, the web's `DepartmentCards`): three to a row made two rows
/// that were the whole first screen under the front door. The row reaches the
/// screen's edges, so the tile cut off there says there is more.
struct DepartmentCardGrid: View {
    /// Three to a row when drawn as a grid; the home page draws a row instead.
    var columns = 3
    /// One sideways row of tiles, the home page's.
    var row = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if row {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 10) {
                    tiles(width: 112)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
        } else {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: columns == 3 ? 10 : 12), count: columns), spacing: columns == 3 ? 10 : 12) {
                tiles(width: nil)
            }
        }
    }

    /// Each tile, at a fixed width in the row and the column's in the grid.
    @ViewBuilder
    private func tiles(width: CGFloat?) -> some View {
        ForEach(ReferenceData.shared.departments) { department in
            tile(slug: department.slug, title: l.t(department.label), count: nil, width: width) {
                app.push(.department(slug: department.slug))
            }
        }
        tile(slug: "all", title: l.t("nav.allDepartments"), count: nil, width: width) {
            app.push(.department(slug: nil))
        }
    }

    private func tile(slug: String, title: String, count: String?, width: CGFloat?, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            VStack(spacing: 0) {
                BundledImage(image: WebAssets.department(slug))
                    .aspectRatio(4.0 / 3.0, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                Text(title)
                    .font(.inter(columns == 3 ? 13 : 15, .bold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.center)
                    // In the row every tile keeps two lines' room, so the row is one height.
                    .lineLimit(2, reservesSpace: width != nil)
                    .padding(.top, 6)
                if let count {
                    Text(count)
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .lineLimit(1)
                        .padding(.top, 4)
                }
            }
            .padding(.horizontal, columns == 3 ? 8 : 12)
            .padding(.top, columns == 3 ? 8 : 12)
            .padding(.bottom, columns == 3 ? 12 : 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            // The shadow from the card's shape, not from all it holds (see
            // `PhotoCartControl`).
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white)
                    .shadow(color: Brand.navy.opacity(0.06), radius: 1, x: 0, y: 1)
            )
            .overlay {
                if columns != 3 {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
        .frame(width: width)
        .accessibilityElement(children: .combine)
    }
}

/// A store as the home page's row and `/stores` draw it: its mark, its name,
/// a measured rating and how many products, and the badges it earned.
struct StoreCardView: View {
    let store: StoreCard
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button {
            app.push(.store(slug: store.slug))
        } label: {
            HStack(spacing: 12) {
                StoreMark(name: store.name, logoUrl: store.logoUrl)
                VStack(alignment: .leading, spacing: 2) {
                    Text(store.name)
                        .font(.inter(15, .bold))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        if let rating = store.rating {
                            StoreRating(rating: rating)
                            Text("·").accessibilityHidden(true)
                        }
                        Text(l.t(store.products == 1 ? "home.brandCountOne" : "home.brandCountMany", ["count": "\(store.products)"]))
                    }
                    .font(.inter(12.5))
                    .foregroundStyle(Brand.muted)
                    StoreBadges(badges: store.badges)
                        .padding(.top, 4)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}

/// A store's logo, or its initial on the portal's pale navy.
struct StoreMark: View {
    let name: String
    let logoUrl: String?
    var large = false

    var body: some View {
        let side: CGFloat = large ? 64 : 48
        let radius: CGFloat = large ? 16 : 12
        ZStack {
            if let logoUrl, !logoUrl.isEmpty {
                Color.white
                RemoteImage(reference: logoUrl, contentMode: .fit).padding(4)
            } else {
                Color(red: 231 / 255, green: 237 / 255, blue: 245 / 255)
                Text(name.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "·")
                    .font(.inter(large ? 24 : 18, .bold))
                    .foregroundStyle(Brand.navy)
            }
        }
        .frame(width: side, height: side)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color(red: 225 / 255, green: 231 / 255, blue: 239 / 255), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

/// A store's rating: a star, the figure and how many reviews it is over.
struct StoreRating: View {
    let rating: StoreCard.Rating
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "star.fill")
                .font(.system(size: 11))
                .foregroundStyle(Brand.star)
            Text(rating.average.formatted(.number.precision(.fractionLength(0...1))))
                .font(.inter(12.5, .semibold))
                .foregroundStyle(Brand.ink)
            Text("(\(rating.count))")
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(l.t("product.ratingAriaCount", ["value": "\(rating.average)", "max": "5", "count": "\(rating.count)"]))
    }
}

/// The badges a store has earned, as small green chips.
struct StoreBadges: View {
    let badges: [String]
    @Environment(LanguageSettings.self) private var l

    static let labels = ["verified": "badge.verified", "highRating": "badge.highRating", "fastShipping": "badge.fastShipping"]

    var body: some View {
        let known = badges.compactMap { Self.labels[$0] }
        if !known.isEmpty {
            FlowLayout(spacing: 4) {
                ForEach(known, id: \.self) { key in
                    Text(l.t(key))
                        .font(.inter(12, .bold))
                        .foregroundStyle(Brand.success)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Brand.successFill))
                }
            }
        }
    }
}

/// One brand, opening everything of it — the `Brands` page's tile, the web's
/// `BrandTile`: the initial in the shop's colours (NetLet holds no logos), the
/// name and how many of its products are on sale.
struct BrandTile: View {
    let brand: BrandCount
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button {
            app.push(.brand(name: brand.name))
        } label: {
            HStack(spacing: 12) {
                Text(brand.name.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "·")
                    .font(.inter(18, .heavy))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 44, height: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(brand.name)
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(1)
                    Text(l.t(brand.count == 1 ? "home.brandCountOne" : "home.brandCountMany", ["count": "\(brand.count)"]))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}

/// Words as chips that wrap onto as many lines as they need.
struct FlowChips: View {
    let items: [String]
    let choose: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Button {
                    choose(item)
                } label: {
                    Text(item)
                        .font(.inter(14, .medium))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(1)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 40)
                        .background(Capsule().fill(Color.white.opacity(0.9)))
                        .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
                }
                .buttonStyle(.tap)
            }
        }
    }
}

/// Lays its children out in rows, wrapping at the edge, in the layout's direction.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + rowHeight)
    }

    /// The bounds are the width `sizeThatFits` reported — exactly its widest
    /// row — so a row is let run a point past them rather than broken again:
    /// added up a second time, an Arabic price's fractional widths came out a
    /// hair over, the was-price went to a line the height had not counted, and
    /// it was drawn struck through over "in stock" under it.
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX + 1 {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// The grid's outline while a department, a search or Saved loads: two
/// columns of cards shaped like `ProductCard` — the photo breathing as a photo
/// on its way does, the store, the name, the price and Buy now — so the page
/// keeps its shape and nothing moves when the products land. It was a spinner
/// in an empty page, which the web's `PageFallback` stopped being long ago.
struct GridSkeleton: View {
    var cards = 4
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(0..<cards, id: \.self) { _ in card }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(l.t("nav.loadingPage"))
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            LoadingTint(still: still)
                .aspectRatio(4.0 / 5.0, contentMode: .fit)
                .fixedSize(horizontal: false, vertical: true)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 15, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: 15, style: .continuous))
            VStack(alignment: .leading, spacing: 8) {
                bar(width: 72, height: 10)
                bar(height: 13)
                bar(width: 96, height: 13)
                bar(width: 64, height: 16).padding(.top, 4)
                Capsule().fill(Brand.tint).frame(height: 44).padding(.top, 8)
            }
            .padding(10)
        }
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    private func bar(width: CGFloat? = nil, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Brand.tint)
            .frame(width: width, height: height)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A card-shaped outline while a shelf's products load, so the page does not jump.
struct ShelfSkeleton: View {
    var body: some View {
        HStack(spacing: 12) {
            ForEach(0..<3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint).aspectRatio(4.0 / 5.0, contentMode: .fit)
                    RoundedRectangle(cornerRadius: 4).fill(Brand.tint).frame(height: 14).padding(.trailing, 40)
                    RoundedRectangle(cornerRadius: 4).fill(Brand.tint).frame(width: 60, height: 12)
                }
                .padding(12)
                .frame(width: 164)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            }
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipped()
        .accessibilityHidden(true)
    }
}
