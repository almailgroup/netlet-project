import Foundation

/// The signed-in shopper, as `auth.me` and the sign-in procedures answer:
/// the server's `PublicUser`, never the row behind it.
struct User: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    /// Nil for an account made with a phone number alone, until its owner
    /// adds one (migration 0077).
    let email: String?
    /// The mobile number the account signs in with by text, `+965…`.
    var phone: String? = nil
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

/// Which other ways in the shop has switched on (`auth.providers`): Sign in
/// with Apple in the app while Supabase has Apple on. `web` is the website's
/// Services ID, which the app does not need.
struct SignInWays: Decodable, Sendable {
    struct Apple: Decodable, Sendable {
        let app: Bool
        let web: String?
    }
    /// Google's client ids for the website and the app, each null while that
    /// side offers no Google button. Absent from a server before Google.
    struct Google: Decodable, Sendable {
        let web: String?
        let ios: String?
    }
    let apple: Apple
    var google: Google? = nil
    /// "Continue with phone number": Supabase has phone sign-in on and the
    /// shop can text. Absent from a server before it, which reads as no.
    var phone: Bool? = nil
}

/// How the signed-in account signs in (`auth.myProviders`): deleting it
/// confirms with Apple for an Apple account, and the password card says there
/// is none to change.
struct AccountSignInWays: Decodable, Sendable, Equatable {
    let password: Bool
    let apple: Bool
    /// Absent from a server before Google, which reads as no.
    var google: Bool? = nil
    /// The account signs in with its phone by a texted code.
    var phone: Bool? = nil
}

/// What a texted code answers (`auth.phoneVerify`): the account, and whether
/// it has no email yet — which is what has the form offer adding one.
struct PhoneVerified: Decodable, Sendable {
    let user: User
    let created: Bool
    let needsEmail: Bool

    private enum CodingKeys: String, CodingKey { case created, needsEmail }

    init(from decoder: Decoder) throws {
        user = try User(from: decoder)
        let container = try decoder.container(keyedBy: CodingKeys.self)
        created = try container.decodeIfPresent(Bool.self, forKey: .created) ?? false
        needsEmail = try container.decodeIfPresent(Bool.self, forKey: .needsEmail) ?? false
    }
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
    /// A delivery company's member's company.
    var courierId: Int? = nil
    /// Capabilities an administrator granted this account on their own (3.3.9).
    var grants: [String]? = nil
    /// The shop's owner (`OWNER_EMAIL`), who alone decides which devices may
    /// carry an administrator's rights.
    var owner: Bool? = nil
    /// An administrator's rights, or a grant, held back because this install
    /// is not one the owner authorised (`Shared/auth/adminDevice.ts`).
    var adminLocked: Bool? = nil

    /// Somebody who belongs to a store.
    var isStoreMember: Bool { kind == "vendor" && vendorId != nil }
}

/// A reply whose content the app does not need — `{ "sent": true }`,
/// `{ "success": true }` — decoded as "it worked".
struct Acknowledged: Decodable, Sendable {
    init(from decoder: Decoder) throws {}
    init() {}
}

/// The account's profile photo (`customer.photo.get`,
/// `Shared/commerce/profilePhoto.ts`): where to read it, and whether the shop
/// keeps one yet — `ready` is false until migration 0076 is run, and nothing
/// is offered then. Shown to its owner alone.
struct ProfilePhotoInfo: Decodable, Equatable, Sendable {
    let ready: Bool
    let url: String?
}

/// "Your profile"'s details beyond the sign-in email and the password
/// (`customer.details.get`, `Shared/commerce/profileDetails.ts`). Everything
/// is optional and none of it is shown to a store; the phone is what checkout
/// starts with as the number the driver calls.
struct ProfileDetails: Decodable, Equatable, Sendable {
    var firstName: String?
    var lastName: String?
    /// Stored as `+965` and eight digits.
    var phone: String?
    /// `male` or `female`.
    var gender: String?
    /// `yyyy-mm-dd`.
    var birthday: String?

    static let none = ProfileDetails()

    static let genders = ["male", "female"]

    /// A display name as a first word and the rest — `splitName`, the starting
    /// guess for an account with no parts yet, never saved by itself.
    static func split(_ name: String?) -> (first: String, last: String) {
        let words = (name ?? "").split(whereSeparator: \.isWhitespace).map(String.init)
        return (words.first ?? "", words.dropFirst().joined(separator: " "))
    }
}
