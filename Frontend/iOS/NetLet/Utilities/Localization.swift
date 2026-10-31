import Foundation
import Observation
import SwiftUI

/// The two languages the shop is written in.
enum Language: String, CaseIterable, Sendable {
    case en
    case ar

    var isRightToLeft: Bool { self == .ar }

    /// Latin digits in both, as the web writes prices and counts.
    var locale: Locale { Locale(identifier: self == .ar ? "ar_KW@numbers=latn" : "en_US") }

    var other: Language { self == .ar ? .en : .ar }

    /// The device's first choice, if it is Arabic; English otherwise.
    static func preferred(_ languages: [String] = Locale.preferredLanguages) -> Language {
        (languages.first ?? "en").hasPrefix("ar") ? .ar : .en
    }
}

/// One counted sentence's forms, by plural category (`Shared/i18n/plurals.ts`).
struct PluralEntry: Decodable, Sendable {
    let param: String
    let en: [String: String]?
    let ar: [String: String]?

    func forms(for language: Language) -> [String: String]? {
        language == .ar ? ar : en
    }
}

/// NetLet's one dictionary, read from the JSON `Frontend/iOS/scripts/exportShared.ts`
/// writes from `Shared/i18n/dictionary.ts`, so the app says what the web says,
/// in both languages, and a key the app uses is checked by the dictionary's tests.
final class Phrasebook: @unchecked Sendable {
    private let entries: [String: [String: String]]
    private let plurals: [String: PluralEntry]

    init(entries: [String: [String: String]], plurals: [String: PluralEntry]) {
        self.entries = entries
        self.plurals = plurals
    }

    /// The bundled dictionary. An app that cannot read its own words has nothing
    /// to show, so a missing file is a build fault, not a state to recover from.
    static let shared: Phrasebook = {
        let decoder = JSONDecoder()
        let entries = (try? decoder.decode([String: [String: String]].self, from: Bundle.main.resource("dictionary", "json"))) ?? [:]
        let plurals = (try? decoder.decode([String: PluralEntry].self, from: Bundle.main.resource("plurals", "json"))) ?? [:]
        return Phrasebook(entries: entries, plurals: plurals)
    }()

    func has(_ key: String) -> Bool { entries["en"]?[key] != nil }

    /// The text for `key`, with `{placeholders}` filled — `translate()` in TypeScript:
    /// the plural form when the key has one for this number, then the
    /// language's own string, then English, then the key itself.
    func text(_ key: String, language: Language, params: [String: String] = [:]) -> String {
        let template = pluralForm(key, language: language, params: params)
            ?? entries[language.rawValue]?[key]
            ?? entries["en"]?[key]
            ?? key
        guard !params.isEmpty else { return template }
        var result = ""
        var rest = Substring(template)
        while let open = rest.firstIndex(of: "{") {
            result += rest[..<open]
            guard let close = rest[open...].firstIndex(of: "}") else {
                rest = rest[open...]
                break
            }
            let name = String(rest[rest.index(after: open)..<close])
            if let value = params[name], !name.isEmpty, name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" }) {
                result += value
            } else {
                result += rest[open...close]
            }
            rest = rest[rest.index(after: close)...]
        }
        result += rest
        return result
    }

    private func pluralForm(_ key: String, language: Language, params: [String: String]) -> String? {
        /* A count drawn with its thousands grouped ("1,250 points") is still
           that count — `plurals.ts`'s rule: the grouping marks come out first. */
        guard let entry = plurals[key], let forms = entry.forms(for: language),
              let raw = params[entry.param],
              let n = Int(raw.filter { !",\u{066C}\u{00A0}\u{202F}".contains($0) }) else { return nil }
        return forms[Phrasebook.pluralCategory(n, language: language)]
    }

    /// CLDR's categories for the two languages, which is what `Intl.PluralRules` answers.
    static func pluralCategory(_ n: Int, language: Language) -> String {
        switch language {
        case .en:
            return n == 1 ? "one" : "other"
        case .ar:
            if n == 0 { return "zero" }
            if n == 1 { return "one" }
            if n == 2 { return "two" }
            let lastTwo = n % 100
            if (3...10).contains(lastTwo) { return "few" }
            if (11...99).contains(lastTwo) { return "many" }
            return "other"
        }
    }
}

/// The language the app is in, chosen in the app and kept on the device.
///
/// Like the web, it starts from the device's own language and can be switched
/// without leaving the app; the whole layout mirrors with it.
@Observable
@MainActor
final class LanguageSettings {
    private(set) var current: Language
    /// The currency prices are read in on the shopping screens (`price`) —
    /// a reading aid kept on the phone; everything is charged in dinars.
    private(set) var currency: String
    /// The day's rates once the server has said them; the reference until then.
    var rates: [String: Double] = CurrencyTable.shared.rates
    let phrasebook: Phrasebook
    private let defaults: UserDefaults
    private static let key = "netlet.language"
    private static let currencyKey = "netlet.currency"

    init(phrasebook: Phrasebook = .shared, defaults: UserDefaults = .standard) {
        self.phrasebook = phrasebook
        self.defaults = defaults
        current = Language(rawValue: defaults.string(forKey: Self.key) ?? "") ?? .preferred()
        let stored = defaults.string(forKey: Self.currencyKey) ?? CurrencyTable.shop
        currency = CurrencyTable.shared.knows(stored) ? stored : CurrencyTable.shop
    }

    func setCurrency(_ code: String) {
        guard CurrencyTable.shared.knows(code) else { return }
        currency = code
        defaults.set(code, forKey: Self.currencyKey)
    }

    /// A price on a shopping screen: dinars as they are, or — once the
    /// shopper reads prices in another currency — converted at the day's rate
    /// and marked "≈", since it is not what is charged. The web's `useMoney`.
    func price(_ money: Money) -> String {
        guard currency != CurrencyTable.shop, money.currencyCode == CurrencyTable.shop,
              let value = CurrencyTable.shared.convert(fils: money.fils, to: currency, rates: rates) else {
            return money.formatted(current)
        }
        let converted = CurrencyTable.shared.format(value, code: currency, language: current)
        // Nothing is nothing in any currency: no "≈" on a zero.
        return money.fils == 0 ? converted : "≈ " + converted
    }

    func t(_ key: String, _ params: [String: String] = [:]) -> String {
        phrasebook.text(key, language: current, params: params)
    }

    func set(_ language: Language) {
        current = language
        defaults.set(language.rawValue, forKey: Self.key)
    }

    var layoutDirection: LayoutDirection { current.isRightToLeft ? .rightToLeft : .leftToRight }

    /// "No products", "1 product", "3 products" — in Arabic, each count in the form its number needs.
    func productCount(_ count: Int) -> String {
        switch count {
        case 0: return t("browse.countNone")
        case 1: return t("browse.countOne")
        default: return t("browse.countMany", ["count": "\(count)"])
        }
    }
}

extension Bundle {
    /// A bundled file's bytes, or empty data when it is missing.
    func resource(_ name: String, _ ext: String) -> Data {
        guard let url = url(forResource: name, withExtension: ext), let data = try? Data(contentsOf: url) else { return Data() }
        return data
    }
}

extension View {
    /// A date picker whose days are Kuwait's, whatever zone the phone is set
    /// to. Every day the app sends is formatted as a Kuwaiti day, so a picker
    /// drawn in the phone's own zone sent the day before on a phone east of
    /// Kuwait (Dubai's midnight is still yesterday in Kuwait) and showed the
    /// day before for a stored day on one far to the west.
    func kuwaitDays() -> some View {
        environment(\.timeZone, TimeZone(identifier: "Asia/Kuwait") ?? TimeZone(secondsFromGMT: 3 * 3600)!)
    }
}
