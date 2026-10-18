import SwiftUI

/// The shopper's orders, each led by what is in it and where it is — the
/// account's Orders section, drawn as the web's section page.
struct OrdersView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { OrdersViewModel(service: app.services.orders) }) { model in
            ShopPage(refresh: { await model.load() }) {
                AccountSection(title: l.t("account.sectionOrders"), hint: l.t("account.hint.orders")) {
                    LoadStateView(state: model.orders, retry: { await model.load() }) { orders in
                        if orders.isEmpty {
                            EmptyStateView(
                                systemImage: "shippingbox",
                                title: l.t("orders.emptyTitle"),
                                note: l.t("orders.emptyBody"),
                                actionTitle: l.t("cart.keepBrowsing")
                            ) { app.goHome() }
                            .card(padding: 0)
                        } else {
                            LazyVStack(spacing: 10) {
                                ForEach(orders) { order in
                                    Button {
                                        app.push(.order(reference: order.reference))
                                    } label: {
                                        OrderRow(order: order)
                                            .padding(16)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                                            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                    }
                                    .buttonStyle(PressFillStyle(cornerRadius: 16))
                                }
                                if model.canLoadMore {
                                    ProgressView()
                                        .tint(Brand.navy)
                                        .frame(maxWidth: .infinity, minHeight: 60)
                                        .task { await model.loadMore() }
                                }
                            }
                        }
                    }
                }
            }
            .task { await model.load() }
        }
    }
}

/// A section of the account as the web's phone draws one: "← Your account",
/// the section's name and one line on what it holds, then the section.
struct AccountSection<Content: View>: View {
    let title: String
    let hint: String
    @ViewBuilder var content: () -> Content
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                app.openAccount(nil)
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.backward").font(.system(size: 14, weight: .semibold))
                    Text(l.t("account.backToAccount"))
                }
                .font(.inter(14, .semibold))
                .foregroundStyle(Brand.muted)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
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
            VStack(alignment: .leading, spacing: 4) {
                Text(OrderWording.progress(order.summary.progress, language: l))
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Brand.navy)
                if let first = order.summary.first {
                    let more = order.summary.lineCount - 1
                    Text(first.title + (more > 0 ? " " + l.t("orders.andMore", ["count": "\(more)"]) : ""))
                        .font(.subheadline)
                        .foregroundStyle(Brand.ink)
                        .lineLimit(2)
                }
                HStack(spacing: 6) {
                    Text(order.grandTotal.formatted(l.current)).font(.subheadline.weight(.semibold))
                    Text("·").foregroundStyle(Brand.muted)
                    Text(OrderWording.payment(status: order.status, language: l)).font(.footnote).foregroundStyle(Brand.muted)
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
}

/// One order: where each line is, what it cost, and where it is going.
struct OrderDetailView: View {
    let reference: String
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { OrderDetailViewModel(reference: reference, service: app.services.orders) }) { model in
            ShopPage(refresh: { await model.load() }) {
                VStack(alignment: .leading, spacing: 16) {
                    Breadcrumbs(trail: [l.t("account.sectionOrders"), reference])
                    Text(l.t("orders.orderHeading", ["reference": reference]))
                        .pageTitle()
                        .fixedSize(horizontal: false, vertical: true)
                    LoadStateView(state: model.detail, retry: { await model.load() }) { detail in
                        VStack(alignment: .leading, spacing: 16) {
                            lines(detail)
                            totals(detail.order)
                            delivery(detail.order)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .task { await model.load() }
        }
    }

    private func lines(_ detail: OrderDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(OrderWording.date(detail.order.placedAt, language: l.current)).font(.footnote).foregroundStyle(Brand.muted)
            ForEach(detail.lines) { line in
                HStack(alignment: .top, spacing: 12) {
                    Color.clear
                        .frame(width: 56, height: 56)
                        .overlay { RemoteImage(reference: line.photo) }
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(line.productTitle).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                        if let variant = line.variantLabel {
                            Text(variant).font(.caption).foregroundStyle(Brand.muted)
                        }
                        if let vendor = line.vendorName {
                            Text(l.t("browse.soldBy", ["name": vendor])).font(.caption).foregroundStyle(Brand.muted)
                        }
                        Text(l.t("orders.quantityAndPrice", ["quantity": "\(line.quantity)", "price": line.unitPrice.formatted(l.current)]))
                            .font(.caption)
                            .foregroundStyle(Brand.muted)
                        Text(OrderWording.line(line.fulfilment, language: l))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(line.fulfilment == "cancelled" || line.fulfilment == "returned" ? Brand.danger : Brand.navy)
                    }
                    Spacer()
                    Text(line.lineTotal.formatted(l.current)).font(.subheadline.weight(.bold)).foregroundStyle(Brand.navy)
                }
                if line.id != detail.lines.last?.id { Divider() }
            }
            if detail.lines.contains(where: { $0.fulfilment == "cancelled" }) {
                Text(l.t("orders.cancelledNotCharged")).font(.footnote).foregroundStyle(Brand.muted)
            }
        }
        .card()
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
