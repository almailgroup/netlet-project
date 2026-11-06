import SwiftUI

/// "Continue with Apple" — the web's `AppleButton`, as Apple's guidelines
/// draw it: black, the Apple mark in white beside the words, the height of the
/// form's own button. Drawn here rather than as the system's
/// `SignInWithAppleButton` so its words follow the language chosen in the
/// app, which the system's follows the phone's.
struct AppleSignInButton: View {
    let label: String
    var working = false
    let action: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if working {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "applelogo")
                        .font(.system(size: 17, weight: .medium))
                        .accessibilityHidden(true)
                }
                Text(l.t(label))
                    .font(.inter(15, .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(Capsule().fill(Color.black))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .disabled(working)
        .accessibilityIdentifier("appleSignIn")
    }
}

/// The line between the form's own button and Apple's, the web's `OrDivider`.
struct OrDivider: View {
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 12) {
            Rectangle().fill(Brand.line).frame(height: 1)
            Text(l.t("auth.or"))
                .font(.inter(13, .medium))
                .foregroundStyle(Brand.muted)
            Rectangle().fill(Brand.line).frame(height: 1)
        }
        .accessibilityHidden(true)
    }
}
