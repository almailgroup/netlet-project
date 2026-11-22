import Foundation

/// What the shopper can do with the items they chose on an opened order, on
/// the owner's word ("when you select a specific order, it should let you
/// choose the product, just like in the cart page, and it should give you all
/// the options") — `Shared/commerce/orderSelection.ts` in Swift, on its own
/// cases (`OrderSelectionTests`), so a choice offers the same acts on the web
/// and in the app. It decides nothing the server does not decide again: each
/// fact is the server's own answer about the line, and every act is asked
/// again under a lock when it is pressed.
enum OrderSelection {
    /// One chosen item, as the page already knows it.
    struct Line: Equatable, Sendable {
        let id: Int
        var fulfilment = "pending"
        var quantity = 1
        /// A return may be asked on it now (`mayAskReturn`).
        var returnable = false
        /// Its warranty may be claimed.
        var warranty = false
        /// It may change before a driver has it, on an order that may.
        var changeable = false
        /// It can be rated, or its review changed.
        var rateable = false
        /// Still a product the shop knows, so it can go in the bag again.
        var rebuyable = true
    }

    /// The acts in the bar's order — the cancel last, apart. `return` is one
    /// item's own form (refund or exchange); `refund` is one refund across several.
    enum Action: String, CaseIterable, Sendable {
        case track, `return`, refund, warranty, quantity, rate, buyAgain, help, cancelItems
    }

    /// An act and the chosen items it is about — some of them, or all.
    struct Offer: Equatable, Sendable {
        let action: Action
        let lineIds: [Int]
    }

    static func offers(_ chosen: [Line], cancelled: Bool) -> [Offer] {
        guard !chosen.isEmpty else { return [] }
        var offers: [Offer] = []
        func add(_ action: Action, _ test: (Line) -> Bool) {
            let ids = chosen.filter(test).map(\.id)
            if !ids.isEmpty { offers.append(Offer(action: action, lineIds: ids)) }
        }
        if !cancelled { add(.track) { $0.fulfilment != "cancelled" } }
        add(chosen.count == 1 ? .return : .refund) { $0.returnable }
        add(.warranty) { $0.warranty }
        add(.quantity) { $0.changeable && $0.quantity > 1 }
        add(.rate) { $0.rateable }
        add(.buyAgain) { $0.rebuyable }
        add(.help) { _ in true }
        add(.cancelItems) { $0.changeable }
        return offers
    }

    /// All, some or none of the order's items chosen — the All circle.
    static func state(all: [Int], chosen: Set<Int>) -> CartChoice.State {
        let picked = all.filter { chosen.contains($0) }.count
        return picked == 0 ? .none : picked == all.count ? .all : .some
    }

    /// Which item Rate opens: the first not yet reviewed, else the first.
    static func firstToRate(_ lines: [(id: Int, reviewed: Bool)], among lineIds: [Int]) -> Int? {
        let among = lines.filter { lineIds.contains($0.id) }
        return (among.first { !$0.reviewed } ?? among.first)?.id
    }

    /// The facts the rule reads, from the server's answer about the order.
    @MainActor
    static func lines(_ detail: OrderDetail, chosen: Set<Int>, returnsOn: Bool) -> [Line] {
        detail.lines.filter { chosen.contains($0.id) }.map { line in
            Line(
                id: line.id,
                fulfilment: line.fulfilment,
                quantity: line.quantity,
                returnable: returnsOn && detail.mayAskReturn(for: line),
                warranty: returnsOn && line.warrantyEligibility?.allowed == true,
                changeable: detail.change.changeable && line.changeable == true,
                rateable: line.review != nil || line.reviewEligibility?.allowed == true,
                rebuyable: line.variantId != nil
            )
        }
    }
}
