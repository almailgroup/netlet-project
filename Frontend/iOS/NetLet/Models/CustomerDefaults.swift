import Foundation

/// What an account starts every order from (0088): the default delivery
/// address and the default way to pay — `Shared/commerce/customerDefaults.ts`,
/// answered by `customer.defaults.get`.
///
/// **The default address is the address in use** (`DeliveryModel.inUse`):
/// choosing one in the header's sheet, the address book's "Set as default" or
/// Quick settings chooses it, and every one of them writes it here as well as
/// on the phone. `ready` is false until the table is pasted, and the phone's
/// own key is the whole of it until then.
struct CustomerDefaults: Decodable, Sendable, Equatable {
    let ready: Bool
    let addressId: Int?
    /// The default address's governorate, so a phone adopting it delivers to its area too.
    let governorate: String?
    /// `cod`, `knet`, `card` or `apple_pay`; nil while none can be chosen.
    let payment: String?
    /// The ways that can be chosen now — cash on delivery while the shop takes it.
    let choosable: [String]

    /// Every way to pay, in the order they are drawn (`PAYMENT_METHODS`).
    static let paymentMethods = ["cod", "knet", "card", "apple_pay"]

    /// The dictionary's name for a way to pay, checkout's own words.
    static func nameKey(_ method: String) -> String {
        switch method {
        case "knet": "checkout.payKnet"
        case "card": "checkout.payCard"
        case "apple_pay": "checkout.payApple"
        default: "checkout.payCod"
        }
    }

    /// The SF Symbol each is drawn with.
    static func symbol(_ method: String) -> String {
        switch method {
        case "knet": "creditcard.and.123"
        case "card": "creditcard"
        case "apple_pay": "apple.logo"
        default: "banknote"
        }
    }

    /// `defaultPayment`: the one kept while it can be chosen, else the first that can.
    static func startingPayment(_ stored: String?, choosable: [String]) -> String? {
        if let stored, choosable.contains(stored) { return stored }
        return choosable.first
    }
}
