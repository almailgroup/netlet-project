import Foundation
import Observation

/// The account's own details: display name, sign-in email and password, each
/// its own small form with its own Save — one Save across all three would
/// change a password somebody opened the screen to fix a spelling in.
@Observable
@MainActor
final class ProfileViewModel {
    enum Form: Hashable {
        case name, email, password
    }

    var name = ""
    var newEmail = ""
    var emailPassword = ""
    var currentPassword = ""
    var newPassword = ""

    private(set) var saving: Form?
    private(set) var problems: [Form: String] = [:]
    /// The last form saved, for its confirmation line.
    private(set) var saved: Form?

    private let account: AccountServicing

    init(account: AccountServicing, user: User?) {
        self.account = account
        name = user?.name ?? ""
        newEmail = user?.email ?? ""
    }

    func saveName() async -> User? {
        await run(.name) { try await self.account.updateName(self.name.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }

    /// Email and password both ask again for the current password: an open
    /// session on a shared phone should not be enough to take the account over.
    func saveEmail() async -> User? {
        if let problem = Validation.emailProblem(newEmail) {
            problems[.email] = problem
            return nil
        }
        if emailPassword.isEmpty {
            problems[.email] = "auth.passwordRequired"
            return nil
        }
        let user = await run(.email) {
            try await self.account.changeEmail(self.newEmail.trimmingCharacters(in: .whitespacesAndNewlines), currentPassword: self.emailPassword)
        }
        if user != nil { emailPassword = "" }
        return user
    }

    func savePassword() async -> Bool {
        if currentPassword.isEmpty {
            problems[.password] = "auth.passwordRequired"
            return false
        }
        if let problem = Validation.newPasswordProblem(newPassword) {
            problems[.password] = problem
            return false
        }
        let done: Bool? = await run(.password) {
            try await self.account.changePassword(current: self.currentPassword, new: self.newPassword)
            return true
        }
        if done == true {
            currentPassword = ""
            newPassword = ""
        }
        return done == true
    }

    private func run<Value>(_ form: Form, _ work: @escaping () async throws -> Value) async -> Value? {
        problems[form] = nil
        saved = nil
        saving = form
        defer { saving = nil }
        do {
            let value = try await work()
            saved = form
            return value
        } catch {
            problems[form] = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            return nil
        }
    }
}

/// The shopper's orders, a page at a time, newest first.
@Observable
@MainActor
final class OrdersViewModel {
    private(set) var orders: LoadState<[OrderSummary]> = .idle
    private(set) var total = 0
    private(set) var loadingMore = false
    private var page = 1

    private let service: OrderServicing

    init(service: OrderServicing) {
        self.service = service
    }

    var canLoadMore: Bool { (orders.value?.count ?? 0) < total }

    func load() async {
        if orders.value == nil { orders = .loading }
        do {
            let first = try await service.orders(page: 1)
            page = 1
            total = first.total
            orders = .loaded(first.rows)
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, orders.value == nil { orders = .failed(failure) }
        }
    }

    func loadMore() async {
        guard canLoadMore, !loadingMore, let shown = orders.value else { return }
        loadingMore = true
        defer { loadingMore = false }
        if let next = try? await service.orders(page: page + 1) {
            page += 1
            total = next.total
            let known = Set(shown.map(\.id))
            orders = .loaded(shown + next.rows.filter { !known.contains($0.id) })
        }
    }
}

/// One order, opened.
@Observable
@MainActor
final class OrderDetailViewModel {
    let reference: String
    private(set) var detail: LoadState<OrderDetail> = .idle
    private let service: OrderServicing

    init(reference: String, service: OrderServicing) {
        self.reference = reference
        self.service = service
    }

    func load() async {
        if detail.value == nil { detail = .loading }
        do {
            detail = .loaded(try await service.order(reference: reference))
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { detail = .failed(failure) }
        }
    }
}

/// Where an order is, in the shop's words — the web's `AccountOrders` mapping.
@MainActor
enum OrderWording {
    static func progress(_ progress: OrderProgress, language: LanguageSettings) -> String {
        switch progress.kind {
        case "cancelled": return language.t("orders.progressCancelled")
        case "returned": return language.t("orders.progressReturned")
        case "delivered":
            if let at = progress.at, let date = ISO8601.withFraction.date(from: at) ?? ISO8601.plain.date(from: at) {
                return language.t("orders.progressDeliveredOn", ["date": OrderWording.date(date, language: language.current)])
            }
            return language.t("orders.progressDelivered")
        case "partlyDelivered":
            return language.t("orders.progressPartly", ["delivered": "\(progress.delivered ?? 0)", "of": "\(progress.of ?? 0)"])
        case "onTheWay": return language.t("orders.progressOnTheWay")
        case "preparing": return language.t("orders.progressPreparing")
        default:
            return progress.preordered == true ? language.t("orders.progressPreordered") : language.t("orders.progressReceived")
        }
    }

    /// How it is paid: cash on the door until a driver has collected it.
    static func payment(status: String, language: LanguageSettings) -> String {
        switch status {
        case "paid": return language.t("orders.statusPaid")
        case "refunded": return language.t("orders.statusRefunded")
        case "cancelled": return language.t("orders.statusCancelled")
        default: return language.t("orders.payOnDelivery")
        }
    }

    static func line(_ fulfilment: String, language: LanguageSettings) -> String {
        switch fulfilment {
        case "preparing": return language.t("orders.linePreparing")
        case "shipped": return language.t("orders.lineShipped")
        case "delivered": return language.t("orders.lineDelivered")
        case "cancelled": return language.t("orders.lineCancelled")
        case "returned": return language.t("orders.lineReturned")
        default: return language.t("orders.linePending")
        }
    }

    /// Every date in Kuwait's time, whoever is reading — the web's `SHOP_TIME_ZONE`.
    static func date(_ date: Date, language: Language) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

/// A store's own listings.
@Observable
@MainActor
final class SellerListingsViewModel {
    private(set) var listings: LoadState<[SellerProduct]> = .idle
    private(set) var total = 0
    private let service: SellerServicing

    init(service: SellerServicing) {
        self.service = service
    }

    func load(vendorId: Int?) async {
        if listings.value == nil { listings = .loading }
        do {
            let page = try await service.listings(vendorId: vendorId, page: 1)
            total = page.total
            listings = .loaded(page.rows)
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { listings = .failed(failure) }
        }
    }
}
