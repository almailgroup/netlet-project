import SwiftUI

/// The reset mail's six-digit code and the new password, on one screen — the
/// web's `ResetByCode`, drawn under sign-in's "Check your email" and under
/// Account security's "Forgot your current password?". The link in the same
/// mail still works; this is the way the form asks for.
struct ResetByCodeFields: View {
    let email: String
    /// Saving signed in: the account, as the server answered it.
    let signedIn: (User) async -> Void
    /// A sign-up whose code never came back: its own code step takes it from here.
    var verify: ((String, String) -> Void)? = nil
    @Environment(AppModel.self) private var app

    var body: some View {
        ModelHost(make: { ResetByCodeModel(email: email, account: app.services.account) }) { model in
            ResetByCodeForm(model: model, signedIn: signedIn, verify: verify)
        }
    }
}

private struct ResetByCodeForm: View {
    @Bindable var model: ResetByCodeModel
    let signedIn: (User) async -> Void
    let verify: ((String, String) -> Void)?
    @Environment(LanguageSettings.self) private var l
    @FocusState private var focus: Field?

    enum Field { case code, password }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LabeledField(
                label: l.t("auth.codeLabel"),
                text: $model.code,
                placeholder: "000000",
                problem: model.tried ? (model.codeProblem ?? (model.refusalIsCode ? model.refusal : nil)) : nil,
                keyboard: .numberPad,
                content: .oneTimeCode,
                leftToRight: true
            )
            .focused($focus, equals: .code)
            .onChange(of: model.code) { _, value in
                model.codeChanged()
                // A whole code moves on to the password, the way a phone's own fields do.
                if Validation.normaliseCode(value).count == 6, model.password.isEmpty { focus = .password }
            }
            LabeledField(
                label: l.t("account.newPassword"),
                text: $model.password,
                problem: model.tried ? model.passwordProblem : nil,
                content: .newPassword,
                secure: true,
                leftToRight: true
            )
            .focused($focus, equals: .password)
            .onChange(of: model.password) { _, _ in model.passwordChanged() }
            let long = model.password.count >= ReferenceData.shared.rules.passwordFloor
            Label(l.t("auth.ruleLength"), systemImage: long ? "checkmark.circle.fill" : "circle")
                .font(.footnote)
                .foregroundStyle(long ? Brand.success : Brand.muted)
                .accessibilityValue(l.t(long ? "auth.ruleMet" : "auth.ruleNotMet"))
            if let refusal = model.refusal, !model.refusalIsCode {
                FieldProblem(key: refusal)
            }
            Button {
                Task { await save() }
            } label: {
                if model.working {
                    HStack(spacing: 8) { ProgressView().tint(.white); Text(l.t("auth.signingIn")) }
                } else {
                    Text(l.t("auth.newPasswordSave"))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.working)
        }
    }

    private func save() async {
        switch await model.finish() {
        case .signedIn(let user)?:
            await signedIn(user)
        case .verify(let email, let password)?:
            verify?(email, password)
        case nil:
            Haptics.refused()
            if model.codeProblem != nil || model.refusalIsCode { focus = .code } else { focus = .password }
        }
    }
}
