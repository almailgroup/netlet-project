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
    /// A new password from the reset mail's six-digit code — signs in, or
    /// answers that a sign-up's own code is still to come.
    func resetWithCode(email: String, code: String, password: String) async throws -> RegistrationResult
    func signOut() async throws
    func updateName(_ name: String) async throws -> User
    func updateNameParts(first: String, last: String) async throws -> User
    func profileDetails() async throws -> ProfileDetails
    func saveProfileDetails(_ patch: API.DetailsPatch) async throws -> ProfileDetails
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
    func wishedProducts() async throws -> [String]
    /// The profile photo (`customer.photo.get`), its bytes from its owner's
    /// own route, and choosing or removing one.
    func profilePhoto() async throws -> ProfilePhotoInfo
    func profilePhotoData(path: String) async throws -> Data?
    func uploadProfilePhoto(jpeg: Data) async throws -> ProfilePhotoInfo
    func removeProfilePhoto() async throws -> ProfilePhotoInfo
    /// Sign in with Apple: whether it is on, signing in with what Apple's
    /// sheet handed back, and how the signed-in account signs in.
    func signInWays() async throws -> SignInWays
    func appleSignIn(_ proof: AppleProof, name: AppleName) async throws -> User
    func googleSignIn(_ proof: GoogleProof) async throws -> User
    /// Signing in with a one-time code: one emailed to the account, then the code.
    func codeStart(email: String) async throws
    func codeSignIn(email: String, code: String) async throws -> User
    /// Signing in with a phone: a code texted, then the code.
    func phoneStart(_ phone: String) async throws
    func phoneVerify(phone: String, code: String) async throws -> PhoneVerified
    /// Adding an email to an account made with a phone.
    func addEmailStart(_ email: String) async throws
    func addEmailVerify(email: String, code: String) async throws -> User
    func accountSignInWays() async throws -> AccountSignInWays
    /// Signing in with Face ID: a challenge for this phone's key, the signed
    /// challenge, and setting the phone up, listing and turning off.
    func biometricChallenge(keyId: String) async throws -> API.BiometricChallenge
    func biometricSignIn(keyId: String, challenge: String, signature: String) async throws -> User
    func biometricRegister(keyId: String, publicKey: String, deviceName: String?) async throws
    func biometricKeys() async throws -> API.BiometricKeyList
    func biometricRemove(keyId: String) async throws -> Bool
}

extension AccountServicing {
    /// A stand-in with no photo keeps none, as a shop before migration 0076 does.
    func profilePhoto() async throws -> ProfilePhotoInfo { ProfilePhotoInfo(ready: false, url: nil) }
    func profilePhotoData(path: String) async throws -> Data? { nil }
    func uploadProfilePhoto(jpeg: Data) async throws -> ProfilePhotoInfo {
        throw APIError.server(code: "BAD_REQUEST", message: "profilePhoto.unavailable", status: 503)
    }
    func removeProfilePhoto() async throws -> ProfilePhotoInfo { ProfilePhotoInfo(ready: false, url: nil) }
    /// A stand-in offers no Apple, and every account has a password.
    func signInWays() async throws -> SignInWays { SignInWays(apple: .init(app: false, web: nil)) }
    func appleSignIn(_ proof: AppleProof, name: AppleName) async throws -> User {
        throw APIError.server(code: "PRECONDITION_FAILED", message: "auth.appleUnavailable", status: 412)
    }
    func googleSignIn(_ proof: GoogleProof) async throws -> User {
        throw APIError.server(code: "PRECONDITION_FAILED", message: "auth.googleUnavailable", status: 412)
    }
    /// A stand-in mails nothing, and so knows no code.
    func codeStart(email: String) async throws {}
    func codeSignIn(email: String, code: String) async throws -> User {
        throw APIError.server(code: "UNAUTHORIZED", message: "auth.codeWrong", status: 401)
    }
    func phoneStart(_ phone: String) async throws {
        throw APIError.server(code: "PRECONDITION_FAILED", message: "auth.phoneUnavailable", status: 412)
    }
    func phoneVerify(phone: String, code: String) async throws -> PhoneVerified {
        throw APIError.server(code: "PRECONDITION_FAILED", message: "auth.phoneUnavailable", status: 412)
    }
    func addEmailStart(_ email: String) async throws {
        throw APIError.server(code: "PRECONDITION_FAILED", message: "auth.phoneUnavailable", status: 412)
    }
    func addEmailVerify(email: String, code: String) async throws -> User {
        throw APIError.server(code: "PRECONDITION_FAILED", message: "auth.phoneUnavailable", status: 412)
    }
    func accountSignInWays() async throws -> AccountSignInWays { AccountSignInWays(password: true, apple: false) }
    /// A stand-in holds no keys, as a shop before migration 0078 does.
    func biometricChallenge(keyId: String) async throws -> API.BiometricChallenge {
        throw APIError.server(code: "PRECONDITION_FAILED", message: "auth.faceIdUnavailable", status: 412)
    }
    func biometricSignIn(keyId: String, challenge: String, signature: String) async throws -> User {
        throw APIError.server(code: "NOT_FOUND", message: "auth.faceIdOff", status: 404)
    }
    func biometricRegister(keyId: String, publicKey: String, deviceName: String?) async throws {
        throw APIError.server(code: "PRECONDITION_FAILED", message: "auth.faceIdUnavailable", status: 412)
    }
    func biometricKeys() async throws -> API.BiometricKeyList { API.BiometricKeyList(ready: false, keys: []) }
    func biometricRemove(keyId: String) async throws -> Bool { false }
}

struct AccountService: AccountServicing {
    let client: TRPCClient

    func profilePhoto() async throws -> ProfilePhotoInfo { try await client.call(API.profilePhoto) }

    func removeProfilePhoto() async throws -> ProfilePhotoInfo { try await client.call(API.removeProfilePhoto) }

    /// The photo's bytes from `GET /api/profile/photo/<id>`, which answers the
    /// account it names and nobody else — the session cookie is what it reads.
    func profilePhotoData(path: String) async throws -> Data? {
        var request = URLRequest(url: client.configuration.url(path: path))
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        let (data, response) = try await client.transport.send(request)
        return response.statusCode == 200 ? data : nil
    }

    /// The photo goes up as its own bytes (`POST /api/media/profile`), not
    /// JSON; the server reads what it is from its own header and answers
    /// `{ "error": "…" }` when it refuses one.
    func uploadProfilePhoto(jpeg: Data) async throws -> ProfilePhotoInfo {
        var request = URLRequest(url: client.configuration.url(path: "/api/media/profile"))
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = jpeg
        let answer: (Data, HTTPURLResponse)
        do {
            answer = try await client.transport.send(request)
        } catch {
            throw APIError.from(error)
        }
        let (data, response) = answer
        if (200..<300).contains(response.statusCode) {
            do {
                return try JSONDecoder().decode(ProfilePhotoInfo.self, from: data)
            } catch {
                throw APIError.decoding(String(describing: error))
            }
        }
        let reason = (try? JSONDecoder().decode(ProfilePhotoRefusal.self, from: data))?.error ?? "media.failed"
        let code = response.statusCode == 401 ? "UNAUTHORIZED" : response.statusCode == 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST"
        throw APIError.server(code: code, message: reason, status: response.statusCode)
    }

    func currentUser() async throws -> User? { try await client.call(API.me) }

    func signInWays() async throws -> SignInWays { try await client.call(API.signInWays) }

    /// Always kept signed in, as the password's sign-in is: a phone is somebody's own.
    func appleSignIn(_ proof: AppleProof, name: AppleName) async throws -> User {
        try await client.call(API.appleSignIn, .init(
            idToken: proof.idToken, nonce: proof.nonce, code: proof.code,
            firstName: name.first, lastName: name.last, remember: true
        ))
    }

    func googleSignIn(_ proof: GoogleProof) async throws -> User {
        try await client.call(API.googleSignIn, .init(idToken: proof.idToken, nonce: proof.nonce, remember: true))
    }

    func codeStart(email: String) async throws {
        _ = try await client.call(API.codeStart, .init(email: email))
    }

    func biometricChallenge(keyId: String) async throws -> API.BiometricChallenge {
        try await client.call(API.biometricChallenge, .init(keyId: keyId))
    }

    /// Always kept signed in, as every other sign-in in the app is.
    func biometricSignIn(keyId: String, challenge: String, signature: String) async throws -> User {
        try await client.call(API.biometricSignIn, .init(keyId: keyId, challenge: challenge, signature: signature, remember: true))
    }

    func biometricRegister(keyId: String, publicKey: String, deviceName: String?) async throws {
        _ = try await client.call(API.biometricRegister, .init(keyId: keyId, publicKey: publicKey, deviceName: deviceName))
    }

    func biometricKeys() async throws -> API.BiometricKeyList { try await client.call(API.biometricKeys) }

    func biometricRemove(keyId: String) async throws -> Bool {
        try await client.call(API.biometricRemove, .init(keyId: keyId)).removed
    }

    /// Always kept signed in, as every other sign-in in the app is.
    func codeSignIn(email: String, code: String) async throws -> User {
        try await client.call(API.codeSignIn, .init(email: email, code: code, remember: true))
    }

    func phoneStart(_ phone: String) async throws {
        _ = try await client.call(API.phoneStart, .init(phone: phone))
    }

    /// Always kept signed in, as every other sign-in in the app is.
    func phoneVerify(phone: String, code: String) async throws -> PhoneVerified {
        try await client.call(API.phoneVerify, .init(phone: phone, code: code, remember: true))
    }

    func addEmailStart(_ email: String) async throws {
        _ = try await client.call(API.addEmailStart, .init(email: email))
    }

    func addEmailVerify(email: String, code: String) async throws -> User {
        try await client.call(API.addEmailVerify, .init(email: email, code: code))
    }

    func accountSignInWays() async throws -> AccountSignInWays { try await client.call(API.accountSignInWays) }

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

    func resetWithCode(email: String, code: String, password: String) async throws -> RegistrationResult {
        try await client.call(API.resetWithCode, .init(email: email, code: code, password: password, remember: true))
    }

    func signOut() async throws {
        _ = try await client.call(API.signOut)
    }

    func updateName(_ name: String) async throws -> User {
        try await client.call(API.updateName, .init(name: name))
    }

    func updateNameParts(first: String, last: String) async throws -> User {
        try await client.call(API.updateNameParts, .init(firstName: first, lastName: last))
    }

    func profileDetails() async throws -> ProfileDetails { try await client.call(API.profileDetails) }

    func saveProfileDetails(_ patch: API.DetailsPatch) async throws -> ProfileDetails {
        try await client.call(API.saveProfileDetails, patch)
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

    func wishedProducts() async throws -> [String] { try await client.call(API.wishedIds) }
}

private struct ProfilePhotoRefusal: Decodable {
    let error: String
}
