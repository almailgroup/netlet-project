import SwiftUI

/// The inbox — the web's `AccountNotifications`: what happened, newest first,
/// a page at a time. A page is marked read as it is opened, but the "New" tag
/// stays for this visit, so the shopper still sees what was new. A notice with
/// somewhere to go opens it in the app.
struct NotificationsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { NotificationsModel(api: app.services.api) }) { model in
            ShopPage(header: false, refresh: { await model.load() }, viewSource: "account") {
                AccountSection(title: l.t("notices.title"), hint: l.t("notices.tile")) {
                    VStack(alignment: .leading, spacing: 14) {
                        LoadStateView(state: model.page, retry: { await model.load() }) { page in
                            inbox(page, model: model)
                        }
                        if model.emailOffered {
                            if model.emailRead {
                                emailSwitch(model)
                            } else if model.emailUnread {
                                emailUnread(model)
                            }
                        }
                    }
                }
            }
            .task { await model.load() }
        }
    }

    @ViewBuilder
    private func inbox(_ page: NoticePage, model: NotificationsModel) -> some View {
        if page.total == 0 {
            EmptyStateView(systemImage: "bell", title: l.t("notices.empty")).card(padding: 0)
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(l.t("notices.title")).font(.inter(17, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                    Spacer()
                    if page.unread > 0 {
                        Button(l.t("notices.markAll")) {
                            Task {
                                // A refusal is said: it buzzed as a success and changed nothing.
                                if let failed = await model.markAll() { app.toast(l.t(failed)) }
                            }
                        }
                            .font(.inter(13, .bold))
                            .foregroundStyle(Brand.navy)
                            .frame(minHeight: 44)
                            .buttonStyle(.tap)
                    }
                }
                ForEach(page.entries) { entry in row(entry, isNew: !entry.read || model.fresh.contains(entry.id)) }
                if page.total > page.pageSize { pager(page, model: model) }
            }
        }
    }

    private func row(_ entry: Notice, isNew: Bool) -> some View {
        let sentence = l.phrasebook.has(entry.messageKey) ? l.t(entry.messageKey, entry.values(l.current)) : ""
        let face = HStack(alignment: .top, spacing: 12) {
            Image(systemName: NotificationsView.symbol(entry.kind))
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Brand.navy)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Brand.tint))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(sentence)
                    .font(.inter(14, isNew ? .semibold : .regular))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(OrderWording.dateTime(entry.createdAt, language: l.current))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if isNew {
                Text(l.t("notices.new"))
                    .font(.inter(11, .bold))
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Brand.orange))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(isNew ? Brand.tint.opacity(0.7) : Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        return Group {
            if let link = entry.link, let route = Route.from(link: link) {
                Button { app.open(route) } label: { face.contentShape(Rectangle()) }
                    .buttonStyle(PressFillStyle(cornerRadius: 14))
            } else {
                face
            }
        }
    }

    private func pager(_ page: NoticePage, model: NotificationsModel) -> some View {
        let pages = max(1, (page.total + page.pageSize - 1) / page.pageSize)
        let first = (page.page - 1) * page.pageSize + 1
        let last = min(page.total, page.page * page.pageSize)
        return HStack {
            Button(l.t("admin.previousPage")) { Task { await model.go(to: page.page - 1) } }
                .disabled(page.page <= 1)
            Spacer()
            Text(l.t("admin.showingRange", ["first": "\(first)", "last": "\(last)", "total": "\(page.total)"]))
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
            Spacer()
            Button(l.t("admin.nextPage")) { Task { await model.go(to: page.page + 1) } }
                .disabled(page.page >= pages)
        }
        .font(.inter(13, .bold))
        .foregroundStyle(Brand.navy)
        .frame(minHeight: 44)
    }

    private func emailSwitch(_ model: NotificationsModel) -> some View {
        Toggle(isOn: Binding(get: { model.email }, set: { on in Task { await app.attempt { try await model.setEmail(on) } } })) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t("notices.email")).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
                Text(l.t("notices.emailNote", ["email": "\u{2068}\(app.session.user?.email ?? "")\u{2069}"]))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Brand.navy)
        .card()
    }

    private func emailUnread(_ model: NotificationsModel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("notices.email")).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
            Text(l.t("account.sectionFailed"))
                .font(.inter(13))
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await model.readEmail() }
            } label: {
                Text(l.t("home.refreshCatalog"))
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .underline()
                    .frame(minHeight: 44)
            }
            .buttonStyle(.tap)
            .accessibilityIdentifier("notice-email-retry")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    /// The web's icon per kind, as the nearest SF Symbol.
    static func symbol(_ kind: String) -> String {
        switch kind {
        case "order_placed": return "shippingbox"
        case "order_on_the_way", "exchange_sent": return "truck.box"
        case "order_delivered": return "checkmark.circle"
        case "line_cancelled": return "xmark.circle"
        case "return_approved", "return_declined", "seller_return": return "arrow.uturn.backward"
        case "seller_warning": return "exclamationmark.triangle"
        case "seller_suspended": return "nosign"
        case "refund_done": return "wallet.pass"
        case "price_drop", "offer_answered": return "tag"
        case "support_answered": return "lifepreserver"
        case "bag_reminder": return "bag"
        case "new_arrival": return "sparkles"
        case "seller_new_order": return "storefront"
        default: return "bell"
        }
    }
}

@Observable
@MainActor
final class NotificationsModel {
    private(set) var page: LoadState<NoticePage> = .idle
    /// What was unread when this visit showed it: still tagged New after it is marked read.
    private(set) var fresh: Set<Int> = []
    private(set) var emailOffered = false
    private(set) var email = true
    /// The shopper's email setting has been read: until then the switch is
    /// not drawn, never drawn on over a setting that may be off.
    private(set) var emailRead = false
    /// It could not be read: said with Try again in the switch's place.
    private(set) var emailUnread = false
    private var number = 1
    private let api: APICalling

    init(api: APICalling) {
        self.api = api
    }

    func load() async {
        await go(to: number)
        guard let channels = try? await api.call(API.noticeChannels), channels.email else { return }
        emailOffered = true
        await readEmail()
    }

    /// The shopper's own email setting; a failure is said, never drawn as on.
    func readEmail() async {
        do {
            email = try await api.call(API.noticeEmail)
            emailRead = true
            emailUnread = false
        } catch {
            if APIError.from(error) != .cancelled, !emailRead { emailUnread = true }
        }
    }

    func go(to next: Int) async {
        if page.value == nil { page = .loading }
        do {
            let answer = try await api.call(API.notices, .init(page: max(1, next)))
            number = answer.page
            page = .loaded(answer)
            let unseen = answer.entries.filter { !$0.read && !fresh.contains($0.id) }.map(\.id)
            if !unseen.isEmpty {
                fresh.formUnion(unseen)
                _ = try? await api.call(API.markNoticesRead, .init(ids: unseen))
            }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, page.value == nil { page = .failed(failure) }
        }
    }

    /// Marks every notice read; answers the refusal's message key, or nil
    /// once it took — it played a success and said nothing when it failed.
    func markAll() async -> String? {
        do {
            _ = try await api.call(API.markNoticesRead, .init(all: true))
        } catch {
            let failure = APIError.from(error)
            guard failure != .cancelled else { return nil }
            Haptics.refused()
            return failure.messageKey(knownKey: Phrasebook.shared.has)
        }
        Haptics.succeeded()
        await go(to: number)
        return nil
    }

    func setEmail(_ allows: Bool) async throws {
        _ = try await api.call(API.setNoticeEmail, .init(allows: allows))
        email = allows
    }
}
