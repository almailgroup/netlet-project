import SwiftUI

/// Sign in, create account and reset — one form, the web's `AuthForm`, drawn
/// as the Account tab while signed out and as a sheet where a screen needs an
/// account to go on.
///
/// **Drawn as the web's phone draws it**, on the owner's word ("make the
/// login and sign-up page better"): on the Account tab NetLet's street is a
/// band across the top and the form is a white panel rising over its foot with
/// rounded corners, reaching the screen's edges; signing in and creating an
/// account are two halves of one switch at its top, and the heading that would
/// say the same thing again is for VoiceOver alone. What the account does
/// follows the form.
struct AuthView: View {
    var inSheet = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { AuthViewModel(account: app.services.account) }) { model in
            if inSheet {
                ScrollView { AuthForm(model: model, band: false) }
                    .scrollDismissesKeyboard(.interactively)
                    .background(Brand.ground.ignoresSafeArea())
                    .navigationTitle(l.t("auth.signInTitle"))
                    .navigationBarTitleDisplayMode(.inline)
            } else {
                // Signed out, the account page is the form itself, in the
                // shop's frame like every other page.
                ShopPage(root: true, header: false, footer: false) { AuthForm(model: model, band: true) }
            }
        }
    }
}

private struct AuthForm: View {
    @Bindable var model: AuthViewModel
    /// The street across the top, on the Account tab; a sheet has its own title.
    let band: Bool
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still
    @FocusState private var focus: Field?
    @Namespace private var switchPill

    enum Field: Hashable {
        case name, email, password, code
    }

    var body: some View {
        VStack(spacing: 0) {
            if band, let street = WebAssets.street {
                // Decorative: the form under it says what the page is.
                Brand.navy
                    .frame(height: 188)
                    .overlay { Image(uiImage: street).resizable().aspectRatio(contentMode: .fill) }
                    .overlay(alignment: .bottom) {
                        LinearGradient(colors: [Brand.navy.opacity(0), Brand.navy.opacity(0.45)], startPoint: .top, endPoint: .bottom)
                            .frame(height: 64)
                    }
                    .clipped()
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 18) {
                switch model.step {
                case .form:
                    form
                case .code(let email, _, _, let fromRegister):
                    codeStep(email: email, fromRegister: fromRegister)
                case .resetSent(let email):
                    resetSent(email: email)
                }
                if case .form = model.step, model.mode != .reset {
                    Label(l.t("auth.secureNote"), systemImage: "lock")
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                        .padding(.top, 4)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 26)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                UnevenRoundedRectangle(topLeadingRadius: band ? 28 : 0, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: band ? 28 : 0, style: .continuous)
                    .fill(Color.white)
                    .shadow(color: Brand.navy.opacity(band ? 0.18 : 0), radius: 15, x: 0, y: -10)
            }
            .padding(.top, band && WebAssets.street != nil ? -28 : 0)
            benefits
        }
        .task(id: model.mode) { await model.prepare() }
    }

    /// Sign in or create an account, two halves of one switch — the web's
    /// `ModeSwitch`. The chosen one is white on the grey track and slides
    /// there; the press ticks through the button's own style.
    private var modeSwitch: some View {
        HStack(spacing: 4) {
            ForEach([AuthViewModel.Mode.signIn, .register], id: \.self) { option in
                let on = model.mode == option
                Button {
                    guard !on else { return }
                    withAnimation(still ? nil : .smooth(duration: 0.3)) { model.mode = option }
                } label: {
                    Text(l.t(option == .signIn ? "header.signIn" : "auth.modeRegister"))
                        .font(.inter(15, on ? .bold : .semibold))
                        .foregroundStyle(on ? Brand.navy : Brand.body)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background {
                            if on {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(Color.white)
                                    .shadow(color: Brand.navy.opacity(0.12), radius: 6, x: 0, y: 2)
                                    .matchedGeometryEffect(id: "pill", in: switchPill)
                            }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(red: 238 / 255, green: 240 / 255, blue: 244 / 255)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("auth.modeSwitch"))
    }

    /// "Step 1 of 2 · Your details" over a bar in two, the first part orange.
    private func steps(_ step: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            (Text(l.t("auth.stepOf", ["step": "\(step)", "total": "2"]) + " · ").foregroundColor(Brand.muted)
                + Text(l.t(step == 1 ? "auth.stepDetails" : "auth.stepConfirm")).foregroundColor(Brand.navy))
                .font(.inter(14, .semibold))
            HStack(spacing: 6) {
                Capsule().fill(Brand.orange).frame(height: 4)
                Capsule().fill(step == 2 ? Brand.orange : Color(red: 227 / 255, green: 231 / 255, blue: 238 / 255)).frame(height: 4)
            }
            .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var form: some View {
        if model.mode != .reset {
            modeSwitch
        }
        VStack(alignment: .leading, spacing: 6) {
            if model.mode == .register {
                steps(1).padding(.bottom, 10)
            }
            if model.mode == .reset {
                Text(l.t(title)).font(.inter(24, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                Text(l.t(note)).font(.inter(15)).lineSpacing(3).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            } else {
                // The switch above says where the shopper is, so the heading
                // is VoiceOver's alone — the line under the switch carries it,
                // as the web keeps its own for a screen reader.
                Text(l.t(note))
                    .font(.inter(15))
                    .lineSpacing(3)
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(l.t(title) + ". " + l.t(note))
                    .accessibilityAddTraits(.isHeader)
            }
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
                Label(l.t("auth.ruleLength"), systemImage: model.password.count >= ReferenceData.shared.rules.passwordFloor ? "checkmark.circle.fill" : "circle")
                    .font(.footnote)
                    .foregroundStyle(model.password.count >= ReferenceData.shared.rules.passwordFloor ? Brand.success : Brand.muted)
                    .accessibilityValue(l.t(model.password.count >= ReferenceData.shared.rules.passwordFloor ? "auth.ruleMet" : "auth.ruleNotMet"))
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
            Label(l.t("auth.codeWillBeSent"), systemImage: "envelope.badge")
                .font(.inter(13))
                .foregroundStyle(Brand.muted)
            Text(l.t("auth.terms")).font(.inter(13)).foregroundStyle(Brand.muted)
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
                steps(2)
            }
            Text(l.t("auth.verifyTitle")).font(.inter(24, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t(fromRegister ? "auth.verifyBody" : "auth.verifyBodySignIn", ["email": email])).font(.inter(15)).foregroundStyle(Brand.ink)
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
            Text(l.t("auth.resetSentTitle")).font(.inter(24, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("auth.resetSentBody", ["email": email])).font(.inter(15)).foregroundStyle(Brand.ink)
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

    /// What the account does, under the form: never seller counts or
    /// testimonials. The web's navy panel, edge to edge with the orange of the
    /// logo's roof along its top.
    private var benefits: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("auth.asideTitle")).font(.inter(21, .heavy)).foregroundStyle(.white).accessibilityAddTraits(.isHeader)
                Text(l.t("auth.asideNote")).font(.inter(14)).foregroundStyle(Color(red: 201 / 255, green: 212 / 255, blue: 226 / 255))
            }
            benefit("shippingbox", "auth.benefitOrders", "auth.benefitOrdersNote")
            benefit("mappin.and.ellipse", "auth.benefitCheckout", "auth.benefitCheckoutNote")
            benefit("heart", "auth.benefitLists", "auth.benefitListsNote")
        }
        .padding(.horizontal, 20)
        .padding(.top, 30)
        .padding(.bottom, 36)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.navy)
        .overlay(alignment: .top) { Rectangle().fill(Brand.orange).frame(height: 6) }
    }

    private func benefit(_ icon: String, _ title: String, _ note: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.orange))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t(title)).font(.inter(15, .bold)).foregroundStyle(.white)
                Text(l.t(note)).font(.inter(14)).foregroundStyle(Color(red: 201 / 255, green: 212 / 255, blue: 226 / 255))
                    .fixedSize(horizontal: false, vertical: true)
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
