import SwiftUI

/// The stores that sell what a search found, or what a subcategory holds, at
/// the top of the page, on the owner's word ("when you search for something
/// it would show the stores that sell it at the top") — the web's
/// `StoresSellingRow`. A sideways row of small chips, the store selling the
/// most first, each saying how many of them it sells; small on purpose, so
/// the products stay on the first screen. Nothing is drawn while there are none.
struct StoresSellingRow: View {
    let stores: [StoreCard]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if !stores.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(l.t("search.storesSelling"))
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(stores) { store in chip(store) }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 1)
                }
                .padding(.horizontal, -16)
            }
            .accessibilityElement(children: .contain)
        }
    }

    private func chip(_ store: StoreCard) -> some View {
        let count = l.productCount(store.matching ?? store.products)
        return Button {
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
                    Text(count)
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                        .lineLimit(1)
                }
                .frame(maxWidth: 160, alignment: .leading)
                Image(systemName: "chevron.forward")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
            }
            .padding(.leading, 8)
            .padding(.trailing, 12)
            .frame(height: 56)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(store.name), \(count)")
        .accessibilityAddTraits(.isButton)
    }
}
