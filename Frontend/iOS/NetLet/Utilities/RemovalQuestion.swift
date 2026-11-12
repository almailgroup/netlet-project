import UIKit

/// "Remove this?", asked before anything a shopper keeps is taken away, on
/// the owner's word ("for removing anything, first it should ask you if you
/// are sure you want to remove this, like removing products from cart") — the
/// web's `useConfirmRemoval`.
///
/// It is the system's own alert, with Cancel as the bold, safe answer and the
/// verb in red, and it is presented by UIKit from whatever is on top — a
/// sheet, the product preview, a cover — because a SwiftUI `.alert` hung on a
/// page cannot show over a sheet that page opened, and the bin pressed may be
/// in either. The words are the dictionary's, in the app's language.
@MainActor
enum RemovalQuestion {
    /// Asks, and answers whether the shopper is sure. With no window to ask
    /// in (a unit test) nothing is asked; with an alert already up, the answer
    /// is no rather than a question that could never be answered.
    static func ask(title: String, message: String, confirm: String, cancel: String) async -> Bool {
        guard let presenter = topController() else { return true }
        if presenter is UIAlertController { return false }
        return await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: cancel, style: .cancel) { _ in continuation.resume(returning: false) })
            let remove = UIAlertAction(title: confirm, style: .destructive) { _ in continuation.resume(returning: true) }
            alert.addAction(remove)
            presenter.present(alert, animated: true)
        }
    }

    /// The topmost view controller of the key window.
    private static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let windows = scenes.flatMap(\.windows)
        var top = (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
        while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }

    /// A name inside a sentence, isolated so a Latin name keeps its place in Arabic.
    private static func isolated(_ name: String) -> String { "\u{2068}\(name)\u{2069}" }

    /// Any question, in the app's words: `remove.confirm` on the button
    /// unless another verb is given, `common.cancel` beside it.
    static func ask(_ l: LanguageSettings, title: String, message: String, confirm: String? = nil) async -> Bool {
        await ask(title: title, message: message, confirm: confirm ?? l.t("remove.confirm"), cancel: l.t("common.cancel"))
    }

    /// The bag's question, asked by every way a line leaves it — the bin, the
    /// minus at one, a typed zero, "Remove from cart" in a line's menu, the
    /// card's and the photo's steppers, the product page's and the preview's.
    static func cart(_ name: String, _ l: LanguageSettings) async -> Bool {
        await ask(l, title: l.t("remove.cartTitle"), message: l.t("remove.cartBody", ["name": isolated(name)]))
    }

    /// A filled heart's question: out of Saved, or off the wishlists too.
    static func unheart(_ name: String, wished: Bool, _ l: LanguageSettings) async -> Bool {
        await ask(l, title: l.t("remove.savedTitle"), message: l.t(wished ? "remove.heartWishedBody" : "remove.savedBody", ["name": isolated(name)]))
    }

    /// One product out of Saved items.
    static func saved(_ name: String, _ l: LanguageSettings) async -> Bool {
        await ask(l, title: l.t("remove.savedTitle"), message: l.t("remove.savedBody", ["name": isolated(name)]))
    }

    /// One product out of the browsing history.
    static func history(_ name: String, _ l: LanguageSettings) async -> Bool {
        await ask(l, title: l.t("remove.historyTitle"), message: l.t("remove.historyBody", ["name": isolated(name)]))
    }

    /// A code typed on one line, the order's code or a gift card.
    static func code(_ code: String, scope: CodeScope, _ l: LanguageSettings) async -> Bool {
        switch scope {
        case .line: return await ask(l, title: l.t("remove.codeTitle"), message: l.t("remove.lineCodeBody", ["code": isolated(code)]))
        case .order: return await ask(l, title: l.t("remove.codeTitle"), message: l.t("remove.orderCodeBody", ["code": isolated(code)]))
        case .giftCard: return await ask(l, title: l.t("remove.giftTitle"), message: l.t("remove.giftBody", ["code": isolated(code)]))
        }
    }

    enum CodeScope { case line, order, giftCard }

    /// A photo chosen for something not yet sent — a review, a claim.
    static func photo(_ l: LanguageSettings) async -> Bool {
        await ask(l, title: l.t("remove.photoTitle"), message: l.t("remove.photoBody"))
    }

    /// A row of a form in the portal, gone only once the form is saved.
    static func formRow(_ l: LanguageSettings) async -> Bool {
        await ask(l, title: l.t("remove.formTitle"), message: l.t("remove.formBody"))
    }
}
