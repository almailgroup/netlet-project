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
