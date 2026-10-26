import PhotosUI
import UIKit
import SwiftUI

/// Paid placements — the web's `/admin/ads`. A store books a product into a
/// place by the Kuwaiti day against what it has earned; the fee accrues a day
/// at a time and comes off the payout run. A home banner waits for NetLet.
struct PortalAdsView: View {
    @State private var page = 1
    @State private var bookings: PortalPageOf<AdBooking>?
    @State private var waiting: [AdBooking] = []
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: WarehouseRules.Ads { WarehouseRules.shared.ads }

    var body: some View {
        let actor = app.session.seller
        PortalScreen(title: l.t("admin.ads"), intro: l.t(actor?.kind == "admin" ? "ads.noteAdmin" : "ads.noteStore"), refresh: { await load() }) {
            ForEach(rules.slots, id: \.self) { slot in
                PortalCard {
                    Text(l.t(AdWords.slot(slot), ["department": l.t("ads.yourDepartment")])).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                    Text(l.t("ads.rateLine", ["rate": (Money(amount: rules.rates[slot] ?? "0") ?? .zero).formatted(l.current), "places": "\(rules.capacity[slot] ?? 0)"]))
                        .font(.inter(13)).foregroundStyle(Brand.body)
                    if slot == "home_banner" { Text(l.t("ads.bannerRateNote")).font(.inter(12)).foregroundStyle(Brand.muted) }
                }
            }
            if actor?.kind == "vendor" { AdBookForm { Task { await load() } } }
            if actor?.can("product.review") == true && !waiting.isEmpty {
                PortalSectionHeading(title: l.t("ads.bannersWaiting"))
                ForEach(waiting) { booking in BannerReviewCard(booking: booking) { Task { await load() } } }
            }
            PortalSectionHeading(title: l.t("ads.bookings"))
            if let bookings {
                if bookings.rows.isEmpty {
                    PortalEmpty(text: l.t("ads.none"))
                } else {
                    ForEach(bookings.rows) { booking in AdBookingRow(booking: booking, showStore: actor?.kind == "admin") { Task { await load() } } }
                    PortalPager(page: bookings.page, pageSize: bookings.pageSize, total: bookings.total) { next in
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
        .task { await load() }
    }

    private func load() async {
        let api = app.services.api
        if app.session.seller?.can("product.review") == true {
            waiting = (try? await api.call(API.adBookings, .init(page: 1, waiting: true)))?.rows ?? waiting
        }
        do {
            bookings = try await api.call(API.adBookings, .init(page: page))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, bookings == nil { failed = failure }
        }
    }
}

enum AdWords {
    static func slot(_ slot: String) -> String {
        switch slot {
        case "home": return "ads.slotHome"
        case "department": return "ads.slotDepartment"
        default: return "ads.slotBanner"
        }
    }

    static func state(_ state: String) -> String {
        switch state {
        case "upcoming": return "ads.stateUpcoming"
        case "running": return "ads.stateRunning"
        case "cancelled": return "ads.stateCancelled"
        case "inReview": return "ads.stateInReview"
        case "rejected": return "ads.stateRejected"
        default: return "ads.stateEnded"
        }
    }

    static func tone(_ state: String) -> OrderTone {
        switch state {
        case "running": return .done
        case "upcoming": return .shipped
        case "inReview": return .preparing
        case "rejected": return .stopped
        default: return .waiting
        }
    }

    static func permit(_ permit: String) -> String {
        switch permit {
        case "valid": return "ads.permitValid"
        case "expired": return "ads.permitExpired"
        default: return "ads.permitMissing"
        }
    }

    /// The Kuwaiti day, as `yyyy-mm-dd`.
    static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func addDays(_ day: String, _ days: Int) -> String {
        let reader = DateFormatter()
        reader.calendar = Calendar(identifier: .gregorian)
        reader.locale = Locale(identifier: "en_US_POSIX")
        reader.timeZone = TimeZone(identifier: "UTC")
        reader.dateFormat = "yyyy-MM-dd"
        guard let date = reader.date(from: day), let moved = Calendar(identifier: .gregorian).date(byAdding: .day, value: days, to: date) else { return day }
        return reader.string(from: moved)
    }

    /// A `yyyy-mm-dd` Kuwaiti day as a moment inside it (noon), for a date picker.
    static func date(_ day: String) -> Date {
        let reader = DateFormatter()
        reader.calendar = Calendar(identifier: .gregorian)
        reader.locale = Locale(identifier: "en_US_POSIX")
        reader.timeZone = TimeZone(identifier: "Asia/Kuwait")
        reader.dateFormat = "yyyy-MM-dd HH:mm"
        return reader.date(from: day + " 12:00") ?? Date()
    }

    /// Days from one `yyyy-mm-dd` to another, both counted (`daysInclusive`).
    static func daysInclusive(_ from: String, _ to: String) -> Int {
        let reader = DateFormatter()
        reader.calendar = Calendar(identifier: .gregorian)
        reader.locale = Locale(identifier: "en_US_POSIX")
        reader.timeZone = TimeZone(identifier: "UTC")
        reader.dateFormat = "yyyy-MM-dd"
        guard let start = reader.date(from: from), let end = reader.date(from: to) else { return 0 }
        return (Calendar(identifier: .gregorian).dateComponents([.day], from: start, to: end).day ?? -1) + 1
    }

    /// `approvalStart`: an approval after the booked start runs from today.
    static func approvalStart(_ startsOn: String, today: String) -> String { startsOn < today ? today : startsOn }

    @MainActor
    static func run(_ from: String, _ to: String, language: LanguageSettings) -> String {
        from == to ? OrderWording.day(from, language: language.current)
            : language.t("ads.runsLine", ["from": OrderWording.day(from, language: language.current), "to": OrderWording.day(to, language: language.current)])
    }
}

/// Booking a product into a place — asked first, with the cost said.
private struct AdBookForm: View {
    let booked: () -> Void
    @State private var search = ""
    @State private var products: [SellerProduct] = []
    @State private var productId: Int?
    @State private var slot = "home"
    @State private var starts = Date().addingTimeInterval(86_400)
    @State private var days = 7
    @State private var quote: AdQuote?
    @State private var confirming = false
    @State private var booking = false
    @State private var picked: PhotosPickerItem?
    @State private var mediaId: String?
    @State private var preview: String?
    @State private var uploading = false
    @State private var headline = ""
    @State private var headlineAr = ""
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: WarehouseRules { .shared }
    private var startsOn: String { AdWords.day(starts) }
    private var isBanner: Bool { slot == "home_banner" }

    private var bannerProblem: String? {
        guard isBanner else { return nil }
        if mediaId == nil { return "ads.bannerNeedsImage" }
        return rules.headlineProblem(headline, required: true) ?? rules.headlineProblem(headlineAr, required: false)
    }

    var body: some View {
        let ready = productId != nil && quote != nil && quote?.problem == nil && bannerProblem == nil
        PortalCard {
            Text(l.t("ads.bookTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            LabeledField(label: l.t("ads.findProduct"), text: Binding(get: { search }, set: { search = String($0.prefix(160)) }))
            Menu {
                ForEach(products) { product in Button(product.title) { productId = product.id } }
            } label: {
                MenuField(text: products.first { $0.id == productId }?.title, placeholder: "—")
            }
            .accessibilityLabel(l.t("ads.product"))
            Text(l.t("ads.place")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            PortalSegmented(label: l.t("ads.place"), value: $slot, options: rules.ads.slots.map { ($0, l.t(AdWords.slot($0), ["department": l.t("ads.yourDepartment")])) })
            if isBanner { bannerFields }
            let today = Calendar.current.startOfDay(for: Date())
            DatePicker(l.t("ads.startsOn"), selection: $starts, in: today...today.addingTimeInterval(Double(rules.ads.maxLeadDays) * 86_400), displayedComponents: .date)
                .font(.inter(14))
            Stepper(value: $days, in: 1...rules.ads.maxDays) {
                Text("\(l.t("ads.days", ["max": "\(rules.ads.maxDays)"])): \(days)").font(.inter(14))
            }
            if let productId {
                PlacementCalendarView(productId: productId, slot: slot, startsOn: startsOn, days: days) { from, length in
                    starts = AdWords.date(from)
                    days = length
                }
                .id("\(productId)-\(slot)")
            } else {
                Text(l.t("ads.calendarPickProduct")).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            if let quote, productId != nil {
                VStack(alignment: .leading, spacing: 4) {
                    Text(days == 1 ? l.t("ads.quoteLineOne", ["total": quote.cost.formatted(l.current)])
                         : l.t("ads.quoteLine", ["total": quote.cost.formatted(l.current), "rate": quote.dailyRate.formatted(l.current), "days": "\(days)"]))
                        .font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    Text(AdWords.run(startsOn, AdWords.addDays(startsOn, days - 1), language: l)).font(.inter(13)).foregroundStyle(Brand.body)
                    Text(l.t("ads.roomLine", ["room": quote.room.formatted(l.current)])).font(.inter(12)).foregroundStyle(Brand.muted)
                    if let problem = quote.problem {
                        Text((Phrasebook.shared.has(problem) ? l.t(problem) : problem) + (quote.fullDays.isEmpty ? "" : " " + quote.fullDays.map { OrderWording.day($0, language: l.current) }.joined(separator: " · ")))
                            .font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
                    } else if let bannerProblem {
                        Text(l.t(bannerProblem)).font(.inter(13)).foregroundStyle(Brand.danger)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
            }
            Button(l.t("ads.book")) { confirming = true }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!ready || booking)
        }
        .task { await findProducts() }
        .onChange(of: search) { Task { await findProducts() } }
        .onChange(of: productId) { Task { await ask() } }
        .onChange(of: slot) { Task { await ask() } }
        .onChange(of: starts) { Task { await ask() } }
        .onChange(of: days) { Task { await ask() } }
        .onChange(of: picked) { Task { await upload() } }
        .alert(l.t("ads.confirmTitle", ["total": quote?.cost.formatted(l.current) ?? ""]), isPresented: $confirming) {
            Button(l.t("ads.book")) { Task { await book() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t(isBanner ? "ads.confirmBannerBody" : "ads.confirmBody"))
        }
    }

    @ViewBuilder
    private var bannerFields: some View {
        Text(l.t("ads.bannerReviewNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
        Text(l.t("ads.bannerPicture")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
        Text(l.t("ads.bannerPictureHint")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        if let preview {
            Color.clear.aspectRatio(3, contentMode: .fit).overlay { RemoteImage(reference: preview) }.clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityLabel(l.t("ads.bannerPreview"))
        }
        PhotosPicker(selection: $picked, matching: .images) {
            if uploading { ProgressView() } else { Label(l.t(preview == nil ? "ads.bannerChoose" : "ads.bannerReplace"), systemImage: "photo.badge.plus") }
        }
        .buttonStyle(PortalSmallButtonStyle())
        .disabled(uploading)
        LabeledField(label: l.t("ads.bannerHeadline"), text: Binding(get: { headline }, set: { headline = String($0.prefix(rules.ads.headlineMax)) }),
                     hint: l.t("ads.bannerHeadlineHint", ["max": "\(rules.ads.headlineMax)"]), problem: rules.headlineProblem(headline, required: false).map { l.t($0) })
        LabeledField(label: l.t("ads.bannerHeadlineAr"), text: Binding(get: { headlineAr }, set: { headlineAr = String($0.prefix(rules.ads.headlineMax)) }),
                     hint: l.t("ads.bannerHeadlineArHint"), problem: rules.headlineProblem(headlineAr, required: false).map { l.t($0) })
            .environment(\.layoutDirection, .rightToLeft)
    }

    private func findProducts() async {
        let term = search.trimmingCharacters(in: .whitespaces)
        try? await Task.sleep(for: .milliseconds(250))
        guard term == search.trimmingCharacters(in: .whitespaces) else { return }
        products = (try? await app.services.api.call(API.sellerProducts, .init(pageSize: 50, query: term.isEmpty ? nil : term, status: "published")))?.rows ?? products
    }

    private func ask() async {
        guard let productId else { quote = nil; return }
        quote = try? await app.services.api.call(API.adQuote, .init(productId: productId, slot: slot, startsOn: startsOn, days: days))
    }

    /// The largest 3:1 box the picture holds, centred, as the web's
    /// `prepareBanner` crops it, so the preview is what the home page draws.
    private func upload() async {
        guard let picked else { return }
        uploading = true
        defer {
            uploading = false
            self.picked = nil
        }
        guard let data = try? await picked.loadTransferable(type: Data.self), let image = UIImage(data: data) else { return app.toast(l.t("media.notAnImage")) }
        let aspect = rules.ads.bannerAspect
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let wide = pixels.width / pixels.height >= aspect
        let crop = CGSize(width: wide ? pixels.height * aspect : pixels.width, height: wide ? pixels.height : pixels.width / aspect)
        let width = min(crop.width, CGFloat(rules.ads.bannerMaxWidth)).rounded()
        guard width >= CGFloat(rules.ads.bannerMinWidth) else { return app.toast(l.t("ads.bannerTooSmall")) }
        let target = CGSize(width: width, height: (width / aspect).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let drawn = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            let scale = target.width / crop.width
            let origin = CGPoint(x: -(pixels.width - crop.width) / 2 * scale, y: -(pixels.height - crop.height) / 2 * scale)
            image.draw(in: CGRect(origin: origin, size: CGSize(width: pixels.width * scale, height: pixels.height * scale)))
        }
        guard let jpeg = drawn.jpegData(compressionQuality: 0.86) else { return app.toast(l.t("media.notAnImage")) }
        do {
            let uploaded = try await app.services.seller.upload(jpeg: jpeg)
            // The upload's own id, from its address under /media.
            let name = uploaded.url.split(separator: "/").last.map(String.init) ?? ""
            mediaId = name.split(separator: ".").first.map(String.init)
            preview = uploaded.url
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(key == "error.serverProblem" ? "media.failed" : key))
        }
    }

    private func book() async {
        guard let productId else { return }
        booking = true
        defer { booking = false }
        var input = API.AdBook(productId: productId, slot: slot, startsOn: startsOn, days: days)
        if isBanner, let mediaId { input.banner = .init(mediaId: mediaId, headline: headline, headlineAr: .text(headlineAr)) }
        var answer: AdBooked?
        guard await app.attempt(fallback: "admin.saveFailed", { answer = try await app.services.api.call(API.bookAd, input) }) else { return }
        app.toast(l.t(isBanner ? "ads.bannerBooked" : "ads.booked", ["total": answer?.total.formatted(l.current) ?? ""]))
        if isBanner {
            mediaId = nil
            preview = nil
            headline = ""
            headlineAr = ""
        }
        await ask()
        booked()
    }
}

private struct AdBookingRow: View {
    let booking: AdBooking
    let showStore: Bool
    let changed: () -> Void
    @State private var confirming = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        // A placement cancelled while it ran ended on the day it was cancelled.
        let ends = booking.cancelledOn.flatMap { $0 < booking.endsOn && $0 >= booking.startsOn ? $0 : nil } ?? booking.endsOn
        let department = (l.current == .ar ? booking.departmentNameAr : nil) ?? booking.departmentName ?? l.t("ads.yourDepartment")
        PortalCard {
            HStack(alignment: .top) {
                Button {
                    if let handle = booking.productHandle { app.open(.product(handle: handle)) }
                } label: {
                    Text([booking.productTitle, showStore ? booking.vendorName : nil].compactMap { $0 }.joined(separator: " · ")).font(.inter(14, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                }
                .buttonStyle(.tap)
                Spacer()
                StatusPill(label: l.t(AdWords.state(booking.state)), tone: AdWords.tone(booking.state))
            }
            Text("\(l.t(AdWords.slot(booking.slot), ["department": department])) · \(AdWords.run(booking.startsOn, ends, language: l))").font(.inter(13)).foregroundStyle(Brand.body)
            Text(l.t("ads.costLine", ["accrued": booking.accrued.formatted(l.current), "total": booking.total.formatted(l.current), "deducted": booking.deducted.formatted(l.current)]))
                .font(.inter(12)).foregroundStyle(Brand.muted)
            if let banner = booking.banner { BannerSummaryView(banner: banner) }
            if booking.cancellable {
                Button(l.t(showStore ? "ads.takeDown" : "ads.cancel")) { confirming = true }
                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
            }
        }
        .alert(l.t(showStore ? "ads.takeDownTitle" : "ads.cancelTitle", ["product": booking.productTitle]), isPresented: $confirming) {
            Button(l.t(showStore ? "ads.takeDown" : "ads.cancel"), role: .destructive) {
                Task {
                    if await app.attempt(done: "ads.cancelled", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.cancelAd, .init(id: booking.id)) }) { changed() }
                }
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t(booking.state == "upcoming" || booking.state == "inReview" ? "ads.cancelFree" : "ads.cancelToday"))
        }
    }
}

private struct BannerSummaryView: View {
    let banner: AdBooking.Banner
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let image = banner.imageUrl {
                Color.clear.aspectRatio(3, contentMode: .fit).overlay { RemoteImage(reference: image) }.clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            Text(banner.headline).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
            if let arabic = banner.headlineAr, !arabic.isEmpty {
                Text(arabic).font(.inter(14)).foregroundStyle(Brand.navy).frame(maxWidth: .infinity, alignment: .trailing).environment(\.layoutDirection, .rightToLeft)
            }
            if let note = banner.note, !note.isEmpty { Text(l.t("ads.bannerNoteLine", ["note": note])).font(.inter(12)).foregroundStyle(Brand.danger) }
        }
    }
}

/// NetLet reading a store's banner before it goes on the front page: the
/// permit said beside it, and turning it down must say why.
private struct BannerReviewCard: View {
    let booking: AdBooking
    let changed: () -> Void
    @State private var asking: String?
    @State private var note = ""
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let today = AdWords.day(Date())
        let starts = AdWords.approvalStart(booking.startsOn, today: today)
        PortalCard {
            Text([booking.productTitle, booking.vendorName].compactMap { $0 }.joined(separator: " · ")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            Text("\(AdWords.run(booking.startsOn, booking.endsOn, language: l)) · \(booking.dailyRate.formatted(l.current))").font(.inter(13)).foregroundStyle(Brand.body)
            if let banner = booking.banner {
                BannerSummaryView(banner: banner)
                Text(l.t(AdWords.permit(banner.permit))).font(.inter(13, banner.permit == "valid" ? .regular : .semibold)).foregroundStyle(banner.permit == "valid" ? Brand.muted : Brand.danger)
            }
            if asking == "reject" {
                LabeledField(label: l.t("ads.bannerRejectReason"), text: Binding(get: { note }, set: { note = String($0.prefix(WarehouseRules.shared.ads.noteMax)) }), axis: .vertical)
            }
            HStack(spacing: 8) {
                Button(l.t("ads.bannerApprove")) { asking = "approve" }.buttonStyle(PortalSmallButtonStyle(kind: .primary))
                if asking == "reject" {
                    Button(l.t("ads.bannerReject")) { Task { await review("reject") } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                        .disabled(note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                } else {
                    Button(l.t("ads.bannerReject")) { asking = "reject" }.buttonStyle(PortalSmallButtonStyle(kind: .danger))
                }
            }
        }
        .alert(l.t("ads.bannerApproveTitle"), isPresented: Binding(get: { asking == "approve" }, set: { if !$0 && asking == "approve" { asking = nil } })) {
            Button(l.t("ads.bannerApprove")) { Task { await review("approve") } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t(starts == booking.startsOn ? "ads.bannerApproveBody" : "ads.bannerApproveLate", ["run": AdWords.run(starts, booking.endsOn, language: l)]))
        }
    }

    private func review(_ decision: String) async {
        var input = API.BannerDecision(id: booking.id, decision: decision)
        if decision == "reject" { input.note = note }
        var answer: BannerReviewed?
        guard await app.attempt(fallback: "admin.saveFailed", { answer = try await app.services.api.call(API.reviewBanner, input) }) else { return }
        asking = nil
        note = ""
        app.toast(l.t(answer?.status == "approved" ? "ads.bannerApproved" : "ads.bannerRejected"))
        changed()
    }
}

/// The calendar a store books from (3.3.15) — the web's `PlacementCalendar`:
/// each day with how many places are still free, a month at a time, Sunday
/// first, the Kuwaiti week. The first press picks the first day and the
/// second the last; a run never takes a full day, because the booking would
/// refuse it. The date and the stepper above stay, and are the same two values.
struct PlacementCalendarView: View {
    let productId: Int
    let slot: String
    let startsOn: String
    let days: Int
    let pick: (String, Int) -> Void
    @State private var calendar: PlacementCalendar?
    @State private var failed: APIError?
    @State private var anchor: String?
    @State private var monthIndex = 0
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: WarehouseRules { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let calendar {
                content(calendar)
            } else if let failed {
                Text(l.t(failed.messageKey(knownKey: l.phrasebook.has))).font(.inter(13)).foregroundStyle(Brand.danger)
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .task {
            do {
                calendar = try await app.services.api.call(API.adCalendar, .init(productId: productId, slot: slot))
                failed = nil
            } catch {
                let failure = APIError.from(error)
                if failure != .cancelled { failed = failure }
            }
        }
    }

    private func monthsOf(_ calendar: PlacementCalendar) -> [(key: String, days: [PlacementCalendar.Day])] {
        var keys: [String] = []
        var grouped: [String: [PlacementCalendar.Day]] = [:]
        for day in calendar.days {
            let key = String(day.date.prefix(7))
            if grouped[key] == nil { keys.append(key) }
            grouped[key, default: []].append(day)
        }
        return keys.map { ($0, grouped[$0] ?? []) }
    }

    @ViewBuilder
    private func content(_ calendar: PlacementCalendar) -> some View {
        let months = monthsOf(calendar)
        if !months.isEmpty {
            let shown = min(monthIndex, months.count - 1)
            let month = months[shown]
            let lastStart = AdWords.addDays(calendar.today, rules.ads.maxLeadDays)
            let runEnd = days > 0 ? AdWords.addDays(startsOn, days - 1) : nil
            let byDate = Dictionary(uniqueKeysWithValues: calendar.days.map { ($0.date, $0) })
            HStack(alignment: .firstTextBaseline) {
                Text(l.t("ads.calendarTitle")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                Spacer(minLength: 6)
                Text(l.t("ads.rateLine", ["rate": calendar.dailyRate.formatted(l.current), "places": "\(calendar.capacity)"]))
                    .font(.inter(12)).foregroundStyle(Brand.muted)
            }
            Text(l.t(anchor == nil ? "ads.calendarHint" : "ads.calendarPickEnd")).font(.inter(13)).foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button { monthIndex = max(0, shown - 1) } label: {
                    Image(systemName: "chevron.backward").frame(width: 44, height: 36)
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(shown == 0)
                .accessibilityLabel(l.t("ads.calendarPrevMonth"))
                Spacer()
                Text(monthName(month.key)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                Spacer()
                Button { monthIndex = min(months.count - 1, shown + 1) } label: {
                    Image(systemName: "chevron.forward").frame(width: 44, height: 36)
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(shown >= months.count - 1)
                .accessibilityLabel(l.t("ads.calendarNextMonth"))
            }
            let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(weekdays, id: \.self) { name in
                    Text(name).font(.inter(11, .semibold)).foregroundStyle(Brand.muted).accessibilityHidden(true)
                }
                ForEach(0..<leading(month.days.first?.date), id: \.self) { _ in Color.clear.frame(height: 1).accessibilityHidden(true) }
                ForEach(month.days, id: \.date) { entry in
                    let full = entry.free == 0
                    let chosen = runEnd.map { startsOn <= entry.date && entry.date <= $0 } ?? false
                    let startable = entry.date <= lastStart || (anchor.map { entry.date >= $0 } ?? false)
                    Button {
                        press(entry.date, byDate: byDate, lastStart: lastStart)
                    } label: {
                        VStack(spacing: 1) {
                            Text(verbatim: "\(Int(entry.date.suffix(2)) ?? 0)").font(.inter(13, .bold)).monospacedDigit()
                            Text(full ? l.t("ads.calendarFull") : l.t("ads.calendarFree", ["count": "\(entry.free)"]))
                                .font(.inter(10)).lineLimit(1).minimumScaleFactor(0.7)
                                .foregroundStyle(chosen ? Color.white.opacity(0.85) : Brand.muted)
                        }
                        .strikethrough(full)
                        .foregroundStyle(chosen ? Color.white : (full || !startable) ? Brand.muted : Brand.navy)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(chosen ? Brand.navy : full ? Brand.photo : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(chosen ? Brand.navy : Brand.cardLine, lineWidth: 1))
                    }
                    .buttonStyle(.tap)
                    .disabled(full || !startable)
                    .accessibilityLabel(full ? l.t("ads.calendarDayFull", ["day": OrderWording.day(entry.date, language: l.current)])
                                        : l.t("ads.calendarDayLabel", ["day": OrderWording.day(entry.date, language: l.current), "count": "\(entry.free)", "capacity": "\(calendar.capacity)"]))
                    .accessibilityAddTraits(chosen ? .isSelected : [])
                }
            }
        }
    }

    /// First press the first day; a second press on or after it the last, if
    /// every day between has room and the run is not too long.
    private func press(_ date: String, byDate: [String: PlacementCalendar.Day], lastStart: String) {
        guard let entry = byDate[date], entry.free > 0 else { return }
        if let anchor, date >= anchor {
            let length = AdWords.daysInclusive(anchor, date)
            let blocked = (0..<max(0, length)).contains { offset in (byDate[AdWords.addDays(anchor, offset)]?.free ?? 0) == 0 }
            if length <= rules.ads.maxDays && !blocked {
                pick(anchor, length)
                self.anchor = nil
                return
            }
        }
        guard date <= lastStart else { return }
        pick(date, 1)
        anchor = date
    }

    /// Blank cells before the month's first day, Sunday first.
    private func leading(_ first: String?) -> Int {
        guard let first else { return 0 }
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = TimeZone(identifier: "Asia/Kuwait") ?? .current
        return gregorian.component(.weekday, from: AdWords.date(first)) - 1
    }

    private var weekdays: [String] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: l.current == .ar ? "ar-KW" : "en-GB")
        // Arabic's short names are whole words that wrap in a seventh of a
        // phone; its calendars head a column with the day's letter.
        return l.current == .ar ? formatter.veryShortWeekdaySymbols : formatter.shortWeekdaySymbols
    }

    private func monthName(_ key: String) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: l.current == .ar ? "ar-KW@numbers=latn" : "en-GB")
        formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
        formatter.setLocalizedDateFormatFromTemplate("MMMMyyyy")
        return formatter.string(from: AdWords.date(key + "-15"))
    }
}
