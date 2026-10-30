import SwiftUI

/// What the footer carried, on the Profile tab — **the app has no footer, on
/// the owner's word** ("there is no need for a footer in app"). It was screens
/// of navy links under the home page's last shelf; most of them the app
/// already has a better door to (the departments are a tab, the offers and
/// the newest are shelves), and what it had alone is here: the help centre
/// (where WhatsApp, the phone and the email are), the returns policy, the
/// guides, finding somebody's wishlist, the stores, selling on NetLet, and the
/// terms, the privacy policy and the seller agreement — then who the shop is.
///
/// A guest's Profile tab is the sign-in form, and the footer was the only
/// place a guest could change the language, so the guest's card leads with
/// the same switch the signed-in account's first card has.
struct MoreFromNetLet: View {
    /// The language switch as the card's first row — for a guest, whose
    /// Profile tab has no other.
    var language = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private struct Row: Identifiable {
        let id: String
        let symbol: String
        let title: String
        let route: Route
    }

    private var helpRows: [Row] {
        var rows = [
            Row(id: "help", symbol: "lifepreserver", title: l.t("footer.helpCentre"), route: .helpCentre),
            Row(id: "returns", symbol: "arrow.uturn.backward", title: l.t("footer.returns"), route: .returnsPolicy),
        ]
        if app.features.isOn("articles") {
            rows.append(Row(id: "guides", symbol: "book", title: l.t("guides.title"), route: .guides))
        }
        // Finding somebody's list, while lists are switched on.
        if app.features.isOn("wishlists") {
            rows.append(Row(id: "gifts", symbol: "gift", title: l.t("gift.title"), route: .gifts))
        }
        rows.append(Row(id: "stores", symbol: "storefront", title: l.t("stores.title"), route: .stores))
        rows.append(Row(id: "sell", symbol: "bag.badge.plus", title: l.t("footer.sellWithUs"), route: .sell))
        return rows
    }

    private var legalRows: [Row] {
        [
            Row(id: "terms", symbol: "doc.text", title: l.t("footer.terms"), route: .legal(.terms)),
            Row(id: "privacy", symbol: "hand.raised", title: l.t("footer.privacy"), route: .legal(.privacy)),
            Row(id: "sellers", symbol: "signature", title: l.t("footer.sellerAgreement"), route: .legal(.sellers)),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("ios.account.moreTitle"))
                .font(.inter(15, .bold))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 8)
                .padding(.horizontal, 4)
            VStack(spacing: 0) {
                if language {
                    LanguageRow()
                    DashedRule()
                }
                rows(helpRows)
            }
            .padding(.horizontal, 20)
            .panel()
            VStack(spacing: 0) { rows(legalRows) }
                .padding(.horizontal, 20)
                .panel()
            Text(copyright)
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func rows(_ rows: [Row]) -> some View {
        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
            if index > 0 { DashedRule() }
            Button {
                app.push(row.route)
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: row.symbol)
                        .font(.system(size: 20))
                        .foregroundStyle(ProfileInk.icon)
                        .frame(width: 26)
                        .accessibilityHidden(true)
                    Text(row.title)
                        .font(.inter(16, .medium))
                        .foregroundStyle(Brand.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Brand.ink)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 56)
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
        }
    }

    /// Who the shop is: the invoices' own issuer, the footer's last line.
    private var copyright: String {
        let company = app.shelf.contact.company
        let named = company.map { l.current == .ar ? ($0.nameAr ?? $0.name) : $0.name } ?? l.t("footer.netlet")
        // `nameInSentence`: the name's own full stop is the sentence's.
        let name = named.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: #"\.+$"#, with: "", options: .regularExpression)
        let year = Calendar(identifier: .gregorian).component(.year, from: Date())
        var lines = [l.t("footer.copyright", ["year": String(year), "name": name])]
        if let licence = company?.licence {
            lines.append(l.t("footer.registration", ["number": "\u{2068}\(licence)\u{2069}"]))
        }
        return lines.joined(separator: "\n")
    }
}

/// The language as a row of the Profile tab: its name, and the two languages
/// as a switch, each word whole on one line — beside the label while they
/// fit, under it on a narrow screen or a large text size.
struct LanguageRow: View {
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) {
                label
                LanguageSwitch()
            }
            .frame(minHeight: 64)
            VStack(alignment: .leading, spacing: 10) {
                label
                LanguageSwitch()
            }
            .padding(.vertical, 14)
        }
    }

    private var label: some View {
        HStack(spacing: 14) {
            Image(systemName: "character.bubble")
                .font(.system(size: 20))
                .foregroundStyle(ProfileInk.icon)
                .frame(width: 26)
                .accessibilityHidden(true)
            Text(l.t("account.language"))
                .font(.inter(16, .medium))
                .foregroundStyle(Brand.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
        }
    }
}

/// The two languages, each in its own language and its own script.
struct LanguageSwitch: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 0) {
            ForEach([Language.en, Language.ar], id: \.self) { language in
                let active = l.current == language
                Button {
                    guard !active else { return }
                    app.setLanguage(language)
                } label: {
                    Text(l.t(language == .en ? "account.english" : "account.arabic"))
                        .font(.inter(15, .semibold))
                        .foregroundStyle(active ? Brand.ink : ProfileInk.icon)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 16)
                        .frame(minHeight: 40)
                        .background(Capsule().fill(active ? Color.white : Color.clear).shadow(color: Brand.navy.opacity(active ? 0.14 : 0), radius: 2, y: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(PressFillStyle(cornerRadius: 20, strength: Haptics.actionStrength))
                .environment(\.locale, language.locale)
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Capsule().fill(ProfileInk.chip))
        .fixedSize()
    }
}
