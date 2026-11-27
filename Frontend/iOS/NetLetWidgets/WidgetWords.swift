import Foundation

/// The few words the home screen widgets say themselves, in the app's
/// language: `Generated/widgetWords.json`, written by `pnpm ios:resources` from
/// the dictionary (`WIDGET_WORDS` in `scripts/exportShared.ts`), so every word
/// is a key in both languages and the dictionary's tests cover it. Which
/// language is the app's own, from what it left (`SharedShelf`), else the
/// phone's.
struct WidgetWords: Sendable {
    let language: String
    private let words: [String: String]

    var rightToLeft: Bool { language == "ar" }

    func t(_ key: String) -> String { words[key] ?? key }

    static func current(_ snapshot: WidgetSnapshot? = SharedShelf.read()) -> WidgetWords {
        let language = snapshot?.language ?? ((Locale.preferredLanguages.first ?? "en").hasPrefix("ar") ? "ar" : "en")
        return WidgetWords(language: language, words: table[language] ?? table["en"] ?? [:])
    }

    private static let table: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "widgetWords", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode([String: [String: String]].self, from: data) else { return [:] }
        return decoded
    }()
}
