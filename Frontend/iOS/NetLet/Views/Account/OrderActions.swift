import SwiftUI

/// What a shopper can do about an order, on the owner's word — the web's
/// `OrderActions`: track it, cancel it while nothing has started, and ask for
/// a refund on what arrived. Nothing here decides: whether it can be cancelled
/// is the server's `cancel`, what may go back is each line's return window,
/// and the steps are `stepsForOrder`'s.
struct OrderActionsBar: View {
    let reference: String
    let detail: OrderDetail
    let reload: () async -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var tracking = false
    @State private var refunding = false
    @State private var asking = false
    @State private var cancelling = false

    private var refundable: [OrderLine] { app.features.isOn("returns") ? detail.refundable : [] }
    private var trackable: Bool { detail.steps.map { !$0.cancelled } ?? false }

    var body: some View {
        if trackable || !refundable.isEmpty || detail.cancel.cancellable || detail.cancelRefusal != nil {
            VStack(alignment: .leading, spacing: 10) {
                FlowLayout(spacing: 8) {
                    if trackable {
                        Button { tracking = true } label: {
                            Label(l.t("orders.track"), systemImage: "shippingbox")
                        }
                        .buttonStyle(OrderActionStyle())
                    }
                    if !refundable.isEmpty {
                        Button { refunding = true } label: {
                            Label(l.t("orders.requestRefund"), systemImage: "arrow.uturn.backward")
                        }
                        .buttonStyle(OrderActionStyle())
                    }
                    if detail.cancel.cancellable {
                        Button { asking = true } label: {
                            Label(l.t("orders.cancelOrder"), systemImage: "xmark.circle")
                        }
                        .buttonStyle(OrderActionStyle(danger: true))
                        .disabled(cancelling)
                    }
                }
                if let why = detail.cancelRefusal {
                    Text(l.t(why))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .sheet(isPresented: $tracking) {
                if let steps = detail.steps {
                    TrackOrderSheet(reference: reference, steps: steps, lines: detail.lines)
                }
            }
            .sheet(isPresented: $refunding) {
                RefundSheet(reference: reference, lines: refundable, done: { Task { await reload() } })
            }
            .onAppear {
                // The screenshots' `track:` and `refund:` hooks; `rate` is the order's own.
                guard let sheet = app.orderSheet, sheet == "track" || sheet == "refund" else { return }
                app.orderSheet = nil
                if sheet == "track" && trackable { tracking = true }
                if sheet == "refund" && !refundable.isEmpty { refunding = true }
            }
            .alert(l.t("orders.cancelAsk"), isPresented: $asking) {
                Button(l.t("orders.cancelOrder"), role: .destructive) { Task { await cancel() } }
                Button(l.t("orders.keepOrder"), role: .cancel) {}
            } message: {
                Text(l.t("orders.cancelBody"))
            }
        }
    }

    private func cancel() async {
        cancelling = true
        defer { cancelling = false }
        await app.attempt(done: "orders.cancelDone") {
            _ = try await app.services.api.call(API.cancelOrder, .init(reference: reference))
        }
        await reload()
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
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(steps.parcels) { parcel in
                        ParcelStepsCard(parcel: parcel, placedAt: steps.placedAt, lines: lines)
                    }
                    if steps.parcels.contains(where: { $0.promise != nil && $0.promise?.kind != "madeToOrder" }) {
                        Text(l.t("track.estimate"))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if steps.parcels.contains(where: { $0.step == "onTheWay" }) {
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
