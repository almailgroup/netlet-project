import SwiftUI

/// The account searched, on the owner's word — the web's `AccountSearchResults`:
/// every place answering the words (`AccountSearch`, over `ACCOUNT_PLACES`),
/// each a row opening it and saying which page it is on; the quick settings,
/// the seller's door and signing out are drawn as the page draws them, since
/// each does its work in place. Nothing found is said, with no shop-wide
/// search: the shop does not sell a password.
struct AccountSearchResults: View {
    let term: String
    let has: (String) -> Bool
    let signOut: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    /// Where each place opens and the icon its row wears; a place not here is
    /// drawn as the page draws it (`quick`, `selling`, `signOut`).
    private static let opens: [String: (route: Route, symbol: String)] = [
        "orders": (.orders, "shippingbox"),
        "returns": (.returns, "arrow.uturn.backward"),
        "reviews": (.reviews, "star"),
        "saved": (.saved, "heart"),
        "wishlists": (.wishlists, "gift"),
        "frequent": (.frequent, "arrow.clockwise.circle"),
        "wallet": (.wallet, "wallet.pass"),
        "points": (.wallet, "dollarsign.circle"),
        "cards": (.wallet, "creditcard"),
        "notifications": (.notifications, "bell"),
        "profile": (.profile, "person.crop.circle"),
        "name": (.profile, "person"),
        "email": (.profile, "envelope"),
        "phone": (.profile, "phone"),
        "password": (.profile, "key"),
        "about": (.profile, "birthday.cake"),
        "photo": (.profile, "camera"),
        "deleteAccount": (.profile, "trash"),
        "addresses": (.addresses, "mappin.and.ellipse"),
        "offers": (.offers, "tag"),
        "subscriptions": (.subscriptions, "repeat"),
        "preferences": (.preferences, "slider.horizontal.3"),
        "noticeSettings": (.preferences, "bell.badge"),
        "deliveryArea": (.preferences, "mappin"),
        "storage": (.preferences, "internaldrive"),
        "haptics": (.preferences, "iphone.radiowaves.left.and.right"),
        "history": (.history, "clock.arrow.circlepath"),
        "help": (.helpCentre, "lifepreserver"),
        "affiliate": (.affiliate, "megaphone"),
    ]
    private static let quick: Set<String> = ["country", "currency", "language"]

    private var places: [AccountSearch.Place] {
        AccountSearch.matching(term, in: ReferenceData.shared.rules.accountRules.accountPlaces ?? [], has: has)
    }

    var body: some View {
        let found = places
        let rows = found.filter { Self.opens[$0.id] != nil }
        VStack(alignment: .leading, spacing: 12) {
            if found.isEmpty {
                PageSearchMissed(term: term, shopWide: false)
            }
            if !rows.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, place in
                        if index > 0 { DashedRule() }
                        row(place)
                    }
                }
                .padding(.horizontal, 20)
                .panel()
                .accessibilityElement(children: .contain)
                .accessibilityLabel(l.t("account.searchFound"))
            }
            if found.contains(where: { Self.quick.contains($0.id) }) {
                QuickSettingsCard()
            }
            if found.contains(where: { $0.id == "selling" }) {
                SellerEntryCard()
            }
            if found.contains(where: { $0.id == "signOut" }) {
                Button(action: signOut) {
                    HStack(spacing: 14) {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.system(size: 20))
                            .foregroundStyle(ProfileInk.signOutRed)
                            .frame(width: 26)
                            .accessibilityHidden(true)
                        Text(l.t("header.signOut"))
                            .font(.inter(16, .medium))
                            .foregroundStyle(Brand.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(minHeight: 64)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .padding(.horizontal, 20)
                .panel()
            }
        }
    }

    private func row(_ place: AccountSearch.Place) -> some View {
        let opens = Self.opens[place.id]
        return Button {
            if let route = opens?.route { app.push(route) }
        } label: {
            HStack(spacing: 14) {
                Image(systemName: opens?.symbol ?? "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(ProfileInk.icon)
                    .frame(width: 26)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t(place.label))
                        .font(.inter(16, .medium))
                        .foregroundStyle(Brand.ink)
                    if let within = place.within {
                        Text(l.t("search.within", ["place": l.t(within)]))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.forward")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Brand.ink)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 8)
            .frame(minHeight: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .accessibilityElement(children: .combine)
    }
}
