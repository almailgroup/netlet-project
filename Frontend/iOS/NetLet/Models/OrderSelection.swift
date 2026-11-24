import Foundation

/// What the shopper can do with the items they chose on an opened order, on
/// the owner's word ("when you select a specific order, it should let you
/// choose the product, just like in the cart page, and it should give you all
/// the options") — `Shared/commerce/orderSelection.ts` in Swift, on its own
/// cases (`OrderSelectionTests`), so a choice offers the same acts on the web
/// and in the app. It decides nothing the server does not decide again: each
/// fact is the server's own answer about the line, and every act is asked
/// again under a lock when it is pressed.
///
/// **The bar is the one way in, on the owner's word** ("remove all these 3
/// dot buttons; instead put their options here — when you select all, it
/// should show you all the options, and when you select individually, it
/// should show you the options as well"). It also offers what only the whole
/// order can have done (`Whole`) — whatever is chosen, one item included, on
/// the owner's word ("these options should show even if one is selected; keep
/// as many options as there is for the user"). Only with every item chosen do
/// the order's acts stand in for the items' (the change form for the
/// quantity, cancelling the order for cancelling them all).
///
/// **No Track, Payment or Receipt on it, on the owner's word** ("no need
/// inside the track because will show out side, no need payment because we
/// will control full payment for all order one time, no need receipt because
/// there will be one receipt for all"): each item's status is under its photo,
/// the way to pay is changed once beside how the order is paid, and the
/// receipt is the order's one PDF at its top.
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
    /// item's own form (refund or exchange); `refund` is one refund across
    /// several. `modify`, `address` and `cancelOrder` are the whole order's,
    /// offered whatever is chosen; with every item
    /// chosen `modify` stands in for `quantity`, `cancelOrder` for `cancelItems`.
    enum Action: String, CaseIterable, Sendable {
        case `return`, refund, warranty, quantity, modify, rate, buyAgain, address, help, cancelItems, cancelOrder
    }

    /// What the whole order allows now, from the server's answer.
    struct Whole: Equatable, Sendable {
        /// The order's change form has something it may still change.
        var modifiable = false
        /// The delivery address can still move.
        var address = false
        /// The order itself may be cancelled now.
        var cancellable = false
    }

    /// An act and the chosen items it is about — some of them, or all.
    struct Offer: Equatable, Sendable {
        let action: Action
        let lineIds: [Int]
    }

    static func offers(_ chosen: [Line], cancelled: Bool, whole: Whole? = nil, everyChosen: Bool = false) -> [Offer] {
        guard !chosen.isEmpty else { return [] }
        let all = whole != nil && everyChosen
        let every = chosen.map(\.id)
        var offers: [Offer] = []
        func add(_ action: Action, _ test: (Line) -> Bool) {
            let ids = chosen.filter(test).map(\.id)
            if !ids.isEmpty { offers.append(Offer(action: action, lineIds: ids)) }
        }
        func addWhole(_ action: Action, _ allowed: Bool) {
            if allowed { offers.append(Offer(action: action, lineIds: every)) }
        }
        add(chosen.count == 1 ? .return : .refund) { $0.returnable }
        add(.warranty) { $0.warranty }
        if !all { add(.quantity) { $0.changeable && $0.quantity > 1 } }
        if let whole { addWhole(.modify, whole.modifiable) }
        add(.rate) { $0.rateable }
        add(.buyAgain) { $0.rebuyable }
        if let whole { addWhole(.address, whole.address) }
        add(.help) { _ in true }
        // Cancelling the order only with every item chosen (the All circle),
        // where it stands in for cancelling them all; with some chosen, only
        // those items — on the owner's word.
        if !(all && whole?.cancellable == true) { add(.cancelItems) { $0.changeable } }
        if all && whole?.cancellable == true { addWhole(.cancelOrder, true) }
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

    /// What the bar offers for this choice on this order — the rule over the
    /// server's answer, every item's facts and the whole order's.
    @MainActor
    static func offers(_ detail: OrderDetail, chosen: Set<Int>, returnsOn: Bool) -> [Offer] {
        let whole = Whole(
            modifiable: detail.mayModify,
            address: detail.changeAddress.changeable,
            cancellable: detail.cancel.cancellable
        )
        return offers(
            lines(detail, chosen: chosen, returnsOn: returnsOn),
            cancelled: detail.steps?.cancelled ?? false,
            whole: whole,
            everyChosen: state(all: detail.lines.map(\.id), chosen: chosen) == .all
        )
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
