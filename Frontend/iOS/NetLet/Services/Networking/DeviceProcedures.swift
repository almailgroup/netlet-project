import Foundation

/// Where this install stands for an administrator's rights — `devices.access`,
/// `Shared/auth/adminDevice.ts`. `access` is `trusted`, `pending`, `none`,
/// `denied`, `revoked` or `closed` (before migration 0079 is applied).
struct DeviceAccessAnswer: Decodable, Sendable, Equatable {
    let signedIn: Bool
    let rule: Bool
    var applies: Bool?
    var access: String?
    var owner: Bool?
    var deviceName: String?
    var requestedAt: Date?

    /// The account is one the rule is about, and this install may not carry its rights.
    var heldBack: Bool { signedIn && rule && applies == true && access != "trusted" }
}

/// One device on the owner's Devices page.
struct AdminDeviceRow: Decodable, Sendable, Identifiable, Hashable {
    let id: Int
    let userId: Int
    let account: String?
    let accountName: String?
    let owner: Bool
    let name: String?
    let status: String
    let requestedIp: String?
    let approvedHow: String?
    let approvedBy: String?
    let createdAt: Date
    let decidedAt: Date?
    let lastSignInAt: Date?
    let lastSeenAt: Date?
    let lastIp: String?
    /// The install this page is being read on.
    let current: Bool
    /// Why to look twice at one that is asking: `accountBlocked`, `addressBlocked`.
    var warnings: [String]?

    /// Blocked: turned away while it waited (`denied`) or after it was authorised (`revoked`).
    var blocked: Bool { status == "denied" || status == "revoked" }

    /// In use now: seen in the last five minutes (`deviceActive`).
    func active(now: Date = Date()) -> Bool {
        guard status == "approved", let lastSeenAt else { return false }
        return now.timeIntervalSince(lastSeenAt) < 5 * 60
    }

    /// When a blocked device last tried to sign in, if it has since it was blocked.
    var triedAt: Date? {
        guard blocked, let lastSignInAt, let decidedAt, lastSignInAt > decidedAt else { return nil }
        return lastSignInAt
    }
}

/// One sign-in to the admin side, from the audit trail.
struct AdminSignIn: Decodable, Sendable, Identifiable, Hashable {
    let id: Int
    let at: Date
    let account: String?
    let address: String?
    let device: String?
    /// `authorised`, `waiting`, `refused`, or `unknown` for one from before devices.
    let outcome: String
}

/// The owner's Devices page — `devices.desk`. `ready` false before 0079.
struct DeviceDesk: Decodable, Sendable {
    let ready: Bool
    let devices: [AdminDeviceRow]
    let signIns: [AdminSignIn]
    /// How many devices are blocked in all, where the list shows only the newest.
    var blockedTotal: Int?
}

struct DevicesRemoved: Decodable, Sendable {
    let removed: Int
}

struct DeviceAccessReply: Decodable, Sendable {
    let access: String
}

struct DeviceCodeSent: Decodable, Sendable {
    let sent: Bool
    let email: String
}

struct DeviceDecided: Decodable, Sendable {
    let id: Int
    let status: String
}

extension API {
    struct DeviceCode: Encodable, Sendable {
        let code: String
    }

    struct DeviceDecision: Encodable, Sendable {
        let id: Int
        /// `approve`, `block` (it can never ask again) or `remove` (it is
        /// forgotten, and may ask again) — `deviceMove` on the server.
        let decision: String
    }

    struct DeviceRename: Encodable, Sendable {
        let id: Int
        let name: String
    }

    static let deviceAccess = Procedure<NoInput, DeviceAccessAnswer>(query: "devices.access")
    static let deviceRequest = Procedure<NoInput, DeviceAccessReply>(mutation: "devices.request")
    static let deviceCodeStart = Procedure<NoInput, DeviceCodeSent>(mutation: "devices.codeStart")
    static let deviceCodeVerify = Procedure<DeviceCode, DeviceAccessReply>(mutation: "devices.codeVerify")
    static let deviceDesk = Procedure<NoInput, DeviceDesk>(query: "devices.desk")
    static let devicesWaiting = Procedure<NoInput, Int>(query: "devices.waiting")
    static let decideDevice = Procedure<DeviceDecision, DeviceDecided>(mutation: "devices.decide")
    static let renameDevice = Procedure<DeviceRename, Acknowledged>(mutation: "devices.rename")
    static let removeOtherDevices = Procedure<NoInput, DevicesRemoved>(mutation: "devices.removeOthers")
}
