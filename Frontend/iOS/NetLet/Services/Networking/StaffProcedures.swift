import Foundation

/// One role on NetLet's team — `team.desk`'s `roles`, `Shared/inventory/team.ts`.
/// A ready-made role carries its `slug` (`manager`, `finance`, `hr`…) and keeps
/// its name in the dictionary unless NetLet gave it one of its own.
struct TeamRoleRow: Decodable, Sendable, Identifiable, Hashable {
    let id: Int
    let slug: String?
    let name: String?
    let nameAr: String?
    let areas: [String]
    /// How many people hold it.
    let members: Int
    /// A role NetLet made that nobody holds; a ready-made role is never deleted.
    let deletable: Bool

    /// `roleName`: its own name in this language, the other language's, or the ready-made one's.
    @MainActor
    func shownName(_ l: LanguageSettings) -> String {
        let own = l.current == .ar ? (nameAr ?? name) : (name ?? nameAr)
        if let own, !own.isEmpty { return own }
        if let slug { return l.t("team.role.\(slug)") }
        return ""
    }
}

/// One person on the admin side: a full administrator (`roleId` nil) or a
/// member holding a role, with what the person reading may do to them —
/// the server's answer, so the page draws only what the API accepts.
struct TeamMemberRow: Decodable, Sendable, Identifiable, Hashable {
    let userId: Int
    let name: String?
    let email: String?
    let roleId: Int?
    let owner: Bool
    let you: Bool
    let addedAt: Date?
    let addedBy: String?
    let lastSignedIn: Date?
    let mayChange: Bool
    let mayRemove: Bool
    let mayMakeFull: Bool

    var id: Int { userId }
    var shownName: String { name.flatMap { $0.isEmpty ? nil : $0 } ?? email ?? "#\(userId)" }
}

/// NetLet's team page — `team.desk`. `ready` false before migration 0090.
struct TeamDesk: Decodable, Sendable {
    let ready: Bool
    let roles: [TeamRoleRow]
    let members: [TeamMemberRow]
    /// Only a full administrator changes what a role opens, or makes one.
    let mayEditRoles: Bool
    /// Only a full administrator makes somebody one.
    let mayMakeFull: Bool
}

struct TeamAdded: Decodable, Sendable {
    let userId: Int
}

struct TeamRoleMade: Decodable, Sendable {
    let id: Int
}

extension API {
    struct TeamAdd: Encodable, Sendable {
        let email: String
        /// Null makes a full administrator.
        let roleId: OrNull<Int>
    }

    struct TeamCreate: Encodable, Sendable {
        let email: String
        let password: String
        let name: OrNull<String>
        let roleId: OrNull<Int>
    }

    struct TeamSetRole: Encodable, Sendable {
        let userId: Int
        let roleId: OrNull<Int>
    }

    struct TeamMember: Encodable, Sendable {
        let userId: Int
    }

    struct TeamRoleInput: Encodable, Sendable {
        let name: String
        let nameAr: String
        let areas: [String]
    }

    struct TeamRoleUpdate: Encodable, Sendable {
        let id: Int
        let name: String
        let nameAr: String
        let areas: [String]
    }

    struct TeamRoleId: Encodable, Sendable {
        let id: Int
    }

    static let teamDesk = Procedure<NoInput, TeamDesk>(query: "team.desk")
    static let teamAdd = Procedure<TeamAdd, TeamAdded>(mutation: "team.add")
    static let teamCreate = Procedure<TeamCreate, TeamAdded>(mutation: "team.create")
    static let teamSetRole = Procedure<TeamSetRole, Acknowledged>(mutation: "team.setRole")
    static let teamRemove = Procedure<TeamMember, Acknowledged>(mutation: "team.remove")
    static let teamRoleCreate = Procedure<TeamRoleInput, TeamRoleMade>(mutation: "team.roles.create")
    static let teamRoleUpdate = Procedure<TeamRoleUpdate, Acknowledged>(mutation: "team.roles.update")
    static let teamRoleDelete = Procedure<TeamRoleId, Acknowledged>(mutation: "team.roles.delete")
}
