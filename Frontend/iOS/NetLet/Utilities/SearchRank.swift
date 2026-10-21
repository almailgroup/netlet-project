import Foundation

/// The shop's one search rule (`Shared/commerce/search.ts`), for the searches
/// the app answers from what it already holds — a store's own shelf. A word in
/// the title counts above the brand, the brand above the department (in both
/// languages), then tags, a variant's name and the description; a whole word
/// above a word it only starts; the shopper's own word for a thing
/// (`SYNONYM_GROUPS`) a little less than the word itself. Words are compared as
/// people mean them: Arabic's spellings folded, its article and sound plural
/// taken off, an English plural taken off. The folding table and the synonyms
/// come from the shared code (`search.json`), so the two cannot drift.
enum SearchRank {
    private struct Rules: Decodable {
        let foldFrom: String
        let foldTo: String
        let foldMarks: String
        let maxQueryWords: Int
        let synonymGroups: [[String]]
    }

    private static let rules: Rules = (try? JSONDecoder().decode(Rules.self, from: Bundle.main.resource("search", "json")))
        ?? Rules(foldFrom: "", foldTo: "", foldMarks: "[\u{064B}-\u{0670}]", maxQueryWords: 6, synonymGroups: [])

    /// Each folded character to what it reads as; the tatweel to nothing.
    private static let foldMap: [Unicode.Scalar: String] = {
        let from = Array(rules.foldFrom.unicodeScalars)
        let to = Array(rules.foldTo.unicodeScalars)
        var map: [Unicode.Scalar: String] = [:]
        for (index, scalar) in from.enumerated() {
            map[scalar] = index < to.count ? String(to[index]) : ""
        }
        return map
    }()

    private static let marks = try? NSRegularExpression(pattern: rules.foldMarks)
    private static let wordPattern = try? NSRegularExpression(pattern: "[\\p{L}\\p{N}]+")

    // MARK: Words

    /// Lower case, the spellings keyboards disagree on folded, digits read as
    /// digits, the vowel marks dropped (`foldText`).
    static func fold(_ text: String?) -> String {
        guard let text, !text.isEmpty else { return "" }
        var folded = ""
        for scalar in text.lowercased().unicodeScalars {
            if let replacement = foldMap[scalar] { folded += replacement } else { folded.unicodeScalars.append(scalar) }
        }
        guard let marks else { return folded }
        return marks.stringByReplacingMatches(in: folded, range: NSRange(folded.startIndex..., in: folded), withTemplate: "")
    }

    /// The words in a text, folded (`tokensOf`).
    static func tokens(_ text: String?) -> [String] {
        let folded = fold(text)
        guard let wordPattern, !folded.isEmpty else { return [] }
        return wordPattern.matches(in: folded, range: NSRange(folded.startIndex..., in: folded)).compactMap {
            Range($0.range, in: folded).map { String(folded[$0]) }
        }
    }

    private static func isArabic(_ word: String) -> Bool {
        word.unicodeScalars.contains { (0x0600...0x06FF).contains($0.value) }
    }

    /// A word without its article or plural (`stemWord`).
    static func stem(_ word: String) -> String {
        let length = word.unicodeScalars.count
        if isArabic(word) {
            var stem = word
            if ["وال", "بال", "فال", "كال"].contains(where: { stem.hasPrefix($0) }) && length - 3 >= 2 {
                stem = String(stem.unicodeScalars.dropFirst(3))
            } else if stem.hasPrefix("لل") && length - 2 >= 2 {
                stem = String(stem.unicodeScalars.dropFirst(2))
            } else if stem.hasPrefix("ال") && length - 2 >= 2 {
                stem = String(stem.unicodeScalars.dropFirst(2))
            }
            if stem.hasSuffix("ات") && stem.unicodeScalars.count - 2 >= 3 {
                stem = String(stem.unicodeScalars.dropLast(2))
            }
            return stem
        }
        if length <= 3 || word.unicodeScalars.contains(where: { (48...57).contains($0.value) }) { return word }
        var stem = word
        if stem.hasSuffix("ies") && stem.count > 4 {
            stem = String(stem.dropLast(3)) + "i"
        } else if stem.range(of: "(?:ss|x|z|ch|sh)es$", options: .regularExpression) != nil {
            stem = String(stem.dropLast(2))
        } else if stem.hasSuffix("s") && stem.range(of: "(?:ss|us|is)$", options: .regularExpression) == nil {
            stem = String(stem.dropLast())
        }
        if stem.count > 3 && stem.hasSuffix("y") {
            stem = String(stem.dropLast()) + "i"
        } else if stem.count > 3 && stem.hasSuffix("e") {
            stem = String(stem.dropLast())
        }
        return stem
    }

    /// The stems of a text's words (`searchWords`).
    static func words(_ text: String?) -> [String] {
        tokens(text).map(stem)
    }

    private static func unique(_ items: [String]) -> [String] {
        var seen = Set<String>()
        return items.filter { seen.insert($0).inserted }
    }

    private static let groupStems: [[String]] = rules.synonymGroups.map { group in unique(group.flatMap { words($0) }) }

    private static let groupsByStem: [String: [Int]] = {
        var map: [String: [Int]] = [:]
        for (index, stems) in groupStems.enumerated() {
            for stem in stems { map[stem, default: []].append(index) }
        }
        return map
    }()

    /// The other words for the same thing (`synonymsOf`).
    static func synonyms(of stem: String) -> [String] {
        unique((groupsByStem[stem] ?? []).flatMap { groupStems[$0] }).filter { $0 != stem }
    }

    struct QueryWord {
        let stem: String
        let synonyms: [String]
    }

    static func queryWords(_ term: String) -> [QueryWord] {
        unique(words(term)).prefix(rules.maxQueryWords).map { QueryWord(stem: $0, synonyms: synonyms(of: $0)) }
    }

    // MARK: Scoring

    /// What a search reads of a product (`SearchDoc`).
    struct Doc {
        var title: String
        var brand: String?
        var department: String?
        var tags: [String] = []
        var variants: [String] = []
        var description: String?
    }

    static func doc(_ product: Product) -> Doc {
        let brand = product.attributes.first { $0.key == "brand" && $0.namespace != "reviews" }?.value.trimmingCharacters(in: .whitespaces)
        return Doc(
            title: product.title,
            brand: brand?.isEmpty == false ? brand : nil,
            department: product.productType,
            tags: product.tags,
            variants: product.variants.map(\.title) + product.options.flatMap(\.values),
            description: product.description
        )
    }

    private static func fields(_ doc: Doc) -> [(weight: Double, tokens: [String])] {
        let arabicDepartment = ReferenceData.shared.departments.first { $0.name == doc.department }?.nameAr
        return [
            (10, words(doc.title)),
            (8, words(doc.brand)),
            (6, words(doc.department) + words(arabicDepartment)),
            (4, doc.tags.flatMap { words($0) }),
            (3, doc.variants.flatMap { words($0) }),
            (1, words(doc.description)),
        ]
    }

    private static func match(_ token: String, _ word: QueryWord) -> Double {
        if token == word.stem { return 1 }
        if token.hasPrefix(word.stem) { return 0.5 }
        for synonym in word.synonyms {
            if token == synonym { return 0.8 }
            if synonym.unicodeScalars.count >= 4 && token.hasPrefix(synonym) { return 0.4 }
        }
        return 0
    }

    /// How well a product answers the words; nought when any word is nowhere
    /// in it, so every word must be somewhere (`scoreDoc`).
    static func score(_ doc: Doc, _ words: [QueryWord]) -> Double {
        if words.isEmpty { return 1 }
        let fields = fields(doc)
        var total = 0.0
        for word in words {
            var best = 0.0
            for field in fields {
                for token in field.tokens {
                    best = max(best, field.weight * match(token, word))
                }
            }
            if best == 0 { return 0 }
            total += best
        }
        return total
    }

    /// The products that answer the words, best first; ties keep their order
    /// (`rankBySearch`).
    static func rank(_ products: [Product], _ term: String) -> [Product] {
        let words = queryWords(term)
        return products.enumerated()
            .map { (offset: $0.offset, product: $0.element, score: score(doc($0.element), words)) }
            .filter { $0.score > 0 }
            .sorted { $0.score != $1.score ? $0.score > $1.score : $0.offset < $1.offset }
            .map(\.product)
    }
}
