import Foundation

/// The seller's mini tutorials for adding products, on the owner's word —
/// the website's (`sellerTutorials.ts`, exported to `sellerTutorials.json` by
/// `pnpm ios:resources`), so the app plays the steps the website plays.
///
/// A tutorial is a few short scenes, and a scene is the form's own parts
/// acting themselves out on a clock: a name typed, a department chosen, photos
/// dropping in, a button pressed. Every word is a dictionary key, a department
/// by its slug, or a literal such as a price.
struct SellerTutorial: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let title: String
    let scenes: [TutorialScene]

    /// Every tutorial, in the website's order.
    static let all: [SellerTutorial] = File.shared.tutorials

    static func named(_ id: String) -> SellerTutorial? { all.first { $0.id == id } }

    struct File: Decodable, Sendable {
        let motionLimit: Double
        let settle: Double
        let tutorials: [SellerTutorial]

        static let shared: File = (try? JSONDecoder().decode(File.self, from: Bundle.main.resource("sellerTutorials", "json")))
            ?? File(motionLimit: 4600, settle: 400, tutorials: [])
    }
}

struct TutorialScene: Decodable, Hashable, Sendable {
    let caption: TutorialWords
    let parts: [TutorialPart]
}

/// A piece of text on screen: a key with its values, a department, or a literal.
struct TutorialWords: Decodable, Hashable, Sendable {
    enum Value: Hashable, Sendable { case text(String), key(String) }
    enum Kind: Hashable, Sendable { case key(String, [String: Value]), department(String), raw(String) }
    let kind: Kind

    init(raw: String) { kind = .raw(raw) }
    init(key: String) { kind = .key(key, [:]) }

    private enum Keys: String, CodingKey { case key, params, dept, raw }

    private struct Param: Decodable {
        let value: Value
        init(from decoder: Decoder) throws {
            if let container = try? decoder.singleValueContainer() {
                if let text = try? container.decode(String.self) { value = .text(text); return }
                if let number = try? container.decode(Int.self) { value = .text(String(number)); return }
            }
            let keyed = try decoder.container(keyedBy: Keys.self)
            value = .key(try keyed.decode(String.self, forKey: .key))
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        if let raw = try container.decodeIfPresent(String.self, forKey: .raw) {
            kind = .raw(raw)
        } else if let department = try container.decodeIfPresent(String.self, forKey: .dept) {
            kind = .department(department)
        } else {
            let params = try container.decodeIfPresent([String: Param].self, forKey: .params) ?? [:]
            kind = .key(try container.decode(String.self, forKey: .key), params.mapValues(\.value))
        }
    }

    /// What it reads in the language shown.
    @MainActor
    func text(_ l: LanguageSettings) -> String {
        switch kind {
        case .raw(let text):
            return text
        case .department(let slug):
            let department = ReferenceData.shared.department(slug: slug)
            return (l.current == .ar ? department?.nameAr : department?.name) ?? slug
        case .key(let key, let params):
            return l.t(key, params.mapValues { value in
                switch value {
                case .text(let text): return text
                case .key(let key): return l.t(key)
                }
            })
        }
    }

    /// Every dictionary key it names, its values' included.
    var keys: [String] {
        guard case .key(let key, let params) = kind else { return [] }
        return [key] + params.values.compactMap { if case .key(let key) = $0 { return key } else { return nil } }
    }
}

/// One part of a scene. Every time is milliseconds from the scene's start.
struct TutorialPart: Decodable, Hashable, Sendable {
    struct FixOption: Decodable, Hashable, Sendable { let label: TutorialWords; let look: String }
    struct Row: Decodable, Hashable, Sendable { let cells: [TutorialWords]; let at: Double }
    struct Item: Hashable, Sendable { let words: TutorialWords; let at: Double; let tone: String? }

    let kind: String
    var label: TutorialWords?
    var value: TutorialWords?
    var text: TutorialWords?
    var title: TutorialWords?
    /// When it happens; for photos, the first drop.
    var at: Double = 0
    /// Photos: when each drops in.
    var times: [Double] = []
    var lines = 1
    var direction: String?
    var fill = false
    var tone: String?
    var icon: String?
    var pick = 0
    var was = false
    var style: String?
    var head: [TutorialWords] = []
    var options: [FixOption] = []
    var rows: [Row] = []
    /// Bullets' points and statuses (with their times) and chips' choices (without).
    var items: [Item] = []

    private enum Keys: String, CodingKey { case kind, label, value, text, title, at, lines, dir, fill, tone, icon, pick, was, style, head, options, rows, items }
    private struct Timed: Decodable { let text: TutorialWords?; let label: TutorialWords?; let at: Double; let tone: String? }

    init(kind: String) { self.kind = kind }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        kind = try container.decode(String.self, forKey: .kind)
        label = try container.decodeIfPresent(TutorialWords.self, forKey: .label)
        value = try container.decodeIfPresent(TutorialWords.self, forKey: .value)
        text = try container.decodeIfPresent(TutorialWords.self, forKey: .text)
        title = try container.decodeIfPresent(TutorialWords.self, forKey: .title)
        if kind == "photos" {
            times = try container.decode([Double].self, forKey: .at)
            at = times.first ?? 0
        } else {
            at = try container.decodeIfPresent(Double.self, forKey: .at) ?? 0
        }
        lines = try container.decodeIfPresent(Int.self, forKey: .lines) ?? 1
        direction = try container.decodeIfPresent(String.self, forKey: .dir)
        fill = try container.decodeIfPresent(Bool.self, forKey: .fill) ?? false
        tone = try container.decodeIfPresent(String.self, forKey: .tone)
        icon = try container.decodeIfPresent(String.self, forKey: .icon)
        pick = try container.decodeIfPresent(Int.self, forKey: .pick) ?? 0
        was = try container.decodeIfPresent(Bool.self, forKey: .was) ?? false
        style = try container.decodeIfPresent(String.self, forKey: .style)
        head = try container.decodeIfPresent([TutorialWords].self, forKey: .head) ?? []
        options = try container.decodeIfPresent([FixOption].self, forKey: .options) ?? []
        rows = try container.decodeIfPresent([Row].self, forKey: .rows) ?? []
        if kind == "chips" {
            items = try container.decode([TutorialWords].self, forKey: .items).map { Item(words: $0, at: 0, tone: nil) }
        } else if container.contains(.items) {
            items = try container.decode([Timed].self, forKey: .items).compactMap { timed in
                (timed.text ?? timed.label).map { Item(words: $0, at: timed.at, tone: timed.tone) }
            }
        }
    }

    /// Every piece of text it puts on screen.
    var words: [TutorialWords] {
        [label, value, text, title].compactMap { $0 } + head + options.map(\.label) + rows.flatMap(\.cells) + items.map(\.words)
    }
}

/// The tutorials' clock — `sellerTutorials.ts`'s arithmetic, tested on its cases.
enum TutorialClock {
    static var motionLimit: Double { SellerTutorial.File.shared.motionLimit }
    static var settle: Double { SellerTutorial.File.shared.settle }

    /// Milliseconds per character typed: quick for long text, never slower than 60 or faster than 18.
    static func msPerCharacter(_ length: Int) -> Double {
        min(60, max(18, (1500 / Double(max(1, length))).rounded()))
    }

    /// How many characters of `length` are typed at `t`, typing from `at`.
    static func typedCount(_ length: Int, at: Double, t: Double) -> Int {
        if t < at { return 0 }
        guard t.isFinite else { return length }
        return min(length, Int(((t - at) / msPerCharacter(length)).rounded(.down)) + 1)
    }

    /// How far through a span that starts at `at` the clock is, from 0 to 1.
    static func progress(_ at: Double, _ t: Double, span: Double = TutorialClock.settle) -> Double {
        if span <= 0 { return t >= at ? 1 : 0 }
        return min(1, max(0, (t - at) / span))
    }

    /// When a part has finished moving, given how long its typed text is in the language shown.
    static func partEnd(_ part: TutorialPart, length: (TutorialWords) -> Int) -> Double {
        switch part.kind {
        case "field":
            guard let value = part.value else { return part.at }
            return part.fill ? part.at + settle : part.at + Double(length(value)) * msPerCharacter(length(value))
        case "photos": return (part.times.max() ?? 0) + settle
        case "rows": return (part.rows.map(\.at).max() ?? 0) + settle
        case "bullets", "status": return (part.items.map(\.at).max() ?? 0) + settle
        default: return part.at + settle
        }
    }

    /// When the whole scene has stopped moving; it then holds its last frame.
    static func sceneEnd(_ scene: TutorialScene, length: (TutorialWords) -> Int) -> Double {
        scene.parts.map { partEnd($0, length: length) }.max() ?? 0
    }

    /// The status shown at `t`: the latest that has arrived, the first before any has.
    static func statusAt(_ times: [Double], _ t: Double) -> Int {
        var shown = 0
        for (index, at) in times.enumerated() where t >= at { shown = index }
        return shown
    }
}
