import SwiftUI

/// Checkout confirms — the web's `Checkout`, on a phone: what is coming from
/// each store and when, a code (open), how it is paid, the total, and Place
/// order under the thumb. **Where it goes is the cart's alone, on the owner's
/// word** ("remove the Deliver to and Deliver this elsewhere options from the
/// checkout page entirely"): the address in use is the cart's first card and
/// each line's own is its delivery button (`LineDestinationButton`). Disabled, the button says what is still missing above
/// it, first reason first, and a press on the sentence goes to the fix.
///
/// **It confirms; it does not ask, on the owner's word** — the governorate,
/// the parts of the address, the name, the number and the map were typed here
/// on every order. **Cash on delivery is the one method that pays, and the
/// others are drawn as coming** ("for now add multiple payment methods as a
/// mockup design"): KNET, a card and Apple Pay, none choosable, so the page
/// shows what paying will look like without a press on one leading anywhere.
///
/// **Place order asks before it places, and the shopper stays here**, on the
/// owner's word: it opens "Confirm your order" (`ConfirmOrderSheet`), and only
/// its Confirm order places anything; the order placed is then said over the
/// page (`OrderPlacedView`) with an animation and a sound, and the shopper
/// leaves by their own press — the web's `ConfirmOrderDialog` and `OrderPlaced`.
struct CheckoutView: View {
    let path: Binding<NavigationPath>?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    /// `UITestHooks.tabBarProbe`'s "toggle": asked for after the page is up.
    @State private var probeHides = false

    var body: some View {
        Group {
            if app.session.isSignedIn {
                ModelHost(make: { CheckoutViewModel(orders: app.services.orders, account: app.services.account, savings: app.savings) }) { model in
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
        .toolbar(UITestHooks.tabBarProbe == "toggle" && !probeHides ? .automatic : .hidden, for: .tabBar)
        .onAppear { probe(appeared: true) }
        .onDisappear { probe(appeared: false) }
        .task {
            guard UITestHooks.tabBarProbe == "toggle" else { return }
            try? await Task.sleep(for: .milliseconds(400))
            probeHides = true
        }
    }

    /// The ways of putting the bar away that are not SwiftUI's, each tried by
    /// `TabBarUITests` under its own name and by nobody else.
    private func probe(appeared: Bool) {
        switch UITestHooks.tabBarProbe ?? "" {
        case "uikitHidden": TabBarSlide.systemHide(appeared, legacy: true)
        case "uikitSet": TabBarSlide.systemHide(appeared, legacy: false)
        case "slide": TabBarSlide.slide(away: appeared, animated: false)
        default: break
        }
    }
}

private struct CheckoutForm: View {
    @Bindable var model: CheckoutViewModel
    let path: Binding<NavigationPath>?
    @State private var adopted = false
    @FocusState private var phoneFocused: Bool
    /// "Confirm your order" is up.
    @State private var confirming = false
    /// The order placed, waiting for the confirm sheet to finish going down.
    @State private var landed: PlacedNotice?
    /// The order placed, said over the page.
    @State private var placed: PlacedNotice?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        // What this order is of: the lines ticked in the cart (`CartChoice`).
        let cart = app.cart.cart?.forCheckout
        let address = app.delivery.inUse
        let blocker = app.delivery.loaded ? model.blocker(for: cart, address: address) : nil
        // Nothing to check out: said as the cart says it, not as a form with a
        // total of nothing. Not once an order is placed — the bag empties under
        // the confirmation, and the page it sits over stays as it was.
        let empty = !app.cart.settling && (cart?.isEmpty ?? true) && placed == nil && landed == nil && !model.placing
        // A bag with lines in it and none ticked: said so, with the way back to
        // the cart, rather than "Your cart is empty" over a full bag.
        let nothingChosen = empty && !(app.cart.cart?.isEmpty ?? true)
        ScrollView {
            if nothingChosen {
                EmptyStateView(
                    systemImage: "checklist",
                    title: l.t("order.nothingChosen"),
                    note: l.t("checkout.leftInCart"),
                    actionTitle: l.t("checkout.editCart")
                ) {
                    editCart()
                }
                .card(padding: 0)
                .padding(16)
            } else if empty {
                EmptyStateView(
                    systemImage: "bag",
                    title: l.t("cart.empty"),
                    note: l.t("checkout.emptyNote"),
                    actionTitle: l.t("header.continueShopping")
                ) {
                    path?.wrappedValue = NavigationPath()
                    app.selectedTab = .home
                }
                .card(padding: 0)
                .padding(16)
            } else {
            VStack(alignment: .leading, spacing: 12) {
                Text(l.t("checkout.confirmNote"))
                    .font(.inter(14))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                // Where it goes was chosen in the cart, line by line, on the
                // owner's word — no "Deliver to" here. An order with nowhere to
                // go says so over Place order, and the press opens the book.
                if model.asksPhone(for: address) { phoneCard }
                if let cart, !cart.isEmpty {
                    CheckoutItems(cart: cart, leftOut: (app.cart.cart?.items.count ?? 0) > cart.items.count) { editCart() }
                    // The code right before the ways to pay, open.
                    BagSavingsCard(cart: cart)
                }
                PaymentMethods(cart: cart, model: model)
                if let cart, !cart.isEmpty {
                    CheckoutSummary(cart: cart, model: model)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Label(l.t("home.returnsWithin", ["days": "\(app.returnWindowDays)"]), systemImage: "arrow.uturn.backward")
                    Label(l.t("checkout.parcelsNote"), systemImage: "truck.box")
                }
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .padding(.horizontal, 4)
            }
            .padding(16)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            if !empty {
            VStack(spacing: 6) {
                if let blocker {
                    Button {
                        fix(blocker, address: address)
                    } label: {
                        Label(l.t(blocker), systemImage: "info.circle")
                            .font(.inter(13, .bold))
                            .foregroundStyle(Brand.accentInk)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                    .disabled(blocker == "checkout.needCod" || blocker == "checkout.needItems" || blocker == "checkout.codeProblem")
                } else if let refusal = model.refusal {
                    Text(l.t(refusalKey(refusal))).font(.footnote).foregroundStyle(Brand.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button {
                    // Asks first; nothing is placed until Confirm order.
                    guard !app.cart.syncing, cart != nil, address != nil else { return }
                    confirming = true
                } label: {
                    if model.placing {
                        HStack(spacing: 8) { ProgressView().tint(Brand.navy); Text(l.t("checkout.placing")) }
                    } else {
                        HStack(spacing: 8) {
                            Image(systemName: "shippingbox").font(.system(size: 16, weight: .semibold))
                            Text(l.t("checkout.placeOrder") + (cart.map { " · " + model.bill(for: $0).payable.formatted(l.current) } ?? ""))
                                .opacity(app.cart.syncing ? 0.5 : 1)
                        }
                    }
                }
                .buttonStyle(OrderButtonStyle())
                // A press on the bag still on its way — Buy now opens here on
                // the bag drawn ahead — is the server's to price first.
                .disabled(model.placing || blocker != nil || !app.delivery.loaded || cart == nil || app.cart.syncing)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.regularMaterial)
            .overlay(alignment: .top) { Divider() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("checkout.placeBar"))
            }
        }
        .sheet(isPresented: $confirming, onDismiss: {
            if let landed {
                placed = landed
                self.landed = nil
            }
        }) {
            if let cart, let address {
                ConfirmOrderSheet(
                    cart: cart,
                    address: address,
                    contact: contact(for: address),
                    total: model.bill(for: cart).payable,
                    placing: model.placing,
                    onConfirm: { Task { await place(address: address) } },
                    onBack: { confirming = false }
                )
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .buttonStyle(HapticDefaultStyle())
            }
        }
        .fullScreenCover(item: $placed) { notice in
            OrderPlacedView(reference: notice.id, total: notice.total, onView: {
                placed = nil
                if let path {
                    path.wrappedValue = NavigationPath([Route.order(reference: notice.id)])
                } else {
                    app.open(.order(reference: notice.id))
                }
            }, onShop: {
                placed = nil
                path?.wrappedValue = NavigationPath()
                app.selectedTab = .home
            })
        }
        .task { await model.load(user: app.session.user) }
        // `-NetLetOpen confirmOrder`: the screenshots' way to the sheet.
        .task(id: app.delivery.loaded) {
            guard app.confirmOrderOnOpen, app.delivery.loaded, app.cart.cart != nil, app.delivery.inUse != nil else { return }
            app.confirmOrderOnOpen = false
            confirming = true
        }
        // A book with no address in the area in use starts from the one used
        // last here, else the first, and the area follows it: an order needs a
        // door, and this is the one the shopper picked most recently.
        .task(id: app.delivery.loaded) {
            guard app.delivery.loaded, !adopted else { return }
            adopted = true
            guard app.delivery.inUse == nil,
                  let choice = CheckoutViewModel.fallback(app.delivery.addresses, lastUsed: app.delivery.lastAddressId),
                  choice.governorate?.isEmpty == false else { return }
            await app.delivery.choose(choice)
        }
    }

    /// A saved address with no number, on an account with none.
    private var phoneCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("checkout.driverPhone"))
                .font(.inter(13, .bold))
                .foregroundStyle(Brand.navy)
            TextField("+965", text: $model.typedPhone)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .focused($phoneFocused)
                .environment(\.layoutDirection, .leftToRight)
                .padding(.horizontal, 14)
                .frame(minHeight: 48)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(phoneFocused ? Brand.navy : Brand.line, lineWidth: phoneFocused ? 2 : 1))
                .accessibilityLabel(l.t("checkout.driverPhone"))
            Text(l.t("checkout.driverPhoneNote"))
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .card()
    }

    /// The sentence under nothing-yet goes to the fix: the number's box, or
    /// the address book.
    private func fix(_ blocker: String, address: SavedAddress?) {
        switch blocker {
        case "checkout.needCod", "checkout.needItems", "checkout.codeProblem":
            // A product's code that no longer applies is removed on its own line.
            return
        case "checkout.needPhone", "checkout.badPhone":
            if model.asksPhone(for: address) { phoneFocused = true } else { app.deliveryOpen = true }
        case "checkout.needFewer":
            editCart()
        default:
            app.deliveryOpen = true
        }
    }

    /// Back to the bag, where the quantities change.
    private func editCart() {
        let elsewhere = app.selectedTab != .cart
        dismiss()
        if elsewhere { app.selectedTab = .cart }
    }

    private func refusalKey(_ error: APIError) -> String {
        let key = error.messageKey(knownKey: l.phrasebook.has)
        return key == "error.serverProblem" ? "checkout.placeFailed" : key
    }

    /// Who the driver calls, on what number, under the address in the sheet.
    private func contact(for address: SavedAddress) -> String {
        let name = address.contactName?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            ?? app.session.user?.name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let phone = PhoneNumber.normalise(model.phone(for: address)).map(PhoneNumber.display)
        return [name, phone].compactMap { $0 }.joined(separator: " · ")
    }

    /// Confirm order, pressed in the sheet: the sheet goes down and the order
    /// placed is said once it has. A refusal puts the sheet down too, and the
    /// page says what stands in the way (`model.refusal`).
    private func place(address: SavedAddress?) async {
        guard !app.cart.syncing else { return }
        let total = app.cart.cart.map { model.bill(for: $0).payable }
        guard let order = await model.place(cart: app.cart.cart?.forCheckout, address: address, accountName: app.session.user?.name, skip: app.cart.skip) else {
            Haptics.refused()
            confirming = false
            return
        }
        landed = PlacedNotice(id: order.reference, total: total)
        confirming = false
        // What was left in the bag is chosen again, for the next order.
        app.cart.forgetChoice()
        await app.cart.refresh()
    }
}

/// What is coming, from each store: its lines, what its delivery costs and
/// when it comes — the seller's own band (`deliverySpeed` on the line), and
/// nothing when the seller stated none, since NetLet does not promise for a
/// seller. Read-only: the bag is where the quantities change, and Edit goes
/// back to it.
private struct CheckoutItems: View {
    let cart: Cart
    /// Some of the bag was left out of this order and waits in the cart.
    var leftOut = false
    let onEdit: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(l.t("checkout.itemsTitle", ["count": "\(cart.itemCount)"]))
                    .font(.inter(15, .heavy))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Button(l.t("checkout.editCart"), action: onEdit)
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.accentInk)
                    .frame(minHeight: 44)
                    .buttonStyle(.tap)
            }
            .padding(.horizontal, 4)
            if leftOut {
                Text(l.t("checkout.leftInCart"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
            }
            if let groups = BagGroup.groups(cart) {
                ForEach(groups) { group in StoreParcel(group: group) }
            } else {
                VStack(spacing: 0) {
                    ForEach(cart.items) { item in
                        CheckoutItemRow(item: item)
                        if item.id != cart.items.last?.id { Divider().overlay(Brand.cardLine) }
                    }
                }
                .padding(.horizontal, 16)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            }
        }
    }
}

private struct StoreParcel: View {
    let group: BagGroup
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let name = group.store.name(l.current)
        VStack(alignment: .leading, spacing: 0) {
            Label(l.t("browse.soldBy", ["name": "\u{2068}\(name)\u{2069}"]), systemImage: "storefront")
                .font(.inter(14, .heavy))
                .foregroundStyle(Brand.navy)
                .lineLimit(1)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            Divider().overlay(Brand.cardLine)
            VStack(spacing: 0) {
                ForEach(group.items) { item in
                    CheckoutItemRow(item: item)
                    if item.id != group.items.last?.id { Divider().overlay(Brand.cardLine) }
                }
            }
            .padding(.horizontal, 16)
            Divider().overlay(Brand.cardLine)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(group.delivery.enumerated()), id: \.offset) { _, row in
                    deliveryRow(row)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color(red: 250 / 255, green: 251 / 255, blue: 252 / 255))
            .opacity(app.cart.syncing ? 0.5 : 1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }

    private func deliveryRow(_ row: CartDeliveryLine) -> some View {
        let fast = row.choice == "fast"
        let lines = group.items.filter { $0.isFast == fast }
        let speed = DeliveryLine.slowest(lines.map { fast ? $0.fastDelivery?.speed : $0.deliverySpeed })
        let when = DeliveryLine.arrival(speed, language: l)
        let door = row.destinationLabel.map { l.t("address.sendingTo", ["label": $0]) + " · " } ?? ""
        let what = l.t(fast ? "delivery.fastTag" : "cart.delivery")
        let free = row.free || row.fee.isZero
        return ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                cost(door + what, free: free, fee: row.fee)
                Spacer(minLength: 8)
                if let when { arrival(when) }
            }
            VStack(alignment: .leading, spacing: 2) {
                cost(door + what, free: free, fee: row.fee)
                if let when { arrival(when) }
            }
        }
    }

    private func cost(_ label: String, free: Bool, fee: Money) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "truck.box").font(.system(size: 13, weight: .semibold)).accessibilityHidden(true)
            Text(label + ":").font(.inter(13, .semibold))
            Text(free ? l.t("cart.deliveryFree") : fee.formatted(l.current))
                .font(.inter(13, .semibold))
                .foregroundStyle(free ? Brand.success : Brand.body)
        }
        .accessibilityElement(children: .combine)
        .foregroundStyle(Brand.body)
    }

    private func arrival(_ text: String) -> some View {
        Text(text).font(.inter(13, .bold)).foregroundStyle(Brand.success)
    }
}

private struct CheckoutItemRow: View {
    let item: CartItem
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let title = item.title(l.current)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                Color.clear
                    .frame(width: 56, height: 56)
                    .overlay { RemoteImage(reference: item.image?.url, label: title) }
                    .background(Brand.photo)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.inter(14, .bold)).foregroundStyle(Brand.navy).lineLimit(2)
                    if let variant = item.variantLabel {
                        Text(variant).font(.inter(12)).foregroundStyle(Brand.muted)
                    }
                    Text(l.t("cart.quantityShort", ["count": "\(item.quantity)"])).font(.inter(12)).foregroundStyle(Brand.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                // What the shopper pays for this line: less its own code (0074).
                VStack(alignment: .trailing, spacing: 2) {
                    Text(item.finalTotal.formatted(l.current)).font(.inter(14, .heavy)).foregroundStyle(Brand.navy)
                    if item.code != nil {
                        Text(l.t("checkout.lineBefore", ["amount": item.lineTotal.formatted(l.current)]))
                            .font(.inter(12))
                            .foregroundStyle(Brand.muted)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            // The product's own discount code, the width of the line under it
            // (0074): beside the price a box would have no room to type in.
            LineCodeRow(item: item)
        }
        .padding(.vertical, 12)
    }
}

/// How it is paid. Cash on delivery is the one that works and is chosen; the
/// rest are drawn as they will be, each marked as coming and none choosable
/// (3.2.1 waits on a card service).
private struct PaymentMethods: View {
    let cart: Cart?
    let model: CheckoutViewModel
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let refused = cart.flatMap { model.codRefusal(for: $0, language: l) }
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("checkout.paymentMethod"))
                .font(.inter(15, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, 4)
            option(icon: AnyView(Image(systemName: "banknote").font(.system(size: 18, weight: .medium))),
                   title: l.t("checkout.payCod"), note: l.t("checkout.payCodNote"), chosen: refused == nil)
            if let refused {
                Text(refused)
                    .font(.inter(13))
                    .foregroundStyle(Brand.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DeliveryAddressCard.pale))
            }
            option(icon: AnyView(Text("KNET").font(.inter(11, .heavy))), title: l.t("checkout.payKnet"), note: l.t("checkout.payKnetNote"), soon: true)
            option(icon: AnyView(Image(systemName: "creditcard").font(.system(size: 18, weight: .medium))),
                   title: l.t("checkout.payCard"), note: l.t("checkout.payCardNote"), soon: true)
            option(icon: AnyView(Image(systemName: "iphone").font(.system(size: 18, weight: .medium))),
                   title: l.t("checkout.payApple"), note: l.t("checkout.payAppleNote"), soon: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func option(icon: AnyView, title: String, note: String, chosen: Bool = false, soon: Bool = false) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().strokeBorder(chosen ? Brand.navy : Brand.line, lineWidth: chosen ? 2 : 1.5).frame(width: 20, height: 20)
                if chosen { Circle().fill(Brand.navy).frame(width: 10, height: 10) }
            }
            .accessibilityHidden(true)
            icon
                .foregroundStyle(chosen ? Color.white : Brand.muted)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(chosen ? Brand.navy : Brand.tint))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.inter(14, .bold)).foregroundStyle(chosen ? Brand.navy : Brand.body)
                Text(note).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if soon {
                Text(l.t("checkout.paySoon"))
                    .font(.inter(11, .bold))
                    .foregroundStyle(Brand.muted)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Brand.tint))
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(chosen ? Color(red: 246 / 255, green: 248 / 255, blue: 251 / 255) : Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(chosen ? Brand.navy : Brand.cardLine, lineWidth: chosen ? 2 : 1))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

/// A dropdown's closed face: the choice, or what to choose, and a chevron.
struct MenuField: View {
    let text: String?
    let placeholder: String
    /// Filled by a dropped pin and not yet changed: pale orange, like `LabeledField`'s.
    var fromPin = false

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
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(fromPin ? Brand.fromPin : Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(fromPin ? Brand.fromPinRim : Brand.line, lineWidth: 1))
        .animation(.easeOut(duration: 0.25), value: fromPin)
    }
}

/// Place order: orange glass with navy words (4.65:1), full width, with the total in it.
struct OrderButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.bold))
            .foregroundStyle(Brand.navy)
            .frame(maxWidth: .infinity, minHeight: 56)
            .liquidGlass(.orange, enabled: isEnabled, pressed: configuration.isPressed)
            .pressHaptic(configuration.isPressed, strength: Haptics.actionStrength)
    }
}

/// The order just placed, as the confirmation over checkout shows it.
struct PlacedNotice: Identifiable {
    /// The order's reference.
    let id: String
    let total: Money?
}

/// The order summary at checkout: what the goods and delivery come to, what
/// the code, the points and a gift card take off, and what is left to pay at
/// the door — the web's summary, its till the same `settle`.
private struct CheckoutSummary: View {
    let cart: Cart
    let model: CheckoutViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let bill = model.bill(for: cart)
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("checkout.orderSummary")).font(.inter(17, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            row(l.t("cart.subtotal") + " (" + l.t("cart.itemCount", ["count": "\(cart.itemCount)"]) + ")", cart.subtotal.formatted(l.current))
            row(l.t("cart.delivery"), cart.delivery.total.isZero ? l.t("cart.deliveryFree") : cart.delivery.total.formatted(l.current), faint: app.cart.syncing)
            // Each product's own code (0074), named, before anything is paid.
            ForEach(cart.items.filter { $0.code != nil }) { item in
                codeRow(item)
            }
            if !bill.discount.isZero { row(l.t("checkout.discountRow"), "−" + bill.discount.formatted(l.current), good: true) }
            if !bill.points.isZero { row(l.t("checkout.pointsRow"), "−" + bill.points.formatted(l.current), good: true) }
            if !bill.giftCard.isZero { row(l.t("checkout.giftCardRow"), "−" + bill.giftCard.formatted(l.current), good: true) }
            if let waived = cart.delivery.memberWaived, !waived.isZero {
                Text(l.t("membership.deliveryWaived", ["amount": waived.formatted(l.current)])).font(.inter(12, .bold)).foregroundStyle(Brand.success)
            }
            Divider().overlay(Brand.cardLine)
            HStack(alignment: .firstTextBaseline) {
                Text(l.t("cart.total")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                Spacer()
                Text(bill.payable.formatted(l.current))
                    .font(.inter(20, .heavy))
                    .foregroundStyle(Brand.navy)
                    .opacity(app.cart.syncing ? 0.5 : 1)
            }
            // Read in another currency: the total in it, marked as the
            // estimate it is — the dinars above are what is collected.
            if l.currency != CurrencyTable.shop {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(l.price(bill.payable)).font(.inter(13, .semibold))
                    Text(l.t("currency.chargedNote")).font(.inter(12))
                }
                .foregroundStyle(Brand.muted)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func codeRow(_ item: CartItem) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(l.t("checkout.lineCodeRow") + " \u{2066}\(item.code?.code ?? "")\u{2069}").font(.inter(14)).foregroundStyle(Brand.body)
                Text(item.title(l.current)).font(.inter(12)).foregroundStyle(Brand.muted).lineLimit(1)
            }
            Spacer(minLength: 8)
            Text("−" + (item.code?.amount ?? .zero).formatted(l.current))
                .font(.inter(14, .bold))
                .foregroundStyle(Brand.success)
                .opacity(app.cart.syncing ? 0.5 : 1)
        }
        .accessibilityElement(children: .combine)
    }

    private func row(_ label: String, _ value: String, faint: Bool = false, good: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.inter(14)).foregroundStyle(Brand.body)
            Spacer(minLength: 8)
            Text(value).font(.inter(14, .bold)).foregroundStyle(good ? Brand.success : Brand.navy).opacity(faint ? 0.5 : 1)
        }
    }
}
