import Foundation

/// The currencies prices may be read in, and the reference rates
/// (`Shared/commerce/currency.ts`, exported as `currency.json`), on the
/// owner's word: the dinar, the US dollar, the pound, the euro and the Gulf's.
///
/// **NetLet sells in Kuwaiti dinars, and that does not change.** A display
/// currency is a reading aid on the shopping screens — a dinar price
/// converted at the day's rate and marked "≈" (`LanguageSettings.price`) —
/// while checkout charges, and every record shows, dinars.
struct CurrencyTable: Decodable, Sendable {
    let currencies: [String]
    let rates: [String: Double]
    let asOf: String
    let minorDigits: [String: Int]

    static let shop = "KWD"

    static let shared: CurrencyTable = {
        let data = Bundle.main.resource("currency", "json")
        return (try? JSONDecoder().decode(CurrencyTable.self, from: data))
            ?? CurrencyTable(currencies: [shop], rates: [shop: 1], asOf: "", minorDigits: [shop: 3])
    }()

    func knows(_ code: String) -> Bool { currencies.contains(code) }

    /// A dinar amount in another currency, rounded to that currency's own
    /// minor unit — `convertFromDinars`. Nil without a rate, so the caller
    /// shows dinars rather than an invented figure.
    func convert(fils: Int, to code: String, rates: [String: Double]) -> Double? {
        guard code != Self.shop else { return Double(fils) / 1000 }
        guard let rate = rates[code] ?? self.rates[code], rate > 0, rate.isFinite else { return nil }
        let digits = minorDigits[code] ?? 2
        let scale = pow(10, Double(digits))
        return (Double(fils) / 1000 * rate * scale).rounded() / scale
    }

    /// An amount in a currency, in the language's own way of writing it; a
    /// whole amount clean, as the dinar's is.
    func format(_ value: Double, code: String, language: Language) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = language.locale
        formatter.currencyCode = code
        let whole = value.rounded() == value
        let digits = whole ? 0 : (minorDigits[code] ?? 2)
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        return formatter.string(from: NSNumber(value: value)) ?? "\(code) \(value)"
    }

    /// "US Dollar (USD)", named by the phone in the page's language.
    static func name(_ code: String, language: Language) -> String {
        let name = language.locale.localizedString(forCurrencyCode: code)
        return name.map { "\($0) (\(code))" } ?? code
    }
}

/// The day's rates, as the server reads them (`commerce.currencyRates`).
struct CurrencyRatesAnswer: Decodable, Sendable {
    let rates: [String: Double]
    let asOf: String
    let source: String
}
