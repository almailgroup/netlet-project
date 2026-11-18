import SwiftUI

/// NetLet's team — the web's `/admin/staff` (`Shared/inventory/team.ts`), on
/// the owner's word: "the admin can assign roles to the people that can get
/// access to the admin panel, like Manager, Finance, HR".
///
/// **People** is everybody on NetLet's side: a full administrator, or a member
/// holding a role, with the role changed where it is drawn and Take off the
/// team asking first. Somebody is added by the email of an account they have,
/// or with a new account made here. **Roles** are the seven ready-made ones and
/// any NetLet made, each saying what it opens; only a full administrator
/// changes what a role opens or makes a new one, and HR (anybody whose role
/// opens Team) manages the members alone.
///
/// Nothing here decides: every row carries what the server says this person
/// may do to it (`mayChange`, `mayRemove`, `mayMakeFull`), and the server asks
/// each question again when it is pressed.
struct PortalStaffView: View {
    private enum Tab: Hashable { case people, roles }

    @State private var desk: TeamDesk?
    @State private var failed: APIError?
    @State private var tab: Tab = .people
    @State private var busy = false
    @State private var editing: RoleDraft?
    @State private var changing: (member: TeamMemberRow, roleId: Int?)?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("team.title"), intro: l.t("team.description"), refresh: { await load() }) {
            if let desk {
                if !desk.ready {
                    PortalEmpty(text: "\(l.t("team.unavailableTitle")). \(l.t("team.unavailableBody"))")
                } else {
                    PortalSegmented(label: l.t("team.views"), value: $tab, options: [
                        (.people, "\(l.t("team.tabPeople")) (\(desk.members.count))"),
                        (.roles, "\(l.t("team.tabRoles")) (\(desk.roles.count))"),
                    ])
                    switch tab {
                    case .people: people(desk)
                    case .roles: roles(desk)
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
        .sheet(item: $editing) { draft in
            RoleEditorSheet(draft: draft) { saved in
                editing = nil
                if saved { Task { await load() } }
            }
            .languageDirection()
        }
        .alert(changeTitle, isPresented: Binding(get: { changing != nil }, set: { if !$0 { changing = nil } })) {
            Button(changing?.roleId == nil ? l.t("team.makeFullConfirm") : l.t("team.changeRoleConfirm")) {
                if let changing { Task { await setRole(changing.member, changing.roleId) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { changing = nil }
        } message: {
            Text(changeBody)
        }
    }

    // MARK: People

    @ViewBuilder
    private func people(_ desk: TeamDesk) -> some View {
        AddToTeamCard(desk: desk) { await load() }
        PortalSectionHeading(title: l.t("team.membersTitle"))
        ForEach(desk.members) { member in memberCard(member, desk) }
    }

    private func memberCard(_ member: TeamMemberRow, _ desk: TeamDesk) -> some View {
        let role = member.roleId.flatMap { id in desk.roles.first { $0.id == id } }
        return PortalCard(highlighted: member.you) {
            VStack(alignment: .leading, spacing: 4) {
                FlowLayout(spacing: 6) {
                    Text(member.shownName).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                    StatusPill(label: role?.shownName(l) ?? l.t("team.fullAdmin"), tone: .portal(role == nil ? "navy" : "neutral"))
                    if member.owner { StatusPill(label: l.t("team.owner"), tone: .portal("good")) }
                    if member.you { StatusPill(label: l.t("team.you"), tone: .portal("neutral")) }
                }
                if let email = member.email, email != member.shownName {
                    Text(latin(email)).font(.inter(13)).foregroundStyle(Brand.body).lineLimit(1).truncationMode(.middle)
                }
                Text(l.t("team.opens", ["areas": opens(role?.areas)]))
                    .font(.inter(13)).foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
                Text(dates(member)).font(.inter(12)).foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if member.owner {
                Text(l.t("team.ownerNote")).font(.inter(13)).foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            } else if member.mayChange || member.mayRemove {
                HStack(spacing: 8) {
                    if member.mayChange {
                        Menu {
                            ForEach(desk.roles) { option in
                                Button {
                                    if option.id != member.roleId { changing = (member, option.id) }
                                } label: {
                                    if option.id == member.roleId { Label(option.shownName(l), systemImage: "checkmark") } else { Text(option.shownName(l)) }
                                }
                            }
                            if member.mayMakeFull {
                                Button { changing = (member, nil) } label: { Text(l.t("team.fullAdmin")) }
                            }
                        } label: {
                            MenuField(text: role?.shownName(l) ?? l.t("team.fullAdmin"), placeholder: l.t("team.role"))
                        }
                        .accessibilityLabel(l.t("team.changeRoleLabel", ["name": isolated(member.shownName)]))
                    }
                    if member.mayRemove {
                        Button { Task { await remove(member) } } label: { Label(l.t("team.removeButton"), systemImage: "person.badge.minus") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    }
                }
                .disabled(busy)
            }
        }
    }

    private func opens(_ areas: [String]?) -> String {
        guard let areas else { return l.t("team.fullAdminNote") }
        let order = PortalRules.shared.team?.areas ?? areas
        return order.filter { areas.contains($0) }.map { l.t("team.area.\($0)") }.joined(separator: l.current == .ar ? "، " : ", ")
    }

    private func dates(_ member: TeamMemberRow) -> String {
        var parts: [String] = []
        if let added = member.addedAt {
            let day = OrderWording.date(added, language: l.current)
            parts.append(member.addedBy.map { l.t("team.addedBy", ["date": day, "name": isolated($0)]) } ?? l.t("team.addedOn", ["date": day]))
        }
        parts.append(member.lastSignedIn.map { l.t("team.lastIn", ["date": OrderWording.date($0, language: l.current)]) } ?? l.t("team.neverIn"))
        return parts.joined(separator: " · ")
    }

    private var changeTitle: String {
        guard let changing else { return "" }
        let name = isolated(changing.member.shownName)
        guard let roleId = changing.roleId else { return l.t("team.makeFullTitle", ["name": name]) }
        let role = desk?.roles.first { $0.id == roleId }?.shownName(l) ?? ""
        return l.t("team.changeRoleTitle", ["name": name, "role": isolated(role)])
    }

    private var changeBody: String {
        guard let changing else { return "" }
        return changing.roleId == nil ? l.t("team.makeFullBody") : l.t("team.changeRoleBody", ["name": isolated(changing.member.shownName)])
    }

    // MARK: Roles

    @ViewBuilder
    private func roles(_ desk: TeamDesk) -> some View {
        if desk.mayEditRoles {
            Button { editing = RoleDraft(role: nil) } label: { Label(l.t("team.newRole"), systemImage: "plus") }
                .buttonStyle(PrimaryButtonStyle())
        } else {
            PortalNotice(text: l.t("team.rolesFullOnlyNote"))
        }
        ForEach(desk.roles) { role in
            PortalCard {
                VStack(alignment: .leading, spacing: 4) {
                    FlowLayout(spacing: 6) {
                        Text(role.shownName(l)).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                        if role.slug != nil { StatusPill(label: l.t("team.readyMade"), tone: .portal("neutral")) }
                    }
                    Text(l.t("team.membersCount", ["count": "\(role.members)"])).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                    Text(l.t("team.opens", ["areas": opens(role.areas)])).font(.inter(13)).foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if desk.mayEditRoles {
                    HStack(spacing: 8) {
                        Button { editing = RoleDraft(role: role) } label: { Label(l.t("team.edit"), systemImage: "pencil") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
                            .accessibilityLabel(l.t("team.editRole", ["name": isolated(role.shownName(l))]))
                        if role.deletable {
                            Button { Task { await deleteRole(role) } } label: { Label(l.t("team.deleteRole"), systemImage: "trash") }
                                .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                        }
                    }
                    .disabled(busy)
                }
            }
        }
    }

    // MARK: Acts

    private func load() async {
        do {
            desk = try await app.services.api.call(API.teamDesk)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, desk == nil { failed = failure }
        }
    }

    private func setRole(_ member: TeamMemberRow, _ roleId: Int?) async {
        busy = true
        defer { busy = false }
        changing = nil
        _ = await app.attempt(done: "team.roleChanged", fallback: "admin.saveFailed") {
            _ = try await app.services.api.call(API.teamSetRole, .init(userId: member.userId, roleId: OrNull(roleId)))
        }
        await load()
    }

    private func remove(_ member: TeamMemberRow) async {
        let name = isolated(member.shownName)
        guard await RemovalQuestion.ask(l, title: l.t("team.removeTitle", ["name": name]), message: l.t("team.removeBody", ["name": name]),
                                        confirm: l.t("team.removeButton")) else { return }
        busy = true
        defer { busy = false }
        _ = await app.attempt(done: "team.removed", fallback: "admin.saveFailed") {
            _ = try await app.services.api.call(API.teamRemove, .init(userId: member.userId))
        }
        await load()
    }

    private func deleteRole(_ role: TeamRoleRow) async {
        guard await RemovalQuestion.ask(l, title: l.t("team.deleteRoleTitle", ["name": isolated(role.shownName(l))]),
                                        message: l.t("team.deleteRoleBody"), confirm: l.t("team.deleteRoleConfirm")) else { return }
        busy = true
        defer { busy = false }
        _ = await app.attempt(done: "team.roleDeleted", fallback: "admin.saveFailed") {
            _ = try await app.services.api.call(API.teamRoleDelete, .init(id: role.id))
        }
        await load()
    }

    private func isolated(_ text: String) -> String { "\u{2068}\(text)\u{2069}" }
}

/// Somebody put on the team: by the email of an account they have, or with a
/// new account and the password they sign in with, and the role to hold.
private struct AddToTeamCard: View {
    let desk: TeamDesk
    let reload: () async -> Void
    @State private var fresh = false
    @State private var email = ""
    @State private var name = ""
    @State private var password = ""
    /// The role chosen, the first to start with; `fullChoice` for a full administrator.
    @State private var roleId: Int?
    @State private var problems: [String: String] = [:]
    @State private var refusal: String?
    @State private var adding = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private static let fullChoice = -1

    var body: some View {
        PortalCard {
            Text(l.t("team.addTitle")).font(.inter(17, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("team.signInNote", ["portal": portalHost])).font(.inter(13)).foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            PortalSegmented(label: l.t("team.addTitle"), value: $fresh, options: [(false, l.t("team.addHas")), (true, l.t("team.addNew"))])
            LabeledField(label: l.t("team.email"), text: $email, problem: problems["email"].map { l.t($0) },
                         keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
            if fresh {
                LabeledField(label: "\(l.t("team.name")) (\(l.t("admin.optional")))", text: $name, content: .name)
                LabeledField(label: l.t("team.password"), text: $password, problem: problems["password"].map { l.t($0) },
                             content: .newPassword, secure: true, leftToRight: true)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("team.role")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                Menu {
                    ForEach(desk.roles) { role in
                        Button(role.shownName(l)) { roleId = role.id }
                    }
                    if desk.mayMakeFull {
                        Button(l.t("team.fullAdmin")) { roleId = Self.fullChoice }
                    }
                } label: {
                    MenuField(text: roleId == nil ? nil : chosenName, placeholder: l.t("team.role"))
                }
                .accessibilityLabel(l.t("team.role"))
                if roleId != nil {
                    Text(l.t("team.opens", ["areas": chosenOpens])).font(.inter(13)).foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let refusal {
                PortalNotice(text: l.t(refusal), tone: .danger)
            }
            Button { Task { await add() } } label: {
                Label(l.t(adding ? "team.adding" : "team.addButton"), systemImage: "person.badge.plus").frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(adding || roleId == nil)
        }
        /* The first role is chosen to start with, the web's form's rule. */
        .onAppear { if roleId == nil { roleId = firstChoice } }
    }

    /// Where a member signs in: the admin portal on the shop's own domain.
    private var portalHost: String {
        let shop = (app.services.configuration.baseURL.host() ?? "netlet.net").replacingOccurrences(of: "www.", with: "")
        return "admin.\(shop)"
    }

    private var firstChoice: Int? { desk.roles.first?.id ?? (desk.mayMakeFull ? Self.fullChoice : nil) }

    private var chosenRole: TeamRoleRow? { roleId.flatMap { id in desk.roles.first { $0.id == id } } }

    private var chosenName: String {
        if roleId == Self.fullChoice { return l.t("team.fullAdmin") }
        return chosenRole?.shownName(l) ?? l.t("team.role")
    }

    private var chosenOpens: String {
        if roleId == Self.fullChoice { return l.t("team.fullAdminNote") }
        let areas = chosenRole?.areas ?? []
        return (PortalRules.shared.team?.areas ?? areas).filter { areas.contains($0) }.map { l.t("team.area.\($0)") }
            .joined(separator: l.current == .ar ? "، " : ", ")
    }

    private func add() async {
        var found: [String: String] = [:]
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if address.isEmpty || Validation.emailProblem(address) != nil { found["email"] = "team.emailNeeded" }
        if fresh && !Validation.checkPassword(password).acceptable { found["password"] = "team.passwordNeeded" }
        problems = found
        refusal = nil
        guard found.isEmpty, let roleId else { return }
        let role = OrNull(roleId == Self.fullChoice ? nil : roleId)
        adding = true
        defer { adding = false }
        do {
            if fresh {
                _ = try await app.services.api.call(API.teamCreate, .init(email: address, password: password, name: .text(name), roleId: role))
            } else {
                _ = try await app.services.api.call(API.teamAdd, .init(email: address, roleId: role))
            }
            Haptics.succeeded()
            app.toast(l.t("team.added"))
            email = ""; name = ""; password = ""; self.roleId = firstChoice
            await reload()
        } catch {
            let failure = APIError.from(error)
            guard failure != .cancelled else { return }
            Haptics.refused()
            let key = failure.messageKey(knownKey: Phrasebook.shared.has)
            refusal = key == "error.serverProblem" ? "admin.saveFailed" : key
        }
    }
}

/// A role being written: a new one (`role` nil) or one NetLet already has.
struct RoleDraft: Identifiable {
    let role: TeamRoleRow?
    var id: Int { role?.id ?? 0 }
}

/// A role's names and what it opens — a full administrator's alone. Each
/// problem is said under its box with Save (`roleProblems`, the server's own).
private struct RoleEditorSheet: View {
    let draft: RoleDraft
    let done: (Bool) -> Void
    @State private var name = ""
    @State private var nameAr = ""
    @State private var areas: Set<String> = []
    @State private var problems: [String: String] = [:]
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: PortalRules.TeamRules? { PortalRules.shared.team }
    private var ready: Bool { draft.role?.slug != nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    LabeledField(label: l.t("team.roleNameEn"), text: $name, hint: ready ? l.t("team.roleNameHint") : nil,
                                 problem: problems["name"].map { l.t($0) })
                    LabeledField(label: l.t("team.roleNameAr"), text: $nameAr, problem: problems["nameAr"].map { l.t($0) })
                    VStack(alignment: .leading, spacing: 10) {
                        Text(l.t("team.areasLabel")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                        ForEach(rules?.areas ?? [], id: \.self) { area in
                            Toggle(isOn: Binding(get: { areas.contains(area) }, set: { on in
                                if on { areas.insert(area) } else { areas.remove(area) }
                            })) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(l.t("team.area.\(area)")).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                                    Text(l.t("team.area.\(area)Note")).font(.inter(12)).foregroundStyle(Brand.muted)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .tint(Brand.navy)
                        }
                        if let problem = problems["areas"] {
                            Text(l.t(problem)).font(.inter(13)).foregroundStyle(Brand.danger)
                        }
                    }
                    Button { Task { await save() } } label: { Text(l.t("team.saveRole")).frame(maxWidth: .infinity) }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(saving)
                }
                .padding(16)
            }
            .navigationTitle(draft.role.map { l.t("team.editRole", ["name": "\u{2068}\($0.shownName(l))\u{2069}"]) } ?? l.t("team.newRole"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("team.cancel")) { done(false) }
                }
            }
        }
        .onAppear {
            name = draft.role?.name ?? ""
            nameAr = draft.role?.nameAr ?? ""
            areas = Set(draft.role?.areas ?? [])
        }
    }

    private func save() async {
        let chosen = (rules?.areas ?? []).filter { areas.contains($0) }
        problems = rules?.problems(name: name, nameAr: nameAr, areas: chosen, ready: ready) ?? [:]
        guard problems.isEmpty else { return }
        saving = true
        defer { saving = false }
        let saved = await app.attempt(done: draft.role == nil ? "team.roleCreated" : "team.roleSaved", fallback: "admin.saveFailed") {
            if let role = draft.role {
                _ = try await app.services.api.call(API.teamRoleUpdate, .init(id: role.id, name: name, nameAr: nameAr, areas: chosen))
            } else {
                _ = try await app.services.api.call(API.teamRoleCreate, .init(name: name, nameAr: nameAr, areas: chosen))
            }
        }
        if saved { done(true) }
    }
}
