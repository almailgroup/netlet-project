import Foundation

/// Whether a message carries a way to take the sale off NetLet — a phone
/// number, an email, a link or a handle on another platform. The Swift twin
/// of `Shared/commerce/contactFilter.ts`, pattern for pattern, so a composer
/// can name what it found as somebody types. It decides nothing on its own:
/// the server and the gateway refuse the same message whatever the app says.
enum ContactFilter {
    static let kinds = ["phone", "email", "link", "handle"]

    /// The kinds found, in a fixed order, never the match itself.
    static func findings(_ text: String) -> [String] {
        let view = normalise(text)
        let addresses = addressView(view)
        var found = Set<String>()
        if hasPhone(view) { found.insert("phone") }
        if matches(email, addresses) || matches(mailProvider, view) { found.insert("email") }
        if matches(link, replacing(email, in: addresses, with: " ")) { found.insert("link") }
        if matches(atHandle, replacing(email, in: view, with: " "))
            || matches(platformsLatin, view) || matches(platformsArabic, view) || matches(igHandle, view) {
            found.insert("handle")
        }
        return kinds.filter(found.contains)
    }

    // MARK: The view the patterns read

    /// Lower case, compatibility forms folded, what draws nothing removed,
    /// Arabic-Indic digits and spelled numbers read as digits, and a letter O
    /// or l between digits read as the digit it stands in for.
    static func normalise(_ text: String) -> String {
        let plain = foldDigits(replacing(invisible, in: text.precomposedStringWithCompatibilityMapping, with: "").lowercased())
        return replacing(lookalike, in: spellOut(plain)) { letter in
            ["o": "0", "i": "1", "l": "1", "|": "1"][letter] ?? letter
        }
    }

    private static func foldDigits(_ text: String) -> String {
        String(text.unicodeScalars.map { scalar -> Character in
            switch scalar.value {
            case 0x0660...0x0669: return Character(String(scalar.value - 0x0660))
            case 0x06F0...0x06F9: return Character(String(scalar.value - 0x06F0))
            default: return Character(scalar)
            }
        })
    }

    private static let spelled: [(NSRegularExpression, String)] = [
        ("zero", "0"), ("one", "1"), ("two", "2"), ("three", "3"), ("four", "4"),
        ("five", "5"), ("six", "6"), ("seven", "7"), ("eight", "8"), ("nine", "9"),
    ].map { (pattern("(?<![a-z])\($0.0)(?![a-z])"), $0.1) }

    private static let spelledArabic: [([String], String)] = [
        (["صفر"], "0"), (["واحد", "وحدة"], "1"), (["اثنين", "اثنان", "إثنين", "ثنين", "اتنين"], "2"),
        (["ثلاثة", "ثلاث", "تلاتة", "تلات"], "3"), (["اربعة", "أربعة", "اربع", "أربع"], "4"), (["خمسة", "خمس"], "5"),
        (["ستة", "ست"], "6"), (["سبعة", "سبع"], "7"), (["ثمانية", "ثمان", "تمانية"], "8"), (["تسعة", "تسع"], "9"),
    ]

    private static let spelledArabicPatterns: [(NSRegularExpression, String)] = spelledArabic.flatMap { words, digit in
        words.map { (pattern(#"(^|[^\p{L}])و?"# + $0 + #"(?=[^\p{L}]|$)"#), digit) }
    }

    private static func spellOut(_ text: String) -> String {
        var out = text
        for (shape, digit) in spelled { out = replacing(shape, in: out, with: digit) }
        for (shape, digit) in spelledArabicPatterns {
            out = replacingGroups(shape, in: out) { groups in groups[1] + digit }
        }
        return out
    }

    private static let invisible = pattern(#"[\p{Cf}\x{034F}\x{115F}\x{1160}\x{3164}\x{FFA0}\x{FE00}-\x{FE0F}\x{20E3}]"#)
    private static let lookalike = pattern(#"(?<=[0-9][\s\-.]{0,2})[oil|](?=[\s\-.]{0,2}[0-9])"#)

    // MARK: Phones

    private static let separator = #"[\s\-.()\[\]/_*,|:+~]"#
    private static let digitRun = pattern(#"(?:\+|00)?[0-9](?:"# + separator + #"{0,3}[0-9]){6,}"#)
    private static let orderReference = pattern(#"\bnl-[0-9]{8}-[a-z]{5}\b"#)
    private static let currency = pattern(#"(kwd|kd|د\.?\s?ك|دينار|dinar|fils|فلس)"#)
    private static let ymd = pattern(#"^([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})$"#)
    private static let dmy = pattern(#"^([0-9]{1,2})[-/.]([0-9]{1,2})[-/.]([0-9]{4})$"#)
    private static let priceShape = pattern(#"^[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,3})?$|^[0-9]+\.[0-9]{3}$"#)

    private static func isDate(_ run: String) -> Bool {
        let parts: [String]
        if let found = groups(ymd, run) { parts = [found[1], found[2], found[3]] } else if let found = groups(dmy, run) { parts = [found[3], found[2], found[1]] } else { return false }
        let numbers = parts.compactMap(Int.init)
        guard numbers.count == 3 else { return false }
        return (1900...2100).contains(numbers[0]) && (1...12).contains(numbers[1]) && (1...31).contains(numbers[2])
    }

    private static func isPrice(_ run: String, around: String) -> Bool {
        matches(priceShape, run.trimmingCharacters(in: .whitespaces)) && matches(currency, around)
    }

    private static func hasPhone(_ view: String) -> Bool {
        let text = replacing(orderReference, in: view, with: " ") as NSString
        for match in digitRun.matches(in: text as String, range: NSRange(location: 0, length: text.length)) {
            let run = text.substring(with: match.range)
            let digits = run.filter { ("0"..."9").contains($0) }.count
            let international = run.hasPrefix("+") || run.hasPrefix("00")
            if digits < 8 && !(international && digits >= 7) { continue }
            if isDate(run.trimmingCharacters(in: .whitespaces)) { continue }
            let start = max(0, match.range.location - 12)
            let end = min(text.length, match.range.location + match.range.length + 12)
            let around = text.substring(with: NSRange(location: start, length: end - start))
            if isPrice(run, around: around) { continue }
            return true
        }
        return false
    }

    // MARK: Addresses, links and handles

    private static let tlds = "com|net|org|io|me|co|kw|ly|gl|app|link|info|biz|store|shop|xyz|online|site"

    private static let addressSteps: [(NSRegularExpression, String)] = [
        (pattern(#"\s*[(\[{<]\s*(?:at|@)\s*[)\]}>]\s*"#), "@"),
        (pattern(#"\s*[(\[{<]\s*(?:dot|\.)\s*[)\]}>]\s*"#), "."),
        (pattern(#"\s+at\s+(?=[a-z0-9-]+\s*(?:\.|dot\b|[(\[{<]))"#), "@"),
        (pattern(#"\s+dot\s+(?=[a-z]{2,})"#), "."),
        (pattern(#"\s+(?:آت|أت)\s+"#), "@"),
        (pattern(#"\s+(?:نقطة|دوت)\s+"#), "."),
        (pattern(#"\s*@\s*"#), "@"),
        (pattern(#"(?<=[a-z0-9])\s*\.\s*(?=(?:"# + tlds + #")\b)"#), "."),
    ]

    private static let spelledLetters = pattern(#"(?<=(?:^|\s)\S) (?=\S(?:\s|$))"#)

    private static func addressView(_ view: String) -> String {
        addressSteps.reduce(replacing(spelledLetters, in: view, with: "")) { text, step in replacing(step.0, in: text, with: step.1) }
    }

    private static let email = pattern(#"[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}"#)
    private static let mailProvider = pattern(#"(^|[^a-z])(gmail|hotmail|yahoo|outlook|icloud|protonmail)([^a-z]|$)"#)
    private static let link = pattern(#"(?:https?://|www\.)\S+|(?:^|[^a-z0-9@._-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:"# + tlds + #")(?![a-z0-9])"#)
    private static let atHandle = pattern(#"(?:^|[^a-z0-9._%+-])@[a-z0-9_.]{3,}"#)
    private static let platformsLatin = pattern(#"(^|[^a-z])(whats\s?app|watsapp|wtsp|insta|instagram|snapchat|telegram|tiktok|tik\s?tok|facebook|messenger|twitter|threads|signal|viber|imo)([^a-z]|$)"#)
    private static let igHandle = pattern(#"(^|[^a-z])ig\s*(?::|\s+(?=[a-z0-9._]*[._0-9])[a-z0-9._]{3,})"#)
    private static let platformsArabic = pattern(#"(واتس|وتساب|انستا|إنستا|انستقرام|انستغرام|سناب|تيليجرام|تلغرام|تليجرام|تيك\s?توك|فيسبوك|فيس\s?بوك|ماسنجر|تويتر|سيجنال)"#)

    // MARK: Regular expressions, in UTF-16 like the JavaScript they mirror

    private static func pattern(_ source: String) -> NSRegularExpression {
        // The patterns are constants; one that does not compile is a bug to find in the tests.
        (try? NSRegularExpression(pattern: source)) ?? (try! NSRegularExpression(pattern: "(?!)"))
    }

    private static func matches(_ expression: NSRegularExpression, _ text: String) -> Bool {
        expression.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
    }

    private static func groups(_ expression: NSRegularExpression, _ text: String) -> [String]? {
        let string = text as NSString
        guard let match = expression.firstMatch(in: text, range: NSRange(location: 0, length: string.length)) else { return nil }
        return (0..<match.numberOfRanges).map { index in
            let range = match.range(at: index)
            return range.location == NSNotFound ? "" : string.substring(with: range)
        }
    }

    private static func replacing(_ expression: NSRegularExpression, in text: String, with replacement: String) -> String {
        replacingGroups(expression, in: text) { _ in replacement }
    }

    private static func replacing(_ expression: NSRegularExpression, in text: String, _ transform: (String) -> String) -> String {
        replacingGroups(expression, in: text) { transform($0[0]) }
    }

    /// Every match replaced by what its groups make, without the template
    /// syntax — `$1` before a digit would read as a group that is not there.
    private static func replacingGroups(_ expression: NSRegularExpression, in text: String, _ make: ([String]) -> String) -> String {
        let string = text as NSString
        var out = ""
        var at = 0
        for match in expression.matches(in: text, range: NSRange(location: 0, length: string.length)) {
            out += string.substring(with: NSRange(location: at, length: match.range.location - at))
            let parts = (0..<match.numberOfRanges).map { index -> String in
                let range = match.range(at: index)
                return range.location == NSNotFound ? "" : string.substring(with: range)
            }
            out += make(parts)
            at = match.range.location + match.range.length
        }
        out += string.substring(from: at)
        return out
    }
}
