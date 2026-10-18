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
        case signedOut
        case signedIn(User)
    }

    private(set) var state: State = .unknown
    /// Set when the account belongs to a store, which is what draws the Sell tab.
    private(set) var seller: SellerIdentity?

    private let account: AccountServicing

    init(account: AccountServicing) {
        self.account = account
    }

    var user: User? {
        if case .signedIn(let user) = state { return user }
        return nil
    }

    var isSignedIn: Bool { user != nil }

    /// Asks the server who the cookie belongs to. A failure to ask leaves the
    /// shopper signed out for this launch rather than stuck on a placeholder.
    func restore() async {
        do {
            if let user = try await account.currentUser() {
                await adopt(user)
            } else {
                state = .signedOut
                seller = nil
            }
        } catch {
            if case .unknown = state { state = .signedOut }
        }
    }

    /// The account just proved by a sign-in or a confirmed code.
    func adopt(_ user: User) async {
        state = .signedIn(user)
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
