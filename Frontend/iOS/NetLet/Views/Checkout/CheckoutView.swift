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
                ModelHost(make: { CheckoutViewModel(orders: app.services.orders, account: app.services.account, api: app.services.api) }) { model in
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
        .toolbar(.hidden, for: .tabBar)
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
                if let cart { ItemDestinations(cart: cart) }
                paymentCard(cart)
                if let cart, !cart.isEmpty { CheckoutSummary(cart: cart, model: model) }
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
                        Text(l.t("checkout.placeOrder") + (cart.map { " · " + model.bill(for: $0).payable.formatted(l.current) } ?? ""))
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
            AddressPartsFields(model: model, problem: problem)
            FieldProblem(key: problem(["checkout.needAddress"]))
            LabeledField(label: l.t("checkout.notes"), text: $model.notes, placeholder: l.t("checkout.notesPlaceholder"), axis: .vertical)
            PinField(pin: $model.pin, governorate: model.governorate)
            if model.chosenAddress == nil {
                Toggle(l.t("checkout.saveAddress"), isOn: $model.saveForNext)
                    .font(.inter(14, .medium))
                    .tint(Brand.navy)
                    .onChange(of: model.saveForNext) { Haptics.tap() }
            }
        }
        .card()
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
        let area = model.governorate.flatMap { ReferenceData.shared.governorate(id: $0)?.name(l.current) }
        guard let placed = await model.place(cart: app.cart.cart, savedLabel: area ?? l.t("checkout.savedAddressLabel")) else {
            Haptics.refused()
            return
        }
        Haptics.succeeded()
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
            .pressHaptic(configuration.isPressed, strength: Haptics.actionStrength)
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

/// The order summary at checkout: what is in the bag, each seller's delivery,
/// then the code box, the points and what they take off, and what is left to
/// pay at the door — the web's summary, its till the same `settle`.
private struct CheckoutSummary: View {
    let cart: Cart
    @Bindable var model: CheckoutViewModel
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let bill = model.bill(for: cart)
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("checkout.orderSummary")).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            ForEach(cart.items) { item in
                HStack(spacing: 10) {
                    Color.clear
                        .frame(width: 44, height: 44)
                        .overlay { RemoteImage(reference: item.image?.url) }
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title(l.current)).font(.inter(13, .semibold)).foregroundStyle(Brand.ink).lineLimit(2)
                        Text(l.t("cart.quantityShort", ["count": "\(item.quantity)"])).font(.inter(12)).foregroundStyle(Brand.muted)
                    }
                    Spacer(minLength: 8)
                    Text(item.lineTotal.formatted(l.current)).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                }
            }
            Divider()
            row(l.t("cart.subtotal"), cart.subtotal.formatted(l.current))
            ForEach(Array(cart.delivery.perVendor.filter { !$0.free }.enumerated()), id: \.offset) { _, line in
                let name = line.storeName(l.current)
                row(line.destinationLabel.map { l.t("address.deliveryTo", ["name": name, "label": $0]) } ?? l.t("cart.deliveryFrom", ["name": name]), line.fee.formatted(l.current))
            }
            row(l.t("footer.delivery"), cart.delivery.total.formatted(l.current))
            if let waived = cart.delivery.memberWaived, !waived.isZero {
                Text(l.t("membership.deliveryWaived", ["amount": waived.formatted(l.current)])).font(.inter(12)).foregroundStyle(Brand.success)
            }
            if model.balance > 0 {
                let spendable = Till.pointsSpendable(model.balance, on: cart.total)
                Toggle(isOn: $model.usePoints) {
                    Text(l.t("checkout.usePoints", ["points": "\(spendable)", "value": Till.spendValue(spendable).formatted(l.current)]))
                        .font(.inter(14, .medium))
                }
                .tint(Brand.navy)
                .onChange(of: model.usePoints) { Haptics.tap() }
            }
            codeBox
            if !bill.discount.isZero { row(l.t("checkout.discountRow"), "−" + bill.discount.formatted(l.current)) }
            if !bill.points.isZero { row(l.t("checkout.pointsRow"), "−" + bill.points.formatted(l.current)) }
            if !bill.giftCard.isZero { row(l.t("checkout.giftCardRow"), "−" + bill.giftCard.formatted(l.current)) }
            Divider()
            HStack {
                Text(l.t("cart.total")).font(.headline.weight(.bold)).foregroundStyle(Brand.ink)
                Spacer()
                Text(bill.payable.formatted(l.current)).font(.headline.weight(.bold)).foregroundStyle(Brand.navy)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private var codeBox: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("checkout.voucherLabel")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            HStack(spacing: 8) {
                TextField(l.t("checkout.voucherPlaceholder"), text: $model.codeInput)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .textContentType(.oneTimeCode)
                    .submitLabel(.go)
                    .onSubmit { Task { await model.applyCode(cartId: cart.id) } }
                    .environment(\.layoutDirection, .leftToRight)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.pearl))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                Button(l.t("checkout.voucherApply")) { Task { await model.applyCode(cartId: cart.id) } }
                    .buttonStyle(CompactPrimaryStyle())
                    .disabled(model.codeInput.trimmingCharacters(in: .whitespaces).isEmpty || model.quoting)
            }
            if let refusal = model.codeRefusal {
                Text(l.t(refusal)).font(.inter(12)).foregroundStyle(Brand.danger)
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.subheadline).foregroundStyle(Brand.muted)
            Spacer(minLength: 8)
            Text(value).font(.subheadline).foregroundStyle(Brand.navy)
        }
    }
}

/// Send part of the order to another saved door — the web's
/// `ItemDestinations`. Drawn only with something to choose: an address book
/// and more than one line.
private struct ItemDestinations: View {
    let cart: Cart
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let book = cart.addresses ?? []
        if !book.isEmpty, cart.items.count > 1 {
            VStack(alignment: .leading, spacing: 12) {
                Label(l.t("address.sendElsewhere"), systemImage: "mappin.and.ellipse")
                    .font(.headline)
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                Text(l.t("address.bookNote")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                ForEach(cart.items) { item in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.title(l.current)).font(.inter(14, .semibold)).foregroundStyle(Brand.ink).lineLimit(2)
                        Menu {
                            choice(item, nil, l.t("address.orderAddress"))
                            ForEach(book) { address in choice(item, address.id, address.label) }
                        } label: {
                            MenuField(text: item.destination?.label ?? l.t("address.orderAddress"), placeholder: l.t("address.orderAddress"))
                        }
                        .disabled(app.cart.busyLine == item.lineId)
                        .accessibilityLabel(l.t("address.forLine", ["name": item.title(l.current)]))
                    }
                }
                if splitsASeller {
                    Text(l.t("address.splitNote")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }

    private func choice(_ item: CartItem, _ addressId: Int?, _ label: String) -> some View {
        Button {
            Haptics.tap()
            Task { await app.cart.setDestination(lineId: item.lineId, addressId: addressId) }
        } label: {
            if item.destination?.id == addressId { Label(label, systemImage: "checkmark") } else { Text(label) }
        }
    }

    /// A seller going to two doors goes twice, which the shopper is told.
    private var splitsASeller: Bool {
        var seen: [String: Int] = [:]
        for row in cart.delivery.perVendor { seen[row.vendorId.map(String.init) ?? row.vendorName, default: 0] += 1 }
        return seen.values.contains { $0 > 1 }
    }
}
