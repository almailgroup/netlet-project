import Foundation

/// Signing in and out, creating an account, and the account's own settings.
///
/// The password is checked by the server and the session is the httpOnly
/// cookie it sets; nothing here keeps a token or a password once a call returns.
protocol AccountServicing: Sendable {
    func currentUser() async throws -> User?
    func signupOptions() async throws -> SignupOptions
    func signIn(email: String, password: String) async throws -> User
    func register(email: String, password: String, name: String?, captcha: String?) async throws -> RegistrationResult
    func verify(email: String, password: String, code: String, name: String?) async throws -> User
    func resendCode(email: String) async throws
    func requestPasswordReset(email: String) async throws
    func signOut() async throws
    func updateName(_ name: String) async throws -> User
    func changePassword(current: String, new: String) async throws
    func changeEmail(_ email: String, currentPassword: String) async throws -> User
    func profile() async throws -> Profile
    func claimCart(_ cartId: String?, language: Language) async throws -> Profile
    func saveLanguage(_ language: Language) async throws
    func addresses() async throws -> [SavedAddress]
    func sellerIdentity() async throws -> SellerIdentity
    func savedProducts() async throws -> [String]
    func setSaved(_ productId: String, saved: Bool) async throws -> [String]
    func wish(_ productId: String, visibility: String, title: String) async throws -> WishAnswer
    func unwish(_ productId: String) async throws
}

struct AccountService: AccountServicing {
    let client: TRPCClient

    func currentUser() async throws -> User? { try await client.call(API.me) }

    func signupOptions() async throws -> SignupOptions { try await client.call(API.signupOptions) }

    /// Always "keep me signed in": a phone is somebody's own.
    func signIn(email: String, password: String) async throws -> User {
        try await client.call(API.signIn, .init(email: email, password: password, remember: true))
    }

    func register(email: String, password: String, name: String?, captcha: String?) async throws -> RegistrationResult {
        try await client.call(API.register, .init(email: email, password: password, name: name, captcha: captcha))
    }

    func verify(email: String, password: String, code: String, name: String?) async throws -> User {
        try await client.call(API.verifyEmail, .init(email: email, password: password, code: code, name: name, remember: true))
    }

    func resendCode(email: String) async throws {
        _ = try await client.call(API.resendCode, .init(email: email))
    }

    func requestPasswordReset(email: String) async throws {
        _ = try await client.call(API.requestPasswordReset, .init(email: email))
    }

    func signOut() async throws {
        _ = try await client.call(API.signOut)
    }

    func updateName(_ name: String) async throws -> User {
        try await client.call(API.updateName, .init(name: name))
    }

    func changePassword(current: String, new: String) async throws {
        _ = try await client.call(API.changePassword, .init(currentPassword: current, newPassword: new))
    }

    func changeEmail(_ email: String, currentPassword: String) async throws -> User {
        try await client.call(API.changeEmail, .init(email: email, currentPassword: currentPassword))
    }

    func profile() async throws -> Profile { try await client.call(API.profile) }

    /// Points the account at this device's bag, which claims a bag nobody owns;
    /// the answer names the bag the account has, which may be one from another device.
    func claimCart(_ cartId: String?, language: Language) async throws -> Profile {
        try await client.call(API.updateProfile, .init(locale: language.rawValue, cartId: cartId))
    }

    func saveLanguage(_ language: Language) async throws {
        _ = try await client.call(API.updateProfile, .init(locale: language.rawValue))
    }

    func addresses() async throws -> [SavedAddress] { try await client.call(API.addresses) }

    func sellerIdentity() async throws -> SellerIdentity { try await client.call(API.sellerIdentity) }

    func savedProducts() async throws -> [String] { try await client.call(API.savedList) }

    func setSaved(_ productId: String, saved: Bool) async throws -> [String] {
        try await client.call(API.setSaved, .init(productId: productId, saved: saved))
    }

    func wish(_ productId: String, visibility: String, title: String) async throws -> WishAnswer {
        try await client.call(API.wish, .init(productId: productId, visibility: visibility, title: title))
    }

    func unwish(_ productId: String) async throws {
        _ = try await client.call(API.unwish, .init(productId: productId))
    }
}
