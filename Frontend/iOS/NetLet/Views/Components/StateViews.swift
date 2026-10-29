import SwiftUI

/// Draws a `LoadState`: an outline while it waits, a failure with Try again,
/// or the content. A failure is never drawn as an empty list — an empty list
/// reads as "there is nothing here", which is not what a failed read means.
struct LoadStateView<Value, Content: View, Placeholder: View>: View {
    let state: LoadState<Value>
    let retry: () async -> Void
    @ViewBuilder let content: (Value) -> Content
    @ViewBuilder let placeholder: () -> Placeholder

    var body: some View {
        switch state {
        case .loaded(let value):
            content(value)
        case .failed(let error):
            ErrorStateView(error: error, retry: retry)
        case .idle, .loading:
            placeholder()
        }
    }
}

extension LoadStateView where Placeholder == LoadingView {
    init(state: LoadState<Value>, retry: @escaping () async -> Void, @ViewBuilder content: @escaping (Value) -> Content) {
        self.init(state: state, retry: retry, content: content, placeholder: { LoadingView() })
    }
}

struct LoadingView: View {
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ProgressView()
            .tint(Brand.navy)
            .frame(maxWidth: .infinity, minHeight: 200)
            .accessibilityLabel(l.t("nav.loadingPage"))
    }
}

/// What went wrong, in the shopper's language, and the one thing to do about it.
struct ErrorStateView: View {
    let error: APIError
    let retry: () async -> Void
    @State private var retrying = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: error == .offline ? "wifi.slash" : "exclamationmark.triangle")
                .font(.system(size: 34, weight: .regular))
                .foregroundStyle(Brand.muted)
                .accessibilityHidden(true)
            Text(l.t(error.messageKey(knownKey: l.phrasebook.has)))
                .font(.body)
                .foregroundStyle(Brand.ink)
                .multilineTextAlignment(.center)
            Button {
                Task {
                    retrying = true
                    await retry()
                    retrying = false
                }
            } label: {
                if retrying { ProgressView().tint(.white) } else { Text(l.t("home.refreshCatalog")) }
            }
            .buttonStyle(PrimaryButtonStyle())
            .frame(maxWidth: 240)
            .disabled(retrying)
        }
        .padding(24)
        .frame(maxWidth: .infinity, minHeight: 240)
    }
}

/// "Nothing here", with a sentence saying why and, where there is one, the way on.
struct EmptyStateView: View {
    let systemImage: String
    let title: String
    var note: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.system(size: 36))
                .foregroundStyle(Brand.muted.opacity(0.8))
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Brand.ink)
                .multilineTextAlignment(.center)
            if let note {
                Text(note)
                    .font(.subheadline)
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(maxWidth: 260)
                    .padding(.top, 4)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
    }
}

/// A line under a box saying what it needs, in the shop's refusal red.
struct FieldProblem: View {
    let key: String?
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if let key {
            Label(l.t(key), systemImage: "exclamationmark.circle")
                .font(.footnote)
                .foregroundStyle(Brand.danger)
                .labelStyle(.titleAndIcon)
                .accessibilityAddTraits(.isStaticText)
        }
    }
}

/// A labelled text box: the label above the box, never inside it.
struct LabeledField: View {
    let label: String
    @Binding var text: String
    var placeholder = ""
    var hint: String?
    var problem: String?
    var keyboard: UIKeyboardType = .default
    var content: UITextContentType?
    var secure = false
    var leftToRight = false
    var axis: Axis = .horizontal
    /// Filled by a dropped pin and not yet changed: pale orange, the web's `.from-pin`.
    var fromPin = false

    @State private var revealed = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Brand.ink)
            HStack(spacing: 8) {
                Group {
                    if secure && !revealed {
                        SecureField(placeholder, text: $text)
                    } else {
                        TextField(placeholder, text: $text, axis: axis)
                            .lineLimit(axis == .vertical ? 4...10 : 1...1)
                    }
                }
                .textContentType(content)
                .keyboardType(keyboard)
                .textInputAutocapitalization(leftToRight || secure ? .never : .sentences)
                .autocorrectionDisabled(leftToRight || secure)
                // An email, a password or a number types left to right on either
                // page, starting at the left — the web's rule for those boxes.
                .environment(\.layoutDirection, leftToRight ? .leftToRight : l.layoutDirection)
                if secure {
                    Button {
                        revealed.toggle()
                    } label: {
                        Image(systemName: revealed ? "eye.slash" : "eye")
                            .foregroundStyle(Brand.muted)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(l.t(revealed ? "auth.hidePassword" : "auth.showPassword"))
                }
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(fromPin ? Brand.fromPin : Color.white))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(problem != nil ? Brand.danger : fromPin ? Brand.fromPinRim : Brand.line, lineWidth: problem == nil ? 1 : 1.5)
            )
            .animation(.easeOut(duration: 0.25), value: fromPin)
            if let hint, problem == nil {
                Text(hint).font(.footnote).foregroundStyle(Brand.muted)
            }
            FieldProblem(key: problem)
        }
    }
}

/// The profile page's box, drawn to the owner's reference: the label sits
/// inside the box's top edge — small, muted, a star when it is needed — with
/// what is typed under it, and the rim turns navy while it has focus. The
/// label never moves (the sign-in form's rule against a label that lifts as
/// you type); it is only drawn inside the rim rather than above it.
struct FloatingField: View {
    let label: String
    @Binding var text: String
    var required = false
    var placeholder = ""
    var problem: String?
    var keyboard: UIKeyboardType = .default
    var content: UITextContentType?
    var secure = false
    var leftToRight = false
    var disabled = false
    /// Drawn before what is typed, on the same line — the `+965` before a number.
    var prefix: String?

    @State private var revealed = false
    @FocusState private var focused: Bool
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    (Text(label) + Text(required ? " *" : "").foregroundColor(Brand.accentInk))
                        .font(.inter(12, .medium))
                        .foregroundStyle(Brand.muted)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        if let prefix {
                            Text(prefix)
                                .font(.inter(16, .medium))
                                .foregroundStyle(Brand.muted)
                                .accessibilityHidden(true)
                        }
                        Group {
                            if secure && !revealed {
                                SecureField(placeholder, text: $text)
                            } else {
                                TextField(placeholder, text: $text)
                            }
                        }
                        .font(.inter(16, .medium))
                        .foregroundStyle(disabled ? Brand.muted : Brand.ink)
                        .textContentType(content)
                        .keyboardType(keyboard)
                        .textInputAutocapitalization(leftToRight || secure ? .never : .words)
                        .autocorrectionDisabled(leftToRight || secure)
                        .focused($focused)
                        .disabled(disabled)
                        .accessibilityLabel(prefix.map { "\(label), \($0)" } ?? label)
                    }
                    .environment(\.layoutDirection, leftToRight ? .leftToRight : l.layoutDirection)
                }
                if secure {
                    Button {
                        revealed.toggle()
                    } label: {
                        Image(systemName: revealed ? "eye.slash" : "eye")
                            .foregroundStyle(Brand.muted)
                            .frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(l.t(revealed ? "auth.hidePassword" : "auth.showPassword"))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(minHeight: 64)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(disabled ? Brand.ground : Color.white))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(problem != nil ? Brand.danger : focused ? Brand.navy : Brand.line, lineWidth: problem != nil || focused ? 1.5 : 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .onTapGesture { if !disabled { focused = true } }
            FieldProblem(key: problem)
        }
    }
}

/// Owns a screen's view model for as long as the screen is on its stack.
///
/// The services come from the environment, which a view's `init` cannot read,
/// so the model is made on first appearance and kept in `@State` from then on.
struct ModelHost<Model: AnyObject, Content: View>: View {
    let make: @MainActor () -> Model
    @ViewBuilder let content: (Model) -> Content
    @State private var model: Model?

    var body: some View {
        if let model {
            content(model)
        } else {
            Brand.ground.ignoresSafeArea().onAppear { model = make() }
        }
    }
}
