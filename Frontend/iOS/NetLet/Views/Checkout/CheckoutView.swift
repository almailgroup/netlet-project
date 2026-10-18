import SwiftUI

/// Checkout: the saved address or a new one in its Kuwaiti parts, who
/// receives it, cash on delivery, and Place order with the total in it.
/// Disabled, the button says what is still missing underneath, first reason first.
struct CheckoutView: View {
    let path: Binding<NavigationPath>?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            if app.session.isSignedIn {
                ModelHost(make: { CheckoutViewModel(orders: app.services.orders, account: app.services.account) }) { model in
                    CheckoutForm(model: model, path: path)
                }
            } else {
                VStack(spacing: 16) {
                    EmptyStateView(systemImage: "person.crop.circle", title: l.t("checkout.signInShort"), note: l.t("checkout.signInToOrder"))
                    Button(l.t("checkout.signInHere")) { app.authPresented = true }
                        .buttonStyle(PrimaryButtonStyle())
                        .padding(.horizontal, 24)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Brand.ground.ignoresSafeArea())
        .navigationTitle(l.t("checkout.heading"))
        .navigationBarTitleDisplayMode(.inline)
        // No tab bar on a payment page, the web's rule: every extra way out is
        // an invitation to take it.
        .onAppear { app.chromeHidden += 1 }
        .onDisappear { app.chromeHidden = max(0, app.chromeHidden - 1) }
    }
}

private struct CheckoutForm: View {
    @Bindable var model: CheckoutViewModel
    let path: Binding<NavigationPath>?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let cart = app.cart.cart
        let blocker = model.blocker(for: cart)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(l.t("checkout.note")).font(.subheadline).foregroundStyle(Brand.muted)
                savedAddresses
                deliveryCard
                paymentCard(cart)
                if let cart, !cart.isEmpty { SummaryCard(cart: cart) }
                Text(l.t("checkout.parcelsNote")).font(.footnote).foregroundStyle(Brand.muted)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                if let blocker {
                    Text(l.t(blocker)).font(.footnote).foregroundStyle(model.attempted ? Brand.danger : Brand.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else if let refusal = model.refusal {
                    Text(l.t(refusalKey(refusal))).font(.footnote).foregroundStyle(Brand.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button {
                    Task { await place() }
                } label: {
                    if model.placing {
                        HStack(spacing: 8) { ProgressView().tint(Brand.navy); Text(l.t("checkout.placing")) }
                    } else {
                        Text(l.t("checkout.placeOrder") + (cart.map { " · " + $0.total.formatted(l.current) } ?? ""))
                    }
                }
                .buttonStyle(OrderButtonStyle())
                .disabled(model.placing || cart == nil)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.regularMaterial)
            .overlay(alignment: .top) { Divider() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("checkout.placeBar"))
        }
        .task { await model.load(user: app.session.user) }
    }

    @ViewBuilder
    private var savedAddresses: some View {
        if let book = model.addresses.value, !book.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(l.t("checkout.savedAddresses")).font(.headline).foregroundStyle(Brand.navy)
                FlowLayout(spacing: 8) {
                    ForEach(book) { address in
                        ChoiceChip(title: address.label, selected: model.chosenAddress == address.id, available: true) { model.use(address) }
                    }
                    ChoiceChip(title: l.t("checkout.newAddress"), selected: model.chosenAddress == nil, available: true) { model.startNewAddress() }
                }
                if model.chosenAddress != nil {
                    Text(l.t("checkout.editForThisOrder")).font(.footnote).foregroundStyle(Brand.muted)
                }
            }
        }
    }

    private var deliveryCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(l.t("checkout.deliveryDetails")).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            LabeledField(label: l.t("checkout.fullName"), text: $model.contactName, placeholder: l.t("checkout.fullNamePlaceholder"), content: .name)
            LabeledField(
                label: l.t("checkout.mobile"),
                text: $model.contactPhone,
                placeholder: "5000 0000",
                problem: problem(["checkout.needPhone", "checkout.badPhone"]),
                keyboard: .phonePad,
                content: .telephoneNumber,
                leftToRight: true
            )
            governoratePicker
            areaPicker
            HStack(spacing: 10) {
                partField("address.block", \.block, keyboard: .numbersAndPunctuation)
                partField("address.street", \.street)
            }
            HStack(spacing: 10) {
                partField("address.avenue", \.avenue)
                partField("address.building", \.building)
            }
            HStack(spacing: 10) {
                partField("address.floor", \.floor, keyboard: .numbersAndPunctuation)
                partField("address.apartment", \.apartment)
            }
            LabeledField(
                label: l.t("address.paci"),
                text: Binding(get: { model.parts.paciNumber ?? "" }, set: { model.parts.paciNumber = $0 }),
                hint: l.t("address.paciHint"),
                problem: problem(["address.badPaci"]),
                keyboard: .numberPad,
                leftToRight: true
            )
            FieldProblem(key: problem(["checkout.needAddress"]))
            LabeledField(label: l.t("checkout.notes"), text: $model.notes, placeholder: l.t("checkout.notesPlaceholder"), axis: .vertical)
        }
        .card()
    }

    private var governoratePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("address.governorate")).font(.subheadline.weight(.semibold))
            Menu {
                ForEach(ReferenceData.shared.governorates) { governorate in
                    Button(governorate.name(l.current)) { model.chooseGovernorate(governorate.id) }
                }
            } label: {
                MenuField(text: ReferenceData.shared.governorate(id: model.governorate)?.name(l.current), placeholder: l.t("account.chooseZone"))
            }
            FieldProblem(key: problem(["checkout.needGovernorate"]))
        }
    }

    private var areaPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("address.area")).font(.subheadline.weight(.semibold))
            Menu {
                ForEach(model.areas, id: \.en) { area in
                    Button(area.name(l.current)) { model.chooseArea(area) }
                }
                Button(l.t("address.areaOther")) { model.chooseArea(nil) }
            } label: {
                let chosen = model.areas.first { $0.en == model.parts.area }
                MenuField(text: model.typedArea ? l.t("address.areaOther") : chosen?.name(l.current), placeholder: l.t("address.areaChoose"))
            }
            if model.typedArea {
                LabeledField(label: l.t("address.areaTyped"), text: Binding(get: { model.parts.area ?? "" }, set: { model.parts.area = $0 }))
            }
        }
    }

    private func partField(_ key: String, _ part: WritableKeyPath<AddressParts, String?>, keyboard: UIKeyboardType = .default) -> some View {
        LabeledField(
            label: l.t(key),
            text: Binding(get: { model.parts[keyPath: part] ?? "" }, set: { model.parts[keyPath: part] = $0 }),
            keyboard: keyboard
        )
    }

    private func paymentCard(_ cart: Cart?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("checkout.payMethod")).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Label(l.t("checkout.payCod"), systemImage: "banknote").font(.subheadline.weight(.semibold))
            Text(l.t("checkout.payCodNote")).font(.footnote).foregroundStyle(Brand.muted)
            if let cart, let refusal = model.codRefusal(for: cart, language: l) {
                Text(refusal)
                    .font(.footnote)
                    .foregroundStyle(Brand.danger)
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10).fill(Brand.orange.opacity(0.1)))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    /// A delivery problem said under its own box, once Place order has been pressed.
    private func problem(_ keys: [String]) -> String? {
        guard model.attempted, let blocker = model.blocker(for: app.cart.cart), keys.contains(blocker) else { return nil }
        return blocker
    }

    private func refusalKey(_ error: APIError) -> String {
        let key = error.messageKey(knownKey: l.phrasebook.has)
        return key == "error.serverProblem" ? "checkout.placeFailed" : key
    }

    private func place() async {
        guard let placed = await model.place(cart: app.cart.cart) else { return }
        await app.cart.refresh()
        if let path {
            path.wrappedValue = NavigationPath([Route.orderPlaced(reference: placed.reference)])
        }
    }
}

/// A dropdown's closed face: the choice, or what to choose, and a chevron.
struct MenuField: View {
    let text: String?
    let placeholder: String

    var body: some View {
        HStack {
            Text(text ?? placeholder)
                .foregroundStyle(text == nil ? Brand.muted : Brand.ink)
                .lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up.chevron.down").font(.footnote).foregroundStyle(Brand.muted)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 50)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
    }
}

/// Place order: the brand orange with navy words (4.65:1), full width, with the total in it.
struct OrderButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.bold))
            .foregroundStyle(Brand.navy)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Brand.orange.opacity(isEnabled ? (configuration.isPressed ? 0.85 : 1) : 0.45))
            )
    }
}

/// The page an order lands on: its number, said to be read down a phone, and the way to it.
struct OrderPlacedView: View {
    let reference: String
    let path: Binding<NavigationPath>?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 56))
                .foregroundStyle(Brand.success)
                .accessibilityHidden(true)
            Text(l.t("orders.reference"))
                .font(.headline)
                .foregroundStyle(Brand.muted)
            Text(reference)
                .font(.title2.monospaced().weight(.bold))
                .foregroundStyle(Brand.navy)
                .textSelection(.enabled)
                .environment(\.layoutDirection, .leftToRight)
            Text(l.t("checkout.placed", ["reference": reference]))
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(Brand.ink)
            Button(l.t("ios.order.view")) {
                path?.wrappedValue = NavigationPath([Route.order(reference: reference)])
            }
            .buttonStyle(PrimaryButtonStyle())
            Button(l.t("header.continueShopping")) {
                path?.wrappedValue = NavigationPath()
                app.selectedTab = .home
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.ground.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .navigationTitle(l.t("checkout.heading"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
