import Foundation
import Observation

/// The bag, for the whole app: the badge on its tab, the count on a product
/// page and the cart screen all read this one copy.
///
/// The bag lives on the server; all this device keeps is its id, the way the
/// web keeps it in the browser. The id is a random token rather than a number
/// because it is the only thing separating one shopper's bag from another's.
///
/// **A press changes the bag at once; the server's answer settles it** — the
/// web's `CartContext`. Every change joins one queue and is sent in order, one
/// at a time, so two fast presses on plus cannot land the wrong way round; the
/// bag drawn is the server's last answer with every press still waiting
/// applied over it (`BagOps`). Presses on one line's stepper that have not
/// gone yet are folded into one. A refusal drops that press, is felt as two
/// taps on a stepper, and reads the bag again, since a dropped connection may
/// have half-happened; the caller is still told it failed.
@Observable
@MainActor
final class CartModel {
    /// One change to the bag, as it waits in the queue.
    private enum Change {
        case add(variantId: String, quantity: Int, ghost: CartItem?)
        case lines([API.CartLine])
        case set(lineId: String, quantity: Int)
        case remove(lineId: String)
        case destination(lineId: String, addressId: Int?)
        case speed(lineId: String, fast: Bool)
        case refresh

        /// What the press draws before the server answers. A line with extras
        /// or a set is priced by the server, so it moves the count and appears
        /// with the answer; where it goes and how fast are the server's to price.
        var guesses: [BagOp] {
            switch self {
            case let .add(variantId, quantity, ghost):
                return [.add(variantId: variantId, quantity: quantity, ghost: ghost)]
            case let .lines(lines):
                return lines.map { BagOp.add(variantId: $0.variantId, quantity: $0.quantity, ghost: nil) }
            case let .set(lineId, quantity):
                return [.set(lineId: lineId, quantity: quantity)]
            case let .remove(lineId):
                return [.remove(lineId: lineId)]
            case .destination, .speed, .refresh:
                return []
            }
        }

        /// The line a stepper press changes, so the next press on it can fold in.
        var stepped: String? {
            switch self {
            case let .set(lineId, _), let .remove(lineId):
                return lineId
            default:
                return nil
            }
        }

        /// The line whose delivery is being moved, which waits for its answer.
        var routed: String? {
            switch self {
            case let .destination(lineId, _), let .speed(lineId, _):
                return lineId
            default:
                return nil
            }
        }
    }

    private struct Entry {
        let id: Int
        var change: Change
        var sent = false
    }

    /// The bag as the server last answered.
    private var confirmed: Cart?
    /// Presses drawn and not yet answered, oldest first.
    private var waiting: [Entry] = []
    @ObservationIgnored private var waiters: [Int: [CheckedContinuation<Bool, Never>]] = [:]
    @ObservationIgnored private var nextEntry = 0
    @ObservationIgnored private var pumping = false
    /// How many answers the queue has kept, so a slower read of the stored bag
    /// never overwrites a newer one.
    @ObservationIgnored private var answers = 0
    private var restoring = false
    private(set) var lastError: APIError?

    private let service: CartServicing
    private let defaults: UserDefaults
    static let storageKey = "netlet.cartId"

    init(service: CartServicing, defaults: UserDefaults = .standard) {
        self.service = service
        self.defaults = defaults
    }

    /// The bag drawn: the server's last answer with every press still waiting
    /// applied over it.
    var cart: Cart? {
        waiting.reduce(confirmed) { bag, entry in entry.change.guesses.reduce(bag) { BagOps.apply($0, $1) } }
    }

    /// Whether a press is still on its way: the delivery and the total are the
    /// server's last until it answers, and checkout waits for it.
    var syncing: Bool { waiting.contains { !$0.change.guesses.isEmpty } }

    /// True while the stored bag is first read or the first item is on its way
    /// with nothing to draw yet, so the cart screen never says "empty" before
    /// it knows — the web's `settling`.
    var settling: Bool { restoring || (syncing && (cart?.isEmpty ?? true)) }

    /// The line whose delivery is being moved, so only its own choices wait.
    var busyLine: String? { waiting.lazy.compactMap { $0.change.routed }.first }

    var cartId: String? { confirmed?.id ?? defaults.string(forKey: Self.storageKey) }

    /// The number on the tab's badge. Zero draws no badge, the web's rule: a
    /// badge reading "0" is an alert that never stops firing.
    var itemCount: Int { cart?.itemCount ?? 0 }

    func quantity(of variantId: String) -> Int {
        cart?.plainLine(for: variantId)?.quantity ?? 0
    }

    /// Reads the bag this device kept. One the server no longer has is forgotten.
    func restore() async {
        guard let id = defaults.string(forKey: Self.storageKey) else { return }
        restoring = true
        defer { restoring = false }
        let before = answers
        do {
            let found = try await service.get(id)
            // A press answered meanwhile is newer than this read.
            guard answers == before, waiting.isEmpty else { return }
            if let found { confirmed = found } else { forget() }
        } catch {
            lastError = APIError.from(error)
        }
    }

    /// Adds to the plain line for a variant, making the bag first if there is
    /// none. Handed the product, the line is drawn at once from it; without, the
    /// count moves and the line comes with the answer. True once the server has it.
    @discardableResult
    func add(variantId: String, quantity: Int = 1, product: Product? = nil) async -> Bool {
        lastError = nil
        let ghost = product.flatMap { BagOps.ghostLine($0, variantId: variantId, quantity: quantity) }
        return await enqueue(.add(variantId: variantId, quantity: quantity, ghost: ghost))
    }

    /// Adds lines that carry extras or belong to a set — one call, so a set
    /// goes in whole or not at all.
    @discardableResult
    func add(lines: [API.CartLine]) async -> Bool {
        lastError = nil
        return await enqueue(.lines(lines))
    }

    /// Sets a line's quantity; zero takes it out. Drawn at once.
    func setQuantity(lineId: String, to quantity: Int) async {
        _ = await enqueue(quantity <= 0 ? .remove(lineId: lineId) : .set(lineId: lineId, quantity: quantity))
    }

    /// Sends one line to a saved address, or back where the order goes —
    /// the web's `ItemDestinations`. Each seller's delivery is then priced
    /// per door.
    @discardableResult
    func setDestination(lineId: String, addressId: Int?) async -> Bool {
        guard cartId != nil else { return false }
        return await enqueue(.destination(lineId: lineId, addressId: addressId))
    }

    /// Fast or regular for one line (3.2.5) — the web's `SpeedChoice`. Fast
    /// from one store to one door is its own parcel with its own fee, which
    /// the summary then shows as its own row.
    @discardableResult
    func setDeliveryChoice(lineId: String, fast: Bool) async -> Bool {
        guard cartId != nil else { return false }
        return await enqueue(.speed(lineId: lineId, fast: fast))
    }

    /// Reads the bag again — after an order, which empties it on the server.
    /// In the queue, so a read cannot overtake a change still on its way.
    func refresh() async {
        guard cartId != nil else { return }
        _ = await enqueue(.refresh)
    }

    /// Takes on the bag the account already has, from another device or an
    /// earlier visit, when the server answers with one that is not this device's.
    func adopt(cartId: String?) async {
        guard let cartId, cartId != self.cartId else { return }
        defaults.set(cartId, forKey: Self.storageKey)
        await restore()
    }

    /// Leaves the device at sign-out, the web's rule: the next person to use it
    /// saw the last shopper's bag. The account keeps it for the next sign-in.
    func forget() {
        confirmed = nil
        defaults.removeObject(forKey: Self.storageKey)
    }

    func clearError() { lastError = nil }

    // MARK: The queue

    /// Puts a change in the queue — folded into the last one when both are
    /// presses on one line's stepper and the last has not gone — and answers
    /// whether the server took it.
    private func enqueue(_ change: Change) async -> Bool {
        await withCheckedContinuation { (waiter: CheckedContinuation<Bool, Never>) in
            if let last = waiting.indices.last, !waiting[last].sent,
               let line = waiting[last].change.stepped, line == change.stepped {
                waiting[last].change = change
                waiters[waiting[last].id, default: []].append(waiter)
            } else {
                nextEntry += 1
                waiting.append(Entry(id: nextEntry, change: change))
                waiters[nextEntry] = [waiter]
            }
            Task { @MainActor in await self.pump() }
        }
    }

    /// Sends what is waiting, one change at a time, in the order pressed.
    private func pump() async {
        guard !pumping else { return }
        pumping = true
        var refused = false
        while let entry = waiting.first {
            waiting[0].sent = true
            let took: Bool
            do {
                took = try await send(entry.change)
            } catch {
                let failure = APIError.from(error)
                if failure != .cancelled { lastError = failure }
                took = false
            }
            if !took {
                refused = true
                // The press was felt; that it did not take is felt too.
                if entry.change.stepped != nil || entry.change.routed != nil { Haptics.refused() }
            }
            waiting.removeFirst()
            for waiter in waiters.removeValue(forKey: entry.id) ?? [] { waiter.resume(returning: took) }
        }
        pumping = false
        // A refusal may have been half done — a dropped connection after the
        // server wrote — so the bag is read again rather than assumed.
        if refused, let id = cartId, let fresh = try? await service.get(id), waiting.isEmpty {
            keep(fresh)
        }
    }

    /// Sends one change and keeps the bag the server answers with; false when
    /// the server could not take it.
    private func send(_ change: Change) async throws -> Bool {
        switch change {
        case let .add(variantId, quantity, _):
            if let id = cartId {
                if let updated = try await service.add(id, variantId: variantId, quantity: quantity) {
                    keep(updated)
                    return true
                }
                // The server no longer has that bag; a new one takes its place.
                forget()
            }
            keep(try await service.create(variantId: variantId, quantity: quantity))
            return true
        case let .lines(lines):
            if let id = cartId, let updated = try await service.addLines(id, lines: lines) {
                keep(updated)
                return true
            }
            if cartId != nil { forget() }
            guard let made = try await service.addLines(nil, lines: lines) else { return false }
            keep(made)
            return true
        case let .set(lineId, quantity):
            // A press on a drawn-ahead line goes to the real one; none means the add it followed failed.
            guard let id = cartId, let line = BagOps.realLineId(confirmed, lineId) else { return true }
            if let updated = try await service.setQuantity(id, lineId: line, quantity: quantity) { keep(updated) } else { forget() }
            return true
        case let .remove(lineId):
            guard let id = cartId, let line = BagOps.realLineId(confirmed, lineId) else { return true }
            if let updated = try await service.setQuantity(id, lineId: line, quantity: 0) { keep(updated) } else { forget() }
            return true
        case let .destination(lineId, addressId):
            guard let id = cartId, let line = BagOps.realLineId(confirmed, lineId) else { return false }
            if let found = try await service.setDestination(id, lineId: line, addressId: addressId) { keep(found) }
            return true
        case let .speed(lineId, fast):
            guard let id = cartId, let line = BagOps.realLineId(confirmed, lineId) else { return false }
            if let found = try await service.setDeliveryChoice(id, lineId: line, choice: fast ? "fast" : "regular") { keep(found) }
            return true
        case .refresh:
            guard let id = cartId else { return true }
            if let found = try await service.get(id), !found.isEmpty { keep(found) } else { forget() }
            return true
        }
    }

    private func keep(_ cart: Cart) {
        confirmed = cart
        answers += 1
        defaults.set(cart.id, forKey: Self.storageKey)
    }
}
