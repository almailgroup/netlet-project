import Charts
import SwiftUI

/// The portal's dashboard on a phone — the web's `components/admin/Dashboard.tsx`
/// card for card: four figures with how each moved and its own sparkline, the
/// sales line with the period before and a week's estimate, what waits, the
/// shelf's health, revenue by department, who bought and who joined, and what
/// sold most. **The sales line is the page's one bold thing**; everything
/// round it is white on the cool ground. Every figure is the server's
/// (`inventory.dashboard`); a chart has a table a press away for VoiceOver and
/// for anybody who would rather read the numbers.

/// "12 Oct", a Kuwaiti day read at noon UTC so no zone can move it.
enum PortalDay {
    static func label(_ day: String, _ language: Language) -> String {
        guard let date = ISO8601.plain.date(from: day + "T12:00:00Z") else { return day }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: language == .ar ? "ar_KW@numbers=latn" : "en_GB")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.setLocalizedDateFormatFromTemplate("dMMM")
        return formatter.string(from: date)
    }

    /// Today, spelled out, on Kuwait's calendar.
    static func today(_ language: Language) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: language == .ar ? "ar_KW@numbers=latn" : "en_GB")
        formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
        formatter.setLocalizedDateFormatFromTemplate("EEEEdMMMMy")
        return formatter.string(from: Date())
    }

    /// An axis figure, short: "1.2K".
    static func compact(_ value: Double, _ language: Language) -> String {
        value.formatted(.number.notation(.compactName).precision(.significantDigits(1 ... 2)).locale(Locale(identifier: language == .ar ? "ar_KW@numbers=latn" : "en_GB")))
    }
}

/// A card on the dashboard: a heading, a line on what it shows, and its body (`Panel`).
struct DashboardPanel<Content: View, Action: View>: View {
    let title: String
    var note: String?
    @ViewBuilder var action: () -> Action
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.inter(15, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                    if let note {
                        Text(note).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 6)
                action()
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .portalSurface(cornerRadius: 18)
    }
}

extension DashboardPanel where Action == EmptyView {
    init(title: String, note: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.note = note
        self.action = { EmptyView() }
        self.content = content
    }
}

/// How a figure moved against the period before, said with an arrow and a word (`ChangeLine`).
struct DashboardChange: View {
    let change: Double?
    let days: Int
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if let change {
            let rounded = (abs(change) * 10).rounded() / 10
            let shown = rounded.rounded() == rounded ? "\(Int(rounded))" : String(format: "%.1f", rounded)
            HStack(spacing: 4) {
                if change == 0 {
                    Text(l.t("dashboard.flat")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                } else {
                    Image(systemName: change > 0 ? "arrow.up.right" : "arrow.down.right")
                        .font(.system(size: 10, weight: .bold))
                        .flipsForRightToLeftLayoutDirection(true)
                        .accessibilityHidden(true)
                    Text(l.t(change > 0 ? "dashboard.up" : "dashboard.down", ["change": shown])).font(.inter(12, .semibold))
                }
                Text(l.t("dashboard.vsPrevious", ["days": "\(days)"])).font(.inter(12)).foregroundStyle(Brand.muted).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(change > 0 ? PortalLook.up : change < 0 ? PortalLook.down : Brand.muted)
            .accessibilityElement(children: .combine)
        } else {
            Text(l.t("dashboard.noCompare")).font(.inter(12)).foregroundStyle(Brand.muted)
        }
    }
}

/// A small line of a figure's days, no axes: the shape of the period, beside its label.
struct DashboardSparkline: View {
    let values: [Double]
    let color: Color

    var body: some View {
        Chart(Array(values.enumerated()), id: \.offset) { index, value in
            AreaMark(x: .value("day", index), y: .value("value", value))
                .foregroundStyle(LinearGradient(colors: [color.opacity(0.22), color.opacity(0)], startPoint: .top, endPoint: .bottom))
                .interpolationMethod(.monotone)
            LineMark(x: .value("day", index), y: .value("value", value))
                .foregroundStyle(color)
                .lineStyle(StrokeStyle(lineWidth: 1.75, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .frame(width: 64, height: 26)
        .accessibilityHidden(true)
    }
}

/// One of the four figures (`Kpi`): its icon on a plate of its colour, the
/// label, the sparkline, the figure the card's whole width, how it moved.
struct DashboardFigure: View {
    let label: String
    let value: String
    let change: Double?
    let days: Int
    let series: [Double]
    let color: Color
    let symbol: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: 30, height: 30)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(color.opacity(0.09)))
                    .accessibilityHidden(true)
                Text(label).font(.inter(12, .semibold)).foregroundStyle(Brand.muted).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }
            Text(value)
                .font(.inter(20, .heavy))
                .foregroundStyle(Brand.navy)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .monospacedDigit()
            HStack(alignment: .bottom, spacing: 4) {
                DashboardChange(change: change, days: days)
                Spacer(minLength: 0)
            }
            DashboardSparkline(values: series, color: color)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .portalSurface(cornerRadius: 18)
        .accessibilityElement(children: .combine)
    }
}

/// The four figures, two by two.
struct DashboardFigures: View {
    let board: PortalDashboard
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let totals = board.totals
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            DashboardFigure(label: l.t("dashboard.sales"), value: totals.sales.current.formatted(l.current), change: totals.sales.change, days: board.range,
                            series: board.days.map { Double($0.sales.fils) / 1000 }, color: PortalLook.series[0], symbol: "banknote")
            DashboardFigure(label: l.t("dashboard.orders"), value: "\(totals.orders.current)", change: totals.orders.change, days: board.range,
                            series: board.days.map { Double($0.orders) }, color: PortalLook.series[2], symbol: "list.bullet.rectangle.portrait")
            DashboardFigure(label: l.t("dashboard.averageOrder"), value: totals.orders.current > 0 ? totals.averageOrder.current.formatted(l.current) : "—",
                            change: totals.averageOrder.change, days: board.range,
                            series: board.days.map { Double($0.averageOrder.fils) / 1000 }, color: PortalLook.series[1], symbol: "bag")
            DashboardFigure(label: l.t("dashboard.customers"), value: "\(totals.customers.current)", change: totals.customers.change, days: board.range,
                            series: board.days.map { Double($0.customers) }, color: PortalLook.series[4], symbol: "person.2")
        }
    }
}

/// The sales line (`TrendPanel`): this period in indigo over its gradient, the
/// period before in grey on the same axis, the next seven days dashed after it.
/// A tap on the chart shows that day; "Show as a table" lists every figure.
struct DashboardTrend: View {
    let board: PortalDashboard
    @State private var table = false
    @State private var selected: Int?
    @State private var drawn = false
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct Mark: Identifiable {
        let index: Int
        let day: String
        let value: Double
        let series: String
        var id: String { "\(series)-\(index)" }
    }

    private var current: [Mark] {
        board.days.enumerated().map { Mark(index: $0.offset, day: $0.element.day, value: Double($0.element.sales.fils) / 1000, series: "current") }
    }

    private var before: [Mark] {
        board.previousDays.enumerated().map { Mark(index: $0.offset, day: $0.element.day, value: Double($0.element.sales.fils) / 1000, series: "before") }
    }

    /// The estimate starts from today's figure, so the dashed line carries on from the solid one.
    private var ahead: [Mark] {
        let start = board.days.count - 1
        let today = current.last.map { [Mark(index: start, day: $0.day, value: $0.value, series: "forecast")] } ?? []
        return today + board.forecast.enumerated().map { Mark(index: start + 1 + $0.offset, day: $0.element.day, value: Double($0.element.sales.fils) / 1000, series: "forecast") }
    }

    var body: some View {
        DashboardPanel(title: l.t("dashboard.trendTitle"), note: l.t("dashboard.trendNote")) {
            Button {
                table.toggle()
            } label: {
                Text(table ? l.t("dashboard.showChart") : l.t("dashboard.showTable"))
            }
            .buttonStyle(PortalSmallButtonStyle())
        } content: {
            if table {
                tableView
            } else {
                legend
                chart
            }
            Text(l.t("dashboard.forecastNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var legend: some View {
        HStack(spacing: 14) {
            key(l.t("dashboard.seriesThis"), PortalLook.series[0], dashed: false)
            key(l.t("dashboard.seriesBefore"), PortalLook.previous, dashed: false)
            key(l.t("dashboard.seriesForecast"), PortalLook.series[0], dashed: true)
        }
        .font(.inter(12, .semibold))
        .foregroundStyle(Brand.body)
        .accessibilityHidden(true)
    }

    private func key(_ text: String, _ color: Color, dashed: Bool) -> some View {
        HStack(spacing: 6) {
            Capsule()
                .stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, dash: dashed ? [3, 3] : []))
                .frame(width: 16, height: 2)
            Text(text).lineLimit(1).minimumScaleFactor(0.8)
        }
    }

    private var chart: some View {
        let points = current
        let peak = max((points + before + ahead).map(\.value).max() ?? 0, 1)
        let last = max(points.count + board.forecast.count - 1, 1)
        let summary = l.t("dashboard.chartLabel", ["from": PortalDay.label(board.days.first?.day ?? "", l.current), "to": PortalDay.label(board.days.last?.day ?? "", l.current)])
        let shown = points + Array(ahead.dropFirst())
        let picked: Mark? = selected.flatMap { day in shown.first { $0.index == day } }
        return Chart {
            ForEach(points) { mark in
                AreaMark(x: .value("day", mark.index), yStart: .value("sales", 0.0), yEnd: .value("sales", mark.value))
                    .foregroundStyle(LinearGradient(colors: [PortalLook.series[0].opacity(0.24), PortalLook.series[0].opacity(0.02)], startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.monotone)
            }
            ForEach(before) { mark in
                LineMark(x: .value("day", mark.index), y: .value("sales", mark.value), series: .value("series", "before"))
                    .foregroundStyle(PortalLook.previous)
                    .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
            }
            ForEach(ahead) { mark in
                LineMark(x: .value("day", mark.index), y: .value("sales", mark.value), series: .value("series", "forecast"))
                    .foregroundStyle(PortalLook.series[0].opacity(0.75))
                    .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, dash: [5, 5]))
                    .interpolationMethod(.monotone)
            }
            ForEach(points) { mark in
                LineMark(x: .value("day", mark.index), y: .value("sales", mark.value), series: .value("series", "current"))
                    .foregroundStyle(PortalLook.series[0])
                    .lineStyle(StrokeStyle(lineWidth: 2.25, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
            }
            if let picked {
                RuleMark(x: .value("day", picked.index))
                    .foregroundStyle(Brand.navy.opacity(0.25))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                PointMark(x: .value("day", picked.index), y: .value("sales", picked.value))
                    .foregroundStyle(PortalLook.series[0])
                    .symbolSize(70)
                    .annotation(position: .top, spacing: 6, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                        tip(for: picked)
                    }
            }
        }
        .chartXScale(domain: 0 ... last)
        .chartYScale(domain: 0 ... peak * 1.12)
        // A tap shows a day and a second tap hides it; a drag stays the page's
        // scroll, which a selection gesture on a chart inside it would take.
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle()
                    .fill(Color.clear)
                    .contentShape(Rectangle())
                    .onTapGesture { location in
                        guard let plot = proxy.plotFrame else { return }
                        let x = location.x - geometry[plot].origin.x
                        guard let index = proxy.value(atX: x, as: Int.self) else { return }
                        let day = min(max(index, 0), last)
                        selected = selected == day ? nil : day
                    }
            }
        }
        .chartXAxis {
            AxisMarks(values: [0, points.count / 2, max(points.count - 1, 0)]) { value in
                AxisValueLabel {
                    if let index = value.as(Int.self), index < board.days.count {
                        Text(PortalDay.label(board.days[index].day, l.current)).font(.inter(11)).foregroundStyle(Brand.muted)
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
        .frame(height: 220)
        .opacity(drawn || reduceMotion ? 1 : 0)
        .onAppear {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.5)) { drawn = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary)
        .accessibilityHint(l.t("dashboard.showTable"))
    }

    private func tip(for mark: Mark) -> some View {
        let forecast = mark.index >= board.days.count
        let previous = forecast ? nil : board.previousDays[safe: mark.index]
        return VStack(alignment: .leading, spacing: 3) {
            Text(PortalDay.label(forecast ? board.forecast[safe: mark.index - board.days.count]?.day ?? mark.day : mark.day, l.current))
                .font(.inter(11, .semibold)).foregroundStyle(Brand.muted)
            Text(Money(fils: Int((mark.value * 1000).rounded())).formatted(l.current))
                .font(.inter(13, .bold)).foregroundStyle(Brand.navy)
            if forecast {
                Text(l.t("dashboard.seriesForecast")).font(.inter(11)).foregroundStyle(PortalLook.indigoInk)
            } else {
                if let previous {
                    Text("\(l.t("dashboard.seriesBefore")): \(previous.sales.formatted(l.current))").font(.inter(11)).foregroundStyle(Brand.muted)
                }
                if let day = board.days[safe: mark.index] {
                    Text(l.t("dashboard.ordersOn", ["count": "\(day.orders)"])).font(.inter(11)).foregroundStyle(Brand.muted)
                }
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white).shadow(color: Brand.navy.opacity(0.12), radius: 6, y: 2))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(PortalLook.hairline, lineWidth: 1))
    }

    private var tableView: some View {
        VStack(spacing: 0) {
            HStack {
                Text(l.t("dashboard.columnDay")).frame(maxWidth: .infinity, alignment: .leading)
                Text(l.t("dashboard.columnSales")).frame(maxWidth: .infinity, alignment: .trailing)
                Text(l.t("dashboard.columnBefore")).frame(maxWidth: .infinity, alignment: .trailing)
            }
            .font(.inter(12, .semibold))
            .foregroundStyle(Brand.muted)
            .padding(.vertical, 8)
            ForEach(Array(board.days.enumerated()), id: \.offset) { index, day in
                Divider()
                HStack {
                    Text(PortalDay.label(day.day, l.current)).frame(maxWidth: .infinity, alignment: .leading)
                    Text(day.sales.formatted(l.current)).frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(Brand.navy)
                    Text(board.previousDays[safe: index]?.sales.formatted(l.current) ?? "—").frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(Brand.muted)
                }
                .font(.inter(13))
                .padding(.vertical, 7)
                .accessibilityElement(children: .combine)
            }
            ForEach(board.forecast) { day in
                Divider()
                HStack {
                    Text("\(PortalDay.label(day.day, l.current)) (\(l.t("dashboard.columnEstimate")))").frame(maxWidth: .infinity, alignment: .leading)
                    Text(day.sales.formatted(l.current)).frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(PortalLook.indigoInk)
                    Text("—").frame(maxWidth: .infinity, alignment: .trailing).foregroundStyle(Brand.muted)
                }
                .font(.inter(13))
                .padding(.vertical, 7)
                .background(PortalLook.indigoWash.opacity(0.5))
                .accessibilityElement(children: .combine)
            }
        }
        .monospacedDigit()
    }
}

/// One bar in parts, each its share, with a 2-point gap between them, and the
/// parts listed under it with their figures (`SegmentedBar`).
struct DashboardSegments: View {
    struct Part: Identifiable {
        let id: String
        let label: String
        let value: String
        let percent: Int
        let color: Color
        var symbol: String?
        var symbolInk: Color?
    }

    let label: String
    let parts: [Part]
    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            GeometryReader { proxy in
                let shown = parts.filter { $0.percent > 0 }
                let gaps = CGFloat(max(shown.count - 1, 0)) * 2
                // Each part grows to its width from the leading edge, which is
                // the right on the Arabic page, so the bar fills the way it reads.
                HStack(spacing: 2) {
                    ForEach(shown) { part in
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(part.color)
                            .frame(width: grown || reduceMotion ? max(4, (proxy.size.width - gaps) * CGFloat(part.percent) / 100) : 0)
                    }
                }
                .frame(width: proxy.size.width, alignment: .leading)
            }
            .frame(height: 12)
            .accessibilityHidden(true)
            VStack(spacing: 8) {
                ForEach(parts) { part in
                    HStack(spacing: 8) {
                        if let symbol = part.symbol {
                            Image(systemName: symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(part.symbolInk ?? part.color).frame(width: 16).accessibilityHidden(true)
                        } else {
                            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(part.color).frame(width: 10, height: 10).accessibilityHidden(true)
                        }
                        Text(part.label).font(.inter(13, .semibold)).foregroundStyle(Brand.navy).lineLimit(1).minimumScaleFactor(0.85)
                        Spacer(minLength: 6)
                        Text(part.value).font(.inter(13, .semibold)).foregroundStyle(Brand.navy).monospacedDigit()
                        Text("\(part.percent)%").font(.inter(12)).foregroundStyle(Brand.muted).monospacedDigit().frame(minWidth: 34, alignment: .trailing)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
        .onAppear {
            withAnimation(reduceMotion ? nil : .spring(response: 0.55, dampingFraction: 0.85)) { grown = true }
        }
    }
}

/// Revenue by department (`DepartmentsPanel`), each in the categorical order by its place, never by rank.
struct DashboardDepartments: View {
    let board: PortalDashboard
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        DashboardPanel(title: l.t("dashboard.departmentsTitle"), note: l.t("dashboard.departmentsNote")) {
            if board.departments.isEmpty {
                Text(l.t("dashboard.noSales")).font(.inter(14)).foregroundStyle(Brand.muted)
            } else {
                DashboardSegments(label: l.t("dashboard.departmentsTitle"), parts: board.departments.enumerated().map { index, entry in
                    DashboardSegments.Part(
                        id: entry.other == true ? "other" : entry.slug ?? "unfiled",
                        label: entry.other == true ? l.t("dashboard.otherDepartments") : l.t(DashboardRules.departmentLabel(entry.slug)),
                        value: entry.sales.formatted(l.current),
                        percent: entry.percent,
                        color: PortalLook.series[index % PortalLook.series.count]
                    )
                })
            }
        }
    }
}

/// The shelf's four states (`StockPanel`), the status colours with an icon and a word each.
struct DashboardShelf: View {
    let stock: ShelfHealth
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        DashboardPanel(title: l.t("dashboard.stockTitle"), note: l.t("dashboard.stockNote")) {
            Button {
                app.open(.portal("/admin/stock"))
            } label: {
                HStack(spacing: 3) {
                    Text(l.t("dashboard.openStock"))
                    Image(systemName: "arrow.up.forward").font(.system(size: 10, weight: .bold)).flipsForRightToLeftLayoutDirection(true)
                }
            }
            .buttonStyle(PortalSmallButtonStyle())
        } content: {
            if stock.total == 0 {
                Text(l.t("dashboard.stockNone")).font(.inter(14)).foregroundStyle(Brand.muted)
            } else {
                let percents = DashboardRules.wholePercents(ShelfState.allCases.map(stock.count))
                DashboardSegments(label: l.t("dashboard.stockTitle"), parts: ShelfState.allCases.enumerated().map { index, state in
                    let tone = PortalLook.tone(state)
                    return DashboardSegments.Part(id: state.rawValue, label: l.t(state.label), value: "\(stock.count(state))", percent: percents[index], color: tone.mark, symbol: tone.symbol, symbolInk: tone.ink)
                })
            }
        }
    }
}

/// Customers who bought and accounts opened, per day (`ActivityPanel`).
struct DashboardActivity: View {
    let board: PortalDashboard
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        DashboardPanel(title: l.t("dashboard.activityTitle"), note: l.t("dashboard.activityNote")) {
            VStack(alignment: .leading, spacing: 18) {
                bars(l.t("dashboard.activityCustomers"), total: board.totals.customers.current, values: board.days.map(\.customers), color: PortalLook.series[2])
                if let accounts = board.newAccounts {
                    bars(l.t("dashboard.activityAccounts"), total: accounts.reduce(0) { $0 + $1.count }, values: accounts.map(\.count), color: PortalLook.series[5])
                }
            }
        }
    }

    private func bars(_ title: String, total: Int, values: [Int], color: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                RoundedRectangle(cornerRadius: 3, style: .continuous).fill(color).frame(width: 10, height: 10).accessibilityHidden(true)
                Text(title).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                Spacer()
                Text(l.t("dashboard.activityTotal", ["count": "\(total)"])).font(.inter(12)).foregroundStyle(Brand.muted)
            }
            Chart(Array(values.enumerated()), id: \.offset) { index, value in
                BarMark(x: .value("day", index), y: .value("count", value), width: .ratio(0.7))
                    .foregroundStyle(color)
                    .cornerRadius(2)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .frame(height: 56)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(title): \(l.t("dashboard.activityTotal", ["count": "\(total)"]))")
        }
    }
}

/// What sold most, by takings (`TopPanel`): a place, the title to its editor, a share bar.
struct DashboardTop: View {
    let board: PortalDashboard
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        DashboardPanel(title: l.t("dashboard.topTitle"), note: l.t("dashboard.topNote")) {
            if board.top.isEmpty {
                Text(l.t("dashboard.noSales")).font(.inter(14)).foregroundStyle(Brand.muted)
            } else {
                VStack(spacing: 12) {
                    ForEach(Array(board.top.enumerated()), id: \.offset) { index, entry in
                        row(index, entry)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func row(_ index: Int, _ entry: PortalDashboard.Top) -> some View {
        let face = HStack(spacing: 10) {
            Text("\(index + 1)")
                .font(.inter(12, .bold))
                .foregroundStyle(Brand.navy)
                .frame(width: 28, height: 28)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(PortalLook.ground))
                .environment(\.layoutDirection, .leftToRight)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(entry.title).font(.inter(14, .semibold)).foregroundStyle(Brand.navy).lineLimit(1)
                    Spacer(minLength: 6)
                    Text(entry.sales.formatted(l.current)).font(.inter(14, .bold)).foregroundStyle(Brand.navy).monospacedDigit()
                }
                HStack(spacing: 10) {
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(PortalLook.grid)
                            Capsule().fill(PortalLook.series[0]).frame(width: max(4, proxy.size.width * CGFloat(entry.percent) / 100))
                        }
                    }
                    .frame(height: 6)
                    .accessibilityHidden(true)
                    Text(l.t("dashboard.topUnits", ["count": "\(entry.units)"])).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize()
                }
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        if let id = entry.productId {
            Button { app.open(.portal("/admin/products/\(id)")) } label: { face }.buttonStyle(.tap)
        } else {
            face
        }
    }
}

/// What waits on this person, as one list (`NeedsYou`): each queue named, its
/// count, and the page that clears it; nothing waiting said in a sentence.
struct DashboardNeedsYou: View {
    struct Row: Identifiable {
        let label: String
        let value: Int
        let href: String
        var urgent = true
        var id: String { label }
    }

    let rows: [Row]
    var allClear: String
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        DashboardPanel(title: l.t("admin.needsYou")) {
            if rows.isEmpty {
                PortalAllClear(text: allClear)
            } else {
                VStack(spacing: 2) {
                    ForEach(rows) { row in
                        Button {
                            app.open(.portal(row.href))
                        } label: {
                            HStack(spacing: 10) {
                                Capsule().fill(row.urgent ? Brand.orange : Brand.line).frame(width: 4, height: 26).accessibilityHidden(true)
                                Text(l.t(row.label)).font(.inter(14, .semibold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                                Spacer(minLength: 6)
                                Text("\(row.value)")
                                    .font(.inter(12, .bold))
                                    .foregroundStyle(Color.white)
                                    .padding(.horizontal, 9)
                                    .padding(.vertical, 3)
                                    .background(Capsule().fill(Brand.navy))
                                    .environment(\.layoutDirection, .leftToRight)
                                Image(systemName: "chevron.forward").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.chevron).flipsForRightToLeftLayoutDirection(true)
                            }
                            .padding(.horizontal, 6)
                            .frame(minHeight: 46)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(PressFillStyle(cornerRadius: 12))
                        .disabled(!PortalPage.draws(row.href))
                    }
                }
            }
        }
    }
}

/// The dashboard's shape while it is read, breathing gently, so nothing moves when the figures land.
struct DashboardSkeleton: View {
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 10) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(0 ..< 4, id: \.self) { _ in block(height: 136) }
            }
            block(height: 320)
            block(height: 180)
        }
        .opacity(dim ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { dim = true }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(l.t("admin.loading"))
    }

    private func block(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(PortalLook.shimmer)
            .frame(height: height)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
