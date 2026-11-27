#if DEBUG
import SwiftUI

/// Debug only: the home screen widgets as the extension draws them
/// (`-NetLetOpen widgetProbe`), at the system's own sizes, in the app's
/// language and in both colour schemes — a widget is never on the CI's home
/// screen, so this is how it is photographed and read by a UI test. The
/// deals are made up from the department pictures and the app's own price
/// formatting; the order is the Lock Screen probe's.
struct WidgetProbe: View {
    @Environment(LanguageSettings.self) private var l

    private func price(_ fils: Int) -> String { Money(fils: fils).formatted(l.current) }

    private var deals: DealsWidgetContent {
        let samples: [(String, String, Int, Int)] = [
            ("electronics", "Wireless earbuds", 17_500, 25_000),
            ("home-and-kitchen", "Air fryer, 5 litres", 29_900, 39_900),
            ("beauty", "Rose face oil", 6_250, 8_500),
            ("style", "Linen shirt", 9_000, 12_000),
        ]
        return DealsWidgetContent(
            title: l.t("home.heroDeals"),
            deals: samples.map { slug, title, now, was in
                .init(handle: slug, title: title, price: price(now), was: price(was), percent: Int((Double(was - now) / Double(was) * 100).rounded()), photo: WebAssets.department(slug))
            },
            seeAll: l.t("home.viewAll"),
            emptyTitle: l.t("browse.noDeals"),
            emptyNote: l.t("browse.noDealsNote"),
            rightToLeft: l.current.isRightToLeft
        )
    }

    private var noDeals: DealsWidgetContent {
        var content = deals
        content.deals = []
        return content
    }

    private var order: OrderWidgetContent {
        let state = OrderActivityAttributes.ContentState(
            step: 2,
            arrived: false,
            headline: l.t("tracking.band", ["low": "15", "high": "20"]),
            detail: l.t("track.from", ["store": "\u{2068}Acme Electronics\u{2069}"]),
            minutes: l.t("ios.live.minutes", ["low": "15", "high": "20"]),
            labels: OrderActivityContent.labelKeys.map { l.t($0) },
            rightToLeft: l.current.isRightToLeft,
            staleLine: l.t("ios.live.stale"),
            title: l.t("ios.live.title", ["reference": "NL-20261104-HMGQQ"])
        )
        return OrderWidgetContent(heading: l.t("ios.widget.orderName"), showing: .order(state, stale: false), rightToLeft: l.current.isRightToLeft)
    }

    private var signedOut: OrderWidgetContent {
        OrderWidgetContent(heading: l.t("ios.widget.orderName"), showing: .nothing(title: l.t("ios.widget.signInTitle"), line: l.t("ios.widget.signInNote")), rightToLeft: l.current.isRightToLeft)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                HStack(spacing: 18) {
                    dealsFace(deals, .small, id: "widget-deals-small")
                    orderFace(order, .small, id: "widget-order-small")
                }
                dealsFace(deals, .medium, id: "widget-deals-medium")
                orderFace(order, .medium, id: "widget-order-medium")
                dealsFace(deals, .large, id: "widget-deals-large")
                dealsFace(deals, .medium, id: "widget-deals-dark")
                    .environment(\.colorScheme, .dark)
                HStack(spacing: 18) {
                    dealsFace(noDeals, .small, id: "widget-deals-empty")
                    orderFace(signedOut, .small, id: "widget-order-signed-out")
                }
            }
            .padding(.vertical, 60)
            .frame(maxWidth: .infinity)
        }
        .background(
            LinearGradient(colors: [Color(red: 0.45, green: 0.62, blue: 0.82), Color(red: 0.86, green: 0.62, blue: 0.55)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        )
    }

    /// The system's sizes on a 6.1-inch iPhone, and its widget corner.
    private static func frame(_ size: HomeWidgetSize) -> CGSize {
        switch size {
        case .small: CGSize(width: 158, height: 158)
        case .medium: CGSize(width: 338, height: 158)
        case .large: CGSize(width: 338, height: 354)
        }
    }

    private func dealsFace(_ content: DealsWidgetContent, _ size: HomeWidgetSize, id: String) -> some View {
        let box = Self.frame(size)
        return DealsWidgetView(content: content, size: size)
            .padding(16)
            .frame(width: box.width, height: box.height)
            .background(DealsWidgetGround())
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(id)
    }

    private func orderFace(_ content: OrderWidgetContent, _ size: HomeWidgetSize, id: String) -> some View {
        let box = Self.frame(size)
        return OrderWidgetView(content: content, size: size)
            .padding(16)
            .frame(width: box.width, height: box.height)
            .background(Brand.deepNavy)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(id)
    }
}
#endif
