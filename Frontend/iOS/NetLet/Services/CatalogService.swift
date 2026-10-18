import Foundation

/// The shop's shelves: products, one product, what each department holds, and search.
protocol CatalogServicing: Sendable {
    func products(first: Int, department: String?, language: Language) async throws -> [Product]
    func product(handle: String, language: Language) async throws -> Product?
    func departmentCounts() async throws -> [String: Int]
    func search(_ query: String, department: String?, limit: Int, language: Language) async throws -> SearchResult
    func bestsellers(language: Language) async throws -> [Product]
    func stores(language: Language) async throws -> [StoreCard]
    func store(slug: String, language: Language) async throws -> StorePage?
    func brands() async throws -> [BrandCount]
    func contact() async throws -> ShopContact
}

struct CatalogService: CatalogServicing {
    let client: TRPCClient

    func products(first: Int, department: String?, language: Language) async throws -> [Product] {
        try await client.call(API.products, .init(first: first, collectionHandle: department, locale: language.rawValue))
    }

    func product(handle: String, language: Language) async throws -> Product? {
        try await client.call(API.product, .init(handle: handle, locale: language.rawValue))
    }

    func departmentCounts() async throws -> [String: Int] {
        try await client.call(API.departmentCounts)
    }

    func search(_ query: String, department: String?, limit: Int, language: Language) async throws -> SearchResult {
        try await client.call(API.search, .init(q: query, department: department, locale: language.rawValue, limit: limit))
    }

    func bestsellers(language: Language) async throws -> [Product] {
        try await client.call(API.bestsellers, .init(locale: language.rawValue))
    }

    func stores(language: Language) async throws -> [StoreCard] {
        try await client.call(API.stores, .init(locale: language.rawValue))
    }

    func store(slug: String, language: Language) async throws -> StorePage? {
        try await client.call(API.store, .init(slug: slug, locale: language.rawValue))
    }

    func brands() async throws -> [BrandCount] {
        try await client.call(API.brands)
    }

    func contact() async throws -> ShopContact {
        try await client.call(API.contact)
    }
}
