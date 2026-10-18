import Foundation

/// A store's side of the shop: its listings, the departments to file them under,
/// and uploading their photos.
protocol SellerServicing: Sendable {
    func categories() async throws -> [Category]
    func listings(vendorId: Int?, page: Int) async throws -> SellerProductPage
    func create(_ listing: API.NewListing) async throws -> CreatedListing
    func publish(id: Int) async throws -> String
    func upload(jpeg: Data) async throws -> UploadedPhoto
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
        let answer: (Data, HTTPURLResponse)
        do {
            answer = try await client.transport.send(request)
        } catch {
            throw APIError.from(error)
        }
        let (data, response) = answer
        if (200..<300).contains(response.statusCode) {
            do {
                return try JSONDecoder().decode(UploadedPhoto.self, from: data)
            } catch {
                throw APIError.decoding(String(describing: error))
            }
        }
        struct Refusal: Decodable { let error: String }
        let reason = (try? JSONDecoder().decode(Refusal.self, from: data))?.error ?? "media.failed"
        let code = response.statusCode == 401 ? "UNAUTHORIZED" : response.statusCode == 403 ? "FORBIDDEN" : response.statusCode == 429 ? "TOO_MANY_REQUESTS" : "BAD_REQUEST"
        throw APIError.server(code: code, message: reason, status: response.statusCode)
    }
}
