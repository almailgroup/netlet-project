import Foundation

/// A friend's invitation code (3.1.14), the app's side of the web's
/// `lib/referral.ts`. On the website the code arrives on the link
/// (`?ref=NL…`); a link opens the website, not the app, so here it is typed
/// on the Create account form, kept on the phone until an account is made —
/// by the emailed code, Apple, Google or a phone number alike — and sent with
/// it. The server decides everything else: a code naming nobody, or the new
/// account itself, is a quiet no, never a refused registration.
enum InviteCode {
    /// The web's own key, so the two read alike.
    static let key = "netlet.referral"

    /// Codes are short and shaped — letters and digits, 2 to 32 — the web's `SHAPE`.
    static func isShaped(_ typed: String) -> Bool {
        let code = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (2...32).contains(code.count) else { return false }
        return code.unicodeScalars.allSatisfy { scalar in
            (48...57).contains(scalar.value) || (65...90).contains(scalar.value) || (97...122).contains(scalar.value)
        }
    }

    /// The code to send with a new account, if one was typed.
    static func stored(in defaults: UserDefaults = .standard) -> String? {
        defaults.string(forKey: key)
    }

    /// Keeps a well-shaped code, in capitals as the server writes them; an
    /// empty box forgets the one kept before.
    static func keep(_ typed: String, in defaults: UserDefaults = .standard) {
        let code = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if isShaped(code) {
            defaults.set(code.uppercased(), forKey: key)
        } else if code.isEmpty {
            defaults.removeObject(forKey: key)
        }
    }

    /// Forgotten once an account has used it, so it cannot ride along on a
    /// second account made on the same phone.
    static func clear(in defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key)
    }
}
