import SwiftUI

/// The Categories tab searched, on the owner's word ("the search bar should
/// only search for what's in the specific page") — the web's `PageResults`:
/// the departments whose names answer, the subcategories whose names or the
/// words their products are called by answer (each saying which department
/// it is in), and the stores by either of their names, in place of the
/// tiles; with nothing, the shop's own search for the same words a press away.
/// Matched by `SearchRank.textsMatch`, the shop's own folding and stemming.
struct CategoriesResults: View {
    let term: String
    /// Every store, asked the first time the page is searched; nil while asked.
    let stores: [StoreCard]?
    /// A department pressed — or `department/sub` — the page itself, opened on it.
    let chooseDepartment: (String) -> Void
    @State private var subCounts: [String: [String: Int]]?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var departments: [Department] { ReferenceData.shared.departments }

    var body: some View {
        let foundDepartments = departments.filter { SearchRank.textsMatch([$0.name, $0.nameAr, l.t($0.label)], term) }
        let foundSubs: [FoundSub] = departments.flatMap { department in
            department.subs
                .filter { SearchRank.textsMatch([$0.name, $0.nameAr] + ($0.words ?? []), term) }
                .map { FoundSub(department: department, sub: $0) }
        }
        let foundStores = (stores ?? []).filter { SearchRank.textsMatch([$0.name, $0.otherName], term) }
        VStack(alignment: .leading, spacing: 20) {
            if !foundDepartments.isEmpty {
                section(l.t("categories.resultsDepartments")) {
                    ForEach(Array(foundDepartments.enumerated()), id: \.element.slug) { index, department in
                        if index > 0 { DashedRule() }
                        row(art: WebAssets.department(department.slug), symbol: department.symbol,
                            title: l.t(department.label),
                            note: app.shelf.counts.map { l.productCount($0[department.slug] ?? 0) }) {
                            chooseDepartment(department.slug)
                        }
                    }
                }
            }
            if !foundSubs.isEmpty {
                section(l.t("categories.subcategories")) {
                    ForEach(Array(foundSubs.enumerated()), id: \.element.id) { index, found in
                        if index > 0 { DashedRule() }
                        let count = subCounts?[found.department.slug]?[found.sub.slug]
                        let within = l.t("search.within", ["place": l.t(found.department.label)])
                        row(art: WebAssets.subcategory(found.department.slug, found.sub.slug), symbol: found.sub.symbol,
                            title: found.sub.shown(l.current),
                            note: count.map { "\(within) · \(l.productCount($0))" } ?? within) {
                            // The page again, on its department with the stores selling it shown.
                            chooseDepartment("\(found.department.slug)/\(found.sub.slug)")
                        }
                    }
                }
            }
            if !foundStores.isEmpty {
                section(l.t("stores.title")) {
                    ForEach(Array(foundStores.enumerated()), id: \.element.slug) { index, store in
                        if index > 0 { DashedRule() }
                        Button {
                            app.push(.store(slug: store.slug))
                        } label: {
                            HStack(spacing: 14) {
                                StoreMark(name: store.name, logoUrl: store.logoUrl)
                                    .scaleEffect(44.0 / 48.0)
                                    .frame(width: 44, height: 44)
                                caption(title: store.name, note: l.productCount(store.products))
                            }
                            .rowFrame()
                        }
                        .buttonStyle(.tap)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            if foundDepartments.isEmpty && foundSubs.isEmpty && foundStores.isEmpty && stores != nil {
                PageSearchMissed(term: term)
            }
        }
        .task {
            if subCounts == nil, let counts = try? await app.services.api.call(API.subcategoryCounts) { subCounts = counts }
        }
    }

    private func section<Rows: View>(_ title: String, @ViewBuilder rows: () -> Rows) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.inter(15, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0, content: rows)
                .padding(.horizontal, 16)
                .panel()
        }
    }

    private func row(art: UIImage?, symbol: String, title: String, note: String?, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            HStack(spacing: 14) {
                Group {
                    if let art {
                        Image(uiImage: art).resizable().scaledToFit()
                    } else {
                        Image(systemName: symbol)
                            .font(.system(size: 22))
                            .foregroundStyle(Brand.navy)
                    }
                }
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                .accessibilityHidden(true)
                caption(title: title, note: note)
            }
            .rowFrame()
        }
        .buttonStyle(.tap)
        .accessibilityElement(children: .combine)
    }

    private func caption(title: String, note: String?) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.inter(15, .bold))
                    .foregroundStyle(Brand.navy)
                if let note {
                    Text(note)
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.forward")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Brand.muted)
                .accessibilityHidden(true)
        }
    }
}

/// A subcategory that answered, with the department it is in.
private struct FoundSub: Identifiable {
    let department: Department
    let sub: Department.Subcategory
    var id: String { "\(department.slug)/\(sub.slug)" }
}

private extension View {
    func rowFrame() -> some View {
        padding(.vertical, 8)
            .frame(minHeight: 64)
            .contentShape(Rectangle())
    }
}
