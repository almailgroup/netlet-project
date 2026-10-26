import SwiftUI

// MARK: - Standing orders

/// Subscribe & Save on NetLet's desk — the web's `/admin/subscriptions`: how
/// many standing orders run, how many wait, and the run by hand for a shop
/// whose daily schedule is not set up.
struct PortalSubscriptionsView: View {
    @State private var overview: SubscriptionOverview?
    @State private var failed: APIError?
    @State private var running = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("subscriptions.adminTitle"), intro: l.t("subscriptions.adminNote"), refresh: { await load() }) {
            if let overview {
                PortalNotice(text: l.t(overview.scheduled ? "subscriptions.scheduled" : "subscriptions.notScheduled"), tone: overview.scheduled ? .success : .warning)
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    PortalStat(label: l.t("subscriptions.countActive"), value: "\(overview.active)")
                    PortalStat(label: l.t("subscriptions.countPaused"), value: "\(overview.paused)")
                    PortalStat(label: l.t("subscriptions.countDue"), value: "\(overview.due)")
                }
                Button {
                    Task { await run() }
                } label: {
                    HStack(spacing: 8) {
                        if running { ProgressView().tint(.white) }
                        Text(l.t("subscriptions.runNow"))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(running)
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            overview = try await app.services.api.call(API.subscriptionOverview)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, overview == nil { failed = failure }
        }
    }

    private func run() async {
        running = true
        defer { running = false }
        var summary: SubscriptionRun?
        guard await app.attempt(fallback: "admin.saveFailed", {
            summary = try await app.services.api.call(API.runDueSubscriptions)
        }), let summary else { return }
        app.toast(l.t("subscriptions.ran", ["placed": "\(summary.placed)", "outOfStock": "\(summary.outOfStock)", "paused": "\(summary.paused)"]))
        await load()
    }
}

// MARK: - The audit trail

/// Who did what, and who authorised them — the web's `/admin/audit`, with
/// "what the sellers changed" narrowed on the server and its unread count,
/// which only pressing the button clears.
struct PortalAuditView: View {
    @State private var sellersOnly = false
    @State private var rows: [AuditEntry]?
    @State private var unseen: Int?
    @State private var failed: APIError?
    @State private var marking = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.audit"), intro: l.t("admin.auditNote"), refresh: { await load() }) {
            PortalSegmented(label: l.t("admin.audit"), value: $sellersOnly, options: [
                (false, l.t("admin.auditEverything")),
                (true, (unseen ?? 0) > 0 ? "\(l.t("admin.sellerChanges")) (\(unseen ?? 0))" : l.t("admin.sellerChanges")),
            ])
            if let unseen {
                if unseen > 0 {
                    HStack(spacing: 10) {
                        Text(l.t("admin.auditUnseen", ["count": "\(unseen)"])).font(.inter(13, .semibold)).foregroundStyle(Brand.accentInk)
                        Spacer(minLength: 6)
                        Button(l.t("admin.auditMarkSeen")) { Task { await markSeen() } }
                            .buttonStyle(PortalSmallButtonStyle())
                            .disabled(marking)
                    }
                } else {
                    Text(l.t("admin.auditAllRead")).font(.inter(13)).foregroundStyle(Brand.muted)
                }
            }
            if let rows {
                if rows.isEmpty {
                    PortalEmpty(text: l.t("admin.noAudit"))
                } else {
                    VStack(spacing: 0) {
                        ForEach(rows) { entry in
                            AuditRow(entry: entry)
                            if entry.id != rows.last?.id { Divider() }
                        }
                    }
                    .padding(.horizontal, 14)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
        .onChange(of: sellersOnly) {
            rows = nil
            Task { await load() }
        }
    }

    private func load() async {
        do {
            let api = app.services.api
            let changes = try await api.call(API.sellerChanges, .init(limit: 100))
            unseen = changes.unseen
            rows = sellersOnly ? changes.rows : try await api.call(API.auditTrail, .init(limit: 100))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, rows == nil { failed = failure }
        }
    }

    private func markSeen() async {
        marking = true
        defer { marking = false }
        if await app.attempt(fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.markAuditSeen) }) {
            await load()
        }
    }
}

private struct AuditRow: View {
    let entry: AuditEntry
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(actionLabel).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    if let label = entry.subjectLabel, !label.isEmpty {
                        Text(label).font(.inter(13)).foregroundStyle(Brand.ink).lineLimit(2)
                    }
                }
                Spacer(minLength: 6)
                Text(OrderWording.dateTime(entry.createdAt, language: l.current)).font(.inter(12)).foregroundStyle(Brand.muted)
            }
            FlowLayout(spacing: 6) {
                if let change = entry.change {
                    Text(latin("\(change.from) → \(change.to)"))
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(Brand.ink)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Brand.photo))
                }
                Text(entry.automatic || entry.actorEmail == nil
                    ? l.t("admin.auditAutomatic")
                    : l.t("admin.auditBy", ["name": latin(entry.actorEmail ?? "")]))
                    .font(.inter(12)).foregroundStyle(Brand.body)
                if let role = entry.actorRole {
                    StatusPill(label: l.t(role == "admin" ? "admin.roleAdmin" : TeamWords.role(role)), tone: .waiting)
                }
                if let authorised = entry.authorisedByEmail {
                    Text(l.t("admin.auditAuthorisedBy", ["name": latin(authorised)])).font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }

    /// The act's own words when the dictionary has them, its name otherwise.
    private var actionLabel: String {
        let key = "action.\(entry.action)"
        return Phrasebook.shared.has(key) ? l.t(key) : entry.action
    }
}

// MARK: - Fraud watch

/// Reviews and referrals that do not look like a shopper's own — the web's
/// `/admin/fraud` (3.6.5). Each row says what the shared rules noticed and
/// the counts behind it; nothing acts by itself. A review is hidden by a
/// person's press, with a reason, and shown again the same way.
struct PortalFraudView: View {
    @State private var showReferrals = false
    @State private var onlyFlagged = true
    @State private var reviews: [ReviewWatchRow]?
    @State private var referrals: [ReferralWatchRow]?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("fraud.title"), intro: l.t("fraud.intro"), refresh: { await load() }) {
            PortalSegmented(label: l.t("fraud.title"), value: $showReferrals, options: [
                (false, l.t("fraud.tabReviews")),
                (true, l.t("fraud.tabReferrals")),
            ])
            Toggle(l.t("fraud.onlyFlagged"), isOn: $onlyFlagged).font(.inter(14, .semibold)).foregroundStyle(Brand.navy).tint(Brand.navy)
            if showReferrals {
                if let referrals {
                    let rows = onlyFlagged ? referrals.filter { !$0.flags.isEmpty } : referrals
                    if rows.isEmpty {
                        PortalEmpty(text: onlyFlagged ? l.t("fraud.noneFlagged", ["count": "\(referrals.count)"]) : l.t("fraud.noReferrals"))
                    } else {
                        ForEach(rows) { ReferralWatchCard(row: $0) }
                    }
                } else { pending }
            } else {
                if let reviews {
                    let rows = onlyFlagged ? reviews.filter { !$0.flags.isEmpty } : reviews
                    if rows.isEmpty {
                        PortalEmpty(text: onlyFlagged ? l.t("fraud.noneFlagged", ["count": "\(reviews.count)"]) : l.t("fraud.noReviews"))
                    } else {
                        ForEach(rows) { ReviewWatchCard(row: $0) { Task { await load() } } }
                    }
                } else { pending }
            }
        }
        .task { await load() }
        .onChange(of: showReferrals) { Task { await load() } }
    }

    @ViewBuilder
    private var pending: some View {
        if let failed {
            ErrorStateView(error: failed) { await load() }
        } else {
            ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
        }
    }

    private func load() async {
        do {
            let api = app.services.api
            if showReferrals {
                referrals = try await api.call(API.referralWatch)
            } else {
                reviews = try await api.call(API.reviewWatch)
            }
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { failed = failure }
        }
    }
}

enum FraudWords {
    /// The words for a risk level, as the orders desk says them; low says nothing.
    static func risk(_ risk: String) -> String? {
        switch risk {
        case "high": return "admin.riskHigh"
        case "watch": return "admin.riskWatch"
        default: return nil
        }
    }

    static func flag(_ flag: OrderRisk.Flag, language: Language) -> String {
        let key = "fraud.\(flag.signal)"
        guard Phrasebook.shared.has(key) else { return flag.signal }
        return Phrasebook.shared.text(key, language: language, params: DeskWords.detail(flag.detail, language: language))
    }
}

private struct FraudFlags: View {
    let flags: [OrderRisk.Flag]
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if !flags.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(flags, id: \.signal) { flag in
                    Text("· " + FraudWords.flag(flag, language: l.current))
                        .font(.inter(13, flag.serious ? .semibold : .regular))
                        .foregroundStyle(flag.serious ? Brand.danger : Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

private struct ReviewWatchCard: View {
    let row: ReviewWatchRow
    let changed: () -> Void
    @State private var hiding = false
    @State private var reason = ""
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalCard {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    (Text(row.productTitle) + Text(" · " + l.t("fraud.stars", ["rating": "\(row.rating)"])))
                        .font(.inter(14, .bold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                    Text(l.t("fraud.reviewBy", ["email": latin(row.reviewerEmail ?? "")]) + " · " + OrderWording.dateTime(row.createdAt, language: l.current))
                        .font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 4) {
                    if row.hidden { StatusPill(label: l.t("fraud.hiddenPill"), tone: .waiting) }
                    if let risk = FraudWords.risk(row.risk) {
                        StatusPill(label: l.t(risk), tone: .portal(row.risk == "high" ? "danger" : "warning"))
                    }
                }
            }
            if (row.title ?? "").isEmpty == false || (row.body ?? "").isEmpty == false {
                (Text(row.title.map { $0 + " " } ?? "").fontWeight(.bold) + Text(row.body ?? ""))
                    .font(.inter(13)).foregroundStyle(Brand.ink).lineLimit(3)
            }
            FraudFlags(flags: row.flags)
            if row.hidden, let why = row.hiddenReason, !why.isEmpty {
                Text(l.t("fraud.hiddenBecause", ["reason": why])).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            if row.hidden {
                Button(l.t("fraud.show")) { Task { await setHidden(false) } }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(busy)
            } else if hiding {
                // The web asks in a dialog with the reason under its sentence;
                // here the same question opens under the review it is about.
                VStack(alignment: .leading, spacing: 8) {
                    Divider()
                    Text(l.t("fraud.hideTitle")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    Text(l.t("fraud.hideBody")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    LabeledField(label: l.t("fraud.hideReason"), text: Binding(get: { reason }, set: { reason = String($0.prefix(200)) }))
                    HStack(spacing: 8) {
                        Spacer()
                        Button(l.t("common.cancel")) { hiding = false; reason = "" }.buttonStyle(PortalSmallButtonStyle())
                        Button(l.t("fraud.hide")) { Task { await setHidden(true) } }
                            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                            .disabled(busy)
                    }
                }
            } else {
                Button(l.t("fraud.hide")) { hiding = true }.buttonStyle(PortalSmallButtonStyle(kind: .danger))
            }
        }
    }

    private func setHidden(_ hidden: Bool) async {
        busy = true
        defer { busy = false }
        let why = reason.trimmingCharacters(in: .whitespaces)
        let input = API.HideReview(reviewId: row.id, hidden: hidden, reason: hidden && !why.isEmpty ? why : nil)
        if await app.attempt(done: hidden ? "fraud.hiddenDone" : "fraud.shownDone", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.setReviewHidden, input)
        }) {
            hiding = false
            reason = ""
            changed()
        }
    }
}

private struct ReferralWatchCard: View {
    let row: ReferralWatchRow
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalCard {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(l.t("fraud.referralLine", ["referrer": latin(row.referrerEmail ?? ""), "referred": latin(row.referredEmail ?? "")]))
                        .font(.inter(14, .bold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                    Text(OrderWording.dateTime(row.createdAt, language: l.current) + " · "
                        + (row.qualifiedAt.map { l.t("fraud.qualifiedOn", ["date": OrderWording.dateTime($0, language: l.current)]) } ?? l.t("fraud.notQualified")))
                        .font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                if let risk = FraudWords.risk(row.risk) {
                    StatusPill(label: l.t(risk), tone: .portal(row.risk == "high" ? "danger" : "warning"))
                }
            }
            FraudFlags(flags: row.flags)
        }
    }
}

// MARK: - The switchboard

/// Every advanced feature, on or off for the whole shop — the web's
/// `/admin/features`. Turning one off asks first, since it closes a door for
/// every shopper at once; turning one on does not.
struct PortalFeaturesView: View {
    @State private var rows: [FeatureSwitch]?
    @State private var failed: APIError?
    @State private var confirming: String?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.features"), intro: l.t("features.note"), refresh: { await load() }) {
            if let rows {
                Text(l.t("features.summary", ["on": "\(rows.filter(\.enabled).count)", "total": "\(rows.count)"]))
                    .font(.inter(13, .semibold)).foregroundStyle(Brand.muted)
                ForEach(FeatureWords.groups, id: \.key) { group in
                    let members = rows.filter { FeatureWords.group($0.key) == group.key }
                    if !members.isEmpty {
                        PortalCard {
                            Text(l.t(group.title)).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                            ForEach(members) { row in
                                Divider()
                                FeatureRow(row: row, busy: busy) { on in
                                    if on { Task { await set(row.key, true) } } else { confirming = row.key }
                                }
                            }
                        }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
        .confirmationDialog(confirming.map { l.t("features.confirmTitle", ["name": l.t(FeatureWords.name($0))]) } ?? "",
                            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
                            titleVisibility: .visible) {
            Button(l.t("features.turnOff"), role: .destructive) {
                if let key = confirming { Task { await set(key, false) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { confirming = nil }
        } message: {
            if let key = confirming { Text(l.t(FeatureWords.whenOff(key))) }
        }
    }

    private func load() async {
        do {
            rows = try await app.services.api.call(API.featureSwitches)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, rows == nil { failed = failure }
        }
    }

    private func set(_ key: String, _ enabled: Bool) async {
        busy = true
        defer { busy = false }
        confirming = nil
        let name = l.t(FeatureWords.name(key))
        if await app.attempt(done: enabled ? "features.turnedOn" : "features.turnedOff", fallback: "admin.saveFailed", params: ["name": name], {
            _ = try await app.services.api.call(API.setFeature, .init(key: key, enabled: enabled))
        }) {
            await load()
        }
    }
}

private struct FeatureRow: View {
    let row: FeatureSwitch
    let busy: Bool
    let change: (Bool) -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle(isOn: Binding(get: { row.enabled }, set: { change($0) })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(l.t(FeatureWords.name(row.key))).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
                    Text(l.t(FeatureWords.whenOff(row.key))).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Brand.navy)
            .disabled(busy)
            if row.enabled, let why = row.why {
                Label(l.t(why.reason), systemImage: why.kind == "blocked" ? "exclamationmark.triangle.fill" : "info.circle")
                    .font(.inter(12, .semibold))
                    .foregroundStyle(why.kind == "blocked" ? Brand.accentInk : Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let updated = row.updatedAt {
                Text("\(l.t("features.changedBy", ["date": OrderWording.date(updated, language: l.current)])) \(row.updatedByEmail.map(latin) ?? l.t("features.someone"))")
                    .font(.inter(12)).foregroundStyle(Brand.muted)
            }
        }
        .padding(.vertical, 4)
    }
}

/// Each switch's name, what turning it off does, and where it is listed —
/// the web page's own tables.
enum FeatureWords {
    static let groups: [(key: String, title: String)] = [
        ("search", "features.groupSearch"),
        ("shopping", "features.groupShopping"),
        ("afterSale", "features.groupAfterSale"),
        ("selling", "features.groupSelling"),
        ("content", "features.groupContent"),
    ]

    static func group(_ key: String) -> String {
        switch key {
        case "ai", "assistant", "recommendations", "boughtTogether", "voiceSearch", "photoSearch": return "search"
        case "priceOffers", "wishlists", "giftCards", "subscriptions", "membership", "tryOn", "cashOnDelivery": return "shopping"
        case "returns", "deliveryRatings", "damageClaims": return "afterSale"
        case "ads", "affiliates", "fulfilment": return "selling"
        default: return "content"
        }
    }

    static func name(_ key: String) -> String {
        switch key {
        case "ai": return "features.ai"
        case "assistant": return "features.assistant"
        case "recommendations": return "features.recommendations"
        case "boughtTogether": return "features.boughtTogether"
        case "priceOffers": return "features.priceOffers"
        case "returns": return "features.returns"
        case "deliveryRatings": return "features.deliveryRatings"
        case "damageClaims": return "features.damageClaims"
        case "wishlists": return "features.wishlists"
        case "giftCards": return "features.giftCards"
        case "affiliates": return "features.affiliates"
        case "ads": return "features.ads"
        case "subscriptions": return "features.subscriptions"
        case "fulfilment": return "features.fulfilment"
        case "membership": return "features.membership"
        case "voiceSearch": return "features.voiceSearch"
        case "photoSearch": return "features.photoSearch"
        case "appBanner": return "features.appBanner"
        case "articles": return "features.articles"
        case "cashOnDelivery": return "features.cashOnDelivery"
        default: return "features.tryOn"
        }
    }

    static func whenOff(_ key: String) -> String {
        switch key {
        case "ai": return "features.aiOff"
        case "assistant": return "features.assistantOff"
        case "recommendations": return "features.recommendationsOff"
        case "boughtTogether": return "features.boughtTogetherOff"
        case "priceOffers": return "features.priceOffersOff"
        case "returns": return "features.returnsOff"
        case "deliveryRatings": return "features.deliveryRatingsOff"
        case "damageClaims": return "features.damageClaimsOff"
        case "wishlists": return "features.wishlistsOff"
        case "giftCards": return "features.giftCardsOff"
        case "affiliates": return "features.affiliatesOff"
        case "ads": return "features.adsOff"
        case "subscriptions": return "features.subscriptionsOff"
        case "fulfilment": return "features.fulfilmentOff"
        case "membership": return "features.membershipOff"
        case "voiceSearch": return "features.voiceSearchOff"
        case "photoSearch": return "features.photoSearchOff"
        case "appBanner": return "features.appBannerOff"
        case "cashOnDelivery": return "features.cashOnDeliveryOff"
        case "articles": return "features.articlesOff"
        default: return "features.tryOnOff"
        }
    }
}

// MARK: - People

/// Everybody with an account — the web's `/admin/people`: who administers
/// NetLet, and which stores each person belongs to. Granting or revoking the
/// administrator's rights and taking somebody out of a store all ask first;
/// the server refuses revoking your own and removing the last one.
struct PortalPeopleView: View {
    private enum Asking: Identifiable {
        case grant(PortalPerson)
        case revoke(PortalPerson)
        case remove(PortalPerson, PortalPerson.Membership)

        var id: String {
            switch self {
            case .grant(let person): return "grant-\(person.id)"
            case .revoke(let person): return "revoke-\(person.id)"
            case .remove(let person, let membership): return "remove-\(person.id)-\(membership.vendorId)"
            }
        }
    }

    @State private var query = ""
    @State private var page = 1
    @State private var people: PeoplePage?
    @State private var stores: [StoreRow] = []
    @State private var failed: APIError?
    @State private var asking: Asking?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.people"), intro: l.t("admin.adminNote"), refresh: { await load() }) {
            if let people {
                Text(l.t("admin.peopleCount", ["count": "\(people.total)"])).font(.inter(13, .semibold)).foregroundStyle(Brand.muted)
            }
            if !stores.isEmpty {
                AddToStoreForm(stores: stores) { await load() }
            }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Brand.muted)
                TextField(l.t("admin.searchPeople"), text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .font(.inter(15))
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            if let people {
                if people.rows.isEmpty {
                    PortalEmpty(text: l.t("admin.noPeople"))
                } else {
                    ForEach(people.rows) { person in personCard(person) }
                    PortalPager(page: people.page, pageSize: people.pageSize, total: people.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task(id: query) {
            // The first load is at once; a search waits for typing to pause.
            if people != nil {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                page = 1
            }
            await load()
        }
        .confirmationDialog(title, isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }), titleVisibility: .visible) {
            Button(confirmLabel, role: isGrant ? nil : ButtonRole.destructive) { Task { await confirm() } }
            Button(l.t("common.cancel"), role: .cancel) { asking = nil }
        } message: {
            Text(bodyText)
        }
    }

    private func personCard(_ person: PortalPerson) -> some View {
        let isSelf = person.id == app.session.user?.id
        return PortalCard {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    FlowLayout(spacing: 6) {
                        Text(person.shownName).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                        if person.role == "admin" { StatusPill(label: l.t("admin.isAdmin"), tone: .shipped) }
                        if isSelf { Text(l.t("admin.you")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted) }
                    }
                    Text(latin(person.email)).font(.inter(13)).foregroundStyle(Brand.body).lineLimit(1).truncationMode(.middle)
                    Text([
                        "\(l.t("admin.joined")) \(OrderWording.date(person.createdAt, language: l.current))",
                        person.lastSignedIn.map { "\(l.t("admin.lastSeen")) \(OrderWording.date($0, language: l.current))" },
                    ].compactMap { $0 }.joined(separator: " · "))
                    .font(.inter(12)).foregroundStyle(Brand.muted)
                }
                Spacer(minLength: 0)
            }
            if person.role == "admin" {
                Button { asking = .revoke(person) } label: { Label(l.t("admin.revokeAdmin"), systemImage: "shield.slash") }
                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    .disabled(busy)
            } else {
                Button { asking = .grant(person) } label: { Label(l.t("admin.makeAdmin"), systemImage: "checkmark.shield") }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(busy)
            }
            Divider()
            Text(l.t("admin.memberOf")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            if person.vendors.isEmpty {
                Text(l.t("admin.noVendorMemberships")).font(.inter(13)).foregroundStyle(Brand.body)
            } else {
                FlowLayout(spacing: 6) {
                    ForEach(person.vendors, id: \.vendorId) { membership in
                        HStack(spacing: 6) {
                            Text(membership.vendorName).font(.inter(13, .semibold)).foregroundStyle(Brand.ink)
                            Text("· \(l.t(TeamWords.role(membership.role)))").font(.inter(12)).foregroundStyle(Brand.muted)
                            Button { asking = .remove(person, membership) } label: {
                                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Brand.danger).frame(width: 32, height: 32)
                            }
                            .buttonStyle(.tap)
                            .disabled(busy)
                            .accessibilityLabel(l.t("admin.removeFrom", ["vendor": membership.vendorName]))
                        }
                        .padding(.leading, 10)
                        .background(Capsule().fill(Brand.tint))
                    }
                }
            }
        }
    }

    private var isGrant: Bool {
        if case .grant = asking { return true }
        return false
    }

    private var title: String {
        switch asking {
        case .grant(let person): return l.t("admin.makeAdminTitle", ["name": person.shownName])
        case .revoke(let person): return l.t("admin.revokeAdminTitle", ["name": person.shownName])
        case .remove(let person, let membership): return l.t("admin.removeFromTitle", ["name": person.shownName, "vendor": membership.vendorName])
        case nil: return ""
        }
    }

    private var bodyText: String {
        switch asking {
        case .grant: return l.t("admin.makeAdminBody")
        case .revoke: return l.t("admin.revokeAdminBody")
        default: return l.t("admin.removeMemberBody")
        }
    }

    private var confirmLabel: String {
        switch asking {
        case .grant: return l.t("admin.makeAdmin")
        case .revoke: return l.t("admin.revokeAdmin")
        default: return l.t("admin.removeMember")
        }
    }

    private func load() async {
        do {
            let api = app.services.api
            let trimmed = query.trimmingCharacters(in: .whitespaces)
            people = try await api.call(API.people, .init(query: trimmed.isEmpty ? nil : trimmed, page: page))
            failed = nil
            if stores.isEmpty { stores = (try? await api.call(API.vendorRows, .init(pageSize: 200)))?.rows ?? [] }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, people == nil { failed = failure }
        }
    }

    private func confirm() async {
        guard let asking else { return }
        self.asking = nil
        busy = true
        defer { busy = false }
        let api = app.services.api
        let done = await app.attempt(done: "admin.saved", fallback: "admin.saveFailed") {
            switch asking {
            case .grant(let person): _ = try await api.call(API.setAdmin, .init(userId: person.id, isAdmin: true))
            case .revoke(let person): _ = try await api.call(API.setAdmin, .init(userId: person.id, isAdmin: false))
            case .remove(let person, let membership): _ = try await api.call(API.removeFromVendor, .init(vendorId: membership.vendorId, userId: person.id))
            }
        }
        if done { await load() }
    }
}

/// Adding somebody who already has an account to a store, at a rank.
private struct AddToStoreForm: View {
    let stores: [StoreRow]
    let added: () async -> Void
    @State private var email = ""
    @State private var vendorId: Int?
    @State private var role = "staff"
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalCard {
            Text(l.t("admin.addToVendor")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            LabeledField(label: l.t("admin.emailAddress"), text: $email, placeholder: l.t("admin.emailPlaceholder"), keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("admin.newStore")).font(.subheadline.weight(.semibold))
                Menu {
                    ForEach(stores, id: \.id) { store in
                        Button(store.name) {
                            Haptics.tap()
                            vendorId = store.id
                        }
                    }
                } label: {
                    MenuField(text: stores.first { $0.id == vendorId }?.name, placeholder: l.t("admin.chooseStore"))
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("admin.memberRole")).font(.subheadline.weight(.semibold))
                Menu {
                    ForEach(["staff", "manager", "owner"], id: \.self) { rank in
                        Button(l.t(TeamWords.role(rank))) {
                            Haptics.tap()
                            role = rank
                        }
                    }
                } label: {
                    MenuField(text: l.t(TeamWords.role(role)), placeholder: l.t("admin.memberRole"))
                }
            }
            Button {
                Task { await add() }
            } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView().tint(.white) } else { Image(systemName: "person.badge.plus") }
                    Text(l.t("admin.addMember"))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || vendorId == nil || email.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func add() async {
        guard let vendorId else { return }
        busy = true
        defer { busy = false }
        let address = email.trimmingCharacters(in: .whitespaces)
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.addToVendor, .init(vendorId: vendorId, email: address, role: role))
        }) {
            email = ""
            await added()
        }
    }
}
