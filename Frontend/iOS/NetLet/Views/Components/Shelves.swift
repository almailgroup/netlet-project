import SwiftUI

/// A shelf's title and its way to everything else: the heading, and "View all"
/// in the orange's darker ink (`ShelfHeading`).
struct ShelfHeading: View {
    let title: String
    var onDark = false
    var viewAllKey = "home.viewAll"
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
                        Image(systemName: "chevron.forward")
                            .font(.system(size: 12, weight: .bold))
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
        .padding(.vertical, 24)
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

/// The departments as white tiles with their art — the home page's row and
/// the categories page's grid alike. All six, always: they are the shop's
/// shape.
///
/// **On the home page they are one row that scrolls sideways, on the owner's
/// word** (`row`, the web's `DepartmentCards`): three to a row made two rows
/// that were the whole first screen under the front door. The row reaches the
/// screen's edges, so the tile cut off there says there is more.
struct DepartmentCardGrid: View {
    /// Two to a row on the categories page; the home page draws a row instead.
    var columns = 3
    /// The categories page says what each holds under its name.
    var counted = false
    /// One sideways row of tiles, the home page's.
    var row = false
    /// The Categories tab's: a department opens onto its subcategories in
    /// place, under its row, on the owner's word — the web's `/categories`.
    var expandable = false
    @State private var open: String?
    @State private var subCounts: [String: [String: Int]]?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        if expandable {
            expandingGrid
        } else if row {
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
            tile(slug: department.slug, title: l.t(department.label), count: counted ? countLine(department.slug) : nil, width: width) {
                app.push(.department(slug: department.slug))
            }
        }
        tile(slug: "all", title: l.t("nav.allDepartments"), count: counted ? l.t("browse.browseEverything") : nil, width: width) {
            app.push(.department(slug: nil))
        }
    }

    /// The tiles in rows of `columns`, with the open department's panel under
    /// its own row, so the grid keeps its shape. One open at a time; pressing
    /// it again closes it. "All departments" has none and opens its page.
    private var expandingGrid: some View {
        let departments = ReferenceData.shared.departments
        let slugs = departments.map(\.slug) + ["all"]
        let rows = stride(from: 0, to: slugs.count, by: columns).map { Array(slugs[$0..<min($0 + columns, slugs.count)]) }
        return ScrollViewReader { proxy in VStack(spacing: 12) {
            ForEach(rows, id: \.self) { slugsInRow in
                HStack(alignment: .top, spacing: 12) {
                    ForEach(slugsInRow, id: \.self) { slug in
                        if let department = departments.first(where: { $0.slug == slug }) {
                            tile(slug: slug, title: l.t(department.label), count: countLine(slug), width: nil, expanded: open == slug) {
                                withAnimation(still ? nil : .snappy(duration: 0.28)) { open = open == slug ? nil : slug }
                            }
                            .accessibilityHint(l.t("ios.categories.showsSubcategories"))
                        } else {
                            tile(slug: "all", title: l.t("nav.allDepartments"), count: l.t("browse.browseEverything"), width: nil) {
                                app.push(.department(slug: nil))
                            }
                        }
                    }
                    ForEach(0..<(columns - slugsInRow.count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
                }
                .fixedSize(horizontal: false, vertical: true)
                if let open, let column = slugsInRow.firstIndex(of: open), let department = departments.first(where: { $0.slug == open }) {
                    SubcategoryPanel(department: department, column: column, columns: columns, counts: subCounts?[open], loading: subCounts == nil)
                        .id(Self.panelID(open))
                        .transition(still ? .opacity : .opacity.combined(with: .offset(y: -8)))
                }
            }
        }
        .task {
            if let preset = app.categoriesOpen {
                open = preset
                app.categoriesOpen = nil
            }
            if let counts = try? await app.services.api.call(API.subcategoryCounts) { subCounts = counts }
        }
        .onChange(of: open) { _, now in
            // A department low on the page opens below the screen; its panel
            // is brought up into view, by as little as that takes, the web's
            // rule. A panel already in view does not move the page.
            guard let now else { return }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(still ? 30 : 300))
                guard open == now else { return }
                withAnimation(still ? nil : .easeInOut(duration: 0.3)) { proxy.scrollTo(Self.panelID(now)) }
            }
        }
        }
    }

    private static func panelID(_ slug: String) -> String { "subcategories-\(slug)" }

    private func countLine(_ slug: String) -> String {
        // One line on every tile, so the row keeps its height while the counts arrive.
        guard let counts = app.shelf.counts else { return " " }
        return l.productCount(counts[slug] ?? 0)
    }

    private func tile(slug: String, title: String, count: String?, width: CGFloat?, expanded: Bool? = nil, open: @escaping () -> Void) -> some View {
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
                    HStack(spacing: 4) {
                        Text(count)
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                            .lineLimit(1)
                        // A department that opens says so: its chevron turns as it does.
                        if let expanded {
                            Image(systemName: "chevron.down")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(Brand.navy)
                                .rotationEffect(.degrees(expanded ? 180 : 0))
                                .accessibilityHidden(true)
                        }
                    }
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
                if expanded == true {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.navy, lineWidth: 1.5)
                } else if columns != 3 {
                    RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
        .frame(width: width)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(expanded == true ? .isSelected : [])
    }
}

/// A department's subcategories, under its row on the Categories tab: "See
/// all in …" and a chip for each with how many it holds, each opening the
/// department narrowed to it — the web's panel, the pointer over the card
/// that opened it. All of them, as the cards keep all six: an empty one says
/// so on the page it opens.
private struct SubcategoryPanel: View {
    let department: Department
    let column: Int
    let columns: Int
    let counts: [String: Int]?
    let loading: Bool
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let name = l.t(department.label)
        VStack(spacing: 0) {
            // A column per card, so the pointer follows the row's direction.
            HStack(spacing: 12) {
                ForEach(0..<columns, id: \.self) { index in
                    ZStack {
                        if index == column {
                            PanelPointer()
                                .fill(Color.white)
                                .overlay(PanelPointer(open: true).stroke(Brand.cardLine, lineWidth: 1))
                                .frame(width: 20, height: 10)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .offset(y: 1)
            .zIndex(1)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 8) {
                    Text(name)
                        .font(.inter(16, .heavy))
                        .foregroundStyle(Brand.navy)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    Button {
                        app.push(.department(slug: department.slug))
                    } label: {
                        HStack(spacing: 4) {
                            Text(l.t("categories.seeAllIn", ["name": name])).lineLimit(1).minimumScaleFactor(0.85)
                            Image(systemName: "chevron.forward").font(.system(size: 12, weight: .bold))
                        }
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.accentInk)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                }
                FlowLayout(spacing: 8) {
                    ForEach(department.subs) { entry in
                        chip(entry)
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white)
                    .shadow(color: Brand.navy.opacity(0.08), radius: 9, x: 0, y: 6)
            )
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        }
    }

    private func chip(_ entry: Department.Subcategory) -> some View {
        let count = counts?[entry.slug] ?? 0
        let title = entry.shown(l.current)
        return Button {
            app.push(.subcategory(department: department.slug, sub: entry.slug))
        } label: {
            HStack(spacing: 8) {
                Text(title).lineLimit(1)
                Group {
                    if loading {
                        Capsule().fill(Brand.photo).frame(width: 20, height: 12)
                    } else {
                        Text("\(count)")
                            .font(.inter(12, .bold))
                            .foregroundStyle(Brand.body)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Brand.photo))
                    }
                }
                .accessibilityHidden(true)
            }
            .font(.inter(14, .semibold))
            .foregroundStyle(count > 0 || loading ? Brand.navy : Brand.muted)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().strokeBorder(Brand.line, style: StrokeStyle(lineWidth: 1, dash: count > 0 || loading ? [] : [4, 3])))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .accessibilityLabel(loading ? title : "\(title), \(l.productCount(count))")
    }
}

/// The panel's pointer: a small triangle, its base left open when stroked so
/// it meets the card's edge without a line.
private struct PanelPointer: Shape {
    var open = false

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        if !open { path.closeSubpath() }
        return path
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
