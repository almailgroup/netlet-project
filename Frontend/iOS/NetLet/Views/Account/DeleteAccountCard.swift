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
/// Once the account is gone the app forgets it as signing out does
/// (`AppModel.signOut`) and goes home.
struct DeleteAccountCard: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var check: API.AccountDeletionCheck?
    /// How the account signs in: an Apple account confirms with Apple.
    @State private var ways: AccountSignInWays?
    @State private var apple = AppleSignIn()
    @State private var asking = false
    @State private var password = ""
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

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(l.t("account.deleteTitle"))
                    .font(.inter(17, .bold))
                    .foregroundStyle(Brand.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(l.t("account.deleteNote"))
                    .font(.inter(14))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
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
                    .background(Capsule().fill(Color.white))
                    .overlay(Capsule().strokeBorder(Brand.danger.opacity(0.35), lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.tap)
                .disabled(check == nil || deleting)
            }
            if let problem {
                Text(l.t(problem))
                    .font(.inter(13, .semibold))
                    .foregroundStyle(Brand.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        .task { await load() }
        .alert(l.t("account.deleteConfirmTitle"), isPresented: $asking) {
            if ways?.apple == true {
                Button(l.t("account.deleteWithApple"), role: .destructive) {
                    Task { await deleteWithApple() }
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
            Text(l.t(ways?.apple == true ? "account.deleteAppleNote" : "account.deletePasswordNote"))
        }
    }

    private func load() async {
        if let answer = try? await app.services.api.call(API.accountDeletionCheck) { check = answer }
        if ways == nil { ways = try? await app.services.account.accountSignInWays() }
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
