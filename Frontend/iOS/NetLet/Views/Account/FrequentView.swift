import SwiftUI

/// Frequently bought — the web's `AccountFrequent` (`/account/frequent`), on
/// the owner's word: what the shopper buys again and again, each at the
/// option they buy and the amount they usually take.
///
/// It reorders by filling the bag, never by ordering: a row's Add to cart puts
/// its usual amount in the bag through `CartModel.add`, and "Add all to cart"
/// does that for every item that can go in — checkout is still the shopper's
/// own press, and the first line says so. The usual amount is changed where it
/// is drawn and kept on the account, written once the presses stop. One press
/// never asks for more than there is (`FrequentRules.addable`); a sold-out
/// item says so, and one whose product has left the shop stays, marked, with
/// a way to take it off. "From your past orders" offers what the shopper has
/// bought before and not put on, most often bought first.
///
/// Several can be chosen, on the owner's word ("a multiple selection option
/// for the pages that need it"), the web's circles: what has not been left
/// out is chosen, so "Add all to cart" reads "Add to cart (3)" once two of
/// five are left out, and Remove takes the chosen ones off together, asking
/// first.
struct FrequentView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var list: FrequentList?
    @State private var suggestions: [FrequentSuggestion] = []
    @State private var failed: APIError?
    @State private var status = ""
    @State private var addingAll = false
    /// The rows left out; everything else is chosen, so an item put on the
    /// list later is chosen without anybody choosing it.
    @State private var left: Set<Int> = []
    @State private var confirmingRemove = false

    var body: some View {
        ShopPage(header: false, refresh: { await load() }) {
            AccountSection(title: l.t("frequent.section"), hint: l.t("account.hint.frequent")) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(l.t("frequent.intro"))
                        .font(.inter(14))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    content
                }
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private var content: some View {
        if let list {
            if !list.ready {
                Text(l.t("frequent.unavailable"))
                    .font(.inter(14))
                    .foregroundStyle(Brand.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
            } else {
                if list.items.isEmpty {
                    EmptyStateView(systemImage: "list.bullet.rectangle", title: l.t("frequent.emptyTitle"), note: l.t("frequent.emptyNote"))
                        .card(padding: 0)
                } else {
                    let chosenItems = list.items.filter { !left.contains($0.id) }
                    let canAdd = chosenItems.contains { addable($0) > 0 }
                    FlowLayout(spacing: 8) {
                        ChoiceAll(state: chosenItems.isEmpty ? .none : chosenItems.count == list.items.count ? .all : .some) { all in
                            left = all ? [] : Set(list.items.map(\.id))
                        }
                        Button {
                            Task { await addAll(chosenItems) }
                        } label: {
                            Label(chosenItems.count == list.items.count ? l.t("frequent.addAll") : l.t("frequent.addChosen", ["count": "\(chosenItems.count)"]), systemImage: "bag")
                                .padding(.horizontal, 18)
                                .frame(minHeight: 44)
                        }
                        .buttonStyle(AddToCartStyle())
                        .disabled(addingAll || !canAdd)
                        .opacity(addingAll || !canAdd ? 0.5 : 1)
                        .fixedSize()
                        if !chosenItems.isEmpty {
                            ChoicePill(title: l.t("frequent.removeChosen", ["count": "\(chosenItems.count)"])) {
                                confirmingRemove = true
                            }
                        }
                        if !status.isEmpty {
                            Button(l.t("product.viewCart")) { app.selectedTab = .cart }
                                .font(.inter(14, .semibold))
                                .foregroundStyle(Brand.navy)
                                .buttonStyle(.tap)
                                .frame(minHeight: 44)
                                .fixedSize()
                        }
                    }
                    .alert(l.t("frequent.removeChosenTitle"), isPresented: $confirmingRemove) {
                        Button(l.t("frequent.removeChosen", ["count": "\(chosenItems.count)"]), role: .destructive) {
                            Task { await removeChosen(chosenItems.map(\.id)) }
                        }
                        Button(l.t("common.cancel"), role: .cancel) {}
                    } message: {
                        Text(l.t("frequent.removeChosenBody"))
                    }
                    VStack(spacing: 0) {
                        ForEach(Array(list.items.enumerated()), id: \.element.id) { index, item in
                            if index > 0 { DashedRule() }
                            FrequentRow(
                                item: item,
                                inBag: inBag(item.variantId),
                                chosen: !left.contains(item.id),
                                choose: { chosen in if chosen { left.remove(item.id) } else { left.insert(item.id) } },
                                changed: { Task { await load() } },
                                added: { status = l.t("frequent.allAdded") }
                            )
                        }
                    }
                    .padding(.horizontal, 16)
                    .panel()
                }
                if !status.isEmpty {
                    Text(status)
                        .font(.inter(14))
                        .foregroundStyle(Brand.success)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                if !suggestions.isEmpty {
                    FrequentSuggestions(entries: suggestions) { Task { await load() } }
                }
            }
        } else if let failed {
            ErrorStateView(error: failed) { await load() }
        } else {
            ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 160)
        }
    }

    private func inBag(_ variantId: String) -> Int {
        (app.cart.cart?.items ?? []).filter { $0.variantId == variantId }.reduce(0) { $0 + $1.quantity }
    }

    private func addable(_ item: FrequentEntry) -> Int {
        guard FrequentRules.state(item.product, variantId: item.variantId) == .ready,
              let variant = item.product?.variants.first(where: { $0.id == item.variantId }) else { return 0 }
        return FrequentRules.addable(usual: item.quantity, maxQuantity: variant.maxQuantity, inBag: inBag(item.variantId))
    }

    private func addAll(_ items: [FrequentEntry]) async {
        let ready = items.filter { addable($0) > 0 }
        guard !ready.isEmpty else { return }
        addingAll = true
        defer { addingAll = false }
        var refused = false
        for item in ready {
            let took = await app.cart.add(variantId: item.variantId, quantity: addable(item), product: item.product)
            if !took { refused = true }
        }
        if refused {
            Haptics.refused()
            app.toast(l.t("cart.updateFailed"))
            return
        }
        Haptics.succeeded()
        let skipped = items.contains { FrequentRules.state($0.product, variantId: $0.variantId) != .ready }
        status = l.t("frequent.allAdded") + (skipped ? " " + l.t("frequent.someSkipped") : "")
        UIAccessibility.post(notification: .announcement, argument: status)
    }

    /// The chosen rows off the list, one call each, then the list read again.
    private func removeChosen(_ ids: [Int]) async {
        do {
            for id in ids { _ = try await app.services.api.call(API.frequentRemove, .init(id: id)) }
            app.toast(l.t("frequent.removedChosen"))
        } catch {
            Haptics.refused()
            app.toast(l.t(APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)))
        }
        left = []
        await load()
    }

    private func load() async {
        do {
            let locale = API.LocaleOnly(locale: l.current.rawValue)
            list = try await app.services.api.call(API.frequentList, locale)
            failed = nil
            suggestions = (try? await app.services.api.call(API.frequentSuggestions, locale)) ?? []
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, list == nil { failed = failure }
        }
    }
}

/// One item: its photo and name, the usual amount, Add to cart and the bin.
private struct FrequentRow: View {
    let item: FrequentEntry
    let inBag: Int
    /// Whether the row is in what Add to cart and Remove act on.
    let chosen: Bool
    let choose: (Bool) -> Void
    let changed: () -> Void
    let added: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var quantity: Int
    @State private var done = false
    @State private var confirming = false
    @State private var saving: Task<Void, Never>?

    init(item: FrequentEntry, inBag: Int, chosen: Bool, choose: @escaping (Bool) -> Void, changed: @escaping () -> Void, added: @escaping () -> Void) {
        self.item = item
        self.inBag = inBag
        self.chosen = chosen
        self.choose = choose
        self.changed = changed
        self.added = added
        _quantity = State(initialValue: item.quantity)
    }

    private var variant: ProductVariant? { item.product?.variants.first { $0.id == item.variantId } }
    private var state: FrequentRules.State { FrequentRules.state(item.product, variantId: item.variantId) }
    private var title: String { item.product?.title ?? l.t("frequent.gone") }
    /// What one press adds follows the amount on screen, not the one last saved.
    private var addable: Int {
        guard state == .ready, let variant else { return 0 }
        return FrequentRules.addable(usual: quantity, maxQuantity: variant.maxQuantity, inBag: inBag)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                ChoiceCircle(state: chosen ? .all : .none, label: l.t("select.item", ["name": title]), toggle: choose)
                    .padding(.horizontal, -12)
                    .frame(height: 72)
                Button {
                    if let product = item.product { app.push(.product(handle: product.handle)) }
                } label: {
                    RemoteImage(reference: item.product?.images.first?.url, contentMode: .fit)
                        .frame(width: 72, height: 72)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.photo))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                }
                .buttonStyle(.tap)
                .disabled(item.product == nil)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.inter(15, .bold))
                        .foregroundStyle(item.product == nil ? Brand.muted : Brand.navy)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if let variant {
                        Text(details(variant))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                    }
                    if state == .soldOut {
                        Text(l.t("product.soldOut")).font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
                    } else if state == .ready && addable == 0 {
                        Text(l.t("frequent.noRoom")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    confirming = true
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 16))
                        .foregroundStyle(Brand.muted)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("frequent.remove"))
            }
            if state != .gone {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) {
                        amount
                        Spacer(minLength: 8)
                        addButton
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        amount
                        addButton
                    }
                }
            }
        }
        .padding(.vertical, 14)
        .alert(l.t("frequent.removeTitle", ["title": title]), isPresented: $confirming) {
            Button(l.t("frequent.removeConfirm"), role: .destructive) { Task { await remove() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("frequent.removeBody"))
        }
    }

    private var amount: some View {
        HStack(spacing: 8) {
            Text(l.t("frequent.usual"))
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.ink)
                .accessibilityHidden(true)
            QuantityStepper(quantity: quantity, maximum: ReferenceData.shared.rules.maxLineQuantity, name: title, compact: true, removes: false) { next in
                quantity = FrequentRules.quantity(next)
                save()
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("frequent.usualOf", ["title": title]))
        }
    }

    @ViewBuilder
    private var addButton: some View {
        if state == .soldOut, let product = item.product, !product.isAvailable {
            // Nothing of it can be bought: a reminder for when it is back.
            StockReminderButton(product: product, style: .bar)
        } else {
            plainAddButton
        }
    }

    private var plainAddButton: some View {
        Button {
            Task { await add() }
        } label: {
            AddToCartLabel(title: l.t("product.addToCart"), done: done, iconSize: 14)
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
        }
        .buttonStyle(AddToCartStyle(done: done, size: 14))
        .disabled(state != .ready || addable == 0)
        .opacity(state != .ready || addable == 0 ? 0.45 : 1)
        .accessibilityLabel(l.t("frequent.addToCartOf", ["title": title]))
    }

    private func details(_ variant: ProductVariant) -> String {
        let price = l.price(variant.price)
        return variant.title == "Default" || variant.title.isEmpty ? price : "\(variant.title) · \(price)"
    }

    /// The usual amount is the account's: kept once the presses stop, so five quick presses are one write.
    private func save() {
        saving?.cancel()
        let value = quantity
        saving = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            do {
                _ = try await app.services.api.call(API.frequentSetQuantity, .init(id: item.id, quantity: value))
            } catch {
                say(error)
            }
        }
    }

    private func add() async {
        guard let variant, addable > 0 else { return }
        if await app.cart.add(variantId: variant.id, quantity: addable, product: item.product) {
            withAnimation(.spring(duration: 0.3)) { done = true }
            added()
            try? await Task.sleep(for: .seconds(1.8))
            withAnimation(.spring(duration: 0.3)) { done = false }
        } else {
            Haptics.refused()
            app.toast(l.t("cart.updateFailed"))
        }
    }

    private func remove() async {
        do {
            _ = try await app.services.api.call(API.frequentRemove, .init(id: item.id))
            app.toast(l.t("frequent.removed"))
            changed()
        } catch {
            say(error)
        }
    }

    private func say(_ error: Error) {
        Haptics.refused()
        let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
        app.toast(l.t(key))
    }
}

/// What the shopper has bought before and not put on the list — each one press away from it.
private struct FrequentSuggestions: View {
    let entries: [FrequentSuggestion]
    let changed: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var adding: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("frequent.suggestTitle"))
                .font(.inter(17, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
                .padding(.top, 8)
            Text(l.t("frequent.suggestNote"))
                .font(.inter(13))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 0) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { DashedRule() }
                    row(entry)
                }
            }
            .padding(.horizontal, 16)
            .panel()
        }
    }

    private func row(_ entry: FrequentSuggestion) -> some View {
        let variant = entry.product.variants.first { $0.id == entry.variantId }
        var line: [String] = []
        if let variant {
            if variant.title != "Default", !variant.title.isEmpty { line.append(variant.title) }
            line.append(l.price(variant.price))
        }
        line.append(l.t("frequent.boughtTimes", ["count": "\(entry.timesBought)"]))
        return HStack(spacing: 12) {
            RemoteImage(reference: entry.product.images.first?.url, contentMode: .fit)
                .frame(width: 56, height: 56)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.photo))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.product.title)
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(2)
                Text(line.joined(separator: " · "))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                Task { await add(entry) }
            } label: {
                Text(l.t("frequent.add"))
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 16)
                    .frame(minHeight: 40)
                    .liquidGlass(.clear)
            }
            .buttonStyle(.action)
            .disabled(adding == entry.id)
            .accessibilityLabel(l.t("frequent.addOf", ["title": entry.product.title]))
        }
        .padding(.vertical, 12)
    }

    private func add(_ entry: FrequentSuggestion) async {
        guard let productId = Int(entry.productId), let variantId = Int(entry.variantId) else { return }
        adding = entry.id
        defer { adding = nil }
        do {
            _ = try await app.services.api.call(API.frequentAdd, .init(productId: productId, variantId: variantId, quantity: entry.lastQuantity))
            app.toast(l.t("frequent.addedToList"))
            changed()
        } catch {
            Haptics.refused()
            app.toast(l.t(APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)))
        }
    }
}
