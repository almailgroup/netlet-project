import SwiftUI

/// My orders' filter, on the owner's word ("all bar up removed, only add
/// search bar and in the side filter … once you click on filter it will send
/// you to the filter page") — the web's `OrderSearchAndFilter`.
///
/// **The button at the search bar's end** says how many filters are on and
/// opens **the filter page**, the whole screen, which asks two things, each
/// a short row of pills chosen together and applied by "Show orders", with
/// Reset beside it:
///
/// - **Order status**: received, being prepared, shipped, delivered,
///   cancelled — the owner's "pending, received, ready to ship, shipped,
///   delivered" in NetLet's own steps — **then Returns and refunds**, on the
///   owner's word ("add return/refund up and cancel review"): it had a
///   section of its own beside Reviews, which left the page (each item is
///   rated under its photo; an old address naming the reviews still opens
///   them).
/// - **When**: the last 30 days, the last 3 months, or two days of one's own
///   on the system's date pickers; and by year, the newest with "More years"
///   for the ones before it, on the owner's word.
///
/// A pill pressed again is taken off. **No store list, payment or total, on
/// the owner's word** ("he can search by the filter bar for any name — in
/// future maybe he will buy from 100 stores"): the search finds an order by
/// its store's name. Under the bar each filter that is on is a chip with a
/// cross (`OrderFilterTokens`), and Clear all takes them all. The server
/// filters (`orders.list`); the years come back with its answer.
struct OrderFilterButton: View {
    let model: OrdersViewModel
    @Environment(LanguageSettings.self) private var l
    @Environment(AppModel.self) private var app
    @State private var open = false

    var body: some View {
        let count = model.filtersOn
        Button {
            Haptics.tap()
            open = true
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 48, height: 48)
                .background(Circle().fill(count > 0 ? Brand.tint : Brand.surface))
                .overlay(Circle().strokeBorder(count > 0 ? Brand.navy : Brand.line, lineWidth: count > 0 ? 1.5 : 1))
                .overlay(alignment: .topTrailing) {
                    if count > 0 {
                        Text("\(count)")
                            .font(.inter(11, .bold))
                            .foregroundStyle(.white)
                            .frame(minWidth: 20, minHeight: 20)
                            .background(Circle().fill(Brand.navyFill))
                            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                            .offset(x: 4, y: -4)
                            .accessibilityHidden(true)
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 24))
        .accessibilityLabel(l.t("orders.filters"))
        .accessibilityValue(count > 0 ? "\(count)" : "")
        .accessibilityIdentifier("order-filters-button")
        .task {
            // The screenshots' `-NetLetOpen orderFilters`: the page up as My orders opens.
            if app.orderFiltersStart {
                app.orderFiltersStart = false
                open = true
            }
        }
        .fullScreenCover(isPresented: $open) {
            OrderFilterPage(model: model)
                .languageDirection()
                .buttonStyle(HapticDefaultStyle())
        }
    }
}

/// Each filter that is on, as a chip with a cross that takes just that one
/// off, and Clear all — drawn under the search bar only while one is on.
struct OrderFilterTokens: View {
    let model: OrdersViewModel
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let tokens = OrderFilterWords.on(tab: model.tab, filters: model.filters, language: l)
        Group {
            if !tokens.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tokens) { token in
                            Button {
                                Haptics.tap()
                                Task {
                                    switch token.kind {
                                    case .status: await model.clearTab()
                                    case .when: await model.choose { $0.period = "all"; $0.from = nil; $0.to = nil }
                                    }
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: token.symbol)
                                        .font(.system(size: 12, weight: .semibold))
                                        .accessibilityHidden(true)
                                    Text(token.value).lineLimit(1)
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .opacity(0.8)
                                        .accessibilityHidden(true)
                                }
                                .font(.inter(13, .semibold))
                                .foregroundStyle(.white)
                                .padding(.leading, 12)
                                .padding(.trailing, 10)
                                .frame(minHeight: 36)
                                .background(Capsule().fill(Brand.navyFill))
                                .contentShape(Capsule())
                            }
                            .buttonStyle(SpringPressStyle(cornerRadius: 18))
                            .accessibilityLabel(l.t("orders.removeFilter", ["name": token.value]))
                        }
                        Button {
                            Haptics.tap()
                            Task { await model.clearChips() }
                        } label: {
                            Text(l.t("orders.clearAll"))
                                .font(.inter(13, .bold))
                                .foregroundStyle(Brand.accentInk)
                                .padding(.horizontal, 10)
                                .frame(minHeight: 36)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.tap)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 2)
                }
                .glassRow()
                .padding(.horizontal, -16)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(l.t("orders.filtersOnLabel"))
                .accessibilityIdentifier("order-filter-tokens")
            }
        }
        .animation(.snappy(duration: 0.25), value: tokens.map(\.id))
    }
}

/// A filter that is on, as the chip that takes it off.
struct OrderFilterToken: Identifiable {
    enum Kind: String { case status, when }
    let kind: Kind
    let symbol: String
    let value: String
    var id: String { kind.rawValue + ":" + value }
}

/// The words each chip and choice is said in — the web's labels, from the dictionary.
@MainActor
enum OrderFilterWords {
    static var statuses: [String] { ReferenceData.shared.rules.orders?.filterStatuses ?? ["received", "preparing", "onTheWay", "delivered", "cancelled"] }
    static var dates: [String] { ReferenceData.shared.rules.orders?.filterDates ?? ["30", "90"] }
    static var lists: [String] { ReferenceData.shared.rules.orders?.filterLists ?? ["returns"] }

    /// A status's or a list's words: the order row's own phrase for the first
    /// two steps, the old tabs' for the rest.
    static func status(_ tab: String, _ l: LanguageSettings) -> String {
        switch tab {
        case "received": return l.t("orders.progressReceived")
        case "preparing": return l.t("orders.progressPreparing")
        case "processing": return l.t("orders.viewProcessing")
        case "onTheWay": return l.t("orders.viewOnTheWay")
        case "delivered": return l.t("orders.viewDelivered")
        case "cancelled": return l.t("orders.viewCancelled")
        case "returns": return l.t("orders.viewReturns")
        case "reviews": return l.t("orders.viewReviews")
        default: return l.t("orders.viewAll")
        }
    }

    static func period(_ period: String, _ l: LanguageSettings) -> String? {
        switch period {
        case "30": return l.t("orders.period30")
        case "90": return l.t("orders.period90")
        default: return nil
        }
    }

    /// Each filter that is on: the status or list, then the date.
    static func on(tab: String, filters: OrderFilters, language l: LanguageSettings) -> [OrderFilterToken] {
        var tokens: [OrderFilterToken] = []
        if tab != "all" {
            let symbol = tab == "returns" ? "arrow.uturn.backward" : tab == "reviews" ? "star" : "checklist"
            tokens.append(.init(kind: .status, symbol: symbol, value: status(tab, l)))
        }
        if let when = when(filters, l) {
            tokens.append(.init(kind: .when, symbol: "calendar", value: when))
        }
        return tokens
    }

    /// What the date chip says: a period, a year, or the days chosen.
    static func when(_ filters: OrderFilters, _ l: LanguageSettings) -> String? {
        if filters.from != nil || filters.to != nil {
            if let year = OrderFilterRules.yearOfRange(from: filters.from, to: filters.to) { return String(year) }
            let day = { (text: String) in OrderWording.day(text, language: l.current) }
            if let from = filters.from, let to = filters.to { return l.t("orders.whenBetween", ["from": day(from), "to": day(to)]) }
            if let from = filters.from { return l.t("orders.whenSince", ["date": day(from)]) }
            if let to = filters.to { return l.t("orders.whenUntil", ["date": day(to)]) }
        }
        return period(filters.period, l)
    }
}

/// The filter page, the whole screen: its title and Close, every choice in a
/// section of its own, applied together by "Show orders" so somebody choosing
/// a status and a year chooses both before the list moves. Reset empties the
/// draft; nothing changes until Show orders.
private struct OrderFilterPage: View {
    let model: OrdersViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l
    @State private var tab: String
    @State private var period: String
    @State private var from: String?
    @State private var to: String?
    @State private var custom: Bool
    @State private var allYears = false

    init(model: OrdersViewModel) {
        self.model = model
        let filters = model.filters
        // The old Processing and the reviews an old address names are not on
        // the page; opened on either, the page starts on every order.
        _tab = State(initialValue: ["processing", "reviews"].contains(model.tab) ? "all" : model.tab)
        _period = State(initialValue: filters.period)
        _from = State(initialValue: filters.from)
        _to = State(initialValue: filters.to)
        _custom = State(initialValue: (filters.from != nil || filters.to != nil)
            && OrderFilterRules.yearOfRange(from: filters.from, to: filters.to) == nil)
    }

    private var undated: Bool { !custom && from == nil && to == nil }
    private var chosenYear: Int? { custom ? nil : OrderFilterRules.yearOfRange(from: from, to: to) }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(l.t("orders.filtersLabel"))
                    .font(.inter(17, .heavy))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("common.close"))
            }
            .padding(.leading, 20)
            .padding(.trailing, 8)
            .padding(.vertical, 6)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    section(symbol: "checklist", title: l.t("orders.statusTitle")) {
                        FlowLayout(spacing: 8) {
                            ForEach(OrderFilterWords.statuses + OrderFilterWords.lists, id: \.self) { status in
                                pill(OrderFilterWords.status(status, l), chosen: tab == status) { tab = tab == status ? "all" : status }
                            }
                        }
                    }
                    section(symbol: "calendar", title: l.t("orders.whenTitle"), last: true) { whenChoices }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
            }
            .accessibilityIdentifier("order-filter-page")
            Divider()
            HStack(spacing: 12) {
                Button {
                    Haptics.tap()
                    withAnimation(.snappy(duration: 0.2)) {
                        tab = "all"
                        period = "all"
                        from = nil
                        to = nil
                        custom = false
                    }
                } label: {
                    Text(l.t("orders.reset"))
                        .font(.inter(15, .bold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 20)
                        .frame(minHeight: 48)
                        .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.tap)
                Button {
                    Haptics.tap()
                    let chosen = (tab: tab, period: period, from: from, to: to)
                    Task { await model.apply(tab: chosen.tab, period: chosen.period, from: chosen.from, to: chosen.to) }
                    dismiss()
                } label: {
                    Text(l.t("orders.whenApply"))
                        .font(.inter(15, .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .liquidGlass(.navy)
                }
                .buttonStyle(SpringPressStyle(cornerRadius: 24))
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(Brand.surface.ignoresSafeArea())
    }

    private var whenChoices: some View {
        let years = model.facets?.years ?? []
        let shown = shownYears(years)
        return VStack(alignment: .leading, spacing: 0) {
            FlowLayout(spacing: 8) {
                ForEach(OrderFilterWords.dates, id: \.self) { each in
                    if let words = OrderFilterWords.period(each, l) {
                        pill(words, chosen: undated && period == each) {
                            if undated && period == each {
                                period = "all"
                            } else {
                                period = each
                                from = nil
                                to = nil
                                custom = false
                            }
                        }
                    }
                }
                pill(l.t("orders.whenChoose"), chosen: custom) {
                    if custom {
                        custom = false
                        from = nil
                        to = nil
                    } else {
                        // Opens on the last 30 days, which the pickers then move.
                        let today = OrderFilterRules.today
                        period = "all"
                        to = today
                        from = StoreRules.kuwaitDay(OrderCustomDays.date(today).addingTimeInterval(-30 * 86_400))
                        custom = true
                    }
                }
            }
            if custom {
                OrderCustomDays(from: $from, to: $to, firstDay: model.facets?.firstDay)
                    .padding(.top, 16)
                    .transition(.opacity)
            }
            if !years.isEmpty {
                Text(l.t("orders.whenYears"))
                    .font(.inter(13, .bold))
                    .foregroundStyle(JourneyStreet.passed)
                    .padding(.top, 16)
                    .accessibilityAddTraits(.isHeader)
                FlowLayout(spacing: 8) {
                    ForEach(shown, id: \.self) { year in
                        pill(String(year), chosen: chosenYear == year) {
                            if chosenYear == year {
                                from = nil
                                to = nil
                            } else {
                                let whole = OrderFilterRules.yearRange(year)
                                period = "all"
                                from = whole.from
                                to = whole.to
                                custom = false
                            }
                        }
                    }
                    if !allYears && years.count > 1 {
                        Button {
                            Haptics.tap()
                            withAnimation(.snappy(duration: 0.2)) { allYears = true }
                        } label: {
                            HStack(spacing: 4) {
                                Text(l.t("orders.moreYears"))
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 11, weight: .bold))
                                    .accessibilityHidden(true)
                            }
                            .font(.inter(14, .bold))
                            .foregroundStyle(Brand.accentInk)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.tap)
                        .accessibilityIdentifier("order-more-years")
                    }
                }
                .padding(.top, 8)
            }
        }
    }

    /// The newest year, and the rest behind More (the owner's "2026, then a
    /// more icon") — with a year chosen earlier kept in view beside it.
    private func shownYears(_ years: [Int]) -> [Int] {
        if allYears { return years }
        var shown: [Int] = Array(years.prefix(1))
        if let chosen = chosenYear, !shown.contains(chosen) { shown.append(chosen) }
        return shown
    }

    /// One section: its icon and name, then its pills.
    private func section<Content: View>(symbol: String, title: String, last: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Brand.tint))
                    .accessibilityHidden(true)
                Text(title)
                    .font(.inter(15, .heavy))
                    .foregroundStyle(Brand.navy)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            content()
        }
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(Brand.cardLine).frame(height: 1) }
        }
    }

    /// A choice as a pill: navy-rimmed with a tick once chosen; pressed again, taken off.
    private func pill(_ title: String, chosen: Bool, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            withAnimation(.snappy(duration: 0.2)) { action() }
        } label: {
            HStack(spacing: 6) {
                if chosen {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .black))
                        .accessibilityHidden(true)
                }
                Text(title).lineLimit(1)
            }
            .font(.inter(14, chosen ? .bold : .semibold))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(Capsule().fill(chosen ? Brand.tint : Brand.surface))
            .overlay(Capsule().strokeBorder(chosen ? Brand.navy : Brand.line, lineWidth: chosen ? 1.5 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

/// Two days of one's own on the system's date pickers, held to Kuwait's
/// calendar: From is no earlier than the first order's day and no later than
/// To, To no earlier than From and no later than today — so the two can never
/// be the wrong way round, and nothing needs saying under them. They write
/// the page's draft as they turn; "Show orders" applies it with the rest.
private struct OrderCustomDays: View {
    @Binding var from: String?
    @Binding var to: String?
    let firstDay: String?
    @Environment(LanguageSettings.self) private var l

    private var latest: Date { Self.date(OrderFilterRules.today) }
    private var earliest: Date {
        let first = firstDay.flatMap { OrderFilterRules.isCalendarDay($0) ? Self.date($0) : nil } ?? latest.addingTimeInterval(-365 * 86_400)
        return min(first, latest)
    }
    private var end: Binding<Date> {
        Binding(
            get: { min(max(to.flatMap { OrderFilterRules.isCalendarDay($0) ? Self.date($0) : nil } ?? latest, earliest), latest) },
            set: { to = StoreRules.kuwaitDay($0) }
        )
    }
    private var start: Binding<Date> {
        Binding(
            get: { min(max(from.flatMap { OrderFilterRules.isCalendarDay($0) ? Self.date($0) : nil } ?? earliest, earliest), end.wrappedValue) },
            set: { from = StoreRules.kuwaitDay($0) }
        )
    }

    /// Noon in Kuwait on a day, so no time zone moves it to the day before.
    static func date(_ day: String) -> Date {
        KeptFormatters.date(from: day + " 12:00", key: "orderFilterDay") {
            let reader = DateFormatter()
            reader.calendar = Calendar(identifier: .gregorian)
            reader.locale = Locale(identifier: "en_US_POSIX")
            reader.timeZone = TimeZone(identifier: "Asia/Kuwait")
            reader.dateFormat = "yyyy-MM-dd HH:mm"
            return reader
        } ?? Date()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("orders.whenCustomHint"))
                .font(.inter(13))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            DatePicker(l.t("orders.whenFrom"), selection: start, in: earliest...max(earliest, end.wrappedValue), displayedComponents: .date)
                .tint(Brand.control)
                .font(.inter(15, .semibold))
                .foregroundStyle(JourneyStreet.passed)
                .kuwaitDays()
            DatePicker(l.t("orders.whenTo"), selection: end, in: min(start.wrappedValue, latest)...latest, displayedComponents: .date)
                .tint(Brand.control)
                .font(.inter(15, .semibold))
                .foregroundStyle(JourneyStreet.passed)
                .kuwaitDays()
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(light: 0xF7F9FC, dark: 0x1A283D)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .environment(\.locale, l.current.locale)
    }
}
