import SwiftUI

/// A portal page's frame — the web's `AdminShell` page with its `PageHeader`:
/// the title and one line on what the page holds, on the pearl ground, under
/// the system's own navigation bar, since the portal is outside the shop's frame.
struct PortalScreen<Content: View>: View {
    let title: String
    var intro: String?
    var refresh: (() async -> Void)?
    @ViewBuilder var content: () -> Content
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title).pageTitle().fixedSize(horizontal: false, vertical: true)
                    if let intro {
                        Text(intro).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    }
                }
                content()
            }
            .padding(16)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .modifier(PortalRefresh(action: refresh))
        .background(Brand.pearl.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .environment(\.layoutDirection, l.layoutDirection)
    }
}

private struct PortalRefresh: ViewModifier {
    let action: (() async -> Void)?

    func body(content: Content) -> some View {
        if let action { content.refreshable { await action() } } else { content }
    }
}

/// A section's heading inside a portal page (`SectionHeading`).
struct PortalSectionHeading: View {
    let title: String
    var note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.inter(17, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            if let note { Text(note).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A count with somewhere to go — the overview's `Tile`. A count with
/// nowhere to go is decoration, so it opens its page when the app has it.
struct PortalTile: View {
    let value: Int
    let label: String
    var urgent = false
    var href: String?
    @Environment(AppModel.self) private var app

    var body: some View {
        let face = VStack(alignment: .leading, spacing: 6) {
            Text("\(value)")
                .font(.inter(26, .heavy))
                .foregroundStyle(urgent ? Brand.accentInk : Brand.navy)
                .environment(\.layoutDirection, .leftToRight)
            HStack(spacing: 4) {
                Text(label).font(.inter(13, .semibold)).foregroundStyle(Brand.ink).multilineTextAlignment(.leading)
                if href.map(PortalPage.draws) == true {
                    Image(systemName: "arrow.forward").font(.system(size: 11, weight: .semibold)).foregroundStyle(Brand.muted).flipsForRightToLeftLayoutDirection(true)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(urgent ? Brand.orange.opacity(0.45) : Brand.cardLine, lineWidth: 1))
        if let href, PortalPage.draws(href) {
            Button { app.open(.portal(href)) } label: { face }
                .buttonStyle(PressFillStyle(cornerRadius: 14))
        } else {
            face
        }
    }
}

/// One figure in a row of them (`Stat`).
struct PortalStat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            Text(value).font(.inter(18, .heavy)).foregroundStyle(Brand.navy).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }
}

/// "Nothing is waiting", said plainly.
struct PortalAllClear: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "checkmark.circle.fill")
            .font(.inter(14, .semibold))
            .foregroundStyle(Brand.success)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.successFill))
    }
}

/// A row of choices that narrows a list (`Segmented`): buttons, not tabs.
struct PortalSegmented<Value: Hashable>: View {
    let label: String
    @Binding var value: Value
    let options: [(Value, String)]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                    Button {
                        value = option.0
                    } label: {
                        Text(option.1)
                            .font(.inter(13, .semibold))
                            .foregroundStyle(value == option.0 ? Color.white : Brand.navy)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 36)
                            .background(Capsule().fill(value == option.0 ? Brand.navy : Color.white))
                            .overlay(Capsule().strokeBorder(Brand.line, lineWidth: value == option.0 ? 0 : 1))
                    }
                    .buttonStyle(.tap)
                    .accessibilityAddTraits(value == option.0 ? .isSelected : [])
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}

/// The server's refusal for a portal page the person may not use — "not
/// yours" rather than an empty page that implies there is nothing in it.
struct PortalForbidden: View {
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        EmptyStateView(systemImage: "lock", title: l.t("admin.forbidden"))
            .card(padding: 0)
    }
}

extension OrderTone {
    /// The portal's `Pill` tones in the order pills' palette.
    static func portal(_ tone: String) -> OrderTone {
        switch tone {
        case "warning": return .preparing
        case "navy": return .shipped
        case "good": return .done
        case "danger": return .stopped
        default: return .waiting
        }
    }
}

/// A paged list's count and its two arrows (`Pager`): the count is drawn even
/// on one page, because the count is what keeps a short list honest.
struct PortalPager: View {
    let page: Int
    let pageSize: Int
    let total: Int
    let go: (Int) -> Void
    @Environment(LanguageSettings.self) private var l

    private var pages: Int { max(1, (total + max(pageSize, 1) - 1) / max(pageSize, 1)) }

    var body: some View {
        HStack(spacing: 10) {
            Text(total == 0 ? l.t("admin.showingNone") : l.t("admin.showingRange", [
                "first": "\((page - 1) * pageSize + 1)", "last": "\(min(page * pageSize, total))", "total": "\(total)",
            ]))
            .font(.inter(13))
            .foregroundStyle(Brand.muted)
            Spacer()
            if pages > 1 {
                arrow("chevron.backward", l.t("admin.previousPage"), enabled: page > 1) { go(page - 1) }
                arrow("chevron.forward", l.t("admin.nextPage"), enabled: page < pages) { go(page + 1) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("admin.pagination"))
    }

    private func arrow(_ symbol: String, _ label: String, enabled: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(enabled ? Brand.navy : Brand.chevron)
                .flipsForRightToLeftLayoutDirection(true)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color.white))
                .overlay(Circle().strokeBorder(Brand.line, lineWidth: 1))
        }
        .buttonStyle(.tap)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }
}

/// A small action beside a line — the portal's `smallButtonClass`: navy, a
/// white rim, or the quiet red of an act that takes something away.
struct PortalSmallButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, danger }
    var kind: Kind = .secondary
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(13, .semibold))
            .lineLimit(1)
            .foregroundStyle(kind == .primary ? Color.white : kind == .danger ? Brand.danger : Brand.navy)
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .background(Capsule().fill(kind == .primary ? (configuration.isPressed ? Brand.navyPressed : Brand.navy) : configuration.isPressed ? Brand.tint : Color.white))
            .overlay(Capsule().strokeBorder(kind == .primary ? Color.clear : kind == .danger ? Brand.danger.opacity(0.35) : Brand.line, lineWidth: 1))
            .opacity(isEnabled ? 1 : 0.45)
            .pressHaptic(configuration.isPressed)
    }
}

/// A card on a portal page: white, a hairline rim, 14 round.
struct PortalCard<Content: View>: View {
    var highlighted = false
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8, content: content)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(highlighted ? Brand.navy.opacity(0.3) : Brand.cardLine, lineWidth: 1))
    }
}

/// "Nothing here" on a portal page — a sentence, never an empty table.
struct PortalEmpty: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.inter(14))
            .foregroundStyle(Brand.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28)
            .padding(.horizontal, 16)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

/// A Latin value inside a sentence on either page: an email, a reference, an IBAN.
func latin(_ text: String) -> String { "\u{2066}\(text)\u{2069}" }

/// A line that says something about the page's state (`Notice`): good news
/// in green, something to know in orange, a refusal in red, a fact in navy.
struct PortalNotice: View {
    enum Tone { case success, warning, danger, info }
    let text: String
    var tone: Tone = .info

    var body: some View {
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol)
        }
        .font(.inter(13, .semibold))
        .foregroundStyle(ink)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(fill))
    }

    private var symbol: String {
        switch tone {
        case .success: return "checkmark.circle.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .danger: return "xmark.octagon.fill"
        case .info: return "info.circle.fill"
        }
    }

    private var ink: Color {
        switch tone {
        case .success: return Brand.success
        case .warning: return Brand.accentInk
        case .danger: return Brand.danger
        case .info: return Brand.navy
        }
    }

    private var fill: Color {
        switch tone {
        case .success: return Brand.successFill
        case .warning: return Color(red: 254 / 255, green: 241 / 255, blue: 233 / 255)
        case .danger: return Color(red: 251 / 255, green: 234 / 255, blue: 232 / 255)
        case .info: return Brand.tint
        }
    }
}
