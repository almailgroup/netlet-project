import Foundation

/// A Kuwaiti address as its parts, in the order a driver reads them
/// (`Shared/commerce/kuwaitAddress.ts`). A part left empty is not sent.
struct AddressParts: Codable, Hashable, Sendable {
    var area: String?
    var block: String?
    var street: String?
    var avenue: String?
    var building: String?
    var floor: String?
    var apartment: String?
    var paciNumber: String?

    /// The same parts with every box trimmed, Arabic-Indic digits folded, and
    /// an empty box dropped — `cleanParts` in TypeScript.
    func cleaned() -> AddressParts {
        func clean(_ value: String?) -> String? {
            guard let value else { return nil }
            let folded = PhoneNumber.foldDigits(value).trimmingCharacters(in: .whitespacesAndNewlines)
            return folded.isEmpty ? nil : folded
        }
        return AddressParts(
            area: clean(area), block: clean(block), street: clean(street), avenue: clean(avenue),
            building: clean(building), floor: clean(floor), apartment: clean(apartment), paciNumber: clean(paciNumber)
        )
    }

    func value(for key: String) -> String? {
        switch key {
        case "area": return area
        case "block": return block
        case "street": return street
        case "avenue": return avenue
        case "building": return building
        case "floor": return floor
        case "apartment": return apartment
        case "paciNumber": return paciNumber
        default: return nil
        }
    }
}

/// A saved address in the shopper's book (`customer.addresses.list`).
struct SavedAddress: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let label: String
    let contactName: String?
    let contactPhone: String?
    let governorate: String?
    let addressLine: String?
    let addressNotes: String?
    let parts: AddressParts?
}

/// A Kuwaiti mobile number, read the way people type one.
enum PhoneNumber {
    static let countryCode = "965"
    static let localDigits = 8

    /// Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits folded onto
    /// ASCII, because an Arabic keyboard is the obvious way to type a number
    /// on an Arabic page.
    static func foldDigits(_ text: String) -> String {
        String(text.unicodeScalars.map { scalar -> Character in
            switch scalar.value {
            case 0x0660...0x0669: return Character(String(scalar.value - 0x0660))
            case 0x06F0...0x06F9: return Character(String(scalar.value - 0x06F0))
            default: return Character(scalar)
            }
        })
    }

    /// `normalisePhone` in `Shared/commerce/wishlist.ts`: `+965` and eight
    /// digits, or nil for anything that is not a Kuwaiti number.
    static func normalise(_ raw: String) -> String? {
        let digits = foldDigits(raw.trimmingCharacters(in: .whitespacesAndNewlines)).filter(\.isNumber).filter(\.isASCII)
        let withoutTrunk = digits.hasPrefix("00\(countryCode)") ? String(digits.dropFirst(2)) : digits
        let local = withoutTrunk.hasPrefix(countryCode) ? String(withoutTrunk.dropFirst(countryCode.count)) : withoutTrunk
        guard local.count == localDigits else { return nil }
        return "+\(countryCode)\(local)"
    }
}
