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

    /// Whether anything was given as parts (`hasParts`).
    var isEmpty: Bool {
        let clean = cleaned()
        return [clean.area, clean.block, clean.street, clean.avenue, clean.building, clean.floor, clean.apartment, clean.paciNumber]
            .allSatisfy { $0 == nil }
    }

    /// The parts as one line, in the order a driver reads them — the web's
    /// `composeAddressLine`, the area in the page's language.
    func line(_ language: Language, reference: ReferenceData = .shared) -> String {
        let clean = cleaned()
        let labels = reference.partLabels[language.rawValue] ?? reference.partLabels["en"] ?? [:]
        var pieces: [String] = []
        if let area = clean.area { pieces.append(reference.areaName(area, language: language)) }
        for key in ["block", "street", "avenue", "building", "floor", "apartment"] {
            if let value = clean.value(for: key) { pieces.append("\(labels[key] ?? key) \(value)") }
        }
        if let paci = clean.paciNumber { pieces.append("PACI \(paci)") }
        return pieces.joined(separator: language == .ar ? "، " : ", ")
    }

    /// What is actively wrong with the parts given (`partsProblems`).
    func problems(reference: ReferenceData = .shared) -> [String] {
        let clean = cleaned()
        var found: [String] = []
        for key in ["area", "block", "street", "avenue", "building", "floor", "apartment", "paciNumber"] {
            if let value = clean.value(for: key), let max = reference.partMax[key], value.count > max {
                found.append("address.partTooLong")
                break
            }
        }
        if let paci = clean.paciNumber, !(paci.count == 8 && paci.allSatisfy { $0.isASCII && $0.isNumber }) {
            found.append("address.badPaci")
        }
        return found
    }

    /// The parts a driver needs that are still empty (`missingParts`).
    func missing(reference: ReferenceData = .shared) -> [String] {
        let clean = cleaned()
        return reference.requiredParts.filter { clean.value(for: $0) == nil }
    }

    /// Sets one part by its key, the web's `parts[key] = value`.
    mutating func set(_ key: String, _ value: String?) {
        switch key {
        case "area": area = value
        case "block": block = value
        case "street": street = value
        case "avenue": avenue = value
        case "building": building = value
        case "floor": floor = value
        case "apartment": apartment = value
        case "paciNumber": paciNumber = value
        default: break
        }
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

/// A point on the map, to five decimals (`Shared/commerce/geo.ts`): one
/// value, never two columns, because half a coordinate is not a place.
struct Pin: Codable, Hashable, Sendable {
    var lat: Double
    var lng: Double

    /// Kept to five decimals, about a metre — the web's `roundPin`.
    var rounded: Pin {
        Pin(lat: (lat * 100_000).rounded() / 100_000, lng: (lng * 100_000).rounded() / 100_000)
    }

    /// Why this pin cannot be kept, or nil (`pinProblem`).
    func problem(reference: ReferenceData = .shared) -> String? {
        guard lat.isFinite, lng.isFinite else { return "address.badPin" }
        return reference.bounds.contains(self) ? nil : "address.pinOutsideKuwait"
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
    var pin: Pin? = nil

    /// The line drawn on a page: composed from the parts when it has them,
    /// else the line as it was typed (`addressLineIn`).
    func line(_ language: Language) -> String {
        if let parts, !parts.isEmpty { return parts.line(language) }
        return (addressLine ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// What is merely missing, for the card to say (`missingFromAddress`).
    var gaps: [String] {
        var missing: [String] = []
        if (governorate ?? "").trimmingCharacters(in: .whitespaces).isEmpty { missing.append("address.noZone") }
        if (contactPhone ?? "").trimmingCharacters(in: .whitespaces).isEmpty { missing.append("address.noPhone") }
        if (contactName ?? "").trimmingCharacters(in: .whitespaces).isEmpty { missing.append("address.noName") }
        return missing
    }
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

    /// A stored `+965…` number as people read one: "5500 1122" (`formatPhone`).
    static func display(_ canonical: String) -> String {
        let local = canonical.replacingOccurrences(of: "+\(countryCode)", with: "")
        guard local.count == localDigits else { return canonical }
        return "\(local.prefix(4)) \(local.dropFirst(4))"
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

/// What a giver typed into the gift lookup — `giftLookup` in
/// `Shared/commerce/wishlist.ts`: a Kuwaiti number first, since "5012 3456"
/// is a name nobody has, then the name an owner shows on a public list (two
/// letters to sixty, with a letter in it), or neither.
enum GiftLookup: Equatable {
    case phone(String)
    case name(String)

    static let nameMax = 60

    static func read(_ raw: String) -> GiftLookup? {
        let text = raw.precomposedStringWithCanonicalMapping
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        if let phone = PhoneNumber.normalise(text) { return .phone(phone) }
        if text.count >= 2, text.count <= nameMax, text.contains(where: \.isLetter) { return .name(text) }
        return nil
    }
}
