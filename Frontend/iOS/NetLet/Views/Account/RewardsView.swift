import SwiftUI

/// Referral points — the web's `AccountRewards`: the code to share, how many
/// it brought, the balance and what it is worth, cashing out, and the ledger.
struct RewardsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.rewards) } }) { rewards in
            ShopPage(header: false, refresh: { await rewards.load() }) {
                AccountSection(title: l.t("account.sectionRewards"), hint: l.t("account.hint.rewards")) {
                    LoadStateView(state: rewards.state, retry: { await rewards.load() }) { view in
                        content(view, reload: { await rewards.load() })
                    }
                }
            }
            .task { await rewards.load() }
        }
    }

    private func content(_ view: Rewards, reload: @escaping () async -> Void) -> some View {
        let link = app.services.configuration.url(path: "/?ref=\(view.code)")
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                Label(l.t("rewards.title"), systemImage: "gift").font(.inter(16, .heavy)).foregroundStyle(Brand.navy)
                Text(l.t("rewards.codeHelp")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                Text(l.t("rewards.codeLabel")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                HStack {
                    Text("\u{2066}\(view.code)\u{2069}").font(.system(size: 22, weight: .heavy, design: .monospaced)).foregroundStyle(Brand.navy).textSelection(.enabled)
                    Spacer()
                    ShareLink(item: link) {
                        Label(l.t("affiliate.copyLink"), systemImage: "square.and.arrow.up")
                            .font(.inter(13, .bold))
                            .foregroundStyle(Brand.navy)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 40)
                            .background(Capsule().fill(Brand.tint))
                    }
                }
                Text("\(l.t("rewards.invited", ["count": "\(view.invited)"])) · \(l.t("rewards.qualified", ["count": "\(view.qualified)"]))")
                    .font(.inter(13))
                    .foregroundStyle(Brand.ink)
                Text(l.t("rewards.privacy")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                /* The two commissions beside the welcome (3.1.14): a product
                   shared from its page, and every order a friend places. */
                Text(l.t("rewards.commissionHelp")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()

            VStack(alignment: .leading, spacing: 10) {
                Text(l.t("rewards.balance", ["points": "\(view.balance)"])).font(.inter(20, .heavy)).foregroundStyle(Brand.navy)
                Text("\(l.t("rewards.worthInShop", ["value": view.spendValue.formatted(l.current)])) · \(l.t("rewards.worthInCash", ["value": view.cashOutValue.formatted(l.current)]))")
                    .font(.inter(13))
                    .foregroundStyle(Brand.ink)
                /* Earned and not yet spendable: a sale that may still come back. */
                if let held = view.held, held > 0 {
                    Text([l.t("rewards.held", ["points": "\(held)"]), view.nextRelease.map { l.t("rewards.nextRelease", ["date": OrderWording.date($0, language: l.current)]) }].compactMap { $0 }.joined(separator: " "))
                        .font(.inter(13, .semibold))
                        .foregroundStyle(Brand.navy)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(l.t("rewards.rateNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                if view.cashOut.ok {
                    Button(l.t("rewards.cashOut", ["points": "\(view.balance)", "value": view.cashOutValue.formatted(l.current)])) {
                        Task {
                            if await app.attempt(done: "rewards.cashOutRequested", { _ = try await app.services.api.call(API.cashOutRewards) }) { await reload() }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else {
                    Text(l.t("rewards.cashOutFloor", ["minimum": "\(view.minimumCashOut)", "short": "\(view.cashOut.shortBy ?? 0)"]))
                        .font(.inter(13))
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()

            VStack(alignment: .leading, spacing: 10) {
                Text(l.t("rewards.ledger")).font(.inter(16, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                if view.entries.isEmpty {
                    Text(l.t("rewards.empty")).font(.inter(13)).foregroundStyle(Brand.muted)
                } else {
                    ForEach(view.entries) { entry in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(l.t(RewardsView.reason(entry.reason))).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                                Text(ledgerLine(entry)).font(.inter(12)).foregroundStyle(Brand.muted)
                            }
                            Spacer()
                            Text("\u{2066}\(entry.points > 0 ? "+" : "")\(entry.points)\u{2069}")
                                .font(.inter(15, .heavy))
                                .foregroundStyle(entry.points > 0 ? Brand.success : Brand.ink)
                        }
                        if entry.id != view.entries.last?.id { Divider() }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }

    private func ledgerLine(_ entry: Rewards.Entry) -> String {
        var parts = [OrderWording.date(entry.createdAt, language: l.current)]
        if let reference = entry.orderReference { parts.append(l.t("rewards.onOrder", ["reference": "\u{2066}\(reference)\u{2069}"])) }
        if entry.reason == "cashed_out" {
            parts.append(entry.settledAt.map { l.t("rewards.paidOn", ["date": OrderWording.date($0, language: l.current)]) } ?? l.t("rewards.awaitingPayment"))
        }
        if let available = entry.availableAt { parts.append(l.t("rewards.availableFrom", ["date": OrderWording.date(available, language: l.current)])) }
        return parts.joined(separator: " · ")
    }

    static func reason(_ reason: String) -> String {
        switch reason {
        case "referrer_bonus": return "rewards.reasonReferrerBonus"
        case "referred_welcome": return "rewards.reasonReferredWelcome"
        case "spent_on_order": return "rewards.reasonSpentOnOrder"
        case "cashed_out": return "rewards.reasonCashedOut"
        case "order_cancelled": return "rewards.reasonOrderCancelled"
        case "product_referral": return "rewards.reasonProductReferral"
        case "invite_commission": return "rewards.reasonInviteCommission"
        case "product_referral_reversal": return "rewards.reasonProductReferralReversal"
        case "invite_commission_reversal": return "rewards.reasonInviteCommissionReversal"
        default: return "rewards.reasonAdminAdjustment"
        }
    }
}

/// The affiliate programme — the web's `AccountAffiliate`: joining, with the
/// disclosure a paid link owes its audience, and once joined the link, what
/// it earned and a payout once the balance reaches the floor.
struct AffiliateView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.affiliate) } }) { mine in
            ShopPage(header: false, refresh: { await mine.load() }) {
                AccountSection(title: l.t("affiliate.section"), hint: l.t("account.hint.affiliate")) {
                    LoadStateView(state: mine.state, retry: { await mine.load() }) { view in
                        if let view {
                            dashboard(view, reload: { await mine.load() })
                        } else if app.features.isOn("affiliates") {
                            JoinAffiliates { await mine.load() }
                        } else {
                            Text(l.t("affiliate.switchedOff")).font(.inter(14)).foregroundStyle(Brand.muted)
                        }
                    }
                }
            }
            .task { await mine.load() }
        }
    }

    private func dashboard(_ view: AffiliateDashboard, reload: @escaping () async -> Void) -> some View {
        let days = "\(ReferenceData.shared.rules.accountRules.attributionDays)"
        let minimum = Money(fils: ReferenceData.shared.rules.accountRules.minAffiliatePayoutFils)
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label(l.t("affiliate.title"), systemImage: "megaphone").font(.inter(16, .heavy)).foregroundStyle(Brand.navy)
                    Spacer()
                    Text(l.t(view.status == "active" ? "affiliate.statusActive" : view.status == "suspended" ? "affiliate.statusSuspended" : "affiliate.statusPending"))
                        .font(.inter(12, .bold))
                        .foregroundStyle(view.status == "active" ? Brand.success : Brand.navy)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(view.status == "active" ? Brand.successFill : Brand.tint))
                }
                if view.status == "pending" { note(l.t("affiliate.pendingNote")) }
                if view.status == "suspended" { note(l.t("affiliate.suspendedNote")) }
                if view.status == "active" {
                    note(l.t("affiliate.howToShare", ["days": days]))
                    HStack {
                        Text("\u{2066}\(view.code)\u{2069}").font(.system(size: 20, weight: .heavy, design: .monospaced)).foregroundStyle(Brand.navy).textSelection(.enabled)
                        Spacer()
                        ShareLink(item: app.services.configuration.url(path: "/?aff=\(view.code)")) {
                            Label(l.t("affiliate.copyLink"), systemImage: "square.and.arrow.up")
                                .font(.inter(13, .bold))
                                .foregroundStyle(Brand.navy)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 40)
                                .background(Capsule().fill(Brand.tint))
                        }
                    }
                    Text("\(l.t("affiliate.anyPage")) \u{2066}?aff=\(view.code)\u{2069}").font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()

            if view.status == "active" { OfferedProducts(code: view.code) }

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                stat("affiliate.paidOrders", "\(view.paidOrders)")
                stat("affiliate.waitingOrders", "\(view.waitingOrders)")
                stat("affiliate.earned", view.earned.formatted(l.current))
                stat("affiliate.balance", view.balance.formatted(l.current))
            }
            if view.reversed.fils > 0 { note(l.t("affiliate.reversedNote", ["amount": view.reversed.formatted(l.current)])) }

            VStack(alignment: .leading, spacing: 8) {
                Button(l.t("affiliate.requestPayout")) {
                    Task {
                        var amount: Money?
                        if await app.attempt({ amount = try await app.services.api.call(API.requestAffiliatePayout).amount }) {
                            if let amount { app.toast(l.t("affiliate.payoutRequested", ["amount": amount.formatted(l.current)])) }
                            await reload()
                        }
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!view.payout.ok)
                note(view.payout.ok
                    ? l.t("affiliate.payoutNote")
                    : l.t("affiliate.payoutShort", ["minimum": minimum.formatted(l.current), "short": (view.payout.shortBy ?? .zero).formatted(l.current)]))
            }
            .card()

            if !view.entries.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(view.entries) { entry in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(l.t(entry.reason == "affiliate_reversal" ? "affiliate.reasonReversal" : entry.reason == "cashed_out" ? "affiliate.reasonPayout" : "affiliate.reasonCommission"))
                                    .font(.inter(14, .semibold))
                                    .foregroundStyle(Brand.ink)
                                Text(entryLine(entry))
                                    .font(.inter(12))
                                    .foregroundStyle(Brand.muted)
                            }
                            Spacer()
                            Text("\u{2066}\(entry.amount.formatted(l.current))\u{2069}").font(.inter(14, .bold)).foregroundStyle(Brand.ink)
                        }
                        if entry.id != view.entries.last?.id { Divider() }
                    }
                }
                .card()
            }
        }
    }

    private func entryLine(_ entry: AffiliateDashboard.Entry) -> String {
        var parts: [String] = []
        if let reference = entry.orderReference { parts.append("\u{2066}\(reference)\u{2069}") }
        if entry.reason == "cashed_out" { parts.append(l.t(entry.settledAt == nil ? "affiliate.notYetPaid" : "affiliate.paid")) }
        parts.append(OrderWording.date(entry.createdAt, language: l.current))
        return parts.joined(separator: " · ")
    }

    private func note(_ text: String) -> some View {
        Text(text).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(l.t(label)).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            Text(value).font(.inter(18, .heavy)).foregroundStyle(Brand.navy).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
    }
}

/// What stores have offered to affiliates (3.7.1), each at its own rate, with
/// a link to it carrying this affiliate's code — the web's `OfferedProducts`.
/// Highest rate first, a page at a time.
private struct OfferedProducts: View {
    let code: String
    @State private var page = 1
    @State private var result: AffiliateProductPage?
    @State private var failed = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("affiliate.productsTitle")).font(.inter(16, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            if let result {
                if result.rows.isEmpty {
                    Text(l.t("affiliate.productsEmpty")).font(.inter(13)).foregroundStyle(Brand.muted)
                } else {
                    ForEach(result.rows) { row in
                        HStack(spacing: 10) {
                            RemoteImage(reference: row.image)
                                .frame(width: 48, height: 48)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(l.current == .ar ? (row.titleAr ?? row.title) : row.title).font(.inter(14, .bold)).foregroundStyle(Brand.navy).lineLimit(2)
                                (Text("\(row.vendorName) · \(row.price.formatted(l.current)) · ").foregroundColor(Brand.muted)
                                    + Text(l.t("affiliate.productRate", ["rate": row.percent])).foregroundColor(Brand.success).bold())
                                    .font(.inter(12))
                            }
                            Spacer(minLength: 6)
                            ShareLink(item: app.services.configuration.url(path: "/products/\(row.handle.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? row.handle)?aff=\(code)")) {
                                Label(l.t("affiliate.copyProductLink"), systemImage: "square.and.arrow.up")
                                    .labelStyle(.iconOnly)
                                    .font(.inter(15, .bold))
                                    .foregroundStyle(Brand.navy)
                                    .frame(width: 44, height: 44)
                                    .background(Circle().fill(Brand.tint))
                            }
                            .accessibilityLabel("\(l.t("affiliate.copyProductLink")): \(row.title)")
                        }
                        if row.id != result.rows.last?.id { Divider() }
                    }
                    if result.total > result.pageSize {
                        PortalPager(page: result.page, pageSize: result.pageSize, total: result.total) { next in
                            page = next
                            Task { await load() }
                        }
                    }
                }
            } else if failed {
                Text(l.t("admin.loadFailed")).font(.inter(13)).foregroundStyle(Brand.muted)
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .task { await load() }
    }

    private func load() async {
        do {
            result = try await app.services.api.call(API.affiliateProducts, API.PageOnly(page: page))
            failed = false
        } catch {
            failed = true
        }
    }
}

private struct JoinAffiliates: View {
    let joined: () async -> Void
    @State private var name = ""
    @State private var channel = ""
    @State private var agreed = false
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(l.t("affiliate.title"), systemImage: "megaphone").font(.inter(16, .heavy)).foregroundStyle(Brand.navy)
            Text(l.t("affiliate.pitch", ["days": "\(ReferenceData.shared.rules.accountRules.attributionDays)"]))
                .font(.inter(13))
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
            LabeledField(label: l.t("affiliate.displayName"), text: $name)
            LabeledField(label: l.t("affiliate.channel"), text: $channel, keyboard: .URL, leftToRight: true)
            Toggle(isOn: $agreed) {
                Text(l.t("affiliate.disclosure")).font(.inter(13)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
            }
            .tint(Brand.navy)
            Button(l.t("affiliate.join")) {
                Task {
                    sending = true
                    defer { sending = false }
                    let trimmedChannel = channel.trimmingCharacters(in: .whitespacesAndNewlines)
                    let worked = await app.attempt(done: "affiliate.applied") {
                        _ = try await app.services.api.call(API.joinAffiliates, .init(
                            displayName: name.trimmingCharacters(in: .whitespacesAndNewlines),
                            channel: trimmedChannel.isEmpty ? nil : trimmedChannel,
                            acceptDisclosure: agreed
                        ))
                    }
                    if worked { await joined() }
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!agreed || name.trimmingCharacters(in: .whitespaces).isEmpty || sending)
        }
        .card()
    }
}

/// Subscribe & Save — the web's `AccountSubscriptions`: each standing order,
/// how often and where, when it runs next or why it is paused, and the price
/// it will never go above. A price that rose is accepted only as shown.
struct SubscriptionsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.standingOrders) } }) { mine in
            ShopPage(header: false, refresh: { await mine.load() }) {
                AccountSection(title: l.t("subscriptions.section"), hint: l.t("account.hint.subscriptions")) {
                    LoadStateView(state: mine.state, retry: { await mine.load() }) { rows in
                        if rows.isEmpty {
                            Text(l.t("subscriptions.none")).font(.inter(14)).foregroundStyle(Brand.muted).frame(maxWidth: .infinity, alignment: .leading).card()
                        } else {
                            VStack(spacing: 10) {
                                ForEach(rows) { row in StandingOrderCard(order: row) { await mine.load() } }
                            }
                        }
                    }
                }
            }
            .task { await mine.load() }
        }
    }
}

private struct StandingOrderCard: View {
    let order: StandingOrder
    let changed: () async -> Void
    @State private var stopping = false
    @State private var working = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let cancelled = order.status == "cancelled"
        let rose = order.pausedReason == "priceRose" && (order.priceNow.map { $0 > order.priceCeiling } ?? false)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                RemoteImage(reference: order.image, label: order.productTitle)
                    .frame(width: 56, height: 56)
                    .background(Brand.photo)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 4) {
                    if let handle = order.productHandle, !cancelled {
                        Button { app.push(.product(handle: handle)) } label: {
                            Text(title).font(.inter(15, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.tap)
                    } else {
                        Text(title).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                    }
                    Text(cadence).font(.inter(13)).foregroundStyle(Brand.body)
                    Text(status(cancelled: cancelled)).font(.inter(13, .semibold)).foregroundStyle(order.status == "paused" ? Brand.accentInk : Brand.ink)
                    if !cancelled {
                        Text(order.priceNow.map { l.t("subscriptions.prices", ["now": $0.formatted(l.current), "ceiling": order.priceCeiling.formatted(l.current)]) }
                             ?? l.t("subscriptions.ceilingOnly", ["ceiling": order.priceCeiling.formatted(l.current)]))
                            .font(.inter(12))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let last = order.lastRunOn {
                        if order.lastOutcome == "outOfStock" {
                            Text(l.t("subscriptions.lastOutOfStock", ["date": OrderWording.day(last, language: l.current)])).font(.inter(12)).foregroundStyle(Brand.accentInk)
                        } else if order.lastOutcome == "placed" {
                            Text(l.t("subscriptions.lastPlaced", ["date": OrderWording.day(last, language: l.current)])).font(.inter(12)).foregroundStyle(Brand.muted)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !cancelled {
                FlowLayout(spacing: 8) {
                    if rose, let now = order.priceNow {
                        action(l.t("subscriptions.acceptPrice", ["price": now.formatted(l.current)]), .acceptPrice(now.amount))
                    }
                    if order.status == "active" {
                        action(l.t("subscriptions.skip"), .skip)
                        action(l.t("subscriptions.pause"), .pause)
                    } else if !rose, order.priceNow != nil {
                        action(l.t("subscriptions.resume"), .resume)
                    }
                    Button(l.t("subscriptions.stop")) { stopping = true }
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.danger)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(Capsule().strokeBorder(Brand.line, lineWidth: 1))
                        .buttonStyle(.tap)
                        .disabled(working)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .confirmationDialog(l.t("subscriptions.stopTitle", ["product": order.productTitle]), isPresented: $stopping, titleVisibility: .visible) {
            Button(l.t("subscriptions.stop"), role: .destructive) { run(.cancel) }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("subscriptions.stopBody"))
        }
    }

    private var title: String {
        order.variantLabel.map { "\(order.productTitle) · \($0)" } ?? order.productTitle
    }

    private var cadence: String {
        let every = order.intervalWeeks == 1 ? l.t("subscribe.weekly") : l.t("subscribe.weeks", ["count": "\(order.intervalWeeks)"])
        let base = l.t("subscriptions.cadence", ["count": "\(order.quantity)", "every": every])
        return order.addressLabel.map { "\(base) · \($0)" } ?? base
    }

    private func status(cancelled: Bool) -> String {
        if cancelled { return l.t("subscriptions.stopped") }
        if order.status == "paused" {
            switch order.pausedReason {
            case "priceRose": return l.t("subscriptions.pausedPrice")
            case "noAddress": return l.t("subscriptions.pausedAddress")
            case "unavailable": return l.t("subscriptions.pausedUnavailable")
            case "refused": return l.t("subscriptions.pausedRefused")
            default: return l.t("subscriptions.pausedByYou")
            }
        }
        return l.t("subscriptions.next", ["date": order.nextRunOn.map { OrderWording.day($0, language: l.current) } ?? "—"])
    }

    private func action(_ title: String, _ change: API.StandingOrderChange.Action) -> some View {
        Button(title) { run(change) }
            .font(.inter(13, .bold))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .background(Capsule().fill(Brand.tint))
            .buttonStyle(.tap)
            .disabled(working)
    }

    private func run(_ change: API.StandingOrderChange.Action) {
        Task {
            working = true
            defer { working = false }
            if await app.attempt(done: "subscriptions.saved", { _ = try await app.services.api.call(API.changeStandingOrder, .init(id: order.id, action: change)) }) {
                await changed()
            }
        }
    }
}
