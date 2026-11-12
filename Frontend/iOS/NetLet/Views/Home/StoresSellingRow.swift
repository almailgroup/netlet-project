import SwiftUI

/// "Shop by store": the stores that sell what the page holds — a department,
/// a subcategory, a search — at the top of its products, on the owner's word
/// ("it should show the products for that sub category, with the stores shown
/// at the top"), drawn after their picture of a shop's "Shop by brand" row —
/// the web's `StoresSellingRow`. A sideways row of large circles, each the
/// store's logo (or its initial) with its name under it, the store selling
/// the most first; a press opens the store. It sits under the filter chips and
/// over the grid. Nothing is drawn while there are none.
struct StoresSellingRow: View {
    let stores: [StoreCard]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    /// A circle's side, the reference's: large enough to read a logo by.
    private static let side: CGFloat = 84

    var body: some View {
        if !stores.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text(l.t("browse.shopByStore"))
                    .font(.inter(19, .heavy))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach(stores) { store in circle(store) }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 2)
                }
                .padding(.horizontal, -16)
            }
            .accessibilityElement(children: .contain)
        }
    }

    private func circle(_ store: StoreCard) -> some View {
        let count = l.productCount(store.matching ?? store.products)
        return Button {
            app.push(.store(slug: store.slug))
        } label: {
            VStack(spacing: 8) {
                ZStack {
                    Circle().fill(Color(red: 241 / 255, green: 243 / 255, blue: 246 / 255))
                    if let logo = store.logoUrl, !logo.isEmpty {
                        RemoteImage(reference: logo, contentMode: .fit)
                            .padding(14)
                    } else {
                        Text(store.name.trimmingCharacters(in: .whitespaces).first.map { String($0).uppercased() } ?? "·")
                            .font(.inter(30, .bold))
                            .foregroundStyle(Brand.navy)
                    }
                }
                .frame(width: Self.side, height: Self.side)
                .clipShape(Circle())
                Text(store.name)
                    .font(.inter(13, .semibold))
                    .foregroundStyle(Brand.ink)
                    .multilineTextAlignment(.center)
                    .lineLimit(2, reservesSpace: true)
                    .frame(width: Self.side)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: Self.side / 2))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(store.name), \(count)")
        .accessibilityAddTraits(.isButton)
    }
}
