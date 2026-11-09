import SwiftUI

/// The shopper's orders, each led by what is in it and where it is — the
/// account's Orders section, drawn as the web's section page.
///
/// **It carries every tool somebody needs about what they bought, on the
/// owner's word** ("add these filter options at the top of the my order page
/// … I want the orders page to have all the tools that the user needs"): a
/// row of chips — All, Processing, On the way, Delivered, Cancelled, each with
/// how many it holds, then Returns and Reviews — a search by the order's
/// number or anything in it, and how far back to look. The server filters
/// over every order (`orders.list`, `Shared/commerce/orderFilters.ts`), so a
/// chip's number is what pressing it shows. **Returns and Reviews moved here
/// from the Profile tab**, also on the owner's word: they are lists of their
/// own (`ReturnsList`, `ReviewsList`) under their chips.
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
            ShopPage(header: false, refresh: { await model.loadAll() }) {
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

/// The top of My orders, drawn to the owner's reference (a shop's "Your
/// orders"), the web's `OrdersTop`: a bar with the way back, "Your orders" in
/// its middle and a search at its end; then the tabs as plain words in a row
/// that scrolls sideways — the chosen one dark with a short rounded line under
/// it that slides to the next, the rest muted, a hairline under the row. A tab
/// says it is chosen (`isSelected`), the web's `aria-pressed`. The search icon
/// opens the search and the period under the tabs on the orders' own views;
/// closing it clears both, so nothing narrows the list out of sight.
private struct OrdersTop: View {
    let model: OrdersViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var typed = ""
    @State private var sent = ""
    @State private var opened = false
    @FocusState private var searching: Bool

    private var tabs: [String] { ReferenceData.shared.rules.orders?.filterTabs ?? ["all", "processing", "onTheWay", "delivered", "returns", "cancelled", "reviews"] }
    private var periods: [String] { ReferenceData.shared.rules.orders?.filterPeriods ?? ["all", "30", "90", "180", "365"] }
    private var searchMax: Int { ReferenceData.shared.rules.orders?.searchMax ?? 80 }
    /// Whether the search row shows: opened, or holding something that narrows the list.
    private var searchShown: Bool { model.onOrders && (opened || !model.filters.q.isEmpty || model.filters.period != "all") }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            bar
            tabRow
            if searchShown {
                HStack(spacing: 8) {
                    searchField
                    periodMenu
                }
                .transition(.opacity)
            }
        }
        // The search sent once typing pauses; the box follows the model only
        // when something else changed it (Clear filters).
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
                if model.onOrders {
                    Button { toggleSearch() } label: {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(Brand.navy)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("orders.searchPlaceholder"))
                    .accessibilityValue(l.t(searchShown ? "ios.a11y.expanded" : "ios.a11y.collapsed"))
                }
            }
            .padding(.horizontal, -12)
        }
        .frame(minHeight: 44)
    }

    private var tabRow: some View {
        TextTabs(tabs: tabs.map { TextTab(id: $0, label: l.t(Self.label($0))) }, selection: model.tab) { tab in
            // The tab at once, so the line slides under it; the list is asked for after.
            model.pick(tab: tab)
            Task { await model.choose(tab: tab) }
        }
    }

    private func toggleSearch() {
        Haptics.tap()
        if searchShown {
            withAnimation(still ? nil : .snappy(duration: 0.22)) { opened = false }
            typed = ""
            sent = ""
            searching = false
            Task { await model.clearSearch() }
        } else {
            withAnimation(still ? nil : .snappy(duration: 0.22)) { opened = true }
            // The box exists a frame after the row opens.
            Task {
                try? await Task.sleep(for: .milliseconds(60))
                searching = true
            }
        }
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
        .padding(.leading, 12)
        .padding(.trailing, typed.isEmpty ? 12 : 2)
        .frame(minHeight: 44)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(searching ? Brand.navy : Brand.line, lineWidth: searching ? 1.5 : 1))
    }

    private var periodMenu: some View {
        Menu {
            ForEach(periods, id: \.self) { period in
                Button {
                    Haptics.tap()
                    Task { await model.choose(period: period) }
                } label: {
                    if model.filters.period == period {
                        Label(l.t(Self.periodLabel(period)), systemImage: "checkmark")
                    } else {
                        Text(l.t(Self.periodLabel(period)))
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(l.t(Self.periodLabel(model.filters.period)))
                    .font(.inter(14, .semibold))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Brand.muted)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            .fixedSize()
        }
        .accessibilityLabel(l.t("orders.periodLabel"))
        .accessibilityValue(l.t(Self.periodLabel(model.filters.period)))
    }

    static func label(_ tab: String) -> String {
        switch tab {
        case "processing": return "orders.viewProcessing"
        case "onTheWay": return "orders.viewOnTheWay"
        case "delivered": return "orders.viewDelivered"
        case "cancelled": return "orders.viewCancelled"
        case "returns": return "orders.viewReturns"
        case "reviews": return "orders.viewReviews"
        default: return "orders.viewAll"
        }
    }

    static func periodLabel(_ period: String) -> String {
        switch period {
        case "30": return "orders.period30"
        case "90": return "orders.period90"
        case "180": return "orders.period180"
        case "365": return "orders.period365"
        default: return "orders.periodAll"
        }
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
                OrderProgressPill(progress: order.summary.progress)
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
                        Text(how).font(.footnote).foregroundStyle(order.status == "paid" ? Brand.success : Brand.muted)
                    }
                }
                if !order.isOver, order.owed?.reduced == true {
                    Text(l.t("orders.cancelledNotCharged")).font(.caption).foregroundStyle(Brand.muted)
                }
                // Two runs, not one string: the reference reads left to right
                // and an Arabic date carries its own marks, and joined into one
                // line on the Arabic page the date came out scrambled.
                HStack(spacing: 6) {
                    Text(order.reference)
                        .font(.caption.monospaced())
                        .environment(\.layoutDirection, .leftToRight)
                    Text(OrderWording.date(order.placedAt, language: l.current))
                        .font(.caption)
                }
                .foregroundStyle(Brand.muted)
            }
        }
        .padding(.vertical, 6)
    }

    /// How it is paid, said only where it tells somebody something (`OrderTotal`).
    private var payment: String? {
        switch order.status {
        case "paid": return l.t("orders.statusPaid")
        case "refunded": return l.t("orders.statusRefunded")
        case "pending_payment" where order.shownTotal.fils > 0: return l.t("orders.payOnDelivery")
        default: return nil
        }
    }
}

/// Where an order is, as a pill with its icon — the web's `ProgressPill`.
struct OrderProgressPill: View {
    let progress: OrderProgress
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let look: (String, OrderTone) = {
            switch progress.kind {
            case "preparing": return ("shippingbox", .preparing)
            case "onTheWay", "partlyDelivered": return ("truck.box", .shipped)
            case "delivered": return ("checkmark.circle", .done)
            case "cancelled": return ("xmark.circle", .stopped)
            case "returned": return ("arrow.uturn.backward", .over)
            default: return ("clock", .waiting)
            }
        }()
        StatusPill(label: OrderWording.progress(progress, language: l), tone: look.1, systemImage: look.0)
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
    /// The sheet over the order — its own ⋯'s, or an item's.
    @State private var sheet: OrderSheet?
    /// The item whose return form is open under it.
    @State private var returning: Int?

    var body: some View {
        ModelHost(make: { OrderDetailViewModel(reference: reference, service: app.services.orders) }) { model in
            ShopPage(header: false, refresh: { await model.load() }) {
                VStack(alignment: .leading, spacing: 16) {
                    BackLink(label: l.t("invoice.back"))
                        .padding(.bottom, -8)
                    Text(l.t("orders.orderHeading", ["reference": reference]))
                        .pageTitle()
                        .fixedSize(horizontal: false, vertical: true)
                    if model.missing {
                        Text(l.t("orders.detailMissing"))
                            .font(.subheadline)
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        LoadStateView(state: model.detail, retry: { await model.load() }) { detail in
                            VStack(alignment: .leading, spacing: 16) {
                                OrderActionsBar(reference: reference, detail: detail, reload: { await model.load() }, sheet: $sheet) { line in
                                    rating = target(line)
                                }
                                lines(detail, reload: { await model.load() })
                                OrderDocumentsList(documents: detail.documents)
                                if detail.hasShipped { TrackingPanel(reference: reference) }
                                ParcelCareSection(reference: reference, detail: detail, reload: { await model.load() })
                                totals(detail.order)
                                delivery(detail.order)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .task { await model.load() }
            .sheet(item: $rating) { target in
                ReviewSheet(target: target) { Task { await model.load() } }
                    .languageDirection()
            }
        }
    }

    private func target(_ line: OrderLine) -> ReviewTarget {
        ReviewTarget(orderItemId: line.id, productTitle: line.productTitle, photo: line.photo, review: line.review)
    }

    private func lines(_ detail: OrderDetail, reload: @escaping () async -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(OrderWording.date(detail.order.placedAt, language: l.current)).font(.footnote).foregroundStyle(Brand.muted)
            ForEach(detail.lines) { line in
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .top, spacing: 12) {
                        Color.clear
                            .frame(width: 56, height: 56)
                            .overlay { RemoteImage(reference: line.photo) }
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
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
                            StatusPill(label: OrderWording.line(line.fulfilment, language: l), tone: OrderTone.line(line.fulfilment))
                            returnWindow(line)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // Everything that can be done with this item, on the owner's word.
                        OrderLineMenu(line: line, detail: detail, sheet: $sheet, returning: $returning) { rating = target(line) }
                            .padding(.top, -8)
                            .padding(.trailing, -8)
                    }
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

    private func totals(_ order: OrderRecord) -> some View {
        VStack(spacing: 8) {
            row(l.t("cart.subtotal"), order.itemsTotal)
            row(l.t("cart.delivery"), order.deliveryTotal)
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
                Text(OrderWording.payment(status: order.status, language: l)).font(.footnote.weight(.semibold))
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
/// web's `LineReview`. Writing one and changing it are the item's ⋯ ("Rate
/// this item", "Edit your review"), on the owner's word.
struct LineReviewRow: View {
    let line: OrderLine

    var body: some View {
        if let review = line.review {
            HStack(spacing: 8) {
                StarsView(rating: review.rating)
                ReviewStatePill(state: review.state)
            }
        }
    }
}
