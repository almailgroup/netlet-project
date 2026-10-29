import Foundation

/// A quantity typed into a bag line — `Shared/commerce/typedQuantity.ts`, rule
/// for rule, on the owner's word: the number between the minus and the plus
/// is a box, so twenty is two keys rather than nineteen presses of the plus.
/// Arabic-Indic digits are folded, zero takes the line out as the bin does,
/// over the ceiling is held to it and said, and anything that is not a whole
/// number changes nothing.
enum TypedQuantity: Equatable {
    case set(quantity: Int, capped: Bool)
    case remove

    static func read(_ text: String, ceiling: Int) -> TypedQuantity? {
        let digits = PhoneNumber.foldDigits(text).trimmingCharacters(in: .whitespaces)
        guard (1...4).contains(digits.count), digits.allSatisfy({ $0.isASCII && $0.isNumber }), let value = Int(digits) else { return nil }
        if value == 0 { return .remove }
        return .set(quantity: min(value, ceiling), capped: value > ceiling)
    }

    /// What the box may hold while it is typed in: digits only, at most four.
    static func draft(_ text: String) -> String {
        String(PhoneNumber.foldDigits(text).filter { $0.isASCII && $0.isNumber }.prefix(4))
    }
}
