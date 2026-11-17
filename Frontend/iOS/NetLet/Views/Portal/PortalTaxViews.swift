import SwiftUI

/// Taxed, not taxed, or back to the shop's setting (0087) — the three marks
/// NetLet may put on a product, as radio rows: the bulk sheet's and the editor's.
struct TaxChoicePicker: View {
    @Binding var choice: String
    var disabled = false
    @Environment(LanguageSettings.self) private var l

    static let choices = ["taxed", "exempt", "follow"]

    static func label(_ choice: String) -> String {
        switch choice {
        case "taxed": return "tax.choiceTaxed"
        case "exempt": return "tax.choiceExempt"
        default: return "tax.choiceFollow"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(l.t("tax.choiceLabel")).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
            ForEach(Self.choices, id: \.self) { option in
                Button {
                    choice = option
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: choice == option ? "largecircle.fill.circle" : "circle")
                            .font(.system(size: 18))
                            .foregroundStyle(choice == option ? Brand.navy : Brand.muted)
                        Text(l.t(Self.label(option))).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .disabled(disabled)
                .accessibilityAddTraits(choice == option ? [.isSelected] : [])
            }
        }
    }
}

/// A product's tax in its editor (0087): whether it is taxed by today's rules,
/// whether NetLet marked it or it follows the shop's setting, and — for NetLet,
/// whose decision it is on the owner's word — the three marks. The web's
/// `ProductTaxCard`.
struct ProductTaxSection: View {
    let productId: Int
    @State private var status: API.ProductTax?
    @State private var choice = "follow"
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let status {
                let rate = TaxWording.rateLabel(status.ratePercent)
                Text(status.on
                     ? (status.taxed ? l.t("tax.editorTaxed", ["rate": rate]) : l.t("tax.editorNotTaxed"))
                     : (status.taxed ? l.t("tax.editorOffTaxed", ["rate": rate]) : l.t("tax.editorOffNotTaxed")))
                    .font(.inter(14, .semibold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                Text(l.t(status.choice == nil ? "tax.editorFollows" : "tax.editorMarked"))
                    .font(.inter(13)).foregroundStyle(Brand.muted)
                if !status.ready {
                    Label(l.t("tax.unavailable"), systemImage: "exclamationmark.triangle")
                        .font(.inter(13)).foregroundStyle(Brand.accentInk).fixedSize(horizontal: false, vertical: true)
                } else if status.mayChange {
                    TaxChoicePicker(choice: $choice, disabled: saving)
                    SectionSave(pending: saving, disabled: saving || choice == (status.choice ?? "follow")) {
                        Task { await save() }
                    }
                } else {
                    Text(l.t("tax.editorNetLetOnly")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 60)
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let read = try? await app.services.api.call(API.productTax, .init(id: productId)) else { return }
        status = read
        choice = read.choice ?? "follow"
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var answer: API.ProductTax?
        if await app.attempt(done: "tax.saved", fallback: "admin.saveFailed", {
            answer = try await app.services.api.call(API.setProductTax, .init(id: productId, choice: choice))
        }), let answer {
            status = answer
            choice = answer.choice ?? "follow"
        }
    }
}
