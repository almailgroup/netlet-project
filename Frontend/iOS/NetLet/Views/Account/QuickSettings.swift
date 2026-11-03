import SwiftUI

/// Country, currency and language on the Profile tab itself — the web's
/// `QuickSettings`, on the owner's word: "clearly visible and directly
/// accessible from the My Profile page, rather than being hidden inside the
/// Preferences section". One card of three rows, each changed where it is drawn.
///
/// **Country is Kuwait, and the rest of the Gulf is named as coming** — none
/// of them can be chosen (`Shared/commerce/country.ts`), because a country
/// somebody could pick and then be delivered nothing in would be a control
/// that lies. Each is the phone's own name for it, in the page's language.
struct QuickSettingsCard: View {
    @Environment(LanguageSettings.self) private var l

    private var rules: Rules.AfterSales { ReferenceData.shared.rules.afterSalesRules }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(l.t("quick.settingsTitle"))
                .font(.inter(16, .bold))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 16)
                .padding(.bottom, 4)
            countryRow
            DashedRule()
            CurrencyRow()
            DashedRule()
            LanguageRow()
            Text(l.t("quick.note"))
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
                .padding(.bottom, 16)
        }
        .padding(.horizontal, 20)
        .panel()
    }

    private var countryRow: some View {
        HStack(spacing: 14) {
            Image(systemName: "globe")
                .font(.system(size: 20))
                .foregroundStyle(ProfileInk.icon)
                .frame(width: 26)
                .accessibilityHidden(true)
            Text(l.t("quick.country"))
                .font(.inter(16, .medium))
                .foregroundStyle(Brand.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
            Menu {
                ForEach(rules.countries, id: \.code) { country in
                    // Only the shop's own country can be chosen; the rest say they are coming.
                    Button {
                        Haptics.tap()
                    } label: {
                        if country.code == rules.homeCountry {
                            Label(Self.flag(country.code) + " " + CountryNames.name(country.code, language: l.current), systemImage: "checkmark")
                        } else {
                            Text(Self.flag(country.code) + " " + CountryNames.name(country.code, language: l.current) + " · " + l.t("quick.comingSoon"))
                        }
                    }
                    .disabled(!country.open)
                }
            } label: {
                HStack(spacing: 6) {
                    Text(Self.flag(rules.homeCountry) + " " + CountryNames.name(rules.homeCountry, language: l.current))
                        .font(.inter(15, .semibold))
                        .foregroundStyle(Brand.ink)
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(ProfileInk.icon)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 40)
                .background(Capsule().fill(ProfileInk.chip))
                .fixedSize()
            }
            .accessibilityLabel(l.t("quick.country"))
            .accessibilityValue(CountryNames.name(rules.homeCountry, language: l.current))
        }
        .padding(.vertical, 12)
        .frame(minHeight: 64)
    }

    /// A flag from a country code, by its regional-indicator letters — `flagOf`.
    static func flag(_ code: String) -> String {
        guard code.count == 2, code.allSatisfy({ $0.isASCII && $0.isUppercase }) else { return "" }
        return String(String.UnicodeScalarView(code.unicodeScalars.compactMap { Unicode.Scalar(0x1F1E6 + $0.value - 65) }))
    }
}
