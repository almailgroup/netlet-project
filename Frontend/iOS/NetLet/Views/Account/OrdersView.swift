import QuickLook
import SwiftUI

/// The shopper's orders, each led by what is in it and where it is — the
/// account's Orders section, drawn as the web's section page.
///
/// **Its top is a search bar with a filter button beside it, on the owner's
/// word** ("all bar up removed, only add search bar and in the side filter"):
/// the search finds an order by its number, anything in it or its store, and
/// the filter page holds the order's status, the last 30 days or 3 months or
/// two days of one's own, a year, and Returns and Reviews — lists of their own
/// (`ReturnsList`, `ReviewsList`) that moved here from the Profile tab. The
/// server filters over every order (`orders.list`,
/// `Shared/commerce/orderFilters.ts`).
struct OrdersView: View {
    /// The chip to open on: "returns" or "reviews" from their old addresses.
    var initialTab = "all"
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: {
            OrdersViewModel(
                service: app.services.orders,
                tab: initialTab,
                returns: { [api = app.services.api] in try await api.call(API.shopperReturns) },
                reviews: { [api = app.services.api] in try await api.call(API.reviewableLines) }
            )
        }) { model in
            ShopPage(header: false, refresh: { await model.loadAll() }, viewSource: "account") {
                VStack(alignment: .leading, spacing: 14) {
                    OrdersTop(model: model)
                    switch model.tab {
                    case "returns": ReturnsList(returns: model.returns)
                    case "reviews": ReviewsList(lines: model.reviews)
                    default: orderList(model)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .task { await model.loadAll() }
        }
    }

    @ViewBuilder
    private func orderList(_ model: OrdersViewModel) -> some View {
        LoadStateView(state: model.orders, retry: { await model.load() }) { orders in
            if orders.isEmpty {
                if model.narrowed {
                    EmptyStateView(
                        systemImage: "magnifyingglass",
                        title: l.t("orders.noMatchTitle"),
                        note: l.t("orders.noMatchBody"),
                        actionTitle: l.t("orders.clearFilters")
                    ) { Task { await model.clearFilters() } }
                    .card(padding: 0)
                } else {
                    EmptyStateView(
                        systemImage: "shippingbox",
                        title: l.t("orders.emptyTitle"),
                        note: l.t("orders.emptyBody"),
                        actionTitle: l.t("cart.keepBrowsing")
                    ) { app.goHome() }
                    .card(padding: 0)
                }
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(orders) { order in
                        VStack(alignment: .leading, spacing: 0) {
                            Button {
                                app.push(.order(reference: order.reference))
                            } label: {
                                OrderRow(order: order)
                                    .padding(16)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                            .buttonStyle(PressFillStyle(cornerRadius: 16))
                            // Request a refund from the list, on the owner's word:
                            // on an order with something that can still go back,
                            // opening it with its refund sheet up — the web's row.
                            // Rate what arrived, from the list too (the owner's "rate
                            // and review … from the My Orders section"): opening it with
                            // the first item to rate in its sheet.
                            let refundable = app.features.isOn("returns") && (order.summary.refundable ?? 0) > 0
                            let rateable = (order.summary.reviewable ?? 0) > 0
                            if refundable || rateable {
                                HStack(spacing: 8) {
                                    Spacer(minLength: 0)
                                    if rateable {
                                        Button {
                                            app.orderSheet = "rate"
                                            app.push(.order(reference: order.reference))
                                        } label: {
                                            Label(l.t("orders.rateItems"), systemImage: "star")
                                        }
                                        .buttonStyle(OrderActionStyle())
                                        .accessibilityLabel(l.t("orders.rateItems") + ": " + (order.summary.first?.title ?? order.reference))
                                    }
                                    if refundable {
                                        Button {
                                            app.orderSheet = "refund"
                                            app.push(.order(reference: order.reference))
                                        } label: {
                                            Label(l.t("orders.requestRefund"), systemImage: "arrow.uturn.backward")
                                        }
                                        .buttonStyle(OrderActionStyle())
                                        .accessibilityLabel(l.t("orders.requestRefund") + ": " + (order.summary.first?.title ?? order.reference))
                                    }
                                }
                                .padding(.horizontal, 16)
                                .padding(.bottom, 14)
                            }
                        }
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                    }
                    if model.canLoadMore {
                        ProgressView()
                            .tint(Brand.navy)
                            .frame(maxWidth: .infinity, minHeight: 60)
                            .task { await model.loadMore() }
                    }
                    if model.atCeiling {
                        Text(l.t("orders.atCeiling"))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

/// The top of My orders: a bar with the way back and "Your orders", then the
/// search bar with the filter button beside it — **no tabs and no sort, on the
/// owner's word** ("all bar up removed, only add search bar and in the side
/// filter"), the web's `OrdersTop`. The statuses, the dates and the returns
/// and reviews are on the filter page (`OrderFilterButton`); each filter that
/// is on is a chip under the bar (`OrderFilterTokens`). The search finds an
/// order by its number, anything in it or its store.
private struct OrdersTop: View {
    let model: OrdersViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var sent = ""
    @FocusState private var searching: Bool

    private var searchMax: Int { ReferenceData.shared.rules.orders?.searchMax ?? 80 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            bar
            HStack(spacing: 10) {
                searchField
                OrderFilterButton(model: model)
            }
            OrderFilterTokens(model: model)
        }
        // The search sent once typing pauses; the box follows the model only
        // when something else changed it (Clear all).
        .task(id: typed) {
            let value = String(typed.trimmingCharacters(in: .whitespacesAndNewlines).prefix(searchMax))
            guard value != sent else { return }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            sent = value
            await model.search(value)
        }
        .onChange(of: model.filters.q) { _, q in
            if q != sent { sent = q; typed = q }
        }
        .onAppear { typed = model.filters.q; sent = model.filters.q }
    }

    private var bar: some View {
        // The account's home is behind this one when it is the Profile tab's first push.
        let toAccount = app.selectedTab == .account && app.accountPath.count <= 1
        return ZStack {
            Text(l.t("orders.pageTitle"))
                .font(.inter(19, .bold))
                .foregroundStyle(Brand.navy)
                .lineLimit(1)
                .padding(.horizontal, 52)
                .accessibilityAddTraits(.isHeader)
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "chevron.backward")
                        .font(.system(size: 21, weight: .medium))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t(toAccount ? "account.backToAccount" : "nav.back"))
                Spacer(minLength: 0)
            }
            .padding(.horizontal, -12)
        }
        .frame(minHeight: 44)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Brand.muted)
                .accessibilityHidden(true)
            TextField(l.t("orders.searchPlaceholder"), text: $typed)
                .font(.inter(15))
                .foregroundStyle(Brand.navy)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($searching)
                .onSubmit {
                    let value = String(typed.trimmingCharacters(in: .whitespacesAndNewlines).prefix(searchMax))
                    sent = value
                    Task { await model.search(value) }
                }
                .accessibilityLabel(l.t("orders.searchLabel"))
                .accessibilityIdentifier("orders-search")
            if !typed.isEmpty {
                Button {
                    typed = ""
                    sent = ""
                    Task { await model.search("") }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(Brand.muted)
                        .frame(width: 36, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("orders.searchClear"))
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, typed.isEmpty ? 14 : 4)
        .frame(minHeight: 48)
        .background(Capsule().fill(Color.white))
        .overlay(Capsule().strokeBorder(searching ? Brand.navy : Brand.line, lineWidth: searching ? 1.5 : 1))
    }
}

/// A section of the account as the web's phone draws one: a way back, the
/// section's name and one line on what it holds, then the section.
///
/// **The way back goes back, on the owner's word** — one screen, to wherever
/// the section was opened from: the account's home ("← Your account"), or
/// the page whose bell or heart opened it ("← Back"). It used to open the
/// Profile tab's home from anywhere, so a section opened from Home's bell
/// went back to Profile.
struct AccountSection<Content: View>: View {
    let title: String
    let hint: String
    @ViewBuilder var content: () -> Content
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        // The account's home is behind this one when it is the Profile tab's first push.
        let toAccount = app.selectedTab == .account && app.accountPath.count <= 1
        VStack(alignment: .leading, spacing: 0) {
            BackLink(label: l.t(toAccount ? "account.backToAccount" : "nav.back"))
                .padding(.bottom, 8)
            Text(title).pageTitle()
            Text(hint)
                .font(.inter(15))
                .lineSpacing(4)
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
                .padding(.bottom, 24)
            content()
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 48)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// "← Your account", "← Your orders": one screen back, the account's own way
/// back on a page that draws no header.
struct BackLink: View {
    let label: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Button {
            dismiss()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "arrow.backward").font(.system(size: 14, weight: .semibold))
                Text(label)
            }
            .font(.inter(14, .semibold))
            .foregroundStyle(Brand.muted)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
    }
}

struct OrderRow: View {
    let order: OrderSummary
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        // The order's main facts alone, on the owner's word: its items have
        // their own delivery times, so where each is is drawn under it once
        // the order is opened (`ItemStatusTile`).
        summaryRow
    }

    private var summaryRow: some View {
        HStack(alignment: .top, spacing: 12) {
            Color.clear
                .frame(width: 64, height: 64)
                .overlay { RemoteImage(reference: order.summary.photos.first) }
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    if order.summary.lineCount > 1 {
                        Text("+\(order.summary.lineCount - 1)")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .background(Capsule().fill(Brand.navy))
                            .padding(3)
                    }
                }
            VStack(alignment: .leading, spacing: 5) {
                if let first = order.summary.first {
                    let more = order.summary.lineCount - 1
                    Text(first.title + (more > 0 ? " " + l.t("orders.andMore", ["count": "\(more)"]) : ""))
                        .font(.subheadline)
                        .foregroundStyle(Brand.ink)
                        .lineLimit(2)
                }
                HStack(spacing: 6) {
                    Text(order.shownTotal.formatted(l.current)).font(.subheadline.weight(.semibold))
                    if let how = payment {
                        Text("·").foregroundStyle(Brand.muted)
                        Text(how).font(.footnote).foregroundStyle(order.status == "paid" || paidOnline ? Brand.success : Brand.muted)
                    }
                }
                if !order.isOver, order.owed?.reduced == true {
                    Text(l.t("orders.cancelledNotCharged")).font(.caption).foregroundStyle(Brand.muted)
                }
                // When it was ordered, on every order and in words of its own,
                // on the owner's word ("the order date should be shown on all
                // orders") — the list is newest first. The reference under it
                // reads left to right on either page.
                Text(l.t("orders.orderedOn", ["date": OrderWording.date(order.placedAt, language: l.current)]))
                    .font(.inter(13, .semibold))
                    .foregroundStyle(JourneyStreet.passed)
                Text(order.reference)
                    .font(.caption.monospaced())
                    .foregroundStyle(Brand.muted)
                    .environment(\.layoutDirection, .leftToRight)
            }
        }
        .padding(.top, 6)
    }

    /// How it is paid, said only where it tells somebody something (`OrderTotal`).
    /// Paid online instead (0086): the order is still unpaid on the books, and
    /// the driver collects nothing.
    private var paidOnline: Bool { order.status == "pending_payment" && OnlineMethodWords.online.contains(order.paymentMethod) }

    private var payment: String? {
        switch order.status {
        case "paid": return l.t("orders.statusPaid")
        case "refunded": return l.t("orders.statusRefunded")
        case "pending_payment" where paidOnline: return l.t("orders.paidOnline")
        case "pending_payment" where order.shownTotal.fils > 0: return l.t("orders.payOnDelivery")
        default: return nil
        }
    }
}

/// One order: where each line is and what can be done about it — a return,
/// a delivery rating, a damage report, the driver on a map, the invoice —
/// then what it cost and where it is going. The web's opened order.
///
/// **No header and no search, on the owner's word** — an order is the
/// account's, drawn as its sections are, with "← Your orders" for the way back.
struct OrderDetailView: View {
    let reference: String
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    /// The line being rated in `ReviewSheet`.
    @State private var rating: ReviewTarget?
    /// The sheet over the order — the chosen items', or a hook's.
    @State private var sheet: OrderSheet?
    /// "Cancel this order?", asked from the bar's Cancel order.
    @State private var askingCancel = false
    /// The item whose return form is open under it.
    @State private var returning: Int?
    /// The order's receipt as a PDF, made on the press and shown in Quick Look.
    @State private var receipt = OrderReceiptModel()
    /// The items chosen by their circles, the cart's own (on the owner's word).
    @State private var chosen: Set<Int> = []
    /// The circles are out only while the order is being edited — "Edit order"
    /// on the "In this order" row, on the owner's word.
    @State private var editing = false
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        ModelHost(make: { OrderDetailViewModel(reference: reference, service: app.services.orders) }) { model in
            // The assistant steps aside while the bar of the chosen items has the foot.
            ShopPage(header: false, refresh: { await model.load() }, assistant: chosen.isEmpty, viewSource: "account") {
                VStack(alignment: .leading, spacing: 16) {
                    BackLink(label: l.t("invoice.back"))
                        .padding(.bottom, -8)
                    title(model)
                    if model.missing {
                        Text(l.t("orders.detailMissing"))
                            .font(.subheadline)
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        LoadStateView(state: model.detail, retry: { await model.load() }) { detail in
                            VStack(alignment: .leading, spacing: 16) {
                                OrderActionsBar(reference: reference, detail: detail, reload: { await model.load() }, sheet: $sheet, onRate: { line in
                                    rating = target(line)
                                }, chosen: $chosen, editing: $editing, askingCancel: $askingCancel)
                                lines(detail, reload: { await model.load() })
                                if !detail.documents.isEmpty { OrderDocumentsList(documents: detail.documents) }
                                if detail.hasShipped { TrackingPanel(reference: reference) }
                                ParcelCareSection(reference: reference, detail: detail, reload: { await model.load() })
                                totals(detail.order, tax: detail.tax)
                                delivery(detail.order)
                            }
                            .onAppear {
                                // The screenshots' `receipt:` hook: the receipt made and shown.
                                guard app.orderSheet == "receipt" else { return }
                                app.orderSheet = nil
                                makeReceipt(detail)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                // Room under the last card while the bar of the chosen items is
                // up: its head and about 91 points a row of four options.
                .padding(.bottom, chosen.isEmpty ? 48 : barRoom(model.detail.value))
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .overlay(alignment: .bottom) {
                ZStack(alignment: .bottom) {
                    if let detail = model.detail.value, !chosen.isEmpty {
                        ChosenItemsBar(detail: detail, chosen: $chosen, onClose: { stopEditing() }) { offer in
                            run(offer, detail: detail)
                        }
                        .padding(.horizontal, 12)
                        .padding(.bottom, 12)
                        .floatsAtFoot()
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .animation(still ? nil : .snappy(duration: 0.25), value: chosen.isEmpty)
            }
            .task { await model.load() }
            .sheet(item: $rating) { target in
                ReviewSheet(target: target) { Task { await model.load() } }
                    .languageDirection()
            }
            .quickLookPreview($receipt.shown)
        }
    }

    /// The room the bar of the chosen items needs under the last card: its
    /// head and about 91 points for each row of four options it holds.
    private func barRoom(_ detail: OrderDetail?) -> CGFloat {
        guard let detail else { return 260 }
        let count = OrderSelection.offers(detail, chosen: chosen, returnsOn: app.features.isOn("returns")).count
        return 96 + 91 * CGFloat(max(1, (count + 3) / 4))
    }

    /// The circles away, with the choice (the bar's Close, on the owner's word).
    private func stopEditing() {
        withAnimation(still ? nil : .snappy(duration: 0.25)) {
            chosen = []
            editing = false
        }
    }

    /// A press on an item chooses it or puts it back, and opens the editing
    /// when it is not open yet — the owner's earlier "tap anywhere on the
    /// product chooses it", kept with the circles put away.
    private func toggle(_ id: Int) {
        withAnimation(still ? nil : .snappy(duration: 0.25)) {
            editing = true
            if chosen.contains(id) { chosen.remove(id) } else { chosen.insert(id) }
        }
    }

    /// The receipt, made and shown; a toast if it could not be drawn.
    private func makeReceipt(_ detail: OrderDetail) {
        Task {
            if await receipt.make(detail, language: l) == false { app.toast(l.t("receipt.failed")) }
        }
    }

    /// What a press on the bar does: one item's act about that item, several
    /// at once over the order — and the item's return form opens under it.
    private func run(_ offer: OrderSelection.Offer, detail: OrderDetail) {
        let ids = offer.lineIds
        let one = ids.count == 1 ? ids.first : nil
        func open(_ kind: OrderSheet.Kind, remove: Bool = false) {
            sheet = one.map { OrderSheet(kind: kind, lineId: $0, remove: remove) } ?? OrderSheet(kind: kind, lineIds: ids, remove: remove)
        }
        switch offer.action {
        case .return:
            returning = ids.first
        case .refund: sheet = OrderSheet(kind: .refund, lineIds: ids)
        case .warranty: open(.warranty)
        case .quantity: open(.modify)
        case .cancelItems: open(.modify, remove: true)
        // The whole order's, whatever is chosen.
        case .modify: sheet = OrderSheet(kind: .modify)
        case .address: sheet = OrderSheet(kind: .address)
        case .cancelOrder: askingCancel = true
        case .rate:
            let lines = detail.lines.map { (id: $0.id, reviewed: $0.review != nil) }
            if let first = OrderSelection.firstToRate(lines, among: ids), let line = detail.lines.first(where: { $0.id == first }) {
                rating = target(line)
            }
        case .buyAgain:
            Task { await buyAgain(ids, detail: detail) }
        case .help:
            sheet = chosen.count == 1 ? OrderSheet(kind: .help, lineId: chosen.first) : OrderSheet(kind: .help)
        }
    }

    /// The chosen items back in the bag, each at what was ordered of it and
    /// today's price; one no longer for sale is left out and said.
    private func buyAgain(_ ids: [Int], detail: OrderDetail) async {
        let lines = detail.lines.filter { ids.contains($0.id) && $0.variantId != nil }
        var added = 0
        for line in lines {
            if let variant = line.variantId, await app.cart.add(variantId: String(variant), quantity: line.quantity) { added += 1 }
        }
        guard added > 0 else {
            Haptics.refused()
            app.toast(l.t("orders.buyAgainNone"))
            return
        }
        Haptics.succeeded()
        chosen.subtract(ids)
        var said = l.t("orders.buyAgainDone", ["count": "\(added)"])
        if added < ids.count { said += "\n" + l.t("orders.buyAgainSomeLeft") }
        app.toast(said)
    }

    private func target(_ line: OrderLine) -> ReviewTarget {
        ReviewTarget(orderItemId: line.id, productTitle: line.productTitle, photo: line.photo, review: line.review)
    }

    /// The order's title with its receipt at the line's end, and when it was
    /// ordered under it — both on the owner's word ("move the download pdf
    /// option … to here, and include the date of the order as well"). The
    /// reference stays on one line (it is read down a phone), drawn smaller
    /// rather than broken when the button leaves it less room; until the
    /// order arrives the button's and the date's room is kept, so nothing
    /// moves when they come.
    private func title(_ model: OrderDetailViewModel) -> some View {
        let detail = model.detail.value
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 10) {
                Text(l.t("orders.orderHeading", ["reference": reference]))
                    .pageTitle()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let detail {
                    OrderReceiptButton(model: receipt) { makeReceipt(detail) }
                } else if !model.missing {
                    Color.clear.frame(width: 48, height: 48).accessibilityHidden(true)
                }
            }
            if let detail {
                Text(l.t("orders.orderedOn", ["date": OrderWording.date(detail.order.placedAt, language: l.current)]))
                    .font(.inter(14, .semibold))
                    .foregroundStyle(JourneyStreet.passed)
                    .accessibilityIdentifier("order-placed-on")
            } else if !model.missing {
                Text(l.t("orders.orderedOn", ["date": OrderWording.date(Date(), language: l.current)]))
                    .font(.inter(14, .semibold))
                    .redacted(reason: .placeholder)
                    .accessibilityHidden(true)
            }
        }
    }

    private func lines(_ detail: OrderDetail, reload: @escaping () async -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if !detail.deliverySlots.isEmpty {
                // The day and time asked of each store, said as the shopper's own.
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(detail.deliverySlots.enumerated()), id: \.offset) { _, asked in
                        let vendor = detail.lines.first { $0.vendorId != nil && $0.vendorId == asked.vendorId }?.vendorName
                        let when = l.t("storeDelivery.preferred", ["slot": SlotWords.slot(asked.slot, l)])
                        Label {
                            Text(vendor.map { l.t("delivery.parcelFrom", ["vendor": "\u{2068}\($0)\u{2069}"]) + " · " + when } ?? when)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "calendar").foregroundStyle(Brand.navy)
                        }
                        .font(.inter(13, .semibold))
                        .foregroundStyle(Brand.body)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(red: 247 / 255, green: 249 / 255, blue: 252 / 255)))
            }
            ForEach(detail.lines) { line in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 10) {
                        // Chosen for the bar's acts, the cart's own circle (on the
                        // owner's word) — out only while the order is being edited.
                        if editing {
                            ChoiceCircle(state: chosen.contains(line.id) ? .all : .none, label: l.t("select.item", ["name": line.productTitle])) { on in
                                if on { chosen.insert(line.id) } else { chosen.remove(line.id) }
                            }
                            .padding(.leading, -12)
                            .padding(.trailing, -4)
                            .padding(.top, 6)
                            .transition(still ? .identity : .scale(scale: 0.6).combined(with: .opacity))
                        }
                        // The photo, and under it where the item is — once it
                        // has arrived, its review (on the owner's word).
                        VStack(spacing: 8) {
                            Color.clear
                                .frame(width: 56, height: 56)
                                .overlay { RemoteImage(reference: line.photo) }
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            ItemStatusTile(
                                progress: ReceiptRules.progress(status: detail.order.status, lines: [(fulfilment: line.fulfilment, deliveredAt: line.deliveredAt, preordered: line.preordered ?? false)]),
                                rating: line.review?.rating,
                                mayRate: line.mayRate,
                                title: line.productTitle
                            ) {
                                rating = target(line)
                            }
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(line.productTitle).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                                .fixedSize(horizontal: false, vertical: true)
                            if let variant = line.variantLabel {
                                Text(variant).font(.caption).foregroundStyle(Brand.muted)
                            }
                            if let vendor = line.vendorName {
                                Text(l.t("browse.soldBy", ["name": vendor])).font(.caption).foregroundStyle(Brand.muted)
                            }
                            if let destination = line.destination {
                                Text(l.t("address.lineWent", ["label": destination.label])).font(.caption).foregroundStyle(Brand.muted)
                            }
                            Text(l.t("orders.quantityAndPrice", ["quantity": "\(line.quantity)", "price": line.unitPrice.formatted(l.current)]))
                                .font(.caption)
                                .foregroundStyle(Brand.muted)
                            // The product's own code (0074), as frozen at the sale.
                            if let code = line.discountCode, let off = line.discountAmount, !off.isZero {
                                Text(l.t("orders.lineCode", ["code": code, "amount": off.formatted(l.current)]))
                                    .font(.inter(12, .bold))
                                    .foregroundStyle(Brand.success)
                            }
                            Text(line.lineTotal.formatted(l.current)).font(.subheadline.weight(.bold)).foregroundStyle(Brand.navy)
                            // When this item is expected, while it is still coming.
                            LineExpected(line: line, detail: detail)
                            returnWindow(line)
                        }
                        // What can be done with it is the bar's, once its circle
                        // is chosen: the item has no ⋯ of its own (on the owner's word).
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    // A press anywhere on the item — its photo, its name, its
                    // price — chooses it or puts it back, on the owner's word
                    // ("when you tap on its name or anywhere near that specific
                    // product, it should automatically choose it"). The circle
                    // is still the one control VoiceOver meets; it is a button,
                    // so a press on it is its own and never counted twice.
                    .contentShape(Rectangle())
                    .onTapGesture {
                        Haptics.tap()
                        toggle(line.id)
                    }
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Brand.navy.opacity(chosen.contains(line.id) ? 0.05 : 0))
                            .padding(-6)
                    )
                    .animation(.easeOut(duration: 0.15), value: chosen.contains(line.id))
                    LineReviewRow(line: line)
                    LineReturnPanel(reference: reference, line: line, detail: detail, reload: reload, open: Binding(
                        get: { returning == line.id },
                        set: { returning = $0 ? line.id : nil }
                    ))
                }
                Divider()
            }
            Text(l.t(app.features.isOn("returns") ? "returns.howTo" : "returns.howToPaused", ["days": "\(detail.windowDays)"]))
                .font(.footnote)
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            if detail.lines.contains(where: { $0.fulfilment == "cancelled" }) {
                Text(l.t("orders.cancelledNotCharged")).font(.footnote).foregroundStyle(Brand.muted)
            }
        }
        .card()
        .onAppear {
            // The screenshots' `orderChosen:` hook: every item chosen, the bar up.
            if app.orderSheet == "chooseAll" {
                app.orderSheet = nil
                editing = true
                chosen = Set(detail.lines.map(\.id))
                return
            }
            // The orders list's "Rate your items": the first item to rate, in its sheet.
            guard app.orderSheet == "rate" else { return }
            app.orderSheet = nil
            if let line = detail.lines.first(where: \.mayRate) { rating = target(line) }
        }
    }

    /// Whether the line can still go back, and until when — or why not.
    @ViewBuilder
    private func returnWindow(_ line: OrderLine) -> some View {
        if let state = line.returnState {
            if state.returnable, let closes = state.closesAt {
                Label(
                    l.t("returns.openUntil", ["date": OrderWording.date(closes, language: l.current), "days": "\(state.daysLeft ?? 0)"]),
                    systemImage: "arrow.uturn.backward"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(Brand.success)
            } else if let reason = state.reason {
                Text(l.t(reason)).font(.caption).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func totals(_ order: OrderRecord, tax: OrderTax?) -> some View {
        VStack(spacing: 8) {
            row(l.t("cart.subtotal"), order.itemsTotal)
            row(l.t("cart.delivery"), order.deliveryTotal)
            if let tax, !tax.amount.isZero { row(l.t("summary.tax", ["rate": TaxWording.rateLabel(tax.rate)]), tax.amount) }
            if !order.discountValue.isZero { row(l.t("checkout.discountRow"), Money(fils: -order.discountValue.fils)) }
            if !order.pointsValue.isZero { row(l.t("checkout.pointsRow"), Money(fils: -order.pointsValue.fils)) }
            if !order.giftCardValue.isZero { row(l.t("checkout.giftCardRow"), Money(fils: -order.giftCardValue.fils)) }
            Divider()
            HStack {
                Text(l.t("cart.total")).font(.headline)
                Spacer()
                Text(order.grandTotal.formatted(l.current)).font(.headline.weight(.bold)).foregroundStyle(Brand.navy)
            }
            HStack {
                Text(l.t("checkout.paymentMethod")).font(.footnote).foregroundStyle(Brand.muted)
                Spacer()
                Text(OrderWording.payment(status: order.status, method: order.paymentMethod, language: l)).font(.footnote.weight(.semibold))
            }
        }
        .card()
    }

    private func delivery(_ order: OrderRecord) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("checkout.deliveryDetails")).font(.headline).foregroundStyle(Brand.navy)
            if let name = order.contactName { Text(name).font(.subheadline) }
            if let phone = order.contactPhone {
                Text(phone).font(.subheadline).environment(\.layoutDirection, .leftToRight)
            }
            if let governorate = ReferenceData.shared.governorate(id: order.deliveryZoneId) {
                Text(governorate.name(l.current)).font(.subheadline)
            }
            if let line = order.addressLine { Text(line).font(.subheadline).foregroundStyle(Brand.muted) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func row(_ label: String, _ amount: Money) -> some View {
        HStack {
            Text(label).font(.subheadline).foregroundStyle(Brand.muted)
            Spacer()
            Text(amount.formatted(l.current)).font(.subheadline).foregroundStyle(Brand.ink)
        }
    }
}

/// An item's review, once written: its stars and where it stands — the
/// web's `LineReview`. Writing one and changing it are the bar's Rate, once
/// the item's circle is chosen.
struct LineReviewRow: View {
    let line: OrderLine

    var body: some View {
        // Where the review stands; its stars are under the photo, with Edit.
        if let review = line.review {
            ReviewStatePill(state: review.state)
        }
    }
}
