import SwiftUI

/// What a tick circle in the bag does when it is unticked, on the owner's word
/// ("automatically move products to Save for Later when unchecked in the
/// cart") — the web's `useUntickToSaved`. The lines leave the bag for Saved,
/// which the cart lists under Checkout as "Saved for later" with Move to cart,
/// rather than staying in the bag left out of this checkout.
/// `CartChoice.untick` decides which lines and whether Undo can put them back;
/// a line whose product the bag does not say is left out of checkout instead.
///
/// A move, not a removal, so nothing is asked first; the toast says where they
/// went, with Undo where every line can be added again as it was.
@MainActor
enum UntickToSaved {
    static func run(_ lineIds: [String], app: AppModel, l: LanguageSettings) {
        let items = app.cart.cart?.items ?? []
        let plan = CartChoice.untick(CartChoice.savable(items), lineIds)
        if !plan.leave.isEmpty { app.cart.choose(plan.leave, chosen: false) }
        guard !plan.move.isEmpty else { return }

        let moving = Set(plan.move)
        let moved = items.filter { moving.contains($0.lineId) }
        let wasSaved = Set(plan.productIds.filter { app.saved.contains($0) })
        let productIds = plan.productIds
        Task {
            for productId in productIds { await app.saved.save(productId) }
        }
        // Each line goes at once, through the bag's queue, so none waits on
        // another's answer; a refusal is said once, however many were refused.
        let refusal = Refusal(text: l.t("cart.updateFailed"))
        for line in moved {
            let lineId = line.lineId
            Task {
                if !(await app.cart.setQuantity(lineId: lineId, to: 0)) { refusal.say(app) }
            }
        }

        let message = moved.count == 1
            ? l.t("cart.savedForLater", ["name": "\u{2068}\(moved[0].title(l.current))\u{2069}"])
            : l.t("cart.movedToSaved", ["count": String(moved.count)])
        var undo: (@MainActor () -> Void)?
        if plan.undoable {
            let addFailed = l.t("cart.addFailed")
            let lines = moved.map { (variantId: $0.variantId, quantity: $0.quantity) }
            undo = {
                Task {
                    for productId in productIds where !wasSaved.contains(productId) {
                        await app.saved.unsave(productId)
                    }
                    for line in lines {
                        if !(await app.cart.add(variantId: line.variantId, quantity: line.quantity)) { app.toast(addFailed) }
                    }
                }
            }
        }
        app.toast(message, undo: undo)
    }

    /// Says a refusal once, however many of the lines it was about.
    @MainActor
    private final class Refusal {
        let text: String
        private var said = false
        init(text: String) { self.text = text }
        func say(_ app: AppModel) {
            guard !said else { return }
            said = true
            app.toast(text)
        }
    }
}
