import Foundation
import Observation

/// One conversation with the shop's assistant — the web's `useAIChat`, for
/// all three: the shop chat, the product page's own and the help page's single
/// question. The turns so far go with each question (at most twelve); the
/// help box sends only its one question, because nothing said before matters
/// to it.
@Observable
@MainActor
final class ChatModel {
    struct Message: Identifiable, Hashable, Sendable {
        let id: Int
        let fromShopper: Bool
        var text: String
        /// "streaming", "done", "stopped", "blocked" or "failed".
        var state: String
    }

    private(set) var messages: [Message] = []
    private(set) var busy = false
    /// The gateway's refusal code for the last question, or a problem with the draft.
    private(set) var error: String?
    /// The product the conversation is about, when there is one.
    var product: ProductBrief?
    let single: Bool
    /// Told when an answer comes whole, so a closed conversation can say one is waiting.
    var onAnswered: (() -> Void)?

    private let gateway: AIGateway
    private let language: @MainActor () -> Language
    private var nextId = 1
    private var running: Task<Void, Never>?

    init(gateway: AIGateway, product: ProductBrief? = nil, single: Bool = false, language: @escaping @MainActor () -> Language) {
        self.gateway = gateway
        self.product = product
        self.single = single
        self.language = language
    }

    var last: Message? { messages.last }
    var failed: Message? { last.flatMap { !$0.fromShopper && $0.state == "failed" ? $0 : nil } }

    /// Why a draft cannot go, before it is sent (`chatDraftProblem`): empty,
    /// too long, or carrying contact details — which the gateway refuses too.
    nonisolated static func draftProblem(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "empty" }
        if trimmed.count > ReferenceData.shared.rules.aiRules.maxChatText { return "too_large" }
        return ContactFilter.findings(trimmed).isEmpty ? nil : "contact_details"
    }

    /// The questions for the row above the box.
    func offer(starters: [String]) -> (questions: [String], followUps: Bool) {
        ChatText.nextQuestions(messages.map { .init(fromShopper: $0.fromShopper, text: $0.text, state: $0.state) }, starters: starters)
    }

    @discardableResult
    func send(_ text: String) -> Bool {
        ask(text, after: messages)
    }

    /// Asks the last question again in its own place, rather than twice.
    func retry() {
        guard !busy, let at = messages.lastIndex(where: \.fromShopper) else { return }
        ask(messages[at].text, after: Array(messages[..<at]))
    }

    func stop() {
        running?.cancel()
    }

    func reset() {
        running?.cancel()
        messages = []
        error = nil
    }

    func dismissError() { error = nil }

    private func ask(_ text: String, after base: [Message]) -> Bool {
        if let problem = Self.draftProblem(text) {
            if problem != "empty" { error = problem }
            return false
        }
        guard !busy else { return false }
        error = nil
        let question = Message(id: nextId, fromShopper: true, text: text.trimmingCharacters(in: .whitespacesAndNewlines), state: "done")
        let answer = Message(id: nextId + 1, fromShopper: false, text: "", state: "streaming")
        nextId += 2
        let rules = ReferenceData.shared.rules.aiRules
        var history = (single ? [] : base.filter { !$0.text.isEmpty && $0.state != "failed" }) + [question]
        history = Array(history.suffix(rules.maxChatTurns))
        while let first = history.first, !first.fromShopper { history.removeFirst() }
        let body = ChatRequestBody(
            locale: language().rawValue,
            messages: history.map { .init(role: $0.fromShopper ? "user" : "assistant", text: String($0.text.prefix(rules.maxChatText))) },
            product: product
        )
        messages = (single ? [] : base) + [question, answer]
        busy = true
        Haptics.tap()
        let stream = gateway.chatStream(body)
        running = Task {
            var finish = "done"
            do {
                for try await event in stream {
                    switch event {
                    case .delta(let words): update(answer.id) { $0.text += words }
                    case .done(let how): finish = how == "blocked" ? "blocked" : "done"
                    case .failed(let code):
                        finish = "failed"
                        error = code
                    }
                }
                if Task.isCancelled { finish = "stopped" }
            } catch let refusal as GatewayRefusal {
                finish = "failed"
                error = refusal.code
            } catch {
                if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled {
                    finish = "stopped"
                } else {
                    finish = "failed"
                    self.error = "model_unavailable"
                }
            }
            update(answer.id) { if $0.state == "streaming" { $0.state = finish } }
            busy = false
            running = nil
            if finish == "done" {
                Haptics.succeeded()
                onAnswered?()
            } else if finish == "failed" {
                Haptics.refused()
            }
        }
        return true
    }

    private func update(_ id: Int, _ change: (inout Message) -> Void) {
        guard let at = messages.firstIndex(where: { $0.id == id }) else { return }
        change(&messages[at])
    }
}

/// What the chat route takes (`ChatRequest`).
struct ChatRequestBody: Encodable, Sendable {
    struct Turn: Encodable, Sendable {
        let role: String
        let text: String
    }

    let locale: String
    let messages: [Turn]
    let product: ProductBrief?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(locale, forKey: .locale)
        try container.encode(messages, forKey: .messages)
        try container.encode(product, forKey: .product)
    }

    private enum CodingKeys: String, CodingKey { case locale, messages, product }
}
