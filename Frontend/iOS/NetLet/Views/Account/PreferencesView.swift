import SwiftUI

/// The account's preferences — the web's `AccountPreferences`: the language,
/// the delivery area, and which notices the shopper hears.
struct PreferencesView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { PreferencesModel(api: app.services.api, account: app.services.account) }) { model in
            ShopPage(header: false, refresh: { await model.load() }) {
                AccountSection(title: l.t("account.sectionPreferences"), hint: l.t("account.hint.preferences")) {
                    VStack(spacing: 14) {
                        panel(symbol: "globe", title: "account.language", note: "account.languageNote") { language }
                        panel(symbol: "mappin", title: "account.deliveryArea", note: "account.pricingUnconfigured") { area(model) }
                        panel(symbol: "bell", title: "account.notifications", note: "account.notificationsNote") { notices(model) }
                    }
                }
            }
            .task { await model.load() }
        }
    }

    /// One setting: its icon, name and a line on what it changes, then the control.
    private func panel<Control: View>(symbol: String, title: String, note: String, @ViewBuilder control: () -> Control) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 36, height: 36)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t(title)).font(.inter(16, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                    Text(l.t(note)).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            control()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var language: some View {
        HStack(spacing: 10) {
            ForEach([Language.en, .ar], id: \.self) { code in
                ChoiceChip(title: l.t(code == .en ? "account.english" : "account.arabic"), selected: l.current == code, available: true) {
                    app.setLanguage(code)
                }
            }
        }
    }

    private func area(_ model: PreferencesModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            let zone = ReferenceData.shared.governorate(id: model.zone)
            Text(zone.map { l.t("account.zoneSelected", ["name": $0.name(l.current)]) } ?? l.t("account.chooseZone"))
                .font(.inter(14, .semibold))
                .foregroundStyle(Brand.ink)
            Text(l.t("delivery.governorate")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            Menu {
                ForEach(ReferenceData.shared.governorates) { governorate in
                    Button(governorate.name(l.current)) {
                        Task { await app.attempt { try await model.setZone(governorate.id) } }
                    }
                }
            } label: {
                MenuField(text: zone?.name(l.current), placeholder: l.t("delivery.selectGovernorate"))
            }
            .accessibilityLabel(l.t("delivery.governorate"))
        }
    }

    private func notices(_ model: PreferencesModel) -> some View {
        VStack(spacing: 0) {
            ForEach(ReferenceData.shared.rules.accountRules.notificationKinds, id: \.kind) { kind in
                Toggle(isOn: Binding(
                    get: { model.enabled(kind) },
                    set: { on in Task { await app.attempt { try await model.set(kind.kind, enabled: on) } } }
                )) {
                    Text(l.t(kind.label)).font(.inter(14)).foregroundStyle(Brand.ink)
                }
                .tint(Brand.navy)
                .disabled(model.switching)
                .frame(minHeight: 48)
                if kind != ReferenceData.shared.rules.accountRules.notificationKinds.last { Divider() }
            }
        }
    }
}

@Observable
@MainActor
final class PreferencesModel {
    private(set) var zone: String?
    private(set) var stored: [String: Bool] = [:]
    private(set) var switching = false
    private let api: APICalling
    private let account: AccountServicing

    init(api: APICalling, account: AccountServicing) {
        self.api = api
        self.account = account
    }

    func load() async {
        if let profile = try? await account.profile() { zone = profile.deliveryZoneId }
        if let preferences = try? await api.call(API.noticePreferences) {
            stored = Dictionary(preferences.map { ($0.kind, $0.enabled) }, uniquingKeysWith: { _, last in last })
        }
    }

    /// A kind the shopper never set reads its default (`defaultNotificationPreferences`).
    func enabled(_ kind: Rules.Account.NoticeKind) -> Bool {
        stored[kind.kind] ?? kind.enabledByDefault
    }

    func set(_ kind: String, enabled: Bool) async throws {
        switching = true
        defer { switching = false }
        let before = stored[kind]
        stored[kind] = enabled
        do {
            _ = try await api.call(API.setNoticePreference, .init(kind: kind, enabled: enabled))
        } catch {
            stored[kind] = before
            throw error
        }
    }

    func setZone(_ id: String) async throws {
        let profile = try await api.call(API.setDeliveryArea, .init(deliveryZoneId: id))
        zone = profile.deliveryZoneId ?? id
    }
}
