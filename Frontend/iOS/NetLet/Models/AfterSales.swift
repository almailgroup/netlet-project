import Foundation

/// The opened order as an after-sales centre, on the owner's word — the
/// web's `OrderActions`: what can still be changed before a driver has it,
/// the warranty claims on it, buying it again and "Get help with this order".
/// Every rule is the server's (`Shared/commerce/orderChanges.ts`,
/// `warranty.ts`, `orderHelp.ts`); these are its answers, decoded.

/// `shopperChangeState` / `addressChangeState`: changeable, or the message key saying why not.
struct OrderChangeState: Decodable, Hashable, Sendable {
    let changeable: Bool
    let reason: String?

    static let closed = OrderChangeState(changeable: false, reason: nil)
}

/// A warranty claim on one of the order's items (migration 0072), with where
/// it stands — the one word the shopper and the store's desk both read.
struct WarrantyClaim: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let orderItemId: Int
    let status: String
    let problem: String
    let photos: [String]
    let remedy: String?
    let response: String?
    let createdAt: Date
    /// waiting, repairing, returning, done, declined or withdrawn (`claimStage`).
    let stage: String
    /// What the shopper may do now: "withdraw" while nobody has answered.
    let actions: [String]

    var mayWithdraw: Bool { actions.contains("withdraw") }

    static func stageKey(_ stage: String) -> String {
        switch stage {
        case "repairing": return "warranty.stageRepairing"
        case "returning": return "warranty.stageReturning"
        case "done": return "warranty.stageDone"
        case "declined": return "warranty.stageDeclined"
        case "withdrawn": return "warranty.stageWithdrawn"
        default: return "warranty.stageWaiting"
        }
    }

    static func remedyKey(_ remedy: String) -> String {
        switch remedy {
        case "replace": return "warranty.remedyReplace"
        case "refund": return "warranty.remedyRefund"
        default: return "warranty.remedyRepair"
        }
    }
}

/// A claim as the warranty desk reads it (`warranty.list`): the item, what
/// the shopper said and showed, the store's own warranty words, and the
/// buttons `warrantyActions` allows. The shopper is a first name and nothing
/// else — a store needs to know who, never how to reach them.
struct WarrantyDeskClaim: Decodable, Identifiable, Hashable, Sendable {
    let id: Int
    let reference: String
    let productTitle: String
    let variantTitle: String?
    let quantity: Int
    let deliveredAt: Date?
    let vendorName: String?
    let status: String
    let problem: String
    let photos: [String]
    let remedy: String?
    let response: String?
    let shopper: String?
    let terms: String?
    let createdAt: Date
    let stage: String
    /// accept, decline, complete.
    let actions: [String]
}

/// What a change before pickup would do (`orders.changeQuote`): the lines,
/// what the driver collects before and after, a store's fee a smaller order
/// no longer clears, a code that no longer applies, stored value that goes back.
struct ChangeQuote: Decodable, Hashable, Sendable {
    struct Line: Decodable, Hashable, Sendable {
        let lineId: Int
        let from: Int
        let to: Int
    }

    struct AddedFee: Decodable, Hashable, Sendable {
        let vendorName: String
        let destinationLabel: String?
        let fee: Money
        let waived: Bool
    }

    let lines: [Line]
    let owedBefore: Money
    let owedAfter: Money
    let addedFees: [AddedFee]
    let discountBefore: Money
    let discountAfter: Money
    let codeLost: Bool
    let giftCardBack: Money
    let pointsBack: Money

    /// The points that go back, as points: one a fil (`FILS_PER_POINT`).
    var pointsBackCount: Int { pointsBack.fils / max(1, ReferenceData.shared.rules.orderRules.filsPerPoint) }
}

/// What the order's address moved to, and what the driver now collects.
struct AddressMoved: Decodable, Hashable, Sendable {
    let addressLine: String
    let owed: Money
}

/// Buy again: everything still for sale back in the bag at today's price,
/// naming what could not be.
struct BuyAgainAnswer: Decodable, Hashable, Sendable {
    struct Skipped: Decodable, Hashable, Sendable {
        let title: String
        let reason: String
    }

    let cartId: String?
    let added: Int
    let skipped: [Skipped]
}

/// NetLet AI's answer about one order (`support.orderHelp`): words and the
/// buttons it points at, a hand-off to a person, or why there is no answer.
struct OrderHelpAnswer: Decodable, Hashable, Sendable {
    /// answer, unavailable, tooMany or refused.
    let kind: String
    var text: String? = nil
    var actions: [String]? = nil
    /// Acts NetLet AI proposes, each done only on Confirm (`orderHelpPieces`).
    var offers: [HelpOffer]? = nil
    var person: Bool? = nil
    var reason: String? = nil
}

/// One act the help centre offers (`HelpOffer` in `Shared/commerce/selfService.ts`):
/// a return, cancelling the order or an item, buying again — each done on
/// Confirm — or a panel to open (`open`) or an account page (`page`).
struct HelpOffer: Decodable, Hashable, Sendable {
    /// return, cancelOrder, cancelItem, buyAgain, open or page.
    let kind: String
    var lineId: Int? = nil
    var returnKinds: [String]? = nil
    var reasons: [String]? = nil
    /// track, refund, returnForm, warranty, address, modify or rate.
    var panel: String? = nil
    /// profile, notifications, addresses or returns (an older answer may say
    /// security, which is "Your profile" now).
    var to: String? = nil

    /// An act the shopper confirms here, rather than a way somewhere else.
    var isAct: Bool { kind != "open" && kind != "page" }
}

/// The help centre's answer to an issue about an order (`support.selfHelp`):
/// what is true now, the acts that would settle it, whether a person is the
/// next step, and the order's items to choose from.
struct SelfHelpAnswer: Decodable, Sendable {
    struct Item: Decodable, Hashable, Identifiable, Sendable {
        let id: Int
        let title: String
        var variant: String? = nil
        var photo: String? = nil
        let fulfilment: String
        var variantId: Int? = nil
        let quantity: Int
    }

    let say: [SupportThread.Part]
    let offers: [HelpOffer]
    /// "next" or "offer".
    let person: String
    let items: [Item]

    /// Asking which item before answering.
    var picksItem: Bool { say.first?.key == "help.pickItem" && !items.isEmpty }
}

/// The shop's own returns policy, read live (`commerce.policy`) — the
/// administrator sets the window without a deploy.
struct ReturnPolicy: Decodable, Hashable, Sendable {
    let returnWindowDays: Int
}

extension OrderDetail {
    /// The lines whose quantity can still be lowered or taken out.
    var changeableLines: [OrderLine] { lines.filter { $0.changeable == true } }
    /// Whether "Modify order" has anything to offer.
    var mayModify: Bool { change.changeable && !changeableLines.isEmpty }
    /// The items a warranty claim may be filed on now.
    var warrantyClaimable: [OrderLine] { lines.filter { $0.warrantyEligibility?.allowed == true } }
    /// Whether anything on the order can be bought again.
    var mayBuyAgain: Bool { lines.contains { $0.variantId != nil } }
}
