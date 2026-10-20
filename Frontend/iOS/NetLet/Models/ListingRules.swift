import Foundation

/// The product editor's vocabulary, from `portal.json`'s `editor` block, and
/// the small rules over it — each the shared function of the same name, so
/// the editor refuses exactly what the server would.
struct ListingRules: Decodable, Sendable {
    /// One row a department expects (`AttributeField`).
    struct Field: Decodable, Hashable, Sendable {
        let key: String
        let label: String
        let labelAr: String
        let unit: String?
        let options: [String]?

        func shown(_ language: Language) -> String { language == .ar ? labelAr : label }
    }

    struct Bounds: Decodable, Hashable, Sendable {
        let min: Double
        let max: Double
    }

    let attributeSchema: [String: [Field]]
    let sellUnits: [String]
    let basePerUnit: [String: Int]
    let dimensionOf: [String: String]
    let canonical: [String: String]
    let stockReasons: [String]
    let sizeClasses: [String]
    let vehicleByClass: [String: String]
    let deliverySpeeds: [String]
    let addonKinds: [String]
    let optionNameMax: Int
    let optionValueMax: Int
    let measures: [String]
    let measureBounds: [String: Bounds]
    let maxSizes: Int
    let maxSizeLabel: Int

    static let shared: ListingRules = {
        struct File: Decodable { let editor: ListingRules }
        let data = Bundle.main.resource("portal", "json")
        return (try? JSONDecoder().decode(File.self, from: data))?.editor ?? .fallback
    }()

    static let fallback = ListingRules(
        attributeSchema: [:], sellUnits: ["each"], basePerUnit: ["each": 1], dimensionOf: ["each": "count"], canonical: ["count": "each"],
        stockReasons: ["received", "sold", "damaged", "correction", "returned"], sizeClasses: [], vehicleByClass: [:], deliverySpeeds: [],
        addonKinds: ["other"], optionNameMax: 60, optionValueMax: 120, measures: [], measureBounds: [:], maxSizes: 20, maxSizeLabel: 20
    )

    // MARK: Specification rows (`attributeSchema.ts`)

    func fields(_ departmentSlug: String?) -> [Field] {
        guard let departmentSlug else { return [] }
        return attributeSchema[departmentSlug] ?? []
    }

    /// Rows that are not part of this department's schema, kept and shown: a
    /// schema that deletes merchant data on first save is one nobody uses twice.
    func freeFormRows(_ attributes: [ProductAttribute], departmentSlug: String?) -> [ProductAttribute] {
        let known = Set(fields(departmentSlug).map(\.key))
        return attributes.filter { $0.namespace != "reviews" && !($0.namespace == "spec" && known.contains($0.key)) }
    }

    /// The schema values written back, everything else exactly as it was; a
    /// blank clears its row rather than storing "".
    func mergeAttributes(_ attributes: [ProductAttribute], departmentSlug: String?, values: [String: String]) -> [ProductAttribute] {
        let rest = freeFormRows(attributes, departmentSlug: departmentSlug)
        let reviews = attributes.filter { $0.namespace == "reviews" }
        let filled = fields(departmentSlug).compactMap { field -> ProductAttribute? in
            let value = (values[field.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? nil : ProductAttribute(namespace: "spec", key: field.key, label: field.label, value: value)
        }
        return reviews + filled + rest
    }

    // MARK: Variant options (`variantOptions.ts`)

    struct OptionPair: Hashable, Sendable {
        var name: String
        var value: String
    }

    /// The pairs as saved: trimmed, a wholly blank row dropped. A half-filled
    /// row is `optionProblem`'s to refuse, never guessed at.
    func optionsRecord(_ pairs: [OptionPair]) -> [String: String] {
        var record: [String: String] = [:]
        for pair in pairs {
            let name = pair.name.trimmingCharacters(in: .whitespaces)
            let value = pair.value.trimmingCharacters(in: .whitespaces)
            if !name.isEmpty && !value.isEmpty { record[name] = value }
        }
        return record
    }

    func optionProblem(_ pairs: [OptionPair]) -> String? {
        var seen = Set<String>()
        for pair in pairs {
            let name = pair.name.trimmingCharacters(in: .whitespaces)
            let value = pair.value.trimmingCharacters(in: .whitespaces)
            if name.isEmpty && value.isEmpty { continue }
            if name.isEmpty || value.isEmpty { return "admin.optionHalf" }
            if name.count > optionNameMax || value.count > optionValueMax { return "admin.optionTooLong" }
            // "Colour" and "colour" would be two rows on the product page.
            if !seen.insert(name.lowercased()).inserted { return "admin.optionDuplicate" }
        }
        return nil
    }

    /// The names whose value differs between at least two variants.
    static func varyingOptionNames(_ variants: [[String: String]]) -> [String] {
        var order: [String] = []
        var values: [String: Set<String>] = [:]
        for options in variants {
            for (name, value) in options.sorted(by: { $0.key < $1.key }) {
                if values[name] == nil { order.append(name) }
                values[name, default: []].insert(value)
            }
        }
        return order.filter { (values[$0]?.count ?? 0) > 1 }
    }

    /// Whether the options tell every variant apart — the condition for
    /// shoppers choosing by option rather than by name.
    static func optionsDistinguish(_ variants: [[String: String]]) -> Bool {
        guard variants.count >= 2 else { return false }
        let varying = varyingOptionNames(variants)
        guard !varying.isEmpty, variants.allSatisfy({ options in varying.allSatisfy { options[$0] != nil } }) else { return false }
        let combos = Set(variants.map { options in varying.map { options[$0] ?? "" }.joined(separator: "\u{1f}") })
        return combos.count == variants.count
    }

    // MARK: Stock (`stockMoves.ts`)

    /// Received and returned add, sold and damaged take away, a correction goes
    /// either way, and nothing is recorded for a change of nothing.
    static func stockMoveProblem(_ delta: Int, reason: String) -> String? {
        if delta == 0 { return "stock.zeroChange" }
        if (reason == "received" || reason == "returned") && delta < 0 { return "stock.wrongDirection" }
        if (reason == "sold" || reason == "damaged") && delta > 0 { return "stock.wrongDirection" }
        return nil
    }

    // MARK: Units (`units.ts`)

    /// A step the shop can sell: a counted product in ones, a measured one in
    /// a whole number of grams or millilitres, so the arithmetic stays exact.
    func isValidMeasure(unit: String, step: Double) -> Bool {
        guard sellUnits.contains(unit), step.isFinite, step > 0 else { return false }
        guard dimensionOf[unit] != "count" else { return step == 1 }
        let base = step * Double(basePerUnit[unit] ?? 1)
        return base.rounded() == base
    }

    /// The price per kilo or litre, computed in fils and rounded once; nil for
    /// a counted product, where it is just the price.
    func unitPrice(_ stepPrice: Money, unit: String, step: Double) -> (price: Money, unit: String)? {
        guard isValidMeasure(unit: unit, step: step), let dimension = dimensionOf[unit], dimension != "count",
              let canonical = canonical[dimension], let perCanonical = basePerUnit[canonical] else { return nil }
        let base = Int((step * Double(basePerUnit[unit] ?? 1)).rounded())
        guard base > 0 else { return nil }
        let scaled = stepPrice.fils * perCanonical * 1000 / base
        return (Money(fils: (scaled + 500) / 1000), canonical)
    }

    // MARK: Delivery (`vehicle.ts`)

    func vehicle(forSizeClass sizeClass: String?) -> String? {
        sizeClass.flatMap { vehicleByClass[$0] }
    }

    // MARK: Size charts (`sizeGuide.ts`)

    func chartProblem(_ chart: SizeChart) -> String? {
        if chart.measures.isEmpty || Set(chart.measures).count != chart.measures.count || !chart.measures.allSatisfy(measures.contains) { return "sizeGuide.noMeasures" }
        if chart.rows.isEmpty { return "sizeGuide.noRows" }
        if chart.rows.count > maxSizes { return "sizeGuide.tooManyRows" }
        var seen = Set<String>()
        for row in chart.rows {
            let size = row.size.trimmingCharacters(in: .whitespaces)
            if size.isEmpty || size.count > maxSizeLabel { return "sizeGuide.badSize" }
            if !seen.insert(size.lowercased()).inserted { return "sizeGuide.duplicateSize" }
            for measure in chart.measures {
                guard let range = row.range(measure) else { return "sizeGuide.missingRange" }
                let bounds = measureBounds[measure] ?? Bounds(min: 0, max: .infinity)
                if !range.low.isFinite || !range.high.isFinite || range.low > range.high || range.low < bounds.min || range.high > bounds.max { return "sizeGuide.badRange" }
            }
        }
        return nil
    }
}

/// `memberPriceProblem`: a member price is below the shelf and above nothing.
func memberPriceProblem(list: Money?, member: String) -> String? {
    let typed = member.trimmingCharacters(in: .whitespaces)
    guard !typed.isEmpty else { return nil }
    guard let memberPrice = Money(amount: typed), let list else { return "membership.priceInvalid" }
    if memberPrice.fils <= 0 { return "membership.priceZero" }
    if memberPrice.fils >= list.fils { return "membership.priceNotBelow" }
    return nil
}
