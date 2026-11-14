import SwiftUI

/// One extra as the editor holds it: the row it came from, and the draft.
struct AddonRow: Identifiable, Hashable {
    let id = UUID()
    /// The stored row's id, sent back so a save updates it where it stands.
    var stored: Int?
    var draft: AddonRules.Draft

    static func from(_ addon: EditableProduct.Addon) -> AddonRow {
        AddonRow(stored: addon.id, draft: AddonRules.draft(kind: addon.kind, label: addon.label, labelAr: addon.labelAr,
                                                          price: addon.price, months: addon.warrantyMonths))
    }
}

extension Array where Element == AddonRow {
    /// What is sent: the rows that are not blank, with the ids they came from.
    var toSend: [API.AddonInput] {
        filter { !AddonRules.isBlank($0.draft) }.map { row in
            let draft = row.draft
            return API.AddonInput(id: row.stored, kind: draft.kind, label: draft.label.trimmingCharacters(in: .whitespacesAndNewlines),
                                  labelAr: .text(draft.labelAr), price: draft.price.trimmingCharacters(in: .whitespacesAndNewlines),
                                  warrantyMonths: draft.kind == "warranty" ? draft.warrantyMonths : nil)
        }
    }

    /// Each sent row's problems, by the row's id; blank rows have none.
    var problems: [UUID: [AddonRules.Problem]] {
        let sent = filter { !AddonRules.isBlank($0.draft) }
        let found = AddonRules.problems(sent.map(\.draft))
        return Dictionary(uniqueKeysWithValues: zip(sent.map(\.id), found))
    }

    var hasProblems: Bool { problems.values.contains { !$0.isEmpty } }
}

/// Warranty and installation (3.1.2), on the owner's word — the web's
/// `AddonsEditor`: an installation fee of its own, extended warranty plans
/// each with a length and a price, and any other extra, every one named in
/// English and Arabic or named for the seller. Drawn by the product editor
/// and the new listing form, so the two cannot ask different things. A
/// problem is said under its box once Save or Create has been pressed.
struct AddonsEditor: View {
    @Binding var rows: [AddonRow]
    var enabled = true
    let attempted: Bool
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let problems = attempted ? rows.problems : [:]
        VStack(alignment: .leading, spacing: 20) {
            ForEach(AddonRules.groups, id: \.self) { kind in
                group(kind, problems: problems)
            }
        }
    }

    @ViewBuilder private func group(_ kind: String, problems: [UUID: [AddonRules.Problem]]) -> some View {
        let own = rows.filter { $0.draft.kind == kind }
        /* One installation fee: a second would be the same visit twice. */
        let mayAdd = enabled && rows.count < AddonRules.maxAddons && (kind != "installation" || own.isEmpty)
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t(Self.words(kind).title)).font(.inter(15, .semibold)).foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                Text(l.t(Self.words(kind).note)).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(own) { row in
                item(row, problems: problems[row.id] ?? [])
            }
            if mayAdd {
                Button { rows.append(AddonRow(draft: AddonRules.Draft(kind: kind))) } label: {
                    Label(l.t(Self.words(kind).add), systemImage: "plus")
                }
                .buttonStyle(PortalSmallButtonStyle())
            }
        }
    }

    private func item(_ row: AddonRow, problems: [AddonRules.Problem]) -> some View {
        let said = { (parts: [AddonRules.Problem]) in problems.first { parts.contains($0) }?.key }
        let fallback = AddonRules.defaultName(kind: row.draft.kind, months: row.draft.warrantyMonths, language: l.current)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                if row.draft.kind == "warranty" {
                    VStack(alignment: .leading, spacing: 4) {
                        ChoiceField(label: l.t("admin.warrantyLength"), current: row.draft.warrantyMonths.map(String.init),
                                    placeholder: l.t("admin.warrantyLengthChoose"),
                                    options: AddonRules.warrantyMonths.map { (String($0), AddonRules.lengthWords($0, language: l.current)) },
                                    enabled: enabled) { value in update(row.id) { $0.warrantyMonths = value.flatMap { Int($0) } } }
                        FieldProblem(key: said([.warrantyLength, .warrantyTwice]))
                    }
                }
                LabeledField(label: l.t("admin.addonPrice"), text: binding(row.id, \.price), placeholder: "5.000",
                             problem: said([.price]), keyboard: .decimalPad, leftToRight: true)
                if enabled {
                    Button {
                        Task {
                            guard await RemovalQuestion.formRow(l) else { return }
                            rows.removeAll { $0.id == row.id }
                        }
                    } label: {
                        Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(Brand.danger).frame(width: 44, height: 44)
                    }
                    .buttonStyle(.tap)
                    .padding(.top, 22)
                    .accessibilityLabel(l.t("admin.addonRemove"))
                }
            }
            let optional = " (\(l.t("admin.optional")))"
            LabeledField(label: l.t("admin.addonNameEn") + (row.draft.kind == "other" ? "" : optional), text: binding(row.id, \.label),
                         placeholder: row.draft.kind == "other" ? "" : AddonRules.defaultName(kind: row.draft.kind, months: row.draft.warrantyMonths, language: .en) ?? "",
                         problem: said([.name, .nameLong]))
            LabeledField(label: l.t("admin.addonNameAr") + optional, text: binding(row.id, \.labelAr),
                         placeholder: row.draft.kind == "other" ? "" : AddonRules.defaultName(kind: row.draft.kind, months: row.draft.warrantyMonths, language: .ar) ?? "")
                .environment(\.layoutDirection, .rightToLeft)
            if let fallback, row.draft.label.trimmingCharacters(in: .whitespaces).isEmpty, row.draft.labelAr.trimmingCharacters(in: .whitespaces).isEmpty {
                Text(l.t("admin.addonNamedForYou", ["name": fallback])).font(.footnote).foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line))
        .disabled(!enabled)
    }

    private func update(_ id: UUID, _ change: (inout AddonRules.Draft) -> Void) {
        guard let index = rows.firstIndex(where: { $0.id == id }) else { return }
        change(&rows[index].draft)
    }

    private func binding(_ id: UUID, _ path: WritableKeyPath<AddonRules.Draft, String>) -> Binding<String> {
        Binding(get: { rows.first { $0.id == id }?.draft[keyPath: path] ?? "" },
                set: { value in update(id) { $0[keyPath: path] = String(value.prefix(AddonRules.nameMax)) } })
    }

    private static func words(_ kind: String) -> (title: String, note: String, add: String) {
        switch kind {
        case "installation": return ("admin.installTitle", "admin.installNote", "admin.installAdd")
        case "warranty": return ("admin.warrantyTitle", "admin.warrantyNote", "admin.warrantyAdd")
        default: return ("admin.otherTitle", "admin.otherNote", "admin.otherAdd")
        }
    }
}
