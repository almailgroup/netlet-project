import SwiftUI
import VisionKit

/// The driver's check at the door (0086, on the owner's word) — the web's
/// `/admin/dispatch/scan`: scan the shopper's QR, or type the eight
/// characters under it against an order on the way, to see how the order is
/// paid and hand it over.
///
/// **Paid online is one step**: the scan answers "Paid online, collect
/// nothing" and hands the driver's parcels over. **Cash is two**: it says what
/// to collect, and "Cash received, hand over" hands them over once the money
/// is in hand. Recording the cash on the books stays the store's or NetLet's
/// own press. The camera is VisionKit's own reader, where the phone has one.
struct HandoverScanSheet: View {
    /// The order the board's button was pressed on, chosen for the typed code.
    let orderId: Int?
    /// Something was handed over: the board reads itself again.
    let handedOver: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var orders: [OrderChoice] = []
    @State private var chosen: Int?
    @State private var code = ""
    @State private var codeProblem: String?
    @State private var asked: HandoverAsk?
    @State private var checking = false
    @State private var answer: HandoverAnswer?
    @State private var failure: String?
    @State private var scanning = false
    @State private var notNetLet = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(l.t("dispatch.scanNote"))
                        .font(.inter(14))
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                    if checking { PortalNotice(text: l.t("dispatch.scanChecking")) }
                    if let failure {
                        VStack(alignment: .leading, spacing: 8) {
                            PortalNotice(text: l.t(failure), tone: .danger)
                            Button(l.t("dispatch.scanAgain")) { reset() }.buttonStyle(PortalSmallButtonStyle())
                        }
                    }
                    if let answer {
                        HandoverAnswerCard(answer: answer, busy: checking, cashIn: { Task { await cashIn() } }, again: reset)
                    } else {
                        cameraCard
                        codeCard
                    }
                }
                .padding(16)
                .animation(.easeOut(duration: 0.2), value: answer)
            }
            .background(PortalLook.ground)
            .navigationTitle(l.t("dispatch.scanTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
        }
        .task { await loadOrders() }
    }

    // MARK: The camera

    @ViewBuilder
    private var cameraCard: some View {
        PortalCard {
            Text(l.t("dispatch.scanCameraTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("dispatch.scanCameraNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            if !DataScannerViewController.isSupported {
                // A simulator, or a phone with no reader: its own camera app opens the portal's page.
                Label(l.t("dispatch.scanPhoneCamera"), systemImage: "qrcode.viewfinder")
                    .font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            } else if !DataScannerViewController.isAvailable {
                PortalNotice(text: l.t("dispatch.scanCameraRefused"), tone: .warning)
            } else if scanning {
                QRReader { scanned in
                    if let token = HandoverRules.token(fromScan: scanned) {
                        scanning = false
                        Haptics.tap()
                        Task { await ask(HandoverAsk(token: token)) }
                    } else {
                        notNetLet = true
                    }
                }
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityLabel(l.t("dispatch.scanCameraTitle"))
                if notNetLet {
                    Text(l.t("dispatch.scanNotNetLet")).font(.inter(13)).foregroundStyle(Brand.danger)
                }
                Button(l.t("dispatch.scanStopCamera")) { scanning = false }
                    .buttonStyle(PortalSmallButtonStyle())
            } else {
                Button {
                    notNetLet = false
                    scanning = true
                } label: {
                    Label(l.t("dispatch.scanOpenCamera"), systemImage: "camera")
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
            }
        }
    }

    // MARK: The typed code

    private var codeCard: some View {
        PortalCard {
            Text(l.t("dispatch.scanCodeTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("dispatch.scanCodeNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("dispatch.scanOrder")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                Menu {
                    ForEach(orders) { order in
                        Button(order.label) { chosen = order.id }
                    }
                } label: {
                    MenuField(text: orders.first(where: { $0.id == chosen })?.label, placeholder: l.t("dispatch.scanChooseOrder"))
                }
                .accessibilityLabel(l.t("dispatch.scanOrder"))
            }
            LabeledField(label: l.t("dispatch.scanCode"), text: Binding(get: { code }, set: { code = String($0.prefix(12)) }),
                         placeholder: "ABCD EFGH", problem: codeProblem, leftToRight: true)
            Button {
                Task { await submitCode() }
            } label: {
                Label(l.t("dispatch.scanCheck"), systemImage: "key")
            }
            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
            .disabled(checking)
        }
    }

    // MARK: Asking

    private func loadOrders() async {
        chosen = chosen ?? orderId
        guard let board = try? await app.services.api.call(API.dispatchBoard, .init(state: "transit")) else { return }
        var seen: [OrderChoice] = []
        for parcel in board.parcels where !seen.contains(where: { $0.id == parcel.orderId }) {
            let name = parcel.orderAddress.contactName
            seen.append(OrderChoice(id: parcel.orderId, label: name.map { "\(latin(parcel.reference)) · \($0)" } ?? latin(parcel.reference)))
        }
        orders = seen
    }

    private func submitCode() async {
        guard let id = chosen else { codeProblem = "dispatch.scanChooseOrder"; return }
        guard HandoverRules.normalise(code) != nil else { codeProblem = "dispatch.scanCodeLength"; return }
        codeProblem = nil
        await ask(HandoverAsk(orderId: id, code: code))
    }

    private func cashIn() async {
        guard var again = asked else { return }
        again.cashReceived = true
        await ask(again)
    }

    private func ask(_ question: HandoverAsk) async {
        asked = question
        failure = nil
        checking = true
        defer { checking = false }
        do {
            let got = try await app.services.api.call(API.handOver, question)
            answer = got
            if got.done {
                Haptics.succeeded()
                handedOver()
            }
        } catch {
            let problem = APIError.from(error)
            guard problem != .cancelled else { return }
            Haptics.refused()
            failure = problem.messageKey(knownKey: Phrasebook.shared.has)
        }
    }

    private func reset() {
        answer = nil
        failure = nil
        asked = nil
        code = ""
        notNetLet = false
    }
}

/// An order on the driver's way, for the typed code.
private struct OrderChoice: Identifiable, Hashable {
    let id: Int
    let label: String
}

/// What the check answered: amber for cash still to take, green once handed over.
private struct HandoverAnswerCard: View {
    let answer: HandoverAnswer
    let busy: Bool
    let cashIn: () -> Void
    let again: () -> Void
    @Environment(LanguageSettings.self) private var l

    private var collect: String { (answer.payment.collect ?? .zero).formatted(l.current) }

    var body: some View {
        let cash = answer.payment.kind == "cash"
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(headline).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: cash && !answer.done ? "banknote" : "checkmark.circle.fill")
            }
            .font(.inter(20, .heavy))
            Text(who).font(.inter(13))
            if cash && !answer.done {
                Text(l.t("dispatch.scanCollectNote")).font(.inter(13)).fixedSize(horizontal: false, vertical: true)
                FlowLayout(spacing: 8) {
                    Button(l.t("dispatch.scanCashIn"), action: cashIn)
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                        .disabled(busy)
                    Button(l.t("dispatch.scanAnother"), action: again)
                        .buttonStyle(PortalSmallButtonStyle())
                }
            } else {
                Text(l.t("dispatch.scanHandedOver")).font(.inter(13, .semibold))
                if answer.payment.kind == "online", answer.payment.test == true {
                    Text(l.t("dispatch.scanTestPaid")).font(.inter(12)).foregroundStyle(Brand.testInk)
                }
                Button(l.t("dispatch.scanAnother"), action: again)
                    .buttonStyle(PortalSmallButtonStyle())
            }
        }
        .foregroundStyle(cash && !answer.done ? Brand.testInk : Brand.success)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(cash && !answer.done ? Brand.testWash : Brand.successFill.opacity(0.6)))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(cash && !answer.done ? Brand.testRim : Brand.success.opacity(0.35), lineWidth: 2))
        .accessibilityElement(children: .contain)
    }

    private var headline: String {
        switch answer.payment.kind {
        case "online": return l.t("dispatch.scanPaidOnline", ["method": l.t(OnlineMethodWords.title(answer.payment.method ?? "card"))])
        case "cash": return answer.done ? l.t("dispatch.scanCashTaken", ["amount": collect]) : l.t("dispatch.scanCollect", ["amount": collect])
        default: return l.t("dispatch.scanNothingOwed")
        }
    }

    private var who: String {
        [latin(answer.reference), answer.contactName, l.t("dispatch.scanParcels", ["count": "\(answer.parcels.count)"])]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

/// VisionKit's own QR reader, telling what it read until it is put away.
private struct QRReader: UIViewControllerRepresentable {
    let found: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        context.coordinator.found = found
    }

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(found: found) }

    @MainActor
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        var found: (String) -> Void
        private var last: String?

        init(found: @escaping (String) -> Void) {
            self.found = found
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for item in addedItems {
                guard case let .barcode(barcode) = item, let text = barcode.payloadStringValue, text != last else { continue }
                last = text
                found(text)
            }
        }
    }
}
