import SwiftUI

/// The Account tab. Signed out it *is* the sign-in form, the web's rule for a
/// signed-out `/account`; while it asks who is signed in it is a quiet
/// placeholder, never "Sign in" to somebody who is.
struct AccountView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var confirmingSignOut = false

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

    private func home(_ user: User) -> some View {
        ShopPage(root: true, refresh: { await app.session.restore() }) {
            VStack(alignment: .leading, spacing: 0) {
                Text(user.name.map { l.t("account.welcomeBackName", ["name": $0]) } ?? l.t("account.welcomeBack"))
                    .pageTitle()
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.bottom, 24)
                identity(user)
                ForEach(AccountEntry.groups, id: \.self) { group in
                    let items = entries.filter { $0.group == group }
                    if !items.isEmpty {
                        Text(l.t(group))
                            .font(.inter(15, .bold))
                            .foregroundStyle(Brand.navy)
                            .accessibilityAddTraits(.isHeader)
                            .padding(.top, 32)
                            .padding(.bottom, 12)
                        VStack(spacing: 10) {
                            ForEach(items) { entry in tile(entry) }
                        }
                    }
                }
                Rectangle().fill(Brand.cardLine).frame(height: 1).padding(.top, 40)
                Button {
                    confirmingSignOut = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "rectangle.portrait.and.arrow.right").font(.system(size: 15))
                        Text(l.t("header.signOut"))
                    }
                    .font(.inter(14, .semibold))
                    .foregroundStyle(Brand.danger)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                }
                .buttonStyle(PressFillStyle(cornerRadius: 12))
                .padding(.top, 24)
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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

    /// Who is signed in: initials on navy, the name as typed, the email, and
    /// the role — the web's `AccountIdentity`.
    private func identity(_ user: User) -> some View {
        let initials = (user.name ?? user.email)
            .split(whereSeparator: { $0 == " " || $0 == "@" })
            .prefix(2)
            .compactMap { $0.first.map { String($0).uppercased() } }
            .joined()
        return HStack(alignment: .top, spacing: 16) {
            Text(initials.isEmpty ? "·" : initials)
                .font(.inter(20, .heavy))
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.navy))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(user.name?.trimmingCharacters(in: .whitespaces).isEmpty == false ? user.name! : l.t("account.noName"))
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

    /// The sections this account has: selling only for somebody in a store.
    private var entries: [AccountEntry] {
        AccountEntry.all.filter { $0.id != "selling" || app.session.seller?.isStoreMember == true }
    }

    /// One way into the account: an icon, what it is, one line on what it holds.
    private func tile(_ entry: AccountEntry) -> some View {
        Button {
            open(entry)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: entry.symbol)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 44, height: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t(entry.label))
                        .font(.inter(15, .bold))
                        .foregroundStyle(Brand.navy)
                    Text(l.t(entry.hint))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.forward")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Brand.chevron)
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
    }

    /// The sections the app draws itself open here; the rest open the
    /// account's own page on the website, signed in there by its own form.
    private func open(_ entry: AccountEntry) {
        switch entry.id {
        case "orders": app.push(.orders)
        case "saved": app.push(.saved)
        case "details": app.push(.profile)
        case "selling": app.push(.listings)
        default: app.openWeb("/account/\(entry.id)")
        }
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
        AccountEntry(id: "saved", label: "footer.savedItems", hint: "account.hint.saved", symbol: "heart", group: "account.groupShopping"),
        AccountEntry(id: "wishlists", label: "account.sectionWishlists", hint: "account.hint.wishlists", symbol: "gift", group: "account.groupShopping"),
        AccountEntry(id: "offers", label: "offers.mine", hint: "account.hint.offers", symbol: "tag", group: "account.groupShopping"),
        AccountEntry(id: "reviews", label: "account.sectionReviews", hint: "account.hint.reviews", symbol: "star", group: "account.groupShopping"),
        AccountEntry(id: "messages", label: "chat.sectionMessages", hint: "account.hint.messages", symbol: "message", group: "account.groupConversations"),
        AccountEntry(id: "help", label: "support.section", hint: "account.hint.help", symbol: "lifepreserver", group: "account.groupConversations"),
        AccountEntry(id: "rewards", label: "account.sectionRewards", hint: "account.hint.rewards", symbol: "person.2", group: "account.groupRewards"),
        AccountEntry(id: "details", label: "account.sectionProfile", hint: "account.hint.details", symbol: "person.crop.circle", group: "account.groupSettings"),
        AccountEntry(id: "addresses", label: "address.book", hint: "account.hint.addresses", symbol: "mappin.and.ellipse", group: "account.groupSettings"),
        AccountEntry(id: "preferences", label: "account.sectionPreferences", hint: "account.hint.preferences", symbol: "slider.horizontal.3", group: "account.groupSettings"),
        AccountEntry(id: "selling", label: "account.sectionSelling", hint: "account.hint.selling", symbol: "storefront", group: "account.groupSettings"),
    ]
}

/// Display name, sign-in email and password, each its own small form.
struct ProfileView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { ProfileViewModel(account: app.services.account, user: app.session.user) }) { model in
            ShopPage {
                AccountSection(title: l.t("account.sectionProfile"), hint: l.t("account.hint.details")) {
                    ProfileForm(model: model)
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
