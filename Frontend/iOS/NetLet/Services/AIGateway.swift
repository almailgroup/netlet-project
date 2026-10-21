import Foundation

/// What `ai.available` says to draw: the shop's conversations, and
/// "Generate with AI" for a seller.
struct AIAvailability: Decodable, Sendable {
    let chat: Bool
    let catalog: Bool
}

/// A token for the gateway, signed by NetLet's server for five minutes, with
/// the gateway's address beside it — never built into the app.
struct GatewaySession: Decodable, Sendable {
    let available: Bool
    let url: String?
    let token: String?
    /// Milliseconds since 1970, as the server writes it.
    let expiresAt: Double?
}

/// The product a question is about, as the product assistant sends it
/// (`briefFor`): the public listing and nothing else — no price, no stock,
/// nothing about the shopper.
struct ProductBrief: Encodable, Hashable, Sendable {
    let title: String
    let category: String?
    let vendor: String?
    let description: String
    let specs: [String]

    init(_ product: Product) {
        let rules = ReferenceData.shared.rules.aiRules
        title = Self.clip(product.title, 200)
        category = product.productType.map { Self.clip($0, 80) }
        vendor = product.vendor.map { Self.clip($0, 120) }
        description = Self.clip(product.description, rules.maxBriefDescription)
        specs = product.attributes
            .filter { $0.namespace != "reviews" }
            .prefix(rules.maxSpecRows)
            .map { "\(Self.clip($0.label, 60)): \(Self.clip($0.value, 160))" }
    }

    private static func clip(_ value: String, _ limit: Int) -> String {
        let flat = value.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
        guard flat.count > limit else { return flat }
        return String(flat.prefix(limit - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }

    /// The questions offered before anybody types, fitted to the product
    /// (`suggestedQuestions`): message keys, at most four.
    var suggestedQuestions: [String] {
        let rules = ReferenceData.shared.rules.aiRules
        let department = rules.departmentQuestions[(category ?? "").trimmingCharacters(in: .whitespaces).lowercased()] ?? []
        let keys = ["assistant.openerWhat"] + department + (specs.isEmpty ? [] : ["assistant.openerSpecs"]) + ["assistant.openerWho"]
        return Array(keys.prefix(rules.maxSuggestions))
    }
}

/// What "Generate with AI" sends (`CatalogAssistRequest`): the seller's
/// notes, the department already chosen, and up to three photos shrunk on
/// the phone.
struct CatalogAssistBody: Encodable, Sendable {
    struct Image: Encodable, Sendable {
        let mimeType: String
        let data: String
    }

    let locale: String
    let notes: String
    let department: String?
    let images: [Image]

    /// `department` is sent as null rather than left out, as the web does.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(locale, forKey: .locale)
        try container.encode(notes, forKey: .notes)
        try container.encode(department, forKey: .department)
        try container.encode(images, forKey: .images)
    }

    private enum CodingKeys: String, CodingKey {
        case locale, notes, department, images
    }
}

/// A listing drafted by the model for the seller to read, change and keep —
/// never saved by itself (`CatalogDraft`), already held to the shop's
/// departments and rows by the gateway (`draftFromModel`).
struct CatalogDraft: Decodable, Equatable, Sendable {
    struct Words: Decodable, Equatable, Sendable {
        let en: String
        let ar: String
    }

    struct Row: Decodable, Equatable, Sendable {
        let key: String
        let value: String
    }

    struct Search: Decodable, Equatable, Sendable {
        let title: String
        let description: String
    }

    let title: Words
    let description: Words
    let department: String?
    let tags: [String]
    let attributes: [Row]
    let missing: [String]
    /// Shown and kept nowhere: the search preview is `productMeta`'s rule.
    let seo: Search
}

extension API {
    static let aiAvailable = Procedure<NoInput, AIAvailability>(query: "ai.available")
    static let chatSession = Procedure<NoInput, GatewaySession>(mutation: "ai.chatSession")

    struct CatalogScope: Encodable, Sendable {
        let vendorId: Int?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(vendorId, forKey: .vendorId)
        }

        private enum CodingKeys: String, CodingKey {
            case vendorId
        }
    }

    /// Signed only for somebody who may create a product in that store.
    static let catalogSession = Procedure<CatalogScope, GatewaySession>(mutation: "ai.catalogSession")
}

/// A refusal from the gateway, by its code (`GATEWAY_ERRORS`).
struct GatewayRefusal: Error, Equatable, Sendable {
    let code: String

    /// What a shopper is told — never the code (`gatewayErrorMessage`).
    var messageKey: String {
        switch code {
        case "rate_limited": return "ai.error.tooMany"
        case "contact_details": return "ai.error.contact"
        case "model_refused": return "ai.error.refused"
        case "too_large": return "ai.error.tooLarge"
        case "bad_request": return "ai.error.invalid"
        default: return "ai.error.unavailable"
        }
    }
}

/// One thing the gateway says while an answer streams.
enum ChatEvent: Equatable, Sendable {
    case delta(String)
    case done(finish: String)
    case failed(code: String)

    /// One `data:` line of the stream, or nil for anything else (`parseChatEvent`).
    static func parse(_ line: String) -> ChatEvent? {
        guard line.hasPrefix("data:") else { return nil }
        let data = Data(line.dropFirst(5).drop(while: { $0 == " " }).utf8)
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = object["type"] as? String else { return nil }
        switch type {
        case "delta": return (object["text"] as? String).map(ChatEvent.delta)
        case "done":
            guard let finish = object["finish"] as? String, ["stop", "length", "blocked"].contains(finish) else { return nil }
            return .done(finish: finish)
        case "error": return (object["code"] as? String).map { .failed(code: $0) }
        default: return nil
        }
    }
}

/// The app's side of the AI gateway (`Backend/gateway/`) — the web's
/// `aiGateway.ts`: a token held until it is about to lapse, the chat route
/// called with it, and its Server-Sent Events read as they come. The token is
/// asked for again once if the gateway refuses it, so a server and a gateway
/// whose secrets disagree fail on the second try rather than looping.
actor AIGateway {
    private struct Ticket {
        let url: URL
        let token: String
        let expires: Date
    }

    private var ticket: Ticket?
    private let mint: @Sendable () async throws -> GatewaySession
    private let session: URLSession

    init(mint: @escaping @Sendable () async throws -> GatewaySession) {
        self.mint = mint
        // No cookies and no cache: the token is the whole of what the gateway needs.
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 45
        session = URLSession(configuration: configuration)
    }

    private func current(fresh: Bool) async throws -> Ticket? {
        if !fresh, let ticket, ticket.expires.timeIntervalSinceNow > 30 { return ticket }
        let answer = try await mint()
        guard answer.available, let address = answer.url.flatMap(URL.init(string:)), let token = answer.token else {
            ticket = nil
            return nil
        }
        let expires = answer.expiresAt.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date().addingTimeInterval(240)
        ticket = Ticket(url: address, token: token, expires: expires)
        return ticket
    }

    /// The chat route's events as a stream, ended when the answer is, and
    /// cancelled with whoever stops reading it.
    nonisolated func chatStream(_ body: ChatRequestBody) -> AsyncThrowingStream<ChatEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    try await self.chat(body) { event in _ = continuation.yield(event) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// Asks the chat route and hands each event to `onEvent` as it arrives.
    func chat(_ body: some Encodable & Sendable, onEvent: @escaping @Sendable (ChatEvent) async -> Void) async throws {
        let payload = try JSONEncoder().encode(body)
        let path = ReferenceData.shared.rules.aiRules.chatPath
        for fresh in [false, true] {
            guard let ticket = try await current(fresh: fresh) else { throw GatewayRefusal(code: "not_configured") }
            var request = URLRequest(url: ticket.url.appendingPathComponent(String(path.drop(while: { $0 == "/" }))))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.setValue("Bearer \(ticket.token)", forHTTPHeaderField: "authorization")
            request.httpBody = payload
            let (bytes, response) = try await session.bytes(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else {
                var body = Data()
                for try await byte in bytes {
                    body.append(byte)
                    if body.count > 64 * 1024 { break }
                }
                let code = ((try? JSONSerialization.jsonObject(with: body)) as? [String: Any])
                    .flatMap { $0["error"] as? [String: Any] }
                    .flatMap { $0["code"] as? String } ?? "model_unavailable"
                if code == "unauthorised" && !fresh {
                    self.ticket = nil
                    continue
                }
                throw GatewayRefusal(code: code)
            }
            for try await line in bytes.lines {
                if let event = ChatEvent.parse(line) { await onEvent(event) }
            }
            return
        }
        throw GatewayRefusal(code: "unauthorised")
    }

    /// Asks the catalogue route for a listing draft. Its answer is one JSON
    /// body, `{ ok, data }` or `{ ok: false, error: { code } }`.
    func catalog(_ body: CatalogAssistBody) async throws -> CatalogDraft {
        struct Answer: Decodable { let data: CatalogDraft }
        let payload = try JSONEncoder().encode(body)
        let path = ReferenceData.shared.rules.aiRules.catalogPath
        for fresh in [false, true] {
            guard let ticket = try await current(fresh: fresh) else { throw GatewayRefusal(code: "not_configured") }
            var request = URLRequest(url: ticket.url.appendingPathComponent(String(path.drop(while: { $0 == "/" }))))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.setValue("Bearer \(ticket.token)", forHTTPHeaderField: "authorization")
            request.httpBody = payload
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            if status == 200, object?["ok"] as? Bool == true {
                return try JSONDecoder().decode(Answer.self, from: data).data
            }
            let code = (object?["error"] as? [String: Any]).flatMap { $0["code"] as? String } ?? "model_unavailable"
            if code == "unauthorised" && !fresh {
                self.ticket = nil
                continue
            }
            throw GatewayRefusal(code: code)
        }
        throw GatewayRefusal(code: "unauthorised")
    }
}
