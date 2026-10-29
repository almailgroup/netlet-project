import Foundation

/// What a dropped pin reads — the area, block, street and house at that spot
/// (`maps.placeAt`, the web's `PlaceAnswer`). The server reads it; the app
/// only shows it and fills the boxes from it, so the two read one rule
/// (`Shared/commerce/placeParts.ts`).
struct PlaceAnswer: Decodable, Hashable, Sendable {
    let parts: AddressParts
    /// A governorate id, or nil.
    let governorate: String?
    /// "osm" or "apple" — OpenStreetMap asks to be credited where its data is shown.
    let source: String
}

/// The form's parts after a pin — the web's `fillFromPlace`, rule for rule.
///
/// **A pin writes what is empty or was the pin's**, never over what the
/// shopper typed: where it disagrees with a typed box that box is a conflict
/// the form names, with a press that takes the pin's (`force`). A part an
/// earlier pin wrote and this one has no answer for is emptied. The
/// governorate follows an area the pin wrote; otherwise it is filled only
/// when none was chosen.
enum PinFill {
    static let keys = ["area", "block", "street", "avenue", "building"]

    struct Result: Equatable {
        var parts: AddressParts
        var governorate: String?
        /// The parts the pin wrote, so the form can say which and a later pin may write them again.
        var filled: [String]
        /// Parts the shopper typed that the pin disagrees with, left as typed.
        var conflicts: [String]
    }

    static func apply(current: AddressParts, governorate: String?, place: PlaceAnswer, byPin: [String], force: Bool = false) -> Result {
        var parts = current
        var filled: [String] = []
        var conflicts: [String] = []
        for key in keys {
            let value = place.parts.value(for: key)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let typed = (current.value(for: key) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let mine = byPin.contains(key)
            if value.isEmpty {
                if mine { parts.set(key, "") }
                continue
            }
            if typed.isEmpty || mine || force || same(typed, value) {
                parts.set(key, value)
                filled.append(key)
            } else {
                conflicts.append(key)
            }
        }
        let zone = governorate.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
        let follows = filled.contains("area") || zone == nil || force
        return Result(parts: parts, governorate: place.governorate != nil && follows ? place.governorate : zone, filled: filled, conflicts: conflicts)
    }

    /// Two values the same for a form: digits folded, case and spacing ignored.
    static func same(_ a: String, _ b: String) -> Bool {
        func norm(_ text: String) -> String {
            PhoneNumber.foldDigits(text).split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        }
        return norm(a) == norm(b)
    }
}

/// Whether an edit moved an address — the web's `whereChanged`: its
/// governorate, its parts, its line or its pin, rather than only its name,
/// number or notes. A new address and a moved one are read back with "Is
/// this your address?"; a renamed one saves at once.
enum AddressMove {
    static func moved(
        before: SavedAddress,
        governorate: String?,
        parts: AddressParts,
        line: String?,
        pin: Pin?
    ) -> Bool {
        func zone(_ value: String?) -> String { value?.trimmingCharacters(in: .whitespaces) ?? "" }
        func point(_ value: Pin?) -> String {
            guard let value, value.problem() == nil else { return "" }
            let kept = value.rounded
            return "\(kept.lat),\(kept.lng)"
        }
        let beforeParts = before.parts?.cleaned() ?? AddressParts()
        let afterParts = parts.cleaned()
        let beforeLine = beforeParts.isEmpty ? (before.addressLine ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : ""
        let afterLine = afterParts.isEmpty ? (line ?? "").trimmingCharacters(in: .whitespacesAndNewlines) : ""
        return zone(before.governorate) != zone(governorate)
            || beforeParts != afterParts
            || beforeLine != afterLine
            || point(before.pin) != point(pin)
    }
}
