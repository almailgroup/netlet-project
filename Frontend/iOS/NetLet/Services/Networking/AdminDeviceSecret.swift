import Foundation
import Security

/// The secret that names this install of the app to NetLet's admin side
/// (`Shared/auth/adminDevice.ts`), on the owner's word: "only authorised
/// devices get access to the admin panel".
///
/// Thirty-two random bytes in base64url, made once and kept in this phone's
/// Keychain alone (`…ThisDeviceOnly`, so a backup restored onto another phone
/// does not carry it), and sent in `X-NetLet-Device` — but only once an
/// account on this install has turned out to be an administrator, or an
/// employee holding a grant (`enabled`), so a shopper's requests never carry
/// it. The server keeps only its SHA-256. An administrator's rights hold in
/// the app only once the owner has authorised this install.
final class AdminDeviceSecret: @unchecked Sendable {
    static let shared = AdminDeviceSecret()
    static let header = "X-NetLet-Device"

    /// Whether requests carry the secret: on from the first time an account
    /// on this install is an administrator's, and kept on.
    static let enabledKey = "netlet.adminDevice"

    var enabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }

    func enable() { UserDefaults.standard.set(true, forKey: Self.enabledKey) }

    private let service = "net.netlet.admin-device"
    private let account = "device-secret"
    private let lock = NSLock()
    private var cached: String?

    /// The secret, made the first time it is asked for. Where the Keychain
    /// will not keep it — an unsigned simulator build — it lasts this launch
    /// alone, so every request of the launch still carries the same one.
    var value: String? {
        lock.lock()
        defer { lock.unlock() }
        if let cached { return cached }
        if let stored = read() {
            cached = stored
            return stored
        }
        guard let made = Self.make() else { return nil }
        _ = write(made)
        cached = made
        return made
    }

    static func make() -> String? {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        return Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private func read() -> String? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(search as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func write(_ secret: String) -> Bool {
        var add = query
        add[kSecValueData as String] = Data(secret.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        return status == errSecSuccess || status == errSecDuplicateItem
    }
}
