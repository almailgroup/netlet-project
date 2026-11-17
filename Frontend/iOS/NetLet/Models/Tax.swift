import Foundation

/// Tax added at checkout (migration 0087) as the app says it: the rate a
/// person reads, the web's `rateLabel` in `Shared/commerce/tax.ts`. Every
/// figure is the server's — the bag's `tax`, the order's, the invoice's — so
/// the app reckons no tax of its own.
enum TaxWording {
    /// "5.00" reads "5%", "2.50" reads "2.5%". Nothing for a rate that cannot be read.
    static func rateLabel(_ ratePercent: String) -> String {
        guard let number = Double(ratePercent), number.isFinite, number > 0 else { return "0%" }
        let exact = (number * 100).rounded() / 100
        if exact == exact.rounded() { return "\(Int(exact))%" }
        // At most two decimals, with no trailing zero ("2.5", "2.25").
        var text = String(format: "%.2f", exact)
        while text.hasSuffix("0") { text.removeLast() }
        return text + "%"
    }
}
