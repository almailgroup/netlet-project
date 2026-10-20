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
