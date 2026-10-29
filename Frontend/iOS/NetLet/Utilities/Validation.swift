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

    /// The new-password floor's first rule. The rest — "not easy to guess" — is
    /// the server's, and comes back as `auth.passwordTooWeak`.
    static func newPasswordProblem(_ password: String) -> String? {
        if password.isEmpty { return "auth.passwordRequired" }
        if password.count < ReferenceData.shared.rules.passwordFloor { return "auth.ruleLength" }
        return nil
    }

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
