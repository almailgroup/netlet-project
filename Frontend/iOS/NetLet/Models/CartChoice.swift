import Foundation

/// Which lines of the bag are chosen for checkout, on the owner's word — the
/// web's `Shared/commerce/cartChoice.ts`, rule for rule, tested on its cases
/// (`CartChoiceTests`).
///
/// The phone keeps what is *not* chosen, with the bag's id (`CartModel`), and
/// sends it with every read and write of the bag and with the order; the
/// server prices, delivers and places only what it leaves, and the rest stays
/// in the bag. A line added later is chosen without anybody choosing it. **A
/// set is chosen whole**: its lines are priced as a set only while together.
enum CartChoice {
    /// A line as the rule needs it: its id, and the set it was added as.
    struct Line: Hashable, Sendable {
        let lineId: String
        var bundleId: String? = nil
    }

    static let maxSkipped = 100

    static func lines(_ items: [CartItem]) -> [Line] {
        items.map { Line(lineId: $0.lineId, bundleId: $0.bundleId) }
    }

    /// Whether a line is one of these sets'.
    private static func inSets(_ line: Line, _ sets: Set<String>) -> Bool {
        guard let set = line.bundleId else { return false }
        return sets.contains(set)
    }

    /// The lines a skip list leaves out, a set whole.
    static func skipped(_ lines: [Line], _ skip: [String]) -> Set<String> {
        let asked = Set(skip)
        let sets = Set(lines.filter { asked.contains($0.lineId) }.compactMap(\.bundleId))
        return Set(lines.filter { line in asked.contains(line.lineId) || inSets(line, sets) }.map(\.lineId))
    }

    static func chosenIds(_ lines: [Line], _ skip: [String]) -> [String] {
        let out = skipped(lines, skip)
        return lines.map(\.lineId).filter { id in !out.contains(id) }
    }

    /// The skip list with only ids the bag still has.
    static func prune(_ lines: [Line], _ skip: [String]) -> [String] {
        let out = skipped(lines, skip)
        return lines.map(\.lineId).filter { id in out.contains(id) }
    }

    /// Choose these lines, or leave them out: the new skip list, a set whole.
    static func choose(_ lines: [Line], _ skip: [String], _ lineIds: [String], chosen: Bool) -> [String] {
        let pressed = Set(lineIds)
        let sets = Set(lines.filter { pressed.contains($0.lineId) }.compactMap(\.bundleId))
        let touched = Set(lines.filter { line in pressed.contains(line.lineId) || inSets(line, sets) }.map(\.lineId))
        let before = skipped(lines, skip)
        return lines.map(\.lineId).filter { id in touched.contains(id) ? !chosen : before.contains(id) }
    }

    /// Only these lines chosen, their sets with them — what Buy now does.
    static func only(_ lines: [Line], _ lineIds: [String]) -> [String] {
        let wanted = Set(lineIds)
        let sets = Set(lines.filter { wanted.contains($0.lineId) }.compactMap(\.bundleId))
        let kept = Set(lines.filter { line in wanted.contains(line.lineId) || inSets(line, sets) }.map(\.lineId))
        return lines.map(\.lineId).filter { id in !kept.contains(id) }
    }

    enum State: Sendable { case all, none, some }

    /// All, none or some of these lines chosen — a store's circle, or All.
    static func state(_ lines: [Line], _ skip: [String], of lineIds: [String]? = nil) -> State {
        let among = lineIds.map { ids in lines.filter { line in ids.contains(line.lineId) } } ?? lines
        guard !among.isEmpty else { return .none }
        let out = skipped(lines, skip)
        let left = among.filter { line in out.contains(line.lineId) }.count
        return left == 0 ? .all : left == among.count ? .none : .some
    }
}
