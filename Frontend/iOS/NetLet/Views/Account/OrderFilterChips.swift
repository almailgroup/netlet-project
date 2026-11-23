import SwiftUI

/// The filters under My orders' tabs, on the owner's word ("a filter option
/// at the top of the my order page in which the user can set custom dates …
/// give the user as many options as you can, but keep it as user friendly as
/// possible") — **organised, on the owner's word** ("organize the filter
/// options for the my orders page, make it better and enhanced"), the web's
/// `OrderFilterChips`.
///
/// Two buttons: **Filters**, with how many are on, and **Sort**, naming the
/// order the list is in. Filters opens one sheet with every choice in its own
/// section — the date, the store (once there is more than one), how it was
/// paid and the total — chosen as pills and applied together by "Show
/// orders", with Reset beside it. The date has the periods, this month and
/// last, every year the shopper ordered in, and "Choose dates" for two days of
/// their own on the system's date pickers, held to Kuwait's days. Sort is a
/// short list where a press applies at once. Under the two, each filter that
/// is on is a chip with a cross that takes just that one off, and Clear all
/// takes them all. The server filters (`orders.list`); the choices come back
/// with its answer.
struct OrderFilterChips: View {
    let model: OrdersViewModel
    @Environment(LanguageSettings.self) private var l
    @Environment(AppModel.self) private var app
    @State private var open: OrderFilterSheetKind?

    var body: some View {
        let filters = model.filters
        let count = OrderFilterRules.narrowingCount(filters)
        let tokens = OrderFilterWords.on(filters, facets: model.facets, language: l)
        VStack(alignment: .leading, spacing: 8) {
            GlassGroup {
                HStack(spacing: 8) {
                    bar(symbol: "slider.horizontal.3", text: l.t("orders.filters"), on: count > 0, count: count) {
                        open = .filters
                    }
                    .accessibilityLabel(l.t("orders.filters"))
                    .accessibilityValue(count > 0 ? "\(count)" : "")
                    .accessibilityIdentifier("order-filters-button")
                    bar(symbol: "arrow.up.arrow.down", text: OrderFilterWords.sort(filters.sort, l), on: filters.sort != "newest", chevron: true) {
                        open = .sort
                    }
                    // Its name first and then what it holds, so voice control can say what it sees.
                    .accessibilityLabel("\(l.t("orders.chipSort")), \(OrderFilterWords.sort(filters.sort, l))")
                    .accessibilityIdentifier("order-sort-button")
                }
            }
            if !tokens.isEmpty || filters.sort != "newest" {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(tokens) { token in
                            Button {
                                Haptics.tap()
                                Task { await model.choose(token.clear) }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: token.section.symbol)
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
                                .background(Capsule().fill(Brand.navy))
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
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("orders.filtersLabel"))
        .accessibilityIdentifier("order-filter-chips")
        .animation(.snappy(duration: 0.25), value: tokens.map(\.id))
        .task {
            // The screenshots' `-NetLetOpen orderFilters`: the sheet up as the page opens.
            if app.orderFiltersStart {
                app.orderFiltersStart = false
                open = .filters
            }
        }
        .sheet(item: $open) { kind in
            Group {
                switch kind {
                case .filters: OrderFiltersSheet(model: model)
                case .sort: OrderSortSheet(model: model)
                }
            }
            .presentationDetents(kind == .filters ? [.large] : [.medium])
            .presentationDragIndicator(.visible)
            .languageDirection()
            .buttonStyle(HapticDefaultStyle())
        }
    }

    /// One of the two buttons over the list: navy-rimmed while it narrows or orders the list.
    private func bar(symbol: String, text: String, on: Bool, count: Int = 0, chevron: Bool = false, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .accessibilityHidden(true)
                Text(text).lineLimit(1).minimumScaleFactor(0.85)
                if count > 0 {
                    Text("\(count)")
                        .font(.inter(12, .bold))
                        .foregroundStyle(.white)
                        .frame(minWidth: 20, minHeight: 20)
                        .background(Circle().fill(Brand.navy))
                        .accessibilityHidden(true)
                }
                if chevron {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Brand.muted)
                        .accessibilityHidden(true)
                }
            }
            .font(.inter(14, on ? .bold : .semibold))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 44)
            .liquidGlass(.clear)
            .overlay(Capsule().strokeBorder(Brand.navy, lineWidth: 1.5).opacity(on ? 1 : 0))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 22))
    }
}

/// Which sheet the bar opened.
enum OrderFilterSheetKind: String, Identifiable {
    case filters, sort
    var id: String { rawValue }
}

/// The sheet's sections, in the web's order.
enum OrderFilterSection: String, CaseIterable {
    case when, store, payment, total

    var titleKey: String {
        switch self {
        case .when: return "orders.whenTitle"
        case .store: return "orders.storeTitle"
        case .payment: return "orders.paymentTitle"
        case .total: return "orders.totalTitle"
        }
    }

    var symbol: String {
        switch self {
        case .when: return "calendar"
        case .store: return "storefront"
        case .payment: return "wallet.bifold"
        case .total: return "dollarsign.circle"
        }
    }
}

/// A filter that is on, as the chip that takes it off.
struct OrderFilterToken: Identifiable {
    let section: OrderFilterSection
    let value: String
    let clear: (inout OrderFilters) -> Void
    var id: String { section.rawValue + ":" + value }
}

/// The words each chip and choice is said in — the web's labels, from the dictionary.
@MainActor
enum OrderFilterWords {
    static var periods: [String] { ReferenceData.shared.rules.orders?.filterPeriods ?? ["all", "30", "90", "180", "365"] }
    static var payments: [String] { ReferenceData.shared.rules.orders?.filterPayments ?? ["all", "cod", "online"] }
    static var totals: [String] { ReferenceData.shared.rules.orders?.filterTotals ?? ["all", "under10", "10to50", "50to100", "over100"] }
    static var sorts: [String] { ReferenceData.shared.rules.orders?.filterSorts ?? ["newest", "oldest", "highest", "lowest"] }

    static func period(_ period: String, _ l: LanguageSettings) -> String {
        switch period {
        case "30": return l.t("orders.period30")
        case "90": return l.t("orders.period90")
        case "180": return l.t("orders.period180")
        case "365": return l.t("orders.period365")
        default: return l.t("orders.periodAll")
        }
    }

    static func payment(_ payment: String, _ l: LanguageSettings) -> String {
        switch payment {
        case "cod": return l.t("orders.payCash")
        case "online": return l.t("orders.payOnline")
        default: return l.t("orders.payAny")
        }
    }

    static func sort(_ sort: String, _ l: LanguageSettings) -> String {
        switch sort {
        case "oldest": return l.t("orders.sortOldest")
        case "highest": return l.t("orders.sortHighest")
        case "lowest": return l.t("orders.sortLowest")
        default: return l.t("orders.sortNewest")
        }
    }

    /// A band of the total in whole dinars, from the exported bands.
    static func total(_ band: String, _ l: LanguageSettings) -> String {
        guard band != "all" else { return l.t("orders.totalAny") }
        let fallback: [String: (Int?, Int?)] = ["under10": (nil, 10), "10to50": (10, 50), "50to100": (50, 100), "over100": (100, nil)]
        let exported = ReferenceData.shared.rules.orders?.totalBands?[band]
        let low = exported.map { $0.min } ?? fallback[band]?.0
        let high = exported.map { $0.max } ?? fallback[band]?.1
        switch (low, high) {
        case (nil, let high?): return l.t("orders.totalUnder", ["amount": "\(high)"])
        case (let low?, nil): return l.t("orders.totalOver", ["amount": "\(low)"])
        case (let low?, let high?): return l.t("orders.totalBetween", ["low": "\(low)", "high": "\(high)"])
        default: return l.t("orders.totalAny")
        }
    }

    static func storeName(_ store: OrderFacets.Store, _ l: LanguageSettings) -> String {
        if l.current.isRightToLeft, let arabic = store.nameAr, !arabic.isEmpty { return arabic }
        return store.name
    }

    /// Each filter that is on, as a chip of its own: its section, what it
    /// says and the change that takes just that one off.
    static func on(_ filters: OrderFilters, facets: OrderFacets?, language l: LanguageSettings) -> [OrderFilterToken] {
        var tokens: [OrderFilterToken] = []
        if let when = when(filters, l) {
            tokens.append(.init(section: .when, value: when) { $0.period = "all"; $0.from = nil; $0.to = nil })
        }
        if let id = filters.store {
            let name = facets?.stores.first { $0.id == id }.map { storeName($0, l) } ?? l.t("orders.storeGone")
            tokens.append(.init(section: .store, value: name) { $0.store = nil })
        }
        if filters.payment != "all" {
            tokens.append(.init(section: .payment, value: payment(filters.payment, l)) { $0.payment = "all" })
        }
        if filters.total != "all" {
            tokens.append(.init(section: .total, value: total(filters.total, l)) { $0.total = "all" })
        }
        return tokens
    }

    static func when(_ filters: OrderFilters, _ l: LanguageSettings) -> String? {
        if filters.from != nil || filters.to != nil {
            let months = OrderFilterRules.monthRanges(today: OrderFilterRules.today)
            if filters.from == months.thisMonth.from && filters.to == months.thisMonth.to { return l.t("orders.whenThisMonth") }
            if filters.from == months.lastMonth.from && filters.to == months.lastMonth.to { return l.t("orders.whenLastMonth") }
            if let year = OrderFilterRules.yearOfRange(from: filters.from, to: filters.to) { return String(year) }
            let day = { (text: String) in OrderWording.day(text, language: l.current) }
            if let from = filters.from, let to = filters.to { return l.t("orders.whenBetween", ["from": day(from), "to": day(to)]) }
            if let from = filters.from { return l.t("orders.whenSince", ["date": day(from)]) }
            if let to = filters.to { return l.t("orders.whenUntil", ["date": day(to)]) }
        }
        return filters.period == "all" ? nil : period(filters.period, l)
    }
}

/// Every filter in one sheet, a section each, applied together by "Show
/// orders" — so somebody narrowing by a year and a store chooses both before
/// the list moves. Reset empties the draft; nothing changes until Show orders.
private struct OrderFiltersSheet: View {
    let model: OrdersViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l
    @State private var draft: OrderFilters
    @State private var custom: Bool

    init(model: OrdersViewModel) {
        self.model = model
        let filters = model.filters
        _draft = State(initialValue: filters)
        let months = OrderFilterRules.monthRanges(today: OrderFilterRules.today)
        let named = (filters.from == months.thisMonth.from && filters.to == months.thisMonth.to)
            || (filters.from == months.lastMonth.from && filters.to == months.lastMonth.to)
            || OrderFilterRules.yearOfRange(from: filters.from, to: filters.to) != nil
        _custom = State(initialValue: (filters.from != nil || filters.to != nil) && !named)
    }

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
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("common.close"))
            }
            .padding(.leading, 20)
            .padding(.trailing, 8)
            .padding(.top, 12)
            .padding(.bottom, 4)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    section(.when) { whenChoices }
                    if (model.facets?.stores.count ?? 0) > 1 || draft.store != nil {
                        section(.store) {
                            FlowLayout(spacing: 8) {
                                pill(l.t("orders.storeAny"), chosen: draft.store == nil) { draft.store = nil }
                                ForEach(model.facets?.stores ?? []) { store in
                                    pill(OrderFilterWords.storeName(store, l), count: store.count, chosen: draft.store == store.id) { draft.store = store.id }
                                }
                            }
                        }
                    }
                    section(.payment) {
                        FlowLayout(spacing: 8) {
                            ForEach(OrderFilterWords.payments, id: \.self) { payment in
                                pill(OrderFilterWords.payment(payment, l), chosen: draft.payment == payment) { draft.payment = payment }
                            }
                        }
                    }
                    section(.total, last: true) {
                        FlowLayout(spacing: 8) {
                            ForEach(OrderFilterWords.totals, id: \.self) { band in
                                pill(OrderFilterWords.total(band, l), chosen: draft.total == band) { draft.total = band }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
            }
            Divider()
            HStack(spacing: 12) {
                Button {
                    Haptics.tap()
                    draft.period = "all"
                    draft.from = nil
                    draft.to = nil
                    draft.store = nil
                    draft.payment = "all"
                    draft.total = "all"
                    custom = false
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
                    let chosen = draft
                    Task {
                        await model.choose { filters in
                            filters.period = chosen.from != nil || chosen.to != nil ? "all" : chosen.period
                            filters.from = chosen.from
                            filters.to = chosen.to
                            filters.store = chosen.store
                            filters.payment = chosen.payment
                            filters.total = chosen.total
                        }
                    }
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
        .background(Brand.ground.ignoresSafeArea())
    }

    /// One section: its icon and name, then its pills.
    private func section<Content: View>(_ which: OrderFilterSection, last: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: which.symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Brand.tint))
                    .accessibilityHidden(true)
                Text(l.t(which.titleKey))
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

    private var whenChoices: some View {
        let months = OrderFilterRules.monthRanges(today: OrderFilterRules.today)
        let year = custom ? nil : OrderFilterRules.yearOfRange(from: draft.from, to: draft.to)
        let undated = !custom && draft.from == nil && draft.to == nil
        let thisMonth = !custom && draft.from == months.thisMonth.from && draft.to == months.thisMonth.to
        let lastMonth = !custom && draft.from == months.lastMonth.from && draft.to == months.lastMonth.to
        return VStack(alignment: .leading, spacing: 0) {
            FlowLayout(spacing: 8) {
                ForEach(OrderFilterWords.periods, id: \.self) { period in
                    pill(OrderFilterWords.period(period, l), chosen: undated && draft.period == period) {
                        draft.period = period
                        draft.from = nil
                        draft.to = nil
                        custom = false
                    }
                }
                pill(l.t("orders.whenThisMonth"), chosen: thisMonth) { span(months.thisMonth.from, months.thisMonth.to) }
                pill(l.t("orders.whenLastMonth"), chosen: lastMonth) { span(months.lastMonth.from, months.lastMonth.to) }
                pill(l.t("orders.whenChoose"), chosen: custom) {
                    // Opens on the last 30 days, which the pickers then move.
                    if !custom {
                        let today = OrderFilterRules.today
                        draft.period = "all"
                        draft.to = today
                        draft.from = StoreRules.kuwaitDay(OrderCustomDays.date(today).addingTimeInterval(-30 * 86_400))
                        custom = true
                    }
                }
            }
            if let years = model.facets?.years, !years.isEmpty {
                Text(l.t("orders.whenYears"))
                    .font(.inter(13, .bold))
                    .foregroundStyle(JourneyStreet.passed)
                    .padding(.top, 16)
                    .accessibilityAddTraits(.isHeader)
                FlowLayout(spacing: 8) {
                    ForEach(years, id: \.self) { each in
                        pill(String(each), chosen: year == each) {
                            let whole = OrderFilterRules.yearRange(each)
                            span(whole.from, whole.to)
                        }
                    }
                }
                .padding(.top, 8)
            }
            if custom {
                OrderCustomDays(from: $draft.from, to: $draft.to, firstDay: model.facets?.firstDay)
                    .padding(.top, 16)
                    .transition(.opacity)
            }
        }
    }

    private func span(_ from: String, _ to: String) {
        draft.period = "all"
        draft.from = from
        draft.to = to
        custom = false
    }

    /// A choice as a pill: navy-rimmed with a tick once chosen, a count where there is one.
    private func pill(_ title: String, count: Int? = nil, chosen: Bool, action: @escaping () -> Void) -> some View {
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
                if let count {
                    Text("\(count)")
                        .font(.inter(12, .semibold))
                        .foregroundStyle(Brand.muted)
                }
            }
            .font(.inter(14, chosen ? .bold : .semibold))
            .foregroundStyle(Brand.navy)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(Capsule().fill(chosen ? Brand.tint : Color.white))
            .overlay(Capsule().strokeBorder(chosen ? Brand.navy : Brand.line, lineWidth: chosen ? 1.5 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

/// The orders' order, a short list: a press applies it and puts the sheet away.
private struct OrderSortSheet: View {
    let model: OrdersViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(l.t("orders.sortTitle"))
                    .font(.inter(17, .heavy))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(1)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("common.close"))
            }
            .padding(.leading, 20)
            .padding(.trailing, 8)
            .padding(.top, 12)
            .padding(.bottom, 4)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(OrderFilterWords.sorts, id: \.self) { sort in
                        row(OrderFilterWords.sort(sort, l), chosen: model.filters.sort == sort) {
                            Task { await model.choose { $0.sort = sort } }
                            dismiss()
                        }
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .background(Brand.ground.ignoresSafeArea())
    }

    private func row(_ title: String, chosen: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(title)
                    .font(.inter(16, chosen ? .bold : .medium))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ZStack {
                    Circle().strokeBorder(chosen ? Brand.navy : Brand.line, lineWidth: 2)
                    if chosen {
                        Circle().fill(Brand.navy)
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .black))
                            .foregroundStyle(.white)
                    }
                }
                .frame(width: 22, height: 22)
                .accessibilityHidden(true)
            }
            .padding(.horizontal, 20)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }
}

/// Two days of one's own on the system's date pickers, held to Kuwait's
/// calendar: From is no earlier than the first order's day and no later than
/// To, To no earlier than From and no later than today — so the two can never
/// be the wrong way round, and nothing needs saying under them. They write
/// the sheet's draft as they turn; "Show orders" applies it with the rest.
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
            DatePicker(l.t("orders.whenFrom"), selection: start, in: earliest...max(earliest, end.wrappedValue), displayedComponents: .date)
                .font(.inter(15, .semibold))
                .foregroundStyle(JourneyStreet.passed)
                .kuwaitDays()
            DatePicker(l.t("orders.whenTo"), selection: end, in: min(start.wrappedValue, latest)...latest, displayedComponents: .date)
                .font(.inter(15, .semibold))
                .foregroundStyle(JourneyStreet.passed)
                .kuwaitDays()
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(red: 247 / 255, green: 249 / 255, blue: 252 / 255)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .environment(\.locale, l.current.locale)
    }
}
