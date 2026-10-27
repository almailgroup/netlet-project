import UIKit

/// A bar above the keyboard with "Hide keyboard" on it, for every text field
/// and text box in the app — **on the owner's word**, who could not put the
/// keyboard away once it was up: a number pad has no return key, a box that
/// takes several lines turns return into a new line, and a sheet's form does
/// not always have a scroll to drag it down by.
///
/// It is the field's own `inputAccessoryView`, set as editing begins, rather
/// than a SwiftUI keyboard toolbar: one of those on each field draws its items
/// once per field on the screen, and one per screen misses the sheets, the
/// search and the seller portal, which present their own hierarchies. This
/// covers every field the app has and every one added later, with no screen
/// having to remember it. A field that brings its own bar keeps it.
///
/// The words are the page's language, and the bar's direction follows it, so
/// the button sits at the end of the line on either page.
@MainActor
enum KeyboardBar {
    private static var observers: [NSObjectProtocol] = []
    private static var language: LanguageSettings?

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
            MainActor.assumeIsolated { attach(box) }
        })
    }

    private static func attach(_ field: UITextField?) {
        guard let field, field.inputAccessoryView == nil || field.inputAccessoryView is Bar else { return }
        field.inputAccessoryView = bar()
        field.reloadInputViews()
    }

    private static func attach(_ box: UITextView?) {
        guard let box, box.isEditable, box.inputAccessoryView == nil || box.inputAccessoryView is Bar else { return }
        box.inputAccessoryView = bar()
        box.reloadInputViews()
    }

    /// The bar is made again each time, so its words are the language in use now.
    private static func bar() -> Bar {
        let title = language?.t("ios.keyboard.hide") ?? "Hide keyboard"
        var configuration = UIButton.Configuration.plain()
        configuration.attributedTitle = AttributedString(title, attributes: AttributeContainer([.font: Inter.uiFont(15, .semibold)]))
        configuration.image = UIImage(systemName: "keyboard.chevron.compact.down")
        configuration.imagePadding = 6
        configuration.baseForegroundColor = UIColor(Brand.navy)
        let button = UIButton(configuration: configuration, primaryAction: UIAction { _ in
            MainActor.assumeIsolated {
                Haptics.tap()
                UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
            }
        })
        button.accessibilityLabel = title

        let bar = Bar(frame: CGRect(x: 0, y: 0, width: 320, height: 44))
        bar.items = [UIBarButtonItem(systemItem: .flexibleSpace), UIBarButtonItem(customView: button)]
        let rightToLeft = language?.current.isRightToLeft ?? false
        bar.semanticContentAttribute = rightToLeft ? .forceRightToLeft : .forceLeftToRight
        button.semanticContentAttribute = bar.semanticContentAttribute
        bar.sizeToFit()
        return bar
    }

    /// Ours, told apart from a bar a field brought itself.
    final class Bar: UIToolbar {}
}
