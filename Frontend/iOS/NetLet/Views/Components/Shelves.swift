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

/// The cards of a shelf, scrolled sideways: a strip's twelve at most. **Every
/// section of the home page is one of these, on the owner's word** ("for all
/// the sections in the homepage … let it be horizontally; the user can scroll
/// between the products"): the page scrolls down through its sections and
/// each section scrolls across through its products, from the page's start.
struct ProductStrip: View {
    let products: [Product]
    var ranked = false
    /// A card's line in the store's place, where a shelf has one to say.
    var note: ((Product) -> String?)? = nil
    @Environment(AppModel.self) private var app

    var body: some View {
        let shown = products.prefix(HomeShelf.most).map(\.id)
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
                        ProductCard(product: product, note: note?(product))
                            .frame(width: 164)
                    }
                }
            }
            .padding(.horizontal, 16)
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        // A card grows by its Buy now when its product goes in the bag, so
        // the bag is part of what decides the row's height.
        .heldHeight(for: shown + ["\(app.cart.cart?.items.count ?? 0)"])
    }
}

/// **A lazy row keeps the height it has measured**, for as long as what it
/// holds is the same. A `LazyHStack` in a sideways scroll is as tall as the
/// cards it has made, and it lets them go once the row is off the screen —
/// so its height fell to nothing and came back as the page moved, and the
/// page's own height went with it. The scroll trace of the home page's
/// stand-still shows exactly that (#136): the content's height flipping
/// between 2,587 and about 4,390 points every frame or two — the home page's
/// lazy rows together are about 1,800 — until the page stood still and was
/// put back at its top. Held, a row's height can only grow while its
/// contents are the same, so nothing a lazy row forgets can move the page.
/// A change of `key` — other products, a product in or out of the bag — lets
/// it settle again.
struct HeldHeight<Key: Equatable>: ViewModifier {
    let key: Key
    @State private var held: CGFloat = 0
    /// The last height measured, kept where writing it draws nothing again.
    @State private var last = HeldHeightBox()

    func body(content: Content) -> some View {
        content
            .background {
                GeometryReader { proxy in
                    Color.clear
                        .onChange(of: proxy.size.height.rounded(), initial: true) { _, height in
                            last.height = height
                            if height > held { held = height }
                        }
                }
            }
            .frame(minHeight: held, alignment: .top)
            .onChange(of: key) { _, _ in
                // It may be shorter now: let go, and take what it settles at.
                held = 0
                Task { @MainActor in
                    if last.height > held { held = last.height }
                }
            }
    }
}

/// `HeldHeight`'s last measurement: a box, so a new one is not a new state.
final class HeldHeightBox {
    var height: CGFloat = 0
}

extension View {
    /// Keeps a lazy row from getting shorter while `key` is the same.
    func heldHeight<Key: Equatable>(for key: Key) -> some View {
        modifier(HeldHeight(key: key))
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
/// electronics". Every shelf is a strip of twelve, scrolled sideways.
struct TabbedShelf: View {
    let title: String
    let products: [Product]
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
                    // Chips of Liquid Glass, drawn as one pass per row.
                    GlassGroup {
                        HStack(spacing: 8) {
                            chip(title: l.t("categories.allSub"), count: products.count, slug: nil, chosen: current?.slug)
                            ForEach(rows) { row in
                                chip(title: l.t(row.label), count: row.products.count, slug: row.slug, chosen: current?.slug)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 2)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(l.t("home.shelfTabs", ["title": title]))
            }
            ProductStrip(products: shown, ranked: ranked)
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
            .glassChip(chosen: pressed)
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
                // Six tiles: made at once, so the row's height is never a
                // lazy stack's guess (see `HeldHeight`).
                HStack(alignment: .top, spacing: 10) {
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

/// A rounded square as wide as its column: the face of a tile on the
/// Categories page (a subcategory), the stores' page and the brands' — on the
/// owner's word ("for the subcategories, instead of being as a list, make it
/// rounded squares; the same for shop by stores"). It is the department
/// tiles' own shape and corner, so the pages read as one set. The shadow is
/// the shape's, never what it holds (see `PhotoCartControl`).
struct SquareFace<Content: View>: View {
    let fill: Color
    let content: Content

    init(fill: Color = .white, @ViewBuilder content: () -> Content) {
        self.fill = fill
        self.content = content()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { content }
            .clipShape(shape)
            .background(shape.fill(fill).shadow(color: Brand.navy.opacity(0.05), radius: 2, x: 0, y: 1))
            .overlay(shape.strokeBorder(Brand.cardLine, lineWidth: 1.5))
    }
}

/// The pale blue-grey a tile with no picture of its own is drawn on.
extension Brand {
    static let tileField = Color(red: 238 / 255, green: 241 / 255, blue: 246 / 255)
}

/// A store on the stores' page: a rounded square with its logo — or its
/// initial on the pale field — and under it its name, how many products it
/// has on sale and its measured rating. A store NetLet verified carries the
/// seal on its square; what else it earned is on its own page. It was a row a
/// store (`StoreCardView`), and the owner asked for squares.
struct StoreTile: View {
    let store: StoreCard
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let logo: String? = store.logoUrl.flatMap { $0.isEmpty ? nil : $0 }
        let verified = store.badges.contains("verified")
        let count = l.t(store.products == 1 ? "home.brandCountOne" : "home.brandCountMany", ["count": "\(store.products)"])
        Button {
            app.push(.store(slug: store.slug))
        } label: {
            VStack(spacing: 8) {
                SquareFace(fill: logo == nil ? Brand.tileField : .white) {
                    if let logo {
                        RemoteImage(reference: logo, contentMode: .fit).padding(12)
                    } else {
                        Text(store.name.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "·")
                            .font(.inter(34, .heavy))
                            .foregroundStyle(Brand.navy)
                    }
                }
                .overlay(alignment: .topTrailing) {
                    if verified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 17))
                            .foregroundStyle(Brand.success)
                            .background(Circle().fill(Color.white).padding(3))
                            .padding(7)
                    }
                }
                Text(store.name)
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
                    .minimumScaleFactor(0.85)
                VStack(spacing: 2) {
                    Text(count)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    if let rating = store.rating { StoreRating(rating: rating) }
                }
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 20))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(spoken(count: count, verified: verified))
        .accessibilityAddTraits(.isButton)
    }

    /// What the tile says in one breath: the name, what it sells, how it is rated, the seal.
    private func spoken(count: String, verified: Bool) -> String {
        var parts = [store.name, count]
        if let rating = store.rating {
            parts.append(l.t("product.ratingAriaCount", ["value": "\(rating.average)", "max": "5", "count": "\(rating.count)"]))
        }
        if verified { parts.append(l.t("badge.verified")) }
        return parts.joined(separator: ", ")
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

/// One brand, opening everything of it — the Brands page's tile: a rounded
/// square with the initial in the shop's colours (NetLet holds no logos), the
/// name and how many of its products are on sale under it. A square like the
/// stores' beside it, on the owner's word; it was a row a brand.
struct BrandTile: View {
    let brand: BrandCount
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button {
            app.push(.brand(name: brand.name))
        } label: {
            VStack(spacing: 8) {
                SquareFace(fill: Brand.tileField) {
                    Text(brand.name.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "·")
                        .font(.inter(34, .heavy))
                        .foregroundStyle(Brand.navy)
                }
                .accessibilityHidden(true)
                Text(brand.name)
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
                    .minimumScaleFactor(0.85)
                Text(l.t(brand.count == 1 ? "home.brandCountOne" : "home.brandCountMany", ["count": "\(brand.count)"]))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 20))
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

/// Rows of tiles, each as tall as the tallest of them all — a `Grid` sizes
/// each row on its own, so a title that wrapped made one row taller than the
/// other. Two to a row unless told otherwise; with `widest`, a wide screen
/// gets more to a row rather than tiles wider than that. Placed from the
/// leading edge; SwiftUI mirrors a custom layout on a right-to-left page, as
/// it does `FlowLayout`. The account's four tiles, the help centre's issues,
/// and — three to a row — a department's subcategories, the stores and the
/// brands; a tile fills the height it is given (`maxHeight: .infinity`), or
/// it sits in the middle of its slot. It lays every tile out, which is what
/// keeps a lazy grid out of a page's lazy stack.
struct TileGrid: Layout {
    var spacing: CGFloat = 12
    /// How many tiles share a row.
    var columns = 2
    /// On a wide screen, more to a row rather than tiles wider than this.
    var widest: CGFloat? = nil
    /// The room between rows, where it is not the room between tiles.
    var rowSpacing: CGFloat? = nil

    /// How many tiles share a row at this width: the count asked for, or as
    /// many more as keep each no wider than `widest`. A width that is not a
    /// number of points (a row asked for its ideal size) keeps the plain count.
    nonisolated static func perRow(width: CGFloat, spacing: CGFloat, columns: Int, widest: CGFloat?) -> Int {
        guard let widest, widest > 0, width.isFinite else { return max(columns, 1) }
        return max(columns, Int(((width + spacing) / (widest + spacing)).rounded(.up)), 1)
    }

    private func perRow(in width: CGFloat) -> Int {
        Self.perRow(width: width, spacing: spacing, columns: columns, widest: widest)
    }

    private func columnWidth(in width: CGFloat, perRow: Int) -> CGFloat {
        max((width - spacing * CGFloat(perRow - 1)) / CGFloat(perRow), 0)
    }

    private func tileHeight(_ subviews: Subviews, column: CGFloat) -> CGFloat {
        subviews.map { $0.sizeThatFits(ProposedViewSize(width: column, height: nil)).height }.max() ?? 0
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 360
        let across = perRow(in: width)
        let column = columnWidth(in: width, perRow: across)
        let rows = (subviews.count + across - 1) / across
        let height = tileHeight(subviews, column: column)
        return CGSize(width: width, height: CGFloat(rows) * height + CGFloat(max(rows - 1, 0)) * (rowSpacing ?? spacing))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let across = perRow(in: bounds.width)
        let column = columnWidth(in: bounds.width, perRow: across)
        let height = tileHeight(subviews, column: column)
        for (index, subview) in subviews.enumerated() {
            let x = bounds.minX + CGFloat(index % across) * (column + spacing)
            let y = bounds.minY + CGFloat(index / across) * (height + (rowSpacing ?? spacing))
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: column, height: height))
        }
    }
}
