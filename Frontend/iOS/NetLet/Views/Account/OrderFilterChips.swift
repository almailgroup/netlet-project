import SwiftUI

/// The chips under My orders' tabs, on the owner's word ("a filter option at
/// the top of the my order page in which the user can set custom dates … give
/// the user as many options as you can, but keep it as user friendly as
/// possible"), the web's `OrderFilterChips`: When, Store, Payment, Total and
/// Sort, each naming what it holds once something is chosen and keeping a navy
/// rim then, each opening a short sheet of its own where a press applies a
/// choice and puts the sheet away. When has the periods, this month and last,
/// every year the shopper ordered in, and two days of their own on the
/// system's date pickers, held to Kuwait's days, from the first order's day to
/// today. Clear all ends the row while anything is chosen. The server filters
/// (`orders.list`); the choices come back with its answer.
struct OrderFilterChips: View {
    let model: OrdersViewModel
    @Environment(LanguageSettings.self) private var l
    @State private var open: OrderFilterGroup?

    var body: some View {
        let filters = model.filters
        ScrollView(.horizontal, showsIndicators: false) {
            GlassGroup {
                HStack(spacing: 8) {
                    ForEach(groups) { group in
                        chip(group, value: OrderFilterWords.value(of: group, filters: filters, facets: model.facets, language: l))
                    }
                    if model.chipsNarrow || filters.sort != "newest" {
                        Button {
                            Haptics.tap()
                            Task { await model.clearChips() }
                        } label: {
                            Label(l.t("orders.clearAll"), systemImage: "xmark")
                                .font(.inter(14, .bold))
                                .foregroundStyle(Brand.accentInk)
                                .padding(.horizontal, 10)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.tap)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
        }
        .glassRow()
        .padding(.horizontal, -16)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("orders.filtersLabel"))
        .accessibilityIdentifier("order-filter-chips")
        .sheet(item: $open) { group in
            OrderFilterSheet(group: group, model: model)
                .presentationDetents(group == .when ? [.large] : [.medium, .large])
                .presentationDragIndicator(.visible)
                .languageDirection()
                .buttonStyle(HapticDefaultStyle())
        }
    }

    /// A store chip only when the shopper has bought from more than one, or one is chosen.
    private var groups: [OrderFilterGroup] {
        OrderFilterGroup.allCases.filter { group in
            group != .store || (model.facets?.stores.count ?? 0) > 1 || model.filters.store != nil
        }
    }

    private func chip(_ group: OrderFilterGroup, value: String?) -> some View {
        let on = value != nil
        let name = l.t(group.chipKey)
        return Button {
            Haptics.tap()
            open = group
        } label: {
            HStack(spacing: 8) {
                Image(systemName: group.symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .accessibilityHidden(true)
                Text(value ?? name).lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Brand.muted)
                    .accessibilityHidden(true)
            }
            .font(.inter(14, on ? .bold : .semibold))
            .foregroundStyle(Brand.navy)
            .padding(.leading, 14)
            .padding(.trailing, 12)
            .frame(minHeight: 44)
            .liquidGlass(.clear)
            .overlay(Capsule().strokeBorder(Brand.navy, lineWidth: 1.5).opacity(on ? 1 : 0))
        }
        .buttonStyle(SpringPressStyle(cornerRadius: 22))
        // Its name first and then what it holds, so voice control can say what it sees.
        .accessibilityLabel(value.map { "\(name), \($0)" } ?? name)
    }
}

/// The chips, in the web's order.
enum OrderFilterGroup: String, CaseIterable, Identifiable {
    case when, store, payment, total, sort

    var id: String { rawValue }

    var chipKey: String {
        switch self {
        case .when: return "orders.chipWhen"
        case .store: return "orders.chipStore"
        case .payment: return "orders.chipPayment"
        case .total: return "orders.chipTotal"
        case .sort: return "orders.chipSort"
        }
    }

    var titleKey: String {
        switch self {
        case .when: return "orders.whenTitle"
        case .store: return "orders.storeTitle"
        case .payment: return "orders.paymentTitle"
        case .total: return "orders.totalTitle"
        case .sort: return "orders.sortTitle"
        }
    }

    var symbol: String {
        switch self {
        case .when: return "calendar"
        case .store: return "storefront"
        case .payment: return "wallet.bifold"
        case .total: return "dollarsign.circle"
        case .sort: return "arrow.up.arrow.down"
        }
    }
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

    /// What a chip says once something in it is chosen, or nil.
    static func value(of group: OrderFilterGroup, filters: OrderFilters, facets: OrderFacets?, language l: LanguageSettings) -> String? {
        switch group {
        case .when: return when(filters, l)
        case .store:
            guard let id = filters.store else { return nil }
            return facets?.stores.first { $0.id == id }.map { storeName($0, l) } ?? l.t("orders.storeGone")
        case .payment: return filters.payment == "all" ? nil : payment(filters.payment, l)
        case .total: return filters.total == "all" ? nil : total(filters.total, l)
        case .sort: return filters.sort == "newest" ? nil : sort(filters.sort, l)
        }
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

/// One chip's choices. A press applies it and puts the sheet away; the days
/// of one's own wait for "Show orders", since two pickers are set one at a time.
private struct OrderFilterSheet: View {
    let group: OrderFilterGroup
    let model: OrdersViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(l.t(group.titleKey))
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
                    switch group {
                    case .when: whenChoices
                    case .store:
                        row(l.t("orders.storeAny"), chosen: model.filters.store == nil) { $0.store = nil }
                        ForEach(model.facets?.stores ?? []) { store in
                            row(OrderFilterWords.storeName(store, l), count: store.count, chosen: model.filters.store == store.id) { $0.store = store.id }
                        }
                    case .payment:
                        ForEach(OrderFilterWords.payments, id: \.self) { payment in
                            row(OrderFilterWords.payment(payment, l), chosen: model.filters.payment == payment) { $0.payment = payment }
                        }
                    case .total:
                        ForEach(OrderFilterWords.totals, id: \.self) { band in
                            row(OrderFilterWords.total(band, l), chosen: model.filters.total == band) { $0.total = band }
                        }
                    case .sort:
                        ForEach(OrderFilterWords.sorts, id: \.self) { sort in
                            row(OrderFilterWords.sort(sort, l), chosen: model.filters.sort == sort) { $0.sort = sort }
                        }
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .background(Brand.ground.ignoresSafeArea())
    }

    /// A choice: pressed, it is the list's at once and the sheet goes.
    private func row(_ title: String, count: Int? = nil, chosen: Bool, change: @escaping (inout OrderFilters) -> Void) -> some View {
        Button {
            Task { await model.choose(change) }
            dismiss()
        } label: {
            HStack(spacing: 12) {
                Text(title)
                    .font(.inter(16, chosen ? .bold : .medium))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let count {
                    Text("\(count)")
                        .font(.inter(13, .semibold))
                        .foregroundStyle(Brand.muted)
                }
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

    private var whenChoices: some View {
        let filters = model.filters
        let months = OrderFilterRules.monthRanges(today: OrderFilterRules.today)
        let year = OrderFilterRules.yearOfRange(from: filters.from, to: filters.to)
        let undated = filters.from == nil && filters.to == nil
        let thisMonth = filters.from == months.thisMonth.from && filters.to == months.thisMonth.to
        let lastMonth = filters.from == months.lastMonth.from && filters.to == months.lastMonth.to
        return VStack(alignment: .leading, spacing: 0) {
            FlowLayout(spacing: 8) {
                ForEach(OrderFilterWords.periods, id: \.self) { period in
                    pill(OrderFilterWords.period(period, l), chosen: undated && filters.period == period) {
                        $0.period = period
                        $0.from = nil
                        $0.to = nil
                    }
                }
                pill(l.t("orders.whenThisMonth"), chosen: thisMonth) {
                    $0.period = "all"
                    $0.from = months.thisMonth.from
                    $0.to = months.thisMonth.to
                }
                pill(l.t("orders.whenLastMonth"), chosen: lastMonth) {
                    $0.period = "all"
                    $0.from = months.lastMonth.from
                    $0.to = months.lastMonth.to
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            if let years = model.facets?.years, !years.isEmpty {
                Text(l.t("orders.whenYears"))
                    .font(.inter(13, .bold))
                    .foregroundStyle(JourneyStreet.passed)
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .accessibilityAddTraits(.isHeader)
                FlowLayout(spacing: 8) {
                    ForEach(years, id: \.self) { each in
                        pill(String(each), chosen: year == each) {
                            let whole = OrderFilterRules.yearRange(each)
                            $0.period = "all"
                            $0.from = whole.from
                            $0.to = whole.to
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
            }
            OrderCustomDays(
                from: thisMonth || lastMonth || year != nil ? nil : filters.from,
                to: thisMonth || lastMonth || year != nil ? nil : filters.to,
                firstDay: model.facets?.firstDay
            ) { from, to in
                Task {
                    await model.choose {
                        $0.period = "all"
                        $0.from = from
                        $0.to = to
                    }
                }
                dismiss()
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
        }
    }

    private func pill(_ title: String, chosen: Bool, change: @escaping (inout OrderFilters) -> Void) -> some View {
        Button {
            Task { await model.choose(change) }
            dismiss()
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
            .background(Capsule().fill(chosen ? Brand.tint : Color.white))
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
/// be the wrong way round, and nothing needs saying under them.
private struct OrderCustomDays: View {
    let apply: (String, String) -> Void
    @Environment(LanguageSettings.self) private var l
    @State private var start: Date
    @State private var end: Date
    private let earliest: Date
    private let latest: Date

    init(from: String?, to: String?, firstDay: String?, apply: @escaping (String, String) -> Void) {
        self.apply = apply
        let today = OrderCustomDays.date(OrderFilterRules.today)
        let first = firstDay.flatMap { OrderFilterRules.isCalendarDay($0) ? OrderCustomDays.date($0) : nil } ?? today.addingTimeInterval(-365 * 86_400)
        earliest = min(first, today)
        latest = today
        let chosenEnd = to.flatMap { OrderFilterRules.isCalendarDay($0) ? OrderCustomDays.date($0) : nil } ?? today
        let chosenStart = from.flatMap { OrderFilterRules.isCalendarDay($0) ? OrderCustomDays.date($0) : nil } ?? max(earliest, chosenEnd.addingTimeInterval(-30 * 86_400))
        _start = State(initialValue: min(max(chosenStart, earliest), chosenEnd))
        _end = State(initialValue: min(max(chosenEnd, earliest), today))
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
            Text(l.t("orders.whenCustom"))
                .font(.inter(15, .bold))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            DatePicker(l.t("orders.whenFrom"), selection: $start, in: earliest...max(earliest, end), displayedComponents: .date)
                .font(.inter(15, .semibold))
                .foregroundStyle(JourneyStreet.passed)
                .kuwaitDays()
            DatePicker(l.t("orders.whenTo"), selection: $end, in: min(start, latest)...latest, displayedComponents: .date)
                .font(.inter(15, .semibold))
                .foregroundStyle(JourneyStreet.passed)
                .kuwaitDays()
            Button {
                Haptics.tap()
                apply(StoreRules.kuwaitDay(start), StoreRules.kuwaitDay(end))
            } label: {
                Text(l.t("orders.whenApply"))
                    .font(.inter(15, .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .liquidGlass(.navy)
            }
            .buttonStyle(SpringPressStyle(cornerRadius: 24))
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(red: 247 / 255, green: 249 / 255, blue: 252 / 255)))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .environment(\.locale, l.current.locale)
    }
}
