import Foundation

/// An amount of money, held in fils — thousandths of a dinar — never as a
/// floating-point number.
///
/// The dinar has three decimal places and a binary fraction cannot hold
/// 24.375, which is why the server sends amounts as decimal strings and why
/// they are read here into whole fils: a total that does not equal its parts
/// to the fil is the fastest way to lose a shopper's trust.
///
/// It decodes the two shapes the API uses: `{ "amount": "4.750",
/// "currencyCode": "KWD" }` on the catalogue and the cart, and a bare
/// `"72.000"` on an order.
struct Money: Codable, Hashable, Comparable, Sendable {
    var fils: Int
    var currencyCode: String

    init(fils: Int, currencyCode: String = "KWD") {
        self.fils = fils
        self.currencyCode = currencyCode
    }

    /// Reads a decimal string — "4.750", "72", "385.00" — or nil if it is not one.
    init?(amount: String, currencyCode: String = "KWD") {
        guard let fils = Money.parseFils(amount) else { return nil }
        self.init(fils: fils, currencyCode: currencyCode)
    }

    static let zero = Money(fils: 0)

    /// The amount as the API writes it: three decimals, a dot, no grouping.
    var amount: String {
        let sign = fils < 0 ? "-" : ""
        let value = abs(fils)
        return "\(sign)\(value / 1000).\(String(format: "%03d", value % 1000))"
    }

    var isZero: Bool { fils == 0 }

    static func parseFils(_ text: String) -> Int? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let negative = trimmed.hasPrefix("-")
        let body = negative ? String(trimmed.dropFirst()) : trimmed
        let parts = body.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2, let whole = parts.first, !whole.isEmpty, whole.allSatisfy(\.isASCIIDigit),
              let wholeValue = Int(whole) else { return nil }
        var fraction = 0
        if parts.count == 2 {
            let digits = parts[1]
            guard !digits.isEmpty, digits.count <= 3, digits.allSatisfy(\.isASCIIDigit) else { return nil }
            fraction = Int(digits.padding(toLength: 3, withPad: "0", startingAt: 0)) ?? 0
        }
        let fils = wholeValue * 1000 + fraction
        return negative ? -fils : fils
    }

    // MARK: Arithmetic, in whole fils

    static func + (lhs: Money, rhs: Money) -> Money { Money(fils: lhs.fils + rhs.fils, currencyCode: lhs.currencyCode) }
    static func - (lhs: Money, rhs: Money) -> Money { Money(fils: lhs.fils - rhs.fils, currencyCode: lhs.currencyCode) }
    static func * (lhs: Money, rhs: Int) -> Money { Money(fils: lhs.fils * rhs, currencyCode: lhs.currencyCode) }
    static func < (lhs: Money, rhs: Money) -> Bool { lhs.fils < rhs.fils }

    // MARK: Formatting

    /// The web's `formatMoney`: the currency's own three decimals, and a whole
    /// amount drawn clean — "KWD 129", not "KWD 129.000" — in Latin digits on
    /// both pages.
    func formatted(_ language: Language) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = language.locale
        formatter.currencyCode = currencyCode
        let whole = fils % 1000 == 0
        formatter.minimumFractionDigits = whole ? 0 : 3
        formatter.maximumFractionDigits = whole ? 0 : 3
        let value = NSDecimalNumber(mantissa: UInt64(abs(fils)), exponent: -3, isNegative: fils < 0)
        return formatter.string(from: value) ?? "\(currencyCode) \(amount)"
    }

    // MARK: Codable

    private enum CodingKeys: String, CodingKey {
        case amount
        case currencyCode
    }

    init(from decoder: Decoder) throws {
        if let container = try? decoder.container(keyedBy: CodingKeys.self) {
            let text = try container.decode(String.self, forKey: .amount)
            let code = try container.decodeIfPresent(String.self, forKey: .currencyCode) ?? "KWD"
            guard let fils = Money.parseFils(text) else {
                throw DecodingError.dataCorruptedError(forKey: .amount, in: container, debugDescription: "Not an amount: \(text)")
            }
            self.init(fils: fils, currencyCode: code)
            return
        }
        let single = try decoder.singleValueContainer()
        if let text = try? single.decode(String.self), let fils = Money.parseFils(text) {
            self.init(fils: fils)
            return
        }
        if let number = try? single.decode(Int.self) {
            self.init(fils: number * 1000)
            return
        }
        throw DecodingError.dataCorruptedError(in: single, debugDescription: "Not an amount")
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(amount, forKey: .amount)
        try container.encode(currencyCode, forKey: .currencyCode)
    }
}

private extension Character {
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}
