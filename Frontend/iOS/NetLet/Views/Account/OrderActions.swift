import SwiftUI

/// What is open over the order — a sheet, and from an item's ⋯ the item it
/// is about (`lineId`); "Cancel this item" opens the change at none (`remove`).
struct OrderSheet: Identifiable, Hashable {
    enum Kind: String { case track, refund, warranty, modify, address, help }
    let kind: Kind
    var lineId: Int? = nil
    var remove = false
    var id: String { "\(kind.rawValue)-\(lineId ?? 0)-\(remove)" }
}

/// The opened order as an after-sales centre, on the owner's word — the
/// web's `OrderAfterSales`: only the actions this order offers now, **each
/// item's behind a ⋯ of its own** (`OrderLineMenu`, on the owner's word: "let
/// these options be in a 3 dot icon for each product. The user can select a
/// specific product with the options"), and what is about the whole order —
/// tracking every parcel, a refund across items, the warranty, changing the
/// address, modifying, buying everything again, help, cancelling — behind the
/// ⋯ beside "In this order". They were one row of pills over the items.
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
    /// The sheet over the order, shared with each item's ⋯.
    @Binding var sheet: OrderSheet?
    /// Rate one item, in its sheet.
    var onRate: ((OrderLine) -> Void)? = nil
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    /// What an answer from NetLet AI pointed at, opened once the help sheet is down.
    @State private var next: String?
    @State private var asking = false
    @State private var cancelling = false
    @State private var rebuying = false

    private var refundable: [OrderLine] { app.features.isOn("returns") ? detail.refundable : [] }
    private var claimable: [OrderLine] { app.features.isOn("returns") ? detail.warrantyClaimable : [] }
    private var trackable: Bool { detail.steps.map { !$0.cancelled } ?? false }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(l.t("orders.inThisOrder"))
                    .font(.inter(15, .heavy))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Menu {
                    if trackable {
                        Button { open(.track) } label: { Label(l.t("orders.track"), systemImage: "shippingbox") }
                    }
                    if !refundable.isEmpty {
                        Button { open(.refund) } label: { Label(l.t("orders.requestRefund"), systemImage: "arrow.uturn.backward") }
                    }
                    if !claimable.isEmpty {
                        Button { open(.warranty) } label: { Label(l.t("warranty.title"), systemImage: "checkmark.shield") }
                    }
                    if detail.changeAddress.changeable {
                        Button { open(.address) } label: { Label(l.t("orders.changeAddress"), systemImage: "mappin.and.ellipse") }
                    }
                    if detail.mayModify {
                        Button { open(.modify) } label: { Label(l.t("orders.modify"), systemImage: "square.and.pencil") }
                    }
                    if detail.mayBuyAgain {
                        Button { Haptics.action(); Task { await buyAgain() } } label: { Label(l.t("orders.buyAgainAll"), systemImage: "bag") }
                            .disabled(rebuying)
                    }
                    Button { open(.help) } label: { Label(l.t("orders.getHelp"), systemImage: "lifepreserver") }
                    if detail.cancel.cancellable {
                        Divider()
                        Button(role: .destructive) { Haptics.action(); asking = true } label: { Label(l.t("orders.cancelOrder"), systemImage: "xmark.circle") }
                            .disabled(cancelling)
                    }
                } label: {
                    OrderMenuFace()
                }
                .menuOrder(.fixed)
                .accessibilityLabel(l.t("orders.orderMenu"))
            }
            if let why = detail.cancelRefusal {
                Text(l.t(why))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            WarrantyClaimsList(detail: detail, reload: reload)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(item: $sheet, onDismiss: openNext) { which in
            switch which.kind {
            case .track:
                if let steps = detail.steps {
                    TrackOrderSheet(reference: reference, steps: steps, lines: detail.lines, lineId: which.lineId)
                }
            case .refund:
                RefundSheet(reference: reference, lines: refundable, done: { Task { await reload() } })
            case .warranty:
                WarrantySheet(reference: reference, detail: detail, lineId: which.lineId, done: { Task { await reload() } })
            case .modify:
                OrderModifySheet(reference: reference, detail: detail, lineId: which.lineId, remove: which.remove, done: { Task { await reload() } })
            case .address:
                OrderAddressSheet(reference: reference, detail: detail, done: { Task { await reload() } })
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
        .onAppear {
            // The screenshots' hooks (`track:`, `refund:`, `warranty:`…); `rate` is the order's own.
            guard let asked = app.orderSheet, asked != "rate", let kind = OrderSheet.Kind(rawValue: asked) else { return }
            app.orderSheet = nil
            if offers(kind) { sheet = OrderSheet(kind: kind) }
        }
        .alert(l.t("orders.cancelAsk"), isPresented: $asking) {
            Button(l.t("orders.cancelOrder"), role: .destructive) { Task { await cancel() } }
            Button(l.t("orders.keepOrder"), role: .cancel) {}
        } message: {
            Text(l.t("orders.cancelBody"))
        }
    }

    private func open(_ kind: OrderSheet.Kind) {
        Haptics.action()
        sheet = OrderSheet(kind: kind)
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
        case "cancel": if detail.cancel.cancellable { asking = true }
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

/// The ⋯ that opens a menu on the order page: a round 44-point target, the
/// web's `LinePopover` face.
struct OrderMenuFace: View {
    var body: some View {
        Image(systemName: "ellipsis")
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(Brand.navy)
            .frame(width: 36, height: 36)
            .background(Circle().fill(Brand.tint))
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
    }
}

/// One item's ⋯ — the web's `OrderLineMenu`: what can be done with this item
/// now, and nothing else. Track it, return or exchange it, claim its warranty,
/// change its quantity or cancel it while no driver has it, rate it, buy it
/// again, and get help with it.
struct OrderLineMenu: View {
    let line: OrderLine
    let detail: OrderDetail
    @Binding var sheet: OrderSheet?
    /// The item whose return form is open under it.
    @Binding var returning: Int?
    let rate: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let returnsOn = app.features.isOn("returns")
        let changeable = detail.change.changeable && line.changeable == true
        Menu {
            if detail.steps.map({ !$0.cancelled }) ?? false, line.fulfilment != "cancelled" {
                Button { open(.track) } label: { Label(l.t("orders.trackItem"), systemImage: "shippingbox") }
            }
            if returnsOn, detail.mayAskReturn(for: line) {
                Button { Haptics.action(); returning = line.id } label: { Label(l.t("returns.start"), systemImage: "arrow.uturn.backward") }
            }
            if returnsOn, line.warrantyEligibility?.allowed == true {
                Button { open(.warranty) } label: { Label(l.t("warranty.title"), systemImage: "checkmark.shield") }
            }
            if changeable, line.quantity > 1 {
                Button { open(.modify) } label: { Label(l.t("orders.changeQuantity"), systemImage: "square.and.pencil") }
            }
            if line.review != nil || line.mayRate {
                Button { Haptics.action(); rate() } label: { Label(l.t(line.review == nil ? "review.rateItem" : "review.edit"), systemImage: "star") }
            }
            if let variant = line.variantId {
                Button {
                    Haptics.action()
                    Task {
                        if await app.cart.add(variantId: String(variant), quantity: line.quantity) {
                            app.toast(l.t("cart.added", ["name": line.productTitle]))
                        } else {
                            Haptics.refused()
                            app.toast(l.t("orders.buyAgainNone"))
                        }
                    }
                } label: { Label(l.t("orders.buyAgain"), systemImage: "bag") }
            }
            Button { open(.help) } label: { Label(l.t("orders.helpItem"), systemImage: "lifepreserver") }
            if changeable {
                Divider()
                Button(role: .destructive) { open(.modify, remove: true) } label: { Label(l.t("orders.cancelItem"), systemImage: "xmark.circle") }
            }
        } label: {
            OrderMenuFace()
        }
        .menuOrder(.fixed)
        .accessibilityLabel(l.t("orders.lineMenu", ["name": line.productTitle]))
    }

    private func open(_ kind: OrderSheet.Kind, remove: Bool = false) {
        Haptics.action()
        sheet = OrderSheet(kind: kind, lineId: line.id, remove: remove)
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
            .background(Capsule().fill(configuration.isPressed ? Brand.pressFill : Color.white))
            .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
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
    /// From an item's ⋯: the parcel that item is in.
    var lineId: Int? = nil
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    private var parcels: [ParcelSteps] {
        guard let lineId else { return steps.parcels }
        return steps.parcels.filter { $0.lineIds.contains(lineId) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
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

/// One parcel's steps: placed, being prepared, on the way, delivered — dated
/// only where the date is a fact.
struct ParcelStepsCard: View {
    let parcel: ParcelSteps
    let placedAt: Date
    let lines: [OrderLine]
    @Environment(LanguageSettings.self) private var l

    private static let labels = ["track.placed", "track.preparing", "track.onTheWay", "track.delivered"]

    var body: some View {
        let names = parcel.lineIds.compactMap { id in lines.first { $0.id == id }?.productTitle }
        VStack(alignment: .leading, spacing: 4) {
            Text(parcel.vendorName.map { l.t("track.from", ["store": $0]) } ?? l.t("track.parcel"))
                .font(.inter(15, .bold))
                .foregroundStyle(Brand.navy)
            if !names.isEmpty {
                Text(names.joined(separator: " · "))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .lineLimit(2)
            }
            if parcel.fast || parcel.destinationLabel != nil {
                HStack(spacing: 10) {
                    if parcel.fast { Label(l.t("track.fast"), systemImage: "bolt.fill") }
                    if let label = parcel.destinationLabel { Text(l.t("track.to", ["label": label])) }
                }
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.navy)
            }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(Self.labels.enumerated()), id: \.offset) { index, key in
                    stepRow(index: index, label: l.t(key))
                }
            }
            .padding(.top, 8)
            if let promise = promiseLine {
                Text(promise.text)
                    .font(.inter(13, .semibold))
                    .foregroundStyle(promise.late ? Brand.accentInk : Brand.success)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    private func stepRow(index: Int, label: String) -> some View {
        let reached = parcel.reached
        let done = index < reached || (index == reached && parcel.step == "delivered")
        let now = index == reached && !done
        let last = index == Self.labels.count - 1
        var day: String?
        if index == 0 {
            day = DeliveryLine.shortDay(placedAt, l.current)
        } else if last, let arrived = parcel.deliveredAt {
            day = DeliveryLine.shortDay(arrived, l.current)
        }
        let date = day
        let state = l.t(done ? "track.stepDone" : now ? "track.stepNow" : "track.stepNext", ["step": label])
        return HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                ZStack {
                    if done {
                        Circle().fill(Brand.navy)
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy)).foregroundStyle(.white)
                    } else {
                        Circle().fill(Color.white)
                        Circle().strokeBorder(now ? Brand.navy : Brand.line, lineWidth: 2)
                        if now { Circle().fill(Brand.navy).frame(width: 8, height: 8) }
                    }
                }
                .frame(width: 20, height: 20)
                if !last {
                    Rectangle()
                        .fill(index < reached ? Brand.navy : Brand.line)
                        .frame(width: 2, height: 14)
                }
            }
            Text(label)
                .font(.inter(14, now ? .bold : done ? .semibold : .medium))
                .foregroundStyle(now || done ? Brand.navy : Brand.muted)
                .frame(minHeight: 20)
            Spacer(minLength: 8)
            if let date {
                Text(date).font(.inter(13)).foregroundStyle(Brand.muted).frame(minHeight: 20)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(date.map { "\(state), \($0)" } ?? state)
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

/// "Request a refund": which items, why, a note — one return request per item
/// with the refund chosen, each decided as the per-item form's is.
struct RefundSheet: View {
    let reference: String
    let lines: [OrderLine]
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
        .onAppear { if lines.count == 1 { chosen = [lines[0].id] } }
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
