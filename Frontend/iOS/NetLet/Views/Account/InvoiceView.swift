import CoreImage.CIFilterBuiltins
import CoreTransferable
import SwiftUI
import UniformTypeIdentifiers

/// One invoice or credit note as it was issued — the web's `/invoices/<number>`.
/// Both languages on every label, whatever the app is in, the date in the
/// Gregorian and the Hijri calendars, and the code anybody holding the paper
/// can check it with. Drawn only from the frozen document, never today's
/// store details.
struct InvoiceView: View {
    let number: String
    @State private var record: LoadState<InvoiceRecord> = .idle
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ShopPage(refresh: { await load() }) {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Breadcrumbs(trail: [l.t("invoice.back"), number])
                    Spacer()
                    if let loaded = record.value {
                        ShareLink(item: InvoicePDF(record: loaded, language: l.current, verifyURL: verifyURL(loaded)), preview: SharePreview(loaded.document.number)) {
                            Label(l.t("invoice.print"), systemImage: "printer")
                                .font(.inter(13, .semibold))
                                .foregroundStyle(Brand.navy)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 40)
                                .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.3), lineWidth: 1))
                        }
                        .simultaneousGesture(TapGesture().onEnded { Haptics.tap() })
                    }
                }
                if !app.session.isSignedIn {
                    Text(l.t("invoice.signIn")).font(.inter(15)).foregroundStyle(Brand.body)
                } else if notFound {
                    Text(l.t("invoice.notFound")).font(.inter(15)).foregroundStyle(Brand.body)
                } else {
                    LoadStateView(state: record, retry: { await load() }) { loaded in
                        VStack(alignment: .leading, spacing: 16) {
                            InvoicePaper(record: loaded, language: l.current, verifyURL: verifyURL(loaded), onOpen: { app.open(.invoice(number: $0)) })
                                .card()
                            InvoiceChecks(record: loaded, verifyURL: verifyURL(loaded))
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task { if app.session.isSignedIn { await load() } }
    }

    /// A number not on this account reads "not found", never an error to retry.
    private var notFound: Bool {
        if case .failed(.server(let code, _, _)) = record { return code == "NOT_FOUND" || code == "BAD_REQUEST" }
        return false
    }

    private func load() async {
        if record.value == nil { record = .loading }
        do {
            record = .loaded(try await app.services.api.call(API.invoice, .init(number: number)))
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { record = .failed(failure) }
        }
    }

    private func verifyURL(_ record: InvoiceRecord) -> URL {
        InvoiceWording.verifyURL(base: app.services.configuration.baseURL, number: record.document.number, code: record.verifyCode)
    }
}

/// What every invoice page needs to say about itself outside the paper:
/// the check and the data, for whoever is handed it next.
private struct InvoiceChecks: View {
    let record: InvoiceRecord
    let verifyURL: URL
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 10) {
            Button {
                app.push(.verifyInvoice(number: record.document.number, code: record.verifyCode))
            } label: {
                Label(l.t("invoice.verifyHeading"), systemImage: "checkmark.seal")
            }
            .buttonStyle(SecondaryButtonStyle())
            ShareLink(item: InvoiceData(record: record, verifyURL: verifyURL), preview: SharePreview(record.document.number + ".json")) {
                Label(l.t("invoice.downloadData"), systemImage: "arrow.down.doc")
                    .font(.inter(13, .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            }
            .simultaneousGesture(TapGesture().onEnded { Haptics.tap() })
        }
    }
}

/// The document itself, laid out as the web prints it. It takes its language
/// rather than reading the environment, so the same view is the page and the
/// PDF a share sheet prints.
struct InvoicePaper: View {
    let record: InvoiceRecord
    let language: Language
    let verifyURL: URL
    var onOpen: ((String) -> Void)?

    private var doc: InvoiceDocument { record.document }
    private func t(_ key: String, _ params: [String: String] = [:]) -> String { Phrasebook.shared.text(key, language: language, params: params) }
    private func money(_ amount: Money) -> String { amount.formatted(language) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            parties
            ForEach(Array(doc.sellers.enumerated()), id: \.offset) { _, seller in
                sellerBlock(seller)
            }
            totals
            if !record.credits.isEmpty { creditNotes }
            verification
            Divider()
            Both(key: "invoice.footer", language: language)
                .font(.inter(11))
                .foregroundStyle(Brand.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.layoutDirection, language.isRightToLeft ? .rightToLeft : .leftToRight)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Both(key: doc.isCredit ? "invoice.creditNote" : "invoice.title", language: language)
                .font(.inter(22, .heavy))
                .foregroundStyle(Brand.navy)
            Text(doc.number)
                .font(.inter(15, .semibold).monospaced())
                .foregroundStyle(Brand.ink)
                .environment(\.layoutDirection, .leftToRight)
                .textSelection(.enabled)
            fact("invoice.issued") {
                VStack(alignment: .leading, spacing: 2) {
                    Text(InvoiceWording.gregorian(doc.issuedAt, language))
                    Text(InvoiceWording.hijri(doc.issuedAt, language)).foregroundStyle(Brand.muted)
                }
            }
            fact("invoice.order") {
                Text(doc.orderReference).monospaced().environment(\.layoutDirection, .leftToRight)
            }
            if let corrects = doc.credits {
                fact("invoice.corrects") {
                    VStack(alignment: .leading, spacing: 2) {
                        Button(corrects.invoiceNumber) { onOpen?(corrects.invoiceNumber) }
                            .buttonStyle(.tap)
                            .foregroundStyle(Brand.navy)
                            .environment(\.layoutDirection, .leftToRight)
                        if Phrasebook.shared.has(corrects.reason) { Text(t(corrects.reason)).foregroundStyle(Brand.muted) }
                    }
                }
            }
        }
    }

    private var parties: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Both(key: "invoice.issuer", language: language).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                Text(doc.issuer.name).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                if let nameAr = doc.issuer.nameAr { Text(nameAr).font(.inter(14)).environment(\.layoutDirection, .rightToLeft) }
                registration(doc.issuer.licence, underPlatform: false)
                if let address = doc.issuer.address { Text(address).font(.inter(13)).foregroundStyle(Brand.body) }
            }
            VStack(alignment: .leading, spacing: 3) {
                Both(key: "invoice.buyer", language: language).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                if let name = doc.buyer.name { Text(name).font(.inter(15, .bold)).foregroundStyle(Brand.ink) }
                if let phone = doc.buyer.phone { Text(phone).font(.inter(13)).environment(\.layoutDirection, .leftToRight) }
                Text(doc.buyer.email).font(.inter(13)).environment(\.layoutDirection, .leftToRight)
                if let address = doc.buyer.address { Text(address).font(.inter(13)).foregroundStyle(Brand.body) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sellerBlock(_ seller: InvoiceDocument.Seller) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Both(key: "invoice.soldBy", language: language).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            Text(seller.name).font(.inter(16, .bold)).foregroundStyle(Brand.navy)
            if let nameAr = seller.nameAr { Text(nameAr).font(.inter(14)).foregroundStyle(Brand.body).environment(\.layoutDirection, .rightToLeft) }
            registration(seller.licence, underPlatform: seller.underPlatformLicence)
            VStack(spacing: 0) {
                HStack {
                    Both(key: "invoice.item", language: language)
                    Spacer()
                    Both(key: "invoice.lineTotal", language: language)
                }
                .font(.inter(11, .semibold))
                .foregroundStyle(Brand.muted)
                .padding(.vertical, 6)
                Divider()
                ForEach(Array(seller.lines.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .top, spacing: 10) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.title).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                            if let titleAr = line.titleAr { Text(titleAr).font(.inter(13)).foregroundStyle(Brand.body).environment(\.layoutDirection, .rightToLeft) }
                            if let variant = line.variantTitle, variant != "Default", !variant.isEmpty { Text(variant).font(.inter(12)).foregroundStyle(Brand.muted) }
                            if let sku = line.sku { Text(sku).font(.inter(11).monospaced()).foregroundStyle(Brand.muted).environment(\.layoutDirection, .leftToRight) }
                            Text("\(line.quantity) × \(money(line.unitPrice))").font(.inter(12)).foregroundStyle(Brand.muted)
                        }
                        Spacer(minLength: 8)
                        Text(money(line.lineTotal)).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                    }
                    .padding(.vertical, 8)
                    Divider()
                }
                if !seller.delivery.isZero {
                    HStack {
                        Both(key: "invoice.deliveryBy", language: language, params: ["name": seller.name]).font(.inter(13))
                        Spacer()
                        Text(money(seller.delivery)).font(.inter(14, .semibold))
                    }
                    .padding(.vertical, 8)
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    private var totals: some View {
        VStack(spacing: 8) {
            row("invoice.goods", money(doc.goods))
            if !doc.delivery.isZero { row("invoice.delivery", money(doc.delivery)) }
            if !doc.discount.isZero { row("invoice.discount", "−" + money(doc.discount)) }
            Divider()
            HStack(alignment: .top) {
                Both(key: doc.isCredit ? "invoice.creditTotal" : "invoice.total", language: language).font(.inter(16, .bold))
                Spacer()
                Text(money(doc.total)).font(.inter(18, .heavy)).foregroundStyle(Brand.navy)
            }
            if !doc.isCredit {
                if !doc.paidWith.points.isZero { row("invoice.paidPoints", money(doc.paidWith.points)) }
                if !doc.paidWith.giftCard.isZero { row("invoice.paidGiftCard", money(doc.paidWith.giftCard)) }
                row(doc.paymentMethod == "cod" ? "invoice.paidCash" : "invoice.paidOther", money(doc.paidWith.cash))
            }
        }
    }

    private var creditNotes: some View {
        VStack(alignment: .leading, spacing: 6) {
            Both(key: "invoice.correctedBy", language: language).font(.inter(13, .semibold)).foregroundStyle(Brand.ink)
            ForEach(record.credits) { credit in
                HStack {
                    Button(credit.number) { onOpen?(credit.number) }
                        .buttonStyle(.tap)
                        .foregroundStyle(Brand.navy)
                        .environment(\.layoutDirection, .leftToRight)
                    Spacer()
                    Text(InvoiceWording.gregorian(credit.issuedAt, language) + " · −" + money(credit.total))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                }
                .frame(minHeight: 36)
            }
        }
    }

    private var verification: some View {
        HStack(alignment: .top, spacing: 14) {
            if let qr = InvoiceWording.qr(verifyURL.absoluteString) {
                Image(uiImage: qr)
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 96, height: 96)
                    .accessibilityLabel(t("invoice.verifyQrAlt"))
            }
            VStack(alignment: .leading, spacing: 4) {
                Both(key: "invoice.verifyHeading", language: language).font(.inter(13, .semibold)).foregroundStyle(Brand.ink)
                Text(t("invoice.verifyHow")).font(.inter(12)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                Text(verifyURL.absoluteString)
                    .font(.inter(11).monospaced())
                    .foregroundStyle(Brand.muted)
                    .environment(\.layoutDirection, .leftToRight)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 4) {
                    Text(t("invoice.verifyCode"))
                    Text(record.verifyCode).monospaced().fontWeight(.bold).environment(\.layoutDirection, .leftToRight)
                }
                .font(.inter(12))
            }
        }
    }

    private func fact<Value: View>(_ key: String, @ViewBuilder value: () -> Value) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Both(key: key, language: language).font(.inter(11, .semibold)).foregroundStyle(Brand.muted)
            value().font(.inter(14)).foregroundStyle(Brand.ink)
        }
    }

    private func row(_ key: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Both(key: key, language: language).font(.inter(13)).foregroundStyle(Brand.body)
            Spacer()
            Text(value).font(.inter(14)).foregroundStyle(Brand.ink)
        }
    }

    @ViewBuilder
    private func registration(_ licence: String?, underPlatform: Bool) -> some View {
        if underPlatform {
            Both(key: "invoice.underPlatformLicence", language: language).font(.inter(12)).foregroundStyle(Brand.body)
        } else if let licence {
            HStack(alignment: .top, spacing: 4) {
                Both(key: "invoice.registration", language: language)
                Text(licence).monospaced().environment(\.layoutDirection, .leftToRight)
            }
            .font(.inter(12))
            .foregroundStyle(Brand.body)
        } else {
            Both(key: "invoice.registrationMissing", language: language).font(.inter(12)).foregroundStyle(Brand.muted)
        }
    }
}

/// A label in the page's language with the other language under it — an
/// invoice is handed to an accountant as often as it is read by the shopper.
private struct Both: View {
    let key: String
    let language: Language
    var params: [String: String] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(Phrasebook.shared.text(key, language: language, params: params))
            Text(Phrasebook.shared.text(key, language: language.other, params: params))
                .font(.inter(10))
                .foregroundStyle(Brand.muted)
                .environment(\.layoutDirection, language.other.isRightToLeft ? .rightToLeft : .leftToRight)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// Is a printed document genuine? The web's `/invoices/verify/<number>` —
/// public, because whoever holds the paper is rarely the shopper, and it
/// shows only what the paper already shows.
struct InvoiceVerifyView: View {
    let number: String
    let code: String
    @State private var state: LoadState<VerifiedDocument?> = .idle
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ShopPage {
            VStack(alignment: .leading, spacing: 16) {
                Text(l.t("invoice.verifyHeading")).pageTitle()
                switch state {
                case .idle, .loading:
                    Text(l.t("invoice.verifyChecking")).font(.inter(15)).foregroundStyle(Brand.muted)
                case .failed, .loaded(.none):
                    Label(l.t("invoice.verifyNo"), systemImage: "exclamationmark.circle")
                        .font(.inter(15, .semibold))
                        .foregroundStyle(Brand.danger)
                case .loaded(.some(let found)):
                    VStack(alignment: .leading, spacing: 12) {
                        Label(l.t(found.kind == "credit_note" ? "invoice.verifyYesCredit" : "invoice.verifyYes"), systemImage: "checkmark.seal.fill")
                            .font(.inter(15, .bold))
                            .foregroundStyle(Brand.success)
                        fact(l.t("invoice.number"), found.number, leftToRight: true)
                        fact(l.t("invoice.issued"), InvoiceWording.gregorian(found.issuedAt, l.current) + " · " + InvoiceWording.hijri(found.issuedAt, l.current))
                        fact(l.t(found.kind == "credit_note" ? "invoice.creditTotal" : "invoice.total"), found.total.formatted(l.current))
                        fact(l.t("invoice.issuer"), [found.issuerName, found.issuerLicence].compactMap { $0 }.joined(separator: " · "))
                        fact(l.t("invoice.soldBy"), found.sellers.joined(separator: "\n"))
                        if found.corrected {
                            Text(l.t("invoice.verifyCorrected")).font(.inter(14)).foregroundStyle(Brand.body)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task {
            guard InvoiceWording.isNumber(number), !code.isEmpty, code.count <= 16 else {
                state = .loaded(nil)
                return
            }
            state = .loading
            do {
                state = .loaded(try await app.services.api.call(API.verifyInvoice, .init(number: number, code: code)))
            } catch {
                state = .failed(APIError.from(error))
            }
        }
    }

    private func fact(_ label: String, _ value: String, leftToRight: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            Text(value)
                .font(.inter(15))
                .foregroundStyle(Brand.ink)
                .environment(\.layoutDirection, leftToRight ? .leftToRight : l.layoutDirection)
        }
    }
}

/// What `invoices.verify` answers: only what the paper shows beside the code.
struct VerifiedDocument: Decodable, Hashable, Sendable {
    let number: String
    let kind: String
    let issuedAt: Date
    let total: Money
    let currency: String
    let issuerName: String
    let issuerLicence: String?
    let sellers: [String]
    let corrected: Bool
}

extension API {
    struct VerifyInvoice: Encodable, Sendable {
        let number: String
        let code: String
    }

    static let verifyInvoice = Procedure<VerifyInvoice, VerifiedDocument?>(query: "invoices.verify")
}

/// The invoice's dates, number shape, check address and QR — the web's
/// `gregorianDate`, `hijriDate` and the verification block.
enum InvoiceWording {
    private static let kuwait = TimeZone(identifier: "Asia/Kuwait") ?? .current

    static func gregorian(_ date: Date, _ language: Language) -> String {
        format(date, locale: language == .ar ? "ar_KW@calendar=gregorian;numbers=latn" : "en_GB@calendar=gregorian")
    }

    /// Umm al-Qura, the calendar Kuwait's own dates are kept in.
    static func hijri(_ date: Date, _ language: Language) -> String {
        format(date, locale: language == .ar ? "ar_KW@calendar=islamic-umalqura;numbers=latn" : "en_GB@calendar=islamic-umalqura")
    }

    /// The calendar rides in the locale rather than on the formatter: setting
    /// one on the formatter dropped the locale's Latin digits. Any
    /// Arabic-Indic digit left is folded, as the web writes dates.
    private static func format(_ date: Date, locale: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: locale)
        formatter.timeZone = kuwait
        formatter.setLocalizedDateFormatFromTemplate("dMMMMy")
        return String(formatter.string(from: date).unicodeScalars.map { scalar -> Character in
            (0x0660...0x0669).contains(scalar.value) ? Character(String(scalar.value - 0x0660)) : Character(scalar)
        })
    }

    /// `INV-2026-000042` or `CRN-…`, and nothing longer — the router's shape.
    static func isNumber(_ text: String) -> Bool {
        text.range(of: #"^(INV|CRN)-\d{4}-\d{6,9}$"#, options: .regularExpression) != nil
    }

    static func verifyURL(base: URL, number: String, code: String) -> URL {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        components.path = "/invoices/verify/\(number)"
        components.queryItems = [URLQueryItem(name: "code", value: code)]
        components.fragment = nil
        return components.url ?? base
    }

    static func qr(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}

/// The paper as a PDF, made when the share sheet asks for it — print it,
/// save it to Files, send it to an accountant.
struct InvoicePDF: Transferable {
    let record: InvoiceRecord
    let language: Language
    let verifyURL: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .pdf) { pdf in
            let data = await pdf.render()
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(pdf.record.document.number).pdf")
            try data.write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }

    @MainActor
    func render() -> Data {
        let paper = InvoicePaper(record: record, language: language, verifyURL: verifyURL)
            .padding(36)
            .frame(width: 595)
            .background(Color.white)
        let renderer = ImageRenderer(content: paper)
        let data = NSMutableData()
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            guard let consumer = CGDataConsumer(data: data as CFMutableData),
                  let context = CGContext(consumer: consumer, mediaBox: &box, nil) else { return }
            context.beginPDFPage(nil)
            draw(context)
            context.endPDFPage()
            context.closePDF()
        }
        return data as Data
    }
}

/// The document as data, the web's "Download as data (JSON)": the frozen
/// document with its verification beside it, amounts as the API writes them.
struct InvoiceData: Transferable {
    let record: InvoiceRecord
    let verifyURL: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .json) { item in
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(item.record.document.number).json")
            try item.json().write(to: url, options: .atomic)
            return SentTransferredFile(url)
        }
    }

    func json() throws -> Data {
        let doc = record.document
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func optional(_ value: String?) -> Any { value ?? NSNull() }
        let object: [String: Any] = [
            "version": 1,
            "kind": doc.kind,
            "number": doc.number,
            "issuedAt": iso.string(from: doc.issuedAt),
            "orderReference": doc.orderReference,
            "currency": doc.currency,
            "issuer": ["name": doc.issuer.name, "nameAr": optional(doc.issuer.nameAr), "licence": optional(doc.issuer.licence), "address": optional(doc.issuer.address)] as [String: Any],
            "buyer": ["name": optional(doc.buyer.name), "phone": optional(doc.buyer.phone), "email": doc.buyer.email, "address": optional(doc.buyer.address)] as [String: Any],
            "sellers": doc.sellers.map { seller -> [String: Any] in
                [
                    "vendorId": seller.vendorId.map { $0 as Any } ?? NSNull(),
                    "name": seller.name,
                    "nameAr": optional(seller.nameAr),
                    "licence": optional(seller.licence),
                    "underPlatformLicence": seller.underPlatformLicence,
                    "delivery": seller.delivery.amount,
                    "lines": seller.lines.map { line -> [String: Any] in
                        [
                            "title": line.title, "titleAr": optional(line.titleAr), "variantTitle": optional(line.variantTitle),
                            "sku": optional(line.sku), "quantity": line.quantity, "unitPrice": line.unitPrice.amount, "lineTotal": line.lineTotal.amount,
                        ]
                    },
                ]
            },
            "goods": doc.goods.amount,
            "delivery": doc.delivery.amount,
            "discount": doc.discount.amount,
            "total": doc.total.amount,
            "paidWith": ["points": doc.paidWith.points.amount, "giftCard": doc.paidWith.giftCard.amount, "cash": doc.paidWith.cash.amount],
            "paymentMethod": optional(doc.paymentMethod),
            "credits": doc.credits.map { ["invoiceNumber": $0.invoiceNumber, "reason": $0.reason] as Any } ?? NSNull(),
            "verification": ["code": record.verifyCode, "url": verifyURL.absoluteString],
        ]
        return try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    }
}
