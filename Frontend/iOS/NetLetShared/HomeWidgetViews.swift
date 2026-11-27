import SwiftUI
import UIKit

/// The home screen widgets' faces, compiled into the extension that shows
/// them and into the app, whose probe draws them for the screenshots
/// (`-NetLetOpen widgetProbe`). Every word arrives composed — by the
/// extension from its own copy of the dictionary's words (`WidgetWords`), by
/// the app from its own — so these views hold no sentence of their own.

/// Which of the system's sizes a face is drawn for.
enum HomeWidgetSize: CaseIterable, Sendable {
    case small, medium, large
}

/// Where a press on a widget goes, in the app (`Route.from(link:)`).
enum WidgetLink {
    static func product(_ handle: String) -> URL {
        let path = handle.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_"))) ?? ""
        return URL(string: "\(OrderActivityLink.scheme):///products/\(path)") ?? deals
    }

    /// The Deals page: the whole shop narrowed to what is on offer.
    static let deals = URL(string: "\(OrderActivityLink.scheme):///category/all?offer=1")!
    static let orders = URL(string: "\(OrderActivityLink.scheme):///account/orders")!
    static let account = URL(string: "\(OrderActivityLink.scheme):///account")!
}

// MARK: Today's deals

/// What the deals widget shows: the deepest savings on NetLet now.
struct DealsWidgetContent {
    struct Deal: Identifiable {
        var id: String { handle }
        let handle: String
        let title: String
        let price: String
        let was: String?
        let percent: Int
        let photo: UIImage?
    }

    var title: String
    var deals: [Deal]
    var seeAll: String
    var emptyTitle: String
    var emptyNote: String
    var rightToLeft: Bool

    /// How many each size shows.
    static func count(for size: HomeWidgetSize) -> Int {
        switch size {
        case .small: 1
        case .medium: 3
        case .large: 4
        }
    }
}

/// The widgets' two surfaces: white with navy words, or the shop's deep navy
/// with white words in dark mode. A product photo always sits on white, the
/// way it was taken.
private struct WidgetInk {
    let scheme: ColorScheme
    var ink: Color { scheme == .dark ? .white : Brand.deepNavy }
    var soft: Color { scheme == .dark ? .white.opacity(0.72) : Brand.muted }
    var tile: Color { .white }
    var rim: Color { scheme == .dark ? .white.opacity(0.12) : Brand.cardLine }

    static func ground(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 9 / 255, green: 26 / 255, blue: 56 / 255) : .white
    }
}

struct DealsWidgetView: View {
    let content: DealsWidgetContent
    let size: HomeWidgetSize
    @Environment(\.colorScheme) private var scheme

    private var ink: WidgetInk { WidgetInk(scheme: scheme) }

    var body: some View {
        VStack(alignment: .leading, spacing: size == .small ? 6 : 8) {
            header
            if content.deals.isEmpty {
                empty
            } else {
                switch size {
                case .small: single(content.deals[0])
                case .medium: row
                case .large: list
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .environment(\.layoutDirection, content.rightToLeft ? .rightToLeft : .leftToRight)
    }

    private var header: some View {
        HStack(spacing: 6) {
            RoofGlyph()
                .fill(Brand.orange)
                .frame(width: 18, height: 10)
                .accessibilityHidden(true)
            Text(content.title)
                .font(.system(size: size == .small ? 12 : 13, weight: .bold))
                .foregroundStyle(ink.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 4)
            if size != .small, !content.deals.isEmpty {
                Link(destination: WidgetLink.deals) {
                    Text(content.seeAll)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(ink.soft)
                        .lineLimit(1)
                }
            }
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 4) {
            Spacer(minLength: 0)
            Text(content.emptyTitle)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(ink.ink)
                .lineLimit(2)
            Text(content.emptyNote)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(ink.soft)
                .lineLimit(size == .small ? 3 : 2)
            Spacer(minLength: 0)
        }
    }

    /// The small size: one deal, its photo large.
    private func single(_ deal: DealsWidgetContent.Deal) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            photo(deal, corner: 14)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Text(deal.title)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(ink.ink)
                .lineLimit(1)
            prices(deal, large: false)
        }
    }

    /// The medium size: three deals side by side, each opening its product.
    private var row: some View {
        HStack(alignment: .top, spacing: 10) {
            ForEach(content.deals.prefix(3)) { deal in
                Link(destination: WidgetLink.product(deal.handle)) {
                    VStack(alignment: .leading, spacing: 4) {
                        photo(deal, corner: 12)
                            .aspectRatio(1, contentMode: .fit)
                        prices(deal, large: false)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            // A short list keeps each deal the width three would have.
            ForEach(0..<max(0, 3 - content.deals.count), id: \.self) { _ in
                Color.clear.frame(maxWidth: .infinity)
            }
        }
    }

    /// The large size: four deals as rows, a name beside each photo.
    private var list: some View {
        VStack(spacing: 8) {
            ForEach(content.deals.prefix(4)) { deal in
                Link(destination: WidgetLink.product(deal.handle)) {
                    HStack(spacing: 10) {
                        photo(deal, corner: 12, badge: false)
                            .frame(width: 60, height: 60)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(deal.title)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(ink.ink)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                            prices(deal, large: true)
                        }
                        Spacer(minLength: 4)
                        badge(deal.percent)
                    }
                }
                if deal.id != content.deals.prefix(4).last?.id {
                    Rectangle().fill(ink.rim).frame(height: 0.5)
                }
            }
            Spacer(minLength: 0)
        }
    }

    private func photo(_ deal: DealsWidgetContent.Deal, corner: CGFloat, badge showsBadge: Bool = true) -> some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(ink.tile)
                .overlay(RoundedRectangle(cornerRadius: corner, style: .continuous).stroke(ink.rim, lineWidth: 0.5))
            if let image = deal.photo {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .padding(6)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityHidden(true)
            }
            if showsBadge {
                badge(deal.percent)
                    .padding(5)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
    }

    /// The saving, navy on the brand orange (4.65:1), as the card draws it.
    private func badge(_ percent: Int) -> some View {
        Text(verbatim: "−\(percent)%")
            .font(.system(size: 11, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(Brand.deepNavy)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(Brand.orange))
            .environment(\.layoutDirection, .leftToRight)
    }

    private func prices(_ deal: DealsWidgetContent.Deal, large: Bool) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 4) {
                price(deal, large: large)
                if let was = deal.was { struck(was, large: large) }
            }
            VStack(alignment: .leading, spacing: 0) {
                price(deal, large: large)
                if let was = deal.was { struck(was, large: large) }
            }
        }
    }

    private func price(_ deal: DealsWidgetContent.Deal, large: Bool) -> some View {
        Text(deal.price)
            .font(.system(size: large ? 14 : 12, weight: .bold))
            .foregroundStyle(ink.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }

    private func struck(_ was: String, large: Bool) -> some View {
        Text(was)
            .font(.system(size: large ? 12 : 10, weight: .medium))
            .strikethrough()
            .foregroundStyle(ink.soft)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }
}

/// The deals widget's ground for a colour scheme.
struct DealsWidgetGround: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View { WidgetInk.ground(scheme) }
}

// MARK: Your order

/// What the order widget shows: the newest order on its way, as the Lock
/// Screen does, or a line saying there is none — or that the app has to be
/// opened, or somebody has to sign in.
struct OrderWidgetContent {
    enum Showing {
        case order(OrderActivityAttributes.ContentState, stale: Bool)
        case nothing(title: String, line: String)
    }

    var heading: String
    var showing: Showing
    var rightToLeft: Bool
}

/// White words on the shop's navy, the Lock Screen card's look, in either mode.
struct OrderWidgetView: View {
    let content: OrderWidgetContent
    let size: HomeWidgetSize

    var body: some View {
        Group {
            switch content.showing {
            case let .order(state, stale):
                if size == .small {
                    smallOrder(state, stale: stale)
                } else {
                    OrderActivityCard(state: state, stale: stale, padded: false)
                }
            case let .nothing(title, line):
                nothing(title: title, line: line)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .environment(\.layoutDirection, content.rightToLeft ? .rightToLeft : .leftToRight)
    }

    private var mark: some View {
        HStack(spacing: 6) {
            RoofGlyph()
                .fill(Brand.orange)
                .frame(width: 20, height: 11)
            Text(content.heading)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .accessibilityHidden(true)
    }

    private func smallOrder(_ state: OrderActivityAttributes.ContentState, stale: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                mark
                Spacer(minLength: 0)
            }
            Spacer(minLength: 2)
            if let minutes = state.minutes, !state.arrived {
                Text(minutes)
                    .font(.system(size: 12, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Brand.deepNavy)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(Brand.orange))
            }
            Text(state.headline)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(2)
                .minimumScaleFactor(0.75)
            if let line = stale ? state.staleLine : state.detail {
                Text(line)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.8))
                    .lineLimit(2)
            }
            Spacer(minLength: 4)
            OrderActivitySteps(state: state, showsLabels: false)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([state.title, state.headline, stale ? state.staleLine : state.detail].compactMap { $0 }.joined(separator: ", "))
    }

    private func nothing(title: String, line: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            mark
            Spacer(minLength: 4)
            Image(systemName: "shippingbox")
                .font(.system(size: size == .small ? 22 : 24, weight: .semibold))
                .foregroundStyle(Brand.orange)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(2)
            Text(line)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.8))
                .lineLimit(size == .small ? 3 : 2)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
