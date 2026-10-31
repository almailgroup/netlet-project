import SwiftUI

/// The bag — the web's `/cart` on a phone: the title with a heart to Saved
/// items at its end, where the order is going, each store's lines
/// together under its name with that store's delivery beside them, the
/// summary the server worked out and Checkout, and what was saved for later
/// under Checkout (on the owner's word — it was directly under the lines,
/// between the bag and what it costs).
///
/// **It asks where the order is going, on the owner's word** — checkout only
/// confirms it. The first card is the address (`DeliveryAddressCard`, the
/// header's address book), and Checkout pressed without one opens the book
/// first and goes on once one is chosen. Every line has a menu
/// (`LineMenuButton`) that saves it for later, moves it to a wishlist, shares
/// it, opens it or takes it out.
struct CartView: View {
    @Binding var path: NavigationPath
    @State private var pageBottom: CGFloat = .infinity
    /// Whether the page's own Checkout is below the screen, which is when the
    /// bar floats. Only the flip is state: the button's position was, and the
    /// whole bag was drawn again on every frame of a scroll.
    @State private var checkoutBelow = false
    /// Checkout was pressed with no address: go on once one is chosen.
    @State private var continuing = false
    /// The number on "Your profile", for an address that carries none.
    @State private var accountPhone: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        let cart = app.cart.cart
        let barShown = !(cart?.isEmpty ?? true) && checkoutBelow
        // The assistant steps aside while Checkout floats in its corner.
        ShopPage(root: true, header: false, refresh: { await app.cart.refresh() }, assistant: !barShown) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(l.t("cart.title")).pageTitle()
                        if let cart, !cart.isEmpty {
                            Text(l.t("cart.itemCount", ["count": "\(cart.itemCount)"]))
                                .font(.inter(15))
                                .foregroundStyle(Brand.body)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    CartSavedButton(path: $path)
                }
                Color.clear.frame(height: 20)
                if app.cart.settling && (cart?.isEmpty ?? true) {
                    // Never "empty" before it knows — somebody who just pressed Add would read it as a failure.
                    LoadingView().accessibilityLabel(l.t("cart.loading"))
                } else if let cart, !cart.isEmpty {
                    filled(cart)
                } else {
                    EmptyStateView(
                        systemImage: "bag",
                        title: l.t("cart.empty"),
                        note: l.t("cart.emptyNote"),
                        actionTitle: l.t("cart.keepBrowsing")
                    ) { app.goHome() }
                    .card(padding: 0)
                    SavedForLaterRow()
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onAppear { pageBottom = proxy.frame(in: .global).maxY }
                    .onChange(of: proxy.frame(in: .global).maxY) { _, bottom in pageBottom = bottom }
            }
        }
        .overlay(alignment: .bottom) {
            // The bar's own animation, never the page's: an animation on the
            // whole bag animated whatever else changed in that frame with it.
            ZStack(alignment: .bottom) {
                if let cart, barShown {
                    bar(cart)
                        .offset(y: app.tabBarRide)
                        .transition(.opacity)
                }
            }
            .animation(still ? nil : .easeOut(duration: 0.2), value: barShown)
        }
        .task(id: l.current) { await app.cart.refresh() }
        .task(id: app.session.isSignedIn) {
            guard app.session.isSignedIn else {
                accountPhone = nil
                return
            }
            accountPhone = (try? await app.services.account.profileDetails().phone)?.nilIfEmpty.map(PhoneNumber.display)
        }
        // The book closed with an address chosen: on to checkout, as pressed.
        .onChange(of: app.deliveryOpen) { _, open in
            guard !open, continuing else { return }
            if app.delivery.inUse != nil {
                continuing = false
                path.append(Route.checkout)
            } else {
                // A new address is saved and read back; give it a moment.
                Task {
                    try? await Task.sleep(for: .seconds(3))
                    continuing = false
                }
            }
        }
        .onChange(of: app.delivery.inUse?.id) { _, id in
            guard continuing, !app.deliveryOpen, id != nil else { return }
            continuing = false
            path.append(Route.checkout)
        }
    }

    /// Checkout asks where first: signed in with no address in use, the
    /// address book opens on the press, and checkout follows once one is chosen.
    private func goToCheckout() {
        if app.session.isSignedIn && app.delivery.loaded && app.delivery.inUse == nil {
            continuing = true
            app.deliveryOpen = true
            return
        }
        path.append(Route.checkout)
    }

    private func filled(_ cart: Cart) -> some View {
        let groups = BagGroup.groups(cart)
        return VStack(spacing: 12) {
            DeliveryAddressCard(accountPhone: accountPhone)
            if let recovery = cart.recovery, recovery.remind, let count = recovery.itemCount, let hours = recovery.hours {
                // Said where it is seen rather than in an email nobody can send.
                VStack(alignment: .leading, spacing: 2) {
                    Text(count == 1 ? l.t("cart.recoveryTitleOne") : l.t("cart.recoveryTitle", ["count": "\(count)"]))
                        .font(.inter(13, .heavy))
                        .foregroundStyle(Brand.navy)
                    Text(hours >= 48 ? l.t("cart.recoveryNoteDays", ["days": "\(hours / 24)"]) : l.t("cart.recoveryNote", ["hours": "\(hours)"]))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(red: 253 / 255, green: 243 / 255, blue: 238 / 255)))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color(red: 240 / 255, green: 211 / 255, blue: 198 / 255), lineWidth: 1))
            }
            if let groups {
                ForEach(groups) { group in
                    CartStoreCard(group: group, path: $path)
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(cart.items) { item in
                        CartLineRow(item: item)
                        if item.id != cart.items.last?.id { Divider().padding(.vertical, 12) }
                    }
                }
                .card()
            }
            VStack(alignment: .leading, spacing: 14) {
                SummaryCard(cart: cart, grouped: groups != nil, updating: app.cart.syncing)
                Text(l.t("cart.checkoutNote"))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                checkoutButton(cart)
                    .background {
                        GeometryReader { proxy in
                            Color.clear
                                .onChange(of: proxy.frame(in: .global).minY > pageBottom - 8, initial: true) { _, below in
                                    if below != checkoutBelow { checkoutBelow = below }
                                }
                        }
                    }
            }
            .card()
            // Under Checkout, on the owner's word: the bag and what it costs
            // come first, and what was put aside follows for whoever wants it
            // back.
            SavedForLaterRow(topPadding: 12)
        }
    }

    private func checkoutButton(_ cart: Cart) -> some View {
        Button {
            goToCheckout()
        } label: {
            HStack(spacing: 8) {
                Text(l.t("cart.checkout"))
                Image(systemName: "arrow.forward").font(.system(size: 14, weight: .semibold))
            }
        }
        .buttonStyle(AccentButtonStyle())
    }

    /// The total and Checkout over the tab bar while the page's own button is
    /// still below the screen; they leave as it comes up to meet them.
    private func bar(_ cart: Cart) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t("cart.total")).font(.inter(12)).foregroundStyle(Brand.muted)
                Text(cart.total.formatted(l.current)).font(.inter(17, .heavy)).foregroundStyle(Brand.navy)
                    .opacity(app.cart.syncing ? 0.5 : 1)
            }
            Button(l.t("cart.checkoutShort")) { goToCheckout() }
                .buttonStyle(AccentButtonStyle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(GlassCapsule())
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("cart.bar"))
    }
}

/// Saved items, at the end of the title's line, counted — the hearts, where
/// somebody keeps what they decided not to buy yet; the header's heart, on the
/// owner's word. The wishlists are a row of the account page.
private struct CartSavedButton: View {
    @Binding var path: NavigationPath
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let saved = app.saved.ids.count
        Button {
            path.append(Route.saved)
        } label: {
            Image(systemName: "heart")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color.white).shadow(color: Brand.navy.opacity(0.12), radius: 4, y: 1))
                .overlay(alignment: .topTrailing) {
                    CountBadge(value: saved).fixedSize().offset(x: 6, y: -6)
                }
                .contentShape(Circle())
        }
        .buttonStyle(.tap)
        .accessibilityLabel(l.t("header.savedItems", ["count": "\(saved)"]))
    }
}

/// One store's part of the bag: its name, which opens its page, its parcels —
/// what each costs, free in green, and how far to free delivery — then its
/// lines (`bagGroups` on the web).
private struct CartStoreCard: View {
    let group: BagGroup
    @Binding var path: NavigationPath
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    path.append(Route.store(slug: group.store.slug))
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "storefront")
                            .font(.system(size: 14, weight: .semibold))
                        Text(l.t("browse.soldBy", ["name": "\u{2068}\(group.store.name(l.current))\u{2069}"]))
                            .font(.inter(14, .heavy))
                            .lineLimit(1)
                        Image(systemName: "chevron.forward")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Brand.muted)
                    }
                    .foregroundStyle(Brand.navy)
                    .frame(minHeight: 36)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                ForEach(Array(group.delivery.enumerated()), id: \.offset) { _, parcel in
                    ParcelLine(parcel: parcel)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            Divider().overlay(Brand.cardLine)
            VStack(spacing: 0) {
                ForEach(group.items) { item in
                    CartLineRow(item: item).padding(.vertical, 14)
                    if item.id != group.items.last?.id { Divider().overlay(Brand.cardLine) }
                }
            }
            .padding(.horizontal, 16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}

/// One parcel's delivery: what it costs, to which door when not the order's
/// own, and while there is a threshold left, how much more and how far along.
private struct ParcelLine: View {
    let parcel: CartDeliveryLine
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let fast = parcel.choice == "fast"
        let free = parcel.free || parcel.fee.isZero
        let cost = free
            ? l.t(fast ? "cart.storeFastDeliveryFree" : "cart.storeDeliveryFree")
            : l.t(fast ? "cart.storeFastDelivery" : "cart.storeDelivery", ["fee": parcel.fee.formatted(l.current)])
        let door = parcel.destinationLabel.map { l.t("address.sendingTo", ["label": $0]) + " · " } ?? ""
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: free ? "checkmark" : "truck.box")
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
                Text(door + cost)
                    .font(.inter(13, .semibold))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(free ? Brand.success : Brand.body)
            if let toFree = parcel.toFree, !toFree.isZero, let progress = BagGroup.freeProgress(parcel) {
                Text(l.t("cart.storeToFree", ["amount": toFree.formatted(l.current)]))
                    .font(.inter(12, .bold))
                    .foregroundStyle(Brand.accentInk)
                    .fixedSize(horizontal: false, vertical: true)
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(Brand.navy)
                    .accessibilityHidden(true)
            }
        }
    }
}

/// One line: its photo and name (both to the product), what it is and what it
/// costs under the name, then its trip and its stepper — the web's `BagLine`.
/// The total sits under the name rather than at the stepper's end, because on
/// a narrow phone the two did not fit on one line.
struct CartLineRow: View {
    let item: CartItem
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let title = item.title(l.current)
        HStack(alignment: .top, spacing: 12) {
            NavigationLink(value: Route.product(handle: item.productHandle)) {
                Color.clear
                    .frame(width: 80, height: 80)
                    .overlay { RemoteImage(reference: item.image?.url, label: title) }
                    .background(Brand.photo)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            }
            .buttonStyle(.tap)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                // The stepper's minus is a bin at one, and the menu beside the
                // name holds the rest of what can be done with the line.
                HStack(alignment: .top, spacing: 4) {
                    NavigationLink(value: Route.product(handle: item.productHandle)) {
                        Text(title)
                            .font(.inter(14, .heavy))
                            .foregroundStyle(Brand.navy)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.tap)
                    LineMenuButton(item: item, title: title)
                        .padding(.top, -8)
                        .padding(.trailing, -10)
                }
                if let variant = item.variantLabel {
                    Text(variant).font(.inter(12)).foregroundStyle(Brand.muted)
                }
                ForEach(item.addons ?? [], id: \.id) { addon in
                    Text("+ " + addon.label).font(.inter(12)).foregroundStyle(Brand.accentInk)
                }
                if let bundle = item.bundleName {
                    Text(bundle).font(.inter(12)).foregroundStyle(Brand.accentInk)
                }
                if let destination = item.destination {
                    Text(l.t("address.sendingTo", ["label": destination.label])).font(.inter(12)).foregroundStyle(Brand.muted)
                }
                Text(item.lineTotal.formatted(l.current))
                    .font(.inter(15, .heavy))
                    .foregroundStyle(Brand.navy)
                    .padding(.top, 2)
                // What one costs, once there is more than one.
                if item.quantity > 1 {
                    Text(l.t("cart.each", ["price": item.unitPrice.formatted(l.current)]))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                }
                // How much the steps come to, for something sold by weight (`MeasureLabel`).
                if let measure = item.measure,
                   let amount = ListingRules.shared.measureOf(unit: measure.unit, step: measure.stepAmount, quantity: item.quantity) {
                    Text(l.t("unit.amount", ["value": UnitWording.number(amount.value), "unit": l.t("unit.\(amount.unit)")]))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                }
                // Fast or regular (3.2.5), only where the store offers fast.
                if let fast = item.fastDelivery {
                    SpeedChoice(item: item, fast: fast, title: title).padding(.top, 4)
                }
                // No more than there is of it (`BagStock`), and a line asking
                // for more than is left says so before checkout.
                let lines = app.cart.cart?.items ?? [item]
                QuantityStepper(
                    quantity: item.quantity,
                    maximum: BagStock.lineCeiling(item, in: lines),
                    name: title,
                    busy: app.cart.busyLine == item.lineId,
                    compact: true,
                    typed: true
                ) { next in
                    if next == 0 { announce(l.t("cart.removedName", ["name": title])) }
                    Task {
                        if !(await app.cart.setQuantity(lineId: item.lineId, to: next)) { app.toast(l.t("cart.updateFailed")) }
                    }
                }
                .padding(.top, 6)
                if let left = BagStock.shortLines(lines)[item.lineId] {
                    Text(left == 0 ? l.t("cart.lineSoldOut") : l.t("cart.lineShort", ["count": "\(left)"]))
                        .font(.inter(12, .bold))
                        .foregroundStyle(Brand.danger)
                        .padding(.top, 4)
                }
            }
        }
    }
}

/// Regular or fast for one line (3.2.5): two presses in a named group, each
/// saying what it costs, so the choice and its price are read together.
private struct SpeedChoice: View {
    let item: CartItem
    let fast: CartItem.FastDelivery
    let title: String
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 4) {
            option(fast: false, label: l.t("delivery.regular"))
            // A member's fast trip is NetLet's to carry too (4.1), so it says free.
            option(fast: true, label: app.cart.cart?.delivery.memberFree == true
                ? l.t("delivery.fastFreeMember")
                : l.t("delivery.fastFor", ["fee": fast.fee.formatted(l.current)]))
            if item.isFast, let speed = fast.speed, ListingRules.shared.deliverySpeeds.contains(speed) {
                Text(l.t("speed.\(speed)")).font(.inter(11)).foregroundStyle(Brand.muted).padding(.horizontal, 4)
            }
        }
        .padding(2)
        .background(Capsule().fill(Color.white))
        .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("delivery.choiceFor", ["name": title]))
    }

    private func option(fast choice: Bool, label: String) -> some View {
        let on = item.isFast == choice
        return Button {
            guard !on else { return }
            let refused = l.t("cart.updateFailed")
            Task { if !(await app.cart.setDeliveryChoice(lineId: item.lineId, fast: choice)) { app.toast(refused) } }
        } label: {
            Text(label)
                .font(.inter(12, .bold))
                .foregroundStyle(on ? Color.white : Brand.navy)
                .padding(.horizontal, 10)
                .frame(minHeight: 32)
                .background(Capsule().fill(on ? Brand.navy : Color.clear))
        }
        .buttonStyle(.tap)
        .disabled(app.cart.busyLine == item.lineId)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The order summary: the subtotal, the delivery and the total — every figure
/// the server's. Drawn by store, each store's delivery is beside its lines,
/// so only the sum is here; a bag drawn as one list names each seller's.
struct SummaryCard: View {
    let cart: Cart
    var grouped = false
    /// A press is on its way: the subtotal is already the new one, while the
    /// delivery and the total are the server's last and drawn faint until it
    /// answers — the web's `syncing`.
    var updating = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let count = l.t("cart.itemCount", ["count": String(cart.itemCount)])
        VStack(spacing: 10) {
            Text(l.t("checkout.orderSummary"))
                .font(.inter(17, .heavy))
                .foregroundStyle(Brand.navy)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            row(l.t("cart.subtotal") + " (" + count + ")", cart.subtotal.formatted(l.current))
            if grouped {
                row(l.t("cart.delivery"), cart.delivery.total.formatted(l.current), faint: updating)
            }
            if let waived = cart.delivery.memberWaived, !waived.isZero {
                Text(l.t("membership.deliveryWaived", ["amount": waived.formatted(l.current)]))
                    .font(.inter(12, .bold))
                    .foregroundStyle(Brand.navy)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(Array((grouped ? [] : cart.delivery.perVendor).enumerated()), id: \.offset) { _, line in
                let name = line.storeName(l.current)
                VStack(alignment: .leading, spacing: 4) {
                    row(
                        line.label(l),
                        line.free || line.fee.isZero ? l.t("cart.deliveryFree") : line.fee.formatted(l.current),
                        faint: updating
                    )
                    if let toFree = line.toFree, !toFree.isZero {
                        Text(line.destinationLabel.map { l.t("address.toFreeAt", ["amount": toFree.formatted(l.current), "name": name, "label": $0]) }
                            ?? l.t("cart.deliveryToFree", ["amount": toFree.formatted(l.current), "name": name]))
                            .font(.caption)
                            .foregroundStyle(Brand.accentInk)
                    }
                }
            }
            Divider()
            row(l.t("cart.total"), cart.total.formatted(l.current), bold: true, faint: updating)
        }
    }

    private func row(_ label: String, _ value: String, bold: Bool = false, faint: Bool = false) -> some View {
        HStack {
            Text(label).foregroundStyle(bold ? Brand.ink : Brand.muted)
            Spacer()
            Text(value).foregroundStyle(Brand.navy)
                .opacity(faint ? 0.5 : 1)
                .animation(.easeOut(duration: 0.15), value: faint)
        }
        .font(bold ? .headline.weight(.bold) : .subheadline)
    }
}
