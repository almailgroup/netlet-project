import SwiftUI

/// A store's own products, with the status a shopper never sees, and the way
/// to add one. Everything else a seller does is in the web portal, which this
/// screen names rather than copies.
struct SellerListingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { SellerListingsViewModel(service: app.services.seller) }) { model in
            LoadStateView(state: model.listings, retry: { await model.load(vendorId: app.session.seller?.vendorId) }) { listings in
                List {
                    Section {
                        NavigationLink(value: Route.newListing) {
                            Label(l.t("admin.newHeading"), systemImage: "plus.circle.fill")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Brand.navy)
                        }
                    }
                    Section(l.productCount(model.total)) {
                        if listings.isEmpty {
                            Text(l.t("browse.emptyCategory")).foregroundStyle(Brand.muted)
                        }
                        ForEach(listings) { listing in
                            ListingRow(listing: listing)
                        }
                    }
                    Section {
                        Text(l.t("ios.sell.portalNote")).font(.footnote).foregroundStyle(Brand.muted)
                    }
                }
            }
            .refreshable { await model.load(vendorId: app.session.seller?.vendorId) }
            .task { await model.load(vendorId: app.session.seller?.vendorId) }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.pearl.ignoresSafeArea())
        .navigationTitle(l.t("account.sectionSelling"))
    }
}

private struct ListingRow: View {
    let listing: SellerProduct
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(listing.displayTitle(l.current)).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink).lineLimit(2)
                HStack(spacing: 6) {
                    if let price = listing.price { Text(price.formatted(l.current)).font(.footnote) }
                    Text("·").foregroundStyle(Brand.muted)
                    Text(l.t("ios.sell.stock", ["count": "\(listing.stock)"])).font(.footnote).foregroundStyle(Brand.muted)
                }
                if let note = listing.reviewNote, !note.isEmpty {
                    Text(note).font(.caption).foregroundStyle(Brand.danger)
                }
            }
            Spacer()
            Text(l.t(listing.statusKey))
                .font(.caption.weight(.semibold))
                .foregroundStyle(listing.status == "published" ? Brand.success : Brand.navy)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Capsule().fill(Brand.tint))
        }
        .padding(.vertical, 4)
    }
}
