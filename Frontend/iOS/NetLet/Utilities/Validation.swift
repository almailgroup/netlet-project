import Foundation

/// The form rules the server holds, asked early so a message appears under the
/// box rather than after a round trip. Each mirrors its TypeScript original in
/// `Shared/`, and every message is a key the web already uses.
enum Validation {
    /// An email address with an @ and a domain — the sign-in form's own check.
    static func emailProblem(_ email: String) -> String? {
        let value = email.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return "auth.emailRequired" }
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, parts[1].contains("."),
              !parts[1].hasPrefix("."), !parts[1].hasSuffix("."), !value.contains(" ") else { return "auth.emailInvalid" }
        return nil
    }

    /// Why a new password cannot be saved, or nil: the two rules the meter
    /// ticks (`checkPassword`), the form's and the server's own.
    static func newPasswordProblem(_ password: String) -> String? {
        if password.isEmpty { return "auth.passwordRequired" }
        return checkPassword(password).acceptable ? nil : "auth.passwordNeedsRules"
    }

    // MARK: The password meter — `Shared/auth/passwordStrength.ts`

    /// How good a password is and which rules it has not met — the web's
    /// `checkPassword`, rule for rule, on the same cases. Lengths are counted
    /// in UTF-16 units, as JavaScript counts them, so the two agree on an
    /// emoji. Only `length` and `notCommon` block; the rest raise the score.
    struct PasswordVerdict: Equatable {
        enum Band: String { case weak, fair, good, strong }
        let score: Int
        let band: Band
        let unmet: [String]
        let acceptable: Bool
    }

    static func checkPassword(
        _ password: String,
        floor: Int = ReferenceData.shared.rules.passwordFloor,
        common: [String] = ReferenceData.shared.rules.commonPasswordList
    ) -> PasswordVerdict {
        let units = password.utf16.count
        let scalars = password.unicodeScalars
        let hasLower = scalars.contains(where: isLowerLetter)
        let hasUpper = scalars.contains(where: isUpperLetter)
        let hasDigit = scalars.contains(where: isDigit)
        let hasOther = scalars.contains { !isLowerLetter($0) && !isUpperLetter($0) && !isDigit($0) }
        var unmet: [String] = []
        if units < floor { unmet.append("length") }
        if !(hasLower && hasUpper) { unmet.append("case") }
        if !hasDigit { unmet.append("number") }
        if !hasOther { unmet.append("symbol") }
        if units > 0 && isCommonPassword(password, common: common) { unmet.append("notCommon") }
        if units == 0 { return PasswordVerdict(score: 0, band: .weak, unmet: unmet, acceptable: false) }

        var score = 0.0
        if units >= floor { score += 1 }
        if units >= 14 { score += 1 }
        if units >= 20 { score += 1 }
        if !unmet.contains("case") { score += 1 }
        if !unmet.contains("number") { score += 0.5 }
        if !unmet.contains("symbol") { score += 0.5 }
        if unmet.contains("notCommon") { score = min(score, 1) }
        if unmet.contains("length") { score = min(score, 1) }
        let whole = max(0, min(4, Int(score.rounded(.toNearestOrAwayFromZero))))
        let band: PasswordVerdict.Band = whole <= 1 ? .weak : whole == 2 ? .fair : whole == 3 ? .good : .strong
        return PasswordVerdict(score: whole, band: band, unmet: unmet, acceptable: !unmet.contains("length") && !unmet.contains("notCommon"))
    }

    /// One character over and over, a digit ladder, or a common word under its
    /// digits and punctuation — matched against the whole core, never a part of it.
    private static func isCommonPassword(_ password: String, common: [String]) -> Bool {
        let units = Array(password.utf16)
        if units.count >= 2, units.allSatisfy({ $0 == units[0] }) { return true }
        for ladder in ["0123456789", "1234567890", "9876543210", "1234567", "7654321"] where password.hasPrefix(ladder) {
            if password.dropFirst(ladder.count).unicodeScalars.allSatisfy(isDigit) { return true }
        }
        let lower = password.lowercased()
        var core = String.UnicodeScalarView()
        core.append(contentsOf: lower.unicodeScalars.filter(isLowerLetter))
        let coreWord = String(core)
        return common.contains { $0 == coreWord || $0 == lower }
    }

    /* ASCII alone, as the web's `[a-z]`, `[A-Z]` and `\d` are. */
    private static func isLowerLetter(_ scalar: Unicode.Scalar) -> Bool { (97...122).contains(scalar.value) }
    private static func isUpperLetter(_ scalar: Unicode.Scalar) -> Bool { (65...90).contains(scalar.value) }
    private static func isDigit(_ scalar: Unicode.Scalar) -> Bool { (48...57).contains(scalar.value) }

    // MARK: Your profile — `Shared/commerce/profileDetails.ts`

    /// Why a first and last name cannot be saved (`nameProblem`), or nil.
    static func nameProblem(first: String, last: String, max: Int? = nil) -> String? {
        let max = max ?? ReferenceData.shared.rules.profileRules.namePartMax
        let first = first.trimmingCharacters(in: .whitespacesAndNewlines)
        let last = last.trimmingCharacters(in: .whitespacesAndNewlines)
        if first.isEmpty || last.isEmpty { return "profile.nameRequired" }
        if first.count > max || last.count > max { return "profile.nameTooLong" }
        return nil
    }

    /// Why a typed phone cannot be the account's (`profilePhone`), or nil; an
    /// empty box clears it.
    static func profilePhoneProblem(_ raw: String) -> String? {
        let typed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if typed.isEmpty { return nil }
        return PhoneNumber.normalise(typed) == nil ? "wishlist.phoneInvalid" : nil
    }

    /// Why a birthday cannot be saved (`birthdayProblem`): a real `yyyy-mm-dd`
    /// from the earliest the form takes to `today`, the Kuwaiti day.
    static func birthdayProblem(_ value: String, today: String, earliest: String? = nil) -> String? {
        let earliest = earliest ?? ReferenceData.shared.rules.profileRules.earliestBirthday
        let pieces = value.split(separator: "-", omittingEmptySubsequences: false)
        guard pieces.count == 3, pieces[0].count == 4, pieces[1].count == 2, pieces[2].count == 2,
              let year = Int(pieces[0]), let month = Int(pieces[1]), let day = Int(pieces[2]),
              (1...12).contains(month) else { return "profile.birthdayInvalid" }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)),
              calendar.component(.day, from: date) == day, calendar.component(.month, from: date) == month else {
            return "profile.birthdayInvalid"
        }
        if value < earliest || value > today { return "profile.birthdayInvalid" }
        return nil
    }

    /// Six digits, in either script.
    static func normaliseCode(_ code: String) -> String {
        PhoneNumber.foldDigits(code).filter { ("0"..."9").contains($0) }
    }

    // MARK: Listings — `draftProblems` in Shared/inventory/productDraft.ts

    struct ListingDraft: Equatable {
        var title = ""
        var titleAr = ""
        var price = ""
        var stock = ""
        var description = ""
        var warranty = ""
        var compareAtPrice = ""
        var sku = ""
    }

    /// In the form's order, which is the order a refusal is pointed at.
    enum ListingField: String, CaseIterable {
        case title, titleAr, warranty, price, compareAtPrice, sku, stock, description
    }

    static func listingProblems(_ draft: ListingDraft, departmentSlug: String?, rules: Rules.Listing) -> [ListingField: String] {
        var problems: [ListingField: String] = [:]
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty { problems[.title] = "admin.newTitleRequired" }
        else if title.count > rules.maxTitle { problems[.title] = "admin.newTooLong" }

        let titleAr = draft.titleAr.trimmingCharacters(in: .whitespacesAndNewlines)
        if titleAr.isEmpty { problems[.titleAr] = "admin.newTitleArRequired" }
        else if titleAr.count > rules.maxTitle { problems[.titleAr] = "admin.newTooLong" }

        let warranty = draft.warranty.trimmingCharacters(in: .whitespacesAndNewlines)
        if let slug = departmentSlug, rules.warrantyRequiredDepartments.contains(slug), warranty.isEmpty {
            problems[.warranty] = "admin.newWarrantyRequired"
        } else if warranty.count > 200 {
            problems[.warranty] = "admin.newTooLong"
        }

        let price = draft.price.trimmingCharacters(in: .whitespacesAndNewlines)
        if price.isEmpty { problems[.price] = "admin.newPriceRequired" }
        else if !isMoneyShape(price) { problems[.price] = "admin.newPriceShape" }
        else if (Money.parseFils(price) ?? 0) <= 0 { problems[.price] = "admin.newPricePositive" }

        // Equal or lower is not a saving, and the shop would strike through a
        // price that is not higher.
        let was = draft.compareAtPrice.trimmingCharacters(in: .whitespacesAndNewlines)
        if !was.isEmpty {
            if !isMoneyShape(was) { problems[.compareAtPrice] = "admin.newPriceShape" }
            else if isMoneyShape(price), (Money.parseFils(was) ?? 0) <= (Money.parseFils(price) ?? 0) { problems[.compareAtPrice] = "admin.newWasHigher" }
        }

        if draft.sku.trimmingCharacters(in: .whitespacesAndNewlines).count > rules.maxSku { problems[.sku] = "admin.newTooLong" }

        let stock = draft.stock.trimmingCharacters(in: .whitespacesAndNewlines)
        if !stock.isEmpty {
            if !stock.allSatisfy({ ("0"..."9").contains($0) }) || (Int(stock) ?? Int.max) > rules.maxStock {
                problems[.stock] = "admin.newStockShape"
            }
        }

        if draft.description.count > rules.maxDescription { problems[.description] = "admin.newTooLong" }
        return problems
    }

    /// `^\d{1,9}(\.\d{1,3})?$` — the money shape the router accepts.
    static func isMoneyShape(_ text: String) -> Bool {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2, let whole = parts.first, (1...9).contains(whole.count),
              whole.allSatisfy({ ("0"..."9").contains($0) }) else { return false }
        if parts.count == 2 {
            let fraction = parts[1]
            return (1...3).contains(fraction.count) && fraction.allSatisfy { ("0"..."9").contains($0) }
        }
        return true
    }

    // MARK: Checkout — the web checkout's blockers and `partsProblems`

    /// The first thing the chosen saved address still needs for an order, in
    /// the order the web's checkout says them: a door at all, the parts a
    /// driver finds it by, then the number the driver rings. An address kept
    /// as one line before the parts existed is ordered to by its line.
    static func savedAddressProblem(_ address: SavedAddress, phone: String, requiredParts: [String]) -> String? {
        if address.line(.en).isEmpty { return "checkout.needAddress" }
        let cleaned = (address.parts ?? AddressParts()).cleaned()
        if !cleaned.isEmpty {
            if requiredParts.contains(where: { cleaned.value(for: $0) == nil }) { return "address.needsParts" }
            if let paci = cleaned.paciNumber, paci.count != 8 || !paci.allSatisfy({ ("0"..."9").contains($0) }) {
                return "address.badPaci"
            }
        }
        let trimmed = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "checkout.needPhone" }
        if PhoneNumber.normalise(trimmed) == nil { return "checkout.badPhone" }
        return nil
    }
}
