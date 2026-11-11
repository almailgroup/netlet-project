import SwiftUI

/// What the app's portal shows an account whose rights are held back on this
/// install — the web's `DeviceGate` (`Shared/auth/adminDevice.ts`), on the
/// owner's word: "only authorised devices get access to the admin panel".
///
/// Nothing of the portal is drawn, only where this install stands and the
/// one thing that can be done about it: wait for the owner (asked again every
/// five seconds, so the portal opens by itself once they approve), ask if it
/// has not asked yet, or — for the owner — authorise it with a code emailed
/// to the owner's own address.
struct DeviceGateView: View {
    let onAuthorised: () async -> Void
    @State private var answer: DeviceAccessAnswer?
    @State private var failed: APIError?
    @State private var asking = false
    @State private var refusal: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let answer {
                content(answer)
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 160)
            }
        }
        .task { await watch() }
    }

    private var state: String {
        let access = answer?.access ?? "none"
        return access == "trusted" ? "pending" : access
    }

    private func content(_ answer: DeviceAccessAnswer) -> some View {
        PortalCard {
            let refused = state == "denied" || state == "revoked"
            Image(systemName: refused ? "xmark.shield" : state == "closed" ? "exclamationmark.shield" : "checkmark.shield")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(refused ? Brand.danger : Brand.navy)
                .frame(width: 48, height: 48)
                .background(Circle().fill(refused ? Brand.danger.opacity(0.1) : Brand.tint))
                .accessibilityHidden(true)
            Text(l.t(Self.titles[state] ?? "devices.noneTitle"))
                .font(.inter(20, .bold)).foregroundStyle(Brand.navy)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(l.t(Self.bodies[state] ?? "devices.noneBody"))
                .font(.inter(15)).foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
            if let name = answer.deviceName {
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(l.t("devices.thisDevice")): \(name)").font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                    if state == "pending", let asked = answer.requestedAt {
                        Text("\(l.t("devices.askedAt")): \(OrderWording.dateTime(asked, language: l.current))")
                            .font(.inter(13)).foregroundStyle(Brand.muted)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Calm.field))
            }
            if state == "pending" {
                HStack(spacing: 8) {
                    ProgressView().tint(Brand.muted)
                    Text(l.t("devices.waitingLive")).font(.inter(13)).foregroundStyle(Brand.muted)
                }
                if answer.owner == true {
                    OwnerDeviceCode(onAuthorised: onAuthorised)
                }
            }
            if state == "none" {
                Button {
                    Task { await ask() }
                } label: {
                    Text(l.t("devices.askButton")).frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(asking)
                if let refusal {
                    Text(l.t(refusal)).font(.inter(13)).foregroundStyle(Brand.danger)
                }
            }
        }
    }

    private static let titles: [String: String] = [
        "pending": "devices.waitingTitle",
        "none": "devices.noneTitle",
        "denied": "devices.deniedTitle",
        "revoked": "devices.revokedTitle",
        "closed": "devices.closedTitle",
    ]

    private static let bodies: [String: String] = [
        "pending": "devices.waitingBody",
        "none": "devices.noneBody",
        "denied": "devices.deniedBody",
        "revoked": "devices.revokedBody",
        "closed": "devices.closedBody",
    ]

    /// Asks again every five seconds while the install waits; once the owner
    /// says yes, the portal is drawn with its rights. An install that has not
    /// asked yet asks at once — the web's portal does as the sign-in lands —
    /// since opening the portal is asking.
    private func watch() async {
        await load()
        if answer?.access == "none", answer?.applies == true {
            _ = try? await app.services.api.call(API.deviceRequest)
        }
        while !Task.isCancelled {
            await load()
            if answer?.access == "trusted" || answer?.heldBack == false {
                await onAuthorised()
                return
            }
            guard answer?.access == "pending" else { return }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }

    private func load() async {
        do {
            answer = try await app.services.api.call(API.deviceAccess)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, answer == nil { failed = failure }
        }
    }

    private func ask() async {
        asking = true
        defer { asking = false }
        do {
            _ = try await app.services.api.call(API.deviceRequest)
            refusal = nil
            await watch()
        } catch {
            refusal = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
        }
    }
}

/// The owner's own install: a code to the owner's address, in the sign-in's
/// six boxes, sent by itself on the sixth digit.
private struct OwnerDeviceCode: View {
    let onAuthorised: () async -> Void
    private enum Field: Hashable { case code }
    @State private var sentTo: String?
    @State private var code = ""
    @State private var lastTried = ""
    @State private var refusal: String?
    @State private var working = false
    @FocusState private var focus: Field?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let sentTo {
                Text(l.t("devices.codeSentTo", ["email": sentTo]))
                    .font(.inter(14)).foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
                CodeBoxes(code: $code, label: l.t("auth.codeLabel"), invalid: refusal != nil, focus: $focus, field: .code)
                    .onAppear { focus = .code }
                    .onChange(of: code) { _, value in
                        let digits = Validation.normaliseCode(value)
                        if refusal == "auth.codeWrong" { refusal = nil }
                        if digits.count == 6, digits != lastTried, !working {
                            lastTried = digits
                            Task { await verify(digits) }
                        }
                    }
                Button {
                    Task { await verify(Validation.normaliseCode(code)) }
                } label: {
                    Text(l.t("devices.authoriseButton")).frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(working)
                Button(l.t("auth.resendCode")) { Task { await send() } }
                    .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
                    .disabled(working)
            } else {
                Text(l.t("devices.ownerCodeNote"))
                    .font(.inter(14)).foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { await send() }
                } label: {
                    Text(l.t("devices.emailMeCode")).frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(working)
            }
            if let refusal {
                Text(l.t(refusal)).font(.inter(13)).foregroundStyle(Brand.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
    }

    private func send() async {
        working = true
        defer { working = false }
        do {
            sentTo = try await app.services.api.call(API.deviceCodeStart).email
            refusal = nil
        } catch {
            refusal = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
        }
    }

    private func verify(_ digits: String) async {
        guard digits.count == 6 else {
            refusal = digits.isEmpty ? "auth.codeRequired" : "auth.codeShape"
            focus = .code
            return
        }
        working = true
        defer { working = false }
        do {
            _ = try await app.services.api.call(API.deviceCodeVerify, .init(code: digits))
            refusal = nil
            Haptics.succeeded()
            await onAuthorised()
        } catch {
            refusal = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            focus = .code
        }
    }
}

/// The owner's Devices page — the web's `/admin/devices`: under their
/// counts, every install waiting (Approve, or Decline), every one authorised
/// (Rename, or Remove) and every one blocked (Unblock, or Authorise), then
/// the recent sign-ins to the admin side.
///
/// **Taking a device off asks what happens afterwards, on the owner's word**
/// ("decide whether they can be logged in and added again or blocked
/// forever"): Decline and Remove each ask, with one answer that takes the
/// device off the list so it may ask again and one that blocks it for good.
/// This install can be removed but not blocked, since a block here could only
/// be undone from another device. A device that asks says so when its account
/// or its address already has a blocked device, and "Remove all other
/// devices" is the one press for a password that may have leaked.
struct PortalDevicesView: View {
    @State private var desk: DeviceDesk?
    @State private var failed: APIError?
    @State private var busy = false
    @State private var removing: AdminDeviceRow?
    @State private var declining: AdminDeviceRow?
    @State private var authorising: AdminDeviceRow?
    @State private var clearing = false
    @State private var renaming: AdminDeviceRow?
    @State private var name = ""
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("devices.title"), intro: l.t("devices.intro"), refresh: { await load() }) {
            if let desk {
                if !desk.ready {
                    PortalEmpty(text: l.t("devices.closedDesk"))
                } else {
                    sections(desk)
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
        .alert(l.t("devices.revokeTitle"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), presenting: removing) { row in
            Button(l.t("devices.revoke"), role: .destructive) { Task { await decide(row, "remove", done: "devices.revokedToast") } }
            if !row.current {
                Button(l.t("devices.removeAndBlock"), role: .destructive) { Task { await decide(row, "block", done: "devices.blockedToast") } }
            }
            Button(l.t("common.cancel"), role: .cancel) { removing = nil }
        } message: { row in
            Text(question(l.t(row.current ? "devices.revokeBodyCurrent" : "devices.revokeBody", ["device": label(row)]), plain: "devices.revoke", block: row.current ? nil : "devices.removeAndBlock", current: row.current))
        }
        .alert(l.t("devices.declineTitle"), isPresented: Binding(get: { declining != nil }, set: { if !$0 { declining = nil } }), presenting: declining) { row in
            Button(l.t("devices.deny"), role: .destructive) { Task { await decide(row, "remove", done: "devices.deniedToast") } }
            Button(l.t("devices.declineAndBlock"), role: .destructive) { Task { await decide(row, "block", done: "devices.blockedToast") } }
            Button(l.t("common.cancel"), role: .cancel) { declining = nil }
        } message: { row in
            Text(question(l.t("devices.declineBody", ["device": label(row)]), plain: "devices.deny", block: "devices.declineAndBlock", current: false))
        }
        .alert(l.t("devices.authoriseTitle"), isPresented: Binding(get: { authorising != nil }, set: { if !$0 { authorising = nil } }), presenting: authorising) { row in
            Button(l.t("devices.allowAgain")) { Task { await decide(row, "approve", done: "devices.approvedToast") } }
            Button(l.t("common.cancel"), role: .cancel) { authorising = nil }
        } message: { row in
            Text(l.t("devices.authoriseBody", ["device": label(row)]))
        }
        .alert(l.t("devices.removeOthersTitle"), isPresented: $clearing) {
            Button(l.t("devices.removeOthers"), role: .destructive) { Task { await removeOthers() } }
            Button(l.t("common.cancel"), role: .cancel) { clearing = false }
        } message: {
            Text(l.t("devices.removeOthersBody"))
        }
        .alert(l.t("devices.renameTitle"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }), presenting: renaming) { row in
            TextField(l.t("devices.nameLabel"), text: $name)
            Button(l.t("devices.save")) { Task { await rename(row) } }
            Button(l.t("common.cancel"), role: .cancel) { renaming = nil }
        } message: { _ in
            Text(l.t("devices.renameBody"))
        }
    }

    @ViewBuilder
    private func sections(_ desk: DeviceDesk) -> some View {
        let waiting = desk.devices.filter { $0.status == "pending" }
        let authorised = desk.devices.filter { $0.status == "approved" }
        let blocked = desk.devices.filter { $0.blocked }
        let blockedTotal = desk.blockedTotal ?? blocked.count
        HStack(alignment: .top, spacing: 8) {
            PortalStat(label: l.t("devices.waitingHeading"), value: "\(waiting.count)")
            PortalStat(label: l.t("devices.authorisedHeading"), value: "\(authorised.count)")
            PortalStat(label: l.t("devices.endedHeading"), value: "\(blockedTotal)")
        }
        if authorised.contains(where: { $0.current }), authorised.contains(where: { !$0.current }) {
            Button { clearing = true } label: { Label(l.t("devices.removeOthers"), systemImage: "xmark.shield") }
                .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                .disabled(busy)
        }

        PortalSectionHeading(title: l.t("devices.waitingHeading"))
        if waiting.isEmpty {
            PortalEmpty(text: l.t("devices.noneWaiting"))
        } else {
            ForEach(waiting) { row in
                PortalCard {
                    head(row)
                    ForEach(row.warnings ?? [], id: \.self) { warning in
                        if let key = Self.warningKeys[warning] {
                            PortalNotice(text: l.t(key), tone: .warning)
                        }
                    }
                    facts([("devices.askedAt", OrderWording.dateTime(row.createdAt, language: l.current)), ("devices.address", row.requestedIp)])
                    HStack(spacing: 8) {
                        Button { Task { await decide(row, "approve", done: "devices.approvedToast") } } label: { Label(l.t("devices.approve"), systemImage: "checkmark") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                        Button { declining = row } label: { Label(l.t("devices.deny"), systemImage: "xmark") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    }
                    .disabled(busy)
                }
            }
        }

        PortalSectionHeading(title: l.t("devices.authorisedHeading"), note: l.t("devices.authorisedNote"))
        if authorised.isEmpty {
            PortalEmpty(text: l.t("devices.noneAuthorised"))
        } else {
            ForEach(authorised) { row in
                PortalCard(highlighted: row.current) {
                    head(row)
                    facts([
                        ("devices.authorisedAt", authorisedLine(row)),
                        ("devices.lastSignIn", row.lastSignInAt.map { OrderWording.dateTime($0, language: l.current) } ?? l.t("devices.never")),
                        ("devices.lastActive", row.lastSeenAt.map { OrderWording.dateTime($0, language: l.current) } ?? l.t("devices.never")),
                        ("devices.address", row.lastIp ?? row.requestedIp),
                    ])
                    HStack(spacing: 8) {
                        Button { name = row.name ?? ""; renaming = row } label: { Label(l.t("devices.rename"), systemImage: "pencil") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
                        Button { removing = row } label: { Label(l.t("devices.revoke"), systemImage: "xmark.shield") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    }
                    .disabled(busy)
                }
            }
        }

        PortalSectionHeading(title: l.t("devices.endedHeading"), note: l.t("devices.blockedNote"))
        if blocked.isEmpty {
            PortalEmpty(text: l.t("devices.noneBlocked"))
        } else {
            ForEach(blocked) { row in
                PortalCard {
                    head(row)
                    Text(l.t(row.status == "revoked" ? "devices.hadAccess" : "devices.neverHadAccess"))
                        .font(.inter(13)).foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                    facts([
                        ("devices.deniedAt", row.decidedAt.map { OrderWording.dateTime($0, language: l.current) }),
                        ("devices.triedAt", row.triedAt.map { OrderWording.dateTime($0, language: l.current) }),
                        ("devices.address", row.lastIp ?? row.requestedIp),
                    ])
                    HStack(spacing: 8) {
                        Button { Task { await decide(row, "remove", done: "devices.unblockedToast") } } label: { Label(l.t("devices.unblock"), systemImage: "arrow.uturn.backward") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
                        Button { authorising = row } label: { Label(l.t("devices.allowAgain"), systemImage: "checkmark") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
                    }
                    .disabled(busy)
                }
            }
            if blockedTotal > blocked.count {
                Text(l.t("devices.blockedMore", ["shown": "\(blocked.count)", "total": "\(blockedTotal)"]))
                    .font(.inter(13)).foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        PortalSectionHeading(title: l.t("devices.signInsHeading"), note: l.t("devices.signInsNote"))
        if desk.signIns.isEmpty {
            PortalEmpty(text: l.t("devices.noSignIns"))
        } else {
            PortalCard {
                ForEach(desk.signIns) { entry in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(entry.account ?? "—").font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                                .lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: 6)
                            StatusPill(label: l.t(outcomeKey(entry.outcome)), tone: .portal(outcomeTone(entry.outcome)))
                        }
                        Text([OrderWording.dateTime(entry.at, language: l.current), entry.device, entry.address].compactMap { $0 }.joined(separator: " · "))
                            .font(.inter(12)).foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)
                    if entry.id != desk.signIns.last?.id { Divider() }
                }
            }
        }
    }

    /// The warnings a device that asks can carry, by the server's names for them.
    private static let warningKeys: [String: String] = [
        "accountBlocked": "devices.warnAccount",
        "addressBlocked": "devices.warnAddress",
    ]

    private func head(_ row: AdminDeviceRow) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: row.blocked ? "nosign" : Self.isPhone(row.name) ? "iphone" : "desktopcomputer")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(row.blocked ? Brand.danger : Brand.navy)
                .frame(width: 40, height: 40)
                .background(Circle().fill(row.blocked ? Brand.danger.opacity(0.1) : Brand.tint))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(row.name ?? l.t("devices.unnamed")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
                if row.current || row.active() {
                    HStack(spacing: 6) {
                        if row.current { StatusPill(label: l.t("devices.thisOne"), tone: .portal("navy")) }
                        if row.active() { StatusPill(label: l.t("devices.activeNow"), tone: .portal("good")) }
                    }
                }
                HStack(spacing: 6) {
                    Text(row.account ?? "#\(row.userId)").font(.inter(13)).foregroundStyle(Brand.body)
                        .lineLimit(1).truncationMode(.middle)
                    if row.owner { StatusPill(label: l.t("devices.yourAccount"), tone: .portal("neutral")) }
                }
            }
        }
    }

    private func facts(_ rows: [(String, String?)]) -> some View {
        let shown = rows.compactMap { row in row.1.map { "\(l.t(row.0)): \($0)" } }
        return VStack(alignment: .leading, spacing: 3) {
            ForEach(shown.indices, id: \.self) { index in
                Text(shown[index]).font(.inter(13)).foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// What a question says under its title: what happens now, then what each
    /// answer means for afterwards, by the words on its button.
    private func question(_ body: String, plain: String, block: String?, current: Bool) -> String {
        var lines = [body, "\(l.t(plain)): \(l.t("devices.choiceAskAgainNote"))"]
        if let block { lines.append("\(l.t(block)): \(l.t("devices.choiceBlockNote"))") }
        if current { lines.append(l.t("devices.blockCurrentNote")) }
        return lines.joined(separator: "\n\n")
    }

    /// A phone or a tablet, by the name the device gave, for its picture.
    private static func isPhone(_ name: String?) -> Bool {
        let name = name ?? ""
        return ["iPhone", "iPad", "Android"].contains { name.contains($0) }
    }

    /// When the device was authorised, and how.
    private func authorisedLine(_ row: AdminDeviceRow) -> String? {
        guard let decided = row.decidedAt else { return nil }
        let when = OrderWording.dateTime(decided, language: l.current)
        guard let how = how(row) else { return when }
        return "\(when) · \(how)"
    }

    private func how(_ row: AdminDeviceRow) -> String? {
        switch row.approvedHow {
        case "email-code": return l.t("devices.howCode")
        case "owner": return l.t("devices.howOwner")
        default: return nil
        }
    }

    private func label(_ row: AdminDeviceRow) -> String {
        "\(row.account ?? "#\(row.userId)") · \(row.name ?? l.t("devices.unnamed"))"
    }

    private func outcomeKey(_ outcome: String) -> String {
        switch outcome {
        case "authorised": return "devices.outcomeAuthorised"
        case "waiting": return "devices.outcomeWaiting"
        case "refused": return "devices.outcomeRefused"
        default: return "devices.outcomeUnknown"
        }
    }

    private func outcomeTone(_ outcome: String) -> String {
        switch outcome {
        case "authorised": return "good"
        case "waiting": return "warning"
        case "refused": return "danger"
        default: return "neutral"
        }
    }

    private func load() async {
        do {
            desk = try await app.services.api.call(API.deviceDesk)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, desk == nil { failed = failure }
        }
    }

    /// One decision about one device — `approve`, `block` or `remove` — saying
    /// `done` when it lands. The list is read again either way: a refusal is
    /// usually somebody else having decided first.
    private func decide(_ row: AdminDeviceRow, _ decision: String, done: String) async {
        busy = true
        defer { busy = false }
        _ = await app.attempt(done: done, fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.decideDevice, .init(id: row.id, decision: decision))
        })
        removing = nil
        declining = nil
        authorising = nil
        await load()
    }

    private func removeOthers() async {
        busy = true
        defer { busy = false }
        clearing = false
        do {
            let answer = try await app.services.api.call(API.removeOtherDevices)
            app.toast(l.t(answer.removed > 0 ? "devices.removedOthersToast" : "devices.noOthersToast"))
        } catch {
            let refusal = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            Haptics.refused()
            app.toast(l.t(refusal == "error.serverProblem" ? "admin.saveFailed" : refusal))
        }
        await load()
    }

    private func rename(_ row: AdminDeviceRow) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            app.toast(l.t("devices.nameEmpty"))
            return
        }
        busy = true
        defer { busy = false }
        if await app.attempt(done: "devices.renamedToast", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.renameDevice, .init(id: row.id, name: String(trimmed.prefix(80))))
        }) {
            renaming = nil
            await load()
        }
    }
}
