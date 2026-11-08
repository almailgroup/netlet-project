import SwiftUI

/// "Sign in faster with Face ID?", asked once an account has signed in on
/// this phone some other way — a password, a code, Apple or Google — and only
/// where the phone has Face ID set up and NetLet can keep a key (`ready`).
/// "Not now" is remembered for the address, so it is asked once.
struct FaceIDOfferSheet: View {
    let offer: FaceIDOffer
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var working = false

    var body: some View {
        let kind = l.t(offer.kind.nameKey)
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: offer.kind.symbol)
                    .font(.system(size: 34, weight: .regular))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 72, height: 72)
                    .background(Circle().fill(Calm.sky))
                    .accessibilityHidden(true)
                    .padding(.top, 8)
                Text(l.t("ios.biometric.offerTitle", ["kind": kind]))
                    .font(.inter(21, .heavy))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                Text(l.t("ios.biometric.offerBody", ["kind": kind]))
                    .font(.inter(15))
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: 10) {
                    Button {
                        Task {
                            working = true
                            let on = await app.turnOnFaceID(email: offer.email)
                            working = false
                            if on { dismiss() }
                        }
                    } label: {
                        if working {
                            ProgressView().tint(.white)
                        } else {
                            Label(l.t("ios.biometric.offerYes", ["kind": kind]), systemImage: offer.kind.symbol)
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(working)
                    Button(l.t("ios.biometric.offerNo")) {
                        app.faceID.decline(offer.email)
                        dismiss()
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(working)
                }
                .padding(.top, 6)
            }
            .padding(20)
            .frame(maxWidth: .infinity)
            .sheetFit(initial: 360)
        }
        .background(Color.white.ignoresSafeArea())
        .presentationDragIndicator(.visible)
        .languageDirection()
        .buttonStyle(HapticDefaultStyle())
    }
}

/// Face ID on "Your profile": on or off for this phone, "Set up again" for a
/// face added since (the phone's own, or somebody else's as an alternate
/// appearance — added in the iPhone's Settings, which an app cannot do), and
/// the other phones the account has it on, each with Remove.
///
/// Drawn only where the server can keep a key (`ready`, after migration 0078)
/// and the phone has Face ID or Touch ID; a phone with nothing enrolled is
/// told to set it up in Settings first.
struct FaceIDCard: View {
    let email: String
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var keys: API.BiometricKeyList?
    @State private var working = false
    @State private var removing: API.BiometricKey?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let keys, keys.ready, let kind = app.faceID.kind {
                card(kind: kind, keys: keys.keys)
            }
        }
        .task { await load() }
        .alert(
            l.t("ios.biometric.removeName", ["kind": l.t(app.faceID.kind?.nameKey ?? "ios.biometric.faceId"), "device": removing.map(deviceName) ?? ""]),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
            presenting: removing
        ) { key in
            Button(l.t("ios.biometric.remove"), role: .destructive) {
                Task { await remove(key) }
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        }
    }

    private func card(kind: BiometryKind, keys: [API.BiometricKey]) -> some View {
        let name = l.t(kind.nameKey)
        let on = app.faceID.isOn(for: email)
        let thisPhone = app.faceID.storedId(for: email)
        let others = keys.filter { $0.keyId != thisPhone }
        let enrolled: Bool = { if case .ready = app.faceID.state { return true } else { return false } }()
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: kind.symbol)
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Calm.sky))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(name)
                        .font(.inter(17, .bold))
                        .foregroundStyle(Brand.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(l.t(!enrolled ? "ios.biometric.notEnrolled" : on ? "ios.biometric.cardOn" : "ios.biometric.cardOff", ["kind": name]))
                        .font(.inter(14))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if enrolled {
                if on {
                    VStack(alignment: .leading, spacing: 8) {
                        Button {
                            Task { await turnOn() }
                        } label: {
                            if working { ProgressView().tint(Brand.navy) } else { Label(l.t("ios.biometric.setUpAgain"), systemImage: "arrow.triangle.2.circlepath") }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(working)
                        Text(l.t("ios.biometric.setUpAgainNote"))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Button(l.t("ios.biometric.turnOff")) {
                        Task { await turnOff(name: name) }
                    }
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.danger)
                    .frame(minHeight: 44)
                    .buttonStyle(.tap)
                    .disabled(working)
                } else {
                    Button {
                        Task { await turnOn() }
                    } label: {
                        if working { ProgressView().tint(.white) } else { Label(l.t("ios.biometric.turnOn"), systemImage: kind.symbol) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(working)
                }
            }
            if !others.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text(l.t("ios.biometric.otherDevices", ["kind": name]))
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.ink)
                        .padding(.bottom, 4)
                    ForEach(others) { key in
                        HStack(spacing: 12) {
                            Image(systemName: "iphone")
                                .font(.system(size: 16))
                                .foregroundStyle(Brand.muted)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(deviceName(key))
                                    .font(.inter(15, .semibold))
                                    .foregroundStyle(Brand.ink)
                                    .lineLimit(1)
                                Text(lastUsed(key))
                                    .font(.inter(13))
                                    .foregroundStyle(Brand.muted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Button(l.t("ios.biometric.remove")) { removing = key }
                                .font(.inter(14, .bold))
                                .foregroundStyle(Brand.danger)
                                .frame(minHeight: 44)
                                .buttonStyle(.tap)
                                .accessibilityLabel(l.t("ios.biometric.removeName", ["kind": name, "device": deviceName(key)]))
                        }
                        .padding(.vertical, 6)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        .padding(.bottom, 16)
    }

    private func deviceName(_ key: API.BiometricKey) -> String {
        key.deviceName.map { "\u{2068}\($0)\u{2069}" } ?? l.t("ios.biometric.thisPhone")
    }

    private func lastUsed(_ key: API.BiometricKey) -> String {
        guard let at = key.lastUsedAt else { return l.t("ios.biometric.neverUsed") }
        let day = at.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(l.current.locale))
        return l.t("ios.biometric.lastUsed", ["date": "\u{2068}\(day)\u{2069}"])
    }

    private func load() async {
        keys = try? await app.services.account.biometricKeys()
    }

    private func turnOn() async {
        working = true
        _ = await app.turnOnFaceID(email: email)
        await load()
        working = false
    }

    private func turnOff(name: String) async {
        working = true
        defer { working = false }
        do {
            try await app.faceID.turnOff(email: email, account: app.services.account)
            Haptics.succeeded()
            app.toast(l.t("ios.biometric.turnedOff", ["kind": name]))
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            if failure != .cancelled { app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has))) }
        }
        await load()
    }

    private func remove(_ key: API.BiometricKey) async {
        do {
            _ = try await app.services.account.biometricRemove(keyId: key.keyId)
            Haptics.succeeded()
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            if failure != .cancelled { app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has))) }
        }
        await load()
    }
}
