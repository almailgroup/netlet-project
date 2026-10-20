import Charts
import SwiftUI

/// The portal's front page — the web's `/admin` overview, with the grouped
/// menu under it, since a phone has no sidebar. It opens on counts rather
/// than lists, because the first question on arriving is "is anything
/// waiting for me": "Waiting on you" carries only what somebody must act on
/// and hides a zero; the standing totals sit below it.
struct PortalHomeView: View {
    @State private var actor: SellerIdentity?
    @State private var counts: PortalCounts?
    @State private var health: StoreHealth?
    @State private var sales: SalesSummary?
    @State private var waiting: [String: Int] = [:]
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("admin.overview"), intro: l.t("admin.overviewIntro"), refresh: { await load() }) {
            if let actor {
                if actor.inPortal {
                    content(actor)
                } else {
                    EmptyStateView(systemImage: "storefront", title: l.t("admin.noAccess"), note: l.t("admin.noAccessNote"))
                        .card(padding: 0)
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 160)
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func content(_ actor: SellerIdentity) -> some View {
        PortalSectionHeading(title: l.t("admin.needsYou"))
        let tiles = waitingTiles(actor)
        if tiles.isEmpty {
            PortalAllClear(text: l.t(actor.kind == "courier" ? "dispatch.noneCourier" : "admin.allClear"))
        } else {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(tiles, id: \.label) { tile in
                    PortalTile(value: tile.value, label: l.t(tile.label), urgent: tile.urgent, href: tile.href)
                }
            }
        }
        if let sales, actor.can("payouts.view", vendorId: actor.ownVendor) {
            SalesPanel(sales: sales)
        }
        if let health { HealthPanel(health: health) }
        if let counts, actor.kind != "courier" {
            PortalSectionHeading(title: l.t("admin.atAGlance"))
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                PortalTile(value: counts.published, label: l.t("admin.countPublished"), href: "/admin/products")
                PortalTile(value: counts.draft, label: l.t("admin.countDraft"), href: "/admin/products")
                PortalTile(value: counts.archived, label: l.t("admin.countArchived"), href: "/admin/products")
                if actor.can("platform.viewAll") {
                    PortalTile(value: counts.vendorsApproved, label: l.t("admin.countVendorsApproved"), href: "/admin/vendors")
                }
            }
        }
        PortalMenu(actor: actor)
    }

    private struct Tile {
        let label: String
        let value: Int
        let href: String
        var urgent = true
    }

    private func waitingTiles(_ actor: SellerIdentity) -> [Tile] {
        var tiles: [Tile] = []
        func add(_ label: String, _ value: Int?, _ href: String, urgent: Bool = true) {
            if let value, value > 0 { tiles.append(Tile(label: label, value: value, href: href, urgent: urgent)) }
        }
        if actor.kind == "courier" {
            add("dispatch.waiting", waiting["parcels"], "/admin/dispatch")
            add("admin.claimsOpenTile", waiting["claims"], "/admin/claims")
            return tiles
        }
        add("admin.applications", waiting["applications"], "/admin/applications")
        if let counts {
            if actor.can("product.review") { add("admin.countPendingReview", counts.pendingReview, "/admin/review") }
            if actor.can("platform.viewAll") {
                add("admin.countVendorsPending", counts.vendorsPending, "/admin/vendors")
                add("admin.zeroCommissionTile", counts.zeroCommission.count, counts.zeroCommission.count == 1 ? "/admin/vendors/\(counts.zeroCommission[0].id)" : "/admin/vendors")
            }
            add("admin.countOutOfStock", counts.outOfStock, "/admin/stock")
            add("admin.countLowStock", counts.lowStock, "/admin/stock")
        }
        add("admin.offersWaiting", waiting["offers"], "/admin/offers")
        add("admin.sellerChanges", waiting["sellerChanges"], "/admin/audit")
        add("dispatch.waiting", waiting["parcels"], "/admin/dispatch")
        add("admin.claimsOpenTile", waiting["claims"], "/admin/claims")
        add("admin.messagesWaiting", waiting["messages"], "/admin/messages")
        add("admin.returnsWaiting", waiting["returns"], "/admin/returns")
        add("admin.affiliatesWaiting", waiting["affiliates"], "/admin/affiliates")
        add("admin.bannersWaiting", waiting["banners"], "/admin/ads")
        add("support.waitingTile", waiting["support"], "/admin/support")
        add("fulfilment.toReceiveTile", waiting["toReceive"], "/admin/fulfilment", urgent: false)
        add("fulfilment.toPickTile", waiting["toPick"], "/admin/fulfilment")
        return tiles
    }

    /// Each count asked only of somebody it is for, together.
    private func load() async {
        let api = app.services.api
        do {
            let who = try await api.call(API.portalIdentity, .init())
            actor = who
            failed = nil
            guard who.inPortal else { return }
            let own = who.ownVendor
            func asked<T>(_ allowed: Bool, _ ask: @escaping @Sendable () async throws -> T) async -> T? {
                guard allowed else { return nil }
                return try? await ask()
            }
            func count(_ capability: String, _ ask: @escaping @Sendable () async throws -> Int) async -> Int? {
                await asked(who.can(capability, vendorId: own), ask)
            }
            async let parcels = count("delivery.view") { try await api.call(API.parcelsWaiting) }
            async let claims = count("delivery.view") { try await api.call(API.claimsOpen) }
            if who.kind == "courier" {
                waiting = ["parcels": await parcels ?? 0, "claims": await claims ?? 0].compactMapValues { $0 }
                return
            }
            async let overview = try? api.call(API.portalCounts, .init())
            async let score = try? api.call(API.storeHealth, .init())
            async let summary = asked(who.can("payouts.view", vendorId: own)) { try await api.call(API.sales) }
            async let offers = count("offer.answer") { try await api.call(API.offersWaiting, .init(vendorId: own)) }
            async let changes = count("platform.viewAll") { try await api.call(API.sellerChanges, .init(limit: 1)).unseen }
            async let applications = count("platform.manageUsers") { try await api.call(API.applicationsWaiting) }
            async let returns = count("returns.handle") { try await api.call(API.returnsWaiting) }
            async let affiliates = count("affiliate.manage") { try await api.call(API.affiliatesWaiting) }
            async let banners = count("product.review") { try await api.call(API.bannersWaiting) }
            async let support = count("support.answer") { try await api.call(API.supportWaiting) }
            async let messages = asked(who.kind == "vendor" && who.can("chat.answer", vendorId: own)) { try await api.call(API.shopperMessagesWaiting) }
            async let centres = asked(who.can("fulfilment.operate")) { try await api.call(API.centreWaiting) }
            counts = await overview
            health = await score ?? nil
            sales = await summary
            let floor = await centres
            waiting = [
                "parcels": await parcels, "claims": await claims, "offers": await offers, "sellerChanges": await changes,
                "applications": await applications, "returns": await returns, "affiliates": await affiliates,
                "banners": await banners, "support": await support, "messages": await messages,
                "toReceive": floor?.toReceive, "toPick": floor?.toPick,
            ].compactMapValues { $0 }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { failed = failure }
        }
    }
}

/// The portal's menu, grouped by task, keeping only what this person may use
/// and what the app draws (`PortalRules.menu(for:)`).
struct PortalMenu: View {
    let actor: SellerIdentity
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ForEach(Array(PortalRules.shared.menu(for: actor).enumerated()), id: \.offset) { _, group in
            VStack(alignment: .leading, spacing: 0) {
                if let label = group.label {
                    Text(l.t(label)).font(.inter(12, .semibold)).foregroundStyle(Brand.muted).padding(.bottom, 6)
                }
                VStack(spacing: 0) {
                    ForEach(group.links.filter { $0.href != "/admin" }, id: \.href) { link in
                        Button {
                            app.open(.portal(link.href))
                        } label: {
                            HStack {
                                Text(l.t(link.label)).font(.inter(15, .semibold)).foregroundStyle(Brand.ink)
                                Spacer()
                                Image(systemName: "chevron.forward").font(.footnote).foregroundStyle(Brand.chevron).flipsForRightToLeftLayoutDirection(true)
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 50)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressFillStyle(cornerRadius: 0))
                        if link.href != group.links.last?.href { Divider().padding(.leading, 14) }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }
}

/// How the store is selling (`SalesPanel`): today, seven days or thirty, a
/// bar for each Kuwaiti day, and what sold most.
private struct SalesPanel: View {
    let sales: SalesSummary
    @State private var period = "week"
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PortalSectionHeading(title: l.t("admin.salesTitle"), note: l.t("admin.salesNote"))
            PortalSegmented(label: l.t("admin.periodLabel"), value: $period, options: [
                ("today", l.t("admin.periodToday")), ("week", l.t("admin.period7")), ("month", l.t("admin.period30")),
            ])
            if let figures = sales.periods[period] {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                    PortalStat(label: l.t("admin.salesTitle"), value: figures.sales.formatted(l.current))
                    PortalStat(label: l.t("admin.statOrders"), value: "\(figures.orders)")
                    PortalStat(label: l.t("admin.statAverage"), value: figures.orders > 0 ? figures.averageOrder.formatted(l.current) : "—")
                    PortalStat(label: l.t("admin.statReturns"), value: "\(figures.returns)")
                }
            }
            chart.card()
            topSellers.card()
        }
    }

    private var chart: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("admin.chartTitle")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
            let best = sales.daily.max { $0.sales.fils < $1.sales.fils }
            if let best, best.sales.fils > 0 {
                let total = Money(fils: sales.daily.reduce(0) { $0 + $1.sales.fils })
                let summary = l.t("admin.chartSummary", ["total": total.formatted(l.current), "day": dayLabel(best.day), "best": best.sales.formatted(l.current)])
                Text(summary).font(.inter(12)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                Chart(Array(sales.daily.enumerated()), id: \.offset) { index, day in
                    BarMark(x: .value("day", index), y: .value("sales", Double(day.sales.fils) / 1000))
                        .foregroundStyle(Brand.navy)
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .frame(height: 120)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(summary)
                HStack {
                    Text(dayLabel(sales.daily.first?.day ?? ""))
                    Spacer()
                    Text(dayLabel(sales.daily.last?.day ?? ""))
                }
                .font(.inter(11))
                .foregroundStyle(Brand.muted)
            } else {
                Text(l.t("admin.noSalesYet")).font(.inter(13)).foregroundStyle(Brand.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var topSellers: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("admin.topSellers")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
            if sales.top.isEmpty {
                Text(l.t("admin.noSalesYet")).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            ForEach(Array(sales.top.enumerated()), id: \.offset) { index, entry in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(index + 1)").font(.inter(13, .bold)).foregroundStyle(Brand.muted).frame(width: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.title).font(.inter(14, .semibold)).foregroundStyle(Brand.ink).lineLimit(2)
                        Text(l.t("admin.topUnits", ["count": "\(entry.units)"])).font(.inter(12)).foregroundStyle(Brand.muted)
                    }
                    Spacer()
                    Text(entry.sales.formatted(l.current)).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func dayLabel(_ day: String) -> String {
        guard let date = ISO8601.plain.date(from: day + "T12:00:00Z") else { return day }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: l.current == .ar ? "ar_KW@numbers=latn" : "en_GB")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.setLocalizedDateFormatFromTemplate("dMMM")
        return formatter.string(from: date)
    }
}

/// A store's health (`HealthPanel`): the score, its band, and each part with
/// the counts it came from — every figure one the seller can check.
private struct HealthPanel: View {
    let health: StoreHealth
    @Environment(LanguageSettings.self) private var l

    private var tone: Color {
        health.band == "good" ? Brand.success : health.band == "fair" ? Color(red: 107 / 255, green: 79 / 255, blue: 29 / 255) : Brand.danger
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PortalSectionHeading(title: l.t("admin.health"), note: l.t("admin.healthNote"))
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(health.score)").font(.inter(34, .heavy)).foregroundStyle(tone).environment(\.layoutDirection, .leftToRight)
                    Text(l.t(bandKey)).font(.inter(15, .bold)).foregroundStyle(tone)
                }
                ForEach(health.components, id: \.key) { part in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(l.t(componentKey(part.key))).font(.inter(13, .semibold)).foregroundStyle(Brand.ink)
                            Spacer()
                            Text("\(part.score)").font(.inter(13, .bold)).foregroundStyle(Brand.navy)
                        }
                        ProgressView(value: Double(part.score), total: 100).tint(Brand.navy)
                        Text(detail(part)).font(.inter(12)).foregroundStyle(Brand.muted)
                    }
                }
            }
            .card()
        }
    }

    private var bandKey: String {
        switch health.band {
        case "good": return "admin.healthGood"
        case "fair": return "admin.healthFair"
        default: return "admin.healthPoor"
        }
    }

    private func componentKey(_ key: String) -> String {
        switch key {
        case "catalog": return "admin.healthCatalog"
        case "stock": return "admin.healthStock"
        case "compliance": return "admin.healthCompliance"
        default: return "admin.healthRating"
        }
    }

    private func detail(_ part: StoreHealth.Part) -> String {
        let shown = part.detail.compactMap { key, value -> (String, Double)? in value.map { (key, $0) } }
        guard !shown.isEmpty else { return "—" }
        let labels: [(String, String)] = [
            ("published", "health.published"), ("pendingReview", "health.pendingReview"), ("outOfStock", "health.outOfStock"),
            ("variants", "health.variants"), ("rejections", "health.rejections"), ("suspendAt", "health.suspendAt"),
            ("rating", "health.rating"), ("outOf", "health.outOf"),
        ]
        return labels.compactMap { key, label -> String? in
            guard let value = shown.first(where: { $0.0 == key })?.1 else { return nil }
            return "\(l.t(label)) \(value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value))"
        }
        .joined(separator: " · ")
    }
}
