import QuickLook
import SwiftUI

/// "Download receipt (PDF)" on an opened order, on the owner's word ("an
/// export to PDF option that will show all the details of your order in the
/// form of a receipt") — the web's `OrderReceipt`: the order's number, when
/// it was placed, where it is, how it is paid, where it goes, each item with
/// its store, quantity, price and code, the till's sum and what is still to
/// pay, in the page's language.
///
/// The words are made here from `orders.get`'s answer and `ReceiptRules`
/// (`orderReceipt.ts` in Swift); `ReceiptPage` lays them out and
/// `ImageRenderer` draws the page into a PDF, so its words stay words —
/// shaped and laid out right to left by the system in Arabic, and
/// searchable — and Quick Look shows it with Share and Save to Files.
struct ReceiptWords: Equatable {
    struct Fact: Equatable {
        let label: String
        let lines: [String]
    }

    struct Item: Equatable {
        let title: String
        let lines: [String]
        let amount: String
        var note: String? = nil
        var warning = false
        var muted = false
    }

    struct Sum: Equatable {
        let label: String
        let amount: String
        var strong = false
    }

    var rightToLeft: Bool
    var docTitle: String
    var title: String
    var reference: String
    var facts: [Fact]
    var itemsHeading: String
    var items: [Item]
    var sums: [Sum]
    var dueLabel: String
    var dueAmount: String
    var dueNote: String?
    var footer: [String]
    var fileName: String

    /// The receipt's words for an opened order, in the language it is read in.
    @MainActor
    static func make(_ detail: OrderDetail, language l: LanguageSettings, now: Date = Date()) -> ReceiptWords {
        let order = detail.order
        let money = { (value: Money) in value.formatted(l.current) }
        let progress = ReceiptRules.progress(
            status: order.status,
            lines: detail.lines.map { (fulfilment: $0.fulfilment, deliveredAt: $0.deliveredAt, preordered: $0.preordered ?? false) }
        )
        let deliverTo = [
            [order.contactName, order.contactPhone].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "),
            order.addressLine ?? "",
            ReferenceData.shared.governorate(id: order.deliveryZoneId)?.name(l.current) ?? "",
            order.addressNotes ?? "",
        ].filter { !$0.isEmpty }

        let items = detail.lines.map { line -> Item in
            let cancelled = line.fulfilment == "cancelled"
            let returned = line.fulfilment == "returned"
            let coded = line.discountCode != nil && (line.discountAmount?.fils ?? 0) > 0
            let note: String? = cancelled ? l.t("receipt.lineCancelled")
                : returned ? l.t("receipt.lineReturned")
                : coded ? l.t("orders.lineCode", ["code": line.discountCode ?? "", "amount": money(line.discountAmount ?? Money(fils: 0))])
                : nil
            return Item(
                title: line.productTitle,
                lines: [
                    line.variantLabel ?? "",
                    line.vendorName.map { l.t("receipt.soldBy", ["store": $0]) } ?? "",
                    l.t("orders.quantityAndPrice", ["quantity": "\(line.quantity)", "price": money(line.unitPrice)]),
                ].filter { !$0.isEmpty },
                amount: money(line.lineTotal),
                note: note,
                warning: cancelled || returned,
                muted: cancelled
            )
        }

        let tax = detail.tax.map { (amount: $0.amount, rate: $0.rate) }
        let sums = ReceiptRules.rows(order.receiptFigures, tax: tax).map { row -> Sum in
            let params = row.kind == .tax ? ["rate": TaxWording.rateLabel(row.params["rate"] ?? "0")] : row.params
            let amount = row.free ? l.t("receipt.free") : (row.minus ? "−" : "") + money(row.amount)
            return Sum(label: l.t(rowWord(row.kind), params), amount: amount, strong: row.strong)
        }

        let due: (String, String, String?) = {
            switch ReceiptRules.payment(status: order.status, paymentMethod: order.paymentMethod, grandTotal: order.grandTotal, owedNow: detail.owedNow ?? order.grandTotal) {
            case .paid: return (l.t("receipt.paid"), money(order.grandTotal), nil)
            case .paidOnline: return (l.t("receipt.paidOnline"), money(order.grandTotal), nil)
            case .refunded: return (l.t("receipt.refunded"), money(order.grandTotal), nil)
            case .cancelled: return (l.t("receipt.cancelled"), money(Money(fils: 0)), nil)
            case .nothingDue: return (l.t("receipt.nothingDue"), money(Money(fils: 0)), nil)
            case let .onDelivery(amount, reduced): return (l.t("receipt.toPay"), money(amount), reduced ? l.t("receipt.reduced") : nil)
            }
        }()

        return ReceiptWords(
            rightToLeft: l.current.isRightToLeft,
            docTitle: l.t("receipt.docTitle", ["reference": order.reference]),
            title: l.t("receipt.title"),
            reference: order.reference,
            facts: [
                Fact(label: l.t("receipt.placed"), lines: [OrderWording.dateTime(order.placedAt, language: l.current)]),
                Fact(label: l.t("receipt.status"), lines: [OrderWording.progress(progress, language: l)]),
                Fact(label: l.t("receipt.payment"), lines: [l.t(methodWord(ReceiptRules.method(order.paymentMethod)))]),
                Fact(label: l.t("receipt.deliverTo"), lines: deliverTo.isEmpty ? ["—"] : deliverTo),
            ],
            itemsHeading: l.t("receipt.items", ["count": "\(detail.lines.count)"]),
            items: items,
            sums: sums,
            dueLabel: due.0,
            dueAmount: due.1,
            dueNote: due.2,
            footer: [
                l.t("receipt.thanks"),
                l.t("receipt.generated", ["date": OrderWording.dateTime(now, language: l.current)]),
                "netlet.net",
            ],
            fileName: ReceiptRules.fileName(order.reference)
        )
    }

    static func rowWord(_ kind: ReceiptRules.RowKind) -> String {
        switch kind {
        case .subtotal: return "receipt.subtotal"
        case .delivery: return "receipt.delivery"
        case .tax: return "receipt.tax"
        case .discount: return "receipt.discount"
        case .points: return "receipt.points"
        case .giftCard: return "receipt.giftCard"
        case .total: return "receipt.total"
        }
    }

    static func methodWord(_ method: ReceiptRules.Method) -> String {
        switch method {
        case .cod: return "receipt.methodCod"
        case .knet: return "receipt.methodKnet"
        case .card: return "receipt.methodCard"
        case .applePay: return "receipt.methodApplePay"
        }
    }
}

/// The receipt as a page, A4's width and as tall as what is on it — the
/// website's receipt, laid out the same: the logo and the title, the facts,
/// the items, the sum, how it stands with the money in a pale band, and the
/// thanks.
struct ReceiptPage: View {
    let words: ReceiptWords

    /// A4's width in points, the receipt's width.
    static let width: CGFloat = 595.28
    private let margin: CGFloat = 44

    private static let line = Color(red: 213 / 255, green: 223 / 255, blue: 235 / 255)
    private static let band = Color(red: 238 / 255, green: 243 / 255, blue: 250 / 255)
    private static let warning = Color(red: 140 / 255, green: 47 / 255, blue: 34 / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                if let logo = WebAssets.logo {
                    Image(uiImage: logo).resizable().scaledToFit().frame(height: 30)
                } else {
                    Text(verbatim: "NetLet").font(.inter(22, .heavy)).foregroundStyle(Brand.navy)
                }
                Spacer(minLength: 16)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(words.title).font(.inter(17, .heavy)).foregroundStyle(Brand.navy)
                    Text(words.reference).font(.inter(11, .semibold)).foregroundStyle(Brand.muted)
                        .environment(\.layoutDirection, .leftToRight)
                }
            }
            rule(dashed: false).padding(.vertical, 18)

            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(words.facts.enumerated()), id: \.offset) { _, fact in
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        Text(fact.label).font(.inter(10.5, .semibold)).foregroundStyle(Brand.muted)
                            .frame(width: 118, alignment: .leading)
                        VStack(alignment: .leading, spacing: 3) {
                            ForEach(Array(fact.lines.enumerated()), id: \.offset) { index, line in
                                Text(line).font(.inter(11.5, index == 0 ? .bold : .medium)).foregroundStyle(Brand.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            rule().padding(.vertical, 18)

            Text(words.itemsHeading).font(.inter(13, .heavy)).foregroundStyle(Brand.navy).padding(.bottom, 10)
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(words.items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(.inter(11.5, .bold)).foregroundStyle(item.muted ? Brand.muted : Brand.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            ForEach(Array(item.lines.enumerated()), id: \.offset) { _, line in
                                Text(line).font(.inter(10.5, .medium)).foregroundStyle(Brand.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let note = item.note {
                                Text(note).font(.inter(10.5, .bold)).foregroundStyle(item.warning ? Self.warning : Brand.success)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text(item.amount).font(.inter(11.5, .bold)).foregroundStyle(item.muted ? Brand.muted : Brand.ink)
                    }
                }
            }
            rule().padding(.vertical, 16)

            VStack(spacing: 8) {
                ForEach(Array(words.sums.enumerated()), id: \.offset) { _, sum in
                    if sum.strong {
                        rule(dashed: false).padding(.top, 4)
                        HStack {
                            Text(sum.label).font(.inter(14, .heavy))
                            Spacer()
                            Text(sum.amount).font(.inter(14, .heavy))
                        }
                        .foregroundStyle(Brand.navy)
                        .padding(.top, 4)
                    } else {
                        HStack {
                            Text(sum.label).font(.inter(11, .medium)).foregroundStyle(Brand.ink)
                            Spacer()
                            Text(sum.amount).font(.inter(11, .semibold)).foregroundStyle(Brand.ink)
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(words.dueLabel)
                    Spacer()
                    Text(words.dueAmount)
                }
                .font(.inter(12, .heavy))
                .foregroundStyle(Brand.navy)
                if let note = words.dueNote {
                    Text(note).font(.inter(10, .medium)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Self.band))
            .padding(.top, 16)

            VStack(spacing: 4) {
                ForEach(Array(words.footer.enumerated()), id: \.offset) { _, line in
                    Text(line).font(.inter(10, .medium)).foregroundStyle(Brand.muted)
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 24)
        }
        .padding(margin)
        .frame(width: Self.width)
        .background(Color.white)
        .environment(\.layoutDirection, words.rightToLeft ? .rightToLeft : .leftToRight)
    }

    private func rule(dashed: Bool = true) -> some View {
        Path { path in
            path.move(to: CGPoint(x: 0, y: 0.5))
            path.addLine(to: CGPoint(x: Self.width, y: 0.5))
        }
        .stroke(Self.line, style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : []))
        .frame(height: 1)
        .clipped()
    }
}

/// Draws the receipt into a PDF file and answers where it is.
@MainActor
enum OrderReceiptPDF {
    static func write(_ words: ReceiptWords) -> URL? {
        let renderer = ImageRenderer(content: ReceiptPage(words: words))
        renderer.proposedSize = ProposedViewSize(width: ReceiptPage.width, height: nil)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("receipts", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent(words.fileName)
        try? FileManager.default.removeItem(at: url)
        var written = false
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            let info = [
                kCGPDFContextTitle as String: words.docTitle,
                kCGPDFContextAuthor as String: "NetLet",
                kCGPDFContextCreator as String: "NetLet",
            ] as CFDictionary
            guard let context = CGContext(url as CFURL, mediaBox: &box, info) else { return }
            context.beginPDFPage(nil)
            draw(context)
            context.endPDFPage()
            context.closePDF()
            written = true
        }
        return written ? url : nil
    }
}

/// Makes an order's receipt and shows it in Quick Look, where Share and Save
/// to Files are — one model for the button beside the order's title and the
/// bar of the chosen items.
/// Not a main-actor class, so the order screen can hold it as a `@State`
/// default (Swift 5 mode evaluates that off the main actor); what makes the
/// receipt is.
@Observable
final class OrderReceiptModel {
    var making = false
    var shown: URL?

    /// Makes it and shows it; false when the page could not be drawn.
    @MainActor
    func make(_ detail: OrderDetail, language: LanguageSettings) async -> Bool {
        guard !making else { return true }
        making = true
        defer { making = false }
        // A frame for the button to say it is working before the page is drawn.
        await Task.yield()
        guard let url = OrderReceiptPDF.write(ReceiptWords.make(detail, language: language)) else { return false }
        shown = url
        return true
    }
}

/// The receipt's button at the end of an opened order's title, on the owner's
/// word ("move the download pdf option from the bottom of the order page to
/// here", a picture with "pdf" beside the title): a round button the size of
/// My orders' filter, named "Download receipt (PDF)" to VoiceOver. **Enhanced
/// on the owner's word** ("just enhance the pdf option"): a PDF file drawn for
/// NetLet (`PdfFileMark`, the web's same drawing) where it was a system
/// arrow-document over the letters "PDF"; a turning ring while it is made,
/// then a confirming tap as the receipt opens.
struct OrderReceiptButton: View {
    let model: OrderReceiptModel
    let make: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button {
            Haptics.tap()
            make()
        } label: {
            Group {
                if model.making {
                    ProgressView().tint(Brand.navy).controlSize(.small)
                } else {
                    PdfFileMark(label: l.t("receipt.pdf"))
                        .frame(width: 25, height: 29.5)
                        .offset(x: 1)
                }
            }
            .foregroundStyle(Brand.navy)
            .frame(width: 48, height: 48)
            .background(Circle().fill(Color.white))
            .overlay(Circle().strokeBorder(Brand.line, lineWidth: 1))
            .contentShape(Circle())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 24))
        .disabled(model.making)
        .accessibilityLabel(l.t(model.making ? "receipt.making" : "receipt.download"))
        .accessibilityIdentifier("order-receipt-pdf")
    }
}

/// A PDF file, drawn for NetLet in a 22 × 26 box and scaled to its frame — the
/// web's `PdfFileMark`: a white page with a navy rim and its top corner
/// folded, two lines of text, and a red tag across its foot reading "PDF",
/// the Deals bag's red (white on it 5.1:1). It is a picture of a file, so it
/// is drawn the same way round on the Arabic page.
struct PdfFileMark: View {
    let label: String

    static let red = Color(red: 214 / 255, green: 32 / 255, blue: 31 / 255)
    static let rule = Color(red: 159 / 255, green: 176 / 255, blue: 200 / 255)

    var body: some View {
        let label = self.label
        let navy = Brand.navy
        let red = Self.red
        let rule = Self.rule
        Canvas { c, size in
            let scale = min(size.width / 22, size.height / 26)
            c.scaleBy(x: scale, y: scale)
            var page = Path()
            page.move(to: CGPoint(x: 5, y: 1.5))
            page.addLine(to: CGPoint(x: 13.6, y: 1.5))
            page.addLine(to: CGPoint(x: 19.5, y: 7.4))
            page.addLine(to: CGPoint(x: 19.5, y: 23))
            page.addQuadCurve(to: CGPoint(x: 18, y: 24.5), control: CGPoint(x: 19.5, y: 24.5))
            page.addLine(to: CGPoint(x: 5, y: 24.5))
            page.addQuadCurve(to: CGPoint(x: 3.5, y: 23), control: CGPoint(x: 3.5, y: 24.5))
            page.addLine(to: CGPoint(x: 3.5, y: 3))
            page.addQuadCurve(to: CGPoint(x: 5, y: 1.5), control: CGPoint(x: 3.5, y: 1.5))
            page.closeSubpath()
            c.fill(page, with: .color(.white))
            c.stroke(page, with: .color(navy), style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
            var fold = Path()
            fold.move(to: CGPoint(x: 13.6, y: 1.5))
            fold.addLine(to: CGPoint(x: 13.6, y: 6))
            fold.addQuadCurve(to: CGPoint(x: 15, y: 7.4), control: CGPoint(x: 13.6, y: 7.4))
            fold.addLine(to: CGPoint(x: 19.5, y: 7.4))
            c.stroke(fold, with: .color(navy), style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
            var lines = Path()
            lines.move(to: CGPoint(x: 7, y: 10))
            lines.addLine(to: CGPoint(x: 14, y: 10))
            lines.move(to: CGPoint(x: 7, y: 13))
            lines.addLine(to: CGPoint(x: 16, y: 13))
            c.stroke(lines, with: .color(rule), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
            c.fill(Path(roundedRect: CGRect(x: 0.75, y: 15.5, width: 16.5, height: 7.5), cornerRadius: 1.6), with: .color(red))
            c.draw(
                Text(label).font(.system(size: 5.6, weight: .heavy)).foregroundColor(.white),
                at: CGPoint(x: 9, y: 19.25)
            )
        }
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityHidden(true)
    }
}
