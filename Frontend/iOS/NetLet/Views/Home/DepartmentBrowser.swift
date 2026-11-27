import SwiftUI

/// The Categories tab's departments — the web's `/categories`.
///
/// **Drawn after the owner's picture of a shop's Categories screen, in three
/// steps** ("when you tap on a category, it must open the sub category of
/// that category. And then when you tap on a sub category, it should show the
/// products for that sub category, with the stores shown at the top, with the
/// filters option"). The last round's panels — the stores, the ways in, the
/// brands and a second panel under each subcategory — read as confusing, and
/// went:
///
/// 1. The departments are a grid of pictures with their names under them,
///    three to a row on a phone and six on a wide screen, each the home
///    page's own art on the pale field.
/// 2. A press on one rims its picture in navy and unfolds its subcategories
///    directly under its row: a list of rows, each the subcategory's picture
///    (its own, carried in the app, or the one kept from the portal in its
///    place) and its name, ending on "View all", the whole department. A
///    second press folds it; one is open at a time.
/// 3. A row opens that subcategory's products (`.subcategory`), which lead
///    with the filter chips and the stores that sell it, under the floating
///    Sort | Filter pill.
///
/// "All departments" is the last tile and opens its page. Reduce Motion
/// opens and closes without the spring.
struct DepartmentBrowser: View {
    /// The department open, by its slug.
    @State private var opened: String?
    /// The pictures an administrator kept (`subcategoryPictures.list`), by
    /// `department/slug`; a row with none draws its own picture.
    @State private var pictures: [String: String] = [:]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// How tall the page shows, for the scroll's anchor (`revealAnchor`).
    @Environment(\.pageViewport) private var viewport

    /// The last tile, which opens every department's page rather than a list.
    private static let all = "all"

    /// Three tiles to a row on a phone, six on a wide screen.
    private var columns: Int { sizeClass == .regular ? 6 : 3 }
    /// The subcategories one under another on a phone, two side by side on a wide screen.
    private var listColumns: Int { sizeClass == .regular ? 2 : 1 }

    private var opening: Animation? { still ? nil : .spring(response: 0.4, dampingFraction: 0.88) }

    var body: some View {
        let departments = ReferenceData.shared.shopDepartments
        let rows = Self.rows(departments.map(\.slug) + [Self.all], columns)
        ScrollViewReader { proxy in
            VStack(alignment: .leading, spacing: 18) {
                ForEach(rows, id: \.self) { row in
                    VStack(alignment: .leading, spacing: 0) {
                        // The row's mark: nothing, at the row's top, in the
                        // layout itself, so where the scroll finds it is where
                        // the row is (`reveal`).
                        Color.clear
                            .frame(height: 0)
                            .id(Self.mark(row))
                            .accessibilityHidden(true)
                        TileGrid(spacing: 12, columns: columns) {
                            ForEach(row, id: \.self) { slug in
                                if let department = departments.first(where: { $0.slug == slug }) {
                                    tile(department, proxy: proxy)
                                } else {
                                    allTile
                                }
                            }
                        }
                    }
                    if let opened, row.contains(opened), let department = departments.first(where: { $0.slug == opened }) {
                        subcategoryList(department)
                            .transition(still ? .opacity : .asymmetric(insertion: .opacity.combined(with: .offset(y: -8)), removal: .opacity))
                    }
                }
            }
            .task {
                if let kept = try? await app.services.api.call(API.subcategoryPictures) { pictures = kept }
            }
            .onAppear { applyPreset(proxy) }
            .onChange(of: app.categoriesOpen) { applyPreset(proxy) }
        }
    }

    /// A department opened from elsewhere: a home tile, a search result on
    /// this page, or the screenshots' `categories:<slug>` — open, and brought
    /// up under the search row once the tab is on screen, as a press would.
    private func applyPreset(_ proxy: ScrollViewProxy) {
        guard let preset = app.categoriesOpen else { return }
        app.categoriesOpen = nil
        guard let slug = preset.split(separator: "/").first.map(String.init) else { return }
        opened = slug
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))
            reveal(slug, proxy)
        }
    }

    /// The slugs in rows of `count`, the last row as long as what is left.
    private static func rows(_ slugs: [String], _ count: Int) -> [[String]] {
        stride(from: 0, to: slugs.count, by: max(count, 1)).map { Array(slugs[$0..<min($0 + count, slugs.count)]) }
    }

    /// Opens or folds a department. **Opening one glides the page until its
    /// row is just under the search row, on the owner's word** ("when you tap
    /// on a category, it should automatically scroll down showing the sub
    /// categories … when you tap on any category"): its subcategories unfold
    /// into the screen under it rather than past the tab bar. The scroll is
    /// asked for a turn later, once the list is in the layout — and a list
    /// another department had open above has gone from it.
    private func toggle(_ slug: String, proxy: ScrollViewProxy) {
        let opens = opened != slug
        withAnimation(opening) { opened = opens ? slug : nil }
        guard opens else { return }
        Task { @MainActor in reveal(slug, proxy) }
    }

    /// Brings the row holding `slug` up under the search row.
    private func reveal(_ slug: String, _ proxy: ScrollViewProxy) {
        let slugs = ReferenceData.shared.shopDepartments.map(\.slug) + [Self.all]
        guard let row = Self.rows(slugs, columns).first(where: { $0.contains(slug) }) else { return }
        let glide: Animation? = still ? nil : .smooth(duration: 0.45)
        withAnimation(glide) {
            proxy.scrollTo(Self.mark(row), anchor: Self.revealAnchor(viewport: viewport))
        }
    }

    /// The id of a row's mark, by its first department.
    private static func mark(_ row: [String]) -> String { "categories-row-\(row.first ?? "")" }

    /// How far under the top of what the page shows a pressed row comes to
    /// rest: the pinned search row (`SearchRow.height`) and a little room.
    static var clearance: CGFloat { SearchRow.height + 12 }

    /// The scroll's anchor that leaves a row's mark `clearance` under the top
    /// of what the page shows. A scroll anchor names the same point of the
    /// view and of the page, and the mark has no height, so the point is the
    /// mark itself and a fraction of the page's height. **The first build
    /// scrolled a mark placed `clearance` above the row by an alignment guide
    /// in the row's background to the top, and the scroll took the mark to be
    /// at the row's top**: every row landed under the search row, at the
    /// screen's safe-area top (`CategoriesUITests`, iOS run 295). With no
    /// height to go by, it is the top.
    static func revealAnchor(viewport: CGFloat) -> UnitPoint {
        guard viewport > clearance else { return .top }
        return UnitPoint(x: 0.5, y: clearance / viewport)
    }

    // MARK: The tiles

    /// One department as its picture with its name under it, which opens and
    /// closes its subcategories.
    private func tile(_ department: Department, proxy: ScrollViewProxy) -> some View {
        let open = opened == department.slug
        return Button {
            toggle(department.slug, proxy: proxy)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                face(department.slug, open: open)
                name(l.t(department.label))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .contentShape(Rectangle())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 22))
        .accessibilityElement(children: .combine)
        .accessibilityHint(l.t("categories.opensSubcategories"))
        .accessibilityAddTraits(open ? .isSelected : [])
    }

    /// "All departments": every department's page, so a link rather than a list.
    private var allTile: some View {
        Button {
            app.push(.department(slug: nil))
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                face(Self.all, open: false)
                name(l.t("nav.allDepartments"))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .contentShape(Rectangle())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 22))
        .accessibilityElement(children: .combine)
    }

    /// A tile's picture on its pale field, rimmed in navy while its department is open.
    private func face(_ slug: String, open: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        return Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { DepartmentArt(slug: slug).padding(8) }
            .background(shape.fill(Brand.tileField))
            .clipShape(shape)
            .overlay(shape.strokeBorder(open ? Brand.navy : Color.clear, lineWidth: 3))
            .animation(still ? nil : .easeOut(duration: 0.2), value: open)
    }

    private func name(_ text: String) -> some View {
        Text(text)
            .font(.inter(14, .bold))
            .foregroundStyle(Brand.navy)
            .multilineTextAlignment(.leading)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 2)
    }

    // MARK: A department's subcategories

    /// The open department's subcategories under its row, each a row that
    /// opens its products, then "View all", the whole department.
    private func subcategoryList(_ department: Department) -> some View {
        let name = l.t(department.label)
        let subs = department.subs
        return TileGrid(spacing: 10, columns: listColumns) {
            ForEach(Array(subs.enumerated()), id: \.element.slug) { order, entry in
                listRow(art: WebAssets.subcategory(department.slug, entry.slug),
                        picture: pictures["\(department.slug)/\(entry.slug)"],
                        symbol: entry.symbol,
                        title: entry.shown(l.current)) {
                    app.push(.subcategory(department: department.slug, sub: entry.slug))
                }
                .modifier(RiseIn(order: order))
            }
            listRow(symbol: "line.3.horizontal", title: l.t("home.viewAll"), spoken: l.t("categories.seeAllIn", ["name": name])) {
                app.push(.department(slug: department.slug))
            }
            .modifier(RiseIn(order: subs.count))
        }
        .id(department.slug)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("categories.subcategoriesOf", ["name": name]))
    }

    /// One row of the list: the subcategory's picture on white (the one kept
    /// from the portal, else its own, `art`), or its symbol on a grey tile,
    /// and its name, on the pale grey of the owner's picture. `spoken` is what
    /// VoiceOver says where the words drawn are not the whole of it.
    private func listRow(art: UIImage? = nil, picture: String? = nil, symbol: String, title: String, spoken: String? = nil, open: @escaping () -> Void) -> some View {
        let tileShape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        let rowShape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        let drawn = picture != nil || art != nil
        return Button(action: open) {
            HStack(spacing: 14) {
                ZStack {
                    if let picture {
                        RemoteImage(reference: picture, contentMode: .fit)
                    } else if let art {
                        Image(uiImage: art).resizable().scaledToFit()
                    } else {
                        Image(systemName: symbol)
                            .font(.system(size: 24, weight: .regular))
                            .foregroundStyle(Brand.body)
                    }
                }
                .frame(width: 56, height: 56)
                .background(tileShape.fill(drawn ? Brand.surface : Color(light: 0xE2E6ED, dark: 0x212935)))
                .clipShape(tileShape)
                .accessibilityHidden(true)
                Text(title)
                    .font(.inter(16, .bold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 76, maxHeight: .infinity, alignment: .leading)
            .background(rowShape.fill(Color(light: 0xF1F3F6, dark: 0x222935)))
            .contentShape(rowShape)
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 18))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(spoken ?? title)
        .accessibilityAddTraits(.isButton)
    }
}

/// A row rising into place a beat behind the one before it — `order` beats,
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
            .offset(y: up ? 0 : 10)
            .onAppear {
                guard !still, !shown else { return }
                withAnimation(.spring(response: 0.42, dampingFraction: 0.88).delay(Double(order) * 0.04)) { shown = true }
            }
    }
}
