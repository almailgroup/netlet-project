import SwiftUI
import UIKit

/// Sponsored products — the web's `/admin/sponsored` (migration 0089). A
/// store asks for one of its products among the home page's first products
/// on days it chooses, and pays once NetLet approves: from its earnings, taken
/// off its payouts a day at a time, or by bank transfer, which NetLet confirms
/// here. Every button is the server's answer (`actions`), so the page offers
/// exactly what `sponsor.*` accepts.
struct PortalSponsoredView: View {
    @State private var view: String?
    @State private var page = 1
    @State private var list: SponsorList?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var store: Bool { app.session.seller?.kind == "vendor" }
    private var chosen: String { view ?? (store ? "all" : "todo") }
    private var views: [String] { store ? ["all", "todo", "open", "live", "done"] : ["todo", "open", "live", "done", "all"] }

    var body: some View {
        PortalScreen(title: l.t("admin.sponsored"), intro: l.t(store ? "sponsor.noteStore" : "sponsor.noteNetLet"), refresh: { await load() }) {
            if store { SponsorSteps() }
            if let list {
                if !list.ready {
                    PortalEmpty(text: l.t("sponsor.unavailable"))
                } else {
                    Text(l.t("sponsor.rateLine", ["rate": list.rateCard.formatted(l.current), "places": "\(list.capacity)"])
                         + (store ? " " + l.t("sponsor.roomLine", ["room": (list.room ?? .zero).formatted(l.current)]) : ""))
                        .font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    if store { SponsorAskForm { Task { await load() } } }
                    PortalSectionHeading(title: l.t(store ? "sponsor.yourRequests" : "sponsor.requests"))
                    PortalSegmented(label: l.t("sponsor.viewLabel"), value: Binding(get: { chosen }, set: { view = $0; page = 1 }), options: views.map { option in
                        (option, "\(l.t(label(option))) \(list.counts.of(option))")
                    })
                    if list.rows.isEmpty {
                        PortalEmpty(text: l.t(chosen == "all" ? (store ? "sponsor.noneStore" : "sponsor.none") : "sponsor.noneHere"))
                    } else {
                        ForEach(list.rows) { row in
                            SponsorRowCard(row: row, list: list, side: store ? "store" : "netlet") { Task { await load() } }
                        }
                        PortalPager(page: list.page, pageSize: list.pageSize, total: list.total) { next in
                            page = next
                            Task { await load() }
                        }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task(id: "\(chosen)-\(page)") { await load() }
    }

    private func label(_ view: String) -> String {
        switch view {
        case "todo": return store ? "sponsor.viewToPay" : "sponsor.viewTodo"
        case "open": return "sponsor.viewOpen"
        case "live": return "sponsor.viewLive"
        case "done": return "sponsor.viewDone"
        default: return "sponsor.viewAll"
        }
    }

    private func load() async {
        do {
            list = try await app.services.api.call(API.sponsorList, .init(view: chosen, page: page))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, list == nil { failed = failure }
        }
    }
}

/// The four steps, for the store that takes them; NetLet's people know them.
/// A sequence, so numbered.
private struct SponsorSteps: View {
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalCard {
            Text(l.t("sponsor.howTitle")).font(.inter(14, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            ForEach(Array(["sponsor.how1", "sponsor.how2", "sponsor.how3", "sponsor.how4"].enumerated()), id: \.offset) { index, key in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(verbatim: "\(index + 1)")
                        .font(.inter(12, .bold)).foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(Brand.navy))
                        .accessibilityHidden(true)
                    Text(l.t(key)).font(.inter(13)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// Asking for a place: a product, its days and a note, with the rate card's
/// price and whether the days have room said before anything is sent.
private struct SponsorAskForm: View {
    let sent: () -> Void
    @State private var search = ""
    @State private var products: [SellerProduct] = []
    @State private var productId: Int?
    @State private var starts = AdWords.todayInKuwait.addingTimeInterval(2 * 86_400)
    @State private var days = 7
    @State private var note = ""
    @State private var quote: SponsorQuote?
    @State private var confirming = false
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: WarehouseRules { .shared }
    private var startsOn: String { AdWords.day(starts) }

    var body: some View {
        let ready = productId != nil && quote != nil && quote?.problem == nil
        PortalCard {
            Text(l.t("sponsor.askTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            Text(l.t("sponsor.askNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            LabeledField(label: l.t("ads.findProduct"), text: Binding(get: { search }, set: { search = String($0.prefix(160)) }))
            Menu {
                ForEach(products) { product in Button(product.title) { productId = product.id } }
            } label: {
                MenuField(text: products.first { $0.id == productId }?.title, placeholder: "—")
            }
            .accessibilityLabel(l.t("ads.product"))
            let today = AdWords.todayInKuwait
            DatePicker(l.t("ads.startsOn"), selection: $starts, in: today...today.addingTimeInterval(Double(rules.ads.maxLeadDays) * 86_400), displayedComponents: .date)
                .font(.inter(14))
                .environment(\.timeZone, AdWords.kuwait)
            Stepper(value: $days, in: 1...rules.ads.maxDays) {
                Text("\(l.t("ads.days", ["max": "\(rules.ads.maxDays)"])): \(days)").font(.inter(14))
            }
            if let productId {
                PlacementCalendarView(productId: productId, slot: "home", startsOn: startsOn, days: days) { from, length in
                    starts = AdWords.date(from)
                    days = length
                }
                .id(productId)
            } else {
                Text(l.t("ads.calendarPickProduct")).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            LabeledField(label: l.t("sponsor.noteLabel"), text: Binding(get: { note }, set: { note = String($0.prefix(SponsorRules.shared.sponsor.noteMax)) }),
                         hint: l.t("sponsor.noteHint"), axis: .vertical)
            if let quote, productId != nil {
                VStack(alignment: .leading, spacing: 4) {
                    Text(days == 1 ? l.t("ads.quoteLineOne", ["total": quote.cost.formatted(l.current)])
                         : l.t("ads.quoteLine", ["total": quote.cost.formatted(l.current), "rate": quote.dailyRate.formatted(l.current), "days": "\(days)"]))
                        .font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    Text(AdWords.run(startsOn, AdWords.addDays(startsOn, days - 1), language: l)).font(.inter(13)).foregroundStyle(Brand.body)
                    Text(l.t("sponsor.quoteNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    if let problem = quote.problem {
                        Text((Phrasebook.shared.has(problem) ? l.t(problem) : problem) + (quote.fullDays.isEmpty ? "" : " " + quote.fullDays.map { OrderWording.day($0, language: l.current) }.joined(separator: " · ")))
                            .font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
                .accessibilityElement(children: .combine)
            }
            Text(l.t("sponsor.previewNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            Button(l.t("sponsor.send")) { confirming = true }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!ready || sending)
        }
        .task { await findProducts() }
        .onChange(of: search) { Task { await findProducts() } }
        .onChange(of: productId) { Task { await ask() } }
        .onChange(of: starts) { Task { await ask() } }
        .onChange(of: days) { Task { await ask() } }
        .alert(l.t("sponsor.confirmTitle"), isPresented: $confirming) {
            Button(l.t("sponsor.send")) { Task { await send() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("sponsor.confirmBody", ["run": AdWords.run(startsOn, AdWords.addDays(startsOn, days - 1), language: l), "total": quote?.cost.formatted(l.current) ?? ""]))
        }
    }

    private func findProducts() async {
        let term = search.trimmingCharacters(in: .whitespaces)
        try? await Task.sleep(for: .milliseconds(250))
        guard term == search.trimmingCharacters(in: .whitespaces) else { return }
        products = (try? await app.services.api.call(API.sellerProducts, .init(pageSize: 50, query: term.isEmpty ? nil : term, status: "published")))?.rows ?? products
    }

    private func ask() async {
        guard let productId else { quote = nil; return }
        quote = try? await app.services.api.call(API.sponsorQuote, .init(productId: productId, startsOn: startsOn, days: days))
    }

    private func send() async {
        guard let productId else { return }
        sending = true
        defer { sending = false }
        let words = note.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard await app.attempt(done: "sponsor.sent", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.sponsorRequest, .init(productId: productId, startsOn: startsOn, days: days, note: words.isEmpty ? nil : words))
        }) else { return await ask() }
        note = ""
        productId = nil
        quote = nil
        sent()
    }
}

/// What a press on a request opens: a form in a sheet, or a question.
private enum SponsorAct: String, Identifiable {
    case approve, decline, transfer, confirm, missing
    var id: String { rawValue }
}

/// One request: the product, its run and price, where it stands, its notes,
/// how it did, and what this person may do about it now.
private struct SponsorRowCard: View {
    let row: SponsorRow
    let list: SponsorList
    let side: String
    let changed: () -> Void
    @State private var acting: SponsorAct?
    @State private var asking: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var store: Bool { side == "store" }
    private var room: Money? { row.storeRoom ?? list.room }
    private var short: Bool { room.map { $0.fils < row.total.fils } ?? false }

    var body: some View {
        let a = row.actions
        PortalCard {
            HStack(alignment: .top, spacing: 12) {
                Color.white
                    .frame(width: 64, height: 64)
                    .overlay { RemoteImage(reference: row.photo, contentMode: .fit) }
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top, spacing: 8) {
                        Button {
                            if let handle = row.productHandle { app.open(.product(handle: handle)) }
                        } label: {
                            Text([row.productTitle, store ? nil : row.vendorName].compactMap { $0 }.joined(separator: " · "))
                                .font(.inter(15, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .buttonStyle(.tap)
                        .disabled(row.productHandle == nil)
                        Spacer(minLength: 4)
                        StatusPill(label: l.t(stateLabel), tone: .portal(tone))
                    }
                    Text("\(AdWords.run(row.placement?.startsOn ?? row.startsOn, row.placement?.endsOn ?? row.endsOn, language: l)) · "
                         + (row.days == 1 ? l.t("ads.quoteLineOne", ["total": row.total.formatted(l.current)])
                            : l.t("ads.quoteLine", ["total": row.total.formatted(l.current), "rate": row.dailyRate.formatted(l.current), "days": "\(row.days)"])))
                        .font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    Text(l.t("sponsor.referenceLine", ["reference": latin(row.transferReference)])).font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            SponsorStepsBar(step: row.step, stopped: row.stopped)
            if let note = row.note { quoted("sponsor.noteFromStore", note) }
            if let reply = row.reply { quoted("sponsor.replyFromNetLet", reply) }
            stateLine
            if !store, let storeRoom = row.storeRoom, row.state == "review" || row.state == "payment" {
                Text(l.t("sponsor.storeRoom", ["room": storeRoom.formatted(l.current)])).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            if let results = row.results, results.daysShown > 0 { SponsorResultsView(results: results) }
            if a.any {
                Divider().padding(.vertical, 2)
                FlowLayout(spacing: 8) {
                    if a.approve { Button(l.t("sponsor.approve")) { acting = .approve }.buttonStyle(PortalSmallButtonStyle(kind: .primary)) }
                    if a.confirmPayment { Button(l.t("sponsor.confirm")) { acting = .confirm }.buttonStyle(PortalSmallButtonStyle(kind: .primary)) }
                    if a.payFromEarnings {
                        Button { asking = "earnings" } label: { Label(l.t("sponsor.payEarnings"), systemImage: "wallet.bifold") }
                            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    }
                    if a.sendTransfer {
                        Button { acting = .transfer } label: { Label(l.t("sponsor.payTransfer"), systemImage: "building.columns") }
                            .buttonStyle(PortalSmallButtonStyle())
                    }
                    if a.notReceived { Button(l.t("sponsor.notReceived")) { acting = .missing }.buttonStyle(PortalSmallButtonStyle()) }
                    if a.withdraw { Button(l.t("sponsor.withdraw")) { asking = "withdraw" }.buttonStyle(PortalSmallButtonStyle(kind: .danger)) }
                    if a.decline { Button(l.t("sponsor.decline")) { acting = .decline }.buttonStyle(PortalSmallButtonStyle(kind: .danger)) }
                    if a.stop { Button(l.t(store ? "sponsor.stop" : "ads.takeDown")) { asking = "stop" }.buttonStyle(PortalSmallButtonStyle(kind: .danger)) }
                }
            }
        }
        .sheet(item: $acting) { act in
            SponsorActSheet(act: act, row: row, list: list) { done in
                acting = nil
                if done { changed() }
            }
            .languageDirection()
        }
        .alert(l.t("sponsor.earningsTitle", ["total": row.total.formatted(l.current)]), isPresented: Binding(get: { asking == "earnings" }, set: { if !$0 { asking = nil } })) {
            if !short { Button(l.t("sponsor.payEarnings")) { act(done: "sponsor.paidEarnings") { _ = try await $0.call(API.sponsorPayFromEarnings, .init(id: row.id)) } } }
            Button(l.t(short ? "common.close" : "common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t(short ? "sponsor.earningsShort" : "sponsor.earningsBody", ["room": (room ?? .zero).formatted(l.current), "run": AdWords.run(row.startsOn, row.endsOn, language: l)]))
        }
        .alert(l.t("sponsor.withdrawTitle", ["product": row.productTitle]), isPresented: Binding(get: { asking == "withdraw" }, set: { if !$0 { asking = nil } })) {
            Button(l.t("sponsor.withdraw"), role: .destructive) { act(done: "sponsor.withdrawn") { _ = try await $0.call(API.sponsorWithdraw, .init(id: row.id)) } }
            Button(l.t("sponsor.keep"), role: .cancel) {}
        } message: {
            Text(l.t("sponsor.withdrawBody"))
        }
        .alert(l.t(store ? "ads.cancelTitle" : "ads.takeDownTitle", ["product": row.productTitle]), isPresented: Binding(get: { asking == "stop" }, set: { if !$0 { asking = nil } })) {
            Button(l.t(store ? "sponsor.stop" : "ads.takeDown"), role: .destructive) { Task { await stop() } }
            Button(l.t("sponsor.keep"), role: .cancel) {}
        } message: {
            Text(row.refundIfStopped.map { l.t("sponsor.stopRefund", ["refund": $0.formatted(l.current)]) }
                 ?? l.t(row.placement?.state == "upcoming" ? "ads.cancelFree" : "ads.cancelToday"))
        }
    }

    private var stateLabel: String {
        if !store {
            switch row.state {
            case "review": return "sponsor.stateReviewNetLet"
            case "payment": return "sponsor.statePaymentNetLet"
            case "sent": return "sponsor.stateSentNetLet"
            default: break
            }
        }
        switch row.state {
        case "review": return "sponsor.stateReview"
        case "payment": return "sponsor.statePayment"
        case "sent": return "sponsor.stateSent"
        case "paid": return "sponsor.statePaid"
        case "declined": return "sponsor.stateDeclined"
        case "withdrawn": return "sponsor.stateWithdrawn"
        default: return "sponsor.stateLapsed"
        }
    }

    private var tone: String {
        switch row.state {
        case "paid": return "good"
        case "review", "payment", "sent": return "warning"
        case "declined": return "danger"
        default: return "neutral"
        }
    }

    private func quoted(_ who: String, _ words: String) -> some View {
        (Text(l.t(who) + " ").font(.inter(13, .semibold)) + Text(words).font(.inter(13)))
            .foregroundStyle(Brand.body)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// The web's `StateLine`: where the request stands, in a sentence for this side.
    @ViewBuilder
    private var stateLine: some View {
        let day: (String?) -> String = { $0.map { OrderWording.day($0, language: l.current) } ?? "" }
        let total = row.total.formatted(l.current)
        let line: String? = {
            switch row.state {
            case "review": return l.t(store ? "sponsor.lineReviewStore" : "sponsor.lineReviewNetLet")
            case "payment": return l.t(store ? "sponsor.linePaymentStore" : "sponsor.linePaymentNetLet", ["total": total, "day": day(row.payBy)])
            case "sent": return l.t(store ? "sponsor.lineSentStore" : "sponsor.lineSentNetLet", ["total": total, "reference": latin(row.paymentReference ?? ""), "ours": latin(row.transferReference)])
            case "paid":
                guard let placement = row.placement else { return nil }
                let end = placement.cancelledOn.flatMap { $0 < placement.endsOn ? $0 : nil } ?? placement.endsOn
                let key = placement.state == "upcoming" ? "sponsor.lineUpcoming" : placement.state == "running" ? "sponsor.lineRunning" : placement.cancelledOn != nil ? "sponsor.lineStopped" : "sponsor.lineEnded"
                return l.t(key, ["day": day(placement.startsOn), "end": day(end)])
            case "declined": return l.t("sponsor.lineDeclined")
            case "withdrawn": return l.t("sponsor.lineWithdrawn")
            case "lapsed": return l.t(row.status == "payment" ? "sponsor.lineLapsedPayment" : "sponsor.lineLapsedReview", ["day": day(row.payBy ?? row.endsOn)])
            default: return nil
            }
        }()
        if let line {
            Text(line).font(.inter(13, .semibold)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
        }
        if row.state == "paid", let paidWith = row.paidWith {
            Text(l.t(paidWith == "earnings" ? "sponsor.paidWithEarnings" : "sponsor.paidWithTransfer",
                     ["total": total, "accrued": (row.placement?.accrued ?? .zero).formatted(l.current)]))
                .font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func act(done: String, _ work: @escaping (any APICalling) async throws -> Void) {
        Task {
            let api = app.services.api
            _ = await app.attempt(done: done, fallback: "admin.saveFailed") { try await work(api) }
            changed()
        }
    }

    private func stop() async {
        var answer: SponsorRefund?
        _ = await app.attempt(fallback: "admin.saveFailed") { answer = try await app.services.api.call(API.sponsorStop, .init(id: row.id)) }
        if let answer {
            app.toast(answer.refund.map { l.t("sponsor.stoppedRefund", ["refund": $0.formatted(l.current)]) } ?? l.t("sponsor.stopped"))
        }
        changed()
    }
}

/// Requested, payment, live, ended: the step a request is on, and whether it stopped there.
private struct SponsorStepsBar: View {
    let step: String
    let stopped: Bool
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let reached = SponsorRow.steps.firstIndex(of: step) ?? 0
        HStack(alignment: .top, spacing: 4) {
            ForEach(Array(SponsorRow.steps.enumerated()), id: \.offset) { index, name in
                VStack(alignment: .leading, spacing: 4) {
                    Capsule()
                        .fill(index < reached || (index == reached && !stopped) ? Brand.navy : index == reached ? Brand.danger : Brand.line)
                        .frame(height: 4)
                    Text(l.t(stepKey(name)))
                        .font(.inter(11, index == reached ? .bold : .regular))
                        .foregroundStyle(index <= reached ? Brand.navy : Brand.muted)
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.top, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(l.t("sponsor.stepsLabel")): \(l.t(stepKey(step)))")
    }

    private func stepKey(_ step: String) -> String {
        switch step {
        case "payment": return "sponsor.stepPayment"
        case "live": return "sponsor.stepLive"
        case "ended": return "sponsor.stepEnded"
        default: return "sponsor.stepRequested"
        }
    }
}

/// How a run is doing: home-page views against the days before it, and orders.
private struct SponsorResultsView: View {
    let results: SponsorRow.Results
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("sponsor.resultsTitle", ["days": "\(results.daysShown)"])).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)], alignment: .leading, spacing: 10) {
                figure("sponsor.resultViews", results.homeViews, lift: results.lift)
                figure("sponsor.resultVisitors", results.homeVisitors)
                figure("sponsor.resultBefore", results.viewsBefore)
                figure("sponsor.resultOrders", results.orders)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint.opacity(0.5)))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    private func figure(_ label: String, _ value: Int, lift: Int? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(l.t(label)).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            Text(verbatim: PointsFormat.count(value, l.current)).font(.inter(17, .bold)).foregroundStyle(Brand.navy).monospacedDigit()
            if let lift, lift != 0 {
                Text(l.t(lift > 0 ? "sponsor.liftUp" : "sponsor.liftDown", ["percent": "\(abs(lift))"]))
                    .font(.inter(12, .semibold)).foregroundStyle(lift > 0 ? Brand.success : Brand.danger)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The forms behind a request's buttons: NetLet approving at a rate, declining
/// with a reason, confirming a transfer or saying it has not arrived; the store
/// sending a transfer. Each problem is said under its box on the press, never
/// a button greyed out with no sentence beside it.
private struct SponsorActSheet: View {
    let act: SponsorAct
    let row: SponsorRow
    let list: SponsorList
    let finish: (Bool) -> Void
    @State private var rate = ""
    @State private var payBy = Date()
    @State private var reply = ""
    @State private var reference = ""
    @State private var startsFrom = Date()
    @State private var tried = false
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: SponsorRules { .shared }
    private var today: String { AdWords.day(Date()) }
    private var startPassed: Bool { row.startsOn < today }
    private var latestPayBy: String { startPassed ? today : row.startsOn }
    private var payByDay: String { AdWords.day(payBy) }
    private var replyMissing: Bool { reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    /* The title is the sheet's heading rather than the bar's, which would cut "Decline the request for …" short. */
                    Text(l.t(title, titleParams)).font(.inter(19, .bold)).foregroundStyle(Brand.navy)
                        .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                    Text(explanation(for: act)).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    switch act {
                    case .approve: approveFields
                    case .decline: replyField("sponsor.declineReason")
                    case .transfer: transferFields
                    case .confirm: confirmFields
                    case .missing:
                        replyField("sponsor.missingReason")
                        payByField
                    }
                    if act == .decline {
                        Button(l.t(confirmLabel)) { Task { await submit() } }.buttonStyle(DangerButtonStyle()).disabled(busy)
                    } else {
                        Button(l.t(confirmLabel)) { Task { await submit() } }.buttonStyle(PrimaryButtonStyle()).disabled(busy)
                    }
                }
                .padding(20)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { BarButton(l.t("common.cancel")) { finish(false) } }
            }
        }
        .presentationDetents([.large])
        .onAppear {
            rate = row.dailyRate.amount
            payBy = AdWords.date(row.suggestedPayBy)
            startsFrom = AdWords.date(today)
        }
    }

    private var title: String {
        switch act {
        case .approve: return "sponsor.approveTitle"
        case .decline: return "sponsor.declineTitle"
        case .transfer: return "sponsor.transferTitle"
        case .confirm: return "sponsor.confirmPaidTitle"
        case .missing: return "sponsor.missingTitle"
        }
    }

    private var titleParams: [String: String] {
        ["product": row.productTitle, "total": row.total.formatted(l.current)]
    }

    private var confirmLabel: String {
        switch act {
        case .approve: return "sponsor.approveSend"
        case .decline: return "sponsor.decline"
        case .transfer: return "sponsor.transferDone"
        case .confirm: return "sponsor.confirm"
        case .missing: return "sponsor.notReceived"
        }
    }

    private func explanation(for act: SponsorAct) -> String {
        switch act {
        case .approve:
            return l.t(startPassed ? "sponsor.approveLate" : "sponsor.approveBody", ["run": AdWords.run(startPassed ? today : row.startsOn, row.endsOn, language: l)])
        case .decline:
            return l.t(row.state == "sent" ? "sponsor.declineSent" : "sponsor.declineBody", ["total": row.total.formatted(l.current)])
        case .transfer:
            return l.t("sponsor.transferBody", ["day": row.payBy.map { OrderWording.day($0, language: l.current) } ?? ""])
        case .confirm:
            return l.t(startPassed ? "sponsor.confirmLate" : "sponsor.confirmPaidBody",
                       ["reference": latin(row.paymentReference ?? ""), "ours": latin(row.transferReference), "run": AdWords.run(row.startsOn, row.endsOn, language: l)])
        case .missing:
            return l.t("sponsor.missingBody", ["reference": latin(row.paymentReference ?? "")])
        }
    }

    @ViewBuilder
    private var approveFields: some View {
        let rateWrong = rules.rateProblem(rate)
        LabeledField(label: l.t("sponsor.dayRate"), text: $rate, hint: l.t("sponsor.dayRateHint", ["rate": list.rateCard.formatted(l.current)]),
                     problem: rateWrong, keyboard: .decimalPad, leftToRight: true)
        payByField
        if let run = rules.approvedRun(startsOn: row.startsOn, endsOn: row.endsOn, today: today, rate: rate) {
            Text(l.t("sponsor.approveTotal", ["total": run.total.formatted(l.current)])).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
        }
        LabeledField(label: l.t("sponsor.replyLabel"), text: Binding(get: { reply }, set: { reply = String($0.prefix(rules.sponsor.noteMax)) }),
                     hint: l.t("sponsor.replyHint"), axis: .vertical)
    }

    @ViewBuilder
    private var payByField: some View {
        let first = AdWords.date(today)
        VStack(alignment: .leading, spacing: 6) {
            DatePicker(l.t("sponsor.payBy"), selection: $payBy, in: first...max(first, AdWords.date(latestPayBy)), displayedComponents: .date)
                .font(.inter(14))
                .environment(\.timeZone, AdWords.kuwait)
            FieldProblem(key: rules.payByProblem(payByDay, startsOn: row.startsOn, today: today))
        }
    }

    private func replyField(_ label: String) -> some View {
        LabeledField(label: l.t(label), text: Binding(get: { reply }, set: { reply = String($0.prefix(rules.sponsor.noteMax)) }),
                     problem: tried && replyMissing ? "sponsor.needsReply" : nil, axis: .vertical)
    }

    @ViewBuilder
    private var transferFields: some View {
        if let account = list.transfer {
            VStack(alignment: .leading, spacing: 10) {
                accountLine("sponsor.accountName", account.name, copy: false)
                accountLine("sponsor.accountIban", account.iban, copy: true)
                accountLine("sponsor.accountAmount", row.total.formatted(l.current), copy: false)
                accountLine("sponsor.accountReference", row.transferReference, copy: true)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint.opacity(0.5)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        }
        LabeledField(label: l.t("sponsor.bankReference"), text: Binding(get: { reference }, set: { reference = String($0.prefix(rules.sponsor.referenceMax)) }),
                     hint: l.t("sponsor.bankReferenceHint"), problem: tried ? rules.referenceProblem(reference) : nil, leftToRight: true)
    }

    private func accountLine(_ label: String, _ value: String, copy: Bool) -> some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t(label)).font(.inter(12)).foregroundStyle(Brand.muted)
                Text(verbatim: value).font(.inter(14, .semibold)).foregroundStyle(Brand.navy).textSelection(.enabled)
                    .environment(\.layoutDirection, .leftToRight)
            }
            Spacer(minLength: 6)
            if copy {
                Button {
                    UIPasteboard.general.string = value
                    app.toast(l.t("sponsor.copied"))
                } label: {
                    Image(systemName: "doc.on.doc").frame(width: 36, height: 36)
                }
                .buttonStyle(PortalSmallButtonStyle())
                .accessibilityLabel(l.t("sponsor.copy", ["what": l.t(label)]))
            }
        }
    }

    @ViewBuilder
    private var confirmFields: some View {
        if startPassed {
            let first = AdWords.date(today)
            VStack(alignment: .leading, spacing: 4) {
                DatePicker(l.t("sponsor.runsFrom"), selection: $startsFrom,
                           in: first...first.addingTimeInterval(Double(WarehouseRules.shared.ads.maxLeadDays) * 86_400), displayedComponents: .date)
                    .font(.inter(14))
                    .environment(\.timeZone, AdWords.kuwait)
                Text(l.t("sponsor.runsFromHint", ["days": "\(row.days)"])).font(.footnote).foregroundStyle(Brand.muted)
            }
        }
    }

    private func submit() async {
        tried = true
        let api = app.services.api
        let words = reply.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        var done: String?
        var call: (() async throws -> Void)?
        switch act {
        case .approve:
            guard rules.rateProblem(rate) == nil, rules.payByProblem(payByDay, startsOn: row.startsOn, today: today) == nil else { return }
            done = "sponsor.approved"
            let input = API.SponsorApproval(id: row.id, dailyRate: rate.trimmingCharacters(in: .whitespaces), payBy: payByDay, reply: OrNull(words.isEmpty ? nil : words))
            call = { _ = try await api.call(API.sponsorApprove, input) }
        case .decline:
            guard !replyMissing else { return }
            busy = true
            var answer: SponsorRefund?
            let ok = await app.attempt(fallback: "admin.saveFailed") { answer = try await api.call(API.sponsorDecline, .init(id: row.id, reply: words)) }
            busy = false
            if ok { app.toast(answer?.refund.map { l.t("sponsor.declinedRefund", ["refund": $0.formatted(l.current)]) } ?? l.t("sponsor.declined")) }
            return finish(ok)
        case .transfer:
            guard rules.referenceProblem(reference) == nil else { return }
            done = "sponsor.transferSent"
            let input = API.SponsorTransfer(id: row.id, reference: reference.split(whereSeparator: \.isWhitespace).joined(separator: " "))
            call = { _ = try await api.call(API.sponsorSendTransfer, input) }
        case .confirm:
            done = "sponsor.confirmed"
            let input = API.SponsorConfirmation(id: row.id, startsOn: OrNull(startPassed ? AdWords.day(startsFrom) : nil))
            call = { _ = try await api.call(API.sponsorConfirm, input) }
        case .missing:
            guard !replyMissing, rules.payByProblem(payByDay, startsOn: row.startsOn, today: today) == nil else { return }
            done = "sponsor.notReceivedDone"
            let input = API.SponsorReply(id: row.id, reply: words, payBy: payByDay)
            call = { _ = try await api.call(API.sponsorNotReceived, input) }
        }
        guard let call else { return }
        busy = true
        _ = await app.attempt(done: done, fallback: "admin.saveFailed") { try await call() }
        busy = false
        /* A refusal (another person moved it first) closes the sheet too, so the page shows where it stands. */
        finish(true)
    }
}
