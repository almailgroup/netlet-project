import Foundation
import Security

/// What the app leaves for its home screen widgets, on the owner's word
/// (option 8 of the list, "a home screen widget"): the shop's language, whether
/// somebody is signed in, and the newest order on its way, its words composed
/// by the app as the Lock Screen's are (`OrderActivityContent`). An extension
/// has no cookie and no session, so it cannot ask NetLet about an order; it
/// reads this instead.
struct WidgetSnapshot: Codable, Equatable, Sendable {
    /// "en" or "ar": the app's own language, which the deals widget reads too.
    var language: String
    var signedIn: Bool
    /// The newest order on its way, or nil when nothing is.
    var order: Order?
    /// When the app wrote it: the order's words are as old as this.
    var written: Date

    struct Order: Codable, Equatable, Sendable {
        var reference: String
        var state: OrderActivityAttributes.ContentState
    }

    var rightToLeft: Bool { language == "ar" }
}

/// Where the snapshot is kept: an item in a Keychain group the app and the
/// widget extension share (`keychain-access-groups`, `<team>.<app>.shared`).
/// A Keychain group needs no registration in the Apple Developer site, which
/// an App Group would, so the TestFlight build signs as it always has. The
/// item is kept after the phone's first unlock, because a widget is drawn while
/// the phone is locked, and never leaves this phone.
enum SharedShelf {
    static let service = "net.netlet.widgets"
    static let account = "snapshot"

    /// The widget's read: no group named, so every group the extension may
    /// read is searched — which is the shared one alone.
    static func read() -> WidgetSnapshot? {
        let search: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(search as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try? decoder.decode(WidgetSnapshot.self, from: data)
    }

    /// The app's write, into the shared group by name. Answers whether it
    /// took: an unsigned build (the simulator's tests) has no such group, and
    /// the widgets then say to open NetLet.
    @discardableResult
    static func write(_ snapshot: WidgetSnapshot) -> Bool {
        guard let group = sharedGroup else { return false }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        guard let data = try? encoder.encode(snapshot) else { return false }
        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: group,
        ]
        let changes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(item as CFDictionary, changes as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        return SecItemAdd(item.merging(changes) { _, new in new } as CFDictionary, nil) == errSecSuccess
    }

    /// `<team>.<app>.shared`: the name from Info.plist (`NetLetSharedKeychain`,
    /// a build setting, so another bundle identifier carries its own), the
    /// team from the app's own default Keychain group, which is
    /// `<team>.<app>`. Nil where either cannot be read.
    static var sharedGroup: String? {
        guard let name = Bundle.main.object(forInfoDictionaryKey: "NetLetSharedKeychain") as? String,
              !name.isEmpty, !name.contains("$("), let team = teamPrefix else { return nil }
        return "\(team).\(name)"
    }

    /// The team's prefix, read off a small item the app keeps in its own
    /// default group: a Keychain item always names the group it is in.
    private static let teamPrefix: String? = {
        let probe: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "net.netlet.team",
            kSecAttrAccount as String: "team",
        ]
        var search = probe
        search[kSecReturnAttributes as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        var status = SecItemCopyMatching(search as CFDictionary, &found)
        if status == errSecItemNotFound {
            var add = probe
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            add[kSecReturnAttributes as String] = true
            status = SecItemAdd(add as CFDictionary, &found)
        }
        guard status == errSecSuccess,
              let attributes = found as? [String: Any],
              let group = attributes[kSecAttrAccessGroup as String] as? String,
              let team = group.split(separator: ".").first, !team.isEmpty else { return nil }
        return String(team)
    }()
}
