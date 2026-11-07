import SwiftUI

/// "Continue with phone number", drawn in the sign-in form's own place — the
/// web's `PhoneSignIn`: the number after a fixed `+965`, the code in the
/// sign-up's six boxes (sent by itself on the sixth digit), and for a new
/// account an optional email with "Skip for now".
struct PhoneSignInSteps: View {
    @Bindable var model: PhoneSignInModel
    /// Signed in, and the email step added or skipped.
    let onSignedIn: (User) async -> Void
    let onBack: () -> Void
    @Environment(LanguageSettings.self) private var l
    @FocusState private var focus: Field?
    @State private var lastTried: String?

    enum Field: Hashable { case number, code, email, emailCode }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch model.step {
            case .number: number
            case .code(let phone): codeStep(phone: phone)
            case .email: emailStep
            case .emailCode(let address): emailCodeStep(address)
            }
        }
    }

    // MARK: The number

    private var number: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onBack) {
                Label(l.t("auth.useEmailInstead"), systemImage: "arrow.backward")
                    .font(.inter(14, .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.tap)
            .padding(.bottom, 12)
            tile("iphone")
            heading("auth.phoneTitle").padding(.top, 18)
            paragraph("auth.phoneHint").padding(.top, 8)
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("auth.phoneLabel"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Brand.ink)
                // The number reads left to right on either page, after +965.
                HStack(spacing: 0) {
                    Text("+965")
                        .font(.inter(16, .semibold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 14)
                        .frame(height: 50)
                        .background(Color(red: 243 / 255, green: 245 / 255, blue: 249 / 255))
                        .accessibilityHidden(true)
                    Divider().frame(height: 50)
                    TextField("5XXX XXXX", text: $model.typed)
                        .font(.inter(16))
                        .keyboardType(.phonePad)
                        .textContentType(.telephoneNumber)
                        .focused($focus, equals: .number)
                        .padding(.horizontal, 14)
                        .frame(height: 50)
                        .accessibilityLabel(l.t("auth.phoneLabel"))
                        .accessibilityIdentifier("phoneNumber")
                }
                .environment(\.layoutDirection, .leftToRight)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(model.submitted && model.numberProblem != nil ? Brand.danger : Brand.line, lineWidth: 1)
                )
                FieldProblem(key: model.submitted ? model.numberProblem : nil)
            }
            .padding(.top, 22)
            refusal
            primary(model.working ? "auth.sendingPhoneCode" : "auth.sendPhoneCode") {
                Task { await model.sendCode() }
            }
            .padding(.top, 16)
        }
        .onAppear { focus = .number }
    }

    // MARK: The texted code

    private func codeStep(phone: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            tile("iphone")
            heading("auth.phoneCodeTitle").padding(.top, 18)
            Text(l.t("auth.phoneCodeSent", ["phone": "\u{2066}\(AccountView.shownPhone(phone))\u{2069}"]))
                .font(.inter(15))
                .lineSpacing(3)
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            CodeBoxes(code: $model.code, label: l.t("auth.codeLabel"), invalid: model.refusal == "auth.phoneCodeWrong", focus: $focus, field: .code)
                .padding(.top, 22)
                .onAppear { focus = .code }
                .onChange(of: model.code) { _, value in
                    let digits = Validation.normaliseCode(value)
                    if digits.count == 6, digits != lastTried, !model.working {
                        lastTried = digits
                        Task { await verify() }
                    }
                }
            refusal
            primary(model.working ? "auth.verifying" : "auth.continue") {
                lastTried = Validation.normaliseCode(model.code)
                Task { await verify() }
            }
            .padding(.top, 16)
            resendRow(different: "auth.useDifferentNumber") { model.differentNumber() }
        }
    }

    private func verify() async {
        if let user = await model.verify() { await onSignedIn(user) }
    }

    // MARK: Add your email

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: 0) {
            MailTile()
            heading("auth.addEmailTitle").padding(.top, 18)
            paragraph("auth.addEmailBody").padding(.top, 8)
            LabeledField(
                label: l.t("auth.email"),
                text: $model.email,
                placeholder: "name@example.com",
                problem: model.submitted ? model.emailProblem : nil,
                keyboard: .emailAddress,
                content: .emailAddress,
                leftToRight: true
            )
            .focused($focus, equals: .email)
            .padding(.top, 22)
            refusal
            primary(model.working ? "auth.sending" : "auth.addEmailSend") {
                Task { await model.sendEmailCode() }
            }
            .padding(.top, 16)
            Button(l.t("auth.addEmailSkip")) {
                guard let user = model.signedIn else { return }
                Task { await onSignedIn(user) }
            }
            .font(.inter(14, .semibold))
            .foregroundStyle(Brand.navy)
            .underline()
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.top, 6)
            .accessibilityIdentifier("skipEmail")
        }
    }

    private func emailCodeStep(_ address: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            MailTile()
            heading("auth.addEmailTitle").padding(.top, 18)
            Text(l.t("auth.addEmailCodeSent", ["email": "\u{2066}\(address)\u{2069}"]))
                .font(.inter(15))
                .lineSpacing(3)
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
            CodeBoxes(code: $model.emailCode, label: l.t("auth.codeLabel"), invalid: model.refusal == "auth.codeWrong", focus: $focus, field: .emailCode)
                .padding(.top, 22)
                .onAppear { focus = .emailCode }
                .onChange(of: model.emailCode) { _, value in
                    let digits = Validation.normaliseCode(value)
                    if digits.count == 6, digits != lastTried, !model.working {
                        lastTried = digits
                        Task { await verifyEmail() }
                    }
                }
            refusal
            primary(model.working ? "auth.verifying" : "auth.continue") {
                lastTried = Validation.normaliseCode(model.emailCode)
                Task { await verifyEmail() }
            }
            .padding(.top, 16)
            resendRow(different: "auth.differentEmail") { model.differentEmail() }
        }
    }

    private func verifyEmail() async {
        if let user = await model.verifyEmail() { await onSignedIn(user) }
    }

    // MARK: Parts

    private func tile(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 22, weight: .medium))
            .foregroundStyle(Brand.navy)
            .frame(width: 48, height: 48)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(red: 238 / 255, green: 242 / 255, blue: 248 / 255)))
            .accessibilityHidden(true)
    }

    private func heading(_ key: String) -> some View {
        Text(l.t(key))
            .font(.inter(26, .heavy))
            .foregroundStyle(Brand.navy)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    private func paragraph(_ key: String) -> some View {
        Text(l.t(key))
            .font(.inter(15))
            .lineSpacing(3)
            .foregroundStyle(Brand.body)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var refusal: some View {
        if let key = model.refusal {
            RefusalBox(key: key) { EmptyView() }.padding(.top, 14)
        }
    }

    private func primary(_ key: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            if model.working {
                HStack(spacing: 8) { ProgressView().tint(.white); Text(l.t(key)) }
            } else {
                Text(l.t(key))
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(model.working)
    }

    private func resendRow(different: String, onDifferent: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Divider().overlay(Brand.line).padding(.bottom, 10)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 20) { resendButton; differentButton(different, onDifferent) }
                VStack(alignment: .leading, spacing: 0) { resendButton; differentButton(different, onDifferent) }
            }
        }
        .padding(.top, 24)
    }

    private var resendButton: some View {
        Button(model.resendWait > 0 ? l.t("auth.resendCodeIn", ["seconds": "\(model.resendWait)"]) : l.t("auth.resendCode")) {
            Task { await model.resend() }
        }
        .disabled(model.resendWait > 0)
        .font(.inter(14, .semibold))
        .foregroundStyle(model.resendWait > 0 ? Brand.muted : Brand.navy)
        .frame(minHeight: 44)
    }

    private func differentButton(_ key: String, _ action: @escaping () -> Void) -> some View {
        Button(l.t(key), action: action)
            .font(.inter(14, .semibold))
            .foregroundStyle(Brand.navy)
            .underline()
            .frame(minHeight: 44)
    }
}

/// "Continue with phone number" on the sign-in form — the web's button: white,
/// a navy rim, a phone and the words, the height of the form's own button.
struct PhoneSignInButton: View {
    let action: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "iphone")
                    .font(.system(size: 17, weight: .medium))
                    .accessibilityHidden(true)
                Text(l.t("auth.continueWithPhone"))
                    .font(.inter(15, .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(Brand.navy)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().strokeBorder(Brand.navy, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .accessibilityIdentifier("phoneSignIn")
    }
}

/// "Email" on Your profile, for an account that signs in with its phone and
/// has none yet — the web's `AddEmailCard`: the address, then the code
/// emailed to it, through the same model the sign-up's optional step uses.
struct AddEmailCard: View {
    let phone: String?
    let onAdded: (User) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var model: PhoneSignInModel?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(l.t("account.emailCard"))
                    .font(.inter(17, .bold))
                    .foregroundStyle(Brand.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(l.t("account.emailCardNote"))
                    .font(.inter(14))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                if let phone {
                    Text(l.t("account.signsInWithPhone", ["phone": "\u{2066}\(AccountView.shownPhone(phone))\u{2069}"]))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .padding(.top, 2)
                }
            }
            if let model {
                AddEmailFields(model: model, onAdded: onAdded)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .panel()
        .onAppear { if model == nil { model = PhoneSignInModel(account: app.services.account, startAt: .email) } }
    }
}

/// The address and its code, as a card's body.
private struct AddEmailFields: View {
    @Bindable var model: PhoneSignInModel
    let onAdded: (User) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @FocusState private var focus: PhoneSignInSteps.Field?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if case .emailCode(let address) = model.step {
                Text(l.t("auth.addEmailCodeSent", ["email": "\u{2066}\(address)\u{2069}"]))
                    .font(.inter(14))
                    .foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
                CodeBoxes(code: $model.emailCode, label: l.t("auth.codeLabel"), invalid: model.refusal == "auth.codeWrong", focus: $focus, field: .emailCode)
                    .onAppear { focus = .emailCode }
                if let key = model.refusal { RefusalBox(key: key) { EmptyView() } }
                Button {
                    Task {
                        if let user = await model.verifyEmail() {
                            Haptics.succeeded()
                            app.toast(l.t("auth.addEmailDone"))
                            onAdded(user)
                        }
                    }
                } label: {
                    if model.working { ProgressView().tint(.white) } else { Text(l.t("auth.continue")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.working)
                Button(l.t("auth.differentEmail")) { model.differentEmail() }
                    .font(.inter(14, .semibold))
                    .foregroundStyle(Brand.navy)
                    .underline()
                    .frame(minHeight: 44)
            } else {
                LabeledField(
                    label: l.t("auth.email"),
                    text: $model.email,
                    placeholder: "name@example.com",
                    problem: model.submitted ? model.emailProblem : nil,
                    keyboard: .emailAddress,
                    content: .emailAddress,
                    leftToRight: true
                )
                if let key = model.refusal { RefusalBox(key: key) { EmptyView() } }
                Button {
                    Task { await model.sendEmailCode() }
                } label: {
                    if model.working { ProgressView().tint(.white) } else { Text(l.t("auth.addEmailSend")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.working)
            }
        }
    }
}
