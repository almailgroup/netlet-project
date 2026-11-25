import SwiftUI

/// The ways a store lets its shoppers pay — the web's `StorePayments`, on the
/// owner's word ("the vendor can choose what payment method they want users to
/// buy their products with"): cash on delivery with its limit, KNET, a card and
/// Apple Pay, any of them and one at least. On the store's own "Ways to pay"
/// page for its owner and managers, and on a store's page for NetLet.
///
/// The server decides what can be saved: until 0093 is pasted the online three
/// cannot be turned off (`ready`), and while checkout takes none of them yet
/// (`live`) the card says so, and warns a store turning cash off that its
/// shoppers cannot pay it at all.
struct StorePaymentsCard: View {
    /// The store named, or nil for the store the person asking acts for.
    let vendorId: Int?
    var editable = true
    /// Whether the card names itself — a section of a store's page does, the
    /// store's own page has the title already.
    var titled = true

    @State private var view: StorePaymentsView?
    @State private var failed: APIError?
    @State private var cod = true
    @State private var online: [String] = []
    @State private var ceiling = ""
    @State private var tried = false
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private static let symbols = ["cod": "banknote", "knet": "building.columns", "card": "creditcard", "apple_pay": "iphone"]
    private static let hints = ["cod": "storePay.codHint", "knet": "storePay.knetHint", "card": "storePay.cardHint", "apple_pay": "storePay.applePayHint"]

    var body: some View {
        PortalCard {
            if titled {
                Text(l.t("storePay.title")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            }
            Text(l.t("storePay.intro")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if let view {
                form(view)
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func form(_ view: StorePaymentsView) -> some View {
        if !view.ready {
            PortalNotice(text: l.t("storePay.notOpen"))
        } else if !view.live {
            PortalNotice(text: l.t("storePay.onlineSoon"))
        }
        ForEach(StorePaymentRules.shared.methods, id: \.self) { method in
            if method != StorePaymentRules.shared.methods.first { Divider() }
            Toggle(isOn: binding(method, view)) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: Self.symbols[method] ?? "creditcard")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 34, height: 34)
                        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Brand.navy.opacity(0.06)))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.t(StorePay.key(method))).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                        Text(l.t(Self.hints[method] ?? "")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .tint(Brand.navy)
            .disabled(locked(method, view))
        }
        if tried, let problem = none(view) {
            Text(l.t(problem)).font(.inter(13, .semibold)).foregroundStyle(Brand.danger).fixedSize(horizontal: false, vertical: true)
        }
        Divider()
        LabeledField(label: l.t("storePay.cashLimit"), text: $ceiling, placeholder: "0.000", hint: l.t("storePay.cashLimitHint"),
                     problem: tried ? ceilingProblem : nil, keyboard: .decimalPad, leftToRight: true)
            .disabled(!editable || !cod || saving)
        if !cod && !view.live {
            PortalNotice(text: l.t("storePay.cashOffWarning"), tone: .warning)
        }
        if editable {
            Button {
                Task { await save(view) }
            } label: {
                HStack(spacing: 6) {
                    if saving { ProgressView().tint(.white) } else { Image(systemName: "checkmark") }
                    Text(l.t(saving ? "admin.saving" : "admin.save"))
                }
            }
            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
            .disabled(saving || (!changed(view) && !tried))
        }
    }

    // MARK: The rules

    private var typedCeiling: String { PhoneNumber.foldDigits(ceiling).trimmingCharacters(in: .whitespaces) }

    private var ceilingProblem: String? {
        guard cod, !typedCeiling.isEmpty else { return nil }
        return typedCeiling.range(of: #"^\d{1,9}(\.\d{1,3})?$"#, options: .regularExpression) == nil ? l.t("storePay.badCeiling") : nil
    }

    /// The online ways as they would be saved: all three until 0093 is pasted.
    private func onlineSaved(_ view: StorePaymentsView) -> [String] { view.ready ? StorePay.clean(online) : StorePay.online }

    private func none(_ view: StorePaymentsView) -> String? { StorePay.problem(cod: cod, online: onlineSaved(view)) }

    private func changed(_ view: StorePaymentsView) -> Bool {
        cod != view.cod
            || (cod && (typedCeiling.isEmpty ? nil : typedCeiling) != view.codCeiling)
            || (view.ready && StorePay.clean(online) != view.online)
    }

    private func locked(_ method: String, _ view: StorePaymentsView) -> Bool {
        !editable || saving || (method != "cod" && !view.ready)
    }

    private func binding(_ method: String, _ view: StorePaymentsView) -> Binding<Bool> {
        Binding {
            method == "cod" ? cod : onlineSaved(view).contains(method)
        } set: { on in
            if method == "cod" {
                cod = on
            } else {
                online = StorePay.online.filter { $0 == method ? on : online.contains($0) }
            }
        }
    }

    // MARK: Reading and saving

    private func adopt(_ view: StorePaymentsView) {
        self.view = view
        cod = view.cod
        online = view.online
        ceiling = view.codCeiling ?? ""
        tried = false
    }

    private func load() async {
        failed = nil
        do {
            adopt(try await app.services.api.call(API.storePayments, .init(vendorId: vendorId)))
        } catch {
            if APIError.from(error) != .cancelled { failed = APIError.from(error) }
        }
    }

    private func save(_ view: StorePaymentsView) async {
        tried = true
        if let problem = none(view) {
            AccessibilityNotification.Announcement(l.t(problem)).post()
            Haptics.refused()
            return
        }
        if let ceilingProblem {
            AccessibilityNotification.Announcement(ceilingProblem).post()
            Haptics.refused()
            return
        }
        saving = true
        defer { saving = false }
        var saved: StorePaymentsView?
        _ = await app.attempt(done: "storePay.saved", fallback: "admin.saveFailed") {
            saved = try await app.services.api.call(API.setStorePayments, .init(
                vendorId: vendorId, cod: cod, codCeiling: cod ? (typedCeiling.isEmpty ? nil : typedCeiling) : nil, online: onlineSaved(view)))
        }
        if let saved { adopt(saved) }
    }
}

/// The ways a store lets its shoppers pay, for its owner and managers — the
/// web's `/admin/payment-methods`. An administrator belongs to no store: each
/// store's are a section of its own page, which is what this says.
struct PortalPaymentMethodsView: View {
    @State private var round = 0
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let vendorId = app.session.seller?.ownVendor
        PortalScreen(title: l.t("storePay.title"), refresh: { round += 1 }) {
            if vendorId != nil {
                /* Made afresh on a pull, so the card reads its ways again. */
                StorePaymentsCard(vendorId: nil, titled: false).id(round)
            } else {
                Text(l.t("storePay.adminElsewhere")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true).card(padding: 14)
            }
        }
    }
}
