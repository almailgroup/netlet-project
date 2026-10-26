import Foundation

/// A store's side of the shop: its listings, the departments to file them under,
/// and uploading their photos.
protocol SellerServicing: Sendable {
    func categories() async throws -> [Category]
    func listings(vendorId: Int?, page: Int) async throws -> SellerProductPage
    func create(_ listing: API.NewListing) async throws -> CreatedListing
    func publish(id: Int) async throws -> String
    func upload(jpeg: Data) async throws -> UploadedPhoto
    func uploadDocument(kind: String, fileName: String, contentType: String, data: Data) async throws -> ApplicationDocument
    func downloadDocument(id: Int, fileName: String) async throws -> URL
    /// NetLet's final contract attached to an application, for the applicant to sign (3.3.1).
    func attachContract(applicationId: Int, fileName: String, contentType: String, data: Data) async throws -> ApplicationDocument
}

extension SellerServicing {
    /// A stand-in with no contract step refuses, as the server would a store.
    func attachContract(applicationId: Int, fileName: String, contentType: String, data: Data) async throws -> ApplicationDocument {
        throw APIError.server(code: "FORBIDDEN", message: "documents.notFound", status: 403)
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

    /// A paper from an application, for the administrator reviewing it
    /// (`GET /api/applications/documents/:id`, which answers only the applicant
    /// and an administrator, and anybody else with the same 404). It is saved
    /// under its own name in a folder of its own, for Quick Look to open.
    func downloadDocument(id: Int, fileName: String) async throws -> URL {
        var request = URLRequest(url: client.configuration.url(path: "/api/applications/documents/\(id)"))
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
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("documents/\(id)", isDirectory: true)
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
