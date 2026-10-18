import SwiftUI

/// Sign in, create account and reset — one form, the web's `AuthForm`, drawn
/// as the Account tab while signed out and as a sheet where a screen needs an
/// account to go on.
struct AuthView: View {
    var inSheet = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { AuthViewModel(account: app.services.account) }) { model in
            AuthForm(model: model)
        }
        .background(Brand.ground.ignoresSafeArea())
        .navigationTitle(l.t("auth.signInTitle"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct AuthForm: View {
    @Bindable var model: AuthViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @FocusState private var focus: Field?

    enum Field: Hashable {
        case name, email, password, code
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 18) {
                    switch model.step {
                    case .form:
                        form
                    case .code(let email, _, _, let fromRegister):
                        codeStep(email: email, fromRegister: fromRegister)
                    case .resetSent(let email):
                        resetSent(email: email)
                    }
                }
                .padding(4)
                .card()
                .padding(16)
                benefits
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .task(id: model.mode) { await model.prepare() }
    }

    @ViewBuilder
    private var form: some View {
        if model.mode != .reset {
            Picker("", selection: $model.mode) {
                Text(l.t("auth.signInTitle")).tag(AuthViewModel.Mode.signIn)
                Text(l.t("auth.createTitle")).tag(AuthViewModel.Mode.register)
            }
            .pickerStyle(.segmented)
        }
        VStack(alignment: .leading, spacing: 6) {
            if model.mode == .register {
                Text(l.t("auth.stepOf", ["step": "1", "total": "2"])).font(.footnote.weight(.semibold)).foregroundStyle(Brand.muted)
            }
            Text(l.t(title)).font(.title2.weight(.bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t(note)).font(.subheadline).foregroundStyle(Brand.muted)
        }
        if model.mode == .register {
            LabeledField(label: l.t("auth.name") + " " + l.t("auth.optional"), text: $model.name, hint: l.t("auth.nameHint"), content: .name)
                .focused($focus, equals: .name)
        }
        LabeledField(
            label: l.t("auth.email"),
            text: $model.email,
            problem: model.submitted ? model.emailProblem : nil,
            keyboard: .emailAddress,
            content: .username,
            leftToRight: true
        )
        .focused($focus, equals: .email)
        if model.mode != .reset {
            LabeledField(
                label: l.t("auth.password"),
                text: $model.password,
                problem: model.submitted ? model.passwordProblem : nil,
                content: model.mode == .register ? .newPassword : .password,
                secure: true,
                leftToRight: true
            )
            .focused($focus, equals: .password)
            if model.mode == .register {
                Label(l.t("auth.ruleLength"), systemImage: model.password.count >= 10 ? "checkmark.circle.fill" : "circle")
                    .font(.footnote)
                    .foregroundStyle(model.password.count >= 10 ? Brand.success : Brand.muted)
                    .accessibilityValue(l.t(model.password.count >= 10 ? "auth.ruleMet" : "auth.ruleNotMet"))
            } else {
                Button(l.t("auth.forgot")) { model.mode = .reset }
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
            }
        }
        if model.mode == .register, let key = model.captchaSiteKey {
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("auth.captchaLabel")).font(.subheadline.weight(.semibold))
                CaptchaView(siteKey: key, origin: app.services.configuration.baseURL, language: l.current) { token in
                    model.captchaToken = token
                }
                // A token is good once: a fresh box after every attempt.
                .id(model.captchaGeneration)
                .frame(height: 84)
                FieldProblem(key: model.submitted ? model.captchaProblem : nil)
            }
        }
        if let refusal = model.refusal {
            VStack(alignment: .leading, spacing: 6) {
                FieldProblem(key: refusal)
                if model.offersReset {
                    Button(l.t("auth.resetInstead")) { model.mode = .reset }.font(.subheadline.weight(.semibold))
                }
                if model.offersSignIn {
                    Button(l.t("auth.signInInstead")) { model.mode = .signIn }.font(.subheadline.weight(.semibold))
                }
            }
        }
        Button {
            Task { await submit() }
        } label: {
            if model.working {
                HStack(spacing: 8) { ProgressView().tint(.white); Text(l.t(workingLabel)) }
            } else {
                Text(l.t(submitLabel))
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(model.working)
        if model.mode == .register {
            Text(l.t("auth.codeWillBeSent")).font(.footnote).foregroundStyle(Brand.muted)
            Text(l.t("auth.terms")).font(.footnote).foregroundStyle(Brand.muted)
        }
        if model.mode == .reset {
            Button(l.t("auth.resetBack")) { model.mode = .signIn }
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        }
    }

    private func codeStep(email: String, fromRegister: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            if fromRegister {
                Text(l.t("auth.stepOf", ["step": "2", "total": "2"])).font(.footnote.weight(.semibold)).foregroundStyle(Brand.muted)
            }
            Text(l.t("auth.verifyTitle")).font(.title2.weight(.bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t(fromRegister ? "auth.verifyBody" : "auth.verifyBodySignIn", ["email": email])).font(.subheadline).foregroundStyle(Brand.ink)
            LabeledField(
                label: l.t("auth.codeLabel"),
                text: $model.code,
                placeholder: "000000",
                problem: model.submitted ? (model.codeProblem ?? model.refusal) : nil,
                keyboard: .numberPad,
                content: .oneTimeCode,
                leftToRight: true
            )
            .focused($focus, equals: .code)
            .onAppear { focus = .code }
            if let resent = model.resentTo {
                Text(l.t("auth.codeResent", ["email": resent])).font(.footnote).foregroundStyle(Brand.success)
            }
            Text(l.t("auth.codeTip")).font(.footnote).foregroundStyle(Brand.muted)
            Button {
                Task {
                    if let user = await model.confirm() { await app.signedIn(user) }
                }
            } label: {
                if model.working {
                    HStack(spacing: 8) { ProgressView().tint(.white); Text(l.t("auth.verifying")) }
                } else {
                    Text(l.t(fromRegister ? "auth.verifyCreate" : "auth.verifySignIn"))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.working)
            Button(model.resendWait > 0 ? l.t("auth.resendCodeIn", ["seconds": "\(model.resendWait)"]) : l.t("auth.resendCode")) {
                Task { await model.resend() }
            }
            .disabled(model.resendWait > 0)
            .font(.subheadline.weight(.semibold))
            .frame(minHeight: 44)
            Button(l.t("auth.differentEmail")) { model.backToForm() }
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        }
    }

    private func resetSent(email: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "envelope.badge").font(.system(size: 36)).foregroundStyle(Brand.navy).accessibilityHidden(true)
            Text(l.t("auth.resetSentTitle")).font(.title2.weight(.bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("auth.resetSentBody", ["email": email])).font(.subheadline).foregroundStyle(Brand.ink)
            Text(l.t("auth.resetSentTip")).font(.footnote).foregroundStyle(Brand.muted)
            Button(model.resendWait > 0 ? l.t("auth.resendIn", ["seconds": "\(model.resendWait)"]) : l.t("auth.resend")) {
                Task { await model.resend() }
            }
            .disabled(model.resendWait > 0)
            .buttonStyle(SecondaryButtonStyle())
            Button(l.t("auth.differentEmail")) { model.backToForm() }.font(.subheadline.weight(.semibold)).frame(minHeight: 44)
            Button(l.t("auth.resetBack")) { model.mode = .signIn }.font(.subheadline.weight(.semibold)).frame(minHeight: 44)
        }
    }

    /// What the account does, under the form: never seller counts or testimonials.
    private var benefits: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(l.t("auth.asideTitle")).font(.headline).foregroundStyle(.white)
            benefit("shippingbox", "auth.benefitOrders", "auth.benefitOrdersNote")
            benefit("bolt", "auth.benefitCheckout", "auth.benefitCheckoutNote")
            benefit("heart", "auth.benefitLists", "auth.benefitListsNote")
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Brand.navy))
        .overlay(alignment: .top) { Rectangle().fill(Brand.orange).frame(height: 3).padding(.horizontal, 24) }
        .padding(.horizontal, 16)
        .padding(.bottom, 24)
    }

    private func benefit(_ icon: String, _ title: String, _ note: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundStyle(Brand.orange).frame(width: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t(title)).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                Text(l.t(note)).font(.footnote).foregroundStyle(.white.opacity(0.85))
            }
        }
    }

    private var title: String {
        switch model.mode {
        case .signIn: return "auth.signInTitle"
        case .register: return "auth.createTitle"
        case .reset: return "auth.resetTitle"
        }
    }

    private var note: String {
        switch model.mode {
        case .signIn: return "auth.signInNote"
        case .register: return "auth.createNote"
        case .reset: return "auth.resetNote"
        }
    }

    private var submitLabel: String {
        switch model.mode {
        case .signIn: return "auth.signInTitle"
        case .register: return "auth.continue"
        case .reset: return "auth.resetSend"
        }
    }

    private var workingLabel: String {
        switch model.mode {
        case .signIn: return "auth.signingIn"
        case .register: return "auth.sendingCode"
        case .reset: return "auth.sending"
        }
    }

    private func submit() async {
        if let user = await model.submit() {
            await app.signedIn(user)
            return
        }
        if model.submitted {
            if model.emailProblem != nil { focus = .email } else if model.passwordProblem != nil { focus = .password }
        }
    }
}
