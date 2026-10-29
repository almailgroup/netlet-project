import Foundation
import Observation

/// One address being added to the book or changed — the web's `AddressForm`.
///
/// What it refuses is `addressProblems`, the rule the API runs: a label, a
/// line a driver can follow (the area, block, street and house when it is
/// given in parts), a phone that is a phone, a pin inside Kuwait. What is
/// merely missing — no governorate, no name — is said on the card instead.
@Observable
@MainActor
final class AddressFormModel: AddressPartsEditing {
    let editing: SavedAddress?
    var label: String
    var contactName: String
    var contactPhone: String
    var notes: String
    var governorate: String? = nil
    var parts: AddressParts {
        didSet {
            // A box the shopper changed is theirs now, not the pin's.
            guard !filling else { return }
            let changed = PinFill.keys.filter { (oldValue.value(for: $0) ?? "") != (parts.value(for: $0) ?? "") }
            if !changed.isEmpty { byPin.removeAll { changed.contains($0) } }
        }
    }
    var typedArea = false
    var pin: Pin?
    /// What the last pin read there.
    private(set) var place: PlaceAnswer?
    /// The parts the pin wrote, drawn pale orange until changed.
    private(set) var byPin: [String] = []
    /// What the form says after a pin: that it filled the boxes, or where it disagrees.
    var pinNote: PinNote?
    private var filling = false

    struct PinNote: Equatable {
        let conflicts: [String]
        let place: PlaceAnswer
        let houseMissing: Bool
    }
    /// The line of an address saved before the parts existed, kept until it is re-entered.
    let legacyLine: String?
    /// An address chosen for delivery must say where it is to be priced.
    let requireGovernorate: Bool
    let reference: ReferenceData
    private(set) var saving = false

    private let api: APICalling

    init(editing: SavedAddress?, api: APICalling, requireGovernorate: Bool = false, reference: ReferenceData = .shared) {
        self.editing = editing
        self.api = api
        self.requireGovernorate = requireGovernorate
        self.reference = reference
        label = editing?.label ?? ""
        contactName = editing?.contactName ?? ""
        contactPhone = editing?.contactPhone ?? ""
        notes = editing?.addressNotes ?? ""
        pin = editing?.pin
        parts = AddressParts()
        let line = editing?.addressLine?.trimmingCharacters(in: .whitespacesAndNewlines)
        legacyLine = (editing?.parts?.isEmpty ?? true) && line?.isEmpty == false ? line : nil
        adopt(parts: editing?.parts, governorate: editing?.governorate)
    }

    private var rules: Rules.Account { reference.rules.accountRules }

    /// The line the address will carry: composed from its parts, else as it was typed.
    private var line: String {
        parts.isEmpty ? (legacyLine ?? "") : parts.line(.en, reference: reference)
    }

    /// What is actively wrong, as message keys (`addressProblems`).
    var problems: [String] {
        var found: [String] = []
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedLabel.isEmpty { found.append("address.needsLabel") }
        else if trimmedLabel.count > rules.maxAddressLabel { found.append("address.labelTooLong") }
        if line.isEmpty { found.append("address.needsLine") }
        else if line.count > rules.maxAddressLine { found.append("address.lineTooLong") }
        if !parts.isEmpty {
            if !parts.missing(reference: reference).isEmpty { found.append("address.needsParts") }
            found.append(contentsOf: parts.problems(reference: reference))
        }
        if notes.trimmingCharacters(in: .whitespacesAndNewlines).count > rules.maxAddressNotes { found.append("address.notesTooLong") }
        let phone = contactPhone.trimmingCharacters(in: .whitespacesAndNewlines)
        if !phone.isEmpty, PhoneNumber.normalise(phone) == nil { found.append("address.badPhone") }
        if let pin, let problem = pin.problem(reference: reference) { found.append(problem) }
        if requireGovernorate, governorate == nil { found.append("address.needsGovernorate") }
        return found
    }

    /// Problems are said once there is something to be wrong about, never on an empty form.
    var showsProblems: Bool {
        !problems.isEmpty && (!label.isEmpty || legacyLine != nil || !parts.isEmpty)
    }

    /// The pin, and what was read there: the boxes fill from it (`PinFill`),
    /// and the note under the map says how. `force` takes the pin's over
    /// what was typed — "Use the pin's address".
    func pinned(_ pin: Pin?, _ read: PlaceAnswer?, force: Bool = false) {
        self.pin = pin
        place = read
        guard pin != nil, let read else {
            if pin == nil { byPin = [] }
            pinNote = nil
            return
        }
        let fill = PinFill.apply(current: parts, governorate: governorate, place: read, byPin: byPin, force: force)
        filling = true
        parts = fill.parts
        filling = false
        if let zone = fill.governorate { governorate = zone }
        if fill.filled.contains("area"), let area = parts.area {
            typedArea = !(reference.areas[governorate ?? ""] ?? []).contains { $0.en == area }
        }
        byPin = fill.filled
        pinNote = PinNote(
            conflicts: fill.conflicts,
            place: read,
            houseMissing: (parts.building ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        )
    }

    /// A new address, or one moved, is read back with "Is this your address?"
    /// before it is kept (`whereChanged`); a renamed one saves at once.
    var needsConfirm: Bool {
        guard let editing else { return true }
        return AddressMove.moved(before: editing, governorate: governorate, parts: parts, line: legacyLine, pin: pin)
    }

    /// Saves it, answering the row the server kept.
    func save() async throws -> SavedAddress? {
        guard problems.isEmpty, !saving else { return nil }
        saving = true
        defer { saving = false }
        func blankless(_ text: String) -> String? {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        let input = API.AddressInput(
            id: editing?.id,
            label: label.trimmingCharacters(in: .whitespacesAndNewlines),
            contactName: blankless(contactName),
            contactPhone: blankless(contactPhone),
            governorate: governorate,
            addressLine: parts.isEmpty ? legacyLine : nil,
            addressNotes: blankless(notes),
            pin: pin?.rounded,
            parts: parts.cleaned()
        )
        return try await api.call(editing == nil ? API.addAddress : API.updateAddress, input)
    }
}
