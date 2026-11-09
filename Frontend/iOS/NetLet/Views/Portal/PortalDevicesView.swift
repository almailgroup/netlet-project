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

/// The owner's Devices page — the web's `/admin/devices`: every install
/// waiting or authorised, those turned down or removed, and the recent
/// sign-ins to the admin side. Removing asks first, and says so when it is
/// this install.
struct PortalDevicesView: View {
    @State private var desk: DeviceDesk?
    @State private var failed: APIError?
    @State private var busy = false
    @State private var removing: AdminDeviceRow?
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
            Button(l.t("devices.revoke"), role: .destructive) { Task { await decide(row, "revoke") } }
            Button(l.t("common.cancel"), role: .cancel) { removing = nil }
        } message: { row in
            Text(l.t(row.current ? "devices.revokeBodyCurrent" : "devices.revokeBody", ["device": label(row)]))
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
        let ended = desk.devices.filter { $0.status == "denied" || $0.status == "revoked" }
        PortalSectionHeading(title: l.t("devices.waitingHeading"))
        if waiting.isEmpty {
            PortalEmpty(text: l.t("devices.noneWaiting"))
        } else {
            ForEach(waiting) { row in
                PortalCard {
                    head(row)
                    facts([("devices.askedAt", OrderWording.dateTime(row.createdAt, language: l.current)), ("devices.address", row.requestedIp)])
                    HStack(spacing: 8) {
                        Button { Task { await decide(row, "approve") } } label: { Label(l.t("devices.approve"), systemImage: "checkmark") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                        Button { Task { await decide(row, "deny") } } label: { Label(l.t("devices.deny"), systemImage: "xmark") }
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

        if !ended.isEmpty {
            PortalSectionHeading(title: l.t("devices.endedHeading"))
            ForEach(ended) { row in
                PortalCard {
                    head(row)
                    facts([(row.status == "denied" ? "devices.deniedAt" : "devices.revokedAt", row.decidedAt.map { OrderWording.dateTime($0, language: l.current) }), ("devices.address", row.lastIp ?? row.requestedIp)])
                    Button { Task { await decide(row, "approve") } } label: { Label(l.t("devices.allowAgain"), systemImage: "checkmark") }
                        .buttonStyle(PortalSmallButtonStyle(kind: .secondary))
                        .disabled(busy)
                }
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

    private func head(_ row: AdminDeviceRow) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: Self.isPhone(row.name) ? "iphone" : "desktopcomputer")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Brand.tint))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.name ?? l.t("devices.unnamed")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                        .fixedSize(horizontal: false, vertical: true)
                    if row.current { StatusPill(label: l.t("devices.thisOne"), tone: .portal("navy")) }
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

    private func decide(_ row: AdminDeviceRow, _ decision: String) async {
        busy = true
        defer { busy = false }
        let done = decision == "approve" ? "devices.approvedToast" : decision == "deny" ? "devices.deniedToast" : "devices.revokedToast"
        if await app.attempt(done: done, fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.decideDevice, .init(id: row.id, decision: decision))
        }) {
            removing = nil
            await load()
        }
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
