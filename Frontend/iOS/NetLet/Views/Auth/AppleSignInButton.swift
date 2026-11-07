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

/// "Continue with Google" — the web's `GoogleButton`, drawn to Google's
/// branding rules: white, a grey rim, Google's four-colour G, the words beside
/// it, the height of the form's own button.
struct GoogleSignInButton: View {
    let label: String
    var working = false
    let action: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if working {
                    ProgressView().tint(Brand.ink)
                } else {
                    GoogleMark().frame(width: 18, height: 18).accessibilityHidden(true)
                }
                Text(l.t(label))
                    .font(.inter(15, .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(Color(red: 31 / 255, green: 31 / 255, blue: 31 / 255))
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().strokeBorder(Color(red: 116 / 255, green: 119 / 255, blue: 117 / 255), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .disabled(working)
        .accessibilityIdentifier("googleSignIn")
    }
}

/// Google's G, in its four colours, from the same drawing the website uses —
/// absolute M, L, C and Z on a 48 grid, read by `TabIcon.cgPath`. Never
/// mirrored on the Arabic page: it is a letter.
struct GoogleMark: View {
    private static let parts: [(String, Color)] = [
        ("M 24 9.5 C 27.54 9.5 30.71 10.72 33.21 13.1 L 40.06 6.25 C 35.9 2.38 30.47 0 24 0 C 14.62 0 6.51 5.38 2.56 13.22 L 10.54 19.41 C 12.43 13.72 17.74 9.5 24 9.5 Z",
         Color(red: 234 / 255, green: 67 / 255, blue: 53 / 255)),
        ("M 46.98 24.55 C 46.98 22.98 46.83 21.46 46.6 20 L 24 20 L 24 29.02 L 36.94 29.02 C 36.36 31.98 34.68 34.5 32.16 36.2 L 39.89 42.2 C 44.4 38.02 46.98 31.84 46.98 24.55 Z",
         Color(red: 66 / 255, green: 133 / 255, blue: 244 / 255)),
        ("M 10.53 28.59 C 10.05 27.14 9.77 25.6 9.77 24 C 9.77 22.4 10.04 20.86 10.53 19.41 L 2.55 13.22 C 0.92 16.46 0 20.12 0 24 C 0 27.88 0.92 31.54 2.56 34.78 L 10.53 28.59 Z",
         Color(red: 251 / 255, green: 188 / 255, blue: 5 / 255)),
        ("M 24 48 C 30.48 48 35.93 45.87 39.89 42.19 L 32.16 36.19 C 30.01 37.64 27.24 38.49 24 38.49 C 17.74 38.49 12.43 34.27 10.53 28.58 L 2.55 34.77 C 6.51 42.62 14.62 48 24 48 Z",
         Color(red: 52 / 255, green: 168 / 255, blue: 83 / 255)),
    ]

    var body: some View {
        Canvas { context, size in
            let scale = min(size.width, size.height) / 48
            for (d, colour) in Self.parts {
                let path = Path(TabIcon.cgPath(d)).applying(CGAffineTransform(scaleX: scale, y: scale))
                context.fill(path, with: .color(colour))
            }
        }
        .environment(\.layoutDirection, .leftToRight)
    }
}

/// "Continue with Microsoft" — the web's `MicrosoftButton`, drawn to
/// Microsoft's light sign-in button: white, a #8C8C8C rim, #5E5E5E words, the
/// four squares beside them, the height of the form's own button.
struct MicrosoftSignInButton: View {
    let label: String
    var working = false
    let action: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if working {
                    ProgressView().tint(Brand.ink)
                } else {
                    MicrosoftMark().frame(width: 18, height: 18).accessibilityHidden(true)
                }
                Text(l.t(label))
                    .font(.inter(15, .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(Color(red: 94 / 255, green: 94 / 255, blue: 94 / 255))
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().strokeBorder(Color(red: 140 / 255, green: 140 / 255, blue: 140 / 255), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .disabled(working)
        .accessibilityIdentifier("microsoftSignIn")
    }
}

/// Microsoft's four squares, in their colours, on a 21 grid as the website's.
/// Never mirrored on the Arabic page: it is a logo.
struct MicrosoftMark: View {
    var body: some View {
        Canvas { context, size in
            let unit = min(size.width, size.height) / 21
            let squares: [(CGFloat, CGFloat, Color)] = [
                (1, 1, Color(red: 242 / 255, green: 80 / 255, blue: 34 / 255)),
                (11, 1, Color(red: 127 / 255, green: 186 / 255, blue: 0)),
                (1, 11, Color(red: 0, green: 164 / 255, blue: 239 / 255)),
                (11, 11, Color(red: 1, green: 185 / 255, blue: 0)),
            ]
            for (x, y, colour) in squares {
                context.fill(Path(CGRect(x: x * unit, y: y * unit, width: 9 * unit, height: 9 * unit)), with: .color(colour))
            }
        }
        .environment(\.layoutDirection, .leftToRight)
    }
}
