import SwiftUI

/// "Pay with: Cash on delivery · KNET coming soon" — the ways a store takes as
/// a shopper reads them today (`StorePay.line`), the web's `PayWith`: under a
/// product's price, on a store's page and under a store's lines in the cart.
/// A store that takes only what NetLet does not take yet says it cannot be
/// ordered right now.
struct PayWithLine: View {
    let methods: [String]?
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if let methods, !methods.isEmpty {
            let line = StorePay.line(methods)
            let words = { (list: [String]) in list.map { l.t(StorePay.key($0)) }.joined(separator: " · ") }
            if line.now.isEmpty {
                Label {
                    Text(l.t("storePay.notYet", ["list": words(line.soon)]))
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "exclamationmark.circle")
                }
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.testInk)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Label {
                    (Text("\(l.t("storePay.payWith")): ").font(.inter(13, .semibold))
                     + Text(words(line.now))
                     + (line.soon.isEmpty ? Text("") : Text(" · \(l.t("storePay.soon", ["list": words(line.soon)]))").foregroundColor(Brand.muted)))
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "wallet.pass")
                }
                .font(.inter(13))
                .foregroundStyle(Brand.navy)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
