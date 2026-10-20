import Foundation
import Observation

/// One read a screen draws, and its state — what the account's sections each
/// need and no more. It keeps the last answer while it reads again, so a
/// section refreshed after a change does not blink back to an outline, and a
/// failure is drawn only when there is nothing to show instead.
@Observable
@MainActor
final class Loader<Value> {
    private(set) var state: LoadState<Value> = .idle
    private let fetch: @MainActor () async throws -> Value

    init(_ fetch: @escaping @MainActor () async throws -> Value) {
        self.fetch = fetch
    }

    var value: Value? { state.value }

    func load() async {
        if state.value == nil { state = .loading }
        do {
            state = .loaded(try await fetch())
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, state.value == nil { state = .failed(failure) }
        }
    }

    /// The answer a change already returned, drawn without asking again.
    func replace(_ value: Value) {
        state = .loaded(value)
    }
}

extension AppModel {
    /// Runs a change the shopper pressed for: felt as done or refused, a
    /// refusal said in their words (the server's message key, or `fallback`),
    /// and `done` said on success when given. Answers whether it worked.
    @discardableResult
    func attempt(done: String? = nil, fallback: String = "account.preferenceFailed", params: [String: String] = [:], _ work: () async throws -> Void) async -> Bool {
        do {
            try await work()
            Haptics.succeeded()
            if let done { toast(language.t(done)) }
            return true
        } catch {
            let failure = APIError.from(error)
            if failure == .cancelled { return false }
            Haptics.refused()
            let key = failure.messageKey(knownKey: Phrasebook.shared.has)
            toast(language.t(key == "error.serverProblem" ? fallback : key, params))
            return false
        }
    }
}

/// What is waiting in the account — the web's `useAccountSignals`: the
/// server's own counts, asked when the account is opened, and zero outright
/// when signed out, because the last account's are not this one's.
@Observable
@MainActor
final class AccountSignals {
    struct OnTheWay: Decodable, Sendable {
        let count: Int
    }

    private(set) var unreadNotices = 0
    private(set) var unreadMessages = 0
    private(set) var unreadSupport = 0
    private(set) var onTheWay = 0
    private let api: APICalling

    init(api: APICalling) {
        self.api = api
    }

    /// Everything waiting, for the Profile tab's badge.
    var total: Int { unreadNotices + unreadMessages + unreadSupport }

    func refresh() async {
        if let count = try? await api.call(API.unreadNotices) { unreadNotices = count }
        if let count = try? await api.call(API.unreadMessages) { unreadMessages = count }
        if let count = try? await api.call(API.unreadSupport) { unreadSupport = count }
        if let road = try? await api.call(API.onTheWay) { onTheWay = road.count }
    }

    func clear() {
        unreadNotices = 0
        unreadMessages = 0
        unreadSupport = 0
        onTheWay = 0
    }
}
