import Foundation

/// What the product page shows beyond the buy box — the web's
/// `components/product/*`: optional extras, the size chart, Subscribe & Save,
/// reviews, sets, what is bought with it, a price asked for and a follow.

/// An optional extra the seller offers with a product (3.1.2): a fitting, an
/// extended warranty. Its price is read from the catalogue; the bag stores
/// only which were ticked.
struct ProductAddon: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    /// installation, warranty or other.
    let kind: String
    let label: String
    let price: Money
}

/// A seller's size chart (`Shared/commerce/sizeGuide.ts`): a range in
/// centimetres per measurement per size, smallest first.
struct SizeChart: Decodable, Hashable, Sendable {
    struct Row: Decodable, Hashable, Sendable {
        let size: String
        /// Measurement → [low, high].
        let ranges: [String: [Double]]

        func range(_ measure: String) -> (low: Double, high: Double)? {
            guard let pair = ranges[measure], pair.count == 2 else { return nil }
            return (pair[0], pair[1])
        }
    }

    /// The variant option the sizes are values of, e.g. "Size".
    let axis: String
    let measures: [String]
    let rows: [Row]
}

/// The fit, worked out on the phone — nothing about anybody's body is sent
/// anywhere (`recommendSize`). Every measurement inside a size's ranges is a
/// fit; otherwise most held, then nearest, then the larger size — a little
/// loose is worn, a little tight goes back.
enum SizeAnswer: Equatable {
    struct Comparison: Equatable {
        let measure: String
        let value: Double
        let low: Double
        let high: Double
        /// within, below or above.
        let verdict: String
    }

    case fits(size: String, comparisons: [Comparison])
    case closest(size: String, comparisons: [Comparison])
    case belowChart
    case aboveChart
    case nothingToCompare

    var size: String? {
        switch self {
        case .fits(let size, _), .closest(let size, _): return size
        default: return nil
        }
    }

    static func recommend(_ chart: SizeChart, measurements: [String: Double]) -> SizeAnswer {
        let given = chart.measures.filter { (measurements[$0] ?? 0) > 0 && measurements[$0]!.isFinite }
        guard !given.isEmpty, !chart.rows.isEmpty else { return .nothingToCompare }
        struct Scored {
            let row: SizeChart.Row
            let index: Int
            let comparisons: [Comparison]
            let distance: Double
            let within: Int
        }
        let scored: [Scored] = chart.rows.enumerated().map { index, row in
            let comparisons: [Comparison] = given.compactMap { measure in
                guard let range = row.range(measure), let value = measurements[measure] else { return nil }
                let verdict = value < range.low ? "below" : value > range.high ? "above" : "within"
                return Comparison(measure: measure, value: value, low: range.low, high: range.high, verdict: verdict)
            }
            let distance = comparisons.reduce(0.0) { sum, entry in
                sum + (entry.verdict == "below" ? entry.low - entry.value : entry.verdict == "above" ? entry.value - entry.high : 0)
            }
            return Scored(row: row, index: index, comparisons: comparisons, distance: distance, within: comparisons.filter { $0.verdict == "within" }.count)
        }
        if let fit = scored.first(where: { $0.within == given.count }) {
            return .fits(size: fit.row.size, comparisons: fit.comparisons)
        }
        if let first = scored.first, first.comparisons.allSatisfy({ $0.verdict == "below" }) { return .belowChart }
        if let last = scored.last, last.comparisons.allSatisfy({ $0.verdict == "above" }) { return .aboveChart }
        let best = scored.sorted { a, b in
            if a.within != b.within { return a.within > b.within }
            if a.distance != b.distance { return a.distance < b.distance }
            return a.index > b.index
        }[0]
        return .closest(size: best.row.size, comparisons: best.comparisons)
    }
}

/// How a product's returned sizes lean (`returns.fit`, `fitTendency`).
struct FitFeedback: Decodable, Sendable {
    let tooSmall: Int
    let tooLarge: Int

    /// `runsSmall` or `runsLarge` once enough returns agree, else nil.
    var tendency: String? {
        let total = tooSmall + tooLarge
        guard total >= 3 else { return nil }
        if Double(tooSmall) / Double(total) >= 0.6 { return "runsSmall" }
        if Double(tooLarge) / Double(total) >= 0.6 { return "runsLarge" }
        return nil
    }

    /// The next size for somebody near the edge of theirs, beside the chart's
    /// answer and never instead of it (`adviseForFit`).
    func advice(_ chart: SizeChart, answer: SizeAnswer) -> String? {
        guard let tendency, let size = answer.size, let index = chart.rows.firstIndex(where: { $0.size == size }) else { return nil }
        let nextIndex = index + (tendency == "runsSmall" ? 1 : -1)
        guard chart.rows.indices.contains(nextIndex) else { return nil }
        let leaning: Bool
        switch answer {
        case .closest: leaning = true
        case .fits(_, let comparisons):
            leaning = comparisons.contains { entry in
                let middle = (entry.low + entry.high) / 2
                return tendency == "runsSmall" ? entry.value >= middle : entry.value <= middle
            }
        default: leaning = false
        }
        return leaning ? chart.rows[nextIndex].size : nil
    }
}

/// One of the shopper's own past lines in a product's department
/// (`returns.mySizes`): the variant's title as frozen on the order line, and
/// whether it was kept or sent back as too small or too large.
struct PastSizeLine: Decodable, Hashable, Sendable {
    var variantTitle: String? = nil
    let outcome: String
    let at: Date
}

/// The size a shopper's own purchases suggest, and the counts behind it
/// (`sizeFromPurchases`).
struct PurchaseSuggestion: Equatable, Sendable {
    let size: String
    let kept: Int
    let tooSmall: Int
    let tooLarge: Int
}

extension SizeChart {
    /// The chart's size a variant title names, matched whole and without case
    /// (`sizeOnChart`): "Navy / xl" is XL, "Large" is nothing on a chart in letters.
    func size(named variantTitle: String?) -> String? {
        guard let variantTitle else { return nil }
        let whole = variantTitle.trimmingCharacters(in: .whitespaces).lowercased()
        let parts = variantTitle.lowercased()
            .components(separatedBy: CharacterSet(charactersIn: "/,|·-").union(.whitespaces))
            .filter { !$0.isEmpty }
        let row = rows.first { $0.size.lowercased() == whole } ?? rows.first { parts.contains($0.size.lowercased()) }
        return row?.size
    }

    /// Each past line votes: one kept for its own size, one too small for the
    /// next size up, one too large for the next size down; a size the chart
    /// lacks casts none. Most votes wins, a tie going to the most recent.
    func fromPurchases(_ past: [PastSizeLine]) -> PurchaseSuggestion? {
        struct Tally { var count = 0; var latest = Date.distantPast; var kept = 0; var tooSmall = 0; var tooLarge = 0 }
        var votes: [String: Tally] = [:]
        var order: [String] = []
        for line in past {
            guard let size = size(named: line.variantTitle), let index = rows.firstIndex(where: { $0.size == size }) else { continue }
            let targetIndex = line.outcome == "kept" ? index : index + (line.outcome == "tooSmall" ? 1 : -1)
            guard rows.indices.contains(targetIndex) else { continue }
            let target = rows[targetIndex].size
            var entry = votes[target] ?? Tally()
            if votes[target] == nil { order.append(target) }
            entry.count += 1
            entry.latest = max(entry.latest, line.at)
            switch line.outcome {
            case "kept": entry.kept += 1
            case "tooSmall": entry.tooSmall += 1
            default: entry.tooLarge += 1
            }
            votes[target] = entry
        }
        var best: (String, Tally)?
        for size in order {
            guard let tally = votes[size] else { continue }
            if let current = best, !(tally.count > current.1.count || (tally.count == current.1.count && tally.latest > current.1.latest)) { continue }
            best = (size, tally)
        }
        guard let winner = best else { return nil }
        return PurchaseSuggestion(size: winner.0, kept: winner.1.kept, tooSmall: winner.1.tooSmall, tooLarge: winner.1.tooLarge)
    }
}

/// Reviews of one product, with the summary over all of them (`reviews.forProduct`).
struct ProductReviewsPage: Decodable, Sendable {
    struct Summary: Decodable, Sendable {
        let count: Int
        let average: Double
        let distribution: [String: Int]
    }

    struct Review: Decodable, Identifiable, Hashable, Sendable {
        let id: Int
        let rating: Int
        let title: String?
        let body: String?
        let author: String?
        let createdAt: Date
        let vendorReply: String?
    }

    let total: Int
    let summary: Summary?
    let items: [Review]
}

/// A set sold together for less (`commerce.bundlesForVariant`).
struct ProductBundle: Decodable, Identifiable, Sendable {
    struct Member: Decodable, Hashable, Sendable {
        let variantId: Int
        let productTitle: String
        let quantity: Int
        let vendorName: String?
    }

    let id: Int
    let name: String
    let crossVendor: Bool
    let bundlePrice: Money
    let separately: Money
    let saving: Money
    let members: [Member]
}

/// Something bought with this product, and how often (`together.forProduct`).
struct Complement: Decodable, Sendable {
    let product: Product
    let confidence: Double
    let crossVendor: Bool
}

/// The shopper's follow on a product: told of a price drop, or when it is back.
struct ProductFollow: Decodable, Sendable {
    let productId: String
    let priceDrop: Bool
    let backInStock: Bool
}

/// The shopper's own request on one variant (`offers.mine`).
struct HeldPriceRequest: Decodable, Sendable {
    let id: Int
    let state: String
    let askedPrice: Money
    let offeredPrice: Money?
    let expiresAt: Date?
    let vendorNote: String?
}

/// What subscribing answers: when the first delivery is ordered.
struct StartedSubscription: Decodable, Sendable {
    let nextRunOn: String
}
