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
/// them, with the language as a two-way switch in its own row and signing out
/// red at the foot, still asking first. The dates and the role moved to "Your
/// details" (`AccountIdentityCard`), where somebody checking their account looks.
struct AccountView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var confirmingSignOut = false
    /// Whether the shopper holds a standing order or an affiliate account,
    /// asked only while that feature is switched off.
    @State private var holdings = Holdings()
    @State private var orderPhotos: [String]?
    @State private var savedPhotos: [String]?
    @State private var points: Int?

    struct Holdings {
        var subscriptions = false
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

    /// The cards of rows, top to bottom: what somebody shops with, what talks
    /// to them, what they run, and the account itself. "language" and
    /// "signout" are the two rows that are not sections.
    private static let cards: [[String]] = [
        ["addresses", "wishlists", "offers", "reviews", "subscriptions", "language"],
        ["preferences", "notifications", "help"],
        ["affiliate", "selling"],
        ["details", "signout"],
    ]

    private func home(_ user: User) -> some View {
        ShopPage(root: true, header: false, refresh: { await app.session.restore(); await loadPreviews() }) {
            VStack(alignment: .leading, spacing: 12) {
                profileCard(user)
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
                ForEach(Array(Self.cards.enumerated()), id: \.offset) { _, ids in
                    let rows = ids.filter { id in id == "language" || id == "signout" || entries.contains { $0.id == id } }
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
            await loadPreviews()
            if !app.features.isOn("subscriptions") {
                holdings.subscriptions = !((try? await app.services.api.call(API.standingOrders)) ?? []).isEmpty
            }
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
        await loadSaved()
        if let page = await orders {
            var seen = Set<String>()
            orderPhotos = page.rows.flatMap(\.summary.photos).filter { seen.insert($0).inserted }.prefix(4).map { $0 }
        } else if orderPhotos == nil {
            orderPhotos = []
        }
        points = (await rewards)?.balance
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

    /// Who is signed in: initials in a pale circle, the name as typed, the
    /// email, and a pencil to change them.
    private func profileCard(_ user: User) -> some View {
        HStack(spacing: 16) {
            Text(AccountIdentityCard.initials(user))
                .font(.inter(22, .bold))
                .foregroundStyle(Brand.navy)
                .frame(width: 64, height: 64)
                .background(Circle().fill(ProfileInk.chip))
                .accessibilityHidden(true)
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
                Image(systemName: "dollarsign.circle")
                    .font(.system(size: 21))
                    .foregroundStyle(ProfileInk.icon)
                    .frame(width: 26)
                    .accessibilityHidden(true)
                Text(l.t("account.points"))
                    .font(.inter(16, .medium))
                    .foregroundStyle(Brand.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 4) {
                    Text(points.map { l.t("rewards.balance", ["points": "\($0)"]) } ?? "—")
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

    @ViewBuilder
    private func row(_ id: String) -> some View {
        switch id {
        case "language":
            HStack(spacing: 14) {
                rowIcon("character.bubble")
                Text(l.t("account.language"))
                    .font(.inter(16, .medium))
                    .foregroundStyle(Brand.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityAddTraits(.isHeader)
                HStack(spacing: 0) {
                    ForEach([Language.en, Language.ar], id: \.self) { language in
                        let active = l.current == language
                        Button {
                            guard !active else { return }
                            app.setLanguage(language)
                        } label: {
                            Text(l.t(language == .en ? "account.english" : "account.arabic"))
                                .font(.inter(15, .semibold))
                                .foregroundStyle(active ? Brand.ink : ProfileInk.icon)
                                .padding(.horizontal, 16)
                                .frame(minHeight: 40)
                                .background(Capsule().fill(active ? Color.white : Color.clear).shadow(color: Brand.navy.opacity(active ? 0.14 : 0), radius: 2, y: 1))
                                .contentShape(Capsule())
                        }
                        .buttonStyle(PressFillStyle(cornerRadius: 20, strength: Haptics.actionStrength))
                        .environment(\.locale, language.locale)
                        .accessibilityAddTraits(active ? .isSelected : [])
                    }
                }
                .padding(4)
                .background(Capsule().fill(ProfileInk.chip))
            }
            .frame(minHeight: 64)
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
                    rowLabel(symbol: entry.symbol, title: l.t(id == "details" ? "account.security" : entry.label), waiting: badge(entry), iconColour: ProfileInk.icon)
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

    private func rowLabel(symbol: String, title: String, waiting: String?, iconColour: Color) -> some View {
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

    /// What is waiting, said on the row (`useAccountSignals`).
    private func badge(_ entry: AccountEntry) -> String? {
        let signals = app.signals
        switch entry.id {
        case "orders" where signals.onTheWay > 0: return l.t("header.onTheWay", ["count": "\(signals.onTheWay)"])
        case "notifications" where signals.unreadNotices > 0: return l.t("header.unreadCount", ["count": "\(signals.unreadNotices)"])
        case "help" where signals.unreadSupport > 0: return l.t("header.unreadCount", ["count": "\(signals.unreadSupport)"])
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
private enum ProfileInk {
    static let chip = Color(red: 241 / 255, green: 242 / 255, blue: 246 / 255)
    static let icon = Color(red: 93 / 255, green: 107 / 255, blue: 130 / 255)
    static let signOutRed = Color(red: 194 / 255, green: 54 / 255, blue: 42 / 255)
}

/// The dashed line between two rows of a card, inset as the reference draws it.
private struct DashedRule: View {
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

private extension View {
    /// A white card of the profile page: 24 round, a whisper of shadow, no rim.
    func panel() -> some View {
        background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Color.white))
            .shadow(color: Brand.navy.opacity(0.05), radius: 1, y: 1)
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
            Text(Self.initials(user))
                .font(.inter(20, .heavy))
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.navy))
                .accessibilityHidden(true)
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
        AccountEntry(id: "addresses", label: "address.book", hint: "account.hint.addresses", symbol: "mappin.and.ellipse", group: "account.groupSettings"),
        AccountEntry(id: "preferences", label: "account.sectionPreferences", hint: "account.hint.preferences", symbol: "slider.horizontal.3", group: "account.groupSettings"),
        AccountEntry(id: "selling", label: "account.sectionSelling", hint: "account.hint.selling", symbol: "storefront", group: "account.groupSettings"),
    ]

    /// The screen the tile opens.
    var route: Route? {
        switch id {
        case "orders": return .orders
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
        case "addresses": return .addresses
        case "preferences": return .preferences
        case "selling": return .portal("/admin")
        default: return nil
        }
    }
}

/// Display name, sign-in email and password, each its own small form.
struct ProfileView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { ProfileViewModel(account: app.services.account, user: app.session.user) }) { model in
            ShopPage(header: false) {
                AccountSection(title: l.t("account.sectionProfile"), hint: l.t("account.hint.details")) {
                    VStack(spacing: 16) {
                        if let user = app.session.user { AccountIdentityCard(user: user) }
                        ProfileForm(model: model)
                    }
                }
            }
        }
    }
}

private struct ProfileForm: View {
    @Bindable var model: ProfileViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 16) {
            section(.name, title: "account.displayName", note: "account.displayNameNote", done: "account.nameSaved") {
                LabeledField(label: l.t("account.displayName"), text: $model.name, content: .name)
            } save: {
                if let user = await model.saveName() { app.session.updated(user) }
            }
            section(.email, title: "account.signInEmail", note: "account.signInEmailNote", done: "account.emailChanged") {
                LabeledField(label: l.t("account.newEmail"), text: $model.newEmail, keyboard: .emailAddress, content: .username, leftToRight: true)
                LabeledField(label: l.t("account.currentPassword"), text: $model.emailPassword, hint: l.t("account.currentPasswordWhy"), content: .password, secure: true, leftToRight: true)
            } save: {
                if let user = await model.saveEmail() { app.session.updated(user) }
            }
            section(.password, title: "account.changePassword", note: "account.passwordNote", done: "account.passwordChanged") {
                LabeledField(label: l.t("account.currentPassword"), text: $model.currentPassword, content: .password, secure: true, leftToRight: true)
                LabeledField(label: l.t("account.newPassword"), text: $model.newPassword, hint: l.t("auth.ruleLength"), content: .newPassword, secure: true, leftToRight: true)
            } save: {
                _ = await model.savePassword()
            }
        }
    }

    private func section<Fields: View>(
        _ form: ProfileViewModel.Form,
        title: String,
        note: String,
        done: String,
        @ViewBuilder fields: () -> Fields,
        save: @escaping () async -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t(title)).font(.inter(17, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t(note)).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            fields()
            FieldProblem(key: model.problems[form])
            if model.saved == form {
                Label(l.t(done), systemImage: "checkmark.circle").font(.footnote).foregroundStyle(Brand.success)
            }
            Button {
                Task { await save() }
            } label: {
                if model.saving == form { ProgressView().tint(.white) } else { Text(l.t("account.saveChanges")) }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.saving != nil)
        }
        .card()
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
