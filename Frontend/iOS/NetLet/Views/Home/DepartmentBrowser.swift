import SwiftUI

/// The Categories tab's departments and their subcategories, drawn to a
/// picture the owner sent of a shop's Categories screen — the web's
/// `/categories`.
///
/// The departments are a sideways row of picture tiles, reaching the screen's
/// edges so the one cut off there says there is more, the chosen one outlined
/// in navy; under them, the chosen department's subcategories. **They are
/// rounded squares, three to a row, on the owner's word** ("for the
/// subcategories, instead of being as a list, make it rounded squares"): each
/// a square (`SquareFace`, the department tiles' own shape) holding its
/// picture — its own, carried in the app (`WebAssets.subcategory`, the files
/// the owner sent for all thirty-five), or the one kept from the portal in its
/// place; its symbol on the pale field (`Department.Subcategory.symbol`) only
/// where there is neither — with its name and how many it holds under it
/// (`commerce.subcategoryCounts`), opening the department narrowed to it; a last square, "View all", opens the whole
/// department. They were rows, one under another. Every subcategory is
/// there, an empty one saying so under its picture, as the tiles keep all
/// six. "All departments" ends the row and opens its page: it has no
/// subcategories.
///
/// **The tiles are large, and the chosen one grows a little on a spring, on
/// the owner's word** ("make the category images bigger, and when you select
/// any of them it gets a bit bigger … smooth animation for everything"): a
/// press gives under the thumb (`SpringPressStyle`), the chosen tile settles
/// at 108% and is brought to the middle of the row, and its subcategories
/// rise into place one after another (`RiseIn`). Reduce Motion keeps the
/// chosen tile the larger and moves nothing. **A department's tile is bigger
/// than a subcategory's square, on the owner's word** ("make the category
/// icons bigger than the subcategory"): 132 points, where the subcategories
/// are four to a row, about 80 on a phone.
///
/// **The stores that sell in the chosen department follow its
/// subcategories, on the owner's word** ("remove the shop by stores, instead
/// add the stores to the sub category"): the same squares (`StoreTile`, its
/// count what it sells here), the one selling the most first
/// (`commerce.storesSelling`), and "See all stores" after them.
struct DepartmentBrowser: View {
    @State private var chosen: String?
    @State private var subCounts: [String: [String: Int]]?
    /// The pictures an administrator kept (`subcategoryPictures.list`), by
    /// `department/slug`; a square with none draws its own picture.
    @State private var pictures: [String: String] = [:]
    /// The stores that sell in each department, as they are asked for.
    @State private var storesIn: [String: [StoreCard]] = [:]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        let departments = ReferenceData.shared.departments
        let department = departments.first { $0.slug == chosen } ?? departments.first
        VStack(alignment: .leading, spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 14) {
                        ForEach(departments) { entry in
                            tile(slug: entry.slug, title: l.t(entry.label), selected: entry.slug == department?.slug) {
                                guard chosen != entry.slug else { return }
                                withAnimation(still ? nil : .spring(response: 0.45, dampingFraction: 0.82)) {
                                    chosen = entry.slug
                                    proxy.scrollTo(entry.slug, anchor: .center)
                                }
                            }
                            .accessibilityHint(l.t("ios.categories.showsSubcategories"))
                            .id(entry.slug)
                        }
                        tile(slug: "all", title: l.t("nav.allDepartments"), selected: false) {
                            app.push(.department(slug: nil))
                        }
                    }
                    .padding(.horizontal, 16)
                    // Room above and below for the chosen tile to grow into.
                    .padding(.vertical, 12)
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .padding(.horizontal, -16)
                .onAppear {
                    // A department opened from elsewhere (the screenshots'
                    // `categories:<slug>`) is brought into the row's view.
                    if let preset = app.categoriesOpen {
                        chosen = preset
                        app.categoriesOpen = nil
                        proxy.scrollTo(preset, anchor: .center)
                    }
                }
            }
            if let department {
                list(department)
                    .padding(.top, 16)
            }
        }
        .task {
            if let counts = try? await app.services.api.call(API.subcategoryCounts) { subCounts = counts }
            if let kept = try? await app.services.api.call(API.subcategoryPictures) { pictures = kept }
        }
    }

    /// One department's picture tile with its name under it; the chosen one
    /// outlined in navy, lifted by its shadow and grown a little on a spring.
    private func tile(slug: String, title: String, selected: Bool, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            VStack(spacing: 12) {
                BundledImage(image: WebAssets.department(slug))
                    .aspectRatio(contentMode: .fit)
                    .padding(10)
                    .frame(width: 132, height: 132)
                    .background(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(Color.white)
                            .shadow(color: Brand.navy.opacity(selected ? 0.16 : 0.04), radius: selected ? 10 : 2, x: 0, y: selected ? 6 : 1)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(selected ? Brand.navy : Brand.cardLine, lineWidth: 2)
                    )
                    .scaleEffect(selected ? 1.08 : 1)
                    .animation(still ? nil : .spring(response: 0.42, dampingFraction: 0.6), value: selected)
                Text(title)
                    .font(.inter(13.5, selected ? .heavy : .semibold))
                    .foregroundStyle(selected ? Brand.navy : Color(red: 43 / 255, green: 58 / 255, blue: 85 / 255))
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
            }
            .frame(width: 136)
            .contentShape(Rectangle())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 20))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// The chosen department's subcategories, then View all.
    private func list(_ department: Department) -> some View {
        let name = l.t(department.label)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(name)
                    .contentTransition(.opacity)
                    .font(.inter(18, .heavy))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                if let counts = app.shelf.counts {
                    Text(l.productCount(counts[department.slug] ?? 0))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                }
            }
            // Made afresh for each department, so its squares rise in again;
            // the old ones go at once rather than sharing the grid. Three to a
            // row on a phone, more on a wide screen rather than wider squares.
            TileGrid(spacing: 10, columns: 4, widest: 110, rowSpacing: 16) {
                ForEach(Array(department.subs.enumerated()), id: \.element.id) { index, entry in
                    let count = subCounts?[department.slug]?[entry.slug] ?? 0
                    square(symbol: entry.symbol,
                           art: WebAssets.subcategory(department.slug, entry.slug),
                           picture: pictures["\(department.slug)/\(entry.slug)"],
                           title: entry.shown(l.current),
                           note: subCounts == nil ? nil : l.productCount(count),
                           quiet: subCounts != nil && count == 0) {
                        app.push(.subcategory(department: department.slug, sub: entry.slug))
                    }
                    .modifier(RiseIn(order: index))
                }
                // The whole department: what it holds, where a row said so in words.
                square(symbol: "line.3.horizontal",
                       title: l.t("home.viewAll"),
                       note: app.shelf.counts.map { l.productCount($0[department.slug] ?? 0) } ?? "",
                       quiet: false,
                       spoken: l.t("categories.seeAllIn", ["name": name])) {
                    app.push(.department(slug: department.slug))
                }
                .modifier(RiseIn(order: department.subs.count))
            }
            .id(department.slug)
            .transition(.identity)
            stores(department, name: name)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("categories.subcategoriesOf", ["name": name]))
        .task(id: "\(department.slug)|\(l.current.rawValue)") {
            if let found = try? await app.services.catalog.storesSelling(department: department.name, sub: nil, language: l.current) {
                storesIn[department.slug] = found
            }
        }
    }

    /// The stores that sell in the department, under its subcategories, then
    /// "See all stores". Only once somebody sells in it.
    @ViewBuilder
    private func stores(_ department: Department, name: String) -> some View {
        if let found = storesIn[department.slug], !found.isEmpty {
            Text(l.t("categories.storesIn", ["name": name]))
                .font(.inter(16, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 20)
            TileGrid(spacing: 10, columns: 4, widest: 110, rowSpacing: 16) {
                ForEach(Array(found.prefix(7).enumerated()), id: \.element.id) { index, store in
                    StoreTile(store: store)
                        .modifier(RiseIn(order: department.subs.count + 1 + index))
                }
                square(symbol: "storefront",
                       title: l.t("stores.seeAll"),
                       note: "",
                       quiet: false,
                       spoken: l.t("stores.seeAll")) {
                    app.push(.stores)
                }
                .modifier(RiseIn(order: department.subs.count + 1 + min(7, found.count)))
            }
            .id("stores-\(department.slug)")
        }
    }

    /// One subcategory as a rounded square — its picture on white (the one
    /// kept from the portal, else its own, `art`), or its symbol on the pale
    /// field — with its name and what it holds under it. An empty one's
    /// symbol is drawn lighter; its picture never is. `spoken` is what
    /// VoiceOver says where the words under the square are not the whole of it.
    private func square(symbol: String, art: UIImage? = nil, picture: String? = nil, title: String, note: String?, quiet: Bool, spoken: String? = nil, open: @escaping () -> Void) -> some View {
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
        .accessibilityAddTraits(.isButton)
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
