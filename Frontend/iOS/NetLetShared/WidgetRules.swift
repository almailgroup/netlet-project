import Foundation

/// The home screen widgets' rules, apart from WidgetKit so the app's tests
/// can hold them: which products are today's deals, and what the order widget
/// shows from what the app left.
enum DealPicker {
    /// A product as `commerce.products.list` sends it, read leniently: a field
    /// that is missing or malformed leaves that product out, never the list.
    struct Listed: Decodable {
        let handle: String?
        let title: String?
        let images: [Picture]?
        let variants: [Variant]?

        struct Picture: Decodable { let url: String? }
        struct Variant: Decodable {
            let price: Amount?
            let compareAtPrice: Amount?
            let availableForSale: Bool?
        }
        struct Amount: Decodable { let amount: String? }
    }

    struct Deal: Equatable {
        let handle: String
        let title: String
        let priceFils: Int
        let wasFils: Int
        let percent: Int
        let photo: String?
    }

    /// The products on offer, deepest saving first and the catalogue's order
    /// between equals: each product's best saving among the options that can
    /// be bought, rounded as the card's badge rounds it. A was-price is only
    /// ever what the server sent, and it sends none a store's discount permit
    /// does not cover.
    static func deals(in products: [Listed]) -> [Deal] {
        let found: [(Int, Deal)] = products.enumerated().compactMap { position, product in
            guard let handle = product.handle, !handle.isEmpty, let title = product.title, !title.isEmpty else { return nil }
            let best = (product.variants ?? [])
                .filter { $0.availableForSale != false }
                .compactMap { variant -> (price: Int, was: Int, percent: Int)? in
                    guard let price = fils(variant.price?.amount), let was = fils(variant.compareAtPrice?.amount), was > price, was > 0 else { return nil }
                    let percent = Int((Double(was - price) / Double(was) * 100).rounded())
                    return percent > 0 ? (price, was, percent) : nil
                }
                .max { $0.percent < $1.percent }
            guard let best else { return nil }
            return (position, Deal(handle: handle, title: title, priceFils: best.price, wasFils: best.was, percent: best.percent, photo: product.images?.first?.url))
        }
        return found
            .sorted { $0.1.percent != $1.1.percent ? $0.1.percent > $1.1.percent : $0.0 < $1.0 }
            .map(\.1)
    }

    /// "4.750" in whole fils — `Money.parseFils`'s rule — or nil.
    static func fils(_ text: String?) -> Int? {
        guard let text = text?.trimmingCharacters(in: .whitespaces), !text.isEmpty, !text.hasPrefix("-") else { return nil }
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        let digit: (Character) -> Bool = { $0.isASCII && $0.isNumber }
        guard parts.count <= 2, let whole = parts.first, !whole.isEmpty, whole.allSatisfy(digit), let wholeValue = Int(whole) else { return nil }
        var fraction = 0
        if parts.count == 2 {
            let digits = parts[1]
            guard !digits.isEmpty, digits.count <= 3, digits.allSatisfy(digit) else { return nil }
            fraction = Int(digits.padding(toLength: 3, withPad: "0", startingAt: 0)) ?? 0
        }
        return wholeValue * 1000 + fraction
    }
}

/// What the order widget shows, over time, from the snapshot alone.
enum OrderWidgetPlan {
    /// The Lock Screen's own: half an hour after the app last read the
    /// order, the card says to open NetLet for where it is now.
    static let staleAfter: TimeInterval = 30 * 60

    enum Showing: Equatable {
        /// The app has left nothing yet: open it once.
        case open
        case signIn
        /// Signed in, and no order to follow.
        case nothing
        case order(stale: Bool)
    }

    /// Each entry's moment and what it shows: the order now, then the same
    /// card saying it is old once `staleAfter` has passed — or one line saying
    /// why there is none. A delivered order is going nowhere, so never old.
    static func plan(snapshot: WidgetSnapshot?, now: Date) -> [(at: Date, showing: Showing)] {
        guard let snapshot else { return [(now, .open)] }
        guard snapshot.signedIn else { return [(now, .signIn)] }
        guard let order = snapshot.order else { return [(now, .nothing)] }
        if order.state.arrived { return [(now, .order(stale: false))] }
        let staleAt = snapshot.written.addingTimeInterval(staleAfter)
        if now >= staleAt { return [(now, .order(stale: true))] }
        return [(now, .order(stale: false)), (staleAt, .order(stale: true))]
    }
}
