import SwiftUI

/// Each store's delivery in the bag, beside its truck (migration 0085, on the
/// owner's word): where it goes, Standard or Express with the fee or Free
/// delivery in green, and the day chosen, the store's own band or "Choose a
/// day and time". A press opens a sheet of the store's delivery type, its
/// address, a day and a time of day, each applied at once through the bag's
/// queue (`CartModel.setStoreDelivery`), so the fee, free delivery and the
/// total move with it — the web's `StoreDeliveryRow` and `StoreDeliverySheet`.
///
/// What may be chosen is the server's answer (`Cart.stores`, decided by
/// `Shared/commerce/deliverySlots.ts`). Until 0085 is pasted (`slotsReady`
/// false) no day or time is drawn and the rest works.
struct StoreDeliveryRow: View {
    let group: BagGroup
    let store: CartStoreDelivery
    @State private var open = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let ready = app.cart.cart?.slotsReady == true
        let total = group.delivery.reduce(0) { $0 + $1.fee.fils }
        let free = total == 0
        let currency = group.delivery.first?.fee.currencyCode ?? "KWD"
        let fee = free ? l.t("storeDelivery.free") : l.t("storeDelivery.fee", ["fee": l.price(Money(fils: total, currencyCode: currency))])
        let kind = store.choice == "fast" ? l.t("storeDelivery.express") : store.choice == "mixed" ? l.t("storeDelivery.both") : l.t("storeDelivery.standard")
        // The day and time the shopper chose, when there is one.
        let chosen: String? = ready && store.slotState == "kept" ? store.slot.map { SlotWords.slot($0, l) } : nil
        let nudge = group.delivery.first { $0.toFree.map { !$0.isZero } ?? false }
        VStack(alignment: .leading, spacing: 4) {
            Button {
                open = true
            } label: {
                // One borderless line under the store's name, on the owner's
                // word: a small truck, "To Home · Standard · Free delivery",
                // and Change at the end. It was a tall rounded box of its own
                // in every store's card, which made a bag from three stores
                // read as the same box three times. The day chosen, or one no
                // longer offered, is a small line under it; the store's band
                // is checkout's to say.
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "truck.box")
                        .font(.system(size: 13, weight: .semibold))
                        .scaleEffect(x: l.current == .ar ? -1 : 1)
                        .foregroundStyle(free ? Brand.success : Brand.navy)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        (Text(destination + " · " + kind + " · ").foregroundColor(Brand.body)
                            + Text(fee).foregroundColor(free ? Brand.success : Brand.navy).bold())
                            .font(.inter(13, .semibold))
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .minimumScaleFactor(0.85)
                        if let chosen {
                            Text(chosen)
                                .font(.inter(12))
                                .foregroundStyle(Brand.muted)
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                        }
                        if ready, store.slotGone {
                            Text(l.t("storeDelivery.slotGone"))
                                .font(.inter(12, .bold))
                                .foregroundStyle(Brand.danger)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 2) {
                        Text(l.t("cart.change")).font(.inter(13, .bold))
                        Image(systemName: "chevron.forward").font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(Brand.navy)
                    .fixedSize()
                }
                .padding(.vertical, 4)
                // A thumb's height to press, drawn as one line.
                .frame(minHeight: 36)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 8))
            .accessibilityHint(l.t("storeDelivery.open", ["name": group.store.name(l.current)]))
            if let nudge, let toFree = nudge.toFree, let progress = BagGroup.freeProgress(nudge) {
                Text(l.t("cart.storeToFree", ["amount": l.price(toFree)]))
                    .font(.inter(12, .bold))
                    .foregroundStyle(Brand.accentInk)
                    .fixedSize(horizontal: false, vertical: true)
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(Brand.navy)
                    .accessibilityHidden(true)
            }
        }
        .opacity(app.cart.syncing ? 0.6 : 1)
        .onAppear {
            // The screenshots' `storeDelivery:<id>`: this store's sheet, up.
            if app.storeDeliveryOnOpen == store.vendorId {
                app.storeDeliveryOnOpen = nil
                open = true
            }
        }
        .sheet(isPresented: $open) {
            StoreDeliverySheet(group: group, vendorId: store.vendorId)
                .languageDirection()
                .buttonStyle(HapticDefaultStyle())
        }
    }

    /// "To Home", "To more than one address", or "To your address" with none named.
    private var destination: String {
        switch store.door {
        case .mixed:
            return l.t("storeDelivery.toSeveral")
        case let .saved(id):
            let label = app.cart.cart?.addresses?.first { $0.id == id }?.label ?? app.delivery.inUse?.label ?? ""
            return l.t("storeDelivery.to", ["label": label])
        case .order:
            if let label = app.delivery.inUse?.label { return l.t("storeDelivery.to", ["label": label]) }
            return l.t("storeDelivery.toYourAddress")
        }
    }
}

/// The store's delivery, all of it in one place: the type, the door, the day
/// and the time. Each press goes at once and is drawn ahead of the bag's
/// answer; a refusal says why and draws the bag's answer again.
private struct StoreDeliverySheet: View {
    let group: BagGroup
    let vendorId: Int
    @State private var ahead = API.StoreDeliveryChange()
    @State private var pickedDay: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        // Read from the bag each time, so a press shows the server's answer once it lands.
        let store = app.cart.cart?.stores?.first { $0.vendorId == vendorId }
        NavigationStack {
            ScrollView {
                if let store {
                    content(store)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 16)
                }
            }
            .background(Color.white)
            .navigationTitle(l.t("storeDelivery.title", ["name": group.store.name(l.current)]))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    BarButton(l.t("storeDelivery.done")) { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let store {
                    footer(store)
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onChange(of: store) { _, _ in ahead = API.StoreDeliveryChange() }
    }

    @ViewBuilder
    private func content(_ store: CartStoreDelivery) -> some View {
        let choice = ahead.choice ?? store.choice
        let door: CartStoreDelivery.Door = {
            switch ahead.door {
            case .order: return .order
            case let .saved(id): return .saved(id)
            case nil: return store.door
            }
        }()
        let slot: DeliverySlot? = ahead.slot ?? store.slot
        let day = pickedDay ?? slot?.date
        let main = app.delivery.inUse
        let others = (app.cart.cart?.addresses ?? []).filter { $0.id != main?.id }
        let ready = app.cart.cart?.slotsReady == true
        VStack(alignment: .leading, spacing: 22) {
            section(l.t("storeDelivery.typeHeading")) {
                radio(on: choice == "regular", symbol: "truck.box", title: l.t("storeDelivery.standard"), note: standardNote(store)) {
                    send(.init(choice: "regular"))
                }
                if let fast = store.fast {
                    let speed = fast.speed.map { " · " + l.t("speed.\($0)") } ?? ""
                    let price = app.cart.cart?.delivery.memberFree == true ? l.t("delivery.fastFreeMember") : l.price(fast.fee)
                    radio(on: choice == "fast", symbol: "bolt.fill", title: l.t("storeDelivery.express"), note: price + speed) {
                        send(.init(choice: "fast"))
                    }
                } else {
                    Text(l.t("storeDelivery.noExpress")).font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            section(l.t("storeDelivery.addressHeading")) {
                radio(on: door == .order || (main != nil && door == .saved(main!.id)), symbol: "mappin", title: l.t("address.orderAddress"), note: main?.label) {
                    send(.init(door: .order))
                }
                ForEach(others) { address in
                    radio(on: door == .saved(address.id), symbol: "mappin", title: address.label, note: nil) {
                        send(.init(door: .saved(address.id)))
                    }
                }
                if app.session.isSignedIn {
                    Button {
                        dismiss()
                        app.push(.addresses)
                    } label: {
                        Label(l.t("address.add"), systemImage: "plus")
                            .font(.inter(13, .bold))
                            .foregroundStyle(Brand.navy)
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.tap)
                } else {
                    Text(l.t("storeDelivery.signInForAddresses")).font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            if ready {
                if store.days.isEmpty {
                    Label(l.t("storeDelivery.noDays"), systemImage: "calendar")
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 14).fill(Brand.photo))
                } else {
                    section(l.t("storeDelivery.dayHeading"), symbol: "calendar") {
                        if store.slotGone && ahead.slot == nil {
                            Text(l.t("storeDelivery.slotGone")).font(.inter(12, .bold)).foregroundStyle(Brand.danger)
                        }
                        FlowLayout(spacing: 8) {
                            chip(on: day == nil, title: l.t("storeDelivery.anyDay")) { pick(nil, store, slot) }
                            ForEach(store.days, id: \.date) { entry in
                                chip(on: day == entry.date, title: SlotWords.day(entry.date, l)) { pick(entry.date, store, slot) }
                            }
                        }
                    }
                    if let day {
                        let open = store.days.first { $0.date == day }?.windows ?? []
                        section(l.t("storeDelivery.timeHeading"), symbol: "clock") {
                            HStack(spacing: 8) {
                                ForEach(SlotWords.windows, id: \.self) { window in
                                    chip(on: slot?.date == day && slot?.window == window,
                                         title: l.t("slot.\(window)"),
                                         note: l.t("slot.\(window)Hours"),
                                         disabled: !open.contains(window)) {
                                        send(.init(slot: .some(DeliverySlot(date: day, window: window))))
                                    }
                                }
                            }
                            if slot?.date != day {
                                Text(l.t("storeDelivery.pickTime")).font(.inter(12, .bold)).foregroundStyle(Brand.accentInk)
                            }
                            Text(l.t("storeDelivery.preferredNote"))
                                .font(.inter(12))
                                .foregroundStyle(Brand.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    private func footer(_ store: CartStoreDelivery) -> some View {
        let fee = group.delivery.reduce(0) { $0 + $1.fee.fils }
        let currency = group.delivery.first?.fee.currencyCode ?? "KWD"
        let slot: DeliverySlot? = ahead.slot ?? store.slot
        return VStack(spacing: 4) {
            Text(fee == 0 ? l.t("storeDelivery.free") : l.t("storeDelivery.fee", ["fee": l.price(Money(fils: fee, currencyCode: currency))]))
                .font(.inter(14, .heavy))
                .foregroundStyle(fee == 0 ? Brand.success : Brand.navy)
            if let slot, !store.slotGone {
                Text(l.t("storeDelivery.preferred", ["slot": SlotWords.slot(slot, l)]))
                    .font(.inter(12, .semibold))
                    .foregroundStyle(Brand.body)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func standardNote(_ store: CartStoreDelivery) -> String {
        let band = DeliveryLine.slowest(group.items.map(\.deliverySpeed)).map { " · " + l.t("speed.\($0)") } ?? ""
        guard let fee = store.standard.fee else { return l.t("storeDelivery.free") + band }
        if let over = store.standard.freeOver {
            return l.price(fee) + " · " + l.t("storeDelivery.freeOver", ["amount": l.price(over)]) + band
        }
        return l.price(fee) + band
    }

    /// A day pressed: the time already chosen goes with it while that day has it.
    private func pick(_ date: String?, _ store: CartStoreDelivery, _ slot: DeliverySlot?) {
        pickedDay = date
        guard let date else {
            send(.init(slot: .some(nil)))
            return
        }
        let open = store.days.first { $0.date == date }?.windows ?? []
        if let slot, open.contains(slot.window) {
            send(.init(slot: .some(DeliverySlot(date: date, window: slot.window))))
        }
    }

    private func send(_ change: API.StoreDeliveryChange) {
        var next = ahead
        if let choice = change.choice { next.choice = choice }
        if let door = change.door { next.door = door }
        if let slot = change.slot { next.slot = slot }
        ahead = next
        let app = self.app
        let l = self.l
        let vendorId = self.vendorId
        Task {
            if let refusal = await app.cart.setStoreDelivery(vendorId: vendorId, change) {
                ahead = API.StoreDeliveryChange()
                Haptics.refused()
                app.toast(l.t(refusal))
            }
        }
    }

    private func section<Content: View>(_ title: String, symbol: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).font(.system(size: 13, weight: .semibold)).accessibilityHidden(true) }
                Text(title).font(.inter(13, .heavy))
            }
            .foregroundStyle(Brand.navy)
            .accessibilityAddTraits(.isHeader)
            content()
        }
    }

    private func radio(on: Bool, symbol: String, title: String, note: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: on ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(on ? Brand.navy : Brand.line)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Label(title, systemImage: symbol)
                        .font(.inter(14, .heavy))
                        .foregroundStyle(Brand.navy)
                    if let note, !note.isEmpty {
                        Text(note)
                            .font(.inter(12))
                            .foregroundStyle(Brand.body)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 52)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(on ? Brand.tint : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? Brand.navy : Brand.line, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
    }

    private func chip(on: Bool, title: String, note: String? = nil, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 1) {
                Text(title).font(.inter(13, .bold))
                if let note { Text(note).font(.inter(11, .semibold)).opacity(0.8) }
            }
            .foregroundStyle(on ? Color.white : Brand.navy)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .frame(maxWidth: note == nil ? nil : .infinity)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(on ? Brand.navy : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? Brand.navy : Brand.line, lineWidth: 1))
        }
        .buttonStyle(.tap)
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// A chosen delivery day said one way everywhere — the cart, checkout and the
/// order: "Today, Evening 4 – 9pm", "Wed 19 Nov, Morning 9am – 12pm" (the web's
/// `useSlotWords`), on Kuwait's calendar.
enum SlotWords {
    static let windows = ["morning", "afternoon", "evening"]

    @MainActor
    static func day(_ date: String, _ l: LanguageSettings, now: Date = Date()) -> String {
        if date == StoreRules.kuwaitDay(now) { return l.t("storeDelivery.today") }
        if date == StoreRules.kuwaitDay(now.addingTimeInterval(86_400)) { return l.t("storeDelivery.tomorrow") }
        let reader = DateFormatter()
        reader.dateFormat = "yyyy-MM-dd"
        reader.locale = Locale(identifier: "en_US_POSIX")
        reader.timeZone = DeliveryLine.kuwait
        guard let parsed = reader.date(from: date) else { return date }
        return DeliveryLine.shortDay(parsed.addingTimeInterval(12 * 3600), l.current)
    }

    @MainActor
    static func slot(_ slot: DeliverySlot, _ l: LanguageSettings) -> String {
        let window = windows.contains(slot.window) ? slot.window : "morning"
        return l.t("slot.line", ["day": day(slot.date, l), "window": l.t("slot.\(window)"), "hours": l.t("slot.\(window)Hours")])
    }
}
