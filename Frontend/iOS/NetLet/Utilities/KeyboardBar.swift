import ObjectiveC
import UIKit

/// Where a field keeps the bar it was handed — the key the runtime stores it
/// under, read from the getter below whatever its isolation.
private nonisolated(unsafe) let keyboardBarKey = UnsafeMutableRawPointer.allocate(byteCount: 1, alignment: 1)

/// A bar above the keyboard with **Done** on it, for every text field and text
/// box in the app — on the owner's word, twice: first because they could not
/// put the keyboard away once it was up (a number pad has no return key, a box
/// of several lines turns return into a new line), then — with a screenshot of
/// the product page's quantity box and a number pad with nothing above it —
/// "add an enter button for setting a value … for all the input fields so
/// that the number applies". Done puts the keyboard away, and every quantity
/// box applies what was typed as it loses focus (`QuantityStepper.commit`), so
/// Done is the Enter the number pad lacks.
///
/// **The first version never showed.** It set each field's
/// `inputAccessoryView` as editing began, but only where the field had none of
/// its own — and SwiftUI gives every field one of its own (an empty host for
/// keyboard toolbars), so the bar was skipped on every field in the app, the
/// search included, as the CI's screenshot of it showed. Now the bar is the
/// field's answer whenever the keyboard asks: the getter of
/// `inputAccessoryView` on the field's own class answers with the bar the
/// field was handed as it began editing, so nothing SwiftUI sets afterwards
/// can replace it. No screen in the app brings a keyboard bar of its own.
///
/// One listener covers every field the app has and every one added later,
/// the sheets, the search and the seller portal included. The words are the
/// page's language, and Done sits at the end of the line on either page —
/// the right in English, the left in Arabic.
///
/// **The bar is a plain view, and Done is pinned to a side by name.** It was
/// a `UIToolbar` told its direction (`semanticContentAttribute`), and on iOS
/// 26 a toolbar lays its items out by the phone's own language whatever it is
/// told: on a phone set to English reading the Arabic page, Done stayed at
/// the right, over the first of the search sheet's quick links, which start
/// from the right there (the CI's Arabic picture of the search). Left and
/// right anchors mean what they say on every iOS.
@MainActor
enum KeyboardBar {
    private static var observers: [NSObjectProtocol] = []
    private static var language: LanguageSettings?
    /// The field classes whose getter already answers with the bar.
    private static var patched: Set<ObjectIdentifier> = []

    /// Watches for any field beginning to edit; called once, as the app starts.
    static func install(language settings: LanguageSettings) {
        language = settings
        guard observers.isEmpty else { return }
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UITextField.textDidBeginEditingNotification, object: nil, queue: .main) { note in
            let field = note.object as? UITextField
            MainActor.assumeIsolated { attach(field) }
        })
        observers.append(center.addObserver(forName: UITextView.textDidBeginEditingNotification, object: nil, queue: .main) { note in
            let box = note.object as? UITextView
            MainActor.assumeIsolated {
                guard let box, box.isEditable else { return }
                attach(box)
            }
        })
    }

    /// Says when a keyboard comes up and when it goes, for what floats over a
    /// page's foot to step aside for it (`floatsAtFoot`); called once, as the
    /// app starts.
    static func watch(_ changed: @escaping @MainActor (Bool) -> Void) {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: UIResponder.keyboardWillShowNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { changed(true) }
        })
        observers.append(center.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { changed(false) }
        })
    }

    /// Hands the field a bar in the language in use now, and has the keyboard
    /// ask for it again.
    private static func attach(_ field: UIResponder?) {
        guard let field else { return }
        patch(type(of: field))
        objc_setAssociatedObject(field, keyboardBarKey, bar(), .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        field.reloadInputViews()
    }

    /// Has a field class answer `inputAccessoryView` with the bar it was
    /// handed, and with its own answer where it was handed none. Added to the
    /// class itself where it only inherits the getter, so no other class's
    /// fields are touched; replaced where the class has its own.
    private static func patch(_ type: AnyClass) {
        let id = ObjectIdentifier(type)
        guard !patched.contains(id) else { return }
        patched.insert(id)
        let selector = #selector(getter: UIResponder.inputAccessoryView)
        guard let method = class_getInstanceMethod(type, selector) else { return }
        typealias Getter = @convention(c) (AnyObject, Selector) -> UIView?
        let own = unsafeBitCast(method_getImplementation(method), to: Getter.self)
        let answer: @convention(block) (AnyObject) -> UIView? = { field in
            if let bar = objc_getAssociatedObject(field, keyboardBarKey) as? UIView { return bar }
            return own(field, selector)
        }
        let implementation = imp_implementationWithBlock(answer)
        if !class_addMethod(type, selector, implementation, method_getTypeEncoding(method)) {
            method_setImplementation(method, implementation)
        }
    }

    /// The bar is made again each time, so its words are the language in use now.
    private static func bar() -> Bar {
        let title = language?.t("ios.keyboard.done") ?? "Done"
        var configuration = UIButton.Configuration.filled()
        configuration.attributedTitle = AttributedString(title, attributes: AttributeContainer([.font: Inter.uiFont(15, .bold)]))
        configuration.image = UIImage(systemName: "checkmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .bold))
        configuration.imagePadding = 6
        configuration.cornerStyle = .capsule
        configuration.baseBackgroundColor = UIColor(Brand.navy)
        configuration.baseForegroundColor = .white
        // A white rim, so over a navy button showing through the row Done
        // reads as its own control: "Send code" and Done ran into one pill.
        configuration.background.strokeColor = UIColor.white.withAlphaComponent(0.9)
        configuration.background.strokeWidth = 1.5
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 16, bottom: 7, trailing: 16)
        let button = UIButton(configuration: configuration, primaryAction: UIAction { _ in
            MainActor.assumeIsolated {
                Haptics.tap()
                // Losing focus is what applies a typed number.
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
        })
        button.accessibilityLabel = title

        let rightToLeft = language?.current.isRightToLeft ?? false
        button.semanticContentAttribute = rightToLeft ? .forceRightToLeft : .forceLeftToRight
        button.translatesAutoresizingMaskIntoConstraints = false

        let bar = Bar(frame: CGRect(x: 0, y: 0, width: 320, height: Bar.height))
        bar.autoresizingMask = .flexibleWidth
        bar.backgroundColor = .clear
        // Before iOS 26 a keyboard's bar is a strip of its own; from 26 the
        // navy capsule floats over the page, as the system's own do.
        if #unavailable(iOS 26.0) {
            let strip = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
            strip.frame = bar.bounds
            strip.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            bar.addSubview(strip)
        }
        bar.addSubview(button)
        let edges = bar.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            button.centerYAnchor.constraint(equalTo: bar.centerYAnchor),
            rightToLeft
                ? button.leftAnchor.constraint(equalTo: edges.leftAnchor, constant: Bar.margin)
                : button.rightAnchor.constraint(equalTo: edges.rightAnchor, constant: -Bar.margin),
        ])
        return bar
    }

    /// Ours, told apart from a bar a field brought itself.
    final class Bar: UIView {
        static let height: CGFloat = 48
        /// Done's distance from the screen's side.
        static let margin: CGFloat = 20

        override var intrinsicContentSize: CGSize {
            CGSize(width: UIView.noIntrinsicMetric, height: Self.height)
        }

        /// Only Done takes a touch; the rest of the row lets it through. From
        /// iOS 26 the row is clear and the page shows through it — the form's
        /// own button, often, since it follows the box being typed in — and a
        /// clear row that kept the touch made that button one that could be
        /// seen and not pressed.
        override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
            let hit = super.hitTest(point, with: event)
            return hit === self ? nil : hit
        }
    }
}
