import SwiftUI

/// The address book — the web's `AddressBook`: every saved address with what
/// is still missing from it, changed with its pencil, taken out after asking,
/// and a new one added in the same form checkout fills from.
struct AddressBookView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var editing: Editing?
    @State private var removing: SavedAddress?

    /// The form's subject: a new address, or one being changed.
    struct Editing: Identifiable {
        let address: SavedAddress?
        var id: Int { address?.id ?? 0 }
    }

    var body: some View {
        ModelHost(make: { Loader { try await app.services.account.addresses() } }) { book in
            ShopPage(refresh: { await book.load() }) {
                AccountSection(title: l.t("address.book"), hint: l.t("account.hint.addresses")) {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(l.t("address.bookNote"))
                            .font(.inter(14))
                            .foregroundStyle(Brand.body)
                            .fixedSize(horizontal: false, vertical: true)
                        LoadStateView(state: book.state, retry: { await book.load() }) { rows in
                            content(rows, book: book)
                        }
                    }
                }
            }
            .task { await book.load() }
            .sheet(item: $editing) { subject in
                AddressFormSheet(address: subject.address) { _ in
                    Task { await book.load() }
                }
            }
            .confirmationDialog(l.t("address.removeTitle"), isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                Button(l.t("address.remove"), role: .destructive) {
                    guard let address = removing else { return }
                    Task {
                        if await app.attempt(done: "address.removed", { _ = try await app.services.api.call(API.removeAddress, .init(id: address.id)) }) {
                            await book.load()
                        }
                    }
                }
                Button(l.t("common.cancel"), role: .cancel) {}
            } message: {
                Text(l.t("address.removeBody"))
            }
        }
    }

    @ViewBuilder
    private func content(_ rows: [SavedAddress], book: Loader<[SavedAddress]>) -> some View {
        let max = ReferenceData.shared.rules.accountRules.maxAddresses
        VStack(alignment: .leading, spacing: 10) {
            if rows.isEmpty {
                Text(l.t("address.none"))
                    .font(.inter(14))
                    .foregroundStyle(Brand.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
            } else {
                ForEach(rows) { row in card(row) }
            }
            Button {
                editing = Editing(address: nil)
            } label: {
                Label(l.t("address.add"), systemImage: "plus")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(rows.count >= max)
            .padding(.top, 6)
            Text(l.t("address.count", ["count": "\(rows.count)", "max": "\(max)"]))
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
        }
    }

    private func card(_ row: SavedAddress) -> some View {
        let zone = ReferenceData.shared.governorate(id: row.governorate)?.name(l.current)
        let facts = [zone, row.contactName, row.contactPhone].compactMap { $0?.isEmpty == false ? $0 : nil }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "mappin.and.ellipse").foregroundStyle(Brand.navy).accessibilityHidden(true)
                Text(row.label)
                    .font(.inter(15, .bold))
                    .foregroundStyle(Brand.navy)
                    .frame(maxWidth: .infinity, alignment: .leading)
                IconButton(symbol: "pencil", label: "\(l.t("address.editTitle")) — \(row.label)") { editing = Editing(address: row) }
                IconButton(symbol: "trash", label: "\(l.t("address.remove")) — \(row.label)") { removing = row }
            }
            Text(row.line(l.current))
                .font(.inter(14))
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
            if !facts.isEmpty {
                Text(facts.map { "\u{2068}\($0)\u{2069}" }.joined(separator: " · "))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
            }
            if row.pin != nil {
                Label(l.t("address.pinned"), systemImage: "mappin.circle")
                    .font(.inter(12, .semibold))
                    .foregroundStyle(Brand.success)
            }
            if !row.gaps.isEmpty {
                Text(row.gaps.map { l.t($0) }.joined(separator: " · "))
                    .font(.inter(12))
                    .foregroundStyle(Brand.accentInk)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

/// A small round button with an icon and a name a screen reader says — the web's `DiscButton`.
struct IconButton: View {
    let symbol: String
    let label: String
    var role: ButtonRole?
    let action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(role == .destructive ? Brand.danger : Brand.navy)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Brand.tint))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .accessibilityLabel(label)
    }
}

/// The address form in a sheet: the label, the parts, who to call, notes and
/// the map pin, Save and Cancel — the web's `AddressForm`.
struct AddressFormSheet: View {
    let address: SavedAddress?
    var requireGovernorate = false
    var heading: String?
    let onSaved: (SavedAddress) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ModelHost(make: { AddressFormModel(editing: address, api: app.services.api, requireGovernorate: requireGovernorate) }) { model in
                AddressFormBody(model: model) { saved in
                    onSaved(saved)
                    dismiss()
                }
            }
            .navigationTitle(heading ?? l.t(address == nil ? "address.addTitle" : "address.editTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(l.t("common.cancel")) { dismiss() }
                }
            }
        }
        .environment(\.layoutDirection, l.layoutDirection)
        .buttonStyle(HapticDefaultStyle())
    }
}

private struct AddressFormBody: View {
    @Bindable var model: AddressFormModel
    let onSaved: (SavedAddress) -> Void
    @State private var picking = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                LabeledField(label: l.t("address.label"), text: $model.label, placeholder: l.t("address.labelPlaceholder"))
                AddressPartsFields(model: model, governorateOptional: !model.requireGovernorate) { keys in
                    model.showsProblems ? model.problems.first(where: { keys.contains($0) }) : nil
                }
                if let line = model.legacyLine, model.parts.isEmpty {
                    Text("\(l.t("address.legacyLine")) \u{2068}\(line)\u{2069}")
                        .font(.footnote)
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                LabeledField(label: l.t("address.contactName"), text: $model.contactName, content: .name)
                LabeledField(
                    label: l.t("address.contactPhone"),
                    text: $model.contactPhone,
                    placeholder: "5000 0000",
                    keyboard: .phonePad,
                    content: .telephoneNumber,
                    leftToRight: true
                )
                LabeledField(label: l.t("address.notes"), text: $model.notes, axis: .vertical)
                pinSection
                if model.showsProblems {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(model.problems, id: \.self) { FieldProblem(key: $0) }
                    }
                }
                Button {
                    Task { await save() }
                } label: {
                    if model.saving { ProgressView().tint(.white) } else { Text(l.t("address.save")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!model.problems.isEmpty || model.saving)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Brand.ground.ignoresSafeArea())
        .fullScreenCover(isPresented: $picking) {
            PinPickerSheet(start: model.pin ?? startingPin) { pin in model.pin = pin }
        }
    }

    /// Where the map opens: the pin, or the middle of the governorate, or of Kuwait.
    private var startingPin: Pin {
        let reference = ReferenceData.shared
        return model.governorate.flatMap { reference.governorateCentres[$0] } ?? reference.centre
    }

    private var pinSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.pin != nil {
                Label(l.t("pin.pinned"), systemImage: "mappin.circle.fill")
                    .font(.inter(14, .semibold))
                    .foregroundStyle(Brand.success)
                HStack(spacing: 10) {
                    Button(l.t("pin.move")) { picking = true }
                        .buttonStyle(SecondaryButtonStyle())
                    Button(l.t("pin.remove")) { model.pin = nil }
                        .buttonStyle(SecondaryButtonStyle())
                }
            } else {
                Button {
                    picking = true
                } label: {
                    Label(l.t("pin.drop"), systemImage: "mappin.and.ellipse")
                }
                .buttonStyle(SecondaryButtonStyle())
                Text(l.t("pin.why"))
                    .font(.footnote)
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.tint.opacity(0.6)))
    }

    private func save() async {
        var saved: SavedAddress?
        let worked = await app.attempt(done: "address.saved") { saved = try await model.save() }
        if worked, let saved { onSaved(saved) }
    }
}
