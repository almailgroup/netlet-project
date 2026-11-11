import Foundation

/// A store's side of the shop: its listings, the departments to file them under,
/// and uploading their photos.
protocol SellerServicing: Sendable {
    func categories() async throws -> [Category]
    func listings(vendorId: Int?, page: Int) async throws -> SellerProductPage
    func create(_ listing: API.NewListing) async throws -> CreatedListing
    func publish(id: Int) async throws -> String
    func upload(jpeg: Data) async throws -> UploadedPhoto
    /// The same upload, saying where the picture came from — a maker's page
    /// (3.1.10) — which the server keeps as the uploader's own note.
    func upload(jpeg: Data, source: String?) async throws -> UploadedPhoto
    /// One image from a maker's page, fetched by NetLet's server
    /// (`POST /api/media/remote`), so the phone never contacts the maker.
    func remoteImage(url: String) async throws -> Data
    /// The photo put on white by a model (`POST /api/media/ai-clean`), handed
    /// back for the seller to look at; nothing is stored until they choose it.
    func cleanUpPhoto(jpeg: Data) async throws -> Data
    /// A shopper's photo for a review (`POST /api/media/review`): the same
    /// checks as a store's, for somebody who has had something delivered.
    func uploadReviewPhoto(jpeg: Data) async throws -> UploadedPhoto
    func uploadDocument(kind: String, fileName: String, contentType: String, data: Data) async throws -> ApplicationDocument
    func downloadDocument(id: Int, fileName: String) async throws -> URL
    /// NetLet's final contract attached to an application, for the applicant to sign (3.3.1).
    func attachContract(applicationId: Int, fileName: String, contentType: String, data: Data) async throws -> ApplicationDocument
    /// A paper added to a store's own documents (`POST /api/vendors/:id/documents`),
    /// by NetLet or by the store's owner.
    func uploadStoreDocument(vendorId: Int, upload: StoreDocumentUpload) async throws -> StoreDocument
    /// One of a store's documents, saved for Quick Look to open
    /// (`GET /api/vendors/documents/:id`).
    func downloadStoreDocument(id: Int, fileName: String) async throws -> URL
}

/// What goes up with a store's document: the file, and what it is.
struct StoreDocumentUpload: Sendable {
    let kind: String
    var title: String?
    /// The paper's last day, `yyyy-mm-dd` on Kuwait's calendar, or nil.
    var expiresOn: String?
    /// NetLet's alone to set; the server ignores it from anybody else.
    var netletOnly = false
    let fileName: String
    let contentType: String
    let data: Data
}

extension SellerServicing {
    // What a stand-in answers for the calls only the real server can make.
    func upload(jpeg: Data, source: String?) async throws -> UploadedPhoto { try await upload(jpeg: jpeg) }

    func remoteImage(url: String) async throws -> Data {
        throw APIError.server(code: "BAD_REQUEST", message: "manufacturer.unreachable", status: 400)
    }

    func cleanUpPhoto(jpeg: Data) async throws -> Data {
        throw APIError.server(code: "PRECONDITION_FAILED", message: "drawing.off", status: 503)
    }

    /// A stand-in that takes no review photos refuses, as the server would a shopper with nothing delivered.
    func uploadReviewPhoto(jpeg: Data) async throws -> UploadedPhoto {
        throw APIError.server(code: "FORBIDDEN", message: "media.notAllowed", status: 403)
    }

    /// A stand-in with no contract step refuses, as the server would a store.
    func attachContract(applicationId: Int, fileName: String, contentType: String, data: Data) async throws -> ApplicationDocument {
        throw APIError.server(code: "FORBIDDEN", message: "documents.notFound", status: 403)
    }

    /// A stand-in keeps no store documents: it answers as the server does before the section is open.
    func uploadStoreDocument(vendorId: Int, upload: StoreDocumentUpload) async throws -> StoreDocument {
        throw APIError.server(code: "BAD_REQUEST", message: "storeDocs.unavailable", status: 503)
    }

    func downloadStoreDocument(id: Int, fileName: String) async throws -> URL {
        throw APIError.server(code: "NOT_FOUND", message: "documents.failed", status: 404)
    }
}

struct SellerService: SellerServicing {
    let client: TRPCClient

    func categories() async throws -> [Category] { try await client.call(API.categories) }

    func listings(vendorId: Int?, page: Int) async throws -> SellerProductPage {
        try await client.call(API.sellerProducts, .init(vendorId: vendorId, page: page, pageSize: 30))
    }

    func create(_ listing: API.NewListing) async throws -> CreatedListing {
        try await client.call(API.createListing, listing)
    }

    func publish(id: Int) async throws -> String {
        try await client.call(API.setListingStatus, .init(id: id, status: "published"))
    }

    /// A photo goes up on its own route, `POST /api/media`, as the image's bytes
    /// rather than JSON: the API's JSON limit is small on purpose. The server
    /// reads what the file is from its own header and trusts nothing else; it
    /// answers `{ "error": "media.…" }` when it refuses one.
    func upload(jpeg: Data) async throws -> UploadedPhoto {
        var request = URLRequest(url: client.configuration.url(path: "/api/media"))
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = jpeg
        return try await send(request, fallback: "media.failed")
    }

    func upload(jpeg: Data, source: String?) async throws -> UploadedPhoto {
        var request = URLRequest(url: client.configuration.url(path: "/api/media"))
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        // A header holds plain ASCII: an address that is anything else goes unsaid.
        if let source, source.count <= 2048, source.unicodeScalars.allSatisfy({ $0.value > 32 && $0.value < 127 }) {
            request.setValue(source, forHTTPHeaderField: "X-NetLet-Source")
        }
        request.httpBody = jpeg
        return try await send(request, fallback: "media.failed")
    }

    func remoteImage(url: String) async throws -> Data {
        var request = URLRequest(url: client.configuration.url(path: "/api/media/remote"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["url": url])
        return try await bytes(request, fallback: "manufacturer.unreachable")
    }

    func cleanUpPhoto(jpeg: Data) async throws -> Data {
        var request = URLRequest(url: client.configuration.url(path: "/api/media/ai-clean"))
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        // A picture is drawn, which takes the model most of a minute at worst.
        request.timeoutInterval = 70
        request.httpBody = jpeg
        return try await bytes(request, fallback: "drawing.failed")
    }

    /// A route that answers with a picture's own bytes, or `{ "error": … }`.
    private func bytes(_ request: URLRequest, fallback: String) async throws -> Data {
        let answer: (Data, HTTPURLResponse)
        do {
            answer = try await client.transport.send(request)
        } catch {
            throw APIError.from(error)
        }
        let (data, response) = answer
        if (200..<300).contains(response.statusCode) { return data }
        let reason = (try? JSONDecoder().decode(UploadRefusal.self, from: data))?.error ?? fallback
        let code = response.statusCode == 401 ? "UNAUTHORIZED" : response.statusCode == 403 ? "FORBIDDEN" : response.statusCode == 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST"
        throw APIError.server(code: code, message: reason, status: response.statusCode)
    }

    func uploadReviewPhoto(jpeg: Data) async throws -> UploadedPhoto {
        var request = URLRequest(url: client.configuration.url(path: "/api/media/review"))
        request.httpMethod = "POST"
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = jpeg
        return try await send(request, fallback: "review.photoFailed")
    }

    /// A paper for a store application goes up on its own route too
    /// (`POST /api/applications/documents`), never to `/media`: a civil ID must
    /// not be public at any address. The server reads what the file is from
    /// its first bytes and refuses one that is not what it says.
    func uploadDocument(kind: String, fileName: String, contentType: String, data: Data) async throws -> ApplicationDocument {
        var request = URLRequest(url: client.configuration.url(path: "/api/applications/documents"))
        request.httpMethod = "POST"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue(kind, forHTTPHeaderField: "X-NetLet-Document-Kind")
        request.setValue(fileName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "document", forHTTPHeaderField: "X-NetLet-File-Name")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = data
        return try await send(request, fallback: "documents.failed")
    }

    /// The same door as an applicant's papers, naming the application: the
    /// server lets only an administrator attach a contract.
    func attachContract(applicationId: Int, fileName: String, contentType: String, data: Data) async throws -> ApplicationDocument {
        var request = URLRequest(url: client.configuration.url(path: "/api/applications/documents"))
        request.httpMethod = "POST"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.setValue("contract", forHTTPHeaderField: "X-NetLet-Document-Kind")
        request.setValue("\(applicationId)", forHTTPHeaderField: "X-NetLet-Application-Id")
        request.setValue(fileName.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "contract", forHTTPHeaderField: "X-NetLet-File-Name")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = data
        return try await send(request, fallback: "documents.failed")
    }

    /// A store's own document goes up on a route of its own
    /// (`POST /api/vendors/:id/documents`): what it is rides in headers, the
    /// words percent-encoded, and the server reads what the file is from its
    /// first bytes. Who may add to which store is the server's question.
    func uploadStoreDocument(vendorId: Int, upload: StoreDocumentUpload) async throws -> StoreDocument {
        var request = URLRequest(url: client.configuration.url(path: "/api/vendors/\(vendorId)/documents"))
        request.httpMethod = "POST"
        request.setValue(upload.contentType, forHTTPHeaderField: "Content-Type")
        request.setValue(upload.kind, forHTTPHeaderField: "X-NetLet-Document-Kind")
        request.setValue(Self.headerWords(upload.fileName) ?? "document", forHTTPHeaderField: "X-NetLet-File-Name")
        if let title = upload.title, let words = Self.headerWords(title) { request.setValue(words, forHTTPHeaderField: "X-NetLet-Document-Title") }
        if let day = upload.expiresOn { request.setValue(day, forHTTPHeaderField: "X-NetLet-Document-Expires") }
        if upload.netletOnly { request.setValue("1", forHTTPHeaderField: "X-NetLet-Only") }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = upload.data
        return try await send(request, fallback: "documents.failed")
    }

    /// Words made safe for a header, which the server reads back with
    /// `decodeURIComponent`: every character outside ASCII percent-encoded
    /// (the set is ASCII's own, so an Arabic name never rides raw), as the
    /// application documents' file name is.
    private static func headerWords(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return trimmed.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
    }

    /// One of a store's documents (`GET /api/vendors/documents/:id`, which
    /// answers NetLet and the store's owner, and anybody else with the same
    /// 404), saved under its own name for Quick Look to open.
    func downloadStoreDocument(id: Int, fileName: String) async throws -> URL {
        try await download(path: "/api/vendors/documents/\(id)", folder: "store-documents/\(id)", fileName: fileName)
    }

    /// A paper from an application, for the administrator reviewing it
    /// (`GET /api/applications/documents/:id`, which answers only the applicant
    /// and an administrator, and anybody else with the same 404). It is saved
    /// under its own name in a folder of its own, for Quick Look to open.
    func downloadDocument(id: Int, fileName: String) async throws -> URL {
        try await download(path: "/api/applications/documents/\(id)", folder: "documents/\(id)", fileName: fileName)
    }

    /// Fetches a private file and saves it in a temporary folder of its own.
    private func download(path: String, folder name: String, fileName: String) async throws -> URL {
        var request = URLRequest(url: client.configuration.url(path: path))
        request.httpMethod = "GET"
        let answer: (Data, HTTPURLResponse)
        do {
            answer = try await client.transport.send(request)
        } catch {
            throw APIError.from(error)
        }
        guard (200..<300).contains(answer.1.statusCode) else {
            throw APIError.server(code: answer.1.statusCode == 403 ? "FORBIDDEN" : "NOT_FOUND", message: "documents.failed", status: answer.1.statusCode)
        }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let safe = fileName.replacingOccurrences(of: "/", with: "-")
        let file = folder.appendingPathComponent(safe.isEmpty ? "document" : safe)
        try answer.0.write(to: file, options: .atomic)
        return file
    }

    /// Sends a raw upload and reads its answer, or the key it was refused with.
    private func send<Answer: Decodable>(_ request: URLRequest, fallback: String) async throws -> Answer {
        let answer: (Data, HTTPURLResponse)
        do {
            answer = try await client.transport.send(request)
        } catch {
            throw APIError.from(error)
        }
        let (data, response) = answer
        if (200..<300).contains(response.statusCode) {
            do {
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .custom { decoder in
                    let text = try decoder.singleValueContainer().decode(String.self)
                    return ISO8601.withFraction.date(from: text) ?? ISO8601.plain.date(from: text) ?? Date()
                }
                return try decoder.decode(Answer.self, from: data)
            } catch {
                throw APIError.decoding(String(describing: error))
            }
        }
        let reason = (try? JSONDecoder().decode(UploadRefusal.self, from: data))?.error ?? fallback
        let code = response.statusCode == 401 ? "UNAUTHORIZED" : response.statusCode == 403 ? "FORBIDDEN" : response.statusCode == 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST"
        throw APIError.server(code: code, message: reason, status: response.statusCode)
    }
}

/// What an upload route answers when it refuses: `{ "error": "media.…" }`.
private struct UploadRefusal: Decodable {
    let error: String
}
