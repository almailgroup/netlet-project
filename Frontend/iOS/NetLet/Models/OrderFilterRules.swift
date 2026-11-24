import Foundation

/// My orders' chips — `orderFilters.ts` in Swift where the app has to know
/// what a choice is before it asks: whether two days make a year, which days
/// are this month and last, and how many chips narrow the list. Tested on the
/// TypeScript's own cases (`OrderFilterRulesTests`). What an order matches is
/// the server's alone.
enum OrderFilterRules {
    /// One of the shop's days, as a date box sends it: "2026-02-30" is not one.
    static func isCalendarDay(_ value: String?) -> Bool {
        guard let value, value.count == 10, value.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil else { return false }
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
        guard let date = calendar.date(from: components) else { return false }
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        return back.year == parts[0] && back.month == parts[1] && back.day == parts[2]
    }

    /// A year's first and last day, which is how a year is chosen.
    static func yearRange(_ year: Int) -> (from: String, to: String) {
        (String(format: "%04d-01-01", year), String(format: "%04d-12-31", year))
    }

    /// The year two days are exactly, or nil: how the chip knows to say "2025".
    static func yearOfRange(from: String?, to: String?) -> Int? {
        guard isCalendarDay(from), isCalendarDay(to), let from, let to, let year = Int(from.prefix(4)) else { return nil }
        let whole = yearRange(year)
        return from == whole.from && to == whole.to ? year : nil
    }

    /// This month's and last month's first and last day, from today's Kuwaiti day.
    static func monthRanges(today: String) -> (thisMonth: (from: String, to: String), lastMonth: (from: String, to: String)) {
        let year = Int(today.prefix(4)) ?? 2026
        let month = Int(today.dropFirst(5).prefix(2)) ?? 1
        let lastYear = month == 1 ? year - 1 : year
        let lastMonth = month == 1 ? 12 : month - 1
        func span(_ y: Int, _ m: Int) -> (from: String, to: String) {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC")!
            let first = calendar.date(from: DateComponents(year: y, month: m, day: 1)) ?? Date()
            let days = calendar.range(of: .day, in: .month, for: first)?.count ?? 30
            return (String(format: "%04d-%02d-01", y, m), String(format: "%04d-%02d-%02d", y, m, days))
        }
        return (span(year, month), span(lastYear, lastMonth))
    }

    /// How many filters narrow the list — a status, the date counting once, the order of the list never.
    static func narrowingCount(_ filters: OrderFilters) -> Int {
        let dated = filters.period != "all" || isCalendarDay(filters.from) || isCalendarDay(filters.to)
        return (filters.view != "all" ? 1 : 0)
            + (dated ? 1 : 0)
            + (filters.store != nil ? 1 : 0)
            + (filters.payment != "all" ? 1 : 0)
            + (filters.total != "all" ? 1 : 0)
    }

    /// Today as the shop counts days.
    static var today: String { StoreRules.kuwaitDay(Date()) }
}
