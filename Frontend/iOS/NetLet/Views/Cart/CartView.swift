import SwiftUI

/// The bag: each line with its stepper, each seller's delivery, the total the
/// server worked out, and Checkout under the thumb.
struct CartView: View {
    @Binding var path: NavigationPath
    @State private var pageBottom: CGFloat = .infinity
    @State private var buttonTop: CGFloat = 0
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let cart = app.cart.cart
        ShopPage(root: true, refresh: { await app.cart.refresh() }) {
            VStack(alignment: .leading, spacing: 0) {
                Breadcrumbs(trail: [l.t("cart.title")])
                Text(l.t("cart.title")).pageTitle().padding(.bottom, 24)
                if app.cart.settling && cart == nil {
                    // Never "empty" before it knows — somebody who just pressed Add would read it as a failure.
                    LoadingView().accessibilityLabel(l.t("cart.loading"))
                } else if let cart, !cart.isEmpty {
                    filled(cart)
                } else {
                    EmptyStateView(
                        systemImage: "bag",
                        title: l.t("cart.empty"),
                        note: l.t("cart.emptyNote"),
                        actionTitle: l.t("cart.keepBrowsing")
                    ) { app.goHome() }
                    .card(padding: 0)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 24)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onAppear { pageBottom = proxy.frame(in: .global).maxY }
                    .onChange(of: proxy.frame(in: .global).maxY) { _, bottom in pageBottom = bottom }
            }
        }
        .overlay(alignment: .bottom) {
            if let cart, !cart.isEmpty, buttonTop > pageBottom - 8 {
                bar(cart).transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: buttonTop > pageBottom - 8)
        .task(id: l.current) { await app.cart.refresh() }
    }

    private func filled(_ cart: Cart) -> some View {
        VStack(spacing: 14) {
            VStack(spacing: 0) {
                ForEach(cart.items) { item in
                    CartLineRow(item: item)
                    if item.id != cart.items.last?.id { Divider().padding(.vertical, 12) }
                }
            }
            .card()
            SummaryCard(cart: cart)
            checkoutButton(cart)
                .background {
                    GeometryReader { proxy in
                        Color.clear
                            .onAppear { buttonTop = proxy.frame(in: .global).minY }
                            .onChange(of: proxy.frame(in: .global).minY) { _, top in buttonTop = top }
                    }
                }
            Text(l.t("cart.checkoutNote"))
                .font(.inter(13))
                .foregroundStyle(Brand.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func checkoutButton(_ cart: Cart) -> some View {
        Button {
            path.append(Route.checkout)
        } label: {
            HStack(spacing: 8) {
                Text(l.t("cart.checkoutShort"))
                Text("·").accessibilityHidden(true)
                Text(cart.total.formatted(l.current))
            }
        }
        .buttonStyle(AccentButtonStyle())
    }

    /// The total and Checkout over the tab bar while the page's own button is
    /// still below the screen; they leave as it comes up to meet them.
    private func bar(_ cart: Cart) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t("cart.total")).font(.inter(12)).foregroundStyle(Brand.muted)
                Text(cart.total.formatted(l.current)).font(.inter(17, .heavy)).foregroundStyle(Brand.navy)
            }
            Button(l.t("cart.checkoutShort")) { path.append(Route.checkout) }
                .buttonStyle(AccentButtonStyle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(GlassCapsule())
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("cart.bar"))
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
