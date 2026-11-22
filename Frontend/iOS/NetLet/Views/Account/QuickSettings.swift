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
///
/// **And where every order goes** (0088, on the owner's word: "set or change
/// their default delivery address" in Settings): the address book as choices —
/// choosing one is the header sheet's own choice, kept on the account
/// (`DeliveryModel.choose`). **The way to pay is not here, on the owner's
/// word** ("remove the payment method from the quick settings"): checkout
/// opens on the account's default with Change, and what the account keeps
/// that is worth money is the Wallet's.
struct QuickSettingsCard: View {
    @Environment(LanguageSettings.self) private var l
    @Environment(AppModel.self) private var app

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
            addressRow
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

    private func rowLabel(_ symbol: String, _ key: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 20))
                .foregroundStyle(ProfileInk.icon)
                .frame(width: 26)
                .accessibilityHidden(true)
            Text(l.t(key))
                .font(.inter(16, .medium))
                .foregroundStyle(Brand.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func chip(_ text: String) -> some View {
        HStack(spacing: 6) {
            Text(text)
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
        .frame(maxWidth: 180, alignment: .trailing)
    }

    /// The address book as choices; an empty book opens it to add one.
    private var addressRow: some View {
        let delivery = app.delivery
        let book = delivery.addresses
        let chosen = delivery.inUse
        return HStack(spacing: 14) {
            rowLabel("mappin.and.ellipse", "quick.deliveryAddress")
            if book.isEmpty {
                Button {
                    app.openAccount(.addresses)
                } label: {
                    Label(l.t("quick.addAddress"), systemImage: "plus")
                        .font(.inter(15, .semibold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 40)
                        .background(Capsule().fill(ProfileInk.chip))
                }
                .buttonStyle(.tap)
                .fixedSize()
            } else {
                Menu {
                    ForEach(book) { row in
                        let zone = ReferenceData.shared.governorate(id: row.governorate)?.name(l.current)
                        Button {
                            Haptics.tap()
                            Task { await delivery.choose(row) }
                        } label: {
                            let text = [row.label, zone ?? l.t("quick.noArea")].joined(separator: " · ")
                            if row.id == chosen?.id {
                                Label(text, systemImage: "checkmark")
                            } else {
                                Text(text)
                            }
                        }
                        .disabled(row.governorate?.isEmpty != false)
                    }
                } label: {
                    chip(chosen?.label ?? l.t("home.chooseAreaShort"))
                }
                .accessibilityLabel(l.t("quick.deliveryAddress"))
                .accessibilityValue(chosen?.label ?? l.t("home.chooseAreaShort"))
            }
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
