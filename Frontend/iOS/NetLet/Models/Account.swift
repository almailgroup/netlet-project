import Foundation

/// The signed-in shopper, as `auth.me` and the sign-in procedures answer:
/// the server's `PublicUser`, never the row behind it.
struct User: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let email: String
    let name: String?
    let role: String
    let createdAt: Date?

    /// The first word of the name as typed, as the web's account control shows it.
    var firstName: String? {
        guard let name, let first = name.split(separator: " ").first else { return nil }
        return String(first)
    }
}

/// What creating an account answers: a code is on its way to the address,
/// or — with no email service configured — the account already exists.
enum RegistrationResult: Decodable, Sendable {
    case verify(email: String)
    case signedIn(User)

    private enum CodingKeys: String, CodingKey {
        case status
        case email
        case user
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let status = try container.decode(String.self, forKey: .status)
        if status == "verify" {
            self = .verify(email: try container.decode(String.self, forKey: .email))
        } else {
            self = .signedIn(try container.decode(User.self, forKey: .user))
        }
    }
}

/// Whether Create account is guarded by Google's "I'm not a robot" box.
struct SignupOptions: Decodable, Sendable {
    let captchaSiteKey: String?
}

/// The account's stored choices — the language, the delivery area and which
/// bag is theirs (`customer.profile.get`).
struct Profile: Decodable, Sendable {
    let locale: String?
    let deliveryZoneId: String?
    let cartId: String?
}

/// Who the caller is to the seller's side (`inventory.me`): a shopper, a member
/// of one store at a rank, or an administrator.
struct SellerIdentity: Decodable, Hashable, Sendable {
    let kind: String
    let userId: Int
    let vendorId: Int?
    let role: String?

    /// The app's Sell tab is for somebody who belongs to a store; an
    /// administrator runs the shop from the web portal.
    var isStoreMember: Bool { kind == "vendor" && vendorId != nil }
}

/// A reply whose content the app does not need — `{ "sent": true }`,
/// `{ "success": true }` — decoded as "it worked".
struct Acknowledged: Decodable, Sendable {
    init(from decoder: Decoder) throws {}
    init() {}
}
