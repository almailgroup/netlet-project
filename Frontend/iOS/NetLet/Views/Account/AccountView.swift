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
            LoadingView().background(Brand.pearl.ignoresSafeArea())
        case .signedOut:
            AuthView()
        case .signedIn(let user):
            home(user)
        }
    }

    private func home(_ user: User) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(user.firstName.map { l.t("account.welcomeBackName", ["name": $0]) } ?? l.t("account.welcomeBack"))
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Brand.navy)
                    Text(user.email)
                        .font(.subheadline)
                        .foregroundStyle(Brand.muted)
                        // Typed left to right, but on the page's own side of the line.
                        .environment(\.layoutDirection, .leftToRight)
                    Text(user.role == "admin" ? l.t("account.roleAdmin") : l.t("account.roleShopper"))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Brand.tint))
                        .padding(.top, 4)
                }
                .padding(.vertical, 6)
            }

            Section(l.t("account.groupShopping")) {
                NavigationLink(value: Route.orders) {
                    tile("shippingbox", "account.sectionOrders", "account.hint.orders")
                }
            }

            if let seller = app.session.seller, seller.isStoreMember {
                Section(l.t("account.sectionSelling")) {
                    Button {
                        app.selectedTab = .sell
                    } label: {
                        tile("storefront", "account.sellerSwitch", "account.hint.selling")
                    }
                    Text(l.t("account.sellerNote")).font(.footnote).foregroundStyle(Brand.muted)
                }
            }

            Section(l.t("account.groupSettings")) {
                NavigationLink(value: Route.profile) {
                    tile("person.text.rectangle", "account.sectionProfile", "account.hint.details")
                }
                Picker(selection: Binding(get: { l.current }, set: { app.setLanguage($0) })) {
                    Text(l.t("account.english")).tag(Language.en)
                    Text(l.t("account.arabic")).tag(Language.ar)
                } label: {
                    Label(l.t("account.language"), systemImage: "globe")
                }
                Text(l.t("account.languageNote")).font(.footnote).foregroundStyle(Brand.muted)
            }

            Section {
                Button(role: .destructive) {
                    confirmingSignOut = true
                } label: {
                    Text(l.t("header.signOut")).frame(maxWidth: .infinity)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.pearl.ignoresSafeArea())
        .navigationTitle(l.t("account.yourWay"))
        .refreshable { await app.session.restore() }
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

    private func tile(_ icon: String, _ title: String, _ hint: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(Brand.navy)
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 10).fill(Brand.tint))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t(title)).font(.body.weight(.semibold)).foregroundStyle(Brand.ink)
                Text(l.t(hint)).font(.footnote).foregroundStyle(Brand.muted)
            }
        }
        .padding(.vertical, 4)
    }
}

/// Display name, sign-in email and password, each its own small form.
struct ProfileView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { ProfileViewModel(account: app.services.account, user: app.session.user) }) { model in
            ProfileForm(model: model)
        }
        .navigationTitle(l.t("account.sectionProfile"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ProfileForm: View {
    @Bindable var model: ProfileViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ScrollView {
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
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Brand.pearl.ignoresSafeArea())
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
            Text(l.t(title)).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t(note)).font(.footnote).foregroundStyle(Brand.muted)
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
