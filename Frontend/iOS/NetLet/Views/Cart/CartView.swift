import SwiftUI

/// The bag: each line with its stepper, each seller's delivery, the total the
/// server worked out, and Checkout under the thumb.
struct CartView: View {
    @Binding var path: NavigationPath
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            if app.cart.settling && app.cart.cart == nil {
                // Never "empty" before it knows — somebody who just pressed Add would read it as a failure.
                LoadingView().accessibilityLabel(l.t("cart.loading"))
            } else if let cart = app.cart.cart, !cart.isEmpty {
                filled(cart)
            } else {
                EmptyStateView(
                    systemImage: "bag",
                    title: l.t("cart.empty"),
                    note: l.t("cart.emptyNote"),
                    actionTitle: l.t("cart.keepBrowsing")
                ) { app.selectedTab = .home }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.pearl.ignoresSafeArea())
        .navigationTitle(l.t("cart.title"))
        .refreshable { await app.cart.refresh() }
        .task(id: l.current) { await app.cart.refresh() }
    }

    private func filled(_ cart: Cart) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                VStack(spacing: 0) {
                    ForEach(cart.items) { item in
                        CartLineRow(item: item)
                        if item.id != cart.items.last?.id { Divider().padding(.vertical, 10) }
                    }
                }
                .card()
                SummaryCard(cart: cart)
                Text(l.t("cart.checkoutNote"))
                    .font(.footnote)
                    .foregroundStyle(Brand.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)
        }
        .safeAreaInset(edge: .bottom) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(l.t("cart.total")).font(.caption).foregroundStyle(Brand.muted)
                    Text(cart.total.formatted(l.current)).font(.headline.weight(.bold)).foregroundStyle(Brand.navy)
                }
                Button {
                    path.append(Route.checkout)
                } label: {
                    Text(l.t("cart.checkoutShort"))
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.regularMaterial)
            .overlay(alignment: .top) { Divider() }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("cart.bar"))
        }
    }
}

struct CartLineRow: View {
    let item: CartItem
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let title = item.title(l.current)
        HStack(alignment: .top, spacing: 12) {
            NavigationLink(value: Route.product(handle: item.productHandle)) {
                Color.clear
                    .frame(width: 76, height: 76)
                    .overlay { RemoteImage(reference: item.image?.url, label: title) }
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink).lineLimit(2)
                if let variant = item.variantLabel {
                    Text(variant).font(.caption).foregroundStyle(Brand.muted)
                }
                if let bundle = item.bundleName {
                    Text(bundle).font(.caption).foregroundStyle(Brand.muted)
                }
                ForEach(item.addons ?? [], id: \.id) { addon in
                    Text("+ " + addon.label).font(.caption).foregroundStyle(Brand.muted)
                }
                HStack {
                    QuantityStepper(
                        quantity: item.quantity,
                        maximum: ReferenceData.shared.rules.maxLineQuantity,
                        name: title,
                        busy: app.cart.busyLine == item.lineId,
                        compact: true
                    ) { next in
                        Task {
                            await app.cart.setQuantity(lineId: item.lineId, to: next)
                            if next == 0 { announce(l.t("cart.removedName", ["name": title])) }
                        }
                    }
                    Spacer()
                    Text(item.lineTotal.formatted(l.current))
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Brand.navy)
                }
            }
        }
    }
}

/// Subtotal, each seller's delivery and the total — every figure the server's.
struct SummaryCard: View {
    let cart: Cart
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 10) {
            row(l.t("cart.subtotal"), cart.subtotal.formatted(l.current))
            ForEach(Array(cart.delivery.perVendor.enumerated()), id: \.offset) { _, line in
                let name = line.storeName(l.current)
                VStack(alignment: .leading, spacing: 4) {
                    row(l.t("cart.deliveryFrom", ["name": name]), line.free || line.fee.isZero ? l.t("cart.deliveryFree") : line.fee.formatted(l.current))
                    if let toFree = line.toFree, !toFree.isZero {
                        Text(l.t("cart.deliveryToFree", ["amount": toFree.formatted(l.current), "name": name]))
                            .font(.caption)
                            .foregroundStyle(Brand.accentInk)
                    }
                }
            }
            Divider()
            row(l.t("cart.total"), cart.total.formatted(l.current), bold: true)
        }
        .card()
    }

    private func row(_ label: String, _ value: String, bold: Bool = false) -> some View {
        HStack {
            Text(label).foregroundStyle(bold ? Brand.ink : Brand.muted)
            Spacer()
            Text(value).foregroundStyle(Brand.navy)
        }
        .font(bold ? .headline.weight(.bold) : .subheadline)
    }
}
