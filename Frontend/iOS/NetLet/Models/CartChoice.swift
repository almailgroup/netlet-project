import Foundation

/// Which lines of the bag are chosen for checkout, on the owner's word — the
/// web's `Shared/commerce/cartChoice.ts`, rule for rule, tested on its cases
/// (`CartChoiceTests`).
///
/// The phone keeps what is *not* chosen, with the bag's id (`CartModel`), and
/// sends it with every read and write of the bag and with the order; the
/// server prices, delivers and places only what it leaves. A line added later
/// is chosen without anybody choosing it. **A set is chosen whole**: its lines
/// are priced as a set only while together. **A line unticked moves to Saved
/// for later** (`untick`); the skip list is what Buy now leaves out.
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

    /// A line as moving it to Saved for later needs it: its product, and
    /// whether it is plain — no extras — since a set is told by `bundleId`.
    struct Savable: Hashable, Sendable {
        let lineId: String
        var bundleId: String? = nil
        var productId: String? = nil
        var plain: Bool = true
    }

    static func savable(_ items: [CartItem]) -> [Savable] {
        items.map { item in
            Savable(lineId: item.lineId, bundleId: item.bundleId, productId: item.productId,
                    plain: (item.addons ?? []).isEmpty && item.bundleName == nil)
        }
    }

    /// What unticking some lines does (`untick`).
    struct UntickPlan: Equatable, Sendable {
        /// The lines that leave the bag for Saved for later, a set whole.
        let move: [String]
        /// Their products, once each, in the bag's order.
        let productIds: [String]
        /// Lines whose product the bag does not say: left out of checkout instead.
        let leave: [String]
        /// Whether Undo can put every line moved back as it was.
        let undoable: Bool
    }

    /// **Unticking a line moves it to Saved for later**, on the owner's word —
    /// the web's `untickPlan`: a set moves whole; a line whose product the bag
    /// does not say is left out of checkout instead, and a set holding one
    /// stays together; Undo only where every line moved has no extras and is
    /// not a set's.
    static func untick(_ lines: [Savable], _ lineIds: [String]) -> UntickPlan {
        let pressed = Set(lineIds)
        let sets = Set(lines.filter { pressed.contains($0.lineId) }.compactMap(\.bundleId))
        let touched = lines.filter { line in
            pressed.contains(line.lineId) || line.bundleId.map { sets.contains($0) } == true
        }
        let stuck = Set(touched.filter { $0.productId == nil }.compactMap(\.bundleId))
        func moves(_ line: Savable) -> Bool {
            line.productId != nil && line.bundleId.map { stuck.contains($0) } != true
        }
        let move = touched.filter(moves)
        var seen = Set<String>()
        let products = move.compactMap(\.productId).filter { seen.insert($0).inserted }
        return UntickPlan(
            move: move.map(\.lineId),
            productIds: products,
            leave: touched.filter { !moves($0) }.map(\.lineId),
            undoable: !move.isEmpty && move.allSatisfy { $0.plain && $0.bundleId == nil }
        )
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
