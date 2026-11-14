import Foundation
import PDFKit

/// A product's catalogue as its page lists it (`catalogues.forProduct`,
/// `Backend/src/services/productCatalogues.ts`): a PDF the store or NetLet put
/// under the product — a brochure, a spec sheet, a manual — never the file
/// itself, which comes down through its own address.
struct CatalogueCard: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let title: String?
    let titleAr: String?
    let fileName: String
    let sizeBytes: Int
    let createdAt: Date

    /// The name a shopper reads — the title in the page's language, else the
    /// other's, else the file's own name without its ending — `catalogueName`.
    func name(_ language: Language) -> String {
        let own = language == .ar ? titleAr : title
        let other = language == .ar ? title : titleAr
        if let own, !own.isEmpty { return own }
        if let other, !other.isEmpty { return other }
        let bare = fileName.replacingOccurrences(of: ".pdf", with: "", options: [.caseInsensitive, .anchored, .backwards])
        return bare.isEmpty ? fileName : bare
    }
}

/// One in the product's editor: where it stands too.
struct CatalogueRow: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let title: String?
    let titleAr: String?
    let fileName: String
    let sizeBytes: Int
    let createdAt: Date
    /// `live` (on the product page), `pending` (waiting for NetLet) or `declined`.
    let status: String
    /// NetLet's reason, for one turned down.
    let reviewNote: String?
    /// Added by NetLet rather than the store.
    let byNetlet: Bool

    var card: CatalogueCard { CatalogueCard(id: id, title: title, titleAr: titleAr, fileName: fileName, sizeBytes: sizeBytes, createdAt: createdAt) }
}

struct CatalogueEditor: Decodable, Sendable {
    /// False until the table exists on the server: the section says it is not open yet.
    let ready: Bool
    let items: [CatalogueRow]
    /// Whether an upload goes on the product page at once, said before the press.
    let goesLive: Bool
    /// How many more this product can take.
    let room: Int
}

/// One waiting for NetLet to look at it, with the product and the store it is for.
struct WaitingCatalogue: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let title: String?
    let titleAr: String?
    let fileName: String
    let sizeBytes: Int
    let createdAt: Date
    let productId: Int
    let productTitle: String
    let productHandle: String
    let vendorId: Int
    let store: String

    var card: CatalogueCard { CatalogueCard(id: id, title: title, titleAr: titleAr, fileName: fileName, sizeBytes: sizeBytes, createdAt: createdAt) }
}

/// How far an upload has got: still `uploading`, or settled `live` or `pending`.
struct CatalogueProgress: Decodable, Sendable {
    let id: Int
    let received: Int
    let sizeBytes: Int
    let status: String
}

/// What goes up with a catalogue: the file and its titles, both optional.
struct CatalogueUpload: Sendable {
    let fileName: String
    var title: String?
    var titleAr: String?
    let data: Data
}

/// The sizes and widths (`Shared/inventory/productCatalogues.ts`), written to
/// `content.json` by `pnpm ios:resources`.
struct CatalogueRules: Decodable, Sendable {
    /// The largest file a product may carry (5 MB).
    let maxBytes: Int
    /// The part a file is sent and read in, under what a server takes in one request.
    let partBytes: Int
    /// The largest file its own address hands over whole.
    let directBytes: Int
    let perProduct: Int
    let titleMax: Int
    let noteMax: Int

    static var shared: CatalogueRules {
        SiteContent.shared?.selling.catalogues
            ?? CatalogueRules(maxBytes: 5 * 1024 * 1024, partBytes: 3_000_000, directBytes: 4_000_000, perProduct: 5, titleMax: 120, noteMax: 500)
    }

    /// How many parts a file of this size is sent or read in.
    func parts(_ size: Int) -> Int { max(1, (size + partBytes - 1) / partBytes) }
}

/// The PDF itself, on the device.
enum CataloguePDF {
    /// Whether these are a PDF's first bytes (`%PDF-`).
    static func isPDF(_ data: Data) -> Bool {
        data.starts(with: [0x25, 0x50, 0x44, 0x46, 0x2D])
    }

    /// A file over the limit, made smaller the way the website does it: its
    /// pictures stored again as JPEGs at a screen's size, its text and
    /// drawings left as they are (PDFKit's own write options, iOS 16.4 on).
    /// Off the main thread, since a heavy brochure takes a moment; nil for a
    /// file PDFKit cannot open, an encrypted one among them.
    static func shrink(_ data: Data) async -> Data? {
        await Task.detached(priority: .userInitiated) {
            guard let document = PDFDocument(data: data), !document.isLocked else { return nil }
            let options: [AnyHashable: Any] = [
                PDFDocumentWriteOption.saveImagesAsJPEGOption: true,
                PDFDocumentWriteOption.optimizeImagesForScreenOption: true,
            ]
            return document.dataRepresentation(options: options)
        }.value
    }
}

extension API {
    struct CatalogueProductRef: Encodable, Sendable {
        /// The storefront's product id, a string; one that is not a row's simply has none.
        let productId: String
    }

    struct CatalogueEditorRef: Encodable, Sendable {
        let productId: Int
    }

    struct CatalogueRef: Encodable, Sendable {
        let id: Int
    }

    struct CatalogueRemoved: Decodable, Sendable {
        let productId: Int
    }

    struct CatalogueDecision: Encodable, Sendable {
        let id: Int
        let approve: Bool
        var note: String?
    }

    struct CatalogueDecided: Decodable, Sendable {
        let status: String
    }

    static let cataloguesForProduct = Procedure<CatalogueProductRef, [CatalogueCard]>(query: "catalogues.forProduct")
    static let catalogueEditor = Procedure<CatalogueEditorRef, CatalogueEditor>(query: "catalogues.editor")
    static let removeCatalogue = Procedure<CatalogueRef, CatalogueRemoved>(mutation: "catalogues.remove")
    static let waitingCatalogues = Procedure<NoInput, [WaitingCatalogue]>(query: "catalogues.waiting")
    static let waitingCatalogueCount = Procedure<NoInput, Int>(query: "catalogues.waitingCount")
    static let decideCatalogue = Procedure<CatalogueDecision, CatalogueDecided>(mutation: "catalogues.decide")
}
