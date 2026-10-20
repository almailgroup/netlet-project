import Foundation
import Observation

/// The bag, for the whole app: the badge on its tab, the count on a product
/// page and the cart screen all read this one copy.
///
/// The bag lives on the server; all this device keeps is its id, the way the
/// web keeps it in the browser. The id is a random token rather than a number
/// because it is the only thing separating one shopper's bag from another's.
@Observable
@MainActor
final class CartModel {
    private(set) var cart: Cart?
    /// True while the stored bag is first read or the first item is going in,
    /// so the cart screen never says "empty" before it knows — the web's `settling`.
    private(set) var settling = false
    /// The line being changed, so only its own stepper waits.
    private(set) var busyLine: String?
    private(set) var lastError: APIError?

    private let service: CartServicing
    private let defaults: UserDefaults
    static let storageKey = "netlet.cartId"

    init(service: CartServicing, defaults: UserDefaults = .standard) {
        self.service = service
        self.defaults = defaults
    }

    var cartId: String? { cart?.id ?? defaults.string(forKey: Self.storageKey) }

    /// The number on the tab's badge. Zero draws no badge, the web's rule: a
    /// badge reading "0" is an alert that never stops firing.
    var itemCount: Int { cart?.itemCount ?? 0 }

    func quantity(of variantId: String) -> Int {
        cart?.plainLine(for: variantId)?.quantity ?? 0
    }

    /// Reads the bag this device kept. One the server no longer has is forgotten.
    func restore() async {
        guard let id = defaults.string(forKey: Self.storageKey) else { return }
        settling = true
        defer { settling = false }
        do {
            if let found = try await service.get(id) { cart = found } else { forget() }
        } catch {
            lastError = APIError.from(error)
        }
    }

    /// Adds to the plain line for a variant, making the bag first if there is none.
    @discardableResult
    func add(variantId: String, quantity: Int = 1) async -> Bool {
        lastError = nil
        let first = cart == nil
        if first { settling = true }
        defer { if first { settling = false } }
        do {
            if let id = cartId {
                if let updated = try await service.add(id, variantId: variantId, quantity: quantity) {
                    store(updated)
                    return true
                }
                // The server no longer has that bag; a new one takes its place.
                forget()
            }
            store(try await service.create(variantId: variantId, quantity: quantity))
            return true
        } catch {
            lastError = APIError.from(error)
            return false
        }
    }

    /// Sets a line's quantity; zero takes it out.
    func setQuantity(lineId: String, to quantity: Int) async {
        guard let id = cartId else { return }
        busyLine = lineId
        defer { busyLine = nil }
        do {
            if let updated = try await service.setQuantity(id, lineId: lineId, quantity: max(0, quantity)) {
                store(updated)
            } else {
                forget()
            }
        } catch {
            // The press was felt; that it did not take is felt too.
            Haptics.refused()
            lastError = APIError.from(error)
        }
    }

    /// Reads the bag again — after an order, which empties it on the server.
    func refresh() async {
        guard let id = cartId else { return }
        do {
            if let found = try await service.get(id), !found.isEmpty { cart = found } else { forget() }
        } catch {
            lastError = APIError.from(error)
        }
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
        cart = nil
        defaults.removeObject(forKey: Self.storageKey)
    }

    func clearError() { lastError = nil }

    private func store(_ cart: Cart) {
        self.cart = cart
        defaults.set(cart.id, forKey: Self.storageKey)
    }
}
