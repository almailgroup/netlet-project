import SwiftUI

/// Deleting your own account, at the foot of "Your profile" — on the owner's word, and
/// the web's `DeleteAccount` (`auth.deletionCheck`, `auth.deleteAccount`).
///
/// The card says what goes, with the points balance by its figure, and what
/// is kept — the orders and their invoices, no longer linked to an account —
/// before anybody presses anything. While something stands in the way (an
/// order still coming, an open return, a cash-out NetLet still owes, a seat on
/// a store's or a delivery company's team, being an administrator), the card
/// names it instead of a button the server would refuse.
///
/// Delete asks twice: the system's own alert, and the password in it — a
/// session left open on a shared phone must not be enough to delete
/// somebody. An account that signs in with Apple confirms with Apple instead,
/// which also lets the server unlink the Apple ID once the account is gone.
/// An account made with a phone, which has no password, confirms with a code
/// texted to its number — the web's card: the first alert texts it, the
/// second takes it.
/// Once the account is gone the app forgets it as signing out does
/// (`AppModel.signOut`) and goes home.
struct DeleteAccountCard: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var check: API.AccountDeletionCheck?
    /// How the account signs in: an Apple account confirms with Apple.
    @State private var ways: AccountSignInWays?
    /// Google's client id for the app, to confirm a Google account with.
    @State private var googleClientId: String?
    @State private var apple = AppleSignIn()
    @State private var google = GoogleSignIn()
    @State private var asking = false
    @State private var password = ""
    /// The code texted to an account made with a phone, and its alert.
    @State private var phoneCode = ""
    @State private var askingCode = false
    @State private var deleting = false
    /// The server's refusal, said under the button.
    @State private var problem: String?

    /// Each reason the server gives, in its own sentence.
    private static let sentence: [String: String] = [
        "admin": "account.deleteBlocked.admin",
        "team": "account.deleteBlocked.team",
        "orderOpen": "account.deleteBlocked.orderOpen",
        "returnOpen": "account.deleteBlocked.returnOpen",
        "warrantyOpen": "account.deleteBlocked.warrantyOpen",
        "cashOutOwed": "account.deleteBlocked.cashOutOwed",
    ]

    /// No password, no Apple or Google, and a phone: the texted code confirms.
    private var phoneAccount: Bool {
        ways?.password == false && ways?.apple != true && ways?.google != true && app.session.user?.phone != nil
    }

    @State private var open = false

    /// What the folded row opens on: the note, the points that go, and either
    /// what stands in the way or the press that deletes.
    private var details: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("account.deleteNote"))
                .font(.inter(14))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            if let points = check?.points, points > 0 {
                Text(l.t("account.deletePoints", ["points": PointsFormat.count(points, l.current)]))
                    .font(.inter(14, .semibold))
                    .foregroundStyle(Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let blockers = check?.blockers, !blockers.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Label(l.t("account.deleteBlockedTitle"), systemImage: "exclamationmark.circle")
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.accentInk)
                    ForEach(blockers, id: \.self) { blocker in
                        Text(l.t(Self.sentence[blocker] ?? "account.deleteFailed"))
                            .font(.inter(14))
                            .foregroundStyle(Brand.body)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.orange.opacity(0.1)))
            } else {
                Button {
                    problem = nil
                    asking = true
                } label: {
                    HStack(spacing: 8) {
                        if deleting {
                            ProgressView().tint(Brand.danger)
                        } else {
                            Image(systemName: "trash").font(.system(size: 15, weight: .semibold))
                        }
                        Text(l.t("account.deleteStart")).font(.inter(15, .semibold))
                    }
                    .foregroundStyle(Brand.danger)
                    .padding(.horizontal, 22)
                    .frame(minHeight: 48)
                    .liquidGlass(.clear)
                }
                .buttonStyle(.tap)
                .disabled(check == nil || deleting)
                // The second alert of a phone account's delete: the code.
                .alert(l.t("account.deleteConfirmTitle"), isPresented: $askingCode) {
                    TextField(l.t("account.deletePhoneCode"), text: $phoneCode)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                    Button(l.t("account.deleteStart"), role: .destructive) {
                        Task { await deleteWithPhoneCode() }
                    }
                    Button(l.t("common.cancel"), role: .cancel) { phoneCode = "" }
                } message: {
                    Text(l.t("auth.phoneCodeSent", ["phone": "\u{2066}\(AccountView.shownPhone(app.session.user?.phone ?? ""))\u{2069}"]))
                }
            }
            if let problem {
                Text(l.t(problem))
                    .font(.inter(13, .semibold))
                    .foregroundStyle(Brand.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.bottom, 10)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Folded to one row until pressed, the web's, on the owner's word
            // ("make it very compact"): what goes, what stays and what stands
            // in the way are a press away.
            Button {
                withAnimation(.snappy(duration: 0.25)) { open.toggle() }
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "trash")
                        .font(.system(size: 16, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(l.t("account.deleteTitle"))
                        .font(.inter(15, .semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Brand.muted)
                        .rotationEffect(.degrees(open ? 180 : 0))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(Brand.danger)
                .frame(minHeight: 48)
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            .accessibilityAddTraits(.isHeader)
            .accessibilityValue(l.t(open ? "ios.a11y.expanded" : "ios.a11y.collapsed"))
            if open { details }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        .task { await load() }
        .alert(l.t("account.deleteConfirmTitle"), isPresented: $asking) {
            if ways?.apple == true {
                Button(l.t("account.deleteWithApple"), role: .destructive) {
                    Task { await deleteWithApple() }
                }
            } else if ways?.google == true, ways?.password == false, googleClientId != nil {
                Button(l.t("account.deleteWithGoogle"), role: .destructive) {
                    Task { await deleteWithGoogle() }
                }
            } else if phoneAccount {
                Button(l.t("account.deleteWithPhone"), role: .destructive) {
                    Task { await textCode() }
                }
            } else {
                SecureField(l.t("account.currentPassword"), text: $password)
                    .textContentType(.password)
                Button(l.t("account.deleteStart"), role: .destructive) {
                    Task { await delete() }
                }
            }
            Button(l.t("common.cancel"), role: .cancel) { password = "" }
        } message: {
            if phoneAccount {
                Text(l.t("account.deletePhoneNote", ["phone": "\u{2066}\(AccountView.shownPhone(app.session.user?.phone ?? ""))\u{2069}"]))
            } else {
                Text(l.t(ways?.apple == true ? "account.deleteAppleNote"
                    : ways?.google == true && ways?.password == false && googleClientId != nil ? "account.deleteGoogleNote"
                    : "account.deletePasswordNote"))
            }
        }
    }

    private func load() async {
        if let answer = try? await app.services.api.call(API.accountDeletionCheck) { check = answer }
        if ways == nil { ways = try? await app.services.account.accountSignInWays() }
        if ways?.google == true, googleClientId == nil {
            googleClientId = (try? await app.services.account.signInWays())?.google?.ios
        }
    }

    /// Google's sheet, then the delete with the token it handed back.
    private func deleteWithGoogle() async {
        guard let clientId = googleClientId else { return }
        let proof: GoogleProof?
        do {
            proof = try await google.ask(clientId: clientId, language: l.current.rawValue)
        } catch {
            Haptics.refused()
            problem = "auth.googleWindowFailed"
            return
        }
        guard let proof else { return }
        await remove(.init(google: proof))
    }

    /// Apple's sheet, then the delete with what it handed back. Closing the
    /// sheet deletes nothing and says nothing.
    private func deleteWithApple() async {
        let answer: (AppleProof, AppleName)?
        do {
            answer = try await apple.ask(name: false)
        } catch {
            Haptics.refused()
            problem = "auth.appleWindowFailed"
            return
        }
        guard let answer else { return }
        await remove(.init(apple: answer.0))
    }

    /// Texts the account's own number a code, then asks for it.
    private func textCode() async {
        guard let phone = app.session.user?.phone else { return }
        deleting = true
        defer { deleting = false }
        do {
            try await app.services.account.phoneStart(phone)
            phoneCode = ""
            askingCode = true
        } catch {
            let failure = APIError.from(error)
            guard failure != .cancelled else { return }
            Haptics.refused()
            problem = failure.messageKey(knownKey: Phrasebook.shared.has)
        }
    }

    private func deleteWithPhoneCode() async {
        let digits = Validation.normaliseCode(phoneCode)
        phoneCode = ""
        guard digits.count == 6 else {
            problem = "auth.phoneCodeWrong"
            return
        }
        await remove(.init(phoneCode: digits))
    }

    private func delete() async {
        let typed = password
        password = ""
        guard !typed.isEmpty else {
            problem = "auth.wrongCurrentPassword"
            return
        }
        await remove(.init(currentPassword: typed))
    }

    private func remove(_ input: API.DeleteAccount) async {
        deleting = true
        defer { deleting = false }
        do {
            _ = try await app.services.api.call(API.deleteAccount, input)
            Haptics.succeeded()
            // The account's Face ID key went with it on the server; the phone's goes too.
            if let email = app.session.user?.email { app.faceID.forget(email: email) }
            await app.signOut()
            app.toast(l.t("account.deleted"))
            app.goHome()
        } catch {
            let failure = APIError.from(error)
            guard failure != .cancelled else { return }
            Haptics.refused()
            problem = failure.messageKey(knownKey: Phrasebook.shared.has)
            // Something may have changed under the press: say what stands in the way now.
            await load()
        }
    }
}
