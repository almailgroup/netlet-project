import SwiftUI

/// The Account tab. Signed out it *is* the sign-in form, the web's rule for a
/// signed-out `/account`; while it asks who is signed in it is a quiet
/// placeholder, never "Sign in" to somebody who is.
///
/// Signed in it is the web's `AccountHome`, drawn the way the delivery apps
/// people here use draw theirs, on the owner's word (a picture of one): no
/// header — the page starts under the status bar — who is signed in with a
/// pencil to change it, two tiles of the last things ordered and saved, the
/// points, then every section as a row in white cards, dashed lines between
/// them — the language and the currency inside Preferences, whose row names
/// both — and signing out red at the foot, still asking first. The dates and the role moved to "Your
/// details" (`AccountIdentityCard`), where somebody checking their account looks.
struct AccountView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var confirmingSignOut = false
    /// Whether the shopper holds a standing order, a price request or an
    /// affiliate account — what decides whether those rows are drawn.
    @State private var holdings = Holdings()
    @State private var orderPhotos: [String]?
    @State private var savedPhotos: [String]?
    @State private var points: Int?
    /// The phone the driver calls, saved under Your profile — nil until asked.
    @State private var phone: String??

    struct Holdings {
        var subscriptions = false
        var offers = false
        var affiliate = false
    }

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

    /// The cards of rows, top to bottom: what somebody shops with, their
    /// settings, what they run, and the account itself. "signout" is the one
    /// row that is not a section.
    ///
    /// **"Help from NetLet" and the affiliate programme are not rows, on the
    /// owner's word** — each was on the page twice. The help centre
    /// (`MoreFromNetLet`) has "Message NetLet", which opens the same
    /// conversation, and an answer from NetLet is a notice under the bell;
    /// the affiliate programme is the card above the rows, joining for
    /// somebody not in and opening the programme for a member.
    ///
    /// **Only the rows somebody needs, on the owner's word** — the web's
    /// `CARDS`. Returns and Payment methods joined the first card; the
    /// language and the currency are inside Preferences, whose row names
    /// both; Price requests and Subscribe & Save are rows only for somebody
    /// who has one (`holdings`).
    private static let cards: [[String]] = [
        ["frequent", "returns", "addresses", "payments", "wishlists", "reviews", "offers", "subscriptions"],
        // Browsing history, less prominent than the home's own shelf, on the owner's word.
        ["preferences", "history"],
        ["security", "signout"],
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
        ShopPage(root: true, header: false, refresh: { await app.session.restore(); await loadPreviews() }) {
            VStack(alignment: .leading, spacing: 12) {
                topRow
                profileCard(user)
                // Country, currency and language on the page itself, on the owner's word.
                QuickSettingsCard()
                MembershipCard()
                HStack(alignment: .top, spacing: 12) {
                    previewTile(
                        title: l.t("account.myOrders"),
                        photos: orderPhotos,
                        empty: l.t("orders.emptyTitle"),
                        waiting: app.signals.onTheWay > 0 ? l.t("header.onTheWay", ["count": "\(app.signals.onTheWay)"]) : nil
                    ) { app.push(.orders) }
                    previewTile(title: l.t("footer.savedItems"), photos: savedPhotos, empty: l.t("saved.emptyTitle"), waiting: nil) {
                        app.push(.saved)
                    }
                }
                pointsRow
                // Affiliate marketing, on the owner's word — the web's card,
                // and the programme's only way in on this page.
                if let offer = affiliateOffer {
                    affiliatePromo(offer)
                }
                // The seller portal's door, or Become a seller, on the owner's word.
                SellerEntryCard()
                ForEach(Array(Self.cards.enumerated()), id: \.offset) { index, ids in
                    let rows = ids.filter(onHome)
                    if index == Self.cards.count - 1 {
                        // What the footer carried, before the account's own
                        // card, so signing out stays the last thing on the page.
                        MoreFromNetLet()
                    }
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
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task {
            await app.signals.refresh()
            async let photo: Void = app.profilePhoto.load()
            await loadPreviews()
            await photo
            holdings.subscriptions = !((try? await app.services.api.call(API.standingOrders)) ?? []).isEmpty
            holdings.offers = !((try? await app.services.api.call(API.priceRequests)) ?? []).isEmpty
            if !app.features.isOn("affiliates") {
                holdings.affiliate = ((try? await app.services.api.call(API.affiliate)) ?? nil) != nil
            }
        }
        .onChange(of: app.saved.ids) { Task { await loadSaved() } }
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

    /// The pictures on the two tiles and the points: the newest orders'
    /// photos (`orders.list`), the first saved hearts (`commerce.products.byIds`).
    private func loadPreviews() async {
        let api = app.services.api
        async let orders = try? api.call(API.orders, .init(page: 1, pageSize: 4))
        async let rewards = try? api.call(API.rewards)
        async let details = try? app.services.account.profileDetails()
        await loadSaved()
        if let found = await details { phone = .some(found.phone) } else if phone == nil { phone = .some(nil) }
        if let page = await orders {
            var seen = Set<String>()
            orderPhotos = page.rows.flatMap(\.summary.photos).filter { seen.insert($0).inserted }.prefix(4).map { $0 }
        } else if orderPhotos == nil {
            orderPhotos = []
        }
        points = (await rewards)?.balance
        await app.refreshMemberCode()
    }

    private func loadSaved() async {
        let ids = Array(app.saved.ids.prefix(4))
        guard !ids.isEmpty else {
            savedPhotos = []
            return
        }
        let products = (try? await app.services.api.call(API.productsByIds, .init(ids: ids, locale: l.current.rawValue))) ?? []
        savedPhotos = products.compactMap { $0.images.first?.url }
    }

    /// Who is signed in: the profile photo or the initials in a pale circle,
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
                    .background(Circle().fill(Color.white))
                    .overlay(Circle().strokeBorder(Brand.cardLine, lineWidth: 1))
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
            // The photo the shopper chose, or their initials (`ProfileAvatar`).
            ProfileAvatar(user: user, size: 64)
            VStack(alignment: .leading, spacing: 2) {
                Text(AccountIdentityCard.name(user, l))
                    .font(.inter(18, .bold))
                    .foregroundStyle(Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\u{2066}\(user.email)\u{2069}")
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
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 6) {
                    Text(title).font(.inter(17, .bold)).foregroundStyle(Brand.navy).lineLimit(1).minimumScaleFactor(0.8)
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
            .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 24))
        .accessibilityLabel(waiting.map { "\(title), \($0)" } ?? title)
    }

    private var pointsRow: some View {
        Button {
            app.push(.rewards)
        } label: {
            HStack(spacing: 14) {
                PointsCoin(size: 26)
                Text(l.t("account.points"))
                    .font(.inter(16, .medium))
                    .foregroundStyle(Brand.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 4) {
                    Text(points.map { l.t("rewards.balance", ["points": PointsFormat.count($0, l.current)]) } ?? "—")
                        .font(.inter(15, .bold))
                        .monospacedDigit()
                    Image(systemName: "chevron.forward").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(Brand.ink)
                .padding(.leading, 14)
                .padding(.trailing, 10)
                .frame(minHeight: 40)
                .background(Capsule().fill(ProfileInk.chip))
            }
            .padding(.horizontal, 20)
            .frame(minHeight: 68)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressFillStyle(cornerRadius: 24))
        .panel()
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
        if id == "signout" { return true }
        guard entries.contains(where: { $0.id == id }) else { return false }
        switch id {
        case "offers": return holdings.offers
        case "subscriptions": return holdings.subscriptions
        default: return true
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

/// The reference's greys: a pale chip behind the initials and the switch, a
/// slate for the row icons, and the red of the way out. An enum of its own
/// rather than statics on the view, so a default argument can name one —
/// Swift 5 evaluates those outside the main actor.
enum ProfileInk {
    static let chip = Color(red: 241 / 255, green: 242 / 255, blue: 246 / 255)
    static let icon = Color(red: 93 / 255, green: 107 / 255, blue: 130 / 255)
    static let signOutRed = Color(red: 194 / 255, green: 54 / 255, blue: 42 / 255)
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

/// Who is signed in, with the dates and the role — the web's `AccountIdentity`,
/// at the top of "Your details".
struct AccountIdentityCard: View {
    let user: User
    @Environment(LanguageSettings.self) private var l

    static func initials(_ user: User) -> String {
        let source = user.name?.trimmingCharacters(in: .whitespaces).isEmpty == false ? user.name! : (user.email.split(separator: "@").first.map(String.init) ?? "")
        let words = source.split(whereSeparator: { " ._-".contains($0) })
        if words.count >= 2 { return (String(words[0].prefix(1)) + String(words[1].prefix(1))).uppercased() }
        return words.first.map { String($0.prefix(2)).uppercased() } ?? "?"
    }

    static func name(_ user: User, _ l: LanguageSettings) -> String {
        user.name?.trimmingCharacters(in: .whitespaces).isEmpty == false ? user.name! : l.t("account.noName")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            ProfileAvatar(user: user, size: 64)
            VStack(alignment: .leading, spacing: 2) {
                Text(Self.name(user, l))
                    .font(.inter(20, .heavy))
                    .foregroundStyle(Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
                Text(l.t("account.identityEmail"))
                    .font(.inter(12, .semibold))
                    .foregroundStyle(Brand.muted)
                    .padding(.top, 2)
                Text("\u{2066}\(user.email)\u{2069}")
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(user.role == "admin" ? l.t("account.roleAdmin") : l.t("account.roleShopper"))
                    .font(.inter(12, .bold))
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Brand.tint))
                    .padding(.top, 8)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
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
        AccountEntry(id: "saved", label: "footer.savedItems", hint: "account.hint.saved", symbol: "heart", group: "account.groupShopping"),
        AccountEntry(id: "wishlists", label: "account.sectionWishlists", hint: "account.hint.wishlists", symbol: "gift", group: "account.groupShopping"),
        AccountEntry(id: "offers", label: "offers.mine", hint: "account.hint.offers", symbol: "tag", group: "account.groupShopping"),
        AccountEntry(id: "reviews", label: "account.sectionReviews", hint: "account.hint.reviews", symbol: "star", group: "account.groupShopping"),
        AccountEntry(id: "notifications", label: "notices.title", hint: "notices.tile", symbol: "bell", group: "account.groupConversations"),
        AccountEntry(id: "help", label: "support.section", hint: "account.hint.help", symbol: "lifepreserver", group: "account.groupConversations"),
        AccountEntry(id: "rewards", label: "account.sectionRewards", hint: "account.hint.rewards", symbol: "person.2", group: "account.groupRewards"),
        AccountEntry(id: "affiliate", label: "affiliate.section", hint: "account.hint.affiliate", symbol: "megaphone", group: "account.groupRewards"),
        AccountEntry(id: "details", label: "account.sectionProfile", hint: "account.hint.details", symbol: "person.crop.circle", group: "account.groupSettings"),
        AccountEntry(id: "security", label: "account.security", hint: "account.hint.security", symbol: "lock.shield", group: "account.groupSettings"),
        AccountEntry(id: "addresses", label: "address.book", hint: "account.hint.addresses", symbol: "mappin.and.ellipse", group: "account.groupSettings"),
        AccountEntry(id: "payments", label: "account.sectionPayments", hint: "account.hint.payments", symbol: "creditcard", group: "account.groupSettings"),
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
        case "payments": return .payments
        case "subscriptions": return .subscriptions
        case "saved": return .saved
        case "wishlists": return .wishlists
        case "offers": return .offers
        case "reviews": return .reviews
        case "notifications": return .notifications
        case "help": return .help
        case "rewards": return .rewards
        case "affiliate": return .affiliate
        case "details": return .profile
        case "security": return .security
        case "addresses": return .addresses
        case "preferences": return .preferences
        case "history": return .history
        case "selling": return .portal("/admin")
        default: return nil
        }
    }
}

/// "Your profile", drawn to the owner's reference (Noon's "Your profile"): a
/// round back button beside the title, then white cards whose boxes carry
/// their labels inside the rim (`FloatingField`). The name, the sign-in email
/// and the password are still three cards with three Saves — three different
/// decisions, and one Save across them would change a password somebody only
/// opened the page to fix a spelling in. The account's dates and role close
/// the page.
struct ProfileView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { ProfileViewModel(account: app.services.account, user: app.session.user) }) { model in
            ShopPage(header: false) {
                VStack(alignment: .leading, spacing: 16) {
                    RoundBackTitle(title: l.t("account.sectionProfile"))
                    if let user = app.session.user { ProfilePhotoCard(user: user) }
                    ProfileForm(model: model)
                    if let user = app.session.user { AccountIdentityCard(user: user) }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .task {
                async let photo: Void = app.profilePhoto.load()
                await model.load()
                await photo
            }
        }
    }
}

/// A page's round way back beside its title — "Your profile" and "Account
/// security", one screen back to wherever they were opened from.
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
                    .background(Circle().fill(Color.white).shadow(color: Brand.navy.opacity(0.12), radius: 4, y: 1))
                    .contentShape(Circle())
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

/// Account security, on the owner's word: the password, and deleting the
/// account, and nothing else — the web's `/account/security`. The password is
/// "Your profile"'s own card (`ProfileForm`'s `security`); the rest of the
/// profile stays under the name's pencil.
struct AccountSecurityView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { ProfileViewModel(account: app.services.account, user: app.session.user) }) { model in
            ShopPage(header: false) {
                VStack(alignment: .leading, spacing: 16) {
                    RoundBackTitle(title: l.t("account.security"))
                    ProfileForm(model: model, security: true)
                    DeleteAccountCard()
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// "Your profile", drawn to the owner's reference (Noon's "Your profile") and
/// card for card the web's `ProfileManager`: the name in two boxes side by
/// side, the phone, the gender and the birthday, then the address somebody
/// signs in with. Each card is its own decision — a gender saves as it is
/// pressed, the rest have a Save. The nationality was a card too, and the
/// owner took it off as not needed. **The password is
/// Account security's**, on the owner's word: `security` draws it alone.
private struct ProfileForm: View {
    @Bindable var model: ProfileViewModel
    /// Account security's card — the password — rather than the profile's.
    var security = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var choosingBirthday = false
    /// "Forgot your current password?": a six-digit code to the account's own
    /// email, and the new password with it, on this card (on the owner's word).
    @State private var recovering: Recovery = .idle

    private enum Recovery { case idle, sending, sent }

    var body: some View {
        if security {
            VStack(spacing: 16) {
                passwordCard
                recoverCard
            }
        } else {
            profileCards
        }
    }

    private var passwordCard: some View {
        card(.password, title: "account.password", note: "account.passwordNote", done: "account.passwordChanged") {
            FloatingField(label: l.t("account.currentPassword"), text: $model.currentPassword, content: .password, secure: true, leftToRight: true)
            FloatingField(label: l.t("account.newPassword"), text: $model.newPassword, content: .newPassword, secure: true, leftToRight: true)
            PasswordMeter(password: model.newPassword)
        } action: {
            saveButton(.password, enabled: true) { _ = await model.savePassword() }
        }
    }

    /// The way back in for somebody who no longer knows the current password:
    /// the reset mail's code, typed here with the new one. Saving signs this
    /// device in again, as the reset always does.
    @ViewBuilder
    private var recoverCard: some View {
        if let user = app.session.user {
            VStack(alignment: .leading, spacing: 12) {
                if recovering == .sent {
                    Text(l.t("account.recoverSent", ["email": "\u{2068}\(user.email)\u{2069}"]))
                        .font(.inter(14))
                        .foregroundStyle(Brand.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    ResetByCodeFields(email: user.email, signedIn: { signed in
                        app.session.updated(signed)
                        Haptics.succeeded()
                        app.toast(l.t("account.passwordChanged"))
                        recovering = .idle
                        model.currentPassword = ""
                        model.newPassword = ""
                    })
                }
                Button {
                    Task { await sendCode(to: user.email) }
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
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .panel()
        }
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

    private var profileCards: some View {
        VStack(spacing: 16) {
            card(.name, title: nil, note: model.problems[.name] == nil ? "profile.nameNote" : nil, done: "account.nameSaved") {
                HStack(alignment: .top, spacing: 12) {
                    FloatingField(label: l.t("profile.firstName"), text: $model.firstName, required: true, content: .givenName)
                    FloatingField(label: l.t("profile.lastName"), text: $model.lastName, required: true, content: .familyName)
                }
            } action: {
                saveButton(.name, enabled: model.nameChanged) {
                    if let user = await model.saveName() { app.session.updated(user) }
                }
            }
            card(.phone, title: "profile.phoneTitle", note: "profile.phoneNote", done: "profile.saved") {
                FloatingField(label: l.t("profile.phoneLabel"), text: $model.phone, placeholder: l.t("wish.phonePlaceholder"),
                              keyboard: .phonePad, content: .telephoneNumber, leftToRight: true, prefix: "+965")
            } action: {
                saveButton(.phone, enabled: model.phoneChanged) { await model.savePhone() }
            }
            card(.gender, title: "profile.genderTitle", note: "profile.genderNote", done: "profile.saved") {
                HStack(spacing: 12) {
                    ForEach(ProfileDetails.genders, id: \.self) { gender in
                        genderTile(gender)
                    }
                }
            } action: { EmptyView() }
            card(.birthday, title: "profile.birthdayTitle", note: "profile.birthdayNote", done: "profile.saved") {
                birthdayBox
            } action: {
                HStack(spacing: 12) {
                    saveButton(.birthday, enabled: model.birthdayChanged) {
                        await model.saveBirthday()
                        if model.problems[.birthday] == nil { choosingBirthday = false }
                    }
                    if model.details.birthday != nil {
                        Button(l.t("profile.birthdayRemove")) {
                            choosingBirthday = false
                            Task { await model.removeBirthday() }
                        }
                        .buttonStyle(.tap)
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.danger)
                        .frame(minHeight: 44)
                        .disabled(model.saving != nil)
                    }
                }
            }
            card(.email, title: "account.signInEmail", note: "account.signInEmailNote", done: "account.emailChanged") {
                FloatingField(label: l.t("auth.email"), text: $model.newEmail, keyboard: .emailAddress, content: .username, leftToRight: true)
                FloatingField(label: l.t("account.currentPassword"), text: $model.emailPassword, content: .password, secure: true, leftToRight: true)
                Text(l.t("account.currentPasswordWhy"))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } action: {
                saveButton(.email, enabled: true) {
                    if let user = await model.saveEmail() { app.session.updated(user) }
                }
            }
        }
    }

    private func genderTile(_ gender: String) -> some View {
        let chosen = model.details.gender == gender
        return Button {
            Task { await model.choose(gender: gender) }
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
                        .strokeBorder(model.problems[.birthday] != nil ? Brand.danger : choosingBirthday ? Brand.navy : Brand.line,
                                      lineWidth: model.problems[.birthday] != nil || choosingBirthday ? 1.5 : 1)
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

    private func saveButton(_ form: ProfileViewModel.Form, enabled: Bool, _ save: @escaping () async -> Void) -> some View {
        Button {
            Task { await save() }
        } label: {
            if model.saving == form { ProgressView().tint(.white) } else { Text(l.t("account.saveChanges")) }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(model.saving != nil || !enabled)
    }

    private func card<Fields: View, Action: View>(
        _ form: ProfileViewModel.Form,
        title: String?,
        note: String?,
        done: String,
        @ViewBuilder fields: () -> Fields,
        @ViewBuilder action: () -> Action
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                VStack(alignment: .leading, spacing: 3) {
                    Text(l.t(title)).font(.inter(17, .bold)).foregroundStyle(Brand.ink).accessibilityAddTraits(.isHeader)
                    if let note {
                        Text(l.t(note)).font(.inter(14)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.bottom, 2)
            }
            fields()
            if title == nil, let note {
                Text(l.t(note)).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            FieldProblem(key: model.problems[form])
            if model.saved == form {
                Label(l.t(done), systemImage: "checkmark.circle").font(.inter(13, .semibold)).foregroundStyle(Brand.success)
            }
            action()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
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
