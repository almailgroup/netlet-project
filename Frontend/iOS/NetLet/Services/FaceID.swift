import Foundation
import LocalAuthentication
import Observation
import Security
import UIKit

/// Signing in with Face ID (or Touch ID): `Shared/auth/biometricKey.ts` is the
/// rule. The phone makes a P-256 key in its Secure Enclave that only signs
/// after Face ID, hands NetLet the public half, and later signs a challenge
/// the server hands out. NetLet never sees a face or a fingerprint: the phone
/// checks them and answers with a signature or nothing.
///
/// **An app cannot register a face.** Faces are added in the iPhone's
/// Settings (Face ID & Passcode, and its "Set Up an Alternate Appearance" for
/// somebody else); a key made with `.biometryCurrentSet` stops working the
/// moment that set changes, so "Set up again" makes a new key bound to the
/// faces the phone holds now.

/// Which of the two the phone has.
enum BiometryKind: Equatable, Sendable {
    case faceID, touchID

    /// Its name, as the dictionary spells it in either language.
    var nameKey: String { self == .faceID ? "ios.biometric.faceId" : "ios.biometric.touchId" }
    /// The system's own symbol for it.
    var symbol: String { self == .faceID ? "faceid" : "touchid" }
}

/// What the phone can do about it.
enum BiometricState: Equatable, Sendable {
    /// Set up in Settings and usable.
    case ready(BiometryKind)
    /// The hardware is there and nothing is enrolled.
    case notEnrolled(BiometryKind)
    /// No Face ID or Touch ID, or the app may not use it.
    case absent

    var kind: BiometryKind? {
        switch self {
        case .ready(let kind), .notEnrolled(let kind): return kind
        case .absent: return nil
        }
    }
}

/// How a prompt or a key failed.
enum BiometricFailure: Error, Equatable {
    /// Closed, or another app came forward: says nothing.
    case cancelled
    /// The faces or fingerprints changed since the key was made, or the key is
    /// gone: it can never sign again.
    case changed
    /// Not enrolled, locked out, or no Secure Enclave.
    case unavailable
}

/// The keys themselves, behind a protocol so a test or the recorded demo can
/// stand in for the Secure Enclave.
@MainActor
protocol BiometricKeychain: AnyObject {
    func state() -> BiometricState
    func hasKey(_ keyId: String) -> Bool
    /// Asks for the face once, so setting up is the same press it will be to sign in.
    func confirm(reason: String) async throws
    /// A new key under `keyId` (any old one goes), answering its public half
    /// as `SecKeyCopyExternalRepresentation` gives it, in base64.
    func makeKey(_ keyId: String) throws -> String
    /// The face, then `message` signed by the key (DER, base64).
    func sign(_ keyId: String, message: Data, reason: String) async throws -> String
    func deleteKey(_ keyId: String)
}

/// The real Secure Enclave.
@MainActor
final class SecureEnclaveKeychain: BiometricKeychain {
    private static let tagPrefix = "net.netlet.face-id."

    func state() -> BiometricState {
        let context = LAContext()
        var error: NSError?
        let usable = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let kind: BiometryKind?
        switch context.biometryType {
        case .faceID: kind = .faceID
        case .touchID: kind = .touchID
        default: kind = nil
        }
        guard let kind else { return .absent }
        if usable { return .ready(kind) }
        if let code = error?.code, LAError.Code(rawValue: code) == .biometryNotEnrolled { return .notEnrolled(kind) }
        return .absent
    }

    func hasKey(_ keyId: String) -> Bool {
        var query = baseQuery(keyId)
        query[kSecReturnRef as String] = true
        // Finding the key never asks for a face; only using it does.
        let context = LAContext()
        context.interactionNotAllowed = true
        query[kSecUseAuthenticationContext as String] = context
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    func confirm(reason: String) async throws {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        do {
            _ = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
        } catch {
            throw Self.failure(error)
        }
    }

    func makeKey(_ keyId: String) throws -> String {
        deleteKey(keyId)
        guard let access = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet],
            nil
        ) else { throw BiometricFailure.unavailable }
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: Self.tag(keyId),
                kSecAttrAccessControl as String: access,
            ] as [String: Any],
        ]
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error),
              let publicKey = SecKeyCopyPublicKey(privateKey),
              let point = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?
        else { throw BiometricFailure.unavailable }
        return point.base64EncodedString()
    }

    func sign(_ keyId: String, message: Data, reason: String) async throws -> String {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        do {
            _ = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
        } catch {
            throw Self.failure(error)
        }
        // The face is checked: the key signs with this context and asks nothing more.
        var query = baseQuery(keyId)
        query[kSecReturnRef as String] = true
        query[kSecUseAuthenticationContext as String] = context
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let found = item else {
            throw BiometricFailure.changed
        }
        let key = found as! SecKey
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureMessageX962SHA256, message as CFData, &error) as Data? else {
            // A key bound to a set of faces that has changed can never sign again.
            throw BiometricFailure.changed
        }
        return signature.base64EncodedString()
    }

    func deleteKey(_ keyId: String) {
        SecItemDelete(baseQuery(keyId) as CFDictionary)
    }

    private func baseQuery(_ keyId: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrApplicationTag as String: Self.tag(keyId),
        ]
    }

    private static func tag(_ keyId: String) -> Data { Data((tagPrefix + keyId).utf8) }

    private static func failure(_ error: Error) -> BiometricFailure {
        guard let code = (error as? LAError)?.code else { return .unavailable }
        switch code {
        case .userCancel, .appCancel, .systemCancel, .userFallback: return .cancelled
        default: return .unavailable
        }
    }
}

/// The recorded demo's phone: Face ID set up, and a key for the demo shopper,
/// so the screenshots show the sign-in tile and the settings card. It signs
/// nothing a server would take.
@MainActor
final class DemoKeychain: BiometricKeychain {
    nonisolated static let keyId = "demo-face-id-key-0000000000"
    private var keys: Set<String> = [DemoKeychain.keyId]

    func state() -> BiometricState { .ready(.faceID) }
    func hasKey(_ keyId: String) -> Bool { keys.contains(keyId) }
    func confirm(reason: String) async throws {}
    func makeKey(_ keyId: String) throws -> String {
        keys.insert(keyId)
        return Data([0x04] + Array(repeating: UInt8(7), count: 64)).base64EncodedString()
    }
    func sign(_ keyId: String, message: Data, reason: String) async throws -> String {
        guard keys.contains(keyId) else { throw BiometricFailure.changed }
        return Data(repeating: 1, count: 70).base64EncodedString()
    }
    func deleteKey(_ keyId: String) { keys.remove(keyId) }
}

/// Which account each key on this phone signs in to, the offer's "Not now",
/// and setting up, signing and turning off — shared by the sign-in form, the
/// offer after signing in and the card on "Your profile".
///
/// The map is email → key id, in `UserDefaults`: an id is no secret (the
/// private half never leaves the Secure Enclave), and the form shows Face ID
/// only for an address this phone holds a key for — so nobody learns from it
/// whether an address has an account.
@Observable
@MainActor
final class FaceIDModel {
    private let keychain: BiometricKeychain
    private let defaults: UserDefaults
    /// Moves on with every change, so a view reading the map draws again.
    private(set) var revision = 0

    static let mapKey = "netlet.faceIdKeys"
    static let declinedKey = "netlet.faceIdDeclined"

    init(keychain: BiometricKeychain, defaults: UserDefaults = .standard) {
        self.keychain = keychain
        self.defaults = defaults
    }

    var state: BiometricState {
        _ = revision
        return keychain.state()
    }

    var kind: BiometryKind? { state.kind }

    /// The key this phone holds for `email`, while it can still sign.
    func keyId(for email: String) -> String? {
        _ = revision
        guard let id = storedId(for: email), keychain.hasKey(id) else { return nil }
        return id
    }

    /// Whether this phone signs in to `email` with Face ID.
    func isOn(for email: String?) -> Bool {
        guard let email else { return false }
        return keyId(for: email) != nil
    }

    /// A new key for `email` — under the id it had before, so the server
    /// replaces its public half rather than keeping a stale one — the face
    /// asked for first, and the public half registered. "Set up again" is the
    /// same call.
    func turnOn(email: String, account: AccountServicing, reason: String) async throws {
        try await keychain.confirm(reason: reason)
        let id = storedId(for: email) ?? Self.newKeyId()
        let publicKey = try keychain.makeKey(id)
        do {
            try await account.biometricRegister(keyId: id, publicKey: publicKey, deviceName: UIDevice.current.name)
        } catch {
            keychain.deleteKey(id)
            throw error
        }
        store(id, for: email)
        undecline(email)
    }

    /// Off on this phone: the server forgets the public half, and the phone the key.
    func turnOff(email: String, account: AccountServicing) async throws {
        guard let id = storedId(for: email) else { return }
        _ = try await account.biometricRemove(keyId: id)
        forget(email: email)
    }

    /// Signs the server's challenge for `email`'s key, which is the Face ID prompt.
    func sign(email: String, challenge: String, reason: String) async throws -> String {
        guard let id = keyId(for: email) else { throw BiometricFailure.changed }
        return try await keychain.sign(id, message: Data(Self.message(challenge).utf8), reason: reason)
    }

    /// The faces changed since the key was made: it goes, and its id is kept
    /// for the next set-up to reuse.
    func retire(email: String) {
        guard let id = storedId(for: email) else { return }
        keychain.deleteKey(id)
        revision += 1
    }

    /// NetLet no longer holds the key (turned off elsewhere, or the account
    /// deleted): the phone forgets it whole.
    func forget(email: String) {
        if let id = storedId(for: email) { keychain.deleteKey(id) }
        var map = self.map
        map[Self.fold(email)] = nil
        defaults.set(map, forKey: Self.mapKey)
        revision += 1
    }

    /// The key id this phone keeps for `email`, whether or not it can still sign.
    func storedId(for email: String) -> String? { map[Self.fold(email)] }

    /// "Not now" on the offer after signing in, kept so it is not asked again for this address.
    func decline(_ email: String) {
        var declined = Set(defaults.stringArray(forKey: Self.declinedKey) ?? [])
        declined.insert(Self.fold(email))
        defaults.set(Array(declined), forKey: Self.declinedKey)
    }

    func declined(_ email: String) -> Bool {
        (defaults.stringArray(forKey: Self.declinedKey) ?? []).contains(Self.fold(email))
    }

    /// What the phone signs: `biometricMessage` in `Shared/auth/biometricKey.ts`.
    nonisolated static func message(_ challenge: String) -> String { "netlet-face-id:\(challenge)" }

    /// A random, URL-safe id of 32 characters (`BIOMETRIC_KEY_ID`).
    nonisolated static func newKeyId() -> String {
        var bytes = [UInt8](repeating: 0, count: 24)
        if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
            bytes = (0..<24).map { _ in UInt8.random(in: 0...255) }
        }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The demo shopper's key, for the recorded demo.
    func adoptDemoKey(for email: String) {
        store(DemoKeychain.keyId, for: email)
    }

    private var map: [String: String] { defaults.dictionary(forKey: Self.mapKey) as? [String: String] ?? [:] }

    private func store(_ id: String, for email: String) {
        var map = self.map
        map[Self.fold(email)] = id
        defaults.set(map, forKey: Self.mapKey)
        revision += 1
    }

    private func undecline(_ email: String) {
        let declined = (defaults.stringArray(forKey: Self.declinedKey) ?? []).filter { $0 != Self.fold(email) }
        defaults.set(declined, forKey: Self.declinedKey)
    }

    private nonisolated static func fold(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}
