import SwiftUI

/// The Categories tab's departments — the web's `/categories`.
///
/// **The departments open and close in place, on the owner's word** ("make
/// the category bigger … it can collapse and expand … very user friendly for
/// searching products by categories … get reference from Amazon, noon"): a
/// grid of large picture tiles, two to a row on a phone and three on a wide
/// screen, each a button that unfolds its department in a panel the width of
/// the page directly under its row — a navy caret under the tile pointing at
/// it — and folds it again when pressed a second time or closed. One is open
/// at a time. The panel holds what the department offers, in the order the
/// owner asked: **the stores that sell in it first, right under the tiles**
/// (`commerce.storesSelling`, a sideways row, the one selling the most first,
/// then "See all stores"); the ways in a shop like Amazon or noon offers —
/// everything in it, its deals, its newest, its highest rated, each only where
/// it leads somewhere (`CategoryGuide`, over the department's own shelf, the
/// web's `departmentFacts`); its subcategories, **at the size they were**:
/// rounded squares, three to a row on a phone; and its top brands, when a
/// product carries one. **A subcategory pressed shows the stores that sell
/// it**, unfolding under its row with a way to its products and its deals,
/// and folds again on a second press. The squares hold their picture — its
/// own, carried in the app (`WebAssets.subcategory`), or the one kept from
/// the portal in its place; its symbol on the pale field only where there is
/// neither — with its name and how many it holds under it
/// (`commerce.subcategoryCounts`). "All departments" is the last tile and
/// opens its page. Reduce Motion opens and closes without the spring.
struct DepartmentBrowser: View {
    /// The department open, by its slug, and the subcategory open within it.
    @State private var opened: String?
    @State private var openSub: String?
    @State private var subCounts: [String: [String: Int]]?
    /// The pictures an administrator kept (`subcategoryPictures.list`), by
    /// `department/slug`; a square with none draws its own picture.
    @State private var pictures: [String: String] = [:]
    /// The stores that sell in a department (`slug`) or a subcategory
    /// (`slug/sub`), as they are asked for.
    @State private var storesIn: [String: [StoreCard]] = [:]
    /// What each opened department offers, read off its own shelf.
    @State private var guides: [String: CategoryGuide] = [:]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still
    @Environment(\.horizontalSizeClass) private var sizeClass

    /// The last tile, which opens every department's page rather than a panel.
    private static let all = "all"
    /// The last square of a department, which opens the whole department.
    private static let viewAll = "view-all"
    /// How many of a department's stores its row shows; "See all stores" has the rest.
    private static let storesShown = 6

    /// Two big tiles to a row on a phone, three on a wide screen.
    private var columns: Int { sizeClass == .regular ? 3 : 2 }
    /// The subcategories at the size they were: three to a row on a phone.
    private var subColumns: Int { sizeClass == .regular ? 6 : 3 }

    private var opening: Animation? { still ? nil : .spring(response: 0.42, dampingFraction: 0.86) }

    var body: some View {
        let departments = ReferenceData.shared.departments
        let rows = Self.rows(departments.map(\.slug) + [Self.all], columns)
        VStack(alignment: .leading, spacing: 14) {
            ForEach(rows, id: \.self) { row in
                TileGrid(spacing: 14, columns: columns) {
                    ForEach(row, id: \.self) { slug in
                        if let department = departments.first(where: { $0.slug == slug }) {
                            tile(department)
                        } else {
                            allTile
                        }
                    }
                }
                if let opened, row.contains(opened), let department = departments.first(where: { $0.slug == opened }) {
                    panel(department)
                        .padding(.top, 4)
                        .transition(still ? .opacity : .asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.97, anchor: .top)), removal: .opacity))
                }
            }
        }
        .task {
            let api = app.services.api
            let counted = Task { try? await api.call(API.subcategoryCounts) }
            let kept = Task { try? await api.call(API.subcategoryPictures) }
            if let counts = await counted.value { subCounts = counts }
            if let found = await kept.value { pictures = found }
        }
        .onAppear(perform: applyPreset)
        .onChange(of: app.categoriesOpen) { applyPreset() }
    }

    /// A department — or `department/sub` — opened from elsewhere: a search
    /// result on this page, or the screenshots' `categories:<slug>`.
    private func applyPreset() {
        guard let preset = app.categoriesOpen else { return }
        app.categoriesOpen = nil
        let parts = preset.split(separator: "/").map(String.init)
        opened = parts.first
        openSub = parts.count > 1 ? parts[1] : nil
    }

    /// The slugs in rows of `count`, the last row as long as what is left.
    private static func rows(_ slugs: [String], _ count: Int) -> [[String]] {
        stride(from: 0, to: slugs.count, by: max(count, 1)).map { Array(slugs[$0..<min($0 + count, slugs.count)]) }
    }

    private func toggle(_ slug: String) {
        withAnimation(opening) {
            opened = opened == slug ? nil : slug
            openSub = nil
        }
    }

    private func toggleSub(_ slug: String) {
        withAnimation(opening) {
            openSub = openSub == slug ? nil : slug
        }
    }

    private func countLine(_ slug: String) -> some View {
        Group {
            if let counts = app.shelf.counts {
                Text(l.productCount(counts[slug] ?? 0))
            } else {
                Capsule().fill(Brand.photo).frame(width: 56, height: 12)
            }
        }
        .font(.inter(12.5))
        .foregroundStyle(Brand.muted)
        .lineLimit(1)
    }

    // MARK: The tiles

    /// One department as a large picture tile that opens and closes its panel.
    private func tile(_ department: Department) -> some View {
        let open = opened == department.slug
        return Button {
            toggle(department.slug)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                BundledImage(image: WebAssets.department(department.slug))
                    .frame(maxWidth: .infinity)
                    .frame(height: 118)
                HStack(alignment: .center, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.t(department.label))
                            .font(.inter(15.5, .heavy))
                            .foregroundStyle(Brand.navy)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                        countLine(department.slug)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(open ? Color.white : Brand.navy)
                        .rotationEffect(.degrees(open ? 180 : 0))
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(open ? Brand.navy : Brand.tileField))
                        .accessibilityHidden(true)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(Color.white)
                    .shadow(color: Brand.navy.opacity(open ? 0.16 : 0.04), radius: open ? 10 : 2, x: 0, y: open ? 6 : 1)
            )
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(open ? Brand.navy : Brand.cardLine, lineWidth: 2))
            // A caret under the open tile, pointing at the panel it opened.
            .overlay(alignment: .bottom) {
                if open {
                    Image(systemName: "arrowtriangle.down.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(Brand.navy)
                        .offset(y: 13)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 24))
        .accessibilityElement(children: .combine)
        .accessibilityHint(l.t("categories.opensDepartment"))
        .accessibilityAddTraits(open ? .isSelected : [])
    }

    /// "All departments": every department's page, so a link rather than a panel.
    private var allTile: some View {
        Button {
            app.push(.department(slug: nil))
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                BundledImage(image: WebAssets.department(Self.all))
                    .frame(maxWidth: .infinity)
                    .frame(height: 118)
                HStack(spacing: 8) {
                    Text(l.t("nav.allDepartments"))
                        .font(.inter(15.5, .heavy))
                        .foregroundStyle(Brand.navy)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(Brand.tileField))
                        .accessibilityHidden(true)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Color.white).shadow(color: Brand.navy.opacity(0.04), radius: 2, x: 0, y: 1))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 2))
            .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 24))
        .accessibilityElement(children: .combine)
    }

    // MARK: A department's panel

    /// What one department holds, under its row: its stores, the ways into
    /// it, its subcategories and its brands.
    private func panel(_ department: Department) -> some View {
        let name = l.t(department.label)
        let guide = guides[department.slug]
        return VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.inter(21, .heavy))
                        .foregroundStyle(Brand.navy)
                        .accessibilityAddTraits(.isHeader)
                    countLine(department.slug)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    toggle(department.slug)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 44, height: 44)
                        .liquidGlass(.clear, in: Circle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("common.close"))
            }
            Button {
                app.push(.department(slug: department.slug))
            } label: {
                HStack(spacing: 6) {
                    Text(l.t("categories.seeAllIn", ["name": name]))
                    Image(systemName: "chevron.forward").font(.system(size: 13, weight: .bold))
                }
                .font(.inter(15, .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .liquidGlass(.navy)
            }
            .buttonStyle(.tap)

            // The stores that sell here, right under the department, on the owner's word.
            storesRow(key: department.slug, title: l.t("categories.storesIn", ["name": name]), emptyNote: false)

            ways(department, guide: guide)

            Text(l.t("categories.subcategories"))
                .font(.inter(16, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            subcategories(department)

            if let brands = guide?.brands, !brands.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text(l.t("categories.topBrands", ["name": name]))
                        .font(.inter(16, .heavy))
                        .foregroundStyle(Brand.navy)
                        .accessibilityAddTraits(.isHeader)
                    FlowLayout(spacing: 8) {
                        ForEach(brands, id: \.name) { brand in
                            wayChip(symbol: nil, title: brand.name, count: brand.count) {
                                app.push(.brandIn(department: department.slug, name: brand.name))
                            }
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.white)
                .shadow(color: Brand.navy.opacity(0.08), radius: 12, x: 0, y: 6)
        )
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .task(id: "\(department.slug)|\(l.current.rawValue)") { await load(department) }
    }

    /// Its stores and its own shelf, asked together so they go as one request.
    private func load(_ department: Department) async {
        let catalog = app.services.catalog
        let language = l.current
        let stores = Task { try? await catalog.storesSelling(department: department.name, sub: nil, language: language) }
        let shelf = Task { try? await catalog.products(first: BrowseModel.pageSize, department: department.slug, language: language) }
        storesIn[department.slug] = await stores.value ?? storesIn[department.slug] ?? []
        guides[department.slug] = CategoryGuide(shelf: await shelf.value ?? [])
    }

    /// The ways in a shop's categories offer, each only where it leads somewhere.
    @ViewBuilder
    private func ways(_ department: Department, guide: CategoryGuide?) -> some View {
        if let guide {
            if !guide.ways.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(guide.ways, id: \.self) { way in
                        switch way {
                        case .deals:
                            wayChip(symbol: "tag", title: l.t("nav.deals"), count: guide.deals) {
                                app.push(.dealsIn(department: department.slug, sub: nil))
                            }
                        case .newest:
                            wayChip(symbol: "sparkles", title: l.t("browse.sort.newest"), count: nil) {
                                app.push(.newestIn(department: department.slug))
                            }
                        case .rating:
                            wayChip(symbol: "star.fill", title: l.t("browse.sort.rating"), count: nil) {
                                app.push(.topRatedIn(department: department.slug))
                            }
                        }
                    }
                }
            }
        } else {
            HStack(spacing: 8) {
                ForEach(0..<3, id: \.self) { _ in
                    Capsule().fill(Brand.photo).frame(width: 104, height: 40)
                }
            }
            .accessibilityHidden(true)
        }
    }

    /// A way in as a pill: its symbol, its words and, where it says something, a count.
    private func wayChip(symbol: String?, title: String, count: Int?, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            HStack(spacing: 7) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(symbol == "star.fill" ? Color(red: 1, green: 184 / 255, blue: 0) : Brand.navy)
                        .accessibilityHidden(true)
                }
                Text(title).lineLimit(1)
                if let count {
                    Text("\(count)")
                        .font(.inter(12, .bold))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Brand.tileField))
                }
            }
            .font(.inter(14, .bold))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 14)
            .frame(minHeight: 42)
            .glassChip(chosen: false)
        }
        .buttonStyle(.tap)
        .accessibilityElement(children: .combine)
    }

    /// The stores that sell something, as a sideways row of small cards —
    /// each its mark, its name and how many of them it sells — then "See all
    /// stores". While asked, outlines hold its place; with none it is not
    /// drawn, or says so where it was asked for (`emptyNote`, a subcategory).
    @ViewBuilder
    private func storesRow(key: String, title: String, emptyNote: Bool) -> some View {
        let found = storesIn[key]
        if found == nil || !(found ?? []).isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(title)
                    .font(.inter(15, .heavy))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        if let found {
                            ForEach(found.prefix(Self.storesShown)) { store in
                                storeChip(store)
                            }
                            seeAllStores
                        } else {
                            ForEach(0..<3, id: \.self) { _ in
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .fill(Brand.photo)
                                    .frame(width: 176, height: 60)
                            }
                            .accessibilityHidden(true)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 2)
                }
                .padding(.horizontal, -16)
            }
        } else if emptyNote {
            Text(l.t("categories.noStoresYet"))
                .font(.inter(13.5))
                .foregroundStyle(Brand.muted)
        }
    }

    private func storeChip(_ store: StoreCard) -> some View {
        Button {
            app.push(.store(slug: store.slug))
        } label: {
            HStack(spacing: 10) {
                StoreMark(name: store.name, logoUrl: store.logoUrl)
                    .scaleEffect(40.0 / 48.0)
                    .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 1) {
                    Text(store.name)
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(1)
                    Text(l.productCount(store.matching ?? store.products))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 10)
            .frame(width: 188, height: 60)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }

    private var seeAllStores: some View {
        Button {
            app.push(.stores)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "storefront").font(.system(size: 15, weight: .semibold)).accessibilityHidden(true)
                Text(l.t("stores.seeAll")).lineLimit(1)
            }
            .font(.inter(14, .bold))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 16)
            .frame(height: 60)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.muted.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 16))
    }

    // MARK: Subcategories

    /// The department's subcategories as squares in rows, the open one's
    /// panel under its row, then View all.
    private func subcategories(_ department: Department) -> some View {
        let subs = department.subs
        let rows = Self.rows(subs.map(\.slug) + [Self.viewAll], subColumns)
        let name = l.t(department.label)
        return VStack(alignment: .leading, spacing: 18) {
            ForEach(Array(rows.enumerated()), id: \.offset) { rowIndex, row in
                TileGrid(spacing: 12, columns: subColumns) {
                    ForEach(Array(row.enumerated()), id: \.element) { place, slug in
                        let order = rowIndex * subColumns + place
                        if let entry = subs.first(where: { $0.slug == slug }) {
                            let count = subCounts?[department.slug]?[entry.slug] ?? 0
                            square(symbol: entry.symbol,
                                   art: WebAssets.subcategory(department.slug, entry.slug),
                                   picture: pictures["\(department.slug)/\(entry.slug)"],
                                   title: entry.shown(l.current),
                                   note: subCounts == nil ? nil : l.productCount(count),
                                   quiet: subCounts != nil && count == 0,
                                   chosen: openSub == entry.slug) {
                                toggleSub(entry.slug)
                            }
                            .accessibilityHint(l.t("categories.storesIn", ["name": entry.shown(l.current)]))
                            .modifier(RiseIn(order: order))
                        } else {
                            // The whole department: what it holds, where a row said so in words.
                            square(symbol: "line.3.horizontal",
                                   title: l.t("home.viewAll"),
                                   note: app.shelf.counts.map { l.productCount($0[department.slug] ?? 0) } ?? "",
                                   quiet: false,
                                   chosen: false,
                                   spoken: l.t("categories.seeAllIn", ["name": name])) {
                                app.push(.department(slug: department.slug))
                            }
                            .modifier(RiseIn(order: order))
                        }
                    }
                }
                if let openSub, row.contains(openSub), let entry = subs.first(where: { $0.slug == openSub }) {
                    subPanel(department, entry)
                        .transition(still ? .opacity : .asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.97, anchor: .top)), removal: .opacity))
                }
            }
        }
        .id(department.slug)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("categories.subcategoriesOf", ["name": name]))
    }

    /// What one subcategory holds, under its row: the way to its products and
    /// its deals, and the stores that sell it.
    private func subPanel(_ department: Department, _ entry: Department.Subcategory) -> some View {
        let name = entry.shown(l.current)
        let count = subCounts?[department.slug]?[entry.slug]
        let deals = guides[department.slug]?.subDeals[entry.slug] ?? 0
        let key = "\(department.slug)/\(entry.slug)"
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(name)
                    .font(.inter(16, .heavy))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                if let count {
                    Text("· \(l.productCount(count))")
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                }
            }
            if count != 0 || deals > 0 {
                FlowLayout(spacing: 8) {
                    if count != 0 {
                        Button {
                            app.push(.subcategory(department: department.slug, sub: entry.slug))
                        } label: {
                            HStack(spacing: 6) {
                                Text(l.t("categories.shopSub", ["name": name])).lineLimit(1)
                                Image(systemName: "chevron.forward").font(.system(size: 12, weight: .bold))
                            }
                            .font(.inter(14, .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .frame(minHeight: 42)
                            .liquidGlass(.navy)
                        }
                        .buttonStyle(.tap)
                    }
                    if deals > 0 {
                        wayChip(symbol: "tag", title: l.t("nav.deals"), count: deals) {
                            app.push(.dealsIn(department: department.slug, sub: entry.slug))
                        }
                    }
                }
            }
            storesRow(key: key, title: l.t("categories.storesIn", ["name": name]), emptyNote: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Brand.tileField.opacity(0.6)))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .task(id: "\(key)|\(l.current.rawValue)") {
            let found = try? await app.services.catalog.storesSelling(department: department.name, sub: entry.slug, language: l.current)
            storesIn[key] = found ?? storesIn[key] ?? []
        }
    }

    /// One subcategory as a rounded square — its picture on white (the one
    /// kept from the portal, else its own, `art`), or its symbol on the pale
    /// field — with its name and what it holds under it, outlined in navy
    /// while its panel is open. An empty one's symbol is drawn lighter; its
    /// picture never is. `spoken` is what VoiceOver says where the words under
    /// the square are not the whole of it.
    private func square(symbol: String, art: UIImage? = nil, picture: String? = nil, title: String, note: String?, quiet: Bool, chosen: Bool, spoken: String? = nil, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            VStack(spacing: 8) {
                SquareFace(fill: picture != nil || art != nil ? Color.white : (quiet ? Brand.photo : Brand.tileField)) {
                    // A picture is drawn at full strength whether or not the
                    // subcategory holds anything: faded to 70% for an empty
                    // one, black and silver goods read as dull grey, and the
                    // owner asked why. The line under it says "No products".
                    if let picture {
                        RemoteImage(reference: picture, contentMode: .fit)
                            .padding(8)
                    } else if let art {
                        // Its own picture fills the square: every file holds
                        // its objects centred at one margin, so no padding
                        // here keeps the thirty-five the same size.
                        Image(uiImage: art)
                            .resizable()
                            .scaledToFit()
                    } else {
                        Image(systemName: symbol)
                            .font(.system(size: 34, weight: .regular))
                            .foregroundStyle(quiet ? Brand.muted : Brand.navy)
                    }
                }
                .overlay {
                    if chosen {
                        RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Brand.navy, lineWidth: 2.5)
                    }
                }
                Text(title)
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
                    .minimumScaleFactor(0.85)
                Group {
                    if let note {
                        Text(note)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                    } else {
                        // The count is on its way.
                        Capsule().fill(Brand.photo).frame(width: 56, height: 12)
                    }
                }
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .frame(height: 16)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 20))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(spoken ?? [title, note ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
        .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
    }
}

/// A square rising into place a beat behind the one before it — `order` beats,
/// 40 milliseconds each — the web's `.cat-rise`. Shown at once under Reduce
/// Motion.
private struct RiseIn: ViewModifier {
    let order: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var still

    func body(content: Content) -> some View {
        let up = shown || still
        content
            .opacity(up ? 1 : 0)
            .offset(y: up ? 0 : 14)
            .scaleEffect(up ? 1 : 0.98)
            .onAppear {
                guard !still, !shown else { return }
                withAnimation(.spring(response: 0.46, dampingFraction: 0.86).delay(Double(order) * 0.04)) { shown = true }
            }
    }
}
