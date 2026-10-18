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
        if password.count < 10 { return "auth.ruleLength" }
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
    }

    enum ListingField: String, CaseIterable {
        case title, titleAr, price, stock, description, warranty
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

    // MARK: Checkout — `refusalFor` and `partsProblems`

    /// The first thing a delivery still needs, in the order checkout asks for it.
    static func deliveryProblem(governorate: String?, parts: AddressParts, phone: String, requiredParts: [String]) -> String? {
        if governorate == nil { return "checkout.needGovernorate" }
        let cleaned = parts.cleaned()
        if requiredParts.contains(where: { cleaned.value(for: $0) == nil }) { return "checkout.needAddress" }
        if let paci = cleaned.paciNumber, paci.count != 8 || !paci.allSatisfy({ ("0"..."9").contains($0) }) {
            return "address.badPaci"
        }
        let trimmed = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "checkout.needPhone" }
        if PhoneNumber.normalise(trimmed) == nil { return "checkout.badPhone" }
        return nil
    }
}
