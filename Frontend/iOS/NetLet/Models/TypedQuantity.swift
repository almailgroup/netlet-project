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

/// How many a bag line may hold — `lineCeiling`, `shortLines`, `roomFor` and
/// `cardCeiling` in `Shared/commerce/typedQuantity.ts`, rule for rule. The bag
/// took up to the line ceiling whatever the shelf held, so somebody could ask
/// for forty with twenty-eight on the shelf, see nothing amiss, and be refused
/// at Place order. A line read before the server sent `maxQuantity` has the
/// ceiling alone.
enum BagStock {
    static var ceiling: Int { ReferenceData.shared.rules.maxLineQuantity }

    /// What there is of the line's variant, less the bag's other lines of it,
    /// held to the line ceiling and never below one.
    static func lineCeiling(_ line: CartItem, in lines: [CartItem]) -> Int {
        guard let most = line.maxQuantity else { return ceiling }
        let others = lines.filter { $0.variantId == line.variantId && $0.lineId != line.lineId }.reduce(0) { $0 + $1.quantity }
        return max(1, min(ceiling, most - others))
    }

    /// The lines asking for more of their variant than there is, with how many there are.
    static func shortLines(_ lines: [CartItem]) -> [String: Int] {
        var asked: [String: Int] = [:]
        for line in lines { asked[line.variantId, default: 0] += line.quantity }
        var short: [String: Int] = [:]
        for line in lines {
            guard let most = line.maxQuantity else { continue }
            if (asked[line.variantId] ?? 0) > most { short[line.lineId] = max(0, most) }
        }
        return short
    }

    /// How many more of a variant one press may add, after what the bag holds of it.
    static func room(_ maxQuantity: Int, inBag: Int) -> Int {
        max(1, min(ceiling, maxQuantity - inBag))
    }

    /// The most a card may put in its plain line: that line's own ceiling once
    /// it is in the bag, otherwise what is left of the variant.
    static func cardCeiling(_ variant: ProductVariant?, line: CartItem?, in lines: [CartItem]) -> Int {
        guard let variant else { return ceiling }
        if var line {
            if line.maxQuantity == nil { line.maxQuantity = variant.maxQuantity }
            return lineCeiling(line, in: lines)
        }
        return room(variant.maxQuantity, inBag: lines.filter { $0.variantId == variant.id }.reduce(0) { $0 + $1.quantity })
    }
}
