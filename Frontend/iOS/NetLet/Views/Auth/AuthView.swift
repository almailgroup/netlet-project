import SwiftUI

/// Sign in, create account and reset — one form, the web's `AuthForm`, drawn
/// as the Profile tab while signed out and as a sheet where a screen needs an
/// account to go on.
///
/// **The title, the switch, the boxes and one button, and nothing else, on the
/// owner's word** ("perfect, user friendly and understandable — simple, sleek,
/// no unnecessary stuff"). On the Profile tab NetLet's street is a band across
/// the top and the form a white panel rising over its foot; "Welcome to
/// NetLet" holds still over the Sign in | Create account switch, and what
/// creating an account involves is one quiet line under its button. The navy
/// panel of what the account does, the line about the password travelling
/// encrypted, the name's hint and the step bar all went, as on the web.
struct AuthView: View {
    var inSheet = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { AuthViewModel(account: app.services.account, faceID: app.faceID) }) { model in
            form(model)
                // The tutorial's last page opens the form on creating an
                // account or on signing in, whichever was pressed.
                .onAppear { takePreset(model) }
                .onChange(of: app.authModePreset) { _, _ in takePreset(model) }
        }
    }

    private func takePreset(_ model: AuthViewModel) {
        guard !inSheet, let mode = app.authModePreset else { return }
        model.mode = mode
        app.authModePreset = nil
    }

    @ViewBuilder
    private func form(_ model: AuthViewModel) -> some View {
        if inSheet {
            // The form says what the sheet is; its bar carries Close alone.
            ScrollView { AuthForm(model: model, band: false) }
                .scrollDismissesKeyboard(.interactively)
                .background(Color.white.ignoresSafeArea())
                .navigationBarTitleDisplayMode(.inline)
        } else {
            // Signed out, the account page is the form itself, in the
            // shop's frame like every other page.
            // The assistant as its mark alone: at rest the pill sat over
            // Continue with Apple and Continue with Google on the first
            // screen — the product page's rule.
            ShopPage(root: true, header: false, assistantFolded: true) {
                AuthForm(model: model, band: true)
                // The app has no footer: its links, and for a guest the
                // language and the currency, are under the form, apart from it.
                VStack(alignment: .leading, spacing: 12) {
                    MoreFromNetLet(language: true)
                    ShopCopyright()
                }
                    .padding(.horizontal, 16)
                    .padding(.top, 20)
                    .padding(.bottom, 24)
                    .background(Brand.ground)
            }
        }
    }
}

/// The terms or the privacy policy, opened over the form from the line under
/// Continue, so reading them loses nothing typed.
private struct LegalSheet: Identifiable {
    let document: LegalDocument
    var id: String { document.rawValue }
}

private struct AuthForm: View {
    @Bindable var model: AuthViewModel
    /// The street across the top, on the Profile tab; a sheet has its own bar.
    let band: Bool
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still
    @FocusState private var focus: Field?
    @Namespace private var switchPill
    @State private var legal: LegalSheet?
    /// The code last sent, so a whole code is sent once until it changes.
    @State private var lastTried: String?
    /// "Continue with phone number" has the form's place while it is chosen.
    @State private var phone: PhoneSignInModel?
    /// The invitation code's box has been asked for.
    @State private var inviteOpen = false

    enum Field: Hashable {
        case name, email, password, code
    }

    var body: some View {
        VStack(spacing: 0) {
            if band, let street = WebAssets.street {
                // Decorative: the title under it says what the page is.
                Brand.navy
                    .frame(height: 160)
                    .overlay { Image(uiImage: street).resizable().aspectRatio(contentMode: .fill) }
                    .clipped()
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 0) {
                if let phone {
                    PhoneSignInSteps(model: phone, onSignedIn: { user in await app.signedIn(user) }, onBack: { self.phone = nil })
                } else {
                switch model.step {
                case .form:
                    form
                case .code(let email, _, _, let fromRegister):
                    codeStep(email: email, kind: fromRegister ? .register : .confirm)
                case .signInCode(let email):
                    codeStep(email: email, kind: .signIn)
                case .resetSent(let email):
                    resetSent(email: email)
                }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, band ? 28 : 12)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                UnevenRoundedRectangle(topLeadingRadius: band ? 24 : 0, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: band ? 24 : 0, style: .continuous)
                    .fill(Color.white)
            }
            .padding(.top, band && WebAssets.street != nil ? -24 : 0)
        }
        .task(id: model.mode) { await model.prepare() }
        .sheet(item: $legal) { sheet in
            NavigationStack {
                LegalView(document: sheet.document)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            BarButton(l.t("common.close")) { legal = nil }
                        }
                    }
            }
            .environment(\.layoutDirection, l.layoutDirection)
            .buttonStyle(HapticDefaultStyle())
        }
        .onAppear {
            takePhonePreset()
            takeCodePreset()
            takeFaceIdPreset()
        }
    }

    /// The screenshots' `-NetLetOpen codeSignIn[:step]` (Debug only).
    private func takeCodePreset() {
        guard band, let step = app.codeSignInPreset else { return }
        app.codeSignInPreset = nil
        model.mode = .signIn
        model.remembersMethod = false
        model.method = .code
        model.email = "noura@shop.test"
        if step == "step" { Task { await submit() } }
    }

    /// The screenshots' `-NetLetOpen faceId` (Debug only): the address the
    /// demo's phone has a key for, and the third tile chosen.
    private func takeFaceIdPreset() {
        guard band, app.faceIdSignInPreset else { return }
        app.faceIdSignInPreset = false
        model.mode = .signIn
        model.remembersMethod = false
        model.email = "noura@shop.test"
        model.method = .faceID
    }

    /// The screenshots' `-NetLetOpen phone[:code|:email]` (Debug only).
    private func takePhonePreset() {
        guard band, phone == nil, let step = app.phoneSignInPreset else { return }
        app.phoneSignInPreset = nil
        switch step {
        case "email":
            phone = PhoneSignInModel(account: app.services.account, startAt: .email)
        case "code":
            let model = PhoneSignInModel(account: app.services.account)
            model.typed = "50123456"
            phone = model
            Task { await model.sendCode() }
        default:
            phone = PhoneSignInModel(account: app.services.account)
        }
    }

    // MARK: The form

    @ViewBuilder
    private var form: some View {
        if model.mode == .reset {
            backToSignIn
            title(l.t("auth.resetTitle"))
            Text(l.t("auth.resetNote"))
                .font(.inter(15))
                .lineSpacing(3)
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
        } else {
            // One title for signing in and creating an account alike, so it
            // holds still while the switch under it changes the form.
            title(l.t("auth.welcome"))
            modeSwitch.padding(.top, 20)
        }
        VStack(alignment: .leading, spacing: 16) {
            if model.mode == .register {
                LabeledField(label: l.t("auth.name") + " " + l.t("auth.optional"), text: $model.name, content: .name, soft: true)
                    .focused($focus, equals: .name)
            }
            LabeledField(
                label: l.t("auth.email"),
                text: $model.email,
                placeholder: "name@example.com",
                problem: model.submitted ? model.emailProblem : nil,
                keyboard: .emailAddress,
                content: .username,
                leftToRight: true,
                soft: true,
                icon: "envelope"
            )
            .focused($focus, equals: .email)
            if model.mode == .signIn {
                SignInMethodChoice(
                    method: Binding(get: { model.shownMethod }, set: { model.method = $0 }),
                    faceID: model.faceIdKind
                )
            }
            if model.mode != .reset && !model.usesCode && !model.usesFaceID {
                VStack(alignment: .leading, spacing: 10) {
                    LabeledField(
                        label: l.t("auth.password"),
                        text: $model.password,
                        problem: model.submitted ? model.passwordProblem : nil,
                        content: model.mode == .register ? .newPassword : .password,
                        secure: true,
                        leftToRight: true,
                        soft: true,
                        icon: "lock"
                    )
                    .focused($focus, equals: .password)
                    if model.mode == .register {
                        PasswordMeter(password: model.password)
                    } else {
                        // Under the box somebody whose password was refused is looking at.
                        Button(l.t("auth.forgot")) { model.mode = .reset }
                            .font(.inter(14, .semibold))
                            .foregroundStyle(Brand.navy)
                            .frame(minHeight: 44)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                }
            }
            if model.mode == .register { inviteRow }
            if model.mode == .register, let key = model.captchaSiteKey {
                VStack(alignment: .leading, spacing: 6) {
                    CaptchaView(siteKey: key, origin: app.services.configuration.baseURL, language: l.current) { token in
                        model.captchaToken = token
                    }
                    // A token is good once: a fresh box after every attempt.
                    .id(model.captchaGeneration)
                    .frame(height: 84)
                    .accessibilityLabel(l.t("auth.captchaLabel"))
                    FieldProblem(key: model.submitted ? model.captchaProblem : nil)
                }
            }
            if let refusal = model.refusal {
                RefusalBox(key: refusal, params: ["kind": l.t((model.faceIdKind ?? app.faceID.kind ?? .faceID).nameKey)]) {
                    if model.offersReset {
                        Button(l.t("auth.resetInstead")) { model.mode = .reset }
                    }
                    if model.offersSignIn {
                        Button(l.t("auth.signInInstead")) { model.mode = .signIn }
                    }
                    if model.offersPassword {
                        Button(l.t("auth.usePasswordInstead")) { usePassword() }
                    }
                }
            }
            Button {
                Task { await submit() }
            } label: {
                if model.working {
                    HStack(spacing: 8) { ProgressView().tint(.white); Text(l.t(workingLabel)) }
                } else if model.usesCode {
                    Label(l.t(submitLabel), systemImage: "envelope")
                } else if model.usesFaceID, let kind = model.faceIdKind {
                    Label(l.t("ios.biometric.signIn", ["kind": l.t(kind.nameKey)]), systemImage: kind.symbol)
                } else {
                    Text(l.t(submitLabel))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.working)
            .padding(.top, model.mode == .reset ? 0 : 6)
            if model.mode == .register {
                // What happens next, said once, quietly.
                Text(l.t("auth.codeWillBeSent"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if (model.phoneOffered || model.appleOffered || model.googleClientId != nil) && model.mode != .reset {
                VStack(spacing: 12) {
                    OrDivider().padding(.bottom, 2)
                    if model.phoneOffered {
                        PhoneSignInButton {
                            phone = PhoneSignInModel(account: app.services.account)
                        }
                    }
                    if model.appleOffered {
                        AppleSignInButton(label: "auth.continueWithApple", working: model.working) {
                            Task {
                                if let user = await model.signInWithApple() { await app.signedIn(user) }
                            }
                        }
                    }
                    if model.googleClientId != nil {
                        GoogleSignInButton(label: "auth.continueWithGoogle", working: model.working) {
                            Task {
                                if let user = await model.signInWithGoogle(language: l.current.rawValue) { await app.signedIn(user) }
                            }
                        }
                    }
                }
                .padding(.top, 4)
            }
            if model.mode == .register {
                // What agreeing means, for either button.
                agreeLine
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 24)
    }

    private func title(_ text: String) -> some View {
        Text(text)
            .font(.inter(26, .heavy))
            .foregroundStyle(Brand.navy)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    /// The reset's way back, at the top of every page of it.
    private var backToSignIn: some View {
        Button {
            model.mode = .signIn
        } label: {
            Label(l.t("auth.resetBack"), systemImage: "arrow.backward")
                .font(.inter(14, .semibold))
                .foregroundStyle(Brand.navy)
                .frame(minHeight: 44)
        }
        .buttonStyle(.tap)
        .padding(.bottom, 12)
    }

    /// Sign in or create an account, two halves of one switch — the web's
    /// `ModeSwitch`. The chosen one is white on the grey track and slides
    /// there; the press ticks through the button's own style.
    private var modeSwitch: some View {
        HStack(spacing: 0) {
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
                                // The thumb, in Liquid Glass, sliding between the halves.
                                Color.clear
                                    .liquidGlass(.frost, in: RoundedRectangle(cornerRadius: 12, style: .continuous), lifted: true, interactive: false)
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
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Calm.track))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("auth.modeSwitch"))
    }

    /// "By continuing, you agree to NetLet's Terms of use and Privacy policy",
    /// each a link that opens over the form.
    private var agreeLine: some View {
        let marker = "\u{2063}"
        let sentence = l.t("auth.agreeTerms", ["terms": marker, "privacy": marker])
        let parts = sentence.components(separatedBy: marker)
        var text = AttributedString(parts.first ?? "")
        for (index, document) in [LegalDocument.terms, .privacy].enumerated() where parts.count > index + 1 {
            var link = AttributedString(l.t(document == .terms ? "footer.terms" : "footer.privacy"))
            link.link = URL(string: "netlet-legal:\(document.rawValue)")
            link.swiftUI.foregroundColor = Brand.navy
            link.swiftUI.font = Font.inter(13, .semibold)
            link.swiftUI.underlineStyle = Text.LineStyle(pattern: .solid, color: nil)
            text += link
            text += AttributedString(parts[index + 1])
        }
        return Text(text)
            .tint(Brand.navy)
            .environment(\.openURL, OpenURLAction { url in
                guard url.scheme == "netlet-legal", let document = LegalDocument(rawValue: url.absoluteString.replacingOccurrences(of: "netlet-legal:", with: "")) else {
                    return .systemAction
                }
                legal = LegalSheet(document: document)
                return .handled
            })
    }

    // MARK: The code

    /// Which code the step takes: a new account's, an unconfirmed sign-in's
    /// own sign-up code, or a one-time code for signing in.
    enum CodeKind {
        case register, confirm, signIn
    }

    private func codeStep(email: String, kind: CodeKind) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            MailTile()
            title(l.t("auth.verifyTitle")).padding(.top, 18)
            Text(l.t(kind == .register ? "auth.verifyBody" : kind == .confirm ? "auth.verifyBodySignIn" : "auth.signInCodeBody", ["email": email]))
                .font(.inter(15))
                .lineSpacing(3)
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            VStack(alignment: .leading, spacing: 14) {
                CodeBoxes(
                    code: $model.code,
                    label: l.t("auth.codeLabel"),
                    invalid: model.submitted && (model.codeProblem != nil || model.refusal == "auth.codeWrong"),
                    focus: $focus,
                    field: .code
                )
                .onAppear { focus = .code }
                .onChange(of: model.code) { _, value in
                    // Six digits send themselves, the web's rule: the last one
                    // typed is the moment the shopper is done.
                    let digits = Validation.normaliseCode(value)
                    if digits.count == 6, digits != lastTried, !model.working {
                        lastTried = digits
                        Task { await confirm() }
                    }
                }
                if model.submitted, let problem = model.codeProblem {
                    FieldProblem(key: problem)
                }
                if let refusal = model.refusal {
                    RefusalBox(key: refusal) {
                        if model.offersPassword {
                            Button(l.t("auth.usePasswordInstead")) { usePassword() }
                        }
                    }
                } else if let resent = model.resentTo {
                    Label(l.t(kind == .signIn ? "auth.signInCodeResent" : "auth.codeResent", ["email": resent]), systemImage: "checkmark")
                        .font(.inter(14))
                        .foregroundStyle(Brand.success)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.successFill))
                }
                Button {
                    lastTried = Validation.normaliseCode(model.code)
                    Task { await confirm() }
                } label: {
                    if model.working {
                        HStack(spacing: 8) { ProgressView().tint(.white); Text(l.t("auth.verifying")) }
                    } else {
                        Text(l.t(kind == .register ? "auth.verifyCreate" : kind == .confirm ? "auth.verifySignIn" : "header.signIn"))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.working)
                .padding(.top, 4)
                if kind == .signIn {
                    // The password is still the other way in, one press away.
                    Button(l.t("auth.usePasswordInstead")) { usePassword() }
                        .font(.inter(14, .semibold))
                        .foregroundStyle(Brand.navy)
                        .underline()
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .padding(.top, 22)
            notArrived(resend: "auth.resendCode", resendIn: "auth.resendCodeIn")
        }
    }

    /// Back to the form on the password, its box focused once it is drawn.
    private func usePassword() {
        model.usePassword()
        lastTried = nil
        Task {
            try? await Task.sleep(for: .milliseconds(60))
            focus = .password
        }
    }

    private func confirm() async {
        if let user = await model.confirm() {
            await app.signedIn(user)
        } else {
            Haptics.refused()
            focus = .code
        }
    }

    // MARK: The reset's mail

    private func resetSent(email: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            backToSignIn
            MailTile()
            title(l.t("auth.resetSentTitle")).padding(.top, 18)
            Text(l.t("auth.resetSentBody", ["email": email]))
                .font(.inter(15))
                .lineSpacing(3)
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            // The code and the new password here, so nobody leaves for the mail's link.
            ResetByCodeFields(email: email, signedIn: { user in await app.signedIn(user) }) { address, typed in
                model.waitForSignUpCode(email: address, password: typed)
            }
            .id(email)
            .padding(.top, 22)
            notArrived(resend: "auth.resend", resendIn: "auth.resendIn")
        }
    }

    /// Under a code that has not come: where to look, then the two ways on.
    private func notArrived(resend: String, resendIn: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Divider().overlay(Brand.line).padding(.bottom, 14)
            Text(l.t("auth.codeTip"))
                .font(.inter(14))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 20) { resendButton(resend, resendIn); differentEmail }
                VStack(alignment: .leading, spacing: 0) { resendButton(resend, resendIn); differentEmail }
            }
        }
        .padding(.top, 24)
    }

    private func resendButton(_ resend: String, _ resendIn: String) -> some View {
        Button(model.resendWait > 0 ? l.t(resendIn, ["seconds": "\(model.resendWait)"]) : l.t(resend)) {
            Task { await model.resend() }
        }
        .disabled(model.resendWait > 0)
        .font(.inter(14, .semibold))
        .foregroundStyle(model.resendWait > 0 ? Brand.muted : Brand.navy)
        .frame(minHeight: 44)
    }

    private var differentEmail: some View {
        Button(l.t("auth.differentEmail")) {
            model.backToForm()
            lastTried = nil
            focus = .email
        }
        .font(.inter(14, .semibold))
        .foregroundStyle(Brand.navy)
        .frame(minHeight: 44)
    }

    // MARK: Words

    private var submitLabel: String {
        switch model.mode {
        case .signIn: return model.usesCode ? "auth.sendSignInCode" : "header.signIn"
        case .register: return "auth.continue"
        case .reset: return "auth.resetSend"
        }
    }

    private var workingLabel: String {
        switch model.mode {
        case .signIn: return model.usesCode ? "auth.sendingSignInCode" : "auth.signingIn"
        case .register: return "auth.sendingCode"
        case .reset: return "auth.sending"
        }
    }

    /// A friend's invitation code (3.1.14): one quiet line on a form kept
    /// short on purpose, and a box only once it is pressed — or already
    /// holds a code. A link opens the website, so the app takes the code typed.
    @ViewBuilder
    private var inviteRow: some View {
        if inviteOpen || !model.inviteCode.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                LabeledField(
                    label: l.t("ios.invite.label") + " " + l.t("auth.optional"),
                    text: $model.inviteCode,
                    problem: model.submitted ? model.inviteProblem : nil,
                    leftToRight: true,
                    soft: true,
                    icon: "gift"
                )
                if InviteCode.isShaped(model.inviteCode) {
                    Text(l.t("auth.referralInvited"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        } else {
            Button(l.t("ios.invite.have")) { inviteOpen = true }
                .font(.inter(14, .semibold))
                .foregroundStyle(Brand.navy)
                .frame(minHeight: 44)
        }
    }

    private func submit() async {
        if model.usesFaceID {
            focus = nil
            if let user = await model.signInWithFaceID(reason: l.t("ios.biometric.prompt")) { await app.signedIn(user) }
            return
        }
        if let user = await model.submit() {
            await app.signedIn(user)
            return
        }
        if model.submitted {
            if model.emailProblem != nil { focus = .email } else if model.passwordProblem != nil { focus = .password }
        }
    }
}

/// "Sign in with": the password or a one-time code, two tiles side by side —
/// the web's `MethodChoice`. The chosen one is rimmed in navy with a tick on
/// its corner; under the code's, one line says what happens.
struct SignInMethodChoice: View {
    @Binding var method: AuthViewModel.SignInMethod
    /// Face ID or Touch ID, drawn as a third tile only where this phone has a
    /// key for the address typed.
    var faceID: BiometryKind? = nil
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("auth.methodLabel"))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Brand.ink)
                .accessibilityHidden(true)
            HStack(spacing: 10) {
                tile(.password, symbol: "key", label: "auth.methodPassword", tint: Calm.sky, ink: Brand.navy)
                tile(.code, symbol: "envelope", label: "auth.methodCode", tint: Calm.peach, ink: Calm.peachInk)
                if let faceID {
                    tile(.faceID, symbol: faceID.symbol, label: faceID.nameKey, tint: Calm.track, ink: Brand.navy)
                        .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
            }
            .animation(still ? nil : .smooth(duration: 0.3), value: faceID)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("auth.methodLabel"))
            if method == .code {
                Text(l.t("auth.methodCodeNote"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            } else if method == .faceID {
                Text(l.t("ios.biometric.methodNote"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
            }
        }
    }

    private func tile(_ value: AuthViewModel.SignInMethod, symbol: String, label: String, tint: Color, ink: Color) -> some View {
        let on = method == value
        // Three tiles in a row: the icon over its word, so neither is cut.
        let stacked = faceID != nil
        return Button {
            method = value
        } label: {
            Group {
                if stacked {
                    VStack(spacing: 6) {
                        Image(systemName: symbol)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(ink)
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(tint))
                            .accessibilityHidden(true)
                        Text(l.t(label))
                            .font(.inter(13, .semibold))
                            .foregroundStyle(Brand.navy)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .minimumScaleFactor(0.85)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    HStack(spacing: 10) {
                        Image(systemName: symbol)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(ink)
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(tint))
                            .accessibilityHidden(true)
                        Text(l.t(label))
                            .font(.inter(14, .semibold))
                            .foregroundStyle(Brand.navy)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.horizontal, stacked ? 6 : 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: stacked ? 84 : 60)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(on ? Calm.chosen : Color.white))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(on ? Brand.navy : Calm.rim, lineWidth: on ? 2 : 1)
            )
            .overlay(alignment: .topTrailing) {
                if on {
                    Image(systemName: "checkmark")
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundStyle(.white)
                        .frame(width: 20, height: 20)
                        .background(Circle().fill(Brand.navy))
                        .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
                        // Out over the tile's end corner, whichever side that is.
                        .offset(x: l.layoutDirection == .rightToLeft ? -6 : 6, y: -6)
                        .environment(\.layoutDirection, .leftToRight)
                        .accessibilityHidden(true)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .animation(.smooth(duration: 0.25), value: on)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// What the server refused, in the web's pale red box, with the next step it
/// offers under the words.
struct RefusalBox<Next: View>: View {
    let key: String
    /// Words a sentence names — Face ID or Touch ID.
    var params: [String: String] = [:]
    @ViewBuilder var next: () -> Next
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle")
                .font(.system(size: 15, weight: .semibold))
                .padding(.top, 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(l.t(key, params)).fixedSize(horizontal: false, vertical: true)
                next()
                    .font(.inter(14, .bold))
                    .underline()
                    .buttonStyle(.tap)
            }
        }
        .font(.inter(14))
        .foregroundStyle(Brand.danger)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(red: 253 / 255, green: 236 / 255, blue: 235 / 255)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color(red: 242 / 255, green: 196 / 255, blue: 185 / 255), lineWidth: 1))
    }
}

/// The envelope over a "check your email" page, quiet and the same on both.
struct MailTile: View {
    var body: some View {
        Image(systemName: "envelope.badge")
            .font(.system(size: 22, weight: .medium))
            .foregroundStyle(Brand.navy)
            .frame(width: 48, height: 48)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(red: 238 / 255, green: 242 / 255, blue: 248 / 255)))
            .accessibilityHidden(true)
    }
}

/// The web's `PasswordChecklist`: once something is typed, a thin bar in four
/// parts with the strength in a word, and always the two rules that block, as
/// ticks. The account's new password and the reset's draw the same one.
struct PasswordMeter: View {
    let password: String
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let verdict = Validation.checkPassword(password)
        let typed = !password.isEmpty
        VStack(alignment: .leading, spacing: 8) {
            if typed {
                HStack(spacing: 10) {
                    HStack(spacing: 4) {
                        ForEach(0..<4, id: \.self) { segment in
                            Capsule()
                                .fill(segment < max(verdict.score, 1) ? Self.fill(verdict.band) : Color(red: 227 / 255, green: 231 / 255, blue: 238 / 255))
                                .frame(height: 4)
                        }
                    }
                    Text(l.t(Self.word(verdict.band)))
                        .font(.inter(12, .bold))
                        .foregroundStyle(Brand.navy)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(l.t("auth.strength"))
                .accessibilityValue(l.t(Self.word(verdict.band)))
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 16) { rules(verdict, typed: typed) }
                VStack(alignment: .leading, spacing: 4) { rules(verdict, typed: typed) }
            }
        }
        .animation(.easeOut(duration: 0.2), value: verdict.score)
    }

    @ViewBuilder
    private func rules(_ verdict: Validation.PasswordVerdict, typed: Bool) -> some View {
        rule("auth.ruleLength", met: typed && !verdict.unmet.contains("length"), failed: false)
        let common = typed && verdict.unmet.contains("notCommon")
        rule("auth.ruleNotCommon", met: typed && !common, failed: common)
    }

    private func rule(_ key: String, met: Bool, failed: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: met ? "checkmark.circle.fill" : failed ? "exclamationmark.circle.fill" : "circle")
                .font(.system(size: 14))
                .foregroundStyle(met ? Color(red: 47 / 255, green: 125 / 255, blue: 79 / 255) : failed ? Brand.danger : Brand.muted.opacity(0.7))
            Text(l.t(key))
                .font(.inter(13))
                .foregroundStyle(met ? Brand.success : failed ? Brand.danger : Brand.muted)
                .fixedSize()
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(l.t(met ? "auth.ruleMet" : "auth.ruleNotMet"))
    }

    private static func word(_ band: Validation.PasswordVerdict.Band) -> String {
        switch band {
        case .weak: return "auth.strengthWeak"
        case .fair: return "auth.strengthFair"
        case .good: return "auth.strengthGood"
        case .strong: return "auth.strengthStrong"
        }
    }

    /* The bar's colours, the web's `BAND_FILL`. */
    private static func fill(_ band: Validation.PasswordVerdict.Band) -> Color {
        switch band {
        case .weak: return Color(red: 208 / 255, green: 69 / 255, blue: 58 / 255)
        case .fair: return Color(red: 208 / 255, green: 138 / 255, blue: 30 / 255)
        case .good: return Color(red: 47 / 255, green: 125 / 255, blue: 79 / 255)
        case .strong: return Color(red: 29 / 255, green: 107 / 255, blue: 64 / 255)
        }
    }
}

/// The six-digit code as six boxes over one field — the web's `CodeBoxes`.
/// One field, so a paste, the keyboard's "From Mail" suggestion and
/// VoiceOver each take it whole; the boxes are a picture of its value, read
/// left to right on either page, since it is a number, not a sentence.
struct CodeBoxes<Value: Hashable>: View {
    @Binding var code: String
    let label: String
    let invalid: Bool
    var focus: FocusState<Value?>.Binding
    let field: Value
    @Environment(\.accessibilityReduceMotion) private var still

    private var digits: [Character] { Array(Validation.normaliseCode(code).prefix(6)) }

    var body: some View {
        let focused = focus.wrappedValue == field
        let active = min(digits.count, 5)
        ZStack {
            HStack(spacing: 8) {
                ForEach(0..<6, id: \.self) { index in
                    let here = focused && index == active
                    ZStack {
                        // An empty box wears the form's soft fill; one holding
                        // a digit, or the one being typed in, is white.
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(here || index < digits.count || invalid ? Color.white : Calm.field)
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(here ? Brand.navy : invalid ? Brand.danger : index < digits.count ? Brand.muted.opacity(0.5) : Calm.rim, lineWidth: here ? 2 : 1)
                        if index < digits.count {
                            Text(String(digits[index]))
                                .font(.inter(24, .bold))
                                .monospacedDigit()
                                .foregroundStyle(Brand.navy)
                        } else if here {
                            Capsule().fill(Brand.navy).frame(width: 2, height: 24)
                                .opacity(still ? 1 : 0.8)
                        }
                    }
                    .frame(height: 56)
                    .frame(maxWidth: .infinity)
                    .animation(.easeOut(duration: 0.15), value: here)
                }
            }
            .accessibilityHidden(true)
            TextField("", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .autocorrectionDisabled()
                .focused(focus, equals: field)
                .foregroundStyle(.clear)
                .tint(.clear)
                .frame(height: 56)
                .opacity(0.02)
                .accessibilityLabel(label)
                .accessibilityValue(String(digits))
                .onChange(of: code) { _, value in
                    let clean = String(Validation.normaliseCode(value).prefix(6))
                    if clean != value { code = clean }
                }
        }
        .contentShape(Rectangle())
        .onTapGesture { focus.wrappedValue = field }
        .environment(\.layoutDirection, .leftToRight)
    }
}
