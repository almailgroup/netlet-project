import SwiftUI

/// Whatever holds an address being typed: checkout's form and the address
/// book's. The area rules live here once, so the two cannot disagree about
/// what choosing an area does.
@MainActor
protocol AddressPartsEditing: AnyObject {
    var governorate: String? { get set }
    var parts: AddressParts { get set }
    /// True when the shopper picked "Another area" and types it.
    var typedArea: Bool { get set }
    var reference: ReferenceData { get }
}

extension AddressPartsEditing {
    /// The governorate's own areas, in the order the web lists them — or every
    /// governorate's, while none is chosen, so picking an area can choose it.
    var areas: [Area] {
        if let governorate { return reference.areas[governorate] ?? [] }
        return reference.governorates.flatMap { reference.areas[$0.id] ?? [] }
    }

    /// Choosing an area with no governorate chosen chooses its governorate too,
    /// since that is what prices delivery.
    func chooseArea(_ area: Area?) {
        if let area {
            typedArea = false
            parts.area = area.en
            if governorate == nil { governorate = reference.governorate(ofArea: area.en) }
        } else {
            typedArea = true
            parts.area = nil
        }
    }

    func chooseGovernorate(_ id: String?) {
        guard id != governorate else { return }
        governorate = id
        if !typedArea, let area = parts.area, !areas.contains(where: { $0.en == area }) { parts.area = nil }
    }

    /// Fills the parts from a saved address, and whether its area is typed.
    func adopt(parts given: AddressParts?, governorate zone: String?) {
        governorate = zone
        parts = given ?? AddressParts()
        typedArea = parts.area.map { area in !(reference.areas[zone ?? ""] ?? []).contains { $0.en == area } } ?? false
    }
}

/// The one set of address boxes — the web's `AddressPartsFields`, drawn by
/// checkout and the address book so the two cannot ask different things:
/// the governorate, the area from its own list, block and street, avenue and
/// house, floor and apartment, and the PACI number, in the order a driver
/// reads them.
struct AddressPartsFields<Model: AddressPartsEditing>: View {
    let model: Model
    /// The governorate may be left unset — the address book's "—" — or must be chosen.
    var governorateOptional = false
    /// A problem to say under the box it belongs to, by the keys that box answers.
    var problem: @MainActor ([String]) -> String? = { _ in nil }
    /// The parts a dropped pin filled, drawn pale orange until the shopper changes them.
    var fromPin: [String] = []
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            governoratePicker
            areaPicker
            HStack(alignment: .top, spacing: 10) {
                partField("address.block", \.block, id: "block", keyboard: .numbersAndPunctuation)
                partField("address.street", \.street, id: "street")
            }
            HStack(alignment: .top, spacing: 10) {
                partField("address.avenue", \.avenue, id: "avenue")
                partField("address.building", \.building, id: "building")
            }
            HStack(alignment: .top, spacing: 10) {
                partField("address.floor", \.floor, id: "floor", keyboard: .numbersAndPunctuation)
                partField("address.apartment", \.apartment, id: "apartment")
            }
            LabeledField(
                label: l.t("address.paci"),
                text: Binding(get: { model.parts.paciNumber ?? "" }, set: { model.parts.paciNumber = $0 }),
                hint: l.t("address.paciHint"),
                problem: problem(["address.badPaci"]),
                keyboard: .numberPad,
                leftToRight: true
            )
        }
    }

    private var governoratePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("address.governorate")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            Menu {
                if governorateOptional {
                    Button("—") {
                        Haptics.tap()
                        model.chooseGovernorate(nil)
                    }
                }
                ForEach(ReferenceData.shared.governorates) { governorate in
                    Button(governorate.name(l.current)) {
                        Haptics.tap()
                        model.chooseGovernorate(governorate.id)
                    }
                }
            } label: {
                MenuField(
                    text: ReferenceData.shared.governorate(id: model.governorate)?.name(l.current),
                    placeholder: governorateOptional ? "—" : l.t("delivery.selectGovernorate")
                )
            }
            .accessibilityLabel(l.t("address.governorate"))
            FieldProblem(key: problem(["checkout.needGovernorate", "address.needsGovernorate"]))
        }
    }

    private var areaPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("address.area")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            Menu {
                ForEach(model.areas, id: \.en) { area in
                    Button(area.name(l.current)) {
                        Haptics.tap()
                        model.chooseArea(area)
                    }
                }
                Button(l.t("address.areaOther")) {
                    Haptics.tap()
                    model.chooseArea(nil)
                }
            } label: {
                let chosen = model.areas.first { $0.en == model.parts.area }
                MenuField(
                    text: model.typedArea ? l.t("address.areaOther") : chosen?.name(l.current),
                    placeholder: l.t("address.areaChoose"),
                    fromPin: !model.typedArea && fromPin.contains("area")
                )
            }
            .accessibilityLabel(l.t("address.area"))
            if model.typedArea {
                LabeledField(label: l.t("address.areaTyped"), text: Binding(get: { model.parts.area ?? "" }, set: { model.parts.area = $0 }), fromPin: fromPin.contains("area"))
            }
        }
    }

    private func partField(_ key: String, _ part: WritableKeyPath<AddressParts, String?>, id: String, keyboard: UIKeyboardType = .default) -> some View {
        LabeledField(
            label: l.t(key),
            text: Binding(get: { model.parts[keyPath: part] ?? "" }, set: { model.parts[keyPath: part] = $0 }),
            keyboard: keyboard,
            fromPin: fromPin.contains(id)
        )
    }
}
