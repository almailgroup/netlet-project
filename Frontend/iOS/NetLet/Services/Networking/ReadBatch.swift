import Foundation

/// Reads asked within a moment of each other, sent to the server as one tRPC
/// batch — the web client's `httpBatchStreamLink` — and handed back one by one.
///
/// A screen asks for several things as it opens: the Profile tab a dozen, the
/// home page half that. Sent one request each, every one is a function call on
/// Vercel, and a burst of them at once is what makes the platform start a
/// second server (measured on the portal: of six at once, two waited 1.2–1.9s
/// for a new one). Sent as one, it is one call, which the server answers by
/// running the procedures side by side (`gateQueries` holds them to its five
/// connections). The address is `/api/trpc/a,b,c?batch=1&input={"0":…,"2":…}`,
/// a procedure that takes nothing leaving its number out, and the answer an
/// array with one entry per procedure, each a success or that procedure's own
/// refusal — so a refusal stays the one read's, never the batch's.
///
/// A read alone in its moment goes as it always did, at its own address, so
/// nothing that reads an address — `ShelfMemory`, a log — sees a difference.
/// Only reads: a mutation is never held back or joined to anything.
final class ReadBatch: @unchecked Sendable {
    /// How long the first read of a batch waits for others to join it.
    static let window: Duration = .milliseconds(8)
    /// The most reads one batch carries (the web's `maxItems` is 50).
    static let mostReads = 25
    /// An address longer than this is sent as two batches; the web holds its
    /// own under 7,000 characters, which every proxy on the way takes.
    static let longestAddress = 6_000

    private struct Waiting: Sendable {
        let request: URLRequest
        let path: String
        /// The read's own input as sent (`{"json":…}`), or nil for none.
        let input: String?
        let continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>

        /// What it adds to a batch's address: its name, a comma, and its input encoded.
        var length: Int { path.count + 1 + (input.map { TRPCClient.percentEncode($0).count + 8 } ?? 0) }
    }

    private let configuration: APIConfiguration
    private let transport: HTTPTransport
    /// How long this batch's first read waits — `window`, or longer in a test.
    private let pause: Duration
    private let lock = NSLock()
    private var waiting: [Waiting] = []
    private var waitingLength = 0
    private var scheduled = false

    init(configuration: APIConfiguration, transport: HTTPTransport, window: Duration = ReadBatch.window) {
        self.configuration = configuration
        self.transport = transport
        pause = window
    }

    /// The answer to one read, sent with whatever else is asked in the same moment.
    func read(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let parts = Self.parts(of: request) else { return try await transport.send(request) }
        return try await withCheckedThrowingContinuation { continuation in
            let entry = Waiting(request: request, path: parts.path, input: parts.input, continuation: continuation)
            var due: [[Waiting]] = []
            var schedule = false
            lock.withLock {
                // One that would make the address too long goes in the next batch.
                if !waiting.isEmpty, Self.baseLength + waitingLength + entry.length > Self.longestAddress {
                    due.append(waiting)
                    waiting = []
                    waitingLength = 0
                }
                waiting.append(entry)
                waitingLength += entry.length
                if waiting.count >= Self.mostReads {
                    due.append(waiting)
                    waiting = []
                    waitingLength = 0
                } else if !scheduled {
                    scheduled = true
                    schedule = true
                }
            }
            for batch in due { Task { await self.send(batch) } }
            if schedule {
                Task {
                    try? await Task.sleep(for: self.pause)
                    let batch: [Waiting] = self.lock.withLock {
                        let taken = self.waiting
                        self.waiting = []
                        self.waitingLength = 0
                        self.scheduled = false
                        return taken
                    }
                    if !batch.isEmpty { await self.send(batch) }
                }
            }
        }
    }

    /// `/api/trpc/` and `?batch=1&input=` and the braces round the inputs.
    private static let baseLength = 64

    /// The procedure's name and its input from a read's own address.
    private static func parts(of request: URLRequest) -> (path: String, input: String?)? {
        guard request.httpMethod == "GET", let url = request.url else { return nil }
        let prefix = "/api/trpc/"
        guard let start = url.path.range(of: prefix) else { return nil }
        let path = String(url.path[start.upperBound...])
        guard !path.isEmpty, !path.contains(",") else { return nil }
        guard let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery, !query.isEmpty else {
            return (path, nil)
        }
        guard query.hasPrefix("input="), let input = String(query.dropFirst(6)).removingPercentEncoding else { return nil }
        return (path, input)
    }

    private func send(_ batch: [Waiting]) async {
        if batch.count == 1, let only = batch.first {
            do {
                only.continuation.resume(returning: try await transport.send(only.request))
            } catch {
                only.continuation.resume(throwing: error)
            }
            return
        }
        let request = makeRequest(batch)
        let answer: (Data, HTTPURLResponse)
        do {
            answer = try await transport.send(request)
        } catch {
            for entry in batch { entry.continuation.resume(throwing: error) }
            return
        }
        let parts = Self.split(answer.0, count: batch.count)
        for (index, entry) in batch.enumerated() {
            let url = entry.request.url ?? request.url!
            if let parts {
                let response = HTTPURLResponse(url: url, statusCode: parts[index].status, httpVersion: "HTTP/1.1", headerFields: answer.1.allHeaderFields as? [String: String])!
                entry.continuation.resume(returning: (parts[index].data, response))
            } else {
                // Not an answer per read — a limiter's refusal, a platform's
                // error page — so every read gets it whole and reads it as its own.
                entry.continuation.resume(returning: answer)
            }
        }
    }

    private func makeRequest(_ batch: [Waiting]) -> URLRequest {
        let endpoint = configuration.url(path: "/api/trpc/" + batch.map(\.path).joined(separator: ","))
        let inputs = batch.enumerated().compactMap { index, entry in entry.input.map { "\"\(index)\":\($0)" } }
        var components = URLComponents(url: endpoint, resolvingAgainstBaseURL: false)
        components?.percentEncodedQuery = "batch=1&input=" + TRPCClient.percentEncode("{" + inputs.joined(separator: ",") + "}")
        var request = URLRequest(url: components?.url ?? endpoint)
        request.httpMethod = "GET"
        // The headers every read carries: what it accepts, and the device secret where there is one.
        for (field, value) in batch[0].request.allHTTPHeaderFields ?? [:] {
            request.setValue(value, forHTTPHeaderField: field)
        }
        return request
    }

    /// Each read's own answer out of the batch's array, with the status it
    /// would have had alone: 200 for a result, its refusal's own otherwise.
    static func split(_ data: Data, count: Int) -> [(data: Data, status: Int)]? {
        guard let entries = try? JSONSerialization.jsonObject(with: data) as? [Any], entries.count == count else { return nil }
        var parts: [(data: Data, status: Int)] = []
        for entry in entries {
            guard let object = entry as? [String: Any], let bytes = try? JSONSerialization.data(withJSONObject: object) else { return nil }
            if let error = object["error"] as? [String: Any] {
                let details = (error["json"] as? [String: Any])?["data"] as? [String: Any]
                parts.append((bytes, details?["httpStatus"] as? Int ?? 500))
            } else {
                parts.append((bytes, 200))
            }
        }
        return parts
    }
}
