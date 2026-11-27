import CoreImage.CIFilterBuiltins
import SwiftUI

// MARK: Change payment method

/// "Change payment method" — paying a cash order online instead, until it is
/// delivered (0086, on the owner's word). The web's `OrderPayment`.
///
/// **Two states, by the server's word** (`paymentChange.live`). With no
/// gateway connected and the `testPayments` switch off, it is the mockup it
/// was: KNET, a card and Apple Pay drawn as coming over a Switch that cannot
/// be pressed. With the switch on, choosing one and pressing Pay opens
/// NetLet's own test page in the sheet — it takes no money and says so — and
/// the order then reads paid online, the driver collecting nothing. The
/// figure sent is the one the sheet shows; the server refuses another.
struct OrderPaymentSheet: View {
    let reference: String
    let detail: OrderDetail
    let done: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var chosen = "cod"
    @State private var starting = false
    @State private var started: StartedPayment?

    private struct Way: Identifiable {
        let id: String
        let method: String?
        let symbol: String?
        let title: String
        let note: String
        let preview: String?
    }

    private let ways: [Way] = [
        Way(id: "cod", method: nil, symbol: "banknote", title: "checkout.payCod", note: "checkout.payCodNote", preview: nil),
        Way(id: "knet", method: "knet", symbol: nil, title: "checkout.payKnet", note: "checkout.payKnetNote", preview: "orders.payPreviewKnet"),
        Way(id: "card", method: "card", symbol: "creditcard", title: "checkout.payCard", note: "checkout.payCardNote", preview: "orders.payPreviewCard"),
        Way(id: "apple", method: "apple_pay", symbol: "iphone", title: "checkout.payApple", note: "checkout.payAppleNote", preview: "orders.payPreviewApple"),
    ]

    private var live: Bool { detail.paymentChange.live }
    private var owed: Money { detail.owedNow ?? detail.order.grandTotal }
    private var amount: String { owed.formatted(l.current) }
    private var picked: Way { ways.first { $0.id == chosen } ?? ways[0] }

    var body: some View {
        NavigationStack {
            Group {
                if let started {
                    TestPaymentPane(payment: started, close: { paid in
                        if paid {
                            done()
                            dismiss()
                        } else {
                            withAnimation(.easeOut(duration: 0.2)) { self.started = nil }
                        }
                    }, moved: {
                        done()
                        withAnimation(.easeOut(duration: 0.2)) { self.started = nil }
                    })
                    .transition(.opacity)
                } else {
                    choices
                }
            }
            .background(Brand.ground)
            .navigationTitle(l.t(started == nil ? "orders.changePayment" : "pay.title"))
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
            if let preset = app.presetPayMethod {
                app.presetPayMethod = nil
                chosen = ways.first { $0.method == preset }?.id ?? chosen
            }
        }
    }

    private var choices: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(l.t("orders.payNowCod", ["amount": amount]))
                    .font(.inter(14))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(ways) { way in choice(way) }
                if let preview = picked.preview, let method = picked.method {
                    if live {
                        // What the page it opens is, before it is pressed.
                        TestPaymentNote(text: l.t("orders.payTestNote"))
                        Button {
                            Task { await start(method) }
                        } label: {
                            HStack(spacing: 8) {
                                if starting { ProgressView().tint(.white) }
                                Text(l.t(starting ? "orders.payOpening" : "orders.payNow", ["amount": amount]))
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(starting)
                    } else {
                        Text(l.t(preview, ["amount": amount]))
                            .font(.inter(14))
                            .foregroundStyle(Brand.navy)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
                        Button(l.t("orders.paySwitch", ["method": l.t(picked.title)])) {}
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(true)
                            .accessibilityHint(l.t("orders.paySoonNote"))
                        Text(l.t("orders.paySoonNote"))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityHidden(true)
                    }
                } else {
                    Text(l.t("orders.payWindow"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(16)
            .animation(.easeOut(duration: 0.2), value: chosen)
        }
    }

    private func choice(_ way: Way) -> some View {
        let on = chosen == way.id
        let current = way.id == "cod"
        return Button {
            chosen = way.id
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle().strokeBorder(on ? Brand.navy : Brand.line, lineWidth: on ? 2 : 1.5).frame(width: 20, height: 20)
                    if on { Circle().fill(Brand.navyFill).frame(width: 10, height: 10) }
                }
                .accessibilityHidden(true)
                Group {
                    if let symbol = way.symbol {
                        Image(systemName: symbol).font(.system(size: 18, weight: .medium))
                    } else {
                        Text("KNET").font(.inter(11, .heavy))
                    }
                }
                .foregroundStyle(on ? Color.white : Brand.muted)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? Brand.navyFill : Brand.tint))
                .accessibilityHidden(true)
                // The pill sits on the title's line, so a narrow phone gives the words the row's width.
                VStack(alignment: .leading, spacing: 3) {
                    FlowLayout(spacing: 6) {
                        Text(l.t(way.title)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                        Text(l.t(current ? "orders.payCurrent" : live ? "orders.payTest" : "checkout.paySoon"))
                            .font(.inter(11, .bold))
                            .foregroundStyle(current ? Brand.success : Brand.muted)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(Capsule().fill(current ? Brand.successFill : Brand.tint))
                            .fixedSize()
                    }
                    Text(l.t(way.note)).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(on ? Color(light: 0xF6F8FB, dark: 0x1B283C) : Brand.surface))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(on ? Brand.navy : Brand.cardLine, lineWidth: on ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }

    private func start(_ method: String) async {
        starting = true
        defer { starting = false }
        do {
            let payment = try await app.services.api.call(API.paymentStart, .init(reference: reference, method: method, expectOwed: owed.amount))
            withAnimation(.easeOut(duration: 0.2)) { started = payment }
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            guard failure != .cancelled else { return }
            app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has)))
            // The order owes something else now: read it again, so the figure is today's.
            if failure.messageKey(knownKey: Phrasebook.shared.has) == "orders.payMoved" { done() }
        }
    }
}

/// The amber line that says this is NetLet's test page and takes no money.
struct TestPaymentNote: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "flask").font(.system(size: 14, weight: .semibold)).accessibilityHidden(true)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(.inter(13))
        .foregroundStyle(Brand.testInk)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.testWash))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.testRim, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
    }
}

/// NetLet's own test payment page (0086) — the web's `/pay/test/:id`, drawn
/// in the sheet: it says before anything else that it takes no money and asks
/// for no card, then the method, the amount and Pay or Cancel. The server
/// asks the window and the figure again under a lock on the order.
struct TestPaymentPane: View {
    let payment: StartedPayment
    /// Paid (true) or backed out (false).
    let close: (Bool) -> Void
    /// The order moved under the page: read it again.
    let moved: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var busy: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TestPaymentNote(text: l.t("pay.testNote"))
                HStack(spacing: 12) {
                    Group {
                        switch payment.method {
                        case "knet": Text("KNET").font(.inter(12, .heavy))
                        case "apple_pay": Image(systemName: "iphone").font(.system(size: 22, weight: .medium))
                        default: Image(systemName: "creditcard").font(.system(size: 22, weight: .medium))
                        }
                    }
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.navyFill))
                    .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.t(OnlineMethodWords.title(payment.method))).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                        Text(l.t("pay.toNetLet")).font(.inter(13)).foregroundStyle(Brand.muted)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t("pay.amount")).font(.inter(13, .semibold)).foregroundStyle(Brand.muted)
                    Text(payment.amount.formatted(l.current)).font(.inter(32, .heavy)).foregroundStyle(Brand.navy)
                    (Text(l.t("pay.forOrder") + " ") + Text(latin(payment.reference)))
                        .font(.inter(13)).foregroundStyle(Brand.muted)
                }
                VStack(spacing: 10) {
                    Button {
                        Task { await finish("paid") }
                    } label: {
                        HStack(spacing: 8) {
                            if busy == "paid" { ProgressView().tint(.white) }
                            Text(l.t(busy == "paid" ? "pay.paying" : "pay.pay", ["amount": payment.amount.formatted(l.current)]))
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button(l.t("pay.cancel")) { Task { await finish("cancelled") } }
                        .buttonStyle(SecondaryButtonStyle())
                }
                .disabled(busy != nil)
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.surface))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine))
            .padding(16)
        }
    }

    private func finish(_ outcome: String) async {
        busy = outcome
        defer { busy = nil }
        do {
            let answer = try await app.services.api.call(API.paymentTest, .init(paymentId: payment.paymentId, outcome: outcome))
            if outcome == "paid", answer.status == "paid" {
                Haptics.succeeded()
                app.toast(l.t("pay.paidToast"))
                close(true)
            } else {
                close(false)
            }
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            guard failure != .cancelled else { return }
            let key = failure.messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(key))
            if key == "orders.payMoved" { moved() } else { close(false) }
        }
    }
}

// MARK: Paid online, and the code at the door

/// "Paid online with KNET": the driver collects nothing (0086).
struct PaidOnlineNote: View {
    let paid: PaidOnline
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark.seal.fill").font(.system(size: 18)).foregroundStyle(Brand.success).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t("orders.paidOnlineWith", ["method": l.t(OnlineMethodWords.title(paid.method)), "amount": paid.amount.formatted(l.current)]))
                    .font(.inter(13, .bold))
                Text(l.t("orders.paidOnlineNothing")).font(.inter(13))
                if paid.test {
                    Text(l.t("orders.paidOnTestPage")).font(.inter(12)).foregroundStyle(Brand.testInk)
                }
            }
            .foregroundStyle(Brand.success)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.successFill.opacity(0.6)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.successFill))
        .accessibilityElement(children: .combine)
    }
}

/// How the whole order is paid, and the one place it is changed, on the
/// owner's word ("we will control full payment for all order one time"): it
/// was Payment on the bar of the chosen items, offered beside one item as if
/// an item could be paid for apart. Drawn while the way to pay may still
/// change (`paymentChange.open`); the press opens the order's payment sheet.
struct OrderPaymentLine: View {
    let change: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "banknote")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .accessibilityHidden(true)
            Text(l.t("orders.payOnDelivery"))
                .font(.inter(13, .bold))
                .foregroundStyle(Brand.navy)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button(action: change) {
                HStack(spacing: 6) {
                    Image(systemName: "creditcard").font(.system(size: 13, weight: .semibold)).accessibilityHidden(true)
                    Text(l.t("orders.changePayment")).font(.inter(13, .semibold))
                }
                .foregroundStyle(Brand.navy)
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .liquidGlass(.clear, in: Capsule())
            }
            .buttonStyle(.tap)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.surface))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }
}

/// "Show this to your driver": the QR, the code, and what the driver will ask
/// for — drawn while a parcel is on its way, the server's `handover`.
struct HandoverCard: View {
    let handover: OrderHandover
    let paidOnline: Bool
    let owed: Money
    @Environment(LanguageSettings.self) private var l
    @State private var image: UIImage?

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.surface)
                RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine)
                if let image {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .padding(10)
                        .accessibilityLabel(l.t("orders.handoverQrAlt"))
                } else {
                    Image(systemName: "qrcode").font(.system(size: 40)).foregroundStyle(Brand.line).accessibilityHidden(true)
                }
            }
            .frame(width: 184, height: 184)
            Text(l.t("orders.handoverTitle"))
                .font(.inter(15, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            Text(paidOnline ? l.t("orders.handoverPaid") : l.t("orders.handoverCash", ["amount": owed.formatted(l.current)]))
                .font(.inter(13))
                .foregroundStyle(Brand.body)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 2) {
                Text(l.t("orders.handoverCodeLabel")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                Text(handover.spacedCode)
                    .font(.inter(24, .heavy))
                    .tracking(2.5)
                    .foregroundStyle(Brand.navy)
                    .environment(\.layoutDirection, .leftToRight)
                    .textSelection(.enabled)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.surface))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.line))
        .task(id: handover.token) { image = HandoverCard.qr(handover.url ?? handover.token) }
    }

    /// The QR, drawn by Core Image at a size it scales up crisply (the invoice's way).
    static func qr(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
