import SwiftUI

/// The portal's front page — the web's `/admin` overview, with the grouped
/// menu under it, since a phone has no side column. For a rank that reads the
/// money it is the dashboard (`PortalDashboardViews`): four figures, the sales
/// line with its estimate, what waits, the shelf, the departments, the
/// activity and the best sellers, over 7, 30 or 90 days, the choice kept on the
/// phone. A rank that reads only the shelf gets what waits and the shelf. "What
/// waits" carries only what somebody must act on and hides a zero; the standing
/// totals sit below it.
struct PortalHomeView: View {
    @State private var actor: SellerIdentity?
    @State private var counts: PortalCounts?
    @State private var health: StoreHealth?
    @State private var board: PortalDashboard?
    @State private var boardFailed: APIError?
    @State private var shelf: ShelfHealth?
    @State private var waiting: [String: Int] = [:]
    @State private var failed: APIError?
    @AppStorage("netlet.portalRange") private var range = 30
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var mayMoney: Bool {
        guard let actor, actor.kind != "courier" else { return false }
        return actor.can("payouts.view", vendorId: actor.ownVendor)
    }

    var body: some View {
        PortalScreen(title: l.t("admin.overview"), intro: mayMoney ? l.t("dashboard.asOf", ["date": PortalDay.today(l.current)]) : l.t("admin.overviewIntro"), refresh: { await load() }) {
            if let actor {
                if actor.adminLocked == true {
                    /* This install is not one the owner authorised: nothing of
                       the portal is drawn, only where it stands. */
                    DeviceGateView {
                        await app.session.refreshSeller()
                        await load()
                    }
                } else if actor.inPortal {
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
        .onChange(of: range) { Task { await loadBoard() } }
    }

    @ViewBuilder
    private func content(_ actor: SellerIdentity) -> some View {
        let needs = DashboardNeedsYou(
            rows: waitingTiles(actor).map { DashboardNeedsYou.Row(label: $0.label, value: $0.value, href: $0.href, urgent: $0.urgent) },
            allClear: l.t(actor.kind == "courier" ? "dispatch.noneCourier" : "admin.allClear")
        )
        if mayMoney {
            PortalSegmented(label: l.t("dashboard.range"), value: $range, options: [
                (7, l.t("dashboard.range7")), (30, l.t("dashboard.range30")), (90, l.t("dashboard.range90")),
            ])
            if let board {
                if board.truncated { PortalNotice(text: l.t("dashboard.truncated"), tone: .warning) }
                DashboardFigures(board: board)
                DashboardTrend(board: board).id(board.range)
                needs
                DashboardShelf(stock: board.stock)
                DashboardDepartments(board: board)
                DashboardActivity(board: board)
                DashboardTop(board: board)
            } else if let boardFailed {
                ErrorStateView(error: boardFailed) { await loadBoard() }
            } else {
                DashboardSkeleton()
            }
        } else {
            needs
            if let shelf, actor.kind != "courier" { DashboardShelf(stock: shelf) }
        }
        if let health { HealthPanel(health: health) }
        // The store's own warnings (3.3.18), drawn only when it has any.
        if actor.kind == "vendor" { StoreWarningsCard(manage: false) }
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
        add("devices.waitingTile", waiting["devices"], "/admin/devices")
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
        add("admin.returnsWaiting", waiting["returns"], "/admin/returns")
        add("warranty.waitingTile", waiting["warranty"], "/admin/warranty")
        add("admin.affiliatesWaiting", waiting["affiliates"], "/admin/affiliates")
        add("commission.waitingTile", waiting["proposals"], "/admin/commission")
        add("admin.bannersWaiting", waiting["banners"], "/admin/ads")
        add("support.waitingTile", waiting["support"], "/admin/support")
        add("fraud.ordersTile", waiting["fraudOrders"], "/admin/orders")
        add("fraud.watchTile", waiting["fraudWatch"], "/admin/fraud")
        add("review.waitingTile", waiting["reviewsWaiting"], "/admin/fraud?view=waiting")
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
            guard who.inPortal, who.adminLocked != true else { return }
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
            let money = who.can("payouts.view", vendorId: own)
            /* The dashboard's own failure is kept, so it is said with Try again
               rather than drawn as a page with no figures. */
            func result<T: Sendable>(_ allowed: Bool, _ ask: @escaping @Sendable () async throws -> T) async -> Result<T, Error>? {
                guard allowed else { return nil }
                do { return .success(try await ask()) } catch { return .failure(error) }
            }
            let period = range
            async let dashboard = result(money) { try await api.call(API.dashboard, .init(range: period)) }
            async let shelfHealth: ShelfHealth? = asked(!money) { try await api.call(API.shelfHealth) }
            async let offers = count("offer.answer") { try await api.call(API.offersWaiting, .init(vendorId: own)) }
            async let changes = count("platform.viewAll") { try await api.call(API.sellerChanges, .init(limit: 1)).unseen }
            async let applications = count("platform.manageUsers") { try await api.call(API.applicationsWaiting) }
            async let returns = count("returns.handle") { try await api.call(API.returnsWaiting) }
            async let warranty = count("returns.handle") { try await api.call(API.warrantyWaiting) }
            async let affiliates = count("affiliate.manage") { try await api.call(API.affiliatesWaiting) }
            async let proposals = count("vendor.setCommission") { try await api.call(API.proposalsWaiting) }
            async let banners = count("product.review") { try await api.call(API.bannersWaiting) }
            async let support = count("support.answer") { try await api.call(API.supportWaiting) }
            async let centres = asked(who.can("fulfilment.operate")) { try await api.call(API.centreWaiting) }
            async let fraud = asked(who.can("platform.viewAll")) { try await api.call(API.fraudUnseen) }
            /* Product reviews the automatic check left for a person — an administrator's desk. */
            async let heldReviews = count("platform.manageUsers") { try await api.call(API.waitingReviewCount) }
            /* Devices asking for an administrator's rights, waiting on the owner alone. */
            async let devices = count("platform.devices") { try await api.call(API.devicesWaiting) }
            counts = await overview
            health = await score ?? nil
            switch await dashboard {
            case .success(let read)?:
                board = read
                boardFailed = nil
            case .failure(let error)?:
                let failure = APIError.from(error)
                if failure != .cancelled, board == nil { boardFailed = failure }
            case nil:
                break
            }
            shelf = await shelfHealth
            let floor = await centres
            let alerts = await fraud
            waiting = [
                "parcels": await parcels, "claims": await claims, "offers": await offers, "sellerChanges": await changes,
                "applications": await applications, "returns": await returns, "warranty": await warranty, "affiliates": await affiliates, "proposals": await proposals,
                "banners": await banners, "support": await support,
                "toReceive": floor?.toReceive, "toPick": floor?.toPick,
                "fraudOrders": alerts?.orders, "fraudWatch": alerts?.watch,
                "reviewsWaiting": await heldReviews,
                "devices": await devices,
            ].compactMapValues { $0 }
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { failed = failure }
        }
    }

    /// The dashboard alone, for a new period; the last one stays drawn, faint, while it is read.
    private func loadBoard() async {
        do {
            board = try await app.services.api.call(API.dashboard, .init(range: range))
            boardFailed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, board == nil { boardFailed = failure }
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
                            HStack(spacing: 12) {
                                PortalIconPlate(href: link.href)
                                Text(l.t(link.label)).font(.inter(15, .semibold)).foregroundStyle(Brand.ink)
                                Spacer()
                                Image(systemName: "chevron.forward").font(.footnote).foregroundStyle(Brand.chevron).flipsForRightToLeftLayoutDirection(true)
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 54)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressFillStyle(cornerRadius: 0))
                        if link.href != group.links.last?.href { Divider().padding(.leading, 58) }
                    }
                }
                .portalSurface(cornerRadius: 16)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
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
            ("variants", "health.variants"), ("warnings", "health.warnings"), ("suspendAt", "health.suspendAt"),
            ("rating", "health.rating"), ("outOf", "health.outOf"),
        ]
        return labels.compactMap { key, label -> String? in
            guard let value = shown.first(where: { $0.0 == key })?.1 else { return nil }
            return "\(l.t(label)) \(value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value))"
        }
        .joined(separator: " · ")
    }
}
