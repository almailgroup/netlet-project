import SwiftUI
import UIKit

/// Light, dark or as the phone is — **dark mode, on the owner's word**
/// (option 9 of the list of improvements). Every colour in `Brand` has a dark
/// value, resolved by the view's own colour scheme; this decides which scheme
/// the app is drawn in, kept on this phone (`key`) and chosen in Preferences
/// (`AppearanceCard`).
///
/// **It starts Light** until the dark pictures have been looked at, so a
/// phone set to dark is not handed a dark shop before it is ready; "Same as
/// the phone" is then the default to move to. A UI test or a screenshot run
/// is light unless it passes `-NetLetAppearance dark`.
///
/// It is applied two ways, because neither reaches everything alone:
/// `preferredColorScheme` on the root, which SwiftUI applies from the first
/// frame and to every sheet, and `overrideUserInterfaceStyle` on each window,
/// which the system's own alerts (`RemovalQuestion`) and the keyboard read.
enum Appearance: String, CaseIterable, Identifiable, Sendable {
    case light
    case dark
    case system

    nonisolated static let key = "netlet.appearance"
    /// Until the dark pictures are reviewed (see above).
    nonisolated static let fallback: Appearance = .light

    var id: String { rawValue }

    /// What is kept, or the launch argument a screenshot run passes, or the
    /// fallback.
    nonisolated static var current: Appearance {
        let defaults = UserDefaults.standard
        #if DEBUG
        if let forced = defaults.string(forKey: "NetLetAppearance"), let value = Appearance(rawValue: forced) {
            return value
        }
        #endif
        return defaults.string(forKey: key).flatMap(Appearance.init(rawValue:)) ?? fallback
    }

    /// The scheme SwiftUI is asked for; nil follows the phone.
    var colorScheme: ColorScheme? {
        switch self {
        case .light: return .light
        case .dark: return .dark
        case .system: return nil
        }
    }

    var interfaceStyle: UIUserInterfaceStyle {
        switch self {
        case .light: return .light
        case .dark: return .dark
        case .system: return .unspecified
        }
    }

    /// The choice's words.
    var titleKey: String {
        switch self {
        case .light: return "ios.appearance.light"
        case .dark: return "ios.appearance.dark"
        case .system: return "ios.appearance.system"
        }
    }

    /// Every window the app has takes the choice: the system's alerts and the
    /// keyboard read the window's style, not SwiftUI's.
    @MainActor static func applyToWindows(_ appearance: Appearance = current) {
        for scene in UIApplication.shared.connectedScenes {
            guard let windows = (scene as? UIWindowScene)?.windows else { continue }
            for window in windows {
                window.overrideUserInterfaceStyle = appearance.interfaceStyle
            }
        }
    }
}

/// Preferences' Appearance: three choices in a row, the one in use filled.
struct AppearanceCard: View {
    @Environment(LanguageSettings.self) private var l
    @AppStorage(Appearance.key) private var stored = Appearance.fallback.rawValue

    private var chosen: Appearance { Appearance(rawValue: stored) ?? Appearance.fallback }

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Appearance.allCases) { option in
                let on = chosen == option
                Button {
                    stored = option.rawValue
                    Appearance.applyToWindows(option)
                } label: {
                    Text(l.t(option.titleKey))
                        .font(.inter(13, .semibold))
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.85)
                        .foregroundStyle(on ? Color.white : Brand.navy)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.horizontal, 6)
                        .background(Capsule().fill(on ? Brand.navyFill : Brand.surface))
                        .overlay(Capsule().strokeBorder(on ? Color.clear : Brand.line, lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.tap)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("appearance-\(option.rawValue)")
            }
        }
    }
}
