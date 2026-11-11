import Foundation
import Observation

/// The account's own details: display name, sign-in email and password, each
/// its own small form with its own Save — one Save across all three would
/// change a password somebody opened the screen to fix a spelling in.
@Observable
@MainActor
final class ProfileViewModel {
    enum Form: Hashable {
        case name, phone, gender, birthday, password
    }

    var firstName = ""
    var lastName = ""
    /// The phone as typed; `+965` is drawn before the box.
    var phone = ""
    /// The birthday being chosen, `yyyy-mm-dd`, or empty.
    var birthday = ""
    var currentPassword = ""
    var newPassword = ""
    /// The new password typed again, which must be the same.
    var newPasswordAgain = ""

    /// What the server holds, which the boxes are compared with.
    private(set) var details = ProfileDetails.none
    private(set) var loaded = false
    private(set) var savedFirst = ""
    private(set) var savedLast = ""

    private(set) var saving: Form?
    private(set) var problems: [Form: String] = [:]
    /// The last form saved, for its confirmation line.
    private(set) var saved: Form?

    private let account: AccountServicing

    init(account: AccountServicing, user: User?) {
        self.account = account
        let guess = ProfileDetails.split(user?.name)
        firstName = guess.first
        lastName = guess.last
        savedFirst = guess.first
        savedLast = guess.last
    }

    /// The details, once; an account with no name parts keeps the split of its
    /// display name as the starting guess, never saved for it.
    func load() async {
        guard !loaded, let answer = try? await account.profileDetails() else { return }
        loaded = true
        adopt(answer)
        if answer.firstName?.isEmpty == false || answer.lastName?.isEmpty == false {
            firstName = answer.firstName ?? ""
            lastName = answer.lastName ?? ""
            savedFirst = firstName
            savedLast = lastName
        }
    }

    var nameChanged: Bool {
        firstName.trimmingCharacters(in: .whitespacesAndNewlines) != savedFirst.trimmingCharacters(in: .whitespacesAndNewlines)
            || lastName.trimmingCharacters(in: .whitespacesAndNewlines) != savedLast.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var phoneChanged: Bool {
        phone.trimmingCharacters(in: .whitespacesAndNewlines) != storedPhone
    }

    var birthdayChanged: Bool { birthday != (details.birthday ?? "") }

    private var storedPhone: String { details.phone.map(PhoneNumber.display) ?? "" }

    func saveName() async -> User? {
        if let problem = Validation.nameProblem(first: firstName, last: lastName) {
            problems[.name] = problem
            return nil
        }
        let first = firstName.trimmingCharacters(in: .whitespacesAndNewlines)
        let last = lastName.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = await run(.name) { try await self.account.updateNameParts(first: first, last: last) }
        if user != nil {
            firstName = first
            lastName = last
            savedFirst = first
            savedLast = last
        }
        return user
    }

    func savePhone() async {
        if let problem = Validation.profilePhoneProblem(phone) {
            problems[.phone] = problem
            return
        }
        await save(.phone, API.DetailsPatch(phone: .text(phone)))
    }

    /// One press is the choice; pressing the chosen one again takes it away.
    func choose(gender: String) async {
        await save(.gender, API.DetailsPatch(gender: OrNull(details.gender == gender ? nil : gender)))
    }

    func saveBirthday() async {
        if !birthday.isEmpty, let problem = Validation.birthdayProblem(birthday, today: StoreRules.kuwaitDay(Date())) {
            problems[.birthday] = problem
            return
        }
        await save(.birthday, API.DetailsPatch(birthday: OrNull(birthday.isEmpty ? nil : birthday)))
    }

    func removeBirthday() async {
        birthday = ""
        await save(.birthday, API.DetailsPatch(birthday: OrNull(nil)))
    }

    private func save(_ form: Form, _ patch: API.DetailsPatch) async {
        if let answer = await run(form, { try await self.account.saveProfileDetails(patch) }) { adopt(answer) }
    }

    private func adopt(_ answer: ProfileDetails) {
        details = answer
        phone = storedPhone
        birthday = answer.birthday ?? ""
    }

    /// The password asks again for the current one: an open session on a
    /// shared phone should not be enough to take the account over.
    func savePassword() async -> Bool {
        if currentPassword.isEmpty {
            problems[.password] = "auth.passwordRequired"
            return false
        }
        if let problem = Validation.newPasswordProblem(newPassword) {
            problems[.password] = problem
            return false
        }
        if let problem = Validation.passwordAgainProblem(newPassword, again: newPasswordAgain) {
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
            newPasswordAgain = ""
        }
        return done == true
    }

    /// A row closed without saving: its boxes go back to what is saved, and its refusal with it.
    func cancel(_ form: Form) {
        problems[form] = nil
        switch form {
        case .name: firstName = savedFirst; lastName = savedLast
        case .phone: phone = storedPhone
        case .birthday: birthday = details.birthday ?? ""
        case .password: currentPassword = ""; newPassword = ""; newPasswordAgain = ""
        case .gender: break
        }
    }

    private func run<Value>(_ form: Form, _ work: @escaping @MainActor () async throws -> Value) async -> Value? {
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
    /// How many orders each view holds under the search and period (the chips).
    private(set) var counts: [String: Int]?
    private(set) var atCeiling = false
    /// The chip pressed: a view of the orders, or "returns" or "reviews".
    private(set) var tab: String
    /// The search and the period, sent with every page.
    private(set) var filters = OrderFilters()
    /// The Returns and Reviews tabs' lists, read once the page appears for
    /// their chips' numbers too.
    let returns: Loader<[ShopperReturn]>
    let reviews: Loader<[ReviewableLine]>
    private var page = 1
    /// Which answer is the latest: a filter changed mid-flight leaves the
    /// answer to the old one unread rather than drawn over the new.
    private var asked = 0

    private let service: OrderServicing

    init(
        service: OrderServicing,
        tab: String = "all",
        returns: @escaping @MainActor () async throws -> [ShopperReturn],
        reviews: @escaping @MainActor () async throws -> [ReviewableLine]
    ) {
        self.service = service
        self.tab = tab
        self.returns = Loader(returns)
        self.reviews = Loader(reviews)
    }

    var canLoadMore: Bool { (orders.value?.count ?? 0) < total }
    /// Whether the chip pressed is a view of the orders, which the search and the period narrow.
    var onOrders: Bool { !["returns", "reviews"].contains(tab) }
    /// Whether anything narrows the list, so an empty answer is "nothing matches" rather than "no orders".
    var narrowed: Bool { filters.view != "all" || !filters.q.isEmpty || filters.period != "all" }
    /// The Returns chip's number: every return asked for.
    var returnsCount: Int? { returns.value?.count }
    /// The Reviews chip's number: what can still be rated.
    var reviewsCount: Int? { reviews.value.map { $0.filter { $0.eligibility.allowed && $0.review == nil }.count } }

    /// The tab pressed, drawn at once — `choose(tab:)` then asks for its list.
    func pick(tab next: String) { tab = next }

    func choose(tab next: String) async {
        tab = next
        if onOrders, filters.view != next {
            filters.view = next
            await load()
        }
    }

    func search(_ q: String) async {
        let typed = q.trimmingCharacters(in: .whitespacesAndNewlines)
        guard typed != filters.q else { return }
        filters.q = typed
        await load()
    }

    func choose(period next: String) async {
        guard next != filters.period else { return }
        filters.period = next
        await load()
    }

    /// The search row closed: its words and its period go with it.
    func clearSearch() async {
        guard !filters.q.isEmpty || filters.period != "all" else { return }
        filters.q = ""
        filters.period = "all"
        await load()
    }

    func clearFilters() async {
        tab = "all"
        filters = OrderFilters()
        await load()
    }

    func load() async {
        if tab != "all", onOrders { filters.view = tab }
        asked += 1
        let mine = asked
        if orders.value == nil { orders = .loading }
        do {
            let first = try await service.orders(page: 1, filters: filters)
            guard mine == asked else { return }
            page = 1
            total = first.total
            counts = first.counts
            atCeiling = first.atCeiling ?? false
            orders = .loaded(first.rows)
        } catch {
            guard mine == asked else { return }
            let failure = APIError.from(error)
            if failure != .cancelled, orders.value == nil { orders = .failed(failure) }
        }
    }

    /// The orders, and the Returns and Reviews lists for their chips.
    func loadAll() async {
        async let lists: Void = loadLists()
        await load()
        await lists
    }

    func loadLists() async {
        async let returned: Void = returns.load()
        await reviews.load()
        await returned
    }

    func loadMore() async {
        guard canLoadMore, !loadingMore, let shown = orders.value else { return }
        loadingMore = true
        defer { loadingMore = false }
        let mine = asked
        guard let next = try? await service.orders(page: page + 1, filters: filters) else {
            // A page that cannot be read ends the list rather than spinning for ever.
            if mine == asked { total = shown.count }
            return
        }
        guard mine == asked else { return }
        page += 1
        let known = Set(shown.map(\.id))
        let fresh = next.rows.filter { !known.contains($0.id) }
        orders = .loaded(shown + fresh)
        // A page that adds nothing is the end, whatever the count said.
        total = fresh.isEmpty ? shown.count : next.total
    }
}

/// One order, opened.
@Observable
@MainActor
final class OrderDetailViewModel {
    let reference: String
    private(set) var detail: LoadState<OrderDetail> = .idle
    /// The server has no order by that reference for this account — a link
    /// from an email or a notice opened while signed in as somebody else. The
    /// web's `orders.detailMissing`, not a failure with Try again.
    private(set) var missing = false
    private let service: OrderServicing

    init(reference: String, service: OrderServicing) {
        self.reference = reference
        self.service = service
    }

    func load() async {
        if detail.value == nil { detail = .loading }
        do {
            guard let found = try await service.order(reference: reference) else {
                missing = true
                detail = .idle
                return
            }
            missing = false
            detail = .loaded(found)
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

    /// A day and a time, in Kuwait's time — the web's `useDateTimeFormat`.
    static func dateTime(_ date: Date, language: Language) -> String {
        isolated(KeptFormatters.date(date, key: "dateTime|\(language.rawValue)") {
            let formatter = DateFormatter()
            formatter.locale = language == .ar ? Locale(identifier: "ar_KW@numbers=latn") : Locale(identifier: "en_GB")
            formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
            formatter.dateStyle = .medium
            formatter.timeStyle = .short
            return formatter
        })
    }

    /// A day the server sends as `yyyy-mm-dd`, which is a Kuwaiti day already.
    static func day(_ text: String, language: Language) -> String {
        let parsed = KeptFormatters.date(from: String(text.prefix(10)), key: "day|read") {
            let reader = DateFormatter()
            reader.dateFormat = "yyyy-MM-dd"
            reader.locale = Locale(identifier: "en_US_POSIX")
            reader.timeZone = TimeZone(identifier: "Asia/Kuwait")
            return reader
        }
        guard let parsed else { return text }
        return date(parsed, language: language)
    }

    /// Every date in Kuwait's time, whoever is reading — the web's `SHOP_TIME_ZONE`.
    /// Written by formatters made once (`KeptFormatters`): a list of orders
    /// or notices writes one of these a row.
    static func date(_ date: Date, language: Language) -> String {
        isolated(KeptFormatters.date(date, key: "date|\(language.rawValue)") {
            let formatter = DateFormatter()
            formatter.locale = language.locale
            formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
            formatter.dateStyle = .medium
            formatter.timeStyle = .none
            return formatter
        })
    }

    /// A date set apart from the line it sits in (first-strong isolate). An
    /// Arabic date carries right-to-left marks between its parts, so inside a
    /// line that reads left to right — a Latin reference and a centre's name
    /// before it — its parts were reordered, and "11/10/2026" was drawn
    /// "112026/10/". Isolated, it lays out as one piece wherever it lands.
    static func isolated(_ text: String) -> String { "\u{2068}\(text)\u{2069}" }
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
