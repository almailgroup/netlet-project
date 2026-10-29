import SwiftUI

/// NetLet points — the web's `AccountRewards`: the balance with the coin and
/// converting it to money (`PointsWallet`), the two ways to earn — affiliate
/// marketing first, on the owner's word, then inviting a friend — and the
/// history behind the number.
struct RewardsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.rewards) } }) { rewards in
            ShopPage(header: false, footer: false, refresh: { await rewards.load() }) {
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
        VStack(alignment: .leading, spacing: 12) {
            PointsWallet(view: view, reload: reload)

            Text(l.t("rewards.waysToEarn"))
                .font(.inter(15, .bold))
                .foregroundStyle(Brand.navy)
                .padding(.top, 6)
                .accessibilityAddTraits(.isHeader)

            let joined = app.affiliateJoined == true
            if app.features.isOn("affiliates") || joined {
                Button { app.push(.affiliate) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "megaphone")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Brand.accentInk)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(Color(red: 1, green: 0.945, blue: 0.91)))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.t("affiliate.section")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                            Text(l.t(joined ? "rewards.earnAffiliateMember" : "rewards.earnAffiliate"))
                                .font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text(l.t(app.memberCode != nil ? "affiliate.statusActive" : joined ? "affiliate.statusSuspended" : "affiliate.promoJoin"))
                            .font(.inter(13, .bold))
                            .foregroundStyle(Brand.navy)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(Capsule().fill(Brand.tint))
                        Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Brand.ink)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                    .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
            }

            InviteCard(view: view)
            history(view)
        }
    }

    private func history(_ view: Rewards) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("rewards.ledger")).font(.inter(15, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            if view.entries.isEmpty {
                Text(l.t("rewards.empty")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(view.entries) { entry in
                    HStack(alignment: .top, spacing: 12) {
                        PointsCoin(size: 22).padding(.top, 1)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.t(RewardsView.reason(entry.reason))).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                            Text(ledgerLine(entry)).font(.inter(12)).foregroundStyle(Brand.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text("\u{2066}\(entry.points > 0 ? "+" : "−")\(PointsFormat.count(abs(entry.points), l.current))\u{2069}")
                            .font(.inter(15, .heavy))
                            .foregroundStyle(entry.points > 0 ? Brand.success : Brand.muted)
                    }
                    .accessibilityElement(children: .combine)
                    if entry.id != view.entries.last?.id { Divider() }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
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

/// The balance as a card — the web's `PointsWallet`, one card for the points
/// page and the affiliate page: the coin, the number, what it is worth spent
/// and converted ("1 point = 1 fils"), what is still held, and converting it,
/// which asks first because it is the one press here that moves money.
struct PointsWallet: View {
    let view: Rewards
    let reload: () async -> Void
    @State private var asking = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private static let soft = Color(red: 201 / 255, green: 211 / 255, blue: 227 / 255)
    private static let bright = Color(red: 227 / 255, green: 232 / 255, blue: 240 / 255)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                PointsCoin(size: 48)
                VStack(alignment: .leading, spacing: 0) {
                    Text(l.t("rewards.yourPoints")).font(.inter(13, .semibold)).foregroundStyle(Self.soft)
                    Text("\u{2066}\(PointsFormat.count(view.balance, l.current))\u{2069}")
                        .font(.inter(32, .heavy))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
            }
            .accessibilityElement(children: .combine)

            Text("\(l.t("rewards.worthInShop", ["value": view.spendValue.formatted(l.current)])) \(l.t("rewards.worthInCash", ["value": view.cashOutValue.formatted(l.current)]))")
                .font(.inter(14))
                .foregroundStyle(Self.bright)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 12)
            Text(l.t("rewards.pointValue", ["value": Money(fils: 1000).formatted(l.current)]))
                .font(.inter(13))
                .foregroundStyle(Self.soft)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)

            if let held = view.held, held > 0 {
                Text([l.t("rewards.held", ["points": PointsFormat.count(held, l.current)]), view.nextRelease.map { l.t("rewards.nextRelease", ["date": OrderWording.date($0, language: l.current)]) }].compactMap { $0 }.joined(separator: " "))
                    .font(.inter(13))
                    .foregroundStyle(Self.bright)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.1)))
                    .padding(.top, 12)
            }

            Rectangle().fill(Color.white.opacity(0.15)).frame(height: 1).padding(.vertical, 16)

            if view.cashOut.ok {
                Button { asking = true } label: {
                    Label(l.t("rewards.convert"), systemImage: "arrow.left.arrow.right")
                        .font(.inter(15, .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(Capsule().fill(Color.white))
                }
                .buttonStyle(.tap)
            } else {
                Text(l.t("rewards.cashOutFloor", ["minimum": PointsFormat.count(view.minimumCashOut, l.current), "short": PointsFormat.count(view.cashOut.shortBy ?? 0, l.current)]))
                    .font(.inter(13))
                    .foregroundStyle(Self.soft)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(l.t("rewards.rateNote"))
                .font(.inter(12))
                .foregroundStyle(Self.soft)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Brand.navy))
        .shadow(color: Brand.navy.opacity(0.35), radius: 14, y: 8)
        .confirmationDialog(l.t("rewards.convertTitle"), isPresented: $asking, titleVisibility: .visible) {
            Button(l.t("rewards.convert")) {
                Task {
                    if await app.attempt(done: "rewards.cashOutRequested", { _ = try await app.services.api.call(API.cashOutRewards) }) {
                        await reload()
                    }
                }
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("rewards.convertBody", ["points": PointsFormat.count(view.balance, l.current), "value": view.cashOutValue.formatted(l.current)]))
        }
    }
}

/// Inviting a friend: the code, the link, and how many arrived through it —
/// never who.
private struct InviteCard: View {
    let view: Rewards
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let link = app.services.configuration.url(path: "/?ref=\(view.code)")
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "person.badge.plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Brand.tint))
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t("rewards.title")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                    Text(l.t("rewards.codeHelp")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            Text(l.t("rewards.codeLabel")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted).padding(.top, 4)
            HStack {
                Text("\u{2066}\(view.code)\u{2069}")
                    .font(.system(size: 20, weight: .heavy, design: .monospaced))
                    .foregroundStyle(Brand.navy)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.pearl))
                Spacer()
                ShareLink(item: link) {
                    Label(l.t("rewards.copy"), systemImage: "square.and.arrow.up")
                        .font(.inter(13, .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(Capsule().fill(Brand.navy))
                }
            }
            Text("\(l.t("rewards.invited", ["count": "\(view.invited)"])) · \(l.t("rewards.qualified", ["count": "\(view.qualified)"]))")
                .font(.inter(13))
                .foregroundStyle(Brand.ink)
            Text(l.t("rewards.privacy")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

/// Affiliate marketing — the web's `AccountAffiliate`, on the owner's word:
/// join in one press, share products, earn NetLet points on what sells. A
/// non-member sees the join card; a member, how their links are doing, the
/// balance and converting it, the products whose stores pay extra and their
/// sales one by one.
struct AffiliateView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.affiliate) } }) { mine in
            ShopPage(header: false, footer: false, refresh: { await mine.load() }) {
                AccountSection(title: l.t("affiliate.section"), hint: l.t("account.hint.affiliate")) {
                    LoadStateView(state: mine.state, retry: { await mine.load() }) { view in
                        if let view {
                            MemberPage(view: view)
                        } else if app.features.isOn("affiliates") {
                            JoinAffiliates { await mine.load() }
                        } else {
                            Text(l.t("affiliate.switchedOff")).font(.inter(14)).foregroundStyle(Brand.muted).frame(maxWidth: .infinity, alignment: .leading).card()
                        }
                    }
                }
            }
            .task { await mine.load() }
        }
    }
}

private struct MemberPage: View {
    let view: AffiliateDashboard
    @State private var rewards: Rewards?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let active = view.status == "active"
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label(l.t("affiliate.section"), systemImage: "megaphone").font(.inter(17, .heavy)).foregroundStyle(Brand.navy)
                    Spacer()
                    Text(l.t(active ? "affiliate.statusActive" : "affiliate.statusSuspended"))
                        .font(.inter(12, .heavy))
                        .foregroundStyle(active ? Brand.success : Brand.danger)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(active ? Brand.successFill : Color(red: 0.992, green: 0.925, blue: 0.918)))
                }
                Text("\(l.t("affiliate.memberSince", ["date": OrderWording.date(view.joinedAt, language: l.current)])) · \(l.t("affiliate.shownAs", ["name": view.displayName]))")
                    .font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                if active {
                    Text(l.t("affiliate.howToShare", ["days": "\(ReferenceData.shared.rules.accountRules.productLinkDays)"]))
                        .font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 10) {
                        Text(l.t("affiliate.yourCode")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                        Text("\u{2066}\(view.code)\u{2069}")
                            .font(.system(size: 18, weight: .heavy, design: .monospaced))
                            .foregroundStyle(Brand.navy)
                            .textSelection(.enabled)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.pearl))
                        Spacer(minLength: 0)
                    }
                    Button { app.push(.department(slug: "all")) } label: {
                        Label(l.t("affiliate.findProducts"), systemImage: "square.and.arrow.up")
                            .font(.inter(14, .bold))
                            .foregroundStyle(Brand.navy)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(Capsule().fill(Brand.tint))
                    }
                    .buttonStyle(.tap)
                } else {
                    Text(l.t("affiliate.suspendedNote")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                stat("affiliate.paidOrders", PointsFormat.count(view.paidOrders, l.current), coin: false)
                stat("affiliate.waitingOrders", PointsFormat.count(view.waitingOrders, l.current), coin: false)
                stat("affiliate.pointsEarned", PointsFormat.count(view.earnedPoints - view.reversedPoints, l.current), coin: true)
                stat("affiliate.pointsHeld", PointsFormat.count(view.heldPoints, l.current), coin: true)
            }

            if let rewards {
                PointsWallet(view: rewards, reload: { await loadRewards() })
            }

            if active { ProductsPayingExtra(code: view.code) }

            VStack(alignment: .leading, spacing: 10) {
                Text(l.t("affiliate.salesTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                if view.sales.isEmpty {
                    Text(l.t("affiliate.salesEmpty")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(view.sales) { sale in
                        HStack(alignment: .top, spacing: 12) {
                            PointsCoin(size: 22).padding(.top, 1)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(sale.productTitle ?? l.t(sale.reversed ? "rewards.reasonProductReferralReversal" : "rewards.reasonProductReferral"))
                                    .font(.inter(14, .semibold)).foregroundStyle(Brand.ink).lineLimit(1)
                                Text(saleLine(sale)).font(.inter(12)).foregroundStyle(Brand.muted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Text("\u{2066}\(sale.points > 0 ? "+" : "−")\(PointsFormat.count(abs(sale.points), l.current))\u{2069}")
                                .font(.inter(15, .heavy))
                                .foregroundStyle(sale.points > 0 ? Brand.success : Brand.muted)
                        }
                        .accessibilityElement(children: .combine)
                        if sale.id != view.sales.last?.id { Divider() }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()

            if let earlier = view.earlier { EarlierEarnings(earlier: earlier) }
        }
        .task { await loadRewards() }
    }

    private func loadRewards() async {
        rewards = try? await app.services.api.call(API.rewards)
    }

    private func saleLine(_ sale: AffiliateDashboard.Sale) -> String {
        var parts: [String] = []
        if sale.reversed { parts.append(l.t("affiliate.saleReturned")) }
        parts.append(OrderWording.date(sale.createdAt, language: l.current))
        if let reference = sale.orderReference { parts.append("\u{2066}\(reference)\u{2069}") }
        if let available = sale.availableAt { parts.append(l.t("rewards.availableFrom", ["date": OrderWording.date(available, language: l.current)])) }
        return parts.joined(separator: " · ")
    }

    private func stat(_ label: String, _ value: String, coin: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(l.t(label)).font(.inter(12, .bold)).foregroundStyle(Brand.muted).lineLimit(2)
            HStack(spacing: 6) {
                if coin { PointsCoin(size: 20) }
                Text("\u{2066}\(value)\u{2069}").font(.inter(20, .heavy)).foregroundStyle(Brand.navy).lineLimit(1).minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card(padding: 14)
        .accessibilityElement(children: .combine)
    }
}

/// Money from the programme before it paid in points, and its payout.
private struct EarlierEarnings: View {
    let earlier: AffiliateDashboard.Earlier
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let minimum = Money(fils: ReferenceData.shared.rules.accountRules.minAffiliatePayoutFils)
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("affiliate.earlierTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("affiliate.earlierNote", ["amount": earlier.balance.formatted(l.current)])).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            Button(l.t("affiliate.requestPayout")) {
                Task {
                    var amount: Money?
                    if await app.attempt({ amount = try await app.services.api.call(API.requestAffiliatePayout).amount }) {
                        if let amount { app.toast(l.t("affiliate.payoutRequested", ["amount": amount.formatted(l.current)])) }
                    }
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!earlier.payout.ok)
            Text(earlier.payout.ok
                ? l.t("affiliate.payoutNote")
                : l.t("affiliate.payoutShort", ["minimum": minimum.formatted(l.current), "short": (earlier.payout.shortBy ?? .zero).formatted(l.current)]))
                .font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            ForEach(earlier.entries) { entry in
                HStack {
                    Text(l.t(entry.reason == "affiliate_reversal" ? "affiliate.reasonReversal" : entry.reason == "cashed_out" ? "affiliate.reasonPayout" : "affiliate.reasonCommission"))
                        .font(.inter(13)).foregroundStyle(Brand.ink)
                    Spacer()
                    Text("\u{2066}\(entry.amount.formatted(l.current))\u{2069}").font(.inter(13, .bold)).foregroundStyle(Brand.navy)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

/// The products whose stores pay a share of the sale on top (3.7.1), each with
/// a link carrying this member's code — the web's `ProductsPayingExtra`.
/// Highest rate first, a page at a time.
private struct ProductsPayingExtra: View {
    let code: String
    @State private var page = 1
    @State private var result: AffiliateProductPage?
    @State private var failed = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("affiliate.productsTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("affiliate.productsNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if let result {
                if result.rows.isEmpty {
                    Text(l.t("affiliate.productsEmpty")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(result.rows) { row in
                        let title = l.current == .ar ? (row.titleAr ?? row.title) : row.title
                        HStack(spacing: 10) {
                            RemoteImage(reference: row.image)
                                .frame(width: 48, height: 48)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(title).font(.inter(14, .bold)).foregroundStyle(Brand.navy).lineLimit(2)
                                (Text("\(row.vendorName) · \(row.price.formatted(l.current)) · ").foregroundColor(Brand.muted)
                                    + Text(l.t("affiliate.productRate", ["rate": row.percent])).foregroundColor(Brand.success).bold())
                                    .font(.inter(12))
                            }
                            Spacer(minLength: 6)
                            ShareLink(item: app.services.configuration.url(path: ReferralCode.productPath(handle: row.handle, code: code))) {
                                Image(systemName: "square.and.arrow.up")
                                    .font(.system(size: 15, weight: .bold))
                                    .foregroundStyle(Brand.navy)
                                    .frame(width: 44, height: 44)
                                    .background(Circle().fill(Brand.tint))
                            }
                            .accessibilityLabel("\(l.t("affiliate.copyProductLink")): \(title)")
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
            /* Nil is somebody the server no longer counts as a member, which has nothing to list. */
            result = try await app.services.api.call(API.affiliateProducts, API.PageOnly(page: page))
                ?? AffiliateProductPage(rows: [], total: 0, page: 1, pageSize: 20)
            failed = false
        } catch {
            failed = true
        }
    }
}

/// Joining — the web's join card: what the programme is, how it works in three
/// steps, what a point is worth, the name shoppers see (the account's first
/// name, ready to change) and the one condition, saying the links are paid.
private struct JoinAffiliates: View {
    let joined: () async -> Void
    @State private var name = ""
    @State private var agreed = false
    @State private var refused = false
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    PointsCoin(size: 52)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(l.t("affiliate.title")).font(.inter(20, .heavy)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                        Text(l.t("affiliate.pitch")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    }
                }
                step(1, "square.and.arrow.up", "affiliate.step1Title", "affiliate.step1")
                step(2, "bag", "affiliate.step2Title", "affiliate.step2")
                step(3, nil, "affiliate.step3Title", "affiliate.step3")
                Label("\(l.t("affiliate.free")) · \(l.t("rewards.pointValue", ["value": Money(fils: 1000).formatted(l.current)]))", systemImage: "checkmark.seal.fill")
                    .font(.inter(13, .semibold))
                    .foregroundStyle(Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Brand.pearl))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))

            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    LabeledField(label: l.t("affiliate.displayName"), text: $name)
                    Text(l.t("affiliate.displayNameHint")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Toggle(isOn: $agreed) {
                    Text(l.t("affiliate.disclosure")).font(.inter(14)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
                }
                .tint(Brand.navy)
                .onChange(of: agreed) { refused = false }
                if refused {
                    Text(l.t("affiliate.disclosureRequired")).font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
                }
                Button(sending ? l.t("affiliate.joining") : l.t("affiliate.joinNow")) {
                    guard agreed else { refused = true; Haptics.refused(); return }
                    Task {
                        sending = true
                        defer { sending = false }
                        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                        let worked = await app.attempt(done: "affiliate.joined") {
                            _ = try await app.services.api.call(API.joinAffiliates, .init(displayName: trimmed.isEmpty ? nil : trimmed, acceptDisclosure: true))
                        }
                        if worked {
                            await app.refreshMemberCode()
                            await joined()
                        }
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || sending)
            }
            .card()
        }
        .onAppear {
            if name.isEmpty, let first = app.session.user?.name?.split(separator: " ").first { name = String(first.prefix(80)) }
        }
    }

    private func step(_ number: Int, _ icon: String?, _ title: String, _ body: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let icon {
                    Image(systemName: icon).font(.system(size: 17, weight: .semibold)).foregroundStyle(Brand.navy)
                } else {
                    PointsCoin(size: 24)
                }
            }
            .frame(width: 40, height: 40)
            .background(Circle().fill(Color.white))
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t("affiliate.stepNumber", ["number": "\(number)"])).font(.inter(12, .bold)).foregroundStyle(Brand.muted)
                Text(l.t(title)).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                Text(l.t(body, ["days": "\(ReferenceData.shared.rules.accountRules.productLinkDays)"]))
                    .font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
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
            ShopPage(header: false, footer: false, refresh: { await mine.load() }) {
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
