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
            ShopPage(header: false, refresh: { await book.load() }) {
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
            .task {
                await book.load()
                if app.addressStep == "edit" {
                    // The screenshots' saved address, opened for editing with
                    // its pin on the map.
                    app.addressStep = nil
                    if var row = book.state.value?.first {
                        if row.pin == nil { row.pin = Pin(lat: 29.3376, lng: 48.0757) }
                        editing = Editing(address: row)
                    }
                } else if app.addressStep != nil {
                    editing = Editing(address: nil)
                }
            }
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
                    BarButton(l.t("common.cancel")) { dismiss() }
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
    @State private var confirming = false
    @State private var opensMap = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                // The map first: dropping a pin fills the boxes under it.
                PinField(pin: model.pin, place: model.place, governorate: model.governorate, picking: $opensMap) { pin, place in
                    model.pinned(pin, place)
                }
                if let note = model.pinNote { pinNote(note) }
                LabeledField(label: l.t("address.label"), text: $model.label, placeholder: l.t("address.labelPlaceholder"))
                AddressPartsFields(model: model, governorateOptional: !model.requireGovernorate, problem: { keys in
                    model.showsProblems ? model.problems.first(where: { keys.contains($0) }) : nil
                }, fromPin: model.byPin)
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
                if model.showsProblems {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(model.problems, id: \.self) { FieldProblem(key: $0) }
                    }
                }
                Button {
                    if model.needsConfirm { confirming = true } else { Task { await save() } }
                } label: {
                    if model.saving && !confirming { ProgressView().tint(.white) } else { Text(l.t("address.save")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!model.problems.isEmpty || model.saving)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Brand.ground.ignoresSafeArea())
        .task { await openForScreenshot() }
        .sheet(isPresented: $confirming) {
            AddressConfirmSheet(model: model) {
                Task { await save() }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
    }

    /// The screenshots' address: dropped on the map, or filled and at its confirmation.
    private func openForScreenshot() async {
        guard let step = app.addressStep else { return }
        app.addressStep = nil
        if step == "pin" {
            opensMap = true
            return
        }
        let pin = Pin(lat: 29.3115, lng: 48.0819)
        let place = try? await app.services.api.call(API.placeAt, .init(lat: pin.lat, lng: pin.lng, locale: l.current.rawValue))
        model.label = l.t("address.labelPlaceholder").components(separatedBy: CharacterSet(charactersIn: ",،")).first ?? "Home"
        model.pinned(pin, place ?? nil)
        if (model.parts.building ?? "").isEmpty { model.parts.building = "12" }
        try? await Task.sleep(for: .milliseconds(600))
        confirming = true
    }

    /// What the pin did: filled the boxes, or disagrees with ones the shopper typed.
    @ViewBuilder
    private func pinNote(_ note: AddressFormModel.PinNote) -> some View {
        let line = note.place.parts.line(l.current)
        VStack(alignment: .leading, spacing: 10) {
            if note.conflicts.isEmpty {
                Text(l.t(note.houseMissing ? "pin.filledAddHouse" : "pin.filled"))
                    .font(.inter(13, .semibold))
            } else {
                Text(l.t("pin.conflict", ["place": "\u{2068}\(line)\u{2069}"]))
                    .font(.inter(13))
                HStack(spacing: 8) {
                    Button(l.t("pin.usePin")) { model.pinned(model.pin, note.place, force: true) }
                        .buttonStyle(PrimaryButtonStyle())
                    Button(l.t("pin.keepTyped")) { model.pinNote = nil }
                        .buttonStyle(SecondaryButtonStyle())
                }
            }
        }
        .foregroundStyle(Brand.fromPinInk)
        .fixedSize(horizontal: false, vertical: true)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.fromPin))
        .accessibilityElement(children: .contain)
    }

    private func save() async {
        var saved: SavedAddress?
        let worked = await app.attempt(done: "address.saved") { saved = try await model.save() }
        if worked, let saved {
            confirming = false
            onSaved(saved)
        }
    }
}

/// "Is this your address?" — the address read back before it is kept, on the
/// owner's word, with "Yes, save address" and "Edit address": the pin on a
/// still map, the label, the area and governorate, the block, street, avenue,
/// house, floor and flat in the order a driver reads them, who the driver
/// calls, and the notes. Edit address puts the sheet away and leaves the form
/// as it was. The web's `AddressConfirm`.
struct AddressConfirmSheet: View {
    @Bindable var model: AddressFormModel
    let onConfirm: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let reference = model.reference
        let zone = reference.governorate(id: model.governorate)?.name(l.current)
        let area = model.parts.area.map { reference.areaName($0, language: l.current) } ?? ""
        let place = [area, zone ?? ""].filter { !$0.isEmpty }.joined(separator: l.current == .ar ? "، " : ", ")
        let line = model.parts.isEmpty ? (model.legacyLine ?? "") : withoutArea(model.parts).line(l.current)
        let contact = [model.contactName, model.contactPhone].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let notes = model.notes.trimmingCharacters(in: .whitespacesAndNewlines)

        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(l.t("address.confirmTitle"))
                        .font(.inter(22, .heavy))
                        .foregroundStyle(Brand.navy)
                        .accessibilityAddTraits(.isHeader)
                    Text(l.t("address.confirmBody"))
                        .font(.inter(14))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let pin = model.pin {
                    StillPinMap(pin: pin).frame(height: 170)
                } else {
                    Text(l.t("address.confirmNoPin"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.tint.opacity(0.6)))
                }
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "mappin")
                            .foregroundStyle(Brand.accentInk)
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(Brand.accentWash))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                Text(model.label.trimmingCharacters(in: .whitespaces)).font(.inter(16, .heavy)).foregroundStyle(Brand.navy)
                                if !place.isEmpty {
                                    Text(place)
                                        .font(.inter(12, .bold))
                                        .foregroundStyle(Brand.navy)
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(Capsule().fill(Brand.tint))
                                }
                            }
                            if !line.isEmpty {
                                Text(line).font(.inter(15)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    if !contact.isEmpty {
                        Divider()
                        Label {
                            Text("\(l.t("address.confirmCall")) \(contact.map { "\u{2068}\($0)\u{2069}" }.joined(separator: " · "))")
                                .font(.inter(14))
                                .foregroundStyle(Brand.ink)
                        } icon: {
                            Image(systemName: "phone").foregroundStyle(Brand.muted)
                        }
                    }
                    if !notes.isEmpty {
                        Divider()
                        Label {
                            Text(notes).font(.inter(14)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "note.text").foregroundStyle(Brand.muted)
                        }
                    }
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                Button {
                    onConfirm()
                } label: {
                    if model.saving { ProgressView().tint(.white) } else { Text(l.t("address.confirmYes")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.saving)
                Button(l.t("address.confirmEdit")) { dismiss() }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.saving)
            }
            .padding(20)
        }
        .background(Brand.ground.ignoresSafeArea())
        .environment(\.layoutDirection, l.layoutDirection)
        .buttonStyle(HapticDefaultStyle())
    }

    /// The parts after the area, which the chip beside the label already names.
    private func withoutArea(_ parts: AddressParts) -> AddressParts {
        var rest = parts
        rest.area = nil
        return rest
    }
}
