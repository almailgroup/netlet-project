import Foundation

/// A call to NetLet's tRPC API, typed by what it takes and what it answers.
///
/// The server has no REST routes: every operation is a tRPC procedure under
/// `/api/trpc/<name>`, a query read with GET or a mutation sent with POST.
/// Declaring each one as a value of this type (see `Procedures.swift`) means
/// a call cannot send the wrong shape or read the answer as the wrong type.
struct Procedure<Input: Encodable & Sendable, Output: Decodable & Sendable>: Sendable {
    enum Kind: Sendable {
        case query
        case mutation
    }

    let path: String
    let kind: Kind

    init(query path: String) {
        self.path = path
        kind = .query
    }

    init(mutation path: String) {
        self.path = path
        kind = .mutation
    }
}

/// The input of a procedure that takes none.
struct NoInput: Encodable, Sendable {}

/// Speaks tRPC over HTTP with the server's transformer, superjson.
///
/// superjson wraps a value as `{ "json": … }` (with a `meta` beside it naming
/// which strings are dates), in both directions: a query sends
/// `?input={"json":…}`, a mutation posts the same object, and an answer comes
/// back as `{ "result": { "data": { "json": … } } }` or
/// `{ "error": { "json": { "message", "code", "data": { "code", "httpStatus" } } } }`.
/// Dates arrive as ISO 8601 strings, which the decoder reads.
final class TRPCClient: Sendable {
    let configuration: APIConfiguration
    let transport: HTTPTransport

    init(configuration: APIConfiguration, transport: HTTPTransport) {
        self.configuration = configuration
        self.transport = transport
    }

    func call<Input, Output>(_ procedure: Procedure<Input, Output>, _ input: Input) async throws -> Output {
        let request = try makeRequest(procedure, input: input)
        return try await perform(request, as: Output.self)
    }

    func call<Output>(_ procedure: Procedure<NoInput, Output>) async throws -> Output {
        let request = try makeRequest(procedure, input: nil)
        return try await perform(request, as: Output.self)
    }

    // MARK: Requests

    func makeRequest<Input, Output>(_ procedure: Procedure<Input, Output>, input: Input?) throws -> URLRequest {
        let endpoint = configuration.url(path: "/api/trpc/\(procedure.path)")
        var request: URLRequest
        switch procedure.kind {
        case .query:
            if let input, !(input is NoInput) {
                let json = try TRPCClient.encodeInput(input)
                let query = "input=" + TRPCClient.percentEncode(json)
                var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
                components?.percentEncodedQuery = query
                request = URLRequest(url: components?.url ?? endpoint)
            } else {
                request = URLRequest(url: endpoint)
            }
            request.httpMethod = "GET"
        case .mutation:
            request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let input, !(input is NoInput) {
                request.httpBody = Data(try TRPCClient.encodeInput(input).utf8)
            } else {
                request.httpBody = Data(#"{"json":null}"#.utf8)
            }
        }
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private struct Wrapped<Value: Encodable>: Encodable {
        let json: Value
    }

    static func encodeInput<Input: Encodable>(_ input: Input) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(Wrapped(json: input))
        return String(decoding: data, as: UTF8.self)
    }

    /// Everything but the unreserved characters, so `&`, `+` and `=` inside the
    /// JSON cannot be read as separators by the server's query parser.
    static func percentEncode(_ text: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
    }

    // MARK: Answers

    private func perform<Output: Decodable>(_ request: URLRequest, as type: Output.Type) async throws -> Output {
        let answer: (Data, HTTPURLResponse)
        do {
            answer = try await transport.send(request)
        } catch {
            throw APIError.from(error)
        }
        return try TRPCClient.decode(answer.0, status: answer.1.statusCode, as: type)
    }

    private struct Success<Value: Decodable>: Decodable {
        struct Result: Decodable {
            struct Payload: Decodable {
                let json: Value
            }

            let data: Payload
        }

        let result: Result
    }

    private struct Failure: Decodable {
        struct Wrapper: Decodable {
            struct Body: Decodable {
                struct Details: Decodable {
                    let code: String?
                    let httpStatus: Int?
                }

                let message: String
                let data: Details?
            }

            let json: Body
        }

        let error: Wrapper
    }

    static func decode<Output: Decodable>(_ data: Data, status: Int, as type: Output.Type) throws -> Output {
        let decoder = makeDecoder()
        if (200..<300).contains(status) {
            do {
                return try decoder.decode(Success<Output>.self, from: data).result.data.json
            } catch {
                throw APIError.decoding(String(describing: error))
            }
        }
        if let failure = try? decoder.decode(Failure.self, from: data) {
            let body = failure.error.json
            throw APIError.server(
                code: body.data?.code ?? "INTERNAL_SERVER_ERROR",
                message: body.message,
                status: body.data?.httpStatus ?? status
            )
        }
        throw APIError.unexpected(status: status)
    }

    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            if let date = ISO8601.withFraction.date(from: text) ?? ISO8601.plain.date(from: text) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an ISO 8601 date: \(text)")
        }
        return decoder
    }
}

/// The two shapes a server date takes: with milliseconds, as JavaScript writes
/// them, and without.
enum ISO8601 {
    nonisolated(unsafe) static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    nonisolated(unsafe) static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
}
