import Foundation

/// One of a store's documents as the server lists it
/// (`Backend/src/services/storeDocuments.ts`): the licence, the signatory's
/// civil ID, the bank's letter, the contract — never the file itself, which
/// comes down only through its own authenticated address.
///
/// **The server decides what each person may do**, and says so on the row:
/// `mayRemove` is the Remove button, `netletOnly` is only ever true in
/// NetLet's own list (a store is never sent such a row), and `expiry` is
/// where the paper's last day stands on Kuwait's calendar today, worked out
/// there so the app does no date arithmetic of its own.
struct StoreDocument: Decodable, Identifiable, Hashable, Sendable {
    struct Expiry: Decodable, Hashable, Sendable {
        /// `none`, `expired`, `soon` or `valid`.
        let kind: String
        /// Days since it ended, or days until it does (today is zero).
        let days: Int?
    }

    let id: Int
    let kind: String
    let title: String?
    let fileName: String
    let contentType: String
    let byteSize: Int
    /// The paper's own last day, `yyyy-mm-dd` on Kuwait's calendar.
    let expiresOn: String?
    let expiry: Expiry
    let netletOnly: Bool
    /// `netlet`, `store`, or nil once the account that added it is gone.
    let by: String?
    /// Who added it: a name to NetLet, and to a store only for its own people's.
    let uploader: String?
    let mayRemove: Bool
    let createdAt: Date

    var needsAttention: Bool { expiry.kind == "expired" || expiry.kind == "soon" }
}

struct StoreDocumentList: Decodable, Sendable {
    /// False until the table exists on the server: the section says it is not open yet.
    let ready: Bool
    /// Whether the person asking is NetLet, who may also keep a file from the store.
    let netlet: Bool
    /// How many more files this store can hold.
    let room: Int
    let documents: [StoreDocument]
}

/// The kinds a store's document can be, in the form's order, each with its
/// name's key, and how long a name may be — `Shared/inventory/storeDocuments.ts`,
/// written to `content.json` by `pnpm ios:resources`.
struct StoreDocumentRules: Decodable, Sendable {
    struct Kind: Decodable, Hashable, Sendable {
        let kind: String
        let label: String
    }

    let kinds: [Kind]
    let titleMax: Int

    func label(_ kind: String) -> String { kinds.first { $0.kind == kind }?.label ?? "documents.kindOther" }

    static var shared: StoreDocumentRules {
        SiteContent.shared?.selling.storeDocuments ?? StoreDocumentRules(kinds: [], titleMax: 120)
    }
}

extension API {
    struct StoreDocumentScope: Encodable, Sendable {
        /// The store named, or nil for the store the person asking owns.
        var vendorId: Int?
    }

    static let storeDocuments = Procedure<StoreDocumentScope, StoreDocumentList>(query: "storeDocuments.list")

    struct StoreDocumentId: Encodable, Sendable {
        let id: Int
    }

    struct StoreDocumentRemoved: Decodable, Sendable {
        let vendorId: Int
    }

    static let removeStoreDocument = Procedure<StoreDocumentId, StoreDocumentRemoved>(mutation: "storeDocuments.remove")
}
