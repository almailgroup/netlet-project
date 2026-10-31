import Foundation
import Observation

/// What the shopper chose to take off the bag at checkout — a discount code, a
/// gift card and whether to spend points — the web's `lib/bagSavings.ts` and
/// `useSavingsBill`. Checkout draws `BagSavingsCard` from this model, held by
/// `AppModel` so leaving checkout and coming back keeps what was chosen.
///
/// **A discount and a gift card are two boxes, and one order may use both.**
/// Each box asks the shop what a code is, so a code typed in the wrong one is
/// moved to the right one and said so; one of each per order. What comes off,
/// and in what order, is `Till.settle` — the order writer's own rule. Kept for
/// one bag: a choice made for a bag that has since gone is not carried on.
@Observable
@MainActor
final class SavingsModel {
    enum Box: Sendable { case discount, gift }

    private(set) var cartId: String?
    private(set) var code = ""
    private(set) var giftCard = ""
    var usePoints = false
    private(set) var codeQuote: API.VoucherQuote?
    private(set) var giftQuote: API.VoucherQuote?
    /// The points balance; nil until read, zero for a guest.
    private(set) var balance: Int?
    /// A line under a box once something was asked: a refusal's key, or
    /// where a code went. `good` draws it green.
    private(set) var notes: [Box: (key: String, good: Bool)] = [:]
    private(set) var asking: Set<Box> = []

    private let api: APICalling?

    init(api: APICalling?) {
        self.api = api
    }

    /// Starts afresh for another bag: what was chosen was for the last one.
    func follow(cartId: String?) {
        guard cartId != self.cartId else { return }
        self.cartId = cartId
        code = ""
        giftCard = ""
        usePoints = false
        codeQuote = nil
        giftQuote = nil
        notes = [:]
    }

    /// The balance, for an account; a guest has none to spend.
    func loadBalance(signedIn: Bool) async {
        guard signedIn, let api else {
            balance = 0
            usePoints = false
            return
        }
        balance = (try? await api.call(API.rewards))?.balance ?? balance ?? 0
    }

    /// Asks what `typed` is, on the press — only a code naming nothing counts
    /// against the guesses' ceiling, so it is never asked on its own — and
    /// puts it in the box it belongs in.
    func apply(_ typed: String, in box: Box, cartId: String) async -> Bool {
        let typed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty, let api, !asking.contains(box) else { return false }
        follow(cartId: cartId)
        asking.insert(box)
        defer { asking.remove(box) }
        notes[box] = nil
        do {
            let answer = try await api.call(API.quoteVoucher, .init(cartId: cartId, code: typed))
            guard answer.ok else {
                notes[box] = (answer.reason ?? "voucher.unknown", false)
                Haptics.refused()
                return false
            }
            let into: Box = answer.kind == "gift" ? .gift : .discount
            let held = into == .gift ? giftCard : code
            // One of each per order: a second waits for the first to come off.
            if !held.isEmpty, Self.normalise(held) != Self.normalise(typed) {
                notes[box] = ("cart.oneEach", false)
                Haptics.refused()
                return false
            }
            if into == .gift {
                giftCard = typed
                giftQuote = answer
            } else {
                code = typed
                codeQuote = answer
            }
            if into != box { notes[box] = (into == .gift ? "cart.codeIsGift" : "cart.giftIsCode", true) }
            return true
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { notes[box] = (failure.messageKey(knownKey: Phrasebook.shared.has), false) }
            return false
        }
    }

    func remove(_ box: Box) {
        Haptics.tap()
        if box == .gift {
            giftCard = ""
            giftQuote = nil
        } else {
            code = ""
            codeQuote = nil
        }
        notes[box] = nil
    }

    /// A percentage and a minimum spend are of the goods, so each held code
    /// is asked about again when the goods change; a code that works is not a
    /// guess, and costs nothing against the ceiling.
    func requote(cartId: String) async {
        guard cartId == self.cartId, let api else { return }
        if !code.isEmpty { codeQuote = try? await api.call(API.quoteVoucher, .init(cartId: cartId, code: code)) }
        if !giftCard.isEmpty { giftQuote = try? await api.call(API.quoteVoucher, .init(cartId: cartId, code: giftCard)) }
    }

    /// What this bag comes to with the code, the card and the points.
    func bill(for cart: Cart) -> Till.Bill {
        let mine = cart.id == cartId
        return Till.bill(
            for: cart,
            discount: mine ? codeQuote : nil,
            gift: mine ? giftQuote : nil,
            balance: balance ?? 0,
            usePoints: mine && usePoints
        )
    }

    /// The order's fields: only a code not known to be refused, and points
    /// only when some are spent.
    func orderFields(for cart: Cart) -> (voucherCode: String?, giftCardCode: String?, usePoints: Bool?) {
        guard cart.id == cartId else { return (nil, nil, nil) }
        let code = self.code.isEmpty || codeQuote?.ok == false ? nil : self.code
        let gift = giftCard.isEmpty || giftQuote?.ok == false ? nil : giftCard
        return (code, gift, bill(for: cart).points.isZero ? nil : true)
    }

    /// A code as the shop reads it: upper case, spaces and dashes dropped —
    /// the server's `normaliseCode`, so one typed twice two ways is one code.
    nonisolated static func normalise(_ code: String) -> String {
        code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased().filter { !$0.isWhitespace && $0 != "-" }
    }
}
