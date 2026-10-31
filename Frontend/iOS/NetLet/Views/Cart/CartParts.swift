import SwiftUI

/// Where the order goes, as a card — the web's `DeliveryAddressCard`: the cart
/// asks it, checkout confirms it.
///
/// **The address is chosen in the cart, on the owner's word** ("it should ask
/// you to choose your delivery location in the cart page, not in checkout"):
/// the address in use (`DeliveryModel.inUse`, the header's own rule, so the
/// header, the cart and checkout name one address) or the question, and a
/// press that opens the address book (`DeliverySheet`). Checkout draws the
/// same card to confirm it, because Buy now goes there without passing the
/// cart. A guest has no book: the card names the area delivery is priced for
/// and says signing in is what lets the shop deliver to an address.
struct DeliveryAddressCard: View {
    /// The number on "Your profile", for an address that carries none.
    var accountPhone: String? = nil
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let delivery = app.delivery
        let signedIn = app.session.isSignedIn
        let address = signedIn ? delivery.inUse : nil
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "mappin.and.ellipse")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Brand.accentInk)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Self.pale))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(l.t("home.deliverTo"))
                    .font(.inter(12, .semibold))
                    .foregroundStyle(Brand.muted)
                if signedIn && !delivery.loaded {
                    VStack(alignment: .leading, spacing: 6) {
                        RoundedRectangle(cornerRadius: 4).fill(Brand.tint).frame(width: 110, height: 15)
                        RoundedRectangle(cornerRadius: 4).fill(Brand.tint).frame(width: 190, height: 12)
                    }
                    .padding(.top, 3)
                    .accessibilityHidden(true)
                } else if let address {
                    filled(address)
                } else if signedIn {
                    heading(l.t("cart.chooseAddress"))
                    note(l.t("cart.chooseAddressNote"))
                } else {
                    let zone = ReferenceData.shared.governorate(id: delivery.zoneId)?.name(l.current)
                    heading(zone.map { l.t("cart.pricedFor", ["area": $0]) } ?? l.t("cart.chooseArea"))
                    note(l.t("cart.guestAddressNote"))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                app.deliveryOpen = true
            } label: {
                Text(l.t(address == nil ? "cart.choose" : "cart.change"))
                    .font(.inter(13, .bold))
                    .foregroundStyle(address == nil ? Color.white : Brand.navy)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 36)
                    .background(Capsule().fill(address == nil ? Brand.navy : Color.white))
                    .overlay(Capsule().strokeBorder(Brand.navy.opacity(address == nil ? 0 : 0.2), lineWidth: 1))
                    .contentShape(Capsule())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 18, strength: Haptics.actionStrength))
            .accessibilityLabel(address == nil ? l.t("cart.choose") : l.t("cart.changeAddress"))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .task(id: signedIn) { await app.delivery.refresh(signedIn: signedIn) }
    }

    static let pale = Color(red: 253 / 255, green: 243 / 255, blue: 238 / 255)

    @ViewBuilder
    private func filled(_ address: SavedAddress) -> some View {
        let name = address.contactName?.trimmingCharacters(in: .whitespaces).nilIfEmpty
            ?? app.session.user?.name?.trimmingCharacters(in: .whitespaces).nilIfEmpty
        let phone = address.contactPhone?.nilIfEmpty.map(PhoneNumber.display) ?? accountPhone?.nilIfEmpty
        let zone = ReferenceData.shared.governorate(id: address.governorate)?.name(l.current)
        let line = address.line(l.current)
        heading(address.label)
        if name != nil || phone != nil {
            Text([name.map { "\u{2068}\($0)\u{2069}" }, phone.map { "\u{2066}\($0)\u{2069}" }].compactMap { $0 }.joined(separator: " · "))
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.body)
        }
        let place = [zone, line.nilIfEmpty].compactMap { $0 }.joined(separator: " · ")
        if !place.isEmpty {
            Text(place)
                .font(.inter(13))
                .foregroundStyle(Brand.muted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func heading(_ text: String) -> some View {
        Text(text)
            .font(.inter(15, .heavy))
            .foregroundStyle(Brand.navy)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.inter(13))
            .foregroundStyle(Brand.muted)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// What can be done with one line of the bag, behind its "⋯", on the owner's
/// word — the web's `LineMenu`: keep it for later, move it to a wishlist,
/// share it, open it, or take it out.
///
/// **Save for later moves the line into Saved** — the hearts — where the cart
/// lists it under the bag (`SavedForLaterRow`) with a way back; not a list of
/// its own, which would be a second answer to "where did I put it". **Move to
/// wishlist** asks the heart's own question (`WishSheet`) and takes the line
/// out only once it is on a list; a guest has no lists and is not offered it.
/// Both need the line's product, which a bag read before the server sent it
/// lacks. A plain line saved for later can be put straight back (the toast's
/// Undo); one with extras or priced as a set cannot, since adding it again
/// would make a different line.
///
/// A sheet from the foot of the screen naming the product over the actions,
/// the web phone's shape. What was chosen runs once the sheet has gone, so the
/// wishlist's question is never asked over it.
struct LineMenuButton: View {
    let item: CartItem
    let title: String
    @State private var open = false
    @State private var chosen: LineAction?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    enum LineAction { case later, wishlist, view, remove }

    var body: some View {
        Button {
            open = true
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Brand.navy)
                .frame(width: 44, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(PressFillStyle(cornerRadius: 12))
        .accessibilityLabel(l.t("cart.lineMenu", ["name": title]))
        .sheet(isPresented: $open, onDismiss: run) {
            LineMenuSheet(
                item: item,
                title: title,
                wishlist: item.productId != nil && app.session.isSignedIn && app.features.isOn("wishlists")
            ) { action in
                chosen = action
                open = false
            }
            .environment(\.layoutDirection, l.layoutDirection)
            .buttonStyle(HapticDefaultStyle())
        }
    }

    private func run() {
        guard let action = chosen else { return }
        chosen = nil
        let lineId = item.lineId
        let app = self.app
        switch action {
        case .later:
            guard let productId = item.productId else { return }
            let wasSaved = app.saved.contains(productId)
            let plain = (item.addons ?? []).isEmpty && item.bundleName == nil
            let variantId = item.variantId
            let quantity = item.quantity
            let refused = l.t("cart.updateFailed")
            Task {
                await app.saved.save(productId)
                if !(await app.cart.setQuantity(lineId: lineId, to: 0)) { app.toast(refused) }
            }
            // A plain line can be put straight back; one with extras or a set's price cannot.
            var undo: (@MainActor () -> Void)?
            if plain {
                let addFailed = l.t("cart.addFailed")
                undo = {
                    Task {
                        if !(await app.cart.add(variantId: variantId, quantity: quantity)) { app.toast(addFailed) }
                        if !wasSaved { await app.saved.unsave(productId) }
                    }
                }
            }
            app.toast(l.t("cart.savedForLater", ["name": "\u{2068}\(title)\u{2069}"]), undo: undo)
        case .wishlist:
            guard let productId = item.productId else { return }
            let refused = l.t("cart.updateFailed")
            app.wishAsking = WishTarget(productId: productId, title: title, start: .lists, onWished: {
                Task { if !(await app.cart.setQuantity(lineId: lineId, to: 0)) { app.toast(refused) } }
            })
        case .view:
            app.push(.product(handle: item.productHandle))
        case .remove:
            announce(l.t("cart.removedName", ["name": title]))
            Task {
                if !(await app.cart.setQuantity(lineId: lineId, to: 0)) { app.toast(l.t("cart.updateFailed")) }
            }
        }
    }
}

private struct LineMenuSheet: View {
    let item: CartItem
    let title: String
    let wishlist: Bool
    let choose: (LineMenuButton.LineAction) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    Color.clear
                        .frame(width: 48, height: 48)
                        .overlay { RemoteImage(reference: item.image?.url) }
                        .background(Brand.photo)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .accessibilityHidden(true)
                    Text(title)
                        .font(.inter(15, .heavy))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityAddTraits(.isHeader)
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 14)
                Divider().overlay(Brand.cardLine)
                VStack(spacing: 0) {
                    if item.productId != nil {
                        row("bookmark", l.t("cart.saveForLater")) { choose(.later) }
                    }
                    if wishlist {
                        row("gift", l.t("cart.moveToWishlist")) { choose(.wishlist) }
                    }
                    ShareLink(item: app.services.configuration.url(path: ReferralCode.productPath(handle: item.productHandle, code: app.memberCode))) {
                        label("square.and.arrow.up", l.t("cart.shareItem"))
                    }
                    .buttonStyle(PressFillStyle(cornerRadius: 0))
                    row("arrow.up.forward.square", l.t("cart.viewProduct")) { choose(.view) }
                    row("trash", l.t("cart.removeFromCart"), danger: true) { choose(.remove) }
                }
                .padding(.vertical, 6)
            }
        }
        .background(Color.white)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ symbol: String, _ text: String, danger: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) { label(symbol, text, danger: danger) }
            .buttonStyle(PressFillStyle(cornerRadius: 0, strength: Haptics.actionStrength))
    }

    private func label(_ symbol: String, _ text: String, danger: Bool = false) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .medium))
                .frame(width: 24)
                .accessibilityHidden(true)
            Text(text).font(.inter(15, .semibold))
            Spacer(minLength: 0)
        }
        .foregroundStyle(danger ? Brand.danger : Brand.navy)
        .padding(.horizontal, 20)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
    }
}

/// Where one line goes, on the owner's word ("add a delivery icon below the
/// 3-dots menu for each product in the cart"): the web's `LineDestination`.
/// Every line goes where the order goes — the address in use, the cart's first
/// card — until it is told otherwise here; the choice is the line's own
/// (`commerce.setDestination`, kept on the bag's line and frozen on the
/// order's), said under its name as "Going to …". Navy while the line is going
/// somewhere of its own. A guest has no book, so no button.
struct LineDestinationButton: View {
    let item: CartItem
    let title: String
    @State private var open = false
    /// What the sheet chose, done once it has gone down.
    @State private var chosen: Choice?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    enum Choice: Equatable { case address(Int?), add }

    var body: some View {
        let main = app.delivery.inUse?.id
        let current = item.destination?.id
        let own = current != nil && current != main
        if app.session.isSignedIn {
            Button {
                open = true
            } label: {
                Image(systemName: own ? "truck.box.fill" : "truck.box")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(own ? Brand.navy : Brand.muted)
                    .scaleEffect(x: l.current == .ar ? -1 : 1)
                    .frame(width: 44, height: 36)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 12))
            .accessibilityLabel(l.t("address.forLine", ["name": title]))
            .accessibilityValue(item.destination?.label ?? l.t("address.orderAddress"))
            .sheet(isPresented: $open, onDismiss: run) {
                LineDestinationSheet(item: item, title: title) { choice in
                    chosen = choice
                    open = false
                }
                .environment(\.layoutDirection, l.layoutDirection)
                .buttonStyle(HapticDefaultStyle())
            }
        }
    }

    private func run() {
        guard let choice = chosen else { return }
        chosen = nil
        let app = self.app
        let lineId = item.lineId
        switch choice {
        case .address(let id):
            Task {
                if !(await app.cart.setDestination(lineId: lineId, addressId: id)) {
                    Haptics.refused()
                    app.toast(l.t("cart.updateFailed"))
                }
            }
        case .add:
            app.push(.addresses)
        }
    }
}

/// A better price for one line, on the owner's word ("a discount icon next
/// to each individual product … applies exclusively to that row"): the web's
/// `LineDiscount`. It is the price request (`PriceRequestPanel`, 3.1.13) asked
/// from the line — what the seller agrees is this shopper's price for that
/// variant, so it lowers that line alone. Drawn only where the seller takes
/// requests on the variant and `priceOffers` is on; navy while an agreed price
/// is on the line. A guest is shown it and signs in once the sheet is down.
struct LineDiscountButton: View {
    let item: CartItem
    let title: String
    @State private var taken = false
    @State private var open = false
    @State private var signIn = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let agreed = item.priceReason == "agreed" && item.agreedFrom != nil
        VStack(spacing: 0) {
            if taken {
                Button {
                    open = true
                } label: {
                    Image(systemName: agreed ? "tag.fill" : "tag")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(agreed ? Brand.navy : Brand.muted)
                        .scaleEffect(x: l.current == .ar ? -1 : 1)
                        .frame(width: 44, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(PressFillStyle(cornerRadius: 12))
                .accessibilityLabel(l.t("offers.forLine", ["name": title]))
                .sheet(isPresented: $open, onDismiss: {
                    if signIn {
                        signIn = false
                        app.authPresented = true
                    }
                }) {
                    LineDiscountSheet(item: item, title: title) {
                        signIn = true
                        open = false
                    }
                    .environment(\.layoutDirection, l.layoutDirection)
                    .buttonStyle(HapticDefaultStyle())
                }
            }
        }
        .task(id: item.variantId) { await load() }
    }

    private func load() async {
        guard app.features.isOn("priceOffers"), let id = Int(item.variantId), id > 0 else {
            taken = false
            return
        }
        taken = (try? await app.services.api.call(API.priceRequestsOpen, .init(variantIds: [id])))?.contains(id) ?? false
    }
}

private struct LineDiscountSheet: View {
    let item: CartItem
    let title: String
    let signIn: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let listed = item.agreedFrom ?? item.unitPrice
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: 12) {
                        Color.clear
                            .frame(width: 48, height: 48)
                            .overlay { RemoteImage(reference: item.image?.url) }
                            .background(Brand.photo)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(title)
                                .font(.inter(15, .heavy))
                                .foregroundStyle(Brand.navy)
                                .lineLimit(2)
                            Text(l.t("offers.lineNote", ["price": listed.formatted(l.current)]))
                                .font(.inter(12))
                                .foregroundStyle(Brand.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    Divider().overlay(Brand.cardLine)
                    PriceRequestPanel(variantId: item.variantId, listPrice: listed, embedded: true, onSignIn: signIn)
                }
                .padding(20)
            }
            .background(Color.white)
            .navigationTitle(l.t("offers.heading"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

private struct LineDestinationSheet: View {
    let item: CartItem
    let title: String
    let choose: (LineDestinationButton.Choice) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let main = app.delivery.inUse
        let current = item.destination?.id
        let others = (app.cart.cart?.addresses ?? []).filter { $0.id != main?.id }
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top, spacing: 12) {
                    Color.clear
                        .frame(width: 48, height: 48)
                        .overlay { RemoteImage(reference: item.image?.url) }
                        .background(Brand.photo)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title)
                            .font(.inter(15, .heavy))
                            .foregroundStyle(Brand.navy)
                            .lineLimit(2)
                            .accessibilityAddTraits(.isHeader)
                        Text(l.t("address.lineIntro"))
                            .font(.inter(12))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 14)
                Divider().overlay(Brand.cardLine)
                VStack(spacing: 0) {
                    row("house", l.t("address.orderAddress"), note: main?.label, checked: current == nil || current == main?.id) {
                        choose(.address(nil))
                    }
                    ForEach(others) { address in
                        row("mappin", address.label, checked: current == address.id) {
                            choose(.address(address.id))
                        }
                    }
                    row("plus", l.t("address.add"), checked: nil) { choose(.add) }
                }
                .padding(.vertical, 6)
            }
        }
        .background(Color.white)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ symbol: String, _ text: String, note: String? = nil, checked: Bool?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(text).font(.inter(15, .semibold))
                    if let note, !note.isEmpty {
                        Text(note).font(.inter(13)).foregroundStyle(Brand.muted)
                    }
                }
                Spacer(minLength: 0)
                if checked == true {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .bold))
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(PressFillStyle(cornerRadius: 0, strength: Haptics.actionStrength))
        .accessibilityAddTraits(checked == true ? .isSelected : [])
    }
}

/// Saved for later: what the shopper keeps without buying yet, under the
/// summary and Checkout — under its empty state when the bag is empty — on the
/// owner's word, with a way back into it: the web's `SavedForLater`.
///
/// It is Saved, newest first, less anything already in the bag, read by id
/// (`commerce.products.byIds`). **Move to cart** adds the plain line and takes
/// the product out of Saved alone: a wishlist it is on keeps it. A product
/// with sizes or colours opens its page, since a size has to be chosen before
/// "add" means anything, and a sold-out one says so. One row that scrolls
/// sideways, and nothing drawn with nothing saved.
struct SavedForLaterRow: View {
    /// The room above it once there is something to show.
    var topPadding: CGFloat = 24
    @State private var products: [Product] = []
    /// The ids the last answer was for. Until the answer for these has come,
    /// the row holds its place with outlines, or it arrived a moment after
    /// the bag and pushed the summary down the screen.
    @State private var loadedFor: String?
    @Environment(\.accessibilityReduceMotion) private var still
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    static let most = 12

    private var wanted: [String] {
        let inBag = Set((app.cart.cart?.items ?? []).compactMap(\.productId))
        return Array(app.saved.ids.reversed().filter { !inBag.contains($0) }.prefix(Self.most))
    }

    var body: some View {
        let ids = wanted
        let key = ids.joined(separator: ",") + "|" + l.current.rawValue
        let shown = ids.compactMap { id in products.first { $0.id == id } }
        let waiting = shown.isEmpty && !ids.isEmpty && loadedFor != key
        VStack(alignment: .leading, spacing: 12) {
            if !shown.isEmpty || waiting {
                HStack(spacing: 12) {
                    Text(l.t("cart.savedTitle"))
                        .font(.inter(17, .heavy))
                        .foregroundStyle(Brand.navy)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    Button {
                        app.push(.saved)
                    } label: {
                        HStack(spacing: 4) {
                            Text(l.t("home.viewAll"))
                            Image(systemName: "chevron.forward").font(.system(size: 12, weight: .semibold))
                        }
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.accentInk)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        if waiting {
                            ForEach(0..<min(ids.count, 3), id: \.self) { _ in placeholder }
                        } else {
                            ForEach(shown) { product in
                                SavedProductCard(product: product)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.viewAligned)
                .padding(.horizontal, -16)
            }
        }
        .padding(.top, shown.isEmpty && !waiting ? 0 : topPadding)
        .task(id: key) { await load(ids, key: key) }
    }

    /// A saved card's outline, its own size, so nothing moves when the cards land.
    private var placeholder: some View {
        VStack(alignment: .leading, spacing: 6) {
            LoadingTint(still: still)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            RoundedRectangle(cornerRadius: 4).fill(Brand.tint).frame(height: 13).padding(.trailing, 24)
            RoundedRectangle(cornerRadius: 4).fill(Brand.tint).frame(width: 64, height: 13).padding(.bottom, 4)
            RoundedRectangle(cornerRadius: 4).fill(Brand.tint).frame(width: 56, height: 17)
            Capsule().fill(Brand.tint).frame(height: 36)
        }
        .padding(8)
        .frame(width: 152)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private func load(_ ids: [String], key: String) async {
        guard !ids.isEmpty else {
            products = []
            loadedFor = key
            return
        }
        if let found = try? await app.services.api.call(API.productsByIds, .init(ids: ids, locale: l.current.rawValue)) {
            products = found
        }
        // A failed read lets the row go rather than leaving outlines for good.
        if !Task.isCancelled { loadedFor = key }
    }
}

/// A saved product, as the cart's Saved for later row and the Saved items
/// page draw it: the photo with an × that takes it out of Saved, the name,
/// the price and Move to cart (or Choose an option, or Sold out). **The Saved
/// page's grid also offers Move to wishlist, on the owner's word** ("an
/// option for moving the products that are in your saved products to
/// wishlist or shopping cart"): the heart's second question (`WishSheet` from
/// `.lists`), and the product leaves Saved only once it is on a list. A guest
/// has no lists and is not offered it — the web's `SavedCard`.
struct SavedProductCard: View {
    let product: Product
    /// The Saved page's grid, rather than the cart's sideways row.
    var grid = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let variant = product.variants.first(where: \.availableForSale)
        let choosing = product.variants.count > 1
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topTrailing) {
                Button {
                    app.push(.product(handle: product.handle))
                } label: {
                    Color.clear
                        .aspectRatio(1, contentMode: .fit)
                        .overlay { RemoteImage(reference: product.images.first?.url, label: product.title) }
                        .background(Brand.photo)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.tap)
                .accessibilityHidden(true)
                Button {
                    Task { await app.saved.unsave(product.id) }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(Color.white).shadow(color: Brand.navy.opacity(0.18), radius: 2, y: 1))
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("product.removeSaved", ["name": product.title]))
            }
            Button {
                app.push(.product(handle: product.handle))
            } label: {
                Text(product.title)
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .topLeading)
            }
            .buttonStyle(.tap)
            Text(l.price((variant?.price ?? product.priceRange.min)))
                .font(.inter(14, .heavy))
                .foregroundStyle(Brand.navy)
            if variant == nil {
                Text(l.t("product.soldOut"))
                    .font(.inter(12, .bold))
                    .foregroundStyle(Brand.muted)
                    .frame(maxWidth: .infinity, minHeight: 36)
                    .background(Capsule().fill(Brand.tint))
            } else if choosing {
                Button {
                    app.push(.product(handle: product.handle))
                } label: {
                    Text(l.t("product.chooseOption"))
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.25), lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(PressFillStyle(cornerRadius: 18))
            } else if let variant {
                Button {
                    move(variant)
                } label: {
                    Text(l.t("cart.moveToCart"))
                        .font(.inter(13, .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(Capsule().fill(Brand.navy))
                        .contentShape(Capsule())
                }
                .buttonStyle(.action)
                .accessibilityLabel(l.t("cart.moveToCartName", ["name": product.title]))
            }
            if grid, app.session.isSignedIn, app.features.isOn("wishlists") {
                Button {
                    wish()
                } label: {
                    Text(l.t("cart.moveToWishlist"))
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background(Capsule().fill(Color.white))
                        .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.25), lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(PressFillStyle(cornerRadius: 20))
                .accessibilityLabel(l.t("saved.moveToWishlistName", ["name": product.title]))
            }
        }
        .padding(grid ? 10 : 8)
        .frame(width: grid ? nil : 152)
        .frame(maxWidth: grid ? .infinity : nil, maxHeight: grid ? .infinity : nil, alignment: .top)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    /// Onto a wishlist, then out of Saved — only once it is on one.
    private func wish() {
        let app = self.app
        let productId = product.id
        let said = l.t("saved.movedToWishlist", ["name": product.title])
        app.wishAsking = WishTarget(productId: productId, title: product.title, start: .lists, onWished: {
            Task {
                await app.saved.unsave(productId)
                announce(said)
            }
        })
    }

    private func move(_ variant: ProductVariant) {
        let app = self.app
        let product = self.product
        let said = l.t("cart.movedToCart", ["name": product.title])
        let failed = l.t("cart.addFailed")
        Task {
            await app.saved.unsave(product.id)
            if await app.cart.add(variantId: variant.id, quantity: 1, product: product) {
                announce(said)
            } else {
                Haptics.refused()
                await app.saved.save(product.id)
                app.toast(failed)
            }
        }
    }
}
