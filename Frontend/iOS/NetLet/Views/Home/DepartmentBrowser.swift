import SwiftUI

/// The Categories tab's departments and their subcategories, drawn to a
/// picture the owner sent of a shop's Categories screen — the web's
/// `/categories`.
///
/// The departments are a sideways row of picture tiles, reaching the screen's
/// edges so the one cut off there says there is more, the chosen one outlined
/// in navy; under them, the chosen department's subcategories as rows, each
/// with its picture (`Department.Subcategory.symbol`, from the icon
/// `Shared/commerce/subcategories.ts` names), its name and how many it holds
/// (`commerce.subcategoryCounts`), opening the department narrowed to it; a
/// last row, "View all", opens the whole department. Every subcategory is
/// listed, an empty one saying so, as the tiles keep all six. "All
/// departments" ends the row and opens its page: it has no subcategories.
///
/// **The tiles are large, and the chosen one grows a little on a spring, on
/// the owner's word** ("make the category images bigger, and when you select
/// any of them it gets a bit bigger … smooth animation for everything"): a
/// press gives under the thumb (`SpringPressStyle`), the chosen tile settles
/// at 108% and is brought to the middle of the row, and its subcategories
/// rise into place one after another (`RiseIn`). Reduce Motion keeps the
/// chosen tile the larger and moves nothing.
struct DepartmentBrowser: View {
    @State private var chosen: String?
    @State private var subCounts: [String: [String: Int]]?
    /// The pictures an administrator kept (`subcategoryPictures.list`), by
    /// `department/slug`; a row with none keeps its symbol.
    @State private var pictures: [String: String] = [:]
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
                    .padding(8)
                    .frame(width: 108, height: 108)
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
            .frame(width: 112)
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
            // Made afresh for each department, so its rows rise in again;
            // the old ones go at once rather than sharing the column.
            VStack(spacing: 8) {
                ForEach(Array(department.subs.enumerated()), id: \.element.id) { index, entry in
                    let count = subCounts?[department.slug]?[entry.slug] ?? 0
                    row(symbol: entry.symbol,
                        picture: pictures["\(department.slug)/\(entry.slug)"],
                        title: entry.shown(l.current),
                        note: subCounts == nil ? nil : l.productCount(count),
                        quiet: subCounts != nil && count == 0) {
                        app.push(.subcategory(department: department.slug, sub: entry.slug))
                    }
                    .modifier(RiseIn(order: index))
                }
                row(symbol: "line.3.horizontal", title: l.t("home.viewAll"), note: l.t("categories.seeAllIn", ["name": name]), quiet: false) {
                    app.push(.department(slug: department.slug))
                }
                .modifier(RiseIn(order: department.subs.count))
            }
            .id(department.slug)
            .transition(.identity)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("categories.subcategoriesOf", ["name": name]))
    }

    /// One row: its picture in a pale tile, its name, what it holds, a chevron.
    private func row(symbol: String, picture: String? = nil, title: String, note: String?, quiet: Bool, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            HStack(spacing: 12) {
                if let picture {
                    // The subcategory's kept picture, on white, where its symbol stood.
                    RemoteImage(reference: picture, contentMode: .fit)
                        .frame(width: 56, height: 56)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                        .opacity(quiet ? 0.7 : 1)
                        .accessibilityHidden(true)
                } else {
                    Image(systemName: symbol)
                        .font(.system(size: 21, weight: .regular))
                        .foregroundStyle(quiet ? Brand.muted : Brand.navy)
                        .frame(width: 48, height: 48)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(quiet ? Brand.photo : Color(red: 238 / 255, green: 241 / 255, blue: 246 / 255))
                        )
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.inter(15, .bold))
                        .foregroundStyle(Brand.navy)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Group {
                        if let note {
                            Text(note)
                        } else {
                            Capsule().fill(Brand.photo).frame(width: 64, height: 12)
                        }
                    }
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.forward")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Brand.navy)
                    .accessibilityHidden(true)
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white)
                    .shadow(color: Brand.navy.opacity(0.06), radius: 1, x: 0, y: 1)
            )
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
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
            .offset(y: up ? 0 : 14)
            .scaleEffect(up ? 1 : 0.98)
            .onAppear {
                guard !still, !shown else { return }
                withAnimation(.spring(response: 0.46, dampingFraction: 0.86).delay(Double(order) * 0.04)) { shown = true }
            }
    }
}
