import SwiftUI

/// What is open over the order — a sheet, and which items it is about: for
/// one item chosen that item (`lineId`), for several those items (`lineIds`);
/// cancelling opens the change at none (`remove`).
struct OrderSheet: Identifiable, Hashable {
    enum Kind: String { case track, refund, warranty, modify, address, payment, help }
    let kind: Kind
    var lineId: Int? = nil
    var lineIds: [Int]? = nil
    var remove = false
    var id: String { "\(kind.rawValue)-\(lineId ?? 0)-\((lineIds ?? []).map(String.init).joined(separator: "."))-\(remove)" }
}

/// The opened order as an after-sales centre, on the owner's word — the
/// web's `OrderAfterSales`: only the actions this order offers now. **An
/// item's acts are the bar's, once its circle is chosen** (`ChosenItemsBar`,
/// `OrderSelection`); each item had a ⋯ of its own for a while, and the owner
/// asked for it to go once the circles came ("you can control from selecting
/// the product"), and then for the order's own ⋯ to go too ("when you select
/// all, it should show you all the options"): with every item chosen the bar
/// also offers the order's change form, its address, its way to pay, its
/// receipt and cancelling it. This view keeps the All circle, the sheets those
/// acts open and the question before cancelling.
///
/// Nothing here decides: cancelling is the server's `cancel`, changing it is
/// `change` and `changeAddress`, what may go back is each line's return window
/// (the administrator's figure), a warranty claim each line's eligibility, and
/// the steps are `stepsForOrder`'s — and the server asks every one again under
/// a lock when it is pressed.
struct OrderActionsBar: View {
    let reference: String
    let detail: OrderDetail
    let reload: () async -> Void
    /// The sheet over the order, shared with the bar of the chosen items.
    @Binding var sheet: OrderSheet?
    /// Make the order's receipt as a PDF (`OrderReceiptPDF`).
    var onReceipt: (() -> Void)? = nil
    /// Rate one item, in its sheet.
    var onRate: ((OrderLine) -> Void)? = nil
    /// The items chosen by their circles (on the owner's word): the All circle
    /// beside "In this order" chooses every one.
    var chosen: Binding<Set<Int>>? = nil
    /// "Cancel this order?" — asked from the bar's Cancel order, with every
    /// item chosen, or from an answer of NetLet AI.
    var askingCancel: Binding<Bool>? = nil
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    /// What an answer from NetLet AI pointed at, opened once the help sheet is down.
    @State private var next: String?
    @State private var askingHere = false
    @State private var cancelling = false

    private var asking: Binding<Bool> { askingCancel ?? $askingHere }
    @State private var rebuying = false

    private var refundable: [OrderLine] { app.features.isOn("returns") ? detail.refundable : [] }
    private var claimable: [OrderLine] { app.features.isOn("returns") ? detail.warrantyClaimable : [] }
    private var trackable: Bool { detail.steps.map { !$0.cancelled } ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                HStack(spacing: 0) {
                    // Every item at once, the cart's All; its circle lines up with the items' own.
                    if let chosen {
                        let all = detail.lines.map(\.id)
                        ChoiceCircle(state: OrderSelection.state(all: all, chosen: chosen.wrappedValue), label: l.t("orders.chooseAllItems")) { on in
                            chosen.wrappedValue = on ? Set(all) : []
                        }
                        .padding(.leading, -12)
                    }
                    Text(l.t("orders.inThisOrder"))
                        .font(.inter(15, .heavy))
                        .foregroundStyle(Brand.navy)
                        .accessibilityAddTraits(.isHeader)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            // The bar is the one way to the order's acts (on the owner's word):
            // said while nothing is chosen.
            if let chosen, chosen.wrappedValue.isEmpty {
                Text(l.t("orders.chooseHint"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, -6)
            }
            if let why = detail.cancelRefusal {
                Text(l.t(why))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            // Paid online (0086), and the code the driver scans at the door.
            if let paid = detail.paymentChange.paidOnline { PaidOnlineNote(paid: paid) }
            if let handover = detail.handover {
                HandoverCard(handover: handover, paidOnline: detail.paymentChange.paidOnline != nil, owed: detail.owedNow ?? detail.order.grandTotal)
            }
            WarrantyClaimsList(detail: detail, reload: reload)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(item: $sheet, onDismiss: openNext) { which in
            sheetContent(which).languageDirection()
        }
        .onAppear {
            // The screenshots' hooks (`track:`, `refund:`, `warranty:`…); `rate` is the order's own.
            guard let asked = app.orderSheet, asked != "rate", let kind = OrderSheet.Kind(rawValue: asked) else { return }
            app.orderSheet = nil
            if offers(kind) { sheet = OrderSheet(kind: kind) }
        }
        .alert(l.t("orders.cancelAsk"), isPresented: asking) {
            Button(l.t("orders.cancelOrder"), role: .destructive) { Task { await cancel() } }
            Button(l.t("orders.keepOrder"), role: .cancel) {}
        } message: {
            Text(l.t("orders.cancelBody"))
        }
    }

    /// What the sheet over the order draws, for which act and which item.
    @ViewBuilder
    private func sheetContent(_ which: OrderSheet) -> some View {
        switch which.kind {
        case .track:
            if let steps = detail.steps {
                TrackOrderSheet(reference: reference, steps: steps, lines: detail.lines, lineId: which.lineId, lineIds: which.lineIds)
            }
        case .refund:
            RefundSheet(
                reference: reference,
                lines: which.lineIds.map { ids in refundable.filter { ids.contains($0.id) } } ?? refundable,
                initial: which.lineIds,
                done: { done() }
            )
        case .warranty:
            WarrantySheet(reference: reference, detail: detail, lineId: which.lineId, lineIds: which.lineIds, done: { done() })
        case .modify:
            OrderModifySheet(reference: reference, detail: detail, lineId: which.lineId, lineIds: which.lineIds, remove: which.remove, done: { done() })
        case .address:
            OrderAddressSheet(reference: reference, detail: detail, done: { Task { await reload() } })
        case .payment:
            OrderPaymentSheet(reference: reference, detail: detail, done: { Task { await reload() } })
        case .help:
            OrderHelpSheet(
                reference: reference,
                items: detail.lines.map { line in
                    SelfHelpAnswer.Item(
                        id: line.id,
                        title: line.productTitle,
                        variant: line.variantTitle == "Default" ? nil : line.variantTitle,
                        photo: line.photo,
                        fulfilment: line.fulfilment,
                        variantId: line.variantId,
                        quantity: line.quantity
                    )
                },
                lineId: which.lineId,
                reload: { await reload() }
            ) { action, line in
                next = action
                sheetLine = line ?? which.lineId
            }
        }
    }

    private func open(_ kind: OrderSheet.Kind) {
        Haptics.action()
        sheet = OrderSheet(kind: kind)
    }

    /// What was done is done with the items it was about: the choice goes too.
    private func done() {
        if let chosen { chosen.wrappedValue = [] }
        Task { await reload() }
    }

    /// Whether this order offers what a sheet is for — a hook or an answer
    /// pointing at something the order no longer has opens nothing.
    private func offers(_ kind: OrderSheet.Kind) -> Bool {
        switch kind {
        case .track: return trackable
        case .refund: return !refundable.isEmpty
        case .warranty: return !claimable.isEmpty
        case .modify: return detail.mayModify
        case .address: return detail.changeAddress.changeable
        case .payment: return detail.paymentChange.open
        case .help: return true
        }
    }

    /// An answer from NetLet AI pointed at a panel or an act; it runs once the
    /// help sheet is down, so two sheets are never asked for at once — about
    /// the item it was asked from, when it was.
    private func openNext() {
        guard let action = next else { return }
        next = nil
        let item = detail.lines.first { $0.id == sheetLine }
        sheetLine = nil
        switch action {
        case "cancel": if detail.cancel.cancellable { asking.wrappedValue = true }
        case "buyAgain": Task { await buyAgain() }
        case "rate":
            if let line = item ?? detail.lines.first(where: \.mayRate) { onRate?(line) }
        case "track", "refund", "warranty", "modify", "address":
            let kind: OrderSheet.Kind = action == "track" ? .track : action == "refund" ? .refund : action == "warranty" ? .warranty : action == "modify" ? .modify : .address
            if offers(kind) { sheet = OrderSheet(kind: kind, lineId: kind == .address || kind == .refund ? nil : item?.id) }
        default: return
        }
    }

    /// The item the help sheet was opened from, kept for what its answer points at.
    @State private var sheetLine: Int?

    private func cancel() async {
        cancelling = true
        defer { cancelling = false }
        await app.attempt(done: "orders.cancelDone") {
            _ = try await app.services.api.call(API.cancelOrder, .init(reference: reference))
        }
        await reload()
    }

    /// Everything on the order still for sale back in the bag at today's
    /// price, naming what could not be.
    private func buyAgain() async {
        rebuying = true
        defer { rebuying = false }
        do {
            let answer = try await app.services.api.call(API.buyAgain, .init(reference: reference, cartId: app.cart.cartId))
            if let id = answer.cartId, id != app.cart.cartId {
                await app.cart.adopt(cartId: id)
            } else {
                await app.cart.restore()
            }
            guard answer.added > 0 else {
                Haptics.refused()
                app.toast(l.t("orders.buyAgainNone"))
                return
            }
            Haptics.succeeded()
            var said = l.t("orders.buyAgainDone", ["count": "\(answer.added)"])
            if !answer.skipped.isEmpty {
                said += "\n" + l.t("orders.buyAgainSkipped", ["items": answer.skipped.map(\.title).joined(separator: ", ")])
            }
            app.toast(said)
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            if failure != .cancelled { app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has))) }
        }
    }
}

/// A pill that sizes to its words: white with a light rim, navy words — the
/// web's `glass` pill — and the shop's red for cancelling.
struct OrderActionStyle: ButtonStyle {
    var danger = false
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(14, .semibold))
            .foregroundStyle(danger ? Brand.danger : Brand.navy)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .liquidGlass(.clear, enabled: isEnabled, pressed: configuration.isPressed)
            .opacity(isEnabled ? 1 : 0.5)
            .pressHaptic(configuration.isPressed)
    }
}

/// "Track your order": each parcel as four steps, the store's estimate under
/// it, and the driver on the map while one is on the road.
struct TrackOrderSheet: View {
    let reference: String
    let steps: OrderSteps
    let lines: [OrderLine]
    /// For one item: the parcel that item is in.
    var lineId: Int? = nil
    /// From the bar over the chosen items: the parcels they are in.
    var lineIds: [Int]? = nil
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    private var parcels: [ParcelSteps] {
        guard let about = lineId.map({ [$0] }) ?? lineIds else { return steps.parcels }
        return steps.parcels.filter { parcel in parcel.lineIds.contains { about.contains($0) } }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if parcels.count > 1 {
                        Text(l.t("track.parcelCount", ["count": "\(parcels.count)"]))
                            .font(.inter(13, .semibold))
                            .foregroundStyle(Brand.muted)
                    }
                    ForEach(parcels) { parcel in
                        ParcelStepsCard(parcel: parcel, placedAt: steps.placedAt, lines: lines)
                    }
                    if parcels.contains(where: { $0.promise != nil && $0.promise?.kind != "madeToOrder" }) {
                        Text(l.t("track.estimate"))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if parcels.contains(where: { $0.step == "onTheWay" }) {
                        TrackingPanel(reference: reference)
                    }
                }
                .padding(16)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("track.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

/// Where one parcel is, drawn as the web's `ParcelTracker`, on the owner's word
/// ("enhance the tracking order UI, make it better"): the items in it by their
/// photos, where it is now in large type with the store's estimate under it,
/// and the four steps as one row of pictures — the order, the box, the van,
/// the house — the ones behind it navy, the one it is at in the brand's orange
/// with a ring spreading from it, the road on to the house a moving dash
/// while it is on the way, the house green once it has arrived. Only facts
/// are dated. Still under Reduce Motion.
struct ParcelStepsCard: View {
    let parcel: ParcelSteps
    let placedAt: Date
    let lines: [OrderLine]
    @Environment(LanguageSettings.self) private var l

    private static let labels = ["track.placed", "track.preparing", "track.onTheWay", "track.delivered"]
    private static let symbols = ["doc.text.fill", "shippingbox.fill", "truck.box.fill", "house.fill"]
    /// How many of a parcel's items are drawn by their photos before a "+N".
    private static let photos = 3

    private var arrived: Bool { parcel.step == "delivered" }

    var body: some View {
        let inside = parcel.lineIds.compactMap { id in lines.first { $0.id == id } }
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                photoStack(inside)
                VStack(alignment: .leading, spacing: 3) {
                    Text(parcel.vendorName.map { l.t("track.from", ["store": "\u{2068}\($0)\u{2069}"]) } ?? l.t("track.parcel"))
                        .font(.inter(14, .heavy))
                        .foregroundStyle(Brand.navy)
                        .fixedSize(horizontal: false, vertical: true)
                    if !inside.isEmpty {
                        Text(inside.map(\.productTitle).joined(separator: " · "))
                            .font(.inter(12))
                            .foregroundStyle(Brand.muted)
                            .lineLimit(1)
                    }
                    if parcel.fast || parcel.destinationLabel != nil {
                        HStack(spacing: 8) {
                            if parcel.fast {
                                Label(l.t("track.fast"), systemImage: "bolt.fill")
                                    .font(.inter(12, .bold))
                                    .foregroundStyle(Brand.accentInk)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 2)
                                    .background(Capsule().fill(Brand.accentWash))
                            }
                            if let label = parcel.destinationLabel {
                                Label(l.t("track.to", ["label": "\u{2068}\(label)\u{2069}"]), systemImage: "mappin")
                                    .font(.inter(12, .semibold))
                                    .foregroundStyle(Brand.navy)
                            }
                        }
                        .padding(.top, 2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            status
            HStack(alignment: .top, spacing: 0) {
                ForEach(0..<Self.labels.count, id: \.self) { index in
                    stepColumn(index)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    /// The items by their photos: how a parcel is recognised.
    private func photoStack(_ inside: [OrderLine]) -> some View {
        let shown = inside.count > Self.photos ? Array(inside.prefix(Self.photos - 1)) : inside
        return HStack(spacing: -12) {
            ForEach(shown) { line in
                Color.white
                    .frame(width: 44, height: 44)
                    .overlay { RemoteImage(reference: line.photo) }
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(Color.white, lineWidth: 2))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1).padding(-1))
            }
            if inside.count > Self.photos {
                Text("+\(inside.count - (Self.photos - 1))")
                    .font(.inter(12, .heavy))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Brand.navy))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(Color.white, lineWidth: 2))
            }
        }
        .accessibilityHidden(true)
    }

    /// Where it is now, in words, and when the store says it comes.
    private var status: some View {
        let promise = arrived ? nil : promiseLine
        let headline = arrived
            ? (parcel.deliveredAt.map { l.t("track.deliveredOn", ["date": DeliveryLine.shortDay($0, l.current)]) } ?? l.t("track.delivered"))
            : l.t(Self.labels[min(max(parcel.reached, 0), Self.labels.count - 1)])
        return VStack(alignment: .leading, spacing: 2) {
            Text(headline)
                .font(.inter(18, .heavy))
                .foregroundStyle(arrived ? Brand.success : Brand.navy)
            if let promise {
                Text(promise.text)
                    .font(.inter(13, .semibold))
                    .foregroundStyle(promise.late ? Brand.accentInk : Brand.success)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(arrived ? Brand.successFill : promise?.late == true ? Brand.accentWash : Brand.tint))
        .accessibilityElement(children: .combine)
    }

    /// One step: its picture on the road, its name, and its date where that is a fact.
    private func stepColumn(_ index: Int) -> some View {
        let reached = parcel.reached
        let done = index < reached || (index == reached && arrived)
        let now = index == reached && !done
        let last = index == Self.labels.count - 1
        let label = l.t(Self.labels[index])
        var day: String?
        if index == 0 {
            day = DeliveryLine.shortDay(placedAt, l.current)
        } else if last, let at = parcel.deliveredAt {
            day = DeliveryLine.shortDay(at, l.current)
        }
        let date = day
        let state = l.t(done ? "track.stepDone" : now ? "track.stepNow" : "track.stepNext", ["step": label])
        return VStack(spacing: 6) {
            ZStack {
                // The road: this step's half of the way in from the one before, and out to the next.
                HStack(spacing: 0) {
                    TrackRoad(state: index == 0 ? .blank : road(into: index))
                    TrackRoad(state: last ? .blank : road(into: index + 1))
                }
                .frame(height: 3)
                TrackStepDot(symbol: Self.symbols[index], done: done, now: now, home: last)
            }
            .frame(height: 36)
            Text(label)
                .font(.inter(12, now ? .heavy : done ? .bold : .semibold))
                .foregroundStyle(now || done ? Brand.navy : Brand.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 2)
            if let date {
                Text(date)
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(date.map { "\(state), \($0)" } ?? state)
        .accessibilityAddTraits(now ? .isSelected : [])
    }

    /// The road into a step: travelled, being travelled, or still ahead.
    private func road(into index: Int) -> TrackRoad.State {
        if index <= parcel.reached { return .travelled }
        if index == parcel.reached + 1 && parcel.step == "onTheWay" { return .moving }
        return .ahead
    }

    /// The seller's word on when, said as theirs.
    private var promiseLine: (text: String, late: Bool)? {
        guard let promise = parcel.promise else { return nil }
        switch promise.kind {
        case "madeToOrder":
            return (l.t("track.madeToOrder"), false)
        case "preorder":
            return (promise.at.map { l.t("track.preorder", ["date": DeliveryLine.shortDay($0, l.current)]) } ?? l.t("track.preorderOpen"), false)
        default:
            guard let from = promise.from, let to = promise.to else { return nil }
            let last = DeliveryLine.shortDay(to, l.current)
            if promise.late == true { return (l.t("track.late", ["date": last]), true) }
            let first = DeliveryLine.shortDay(from, l.current)
            return (first == last ? l.t("track.expectedOn", ["date": first]) : l.t("track.expected", ["from": first, "to": last]), false)
        }
    }
}

/// A step's picture: navy once passed, the brand's orange with a ring
/// spreading from it where the parcel is, pale ahead — the house green once
/// the parcel is there.
private struct TrackStepDot: View {
    let symbol: String
    let done: Bool
    let now: Bool
    let home: Bool
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var spread = false

    var body: some View {
        ZStack {
            if now {
                Circle()
                    .stroke(Brand.orange, lineWidth: 2)
                    .scaleEffect(spread ? 1.6 : 1)
                    .opacity(spread ? 0 : 0.75)
            }
            Circle().fill(done ? (home ? Brand.success : Brand.navy) : now ? Brand.orange : Brand.photo)
            if !done && !now { Circle().strokeBorder(Brand.cardLine, lineWidth: 1) }
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(done ? Color.white : now ? Brand.navy : Brand.chevron)
                .flipsForRightToLeftLayoutDirection(symbol.hasPrefix("truck"))
        }
        .frame(width: 36, height: 36)
        .onAppear {
            guard now, !still else { return }
            withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) { spread = true }
        }
    }
}

/// Half the road between two steps. A Shape, so on the Arabic page it is
/// drawn mirrored and its dash moves toward the house there too.
private struct TrackRoad: View {
    enum State { case blank, travelled, moving, ahead }
    let state: State
    @Environment(\.accessibilityReduceMotion) private var still
    @SwiftUI.State private var phase: CGFloat = 0

    var body: some View {
        switch state {
        case .blank:
            Color.clear
        case .travelled:
            Rectangle().fill(Brand.navy)
        case .ahead:
            Rectangle().fill(Brand.line)
        case .moving:
            ZStack {
                Rectangle().fill(Brand.line)
                RoadDash(phase: phase).fill(Brand.navy)
            }
            .onAppear {
                guard !still else { return }
                withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) { phase = -28 }
            }
        }
    }
}

private struct RoadDash: Shape {
    var phase: CGFloat
    var animatableData: CGFloat {
        get { phase }
        set { phase = newValue }
    }

    /// The dashes themselves, so the phase is drawn on every frame of the animation.
    func path(in rect: CGRect) -> Path {
        var line = Path()
        line.move(to: CGPoint(x: rect.minX, y: rect.midY))
        line.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return line.strokedPath(StrokeStyle(lineWidth: rect.height, dash: [8, 6], dashPhase: phase))
    }
}

/// "Request a refund": which items, why, a note — one return request per item
/// with the refund chosen, each decided as the per-item form's is.
struct RefundSheet: View {
    let reference: String
    let lines: [OrderLine]
    /// The items chosen on the page, ticked to start.
    var initial: [Int]? = nil
    let done: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var chosen: Set<Int> = []
    @State private var reason = "damaged"
    @State private var note = ""
    @State private var problem: String?
    @State private var sending = false

    private var rules: Rules.Orders { ReferenceData.shared.rules.orderRules }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(l.t("orders.refundWhich")).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                    ForEach(lines) { line in
                        itemRow(line)
                    }
                    if let problem {
                        Text(problem).font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(l.t("returns.why")).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                        Menu {
                            ForEach(rules.returnReasons, id: \.self) { option in
                                Button {
                                    Haptics.tap()
                                    reason = option
                                } label: {
                                    if reason == option {
                                        Label(l.t(LineReturnPanel.reasonKey(option)), systemImage: "checkmark")
                                    } else {
                                        Text(l.t(LineReturnPanel.reasonKey(option)))
                                    }
                                }
                            }
                        } label: {
                            MenuField(text: l.t(LineReturnPanel.reasonKey(reason)), placeholder: l.t("returns.why"))
                        }
                    }
                    LabeledField(
                        label: l.t(reason == "other" ? "returns.noteRequired" : "returns.noteOptional"),
                        text: $note,
                        problem: note.count > rules.maxReturnNote ? l.t("ios.tooLong", ["max": "\(rules.maxReturnNote)"]) : nil,
                        axis: .vertical
                    )
                    Text(l.t("returns.howItWorks"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Button(l.t("orders.refundSend")) { Task { await send() } }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(sending || note.count > rules.maxReturnNote)
                }
                .padding(16)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("orders.requestRefund"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear {
            if let initial {
                chosen = Set(lines.map(\.id).filter { initial.contains($0) })
            } else if lines.count == 1 {
                chosen = [lines[0].id]
            }
        }
    }

    private func itemRow(_ line: OrderLine) -> some View {
        let on = chosen.contains(line.id)
        return Button {
            if on { chosen.remove(line.id) } else { chosen.insert(line.id) }
            problem = nil
        } label: {
            HStack(spacing: 12) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .font(.system(size: 22))
                    .foregroundStyle(on ? Brand.navy : Brand.line)
                Color.clear
                    .frame(width: 44, height: 44)
                    .overlay { RemoteImage(reference: line.photo) }
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(line.productTitle).font(.inter(14, .semibold)).foregroundStyle(Brand.ink).lineLimit(2)
                    if let variant = line.variantLabel {
                        Text(variant).font(.inter(13)).foregroundStyle(Brand.muted)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(minHeight: 56)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(on ? Brand.navy : Brand.cardLine, lineWidth: 1))
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func send() async {
        guard !chosen.isEmpty else {
            Haptics.refused()
            problem = l.t("orders.refundPickOne")
            return
        }
        let words = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if reason == "other" && words.isEmpty {
            Haptics.refused()
            app.toast(l.t("returns.needsReason"))
            return
        }
        sending = true
        defer { sending = false }
        var sent = 0
        for line in lines where chosen.contains(line.id) {
            let worked = await app.attempt {
                _ = try await app.services.api.call(API.requestReturn, .init(
                    reference: reference, orderItemId: line.id, kind: "refund", reason: reason, note: words.isEmpty ? nil : words
                ))
            }
            if worked { sent += 1 }
        }
        guard sent > 0 else { return }
        app.toast(l.t("orders.refundSent"))
        done()
        dismiss()
    }
}

/// What can be done with the items chosen on an opened order, on the owner's
/// word — the web's `ChosenBar`: every act they allow and none they do not
/// (`OrderSelection`), as a row of presses over the page's foot, each saying
/// how many of the chosen it is about when that is not all of them. The
/// screen runs what is pressed (`OrderDetailView.run`).
struct ChosenItemsBar: View {
    let detail: OrderDetail
    @Binding var chosen: Set<Int>
    let run: (OrderSelection.Offer) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        // The items' acts and the whole order's, whatever is chosen.
        let offers = OrderSelection.offers(detail, chosen: chosen, returnsOn: app.features.isOn("returns"))
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(l.t("orders.chosenCount", ["count": "\(chosen.count)"]))
                    .font(.inter(13, .heavy))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button {
                    chosen = []
                } label: {
                    Label(l.t("orders.chosenClear"), systemImage: "xmark")
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 34)
                        .liquidGlass(.frost)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                // Named for the tests apart from a sheet's own Close.
                .accessibilityIdentifier("chosen-close")
            }
            .padding(.leading, 8)
            .padding(.trailing, 2)
            // Rows of four that wrap, never a sideways scroll: every option
            // the chosen items have is in view at once (on the owner's word).
            GlassGroup {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 2, alignment: .top), count: 4), spacing: 4) {
                    ForEach(offers, id: \.action) { offer in
                        act(offer)
                    }
                }
                .padding(.horizontal, 2)
                .padding(.vertical, 2)
            }
        }
        .padding(8)
        // A pane of the tab bar's Liquid Glass, on the owner's word ("can you
        // make this Liquid Glass design?"): an even 70% with its rim, the
        // words on it navy and the cancel's a red deep enough for glass.
        .background(GlassPane(radius: 24))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("orders.chosenBar"))
    }

    /// One act: its picture on a disc of Liquid Glass — the shop's red under
    /// the cancel's, light glass under the rest — and its word under it.
    private func act(_ offer: OrderSelection.Offer) -> some View {
        let some = chosen.count > 1 && offer.lineIds.count < chosen.count
        let danger = offer.action == .cancelItems || offer.action == .cancelOrder
        return Button {
            run(offer)
        } label: {
            VStack(spacing: 5) {
                Image(systemName: Self.symbol(offer.action))
                    .font(.system(size: 17, weight: .semibold))
                    .flipsForRightToLeftLayoutDirection(offer.action == .track || offer.action == .return || offer.action == .refund)
                    .foregroundStyle(danger ? Color.white : Brand.navy)
                    .frame(width: 44, height: 44)
                    .liquidGlass(danger ? .danger : .frost, in: Circle())
                    .accessibilityHidden(true)
                Text(l.t(Self.key(offer)) + (some ? " (\(offer.lineIds.count))" : ""))
                    .font(.inter(12, .bold))
                    .foregroundStyle(danger ? Brand.dangerOnGlass : Brand.navy)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
    }

    /// Each act's picture.
    static func symbol(_ action: OrderSelection.Action) -> String {
        switch action {
        case .track: return "truck.box"
        case .return, .refund: return "arrow.uturn.backward"
        case .warranty: return "checkmark.shield"
        case .quantity: return "square.and.pencil"
        case .rate: return "star"
        case .buyAgain: return "bag"
        case .help: return "lifepreserver"
        case .cancelItems, .cancelOrder: return "xmark.circle"
        case .modify: return "square.and.pencil"
        case .address: return "mappin.and.ellipse"
        case .payment: return "creditcard"
        case .receipt: return "arrow.down.doc"
        }
    }

    /// Each act's word on the bar — short, for a row of them. Cancelling
    /// the chosen items says item or items, beside cancelling the order.
    static func key(_ offer: OrderSelection.Offer) -> String {
        offer.action == .cancelItems && offer.lineIds.count > 1 ? "orders.pickCancelItems" : key(offer.action)
    }

    static func key(_ action: OrderSelection.Action) -> String {
        switch action {
        case .track: return "orders.pickTrack"
        case .return: return "orders.pickReturn"
        case .refund: return "orders.pickRefund"
        case .warranty: return "orders.pickWarranty"
        case .quantity: return "orders.pickQuantity"
        case .rate: return "orders.pickRate"
        case .buyAgain: return "orders.pickBuyAgain"
        case .help: return "orders.pickHelp"
        case .cancelItems: return "orders.pickCancelItem"
        case .modify: return "orders.pickModify"
        case .address: return "orders.pickAddress"
        case .payment: return "orders.pickPayment"
        case .receipt: return "orders.pickReceipt"
        case .cancelOrder: return "orders.pickCancelOrder"
        }
    }
}
