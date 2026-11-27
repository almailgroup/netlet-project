import Charts
import SwiftUI

/// Product views on a phone — the web's `/admin/views` (`components/admin/ProductViews.tsx`)
/// card for card: four figures, views each day against the period before,
/// the app or the website, where they came from, and every product with its
/// figures and its demand said in words. The channels are three fixed hues
/// in a fixed order wherever they are drawn; the sources one hue, a ranking.
/// Every figure and every reading is the server's (`inventory.views`).
enum ViewsWords {
    static func channel(_ channel: String) -> String {
        switch channel {
        case "app": "views.channelApp"
        case "web_phone": "views.channelPhone"
        default: "views.channelComputer"
        }
    }

    static func source(_ source: String) -> String {
        switch source {
        case "home": "views.sourceHome"
        case "search": "views.sourceSearch"
        case "browse": "views.sourceBrowse"
        case "store": "views.sourceStore"
        case "product": "views.sourceProduct"
        case "account": "views.sourceAccount"
        case "outside": "views.sourceOutside"
        default: "views.sourceOther"
        }
    }

    static func demand(_ demand: String) -> String {
        switch demand {
        case "unseen": "views.demandUnseen"
        case "few": "views.demandFew"
        case "notBuying": "views.demandNotBuying"
        case "some": "views.demandSome"
        default: "views.demandStrong"
        }
    }

    static func explain(_ demand: String) -> String {
        switch demand {
        case "unseen": "views.explainUnseen"
        case "few": "views.explainFew"
        case "notBuying": "views.explainNotBuying"
        case "some": "views.explainSome"
        default: "views.explainStrong"
        }
    }

    /// The web's pill tones: a product looked at and not bought is the one to act on.
    static func tone(_ demand: String) -> OrderTone {
        switch demand {
        case "notBuying": .portal("warning")
        case "some": .portal("navy")
        case "strong": .portal("good")
        default: .portal("neutral")
        }
    }

    /// Fixed per channel: the app indigo, the website on a phone cyan, on a computer amber.
    static func color(_ channel: String) -> Color {
        switch channel {
        case "app": PortalLook.series[0]
        case "web_phone": PortalLook.series[2]
        default: PortalLook.series[1]
        }
    }

    /// The server's `MIN_VISITORS_TO_JUDGE`.
    static let minVisitors = 10
    static let channels = ["app", "web_phone", "web_computer"]
}

struct PortalViewsView: View {
    @AppStorage("netlet.viewsRange") private var range = 30
    @State private var report: ViewsReport?
    @State private var failed: APIError?
    @State private var stores: [StoreRow] = []
    @State private var store: Int?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("views.title"), intro: l.t("views.intro"), refresh: { await load() }) {
            PortalSegmented(label: l.t("dashboard.range"), value: $range, options: [
                (7, l.t("dashboard.range7")), (30, l.t("dashboard.range30")), (90, l.t("dashboard.range90")),
            ])
            if app.session.seller?.kind == "admin" && stores.count > 1 {
                Menu {
                    Button(l.t("admin.statusAllStores")) { store = nil }
                    ForEach(stores, id: \.id) { row in Button(row.name) { store = row.id } }
                } label: {
                    MenuField(text: store.flatMap { id in stores.first { $0.id == id }?.name }, placeholder: l.t("admin.statusAllStores"))
                }
                .accessibilityLabel(l.t("admin.filterStore"))
            }
            if let report {
                ViewsReportSections(report: report)
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                DashboardSkeleton()
            }
        }
        .task(id: "\(range)-\(store ?? 0)") { await load() }
        .task {
            if app.session.seller?.kind == "admin" {
                stores = (try? await app.services.api.call(API.vendorRows, .init(pageSize: 200)))?.rows ?? []
            }
        }
    }

    private func load() async {
        do {
            report = try await app.services.api.call(API.productViews, .init(range: range, vendorId: store))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, report == nil { failed = failure }
        }
    }
}

/// The whole report under the page's heading.
struct ViewsReportSections: View {
    let report: ViewsReport
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if !report.ready {
            PortalNotice(text: l.t("views.unavailable"))
        } else {
            VStack(alignment: .leading, spacing: 14) {
                if report.totals.views.current == 0 { PortalNotice(text: l.t("views.noneYet")) }
                ViewsFigures(report: report)
                ViewsTrend(report: report).id(report.range)
                ViewsChannels(report: report)
                ViewsSources(report: report, limit: nil)
                ViewsProducts(report: report)
                Text(l.t("views.privacyNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// The four figures, two by two (`Figures`).
struct ViewsFigures: View {
    let report: ViewsReport
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let totals = report.totals
        let before = totals.visitors.previous > 0 ? (Double(totals.orders.previous) / Double(totals.visitors.previous) * 1000).rounded() / 10 : nil
        let change: Double? = {
            guard let now = report.conversion, let before, before > 0 else { return nil }
            return ((now - before) / before * 1000).rounded() / 10
        }()
        TileGrid(spacing: 10) {
            DashboardFigure(label: l.t("views.views"), value: "\(totals.views.current)", change: totals.views.change, days: report.range,
                            series: report.days.map { Double($0.views) }, color: PortalLook.series[0], symbol: "eye")
            DashboardFigure(label: l.t("views.visitors"), value: "\(totals.visitors.current)", change: totals.visitors.change, days: report.range,
                            series: report.days.map { Double($0.visitors) }, color: PortalLook.series[2], symbol: "person.2")
            DashboardFigure(label: l.t("views.orders"), value: "\(totals.orders.current)", change: totals.orders.change, days: report.range,
                            series: [], color: PortalLook.series[4], symbol: "list.bullet.rectangle.portrait")
            DashboardFigure(label: l.t("views.conversion"), value: report.conversion.map { ViewsFigures.decimal($0) } ?? "—", change: change, days: report.range,
                            series: [], color: PortalLook.series[1], symbol: "percent")
        }
    }

    /// 12.5, or 12 for a whole one, in Latin digits.
    static func decimal(_ value: Double) -> String {
        value.rounded() == value ? "\(Int(value))" : String(format: "%.1f", value)
    }
}

/// Views each day, this period over the one before (`TrendPanel`). A tap shows a day.
struct ViewsTrend: View {
    let report: ViewsReport
    @State private var selected: Int?
    @State private var table = false
    @Environment(LanguageSettings.self) private var l

    private struct Mark: Identifiable {
        let index: Int
        let value: Double
        let series: String
        var id: String { "\(series)-\(index)" }
    }

    var body: some View {
        DashboardPanel(title: l.t("views.trendTitle"), note: l.t("views.trendNote")) {
            Button { table.toggle() } label: { Text(table ? l.t("dashboard.showChart") : l.t("dashboard.showTable")) }
                .buttonStyle(PortalSmallButtonStyle())
        } content: {
            if table { tableView } else { chart }
        }
    }

    private var chart: some View {
        let current = report.days.enumerated().map { Mark(index: $0.offset, value: Double($0.element.views), series: "current") }
        let before = report.previousDays.enumerated().map { Mark(index: $0.offset, value: Double($0.element.views), series: "before") }
        let peak = max((current + before).map(\.value).max() ?? 0, 1)
        let last = max(current.count - 1, 1)
        let summary = l.t("views.chartLabel", [
            "from": PortalDay.label(report.days.first?.day ?? "", l.current),
            "to": PortalDay.label(report.days.last?.day ?? "", l.current),
            "count": "\(report.totals.views.current)",
        ])
        return Chart {
            ForEach(before) { mark in
                LineMark(x: .value("day", mark.index), y: .value("views", mark.value), series: .value("series", "before"))
                    .foregroundStyle(PortalLook.previous)
                    .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
            }
            ForEach(current) { mark in
                AreaMark(x: .value("day", mark.index), yStart: .value("views", 0.0), yEnd: .value("views", mark.value))
                    .foregroundStyle(LinearGradient(colors: [PortalLook.series[0].opacity(0.24), PortalLook.series[0].opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
            }
            ForEach(current) { mark in
                LineMark(x: .value("day", mark.index), y: .value("views", mark.value), series: .value("series", "current"))
                    .foregroundStyle(PortalLook.series[0])
                    .lineStyle(StrokeStyle(lineWidth: 2.25, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
            }
            if let selected, let day = report.days[safe: selected] {
                RuleMark(x: .value("day", selected))
                    .foregroundStyle(Brand.navy.opacity(0.25))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                PointMark(x: .value("day", selected), y: .value("views", Double(day.views)))
                    .foregroundStyle(PortalLook.series[0])
                    .symbolSize(70)
                    .annotation(position: .top, spacing: 6, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(PortalDay.label(day.day, l.current)).font(.inter(11, .semibold)).foregroundStyle(Brand.muted)
                            Text("\(day.views) \(l.t("views.views"))").font(.inter(13, .bold)).foregroundStyle(Brand.navy)
                            Text(l.t("views.visitorsOn", ["count": "\(day.visitors)"])).font(.inter(11)).foregroundStyle(Brand.muted)
                        }
                        .padding(8)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.surface).shadow(color: Brand.shadow.opacity(0.12), radius: 6, y: 2))
                    }
            }
        }
        .chartXScale(domain: 0 ... last)
        .chartYScale(domain: 0 ... peak * 1.12)
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle()
                    .fill(Color.clear)
                    .contentShape(Rectangle())
                    .onTapGesture { location in
                        guard let plot = proxy.plotFrame else { return }
                        let x = location.x - geometry[plot].origin.x
                        guard let position = proxy.value(atX: x, as: Double.self), position.isFinite else { return }
                        let day = min(max(Int(position.rounded()), 0), last)
                        selected = selected == day ? nil : day
                    }
            }
        }
        .chartXAxis {
            AxisMarks(values: [0, current.count / 2, max(current.count - 1, 0)]) { value in
                AxisValueLabel {
                    if let index = value.as(Int.self), let day = report.days[safe: index] {
                        Text(PortalDay.label(day.day, l.current)).font(.inter(11)).foregroundStyle(Brand.muted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 1)).foregroundStyle(PortalLook.grid)
                AxisValueLabel {
                    if let figure = value.as(Double.self) {
                        Text(PortalDay.compact(figure, l.current)).font(.inter(11)).foregroundStyle(Brand.muted)
                    }
                }
            }
        }
        .frame(height: 200)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary)
        .accessibilityHint(l.t("dashboard.showTable"))
    }

    private var tableView: some View {
        VStack(spacing: 0) {
            HStack {
                Text(l.t("dashboard.columnDay")).frame(maxWidth: .infinity, alignment: .leading)
                Text(l.t("views.views")).frame(maxWidth: .infinity, alignment: .trailing)
                Text(l.t("views.visitors")).frame(maxWidth: .infinity, alignment: .trailing)
                Text(l.t("dashboard.columnBefore")).frame(maxWidth: .infinity, alignment: .trailing)
            }
            .font(.inter(12, .semibold))
            .foregroundStyle(Brand.muted)
            .padding(.vertical, 8)
            ForEach(Array(report.days.enumerated()), id: \.offset) { index, day in
                Divider()
                HStack {
                    Text(PortalDay.label(day.day, l.current)).frame(maxWidth: .infinity, alignment: .leading)
                    Text("\(day.views)").frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(Brand.navy)
                    Text("\(day.visitors)").frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(Brand.navy)
                    Text(report.previousDays[safe: index].map { "\($0.views)" } ?? "—").frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(Brand.muted)
                }
                .font(.inter(13))
                .padding(.vertical, 7)
                .accessibilityElement(children: .combine)
            }
        }
        .monospacedDigit()
    }
}

/// The app or the website (`ChannelsPanel`).
struct ViewsChannels: View {
    let report: ViewsReport
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        DashboardPanel(title: l.t("views.channelsTitle"), note: l.t("views.channelsNote")) {
            if report.totals.views.current == 0 {
                Text(l.t("views.none")).font(.inter(14)).foregroundStyle(Brand.muted)
            } else {
                DashboardSegments(label: l.t("views.channelsTitle"), parts: report.channels.map { row in
                    .init(id: row.channel, label: l.t(ViewsWords.channel(row.channel)), value: "\(row.views)", percent: row.percent, color: ViewsWords.color(row.channel))
                })
            }
        }
    }
}

/// Where they came from, most first, one hue (`SourcesPanel`).
struct ViewsSources: View {
    let report: ViewsReport
    let limit: Int?
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let rows = limit.map { Array(report.sources.prefix($0)) } ?? report.sources
        DashboardPanel(title: l.t("views.sourcesTitle"), note: l.t("views.sourcesNote")) {
            if rows.isEmpty {
                Text(l.t("views.none")).font(.inter(14)).foregroundStyle(Brand.muted)
            } else {
                VStack(spacing: 12) {
                    ForEach(rows) { row in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(l.t(ViewsWords.source(row.source))).font(.inter(13)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 8)
                                Text("\(row.views)").font(.inter(13, .semibold)).foregroundStyle(Brand.navy).monospacedDigit()
                                Text("\(row.percent)%").font(.inter(12)).foregroundStyle(Brand.muted).monospacedDigit().frame(minWidth: 34, alignment: .trailing)
                            }
                            GeometryReader { proxy in
                                Capsule().fill(PortalLook.grid)
                                    .overlay(alignment: .leading) {
                                        Capsule().fill(PortalLook.series[0]).frame(width: max(4, proxy.size.width * CGFloat(row.percent) / 100))
                                    }
                            }
                            .frame(height: 6)
                            .accessibilityHidden(true)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}

/// Every product with its figures and its demand (`ProductsPanel`).
struct ViewsProducts: View {
    let report: ViewsReport
    @State private var term = ""
    @State private var sort = "views"
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rows: [ViewsReport.ProductRow] {
        let found = report.products.filter { SearchRank.textsMatch([$0.title, $0.titleAr, $0.vendorName], term) }
        switch sort {
        case "orders": return found.sorted { ($0.orders, $0.units, $0.views) > ($1.orders, $1.units, $1.views) }
        case "attention":
            let rank: (String) -> Int = { $0 == "notBuying" ? 0 : $0 == "some" ? 1 : 2 }
            return found.sorted { (rank($0.demand), -$0.views) < (rank($1.demand), -$1.views) }
        default: return found
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PortalSectionHeading(title: l.t("views.productsTitle"), note: note)
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Brand.muted).accessibilityHidden(true)
                TextField(l.t("views.search"), text: $term)
                    .font(.inter(16))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.surface))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            PortalSegmented(label: l.t("views.sort"), value: $sort, options: [
                ("views", l.t("views.sortViews")), ("orders", l.t("views.sortOrders")), ("attention", l.t("views.sortAttention")),
            ])
            if rows.isEmpty {
                PortalEmpty(text: report.products.isEmpty ? l.t("views.noProducts") : l.t("views.noMatch"))
            } else {
                ForEach(rows) { row in productCard(row) }
                if report.products.count < report.productCount {
                    Text(l.t("views.shown", ["shown": "\(report.products.count)", "count": "\(report.productCount)"]))
                        .font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
        }
    }

    private var note: String {
        let base = l.t("views.productsNote", ["min": "\(ViewsWords.minVisitors)"])
        guard let rate = report.conversion else { return base }
        return base + " " + l.t("views.averageNote", ["rate": ViewsFigures.decimal(rate)])
    }

    /// A product nobody looked at is one line rather than four zeros, so the list stays short.
    @ViewBuilder
    private func productCard(_ row: ViewsReport.ProductRow) -> some View {
        if row.views == 0 {
            PortalCard {
                HStack(spacing: 10) {
                    nameButton(row)
                    VStack(alignment: .trailing, spacing: 4) {
                        StatusPill(label: l.t(ViewsWords.demand(row.demand)), tone: ViewsWords.tone(row.demand))
                        if row.inCarts > 0 {
                            Text(l.t("views.inCartsCount", ["count": "\(row.inCarts)"]))
                                .font(.inter(12)).foregroundStyle(Brand.muted)
                        }
                    }
                    .fixedSize()
                }
            }
        } else {
            PortalCard {
                VStack(alignment: .leading, spacing: 10) {
                    nameButton(row)
                    TileGrid(spacing: 8, columns: 4) {
                        figure(l.t("views.views"), row.views)
                        figure(l.t("views.visitors"), row.visitors)
                        figure(l.t("views.orders"), row.orders)
                        figure(l.t("views.inCarts"), row.inCarts)
                    }
                    HStack(spacing: 10) {
                        ViewsChannelSplit(row: row)
                        Spacer(minLength: 6)
                        StatusPill(label: l.t(ViewsWords.demand(row.demand)), tone: ViewsWords.tone(row.demand))
                    }
                }
            }
        }
    }

    private func nameButton(_ row: ViewsReport.ProductRow) -> some View {
        Button {
            app.open(.portal("/admin/products/\(row.productId)"))
        } label: {
            HStack(spacing: 10) {
                RemoteImage(reference: row.image, contentMode: .fill)
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.current == .ar ? row.titleAr ?? row.title : row.title)
                        .font(.inter(15, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading).lineLimit(2)
                    if let store = row.vendorName { Text(store).font(.inter(12)).foregroundStyle(Brand.muted) }
                    if !row.published { StatusPill(label: l.t("views.notOnSale"), tone: .portal("neutral")) }
                }
                Spacer(minLength: 0)
            }
        }
        .buttonStyle(.tap)
    }

    private func figure(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.inter(11)).foregroundStyle(Brand.muted).lineLimit(1).minimumScaleFactor(0.75)
            Text("\(value)").font(.inter(15, .bold)).foregroundStyle(Brand.navy).monospacedDigit()
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(PortalLook.ground))
        .accessibilityElement(children: .combine)
    }
}

/// A product's views split by channel: three coloured squares and their counts, one sentence to VoiceOver.
struct ViewsChannelSplit: View {
    let row: ViewsReport.ProductRow
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 10) {
            ForEach(ViewsWords.channels, id: \.self) { channel in
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous).fill(ViewsWords.color(channel)).frame(width: 8, height: 8)
                    Text("\(row.channels.value(channel))").font(.inter(12)).foregroundStyle(Brand.muted).monospacedDigit()
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(l.t("views.splitLabel", [
            "app": "\(row.channels.app)", "phone": "\(row.channels.webPhone)", "computer": "\(row.channels.webComputer)",
        ]))
    }
}

/// One product's views, for its editor (`ProductViewsCard`).
struct ProductViewsCard: View {
    let productId: Int
    let published: Bool
    @AppStorage("netlet.viewsRange") private var range = 30
    @State private var report: ViewsReport?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PortalSectionHeading(title: l.t("views.cardTitle"), note: l.t("views.cardNote"))
            PortalSegmented(label: l.t("dashboard.range"), value: $range, options: [
                (7, l.t("dashboard.range7")), (30, l.t("dashboard.range30")), (90, l.t("dashboard.range90")),
            ])
            if let report {
                if !report.ready {
                    PortalNotice(text: l.t("views.unavailable"))
                } else if !published && report.totals.views.current == 0 {
                    PortalNotice(text: l.t("views.cardDraft"))
                } else {
                    summary(report)
                }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 60)
            }
        }
        .task(id: range) {
            report = (try? await app.services.api.call(API.productViews, .init(range: range, productId: productId))) ?? report
        }
    }

    @ViewBuilder
    private func summary(_ report: ViewsReport) -> some View {
        let row = report.products.first
        TileGrid(spacing: 8, columns: 4) {
            figure(l.t("views.views"), report.totals.views.current)
            figure(l.t("views.visitors"), report.totals.visitors.current)
            figure(l.t("views.orders"), row?.orders ?? 0)
            figure(l.t("views.inCarts"), row?.inCarts ?? 0)
        }
        if let row {
            VStack(alignment: .leading, spacing: 6) {
                StatusPill(label: l.t(ViewsWords.demand(row.demand)), tone: ViewsWords.tone(row.demand))
                Text(l.t(ViewsWords.explain(row.demand), ["min": "\(ViewsWords.minVisitors)"]))
                    .font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
        }
        if report.totals.views.current > 0 {
            ViewsChannels(report: report)
            ViewsSources(report: report, limit: 4)
        }
        Button {
            app.open(.portal("/admin/views"))
        } label: {
            Label(l.t("views.seeAll"), systemImage: "arrow.up.forward")
        }
        .buttonStyle(PortalSmallButtonStyle())
    }

    private func figure(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.inter(11)).foregroundStyle(Brand.muted).lineLimit(1).minimumScaleFactor(0.75)
            Text("\(value)").font(.inter(16, .bold)).foregroundStyle(Brand.navy).monospacedDigit()
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(PortalLook.ground))
        .accessibilityElement(children: .combine)
    }
}
