import Foundation

/// The seller's daily desk — orders, stock, price requests, messages, returns,
/// the team and payouts — each the procedure the web's portal page calls.
/// Every refusal is the server's: a hidden button is a courtesy, never a control.
extension API {
    // MARK: Orders

    struct OrderPage: Encodable, Sendable {
        var page: Int?
        var vendorId: Int?
    }

    struct OrderIds: Encodable, Sendable {
        let ids: [Int]
    }

    struct OrderId: Encodable, Sendable {
        let orderId: Int
    }

    struct LineMove: Encodable, Sendable {
        let lineId: Int
        let fulfilment: String
    }

    struct TransitClaim: Encodable, Sendable {
        let orderId: Int
        let lineIds: [Int]
        let amount: String
        let description: String
        let evidenceUrl: String?
    }

    static let deskOrders = Procedure<OrderPage, PortalPageOf<DeskOrder>>(query: "orders.forSeller")
    static let orderRisk = Procedure<OrderIds, [OrderRisk]>(query: "orders.risk")
    static let deskOrder = Procedure<OrderId, DeskOrderDetail?>(query: "orders.forSellerDetail")
    static let moveLine = Procedure<LineMove, Acknowledged>(mutation: "orders.setFulfilment")
    static let recordCash = Procedure<OrderId, CashRecorded>(mutation: "orders.markCollected")
    static let fileTransitClaim = Procedure<TransitClaim, Acknowledged>(mutation: "dispatch.claims.file")

    // MARK: Stock

    static let lowStock = Procedure<OrderPage, PortalPageOf<LowStockRow>>(query: "inventory.lowStock")
    static let stockHistory = Procedure<Limit, [StockMove]>(query: "inventory.stockHistory")

    // MARK: Price requests

    struct AskInbox: Encodable, Sendable {
        let page: Int
        let open: Bool
    }

    struct AskAnswer: Encodable, Sendable {
        let offerId: Int
        let offeredPrice: String
        let note: String?
        let vendorId: Int?
    }

    struct AskDecline: Encodable, Sendable {
        let offerId: Int
        let note: String?
        let vendorId: Int?
    }

    struct StoreAccepts: Encodable, Sendable {
        let vendorId: Int
        let accepts: Bool
    }

    static let askInbox = Procedure<AskInbox, PortalPageOf<PriceAsk>>(query: "offers.inbox")
    static let storeTakesAsks = Procedure<VendorScope, Bool>(query: "offers.storeOpen")
    static let answerAsk = Procedure<AskAnswer, Acknowledged>(mutation: "offers.answer")
    static let declineAsk = Procedure<AskDecline, Acknowledged>(mutation: "offers.decline")
    static let setStoreTakesAsks = Procedure<StoreAccepts, Acknowledged>(mutation: "offers.setStoreOpen")

    // MARK: Messages

    struct StoreReply: Encodable, Sendable {
        let conversationId: Int
        let body: String
    }

    static let storeConversations = Procedure<NoInput, [StoreConversation]>(query: "chat.seller.list")
    static let storeThread = Procedure<ConversationId, StoreThread>(query: "chat.seller.thread")
    static let replyAsStore = Procedure<StoreReply, Acknowledged>(mutation: "chat.seller.reply")

    // MARK: Returns

    struct ReturnFilter: Encodable, Sendable {
        let open: Bool
    }

    struct ReturnDecision: Encodable, Sendable {
        let requestId: Int
        let approve: Bool
        var reason: String?
    }

    struct ReturnReceipt: Encodable, Sendable {
        let requestId: Int
        let restock: Bool
    }

    static let deskReturns = Procedure<ReturnFilter, [ReturnCase]>(query: "returns.list")
    static let decideReturn = Procedure<ReturnDecision, Acknowledged>(mutation: "returns.decide")
    static let collectReturn = Procedure<ReturnId, Acknowledged>(mutation: "returns.collect")
    static let receiveReturn = Procedure<ReturnReceipt, ReturnReceived>(mutation: "returns.receive")
    static let refundPaid = Procedure<ReturnId, Acknowledged>(mutation: "returns.refundPaid")

    // MARK: Team

    struct StoreId: Encodable, Sendable {
        let vendorId: Int
    }

    struct MemberRole: Encodable, Sendable {
        let vendorId: Int
        let userId: Int
        let role: String
    }

    struct MemberRef: Encodable, Sendable {
        let vendorId: Int
        let userId: Int
    }

    static let storeMembers = Procedure<StoreId, [StoreMember]>(query: "inventory.vendors.members")
    static let setMemberRole = Procedure<MemberRole, Acknowledged>(mutation: "inventory.vendors.setMemberRole")
    static let removeMember = Procedure<MemberRef, Acknowledged>(mutation: "inventory.vendors.removeMember")

    // MARK: Payouts

    struct PageOnly: Encodable, Sendable {
        var page: Int?
    }

    struct RunId: Encodable, Sendable {
        let runId: Int
    }

    struct RunSent: Encodable, Sendable {
        var runId: Int?
        var fileId: Int?
        let bankReference: String
    }

    struct FileFormat: Encodable, Sendable {
        let fileId: Int
        let format: String
    }

    static let payoutBatches = Procedure<NoInput, [PayoutBatch]>(query: "finance.payoutBatches")
    static let preparedPayouts = Procedure<PageOnly, PreparedRuns>(query: "finance.preparedPayouts")
    static let payoutFiles = Procedure<PageOnly, BankFiles>(query: "finance.payoutFiles")
    static let payoutHistory = Procedure<PageOnly, PortalPageOf<PayoutRun>>(query: "finance.payoutHistory")
    static let payoutsDue = Procedure<PageOnly, [PayoutDue]>(query: "finance.payoutsDue")
    static let prepareAllPayouts = Procedure<NoInput, PreparedAll>(mutation: "finance.prepareAllPayouts")
    static let preparePayout = Procedure<StoreId, PreparedOne>(mutation: "finance.preparePayout")
    static let makePayoutFile = Procedure<NoInput, MadeFile>(mutation: "finance.makePayoutFile")
    static let cancelPayout = Procedure<RunId, Acknowledged>(mutation: "finance.cancelPayout")
    static let markPayoutSent = Procedure<RunSent, MarkedSent>(mutation: "finance.markPayoutSent")
    static let downloadPayoutFile = Procedure<FileFormat, PayoutFileContent>(mutation: "finance.downloadPayoutFile")
}
