import Foundation
import Observation

/// Who is signed in, for the whole app.
///
/// It starts `unknown` rather than signed out, so the Account tab draws a quiet
/// placeholder while it asks instead of saying "Sign in" to somebody who is —
/// the web header's rule.
@Observable
@MainActor
final class SessionModel {
    enum State: Equatable {
        case unknown
        /// Asking who is signed in failed — offline at launch, the server
        /// down. Never read as signed out: the Profile tab says the account
        /// could not be reached and offers to try again, the web's `unknown`
        /// in `useAuth`, rather than telling a signed-in shopper to sign in.
        case unreachable
        case signedOut
        case signedIn(User)
    }

    private(set) var state: State = .unknown
    /// Set when the account belongs to a store, which is what draws the Sell tab.
    private(set) var seller: SellerIdentity?

    private let account: AccountServicing
    /// Whether this install holds a session at all. With none, a failure to
    /// ask is signed out after all: there is nobody it could be.
    private let holdsSession: () -> Bool

    init(account: AccountServicing, holdsSession: @escaping () -> Bool = SessionModel.cookieStored) {
        self.account = account
        self.holdsSession = holdsSession
    }

    /// NetLet's session cookie is in the system's store — the same question
    /// the first launch's tutorial asks.
    nonisolated static func cookieStored() -> Bool {
        let name = ReferenceData.shared.rules.sessionCookie
        return HTTPCookieStorage.shared.cookies?.contains(where: { $0.name == name }) == true
    }

    var user: User? {
        if case .signedIn(let user) = state { return user }
        return nil
    }

    var isSignedIn: Bool { user != nil }

    /// Whether the last ask could not be answered and nothing is known yet.
    var isUnreachable: Bool { state == .unreachable }

    /// Asks the server who the cookie belongs to. A failure to ask before
    /// anything is known is `unreachable`, never signed out — the cookie is
    /// still there, and the next ask (Try again, or the app coming back to
    /// the foreground) finds who it belongs to; with no cookie at all it is
    /// signed out, since there is nobody it could be. A failure while signed
    /// in or out leaves that as it was.
    func restore() async {
        do {
            if let user = try await account.currentUser() {
                await adopt(user)
            } else {
                state = .signedOut
                seller = nil
            }
        } catch {
            switch state {
            case .unknown, .unreachable: state = holdsSession() ? .unreachable : .signedOut
            case .signedOut, .signedIn: break
            }
        }
    }

    /// The account just proved by a sign-in or a confirmed code.
    func adopt(_ user: User) async {
        state = .signedIn(user)
        seller = try? await account.sellerIdentity()
        await carryDeviceSecret()
    }

    /// An administrator on this install: from now on its requests carry the
    /// install's secret (`AdminDeviceSecret`), and who they are is asked again
    /// with it, since the rights hold only on an install the owner authorised.
    private func carryDeviceSecret() async {
        guard let seller, !AdminDeviceSecret.shared.enabled else { return }
        guard seller.kind == "admin" || seller.adminLocked == true || !(seller.grants ?? []).isEmpty else { return }
        AdminDeviceSecret.shared.enable()
        self.seller = try? await account.sellerIdentity()
    }

    /// Who the account is to the portal again — after the owner authorises
    /// this install, when its rights come back.
    func refreshSeller() async {
        seller = try? await account.sellerIdentity()
    }

    func updated(_ user: User) {
        state = .signedIn(user)
    }

    /// Signs out on the server, and forgets the account here even when the
    /// server could not be reached: the person pressing Sign out wants to be out.
    func signOut() async {
        try? await account.signOut()
        let name = ReferenceData.shared.rules.sessionCookie
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where cookie.name == name {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
        state = .signedOut
        seller = nil
    }
}
