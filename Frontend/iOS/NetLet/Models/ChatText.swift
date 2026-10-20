import Foundation

/// An answer from the shop's assistant, read the way the web reads it
/// (`Shared/ai/chatText.ts`): its words, the searches it suggests on lines of
/// their own (`[[search: words]]`) and the questions it offers next
/// (`[[ask: question]]`). A suggestion is a search of NetLet's own shelf,
/// never a product the model names, and one carrying contact details is dropped.
enum ChatPiece: Hashable, Sendable {
    case text(String)
    case search(String)
    case ask(String)
}

enum ChatText {
    static let maxSearches = 3
    static let maxAsks = 3
    private static let maxTerm = 60
    private static let maxQuestion = 80

    private static let marker = try! NSRegularExpression(pattern: #"\[\[\s*(search|ask)\s*:\s*([^\]\n]{1,200}?)\s*\]\]"#, options: [.caseInsensitive])
    private static let term = try! NSRegularExpression(pattern: #"^[\p{L}\p{N}][\p{L}\p{N}\p{M} '&.,+\-]*$"#)
    private static let question = try! NSRegularExpression(pattern: #"^[\p{L}\p{N}][\p{L}\p{N}\p{M} '&.,+\-?!؟،()/%]*$"#)

    private static func acceptable(_ kind: String, _ text: String) -> Bool {
        let shape = kind == "search" ? term : question
        let ceiling = kind == "search" ? maxTerm : maxQuestion
        let length = (text as NSString).length
        return length <= ceiling
            && shape.firstMatch(in: text, range: NSRange(location: 0, length: length)) != nil
            && ContactFilter.findings(text).isEmpty
    }

    /// The pieces of an answer. While it streams, a marker still half-written
    /// is held back rather than shown as `[[sea`.
    static func pieces(_ answer: String, streaming: Bool = false) -> [ChatPiece] {
        var text = answer
        if streaming, let open = text.range(of: "[[", options: .backwards), text.range(of: "]]", range: open.upperBound..<text.endIndex) == nil {
            text = String(text[..<open.lowerBound])
        }
        let string = text as NSString
        var pieces: [ChatPiece] = []
        var seen: [String: Set<String>] = ["search": [], "ask": []]
        var at = 0
        for match in marker.matches(in: text, range: NSRange(location: 0, length: string.length)) {
            let before = string.substring(with: NSRange(location: at, length: match.range.location - at))
            if !before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { pieces.append(.text(before)) }
            at = match.range.location + match.range.length
            let kind = string.substring(with: match.range(at: 1)).lowercased()
            let said = string.substring(with: match.range(at: 2))
                .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            let key = said.lowercased()
            let ceiling = kind == "search" ? maxSearches : maxAsks
            if acceptable(kind, said), seen[kind]?.contains(key) == false, (seen[kind]?.count ?? 0) < ceiling {
                seen[kind]?.insert(key)
                pieces.append(kind == "search" ? .search(said) : .ask(said))
            }
        }
        let rest = string.substring(from: at)
        if !rest.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { pieces.append(.text(rest)) }
        return pieces.compactMap { piece in
            guard case .text(let words) = piece else { return piece }
            let tidy = words.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return tidy.isEmpty ? nil : .text(tidy)
        }
    }

    struct Turn: Sendable {
        let fromShopper: Bool
        let text: String
        /// "streaming", "done", "stopped", "blocked" or "failed".
        let state: String
    }

    /// The questions to offer in the row above the box (`nextQuestions`):
    /// the starters before anything is asked; after an answer, its own
    /// follow-ups less anything already asked, else the starters not yet
    /// asked; and nothing while an answer is coming.
    static func nextQuestions(_ turns: [Turn], starters: [String]) -> (questions: [String], followUps: Bool) {
        guard let last = turns.last else { return (starters, false) }
        if last.fromShopper || last.state == "streaming" { return ([], false) }
        let asked = Set(turns.filter(\.fromShopper).map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        let fresh = { (question: String) in !asked.contains(question.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) }
        let offered = last.state == "done"
            ? pieces(last.text).compactMap { piece -> String? in
                if case .ask(let question) = piece, fresh(question) { return question }
                return nil
            }
            : []
        if !offered.isEmpty { return (offered, true) }
        return (Array(starters.filter(fresh).prefix(maxAsks)), false)
    }
}
