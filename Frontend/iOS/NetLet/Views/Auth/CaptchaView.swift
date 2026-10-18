import SwiftUI
import WebKit

/// Google's "I'm not a robot" box, which guards Create account on the web too.
///
/// It is the same reCAPTCHA v2 widget, drawn in a web view whose page claims
/// NetLet's own address as its origin — the domain the site key is registered
/// for — and its token comes back through a message handler. The server asks
/// Google about the token before any code is emailed; a token is good once.
struct CaptchaView: UIViewRepresentable {
    let siteKey: String
    let origin: URL
    let language: Language
    let onToken: (String?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onToken: onToken) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: "captcha")
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.isScrollEnabled = false
        view.loadHTMLString(Self.page(siteKey: siteKey, language: language), baseURL: origin)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.onToken = onToken
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "captcha")
    }

    /// The widget's page. The key is reduced to the characters a key has, so
    /// nothing the server sent can become markup.
    static func page(siteKey: String, language: Language) -> String {
        let key = siteKey.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        return """
        <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <script src="https://www.google.com/recaptcha/api.js?hl=\(language.rawValue)" async defer></script>
        </head><body style="margin:0;background:transparent;display:flex;justify-content:center">
        <div class="g-recaptcha" data-sitekey="\(key)" data-callback="done" data-expired-callback="lapsed" data-error-callback="lapsed"></div>
        <script>
        function done(token){ window.webkit.messageHandlers.captcha.postMessage(token); }
        function lapsed(){ window.webkit.messageHandlers.captcha.postMessage(""); }
        </script></body></html>
        """
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler {
        var onToken: (String?) -> Void

        init(onToken: @escaping (String?) -> Void) {
            self.onToken = onToken
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            let token = message.body as? String
            onToken(token?.isEmpty == false ? token : nil)
        }
    }
}
