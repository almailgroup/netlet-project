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
struct DepartmentBrowser: View {
    @State private var chosen: String?
    @State private var subCounts: [String: [String: Int]]?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        let departments = ReferenceData.shared.departments
        let department = departments.first { $0.slug == chosen } ?? departments.first
        VStack(alignment: .leading, spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(departments) { entry in
                            tile(slug: entry.slug, title: l.t(entry.label), selected: entry.slug == department?.slug) {
                                withAnimation(still ? nil : .snappy(duration: 0.25)) { chosen = entry.slug }
                            }
                            .accessibilityHint(l.t("ios.categories.showsSubcategories"))
                            .id(entry.slug)
                        }
                        tile(slug: "all", title: l.t("nav.allDepartments"), selected: false) {
                            app.push(.department(slug: nil))
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 4)
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
                    .padding(.top, 24)
            }
        }
        .task {
            if let counts = try? await app.services.api.call(API.subcategoryCounts) { subCounts = counts }
        }
    }

    /// One department's picture tile with its name under it.
    private func tile(slug: String, title: String, selected: Bool, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            VStack(spacing: 6) {
                BundledImage(image: WebAssets.department(slug))
                    .aspectRatio(contentMode: .fit)
                    .padding(6)
                    .frame(width: 88, height: 88)
                    .background(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(Color.white)
                            .shadow(color: Brand.navy.opacity(selected ? 0.12 : 0), radius: 4, x: 0, y: 2)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(selected ? Brand.navy : Brand.cardLine, lineWidth: 2)
                    )
                Text(title)
                    .font(.inter(13, selected ? .heavy : .semibold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
            }
            .frame(width: 92)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// The chosen department's subcategories, then View all.
    private func list(_ department: Department) -> some View {
        let name = l.t(department.label)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(name)
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
            VStack(spacing: 8) {
                ForEach(department.subs) { entry in
                    let count = subCounts?[department.slug]?[entry.slug] ?? 0
                    row(symbol: entry.symbol,
                        title: entry.shown(l.current),
                        note: subCounts == nil ? nil : l.productCount(count),
                        quiet: subCounts != nil && count == 0) {
                        app.push(.subcategory(department: department.slug, sub: entry.slug))
                    }
                }
                row(symbol: "line.3.horizontal", title: l.t("home.viewAll"), note: l.t("categories.seeAllIn", ["name": name]), quiet: false) {
                    app.push(.department(slug: department.slug))
                }
            }
            .id(department.slug)
            .transition(.opacity)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("categories.subcategoriesOf", ["name": name]))
    }

    /// One row: its picture in a pale tile, its name, what it holds, a chevron.
    private func row(symbol: String, title: String, note: String?, quiet: Bool, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 21, weight: .regular))
                    .foregroundStyle(quiet ? Brand.muted : Brand.navy)
                    .frame(width: 48, height: 48)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(quiet ? Brand.photo : Color(red: 238 / 255, green: 241 / 255, blue: 246 / 255))
                    )
                    .accessibilityHidden(true)
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
        .buttonStyle(PressFillStyle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }
}
