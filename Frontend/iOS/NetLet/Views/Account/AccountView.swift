import SwiftUI

/// The Account tab. Signed out it *is* the sign-in form, the web's rule for a
/// signed-out `/account`; while it asks who is signed in it is a quiet
/// placeholder, never "Sign in" to somebody who is.
///
/// Signed in it is the web's `AccountHome`, drawn the way the delivery apps
/// people here use draw theirs, on the owner's word (a picture of one): no
/// header — the page starts under the status bar — who is signed in with a
/// pencil to change it, four tiles (the last things ordered, saved and bought
/// often, and the points), the quick settings, every section as a row in white
/// cards, dashed lines between them, signing out red, still asking first, and
/// the seller's and the affiliate programme's cards at the foot — all on the
/// owner's word. Account security is not a row: the password and deleting the
/// account are on "Your profile", under the pencil.
struct AccountView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var confirmingSignOut = false
    /// The page's own search (`AccountSearch`), on the owner's word.
    @State private var term = ""

    // What the tiles and the rows draw is the app's (`AccountHome`), asked as
    // soon as the app knew who was signed in, so the tab opens on it.
    private var holdings: AccountHome.Holdings { app.accountHome.holdings }
    private var orderPhotos: [String]? { app.accountHome.orderPhotos }
    private var savedPhotos: [String]? { app.accountHome.savedPhotos }
    private var frequentPhotos: [String]? { app.accountHome.frequentPhotos }
    private var points: Int? { app.accountHome.points }
    /// The phone the driver calls, saved under Your profile — nil until asked.
    private var phone: String?? { app.accountHome.phone }

    var body: some View {
        switch app.session.state {
        case .unknown:
            LoadingView().background(Brand.ground.ignoresSafeArea())
        case .signedOut:
            AuthView()
        case .signedIn(let user):
            home(user)
        }
    }

    /// The cards of rows, top to bottom: what somebody shops with, and their
    /// settings. Signing out is not among them: it is a card of its own, the
    /// last thing on the page, under the seller's and the affiliate cards.
    ///
    /// **"Help from NetLet" and the affiliate programme are not rows, on the
    /// owner's word** — each was on the page twice. The help centre
    /// (`MoreFromNetLet`) has "Message NetLet", which opens the same
    /// conversation, and an answer from NetLet is a notice under the bell;
    /// the affiliate programme is the card above the rows, joining for
    /// somebody not in and opening the programme for a member.
    ///
    /// **Only the rows somebody needs, on the owner's word** — the web's
    /// `CARDS`. Returns and Payment methods joined the first card; Price
    /// requests and Subscribe & Save are rows only for somebody who has one
    /// (`holdings`). Frequently bought is a tile now, and the password and
    /// deleting the account are "Your profile"'s. **Returns and Reviews went
    /// to My orders, on the owner's word**, as tabs of its own.
    private static let cards: [[String]] = [
        ["addresses", "offers", "subscriptions"],
        // Browsing history, less prominent than the home's own shelf, on the owner's word.
        ["preferences", "history"],
    ]

    /// What the affiliate card offers: joining, or the programme itself.
    private enum AffiliateOffer { case join, open }

    /// Join for somebody the server says is not in; open for a member, or for
    /// somebody whose account the page keeps while the switch is off — a
    /// switch closes the door and never locks anybody in. Nothing until the
    /// server has answered, so it never says Join to a member.
    private var affiliateOffer: AffiliateOffer? {
        guard entries.contains(where: { $0.id == "affiliate" }) else { return nil }
        if !app.features.isOn("affiliates") || app.affiliateJoined == true { return .open }
        return app.affiliateJoined == false ? .join : nil
    }

    private func home(_ user: User) -> some View {
        ShopPage(root: true, header: false, refresh: { await app.session.restore(); await app.warmAccount(force: true) }) {
            VStack(alignment: .leading, spacing: 12) {
                topRow
                // The account searched, on the owner's word ("the search bar
                // should only search for what's in the specific page"): the
                // web's `PageSearchField`, finding a place on the account.
                PageSearchField(search: PageSearch(text: $term, placeholder: "search.inAccount"))
                if !SearchRank.queryWords(term).isEmpty {
                    AccountSearchResults(term: term, has: has) { confirmingSignOut = true }
                } else {
                profileCard(user)
                // Four tiles, two by two, above the quick settings, on the
                // owner's word — every one the height of the tallest: a title
                // that wraps ("Frequently bought" on a small phone, or at a
                // larger text size) makes its row no taller than the other,
                // and the pictures sit on one line at the foot — the web's
                // `auto-rows-fr`.
                TileGrid(spacing: 12) {
                    previewTile(
                        title: l.t("account.myOrders"),
                        photos: orderPhotos,
                        empty: l.t("orders.emptyTitle"),
                        waiting: app.signals.onTheWay > 0 ? l.t("header.onTheWay", ["count": "\(app.signals.onTheWay)"]) : nil
                    ) { app.push(.orders) }
                    previewTile(title: l.t("saved.andWishlists"), photos: savedPhotos, empty: l.t("saved.emptyTitle"), waiting: nil) {
                        app.push(.saved)
                    }
                    previewTile(title: l.t("frequent.section"), photos: frequentPhotos, empty: l.t("frequent.emptyTitle"), waiting: nil) {
                        app.push(.frequent)
                    }
                    pointsTile
                }
                // Country, currency and language on the page itself, on the owner's word.
                QuickSettingsCard()
                MembershipCard()
                ForEach(Array(Self.cards.enumerated()), id: \.offset) { _, ids in
                    let rows = ids.filter(onHome)
                    if !rows.isEmpty {
                        VStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element) { index, id in
                                if index > 0 { DashedRule() }
                                row(id)
                            }
                        }
                        .padding(.horizontal, 20)
                        .panel()
                    }
                }
                // What the footer carried: the help centre, the guides, the tutorial and the terms.
                MoreFromNetLet()
                // The seller portal's door, or Become a seller, and Affiliate
                // marketing — the web's cards — at the foot, on the owner's word.
                SellerEntryCard()
                if let offer = affiliateOffer {
                    affiliatePromo(offer)
                }
                // Signing out is the page's last thing, on the owner's word
                // ("the sign out option should be at the last, bottom"): a card
                // of its own under the seller's and the affiliate cards.
                row("signout")
                    .padding(.horizontal, 20)
                    .panel()
                }
                // Who the shop is, under everything, on the owner's word.
                ShopCopyright()
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // Drawn from what the app already holds, and asked again behind it
        // when that is more than `AccountHome.freshFor` old.
        .task { await app.warmAccount() }
        .onChange(of: app.saved.ids) { Task { await app.accountHome.reloadSaved(ids: app.saved.ids, language: l.current) } }
        // Signing out asks first; the confirm button carries the verb and Cancel is the safe answer.
        .confirmationDialog(l.t("account.signOutTitle"), isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button(l.t("header.signOut"), role: .destructive) {
                Task { await app.signOut() }
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("account.signOutBody"))
        }
    }

    /// Who is signed in: the profile photo or the default avatar,
    /// the name as typed, the email, and a pencil to change them.
    /// The page's name, and the notifications in its end corner, on the
    /// owner's word — the bell replaced the Notifications row, with what is
    /// unread counted on it (`CountBadge`), the header's own bell.
    private var topRow: some View {
        let unread = app.signals.unreadNotices
        return HStack(spacing: 12) {
            Text(l.t("account.yourWay"))
                .font(.inter(24, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            Button {
                app.push(.notifications)
            } label: {
                Image(systemName: "bell")
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 44, height: 44)
                    .liquidGlass(.frost, in: Circle())
                    .overlay(alignment: .topTrailing) {
                        CountBadge(value: unread).fixedSize().offset(x: 4, y: -2)
                    }
                    .contentShape(Circle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 22, strength: Haptics.actionStrength))
            .accessibilityLabel(l.t("notices.menu"))
            .accessibilityValue(unread == 0 ? "" : l.t("header.unreadCount", ["count": "\(unread)"]))
        }
        .padding(.top, 4)
    }

    private func profileCard(_ user: User) -> some View {
        HStack(spacing: 16) {
            // The photo the shopper chose, or the default avatar (`ProfileAvatar`).
            ProfileAvatar(size: 64)
            VStack(alignment: .leading, spacing: 2) {
                Text(AccountName.name(user, l))
                    .font(.inter(18, .bold))
                    .foregroundStyle(Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
                // The email, or for an account made with a phone, the number.
                Text("\u{2066}\(user.email ?? user.phone.map(AccountView.shownPhone) ?? "")\u{2069}")
                    .font(.inter(14))
                    .foregroundStyle(Brand.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                // The phone the driver calls, or a way to add one — the web's card.
                if let saved = phone {
                    if let number = saved, !number.isEmpty {
                        Text("\u{2066}\(Self.shownPhone(number))\u{2069}")
                            .font(.inter(14))
                            .foregroundStyle(Brand.muted)
                            .lineLimit(1)
                    } else {
                        Button(l.t("account.addPhone")) { app.push(.profile) }
                            .font(.inter(14, .semibold))
                            .foregroundStyle(Brand.navy)
                            .underline()
                            .frame(minHeight: 32)
                            .buttonStyle(.tap)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                app.push(.profile)
            } label: {
                Image(systemName: "pencil")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 48, height: 48)
                    .overlay(Circle().strokeBorder(Brand.navy.opacity(0.7), lineWidth: 2))
                    .contentShape(Circle())
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("account.editDetails"))
        }
        .padding(16)
        .panel()
    }

    /// `+965 5012 3456`: the stored `+965` and eight digits, read in two fours
    /// (`formatPhone`); anything else as it was saved.
    static func shownPhone(_ stored: String) -> String {
        let local = stored.hasPrefix("+965") ? String(stored.dropFirst(4)) : stored
        guard local.count == 8, local.allSatisfy({ ("0"..."9").contains($0) }) else { return stored }
        return "+965 \(local.prefix(4)) \(local.suffix(4))"
    }

    /// A tile with a title and the last few pictures of what is in it, or a
    /// line saying there is nothing yet.
    private func previewTile(title: String, photos: [String]?, empty: String, waiting: String?, open: @escaping () -> Void) -> some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    TileTitle(text: title)
                    if let waiting {
                        Text(waiting)
                            .font(.inter(11, .bold))
                            .foregroundStyle(Brand.navy)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(Brand.orange))
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 12)
                GeometryReader { box in
                    let width = box.size.width * 0.29
                    Group {
                        if let photos, !photos.isEmpty {
                            // Overlapping a little, the reference's stack; an
                            // HStack, so the Arabic page runs it from its own side.
                            HStack(spacing: -box.size.width * 0.053) {
                                ForEach(Array(photos.prefix(4).enumerated()), id: \.offset) { _, photo in
                                    RemoteImage(reference: photo, contentMode: .fit)
                                        .frame(width: width, height: width * 4 / 3)
                                        .background(Brand.photo)
                                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.white, lineWidth: 2))
                                }
                            }
                        } else if photos == nil {
                            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(ProfileInk.chip)
                                .frame(height: width * 4 / 3)
                        } else {
                            Text(empty)
                                .font(.inter(13))
                                .foregroundStyle(Brand.muted)
                                .padding(.horizontal, 12)
                                .frame(maxWidth: .infinity, minHeight: width * 4 / 3, alignment: .leading)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.photo))
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .aspectRatio(2.6, contentMode: .fit)
                .accessibilityHidden(true)
            }
            .padding(14)
            // As tall as the tallest tile, its picture at the foot.
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .panel()
            .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 24))
        .accessibilityLabel(waiting.map { "\(title), \($0)" } ?? title)
    }

    /// The Wallet as a tile beside Frequently bought, on the owner's word
    /// ("instead of NetLet points … rename it to wallet") — the coin, the
    /// words "NetLet points" and the balance where the other tiles have their
    /// pictures. It opens the Wallet, which holds the saved cards too.
    private var pointsTile: some View {
        Button {
            app.push(.wallet)
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                TileTitle(text: l.t("account.wallet"))
                Spacer(minLength: 12)
                GeometryReader { box in
                    // What it counts is a small line over the figure: "1,200
                    // points" on one line broke onto two in a tile.
                    HStack(spacing: 10) {
                        PointsCoin(size: 32)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(l.t("account.points"))
                                .font(.inter(12, .semibold))
                                .foregroundStyle(ProfileInk.pointsWords)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            Text(points.map { PointsFormat.count($0, l.current) } ?? "—")
                                .font(.inter(22, .heavy))
                                .foregroundStyle(Brand.navy)
                                .monospacedDigit()
                                .lineLimit(1)
                                .minimumScaleFactor(0.6)
                        }
                    }
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, minHeight: box.size.width * 0.29 * 4 / 3, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(ProfileInk.pointsGround))
                }
                .aspectRatio(2.6, contentMode: .fit)
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .panel()
            .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 24))
        .accessibilityLabel("\(l.t("account.wallet")), \(points.map { l.t("rewards.balance", ["points": PointsFormat.count($0, l.current)]) } ?? "")")
    }

    private func affiliatePromo(_ offer: AffiliateOffer) -> some View {
        Button { app.push(.affiliate) } label: {
            HStack(spacing: 14) {
                Image(systemName: "megaphone")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color(red: 1, green: 0.671, blue: 0.522))
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(Color.white.opacity(0.1)))
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t("affiliate.section")).font(.inter(16, .bold)).foregroundStyle(.white)
                    Text(l.t(offer == .join ? "affiliate.promoBody" : "affiliate.promoMemberBody"))
                        .font(.inter(13))
                        .foregroundStyle(Color(red: 214 / 255, green: 222 / 255, blue: 234 / 255))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(l.t(offer == .join ? "affiliate.promoJoin" : "affiliate.promoOpen"))
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(Color.white))
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Brand.navy))
            .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(.tap)
    }

    @ViewBuilder
    private func row(_ id: String) -> some View {
        switch id {
        case "signout":
            Button {
                confirmingSignOut = true
            } label: {
                rowLabel(symbol: "rectangle.portrait.and.arrow.right", title: l.t("header.signOut"), waiting: nil, iconColour: ProfileInk.signOutRed)
            }
            .buttonStyle(.tap)
        default:
            if let entry = AccountEntry.all.first(where: { $0.id == id }) {
                Button {
                    open(entry)
                } label: {
                    rowLabel(symbol: entry.symbol, title: l.t(entry.label), waiting: badge(entry), iconColour: ProfileInk.icon,
                             value: nil)
                }
                .buttonStyle(.tap)
            }
        }
    }

    private func rowIcon(_ symbol: String, colour: Color = ProfileInk.icon) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 20))
            .foregroundStyle(colour)
            .frame(width: 26)
            .accessibilityHidden(true)
    }

    private func rowLabel(symbol: String, title: String, waiting: String?, iconColour: Color, value: String? = nil) -> some View {
        HStack(spacing: 14) {
            rowIcon(symbol, colour: iconColour)
            Text(title)
                .font(.inter(16, .medium))
                .foregroundStyle(Brand.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let waiting {
                Text(waiting)
                    .font(.inter(12, .bold))
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Brand.orange))
            }
            if let value {
                Text(value)
                    .font(.inter(14))
                    .foregroundStyle(Brand.muted)
                    .lineLimit(1)
            }
            Image(systemName: "chevron.forward")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Brand.ink)
        }
        .frame(minHeight: 64)
        .contentShape(Rectangle())
    }

    /// The sections this account has — the web's rule: selling only for
    /// somebody in a store, and Subscribe & Save and the affiliate programme
    /// while they are switched on or the shopper already holds one, because a
    /// switch closes the door and never hides what somebody already has.
    private var entries: [AccountEntry] {
        AccountEntry.all.filter { entry in
            switch entry.id {
            case "selling": return app.session.seller?.inPortal == true
            case "subscriptions": return app.features.isOn("subscriptions") || holdings.subscriptions
            case "affiliate": return app.features.isOn("affiliates") || holdings.affiliate
            default: return true
            }
        }
    }

    /// Whether the home draws a row: the account has the section, and for
    /// Price requests and Subscribe & Save, the shopper has one — for anybody
    /// else they open an empty page. Their screens stay open to a link.
    private func onHome(_ id: String) -> Bool {
        guard entries.contains(where: { $0.id == id }) else { return false }
        switch id {
        case "offers": return holdings.offers
        case "subscriptions": return holdings.subscriptions
        default: return true
        }
    }

    /// Whether a place the search can find is this account's (`needs` in
    /// `ACCOUNT_PLACES`): the web's `has`. Frequently bought and the haptics
    /// switch are every account's in the app.
    private func has(_ part: String) -> Bool {
        switch part {
        case "offers": return holdings.offers
        case "frequent", "haptics": return true
        default: return entries.contains { $0.id == part }
        }
    }

    /// What is waiting, said on the row (`useAccountSignals`).
    private func badge(_ entry: AccountEntry) -> String? {
        let signals = app.signals
        switch entry.id {
        case "orders" where signals.onTheWay > 0: return l.t("header.onTheWay", ["count": "\(signals.onTheWay)"])
        case "notifications" where signals.unreadNotices > 0: return l.t("header.unreadCount", ["count": "\(signals.unreadNotices)"])
        default: return nil
        }
    }

    /// Every section is a screen of the app's own.
    private func open(_ entry: AccountEntry) {
        if let route = entry.route { app.push(route) }
    }
}

/// The reference's greys: a pale chip behind the switch, a
/// slate for the row icons, and the red of the way out. An enum of its own
/// rather than statics on the view, so a default argument can name one —
/// Swift 5 evaluates those outside the main actor.
enum ProfileInk {
    static let chip = Color(red: 241 / 255, green: 242 / 255, blue: 246 / 255)
    static let icon = Color(red: 93 / 255, green: 107 / 255, blue: 130 / 255)
    static let signOutRed = Color(red: 194 / 255, green: 54 / 255, blue: 42 / 255)
    /// The points tile's warm ground behind the coin, the web's `#fff6ef`.
    static let pointsGround = Color(red: 1, green: 246 / 255, blue: 239 / 255)
    /// "NetLet points" over the figure on that ground, the web's `#7a4a2e`.
    static let pointsWords = Color(red: 122 / 255, green: 74 / 255, blue: 46 / 255)
}

/// The dashed line between two rows of a card, inset as the reference draws it.
struct DashedRule: View {
    var body: some View {
        Line()
            .stroke(Color(red: 227 / 255, green: 230 / 255, blue: 236 / 255), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
            .frame(height: 1)
            .accessibilityHidden(true)
    }

    private struct Line: Shape {
        func path(in rect: CGRect) -> Path {
            Path { path in
                path.move(to: CGPoint(x: rect.minX, y: rect.midY))
                path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
            }
        }
    }
}

extension View {
    /// A white card of the profile page: 24 round, a whisper of shadow, no rim.
    func panel() -> some View {
        // The shadow is the card's shape's, not the whole card's.
        background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.white)
                .shadow(color: Brand.navy.opacity(0.05), radius: 1, y: 1)
        )
    }
}

/// How an account is named on its own pages: the name as typed, or a line
/// saying there is none. The circle beside it is the photo or the default
/// avatar (`DefaultAvatar`), never the initials, on the owner's word.
enum AccountName {
    @MainActor static func name(_ user: User, _ l: LanguageSettings) -> String {
        user.name?.trimmingCharacters(in: .whitespaces).isEmpty == false ? user.name! : l.t("account.noName")
    }
}

/// The account's sections, in the web's order and groups (`ENTRIES` in `Account.tsx`).
struct AccountEntry: Identifiable, Hashable {
    let id: String
    let label: String
    let hint: String
    let symbol: String
    let group: String

    static let groups = ["account.groupShopping", "account.groupConversations", "account.groupRewards", "account.groupSettings"]

    static let all: [AccountEntry] = [
        AccountEntry(id: "orders", label: "account.sectionOrders", hint: "account.hint.orders", symbol: "shippingbox", group: "account.groupShopping"),
        AccountEntry(id: "returns", label: "account.sectionReturns", hint: "account.hint.returns", symbol: "arrow.uturn.backward", group: "account.groupShopping"),
        AccountEntry(id: "frequent", label: "frequent.section", hint: "account.hint.frequent", symbol: "arrow.clockwise.circle", group: "account.groupShopping"),
        AccountEntry(id: "subscriptions", label: "subscriptions.section", hint: "account.hint.subscriptions", symbol: "repeat", group: "account.groupShopping"),
        AccountEntry(id: "saved", label: "saved.andWishlists", hint: "account.hint.saved", symbol: "heart", group: "account.groupShopping"),
        AccountEntry(id: "wishlists", label: "account.sectionWishlists", hint: "account.hint.wishlists", symbol: "gift", group: "account.groupShopping"),
        AccountEntry(id: "offers", label: "offers.mine", hint: "account.hint.offers", symbol: "tag", group: "account.groupShopping"),
        AccountEntry(id: "reviews", label: "account.sectionReviews", hint: "account.hint.reviews", symbol: "star", group: "account.groupShopping"),
        AccountEntry(id: "notifications", label: "notices.title", hint: "notices.tile", symbol: "bell", group: "account.groupConversations"),
        AccountEntry(id: "help", label: "support.section", hint: "account.hint.help", symbol: "lifepreserver", group: "account.groupConversations"),
        AccountEntry(id: "wallet", label: "account.wallet", hint: "account.hint.wallet", symbol: "wallet.pass", group: "account.groupRewards"),
        AccountEntry(id: "affiliate", label: "affiliate.section", hint: "account.hint.affiliate", symbol: "megaphone", group: "account.groupRewards"),
        AccountEntry(id: "details", label: "account.sectionProfile", hint: "account.hint.details", symbol: "person.crop.circle", group: "account.groupSettings"),
        AccountEntry(id: "addresses", label: "address.book", hint: "account.hint.addresses", symbol: "mappin.and.ellipse", group: "account.groupSettings"),
        AccountEntry(id: "preferences", label: "account.sectionPreferences", hint: "account.hint.preferences", symbol: "slider.horizontal.3", group: "account.groupSettings"),
        AccountEntry(id: "selling", label: "account.sectionSelling", hint: "account.hint.selling", symbol: "storefront", group: "account.groupSettings"),
        AccountEntry(id: "history", label: "history.title", hint: "account.hint.history", symbol: "clock.arrow.circlepath", group: "account.groupSettings"),
    ]

    /// The screen the tile opens.
    var route: Route? {
        switch id {
        case "orders": return .orders
        case "returns": return .returns
        case "frequent": return .frequent
        case "subscriptions": return .subscriptions
        case "saved": return .saved
        case "wishlists": return .wishlists
        case "offers": return .offers
        case "reviews": return .reviews
        case "notifications": return .notifications
        case "help": return .help
        case "wallet": return .wallet
        case "affiliate": return .affiliate
        case "details": return .profile
        case "addresses": return .addresses
        case "preferences": return .preferences
        case "history": return .history
        case "selling": return .portal("/admin")
        default: return nil
        }
    }
}

/// "Your profile", compact on the owner's word ("make it very compact and
/// simple, it should list your details by default and you can edit them"): a
/// round back button beside the title, then one card listing the photo, the
/// name, the sign-in email, the phone, the gender, the birthday and the
/// password, each with its value and an Edit (`ProfileForm`); Face ID and
/// deleting the account (folded to one row) follow. **Account security is
/// this page now, on the owner's word**: the password, the code for a
/// forgotten one and deleting the account are here.
struct ProfileView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { ProfileViewModel(account: app.services.account, user: app.session.user) }) { model in
            ScrollViewReader { proxy in
            ShopPage(header: false) {
                VStack(alignment: .leading, spacing: 16) {
                    RoundBackTitle(title: l.t("account.sectionProfile"))
                    ProfileForm(model: model)
                    // Face ID beside the password: another way to sign in,
                    // and "Set up again" for a face added since.
                    if let email = app.session.user?.email {
                        FaceIDCard(email: email)
                            .padding(.bottom, -16)
                            .id("faceId")
                    }
                    DeleteAccountCard()
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            // The screenshots' `-NetLetOpen faceIdCard` (Debug only).
            .task(id: app.profileScrollTo) {
                guard let target = app.profileScrollTo else { return }
                try? await Task.sleep(for: .milliseconds(700))
                app.profileScrollTo = nil
                proxy.scrollTo(target, anchor: .top)
            }
            }
            .task {
                async let photo: Void = app.profilePhoto.load()
                await model.load()
                await photo
            }
        }
    }
}

/// A page's round way back beside its title — "Your profile" — one screen
/// back to wherever it was opened from.
struct RoundBackTitle: View {
    let title: String
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        HStack(spacing: 14) {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.backward")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 44, height: 44)
                    .liquidGlass(.frost, in: Circle(), lifted: true)
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("account.backToAccount"))
            Text(title)
                .font(.inter(22, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.bottom, 4)
    }
}

/// "Your profile"'s one list, the web's `ProfileManager` row for row: the
/// photo with the name beside it, then each detail with its value — or "Not
/// added" — and an Edit at the row's end. Pressing Edit opens that row's own
/// form in its place, and only one row is open at a time; Save or Cancel
/// closes it again. Each row is its own decision with its own Save, because
/// one Save across them would change a password somebody only opened the page
/// to fix a spelling in. **The rows run from what the account needs to what
/// it may add, on the owner's word** ("put the name next to the profile photo
/// … the gender and birthday … one option that the user can expand … first
/// ones will be the necessary options"): the photo and the name, the email,
/// the phone, the password, and then the gender and the birthday as one row.
/// **The new password is typed twice, on the owner's word** ("put a type
/// password again for changing your password as a confirmation"), and the
/// current one asked for first.
private struct ProfileForm: View {
    @Bindable var model: ProfileViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var choosingBirthday = false
    /// "Forgot your current password?": a six-digit code to the account's own
    /// email, and the new password with it, in the password row (on the owner's word).
    @State private var recovering: Recovery = .idle
    /// How the account signs in: one made with Apple, Google or a phone has no
    /// password to change, and sets one by the same emailed code a forgotten
    /// one is.
    @State private var ways: AccountSignInWays?
    /// The one row open; nil is the list.
    @State private var editing: Row?
    /// A profile photo chosen and not yet saved, which the circle shows.
    @State private var chosenPhoto: ChosenProfilePhoto?
    /// VoiceOver's place: the open row's name, or the Edit it came from.
    @AccessibilityFocusState private var spoken: Row?

    private enum Recovery { case idle, sending, sent }
    private enum Row: Hashable { case name, email, phone, password, about }

    private var noPassword: Bool { ways?.password == false }

    var body: some View {
        VStack(spacing: 0) {
            identityRow
            DashedRule()
            emailRow
            DashedRule()
            row(.phone, label: "profile.phoneTitle", value: model.details.phone.map { "+965 " + PhoneNumber.display($0) }, leftToRight: true) { phoneEditor }
            if app.session.user?.email != nil {
                DashedRule()
                passwordRow
            }
            DashedRule()
            // Both optional, so one row after everything the account needs.
            row(.about, label: "profile.aboutTitle", value: nil, lines: [
                ("profile.genderTitle", model.details.gender.map { l.t($0 == "male" ? "profile.male" : "profile.female") }),
                ("profile.birthdayTitle", model.details.birthday.map { OrderWording.day($0, language: l.current) }),
            ]) { aboutEditor }
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        .task { if ways == nil { ways = try? await app.services.account.accountSignInWays() } }
    }

    private var fullName: String? {
        let joined = [model.savedFirst, model.savedLast].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
        return joined.isEmpty ? nil : joined
    }

    private func open(_ which: Row) {
        if let previous = editing { close(previous) }
        withAnimation(.snappy(duration: 0.22)) { editing = which }
        spoken = which
    }

    private func close(_ which: Row) {
        if let form = form(of: which) { model.cancel(form) }
        if which == .about { choosingBirthday = false }
        if which == .password { recovering = .idle }
        withAnimation(.snappy(duration: 0.22)) { if editing == which { editing = nil } }
        spoken = which
    }

    private func form(of row: Row) -> ProfileViewModel.Form? {
        switch row {
        case .name: return .name
        case .phone: return .phone
        case .about: return .about
        case .password: return .password
        case .email: return nil
        }
    }

    /// A saved row closes and says so, since the row it was typed in is gone.
    private func done(_ which: Row, _ key: String) {
        Haptics.succeeded()
        app.toast(l.t(key))
        withAnimation(.snappy(duration: 0.22)) { editing = nil }
        spoken = which
    }

    @ViewBuilder
    private func row<Editor: View>(
        _ which: Row,
        label: String,
        value: String?,
        action: String = "profile.edit",
        symbol: String = "pencil",
        leftToRight: Bool = false,
        readOnly: Bool = false,
        /// What VoiceOver says for the value, where the drawing is not words (the password's dots).
        spokenValue: String? = nil,
        /// Two details in one row, each its name and what is saved — the gender and the birthday.
        lines: [(label: String, value: String?)] = [],
        @ViewBuilder editor: () -> Editor
    ) -> some View {
        if editing == which {
            VStack(alignment: .leading, spacing: 12) {
                Text(l.t(label))
                    .font(.inter(15, .bold))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($spoken, equals: which)
                editor()
            }
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t(label))
                        .font(.inter(13, .medium))
                        .foregroundStyle(Brand.muted)
                    Group {
                        if lines.contains(where: { $0.value != nil }) {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(lines.indices, id: \.self) { index in
                                    let line = lines[index]
                                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                                        Text(l.t(line.label))
                                            .font(.inter(13, .medium))
                                            .foregroundStyle(Brand.muted)
                                        Text(line.value ?? l.t("profile.notAdded"))
                                            .font(.inter(15, line.value == nil ? .medium : .semibold))
                                            .foregroundStyle(line.value == nil ? Brand.muted : Brand.navy)
                                    }
                                }
                            }
                        } else if let value {
                            Text(verbatim: leftToRight ? "\u{2066}\(value)\u{2069}" : value)
                                .font(.inter(15, .semibold))
                                .foregroundStyle(Brand.navy)
                                .accessibilityLabel(Text(verbatim: spokenValue ?? value))
                        } else {
                            Text(l.t("profile.notAdded"))
                                .font(.inter(15, .medium))
                                .foregroundStyle(Brand.muted)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                if !readOnly {
                    Button { open(which) } label: {
                        Label(l.t(action), systemImage: symbol)
                            .font(.inter(14, .semibold))
                            .foregroundStyle(Brand.navy)
                            .padding(.horizontal, 10)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("profile.editField", ["field": l.t(label)]))
                    .accessibilityFocused($spoken, equals: which)
                }
            }
            .padding(.vertical, 10)
            .frame(minHeight: 64)
        }
    }

    /// Save and Cancel at the foot of an open row.
    private func buttons(_ which: Row, saving form: ProfileViewModel.Form?, save: (() async -> Void)?) -> some View {
        HStack(spacing: 10) {
            if let save, let form {
                Button {
                    Task { await save() }
                } label: {
                    if model.saving == form { ProgressView().tint(.white) } else { Text(l.t("account.saveChanges")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.saving != nil)
            }
            Button(l.t("common.cancel")) { close(which) }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(model.saving != nil)
        }
    }

    private var nameEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                FloatingField(label: l.t("profile.firstName"), text: $model.firstName, required: true, content: .givenName)
                FloatingField(label: l.t("profile.lastName"), text: $model.lastName, required: true, content: .familyName)
            }
            if let problem = model.problems[.name] {
                FieldProblem(key: problem)
            } else {
                note("profile.nameNote")
            }
            buttons(.name, saving: .name) {
                guard model.nameChanged else { close(.name); return }
                if let user = await model.saveName() {
                    app.session.updated(user)
                    done(.name, "account.nameSaved")
                }
            }
        }
    }

    @ViewBuilder
    private var emailRow: some View {
        if let user = app.session.user, let email = user.email {
            row(.email, label: "account.emailCard", value: email, leftToRight: true, readOnly: true) { EmptyView() }
        } else if let user = app.session.user {
            // An account made with a phone has no email yet: the row offers
            // one (by a code sent to it), and the password follows.
            row(.email, label: "account.emailCard", value: nil, action: "profile.add", symbol: "plus") {
                VStack(alignment: .leading, spacing: 12) {
                    AddEmailCard(phone: user.phone, bare: true) { updated in
                        app.session.updated(updated)
                        done(.email, "auth.addEmailDone")
                    }
                    buttons(.email, saving: nil, save: nil)
                }
            }
        }
    }

    private var phoneEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            FloatingField(label: l.t("profile.phoneLabel"), text: $model.phone, placeholder: l.t("wish.phonePlaceholder"),
                          keyboard: .phonePad, content: .telephoneNumber, leftToRight: true, prefix: "+965")
            if let problem = model.problems[.phone] { FieldProblem(key: problem) } else { note("profile.phoneNote") }
            buttons(.phone, saving: .phone) {
                guard model.phoneChanged else { close(.phone); return }
                await model.savePhone()
                if model.problems[.phone] == nil {
                    // The account home's card names the new number at once.
                    app.accountHome.setPhone(model.details.phone)
                    done(.phone, "profile.saved")
                }
            }
        }
    }

    /// The gender and the birthday, chosen together and sent with one Save,
    /// on the owner's word — the web's `AboutEditor`. A gender pressed is a
    /// choice here, not a save; pressing it again takes it away.
    private var aboutEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("profile.genderTitle"))
                .font(.inter(13, .medium))
                .foregroundStyle(Brand.muted)
            HStack(spacing: 12) {
                ForEach(ProfileDetails.genders, id: \.self) { gender in
                    genderTile(gender)
                }
            }
            note("profile.genderNote")
            birthdayBox
                .padding(.top, 6)
            if let problem = model.problems[.about] { FieldProblem(key: problem) } else { note("profile.birthdayNote") }
            buttons(.about, saving: .about) {
                guard model.aboutChanged else { close(.about); return }
                await model.saveAbout()
                if model.problems[.about] == nil { choosingBirthday = false; done(.about, "profile.saved") }
            }
            if !model.birthday.isEmpty {
                Button(l.t("profile.birthdayRemove")) {
                    choosingBirthday = false
                    model.birthday = ""
                }
                .buttonStyle(.tap)
                .font(.inter(14, .bold))
                .foregroundStyle(Brand.danger)
                .frame(minHeight: 44)
                .disabled(model.saving != nil)
            }
        }
    }

    /// The first row: the circle with the name beside it, on the owner's word
    /// ("put the name next to the profile photo, not below it") — the web's
    /// `ProfileIdentity`. The photo's presses sit under the name; the name's
    /// Edit at the row's end, and pressed, the name's form is the row's foot
    /// while the circle and the name stay where they were.
    private var identityRow: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                ProfileAvatar(size: 64, preview: chosenPhoto?.image)
                VStack(alignment: .leading, spacing: 8) {
                    Group {
                        if let fullName {
                            Text(fullName)
                                .font(.inter(18, .bold))
                                .foregroundStyle(Brand.navy)
                        } else {
                            Text(l.t("profile.notAdded"))
                                .font(.inter(16, .medium))
                                .foregroundStyle(Brand.muted)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("\(l.t("profile.nameTitle")), \(fullName ?? l.t("profile.notAdded"))")
                    if editing != .name {
                        ProfilePhotoControls(chosen: $chosenPhoto)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                if editing != .name {
                    Button { open(.name) } label: {
                        Label(l.t(fullName == nil ? "profile.add" : "profile.edit"), systemImage: "pencil")
                            .font(.inter(14, .semibold))
                            .foregroundStyle(Brand.navy)
                            .padding(.horizontal, 10)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("profile.editField", ["field": l.t("profile.nameTitle")]))
                    .accessibilityFocused($spoken, equals: .name)
                }
            }
            if editing == .name {
                Text(l.t("profile.nameTitle"))
                    .font(.inter(15, .bold))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused($spoken, equals: .name)
                nameEditor
            }
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var passwordRow: some View {
        if noPassword {
            row(.password, label: "account.password", value: nil, action: "account.setPassword", symbol: "key") { passwordEditor }
        } else {
            row(.password, label: "account.password", value: "••••••••", action: "profile.change", symbol: "key", spokenValue: l.t("profile.passwordIsSet")) { passwordEditor }
        }
    }

    private var passwordEditor: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let user = app.session.user, recovering == .sent {
                Text(l.t("account.recoverSent", ["email": "\u{2068}\(user.email ?? "")\u{2069}"]))
                    .font(.inter(14))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                ResetByCodeFields(email: user.email ?? "", signedIn: { signed in
                    app.session.updated(signed)
                    ways = try? await app.services.account.accountSignInWays()
                    done(.password, "account.passwordChanged")
                    recovering = .idle
                })
                buttons(.password, saving: nil, save: nil)
            } else if noPassword {
                note(ways?.apple == true ? "account.passwordAppleNote" : ways?.google == true ? "account.passwordGoogleNote" : "account.passwordPhoneNote")
                Button {
                    Task { await sendCode(to: app.session.user?.email ?? "") }
                } label: {
                    if recovering == .sending { ProgressView().tint(.white) } else { Text(l.t("auth.sendSignInCode")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(recovering == .sending)
                buttons(.password, saving: nil, save: nil)
            } else {
                FloatingField(label: l.t("account.currentPassword"), text: $model.currentPassword, content: .password, secure: true, leftToRight: true)
                FloatingField(label: l.t("account.newPassword"), text: $model.newPassword, content: .newPassword, secure: true, leftToRight: true)
                PasswordMeter(password: model.newPassword)
                FloatingField(label: l.t("auth.passwordAgainLabel"), text: $model.newPasswordAgain, content: .newPassword, secure: true, leftToRight: true)
                FieldProblem(key: model.problems[.password])
                note("account.passwordNote")
                Button {
                    Task { await sendCode(to: app.session.user?.email ?? "") }
                } label: {
                    HStack(spacing: 8) {
                        if recovering == .sending { ProgressView().tint(Brand.navy) }
                        Text(l.t("account.forgotCurrent"))
                    }
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                    .underline()
                    .frame(minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.tap)
                .disabled(recovering == .sending)
                buttons(.password, saving: .password) {
                    if await model.savePassword() { done(.password, "account.passwordChanged") }
                }
            }
        }
    }

    private func note(_ key: String) -> some View {
        Text(l.t(key))
            .font(.inter(13))
            .foregroundStyle(Brand.muted)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func sendCode(to email: String) async {
        recovering = .sending
        do {
            try await app.services.account.requestPasswordReset(email: email)
            recovering = .sent
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            recovering = .idle
            if failure != .cancelled { app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has))) }
        }
    }

    private func genderTile(_ gender: String) -> some View {
        let chosen = model.gender == gender
        return Button {
            model.pick(gender: gender)
        } label: {
            HStack(spacing: 12) {
                Text(l.t(gender == "male" ? "profile.male" : "profile.female"))
                    .font(.inter(15, .semibold))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Spacer(minLength: 0)
                ZStack {
                    Circle().strokeBorder(chosen ? Brand.navy : Brand.chevron, lineWidth: 2).frame(width: 20, height: 20)
                    if chosen { Circle().fill(Brand.navy).frame(width: 10, height: 10) }
                }
                .accessibilityHidden(true)
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(chosen ? Brand.tint : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(chosen ? Brand.navy : Brand.line, lineWidth: chosen ? 1.5 : 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle())
        .disabled(model.saving != nil)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    /// The date in a box like the others, the label inside its rim; pressed,
    /// a wheel opens under it to choose one, and nothing is saved until Save.
    private var birthdayBox: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                if model.birthday.isEmpty { model.birthday = BirthdayDay.string(BirthdayDay.date("1995-01-01")) }
                choosingBirthday.toggle()
            } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.t("profile.birthdayLabel"))
                            .font(.inter(12, .medium))
                            .foregroundStyle(Brand.muted)
                        Text(model.birthday.isEmpty ? l.t("ios.profile.chooseDate") : OrderWording.day(model.birthday, language: l.current))
                            .font(.inter(16, .medium))
                            .foregroundStyle(model.birthday.isEmpty ? Brand.muted : Brand.ink)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "calendar")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(Brand.navy)
                        .accessibilityHidden(true)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(model.problems[.about] != nil ? Brand.danger : choosingBirthday ? Brand.navy : Brand.line,
                                      lineWidth: model.problems[.about] != nil || choosingBirthday ? 1.5 : 1)
                )
                .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.tap)
            .accessibilityHint(l.t("ios.profile.chooseDate"))
            if choosingBirthday {
                DatePicker(
                    l.t("profile.birthdayLabel"),
                    selection: Binding(
                        get: { BirthdayDay.date(model.birthday.isEmpty ? "1995-01-01" : model.birthday) },
                        set: { model.birthday = BirthdayDay.string($0) }
                    ),
                    in: BirthdayDay.date(ReferenceData.shared.rules.profileRules.earliestBirthday)...BirthdayDay.date(StoreRules.kuwaitDay(Date())),
                    displayedComponents: .date
                )
                .datePickerStyle(.wheel)
                .labelsHidden()
                .frame(maxWidth: .infinity)
                .environment(\.locale, l.current.locale)
                .environment(\.timeZone, BirthdayDay.zone)
                .environment(\.calendar, Calendar(identifier: .gregorian))
            }
        }
    }

}

/// A birthday as the server keeps it, `yyyy-mm-dd`, and as a date picker
/// holds it — noon in Kuwait, so no time zone can move it a day.
private enum BirthdayDay {
    static let zone = TimeZone(identifier: "Asia/Kuwait")!

    static func date(_ day: String) -> Date {
        let reader = DateFormatter()
        reader.calendar = Calendar(identifier: .gregorian)
        reader.locale = Locale(identifier: "en_US_POSIX")
        reader.timeZone = zone
        reader.dateFormat = "yyyy-MM-dd HH:mm"
        return reader.date(from: day + " 12:00") ?? Date()
    }

    static func string(_ date: Date) -> String { StoreRules.kuwaitDay(date) }
}

/// A country by the phone's own name for it, in the page's language — the
/// web's `Intl.DisplayNames` — so Quick settings needs no words of its own.
enum CountryNames {
    static func name(_ code: String, language: Language) -> String {
        language.locale.localizedString(forRegionCode: code) ?? code
    }
}

/// A member's card on the account's front page — the web's `MembershipCard`:
/// until when, and what it gives. Drawn only for a member, since nobody can
/// buy one yet and an offer of one would be an advert for nothing.
struct MembershipCard: View {
    @State private var membership: MyMembership?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let membership, membership.member, let until = membership.until {
                VStack(alignment: .leading, spacing: 8) {
                    Label(l.t("membership.cardTitle"), systemImage: "checkmark.seal.fill")
                        .font(.inter(16, .heavy))
                        .foregroundStyle(Brand.navy)
                        .accessibilityAddTraits(.isHeader)
                    Text(l.t("membership.until", ["date": OrderWording.date(until, language: l.current)]))
                        .font(.inter(13, .semibold))
                        .foregroundStyle(Brand.muted)
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(benefits(membership), id: \.self) { line in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text("•").foregroundStyle(Brand.navy.opacity(0.4)).accessibilityHidden(true)
                                Text(line).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(.top, 4)
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(red: 231 / 255, green: 237 / 255, blue: 245 / 255)))
                .padding(.top, 16)
            }
        }
        .task { membership = try? await app.services.api.call(API.myMembership) }
    }

    private func benefits(_ membership: MyMembership) -> [String] {
        let delivery = membership.freeDeliveryOver.flatMap(Money.parseFils).map {
            l.t("membership.benefitDeliveryOver", ["amount": Money(fils: $0).formatted(l.current)])
        } ?? l.t("membership.benefitDelivery")
        return [delivery, l.t("membership.benefitPrices"), l.t("membership.benefitPriority")]
    }
}

/// A tile's title on the account home: up to two lines rather than shrunk to
/// nothing, since the tiles are made one height whatever wraps.
private struct TileTitle: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.inter(16, .bold))
            .foregroundStyle(Brand.navy)
            .lineLimit(2)
            .minimumScaleFactor(0.9)
            .fixedSize(horizontal: false, vertical: true)
    }
}
