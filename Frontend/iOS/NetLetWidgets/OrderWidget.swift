import SwiftUI
import WidgetKit

/// Your newest order on the home screen: where it is, in the Lock Screen
/// card's words and colours, a press opening it in the app. The extension has
/// no session, so it shows what the app last left (`SharedShelf`, written by
/// `WidgetFeed`), and once that is half an hour old it says to open NetLet for
/// where it is now — the Lock Screen's own rule.
struct OrderWidget: Widget {
    var body: some WidgetConfiguration {
        let words = WidgetWords.current()
        return StaticConfiguration(kind: "NetLetOrder", provider: OrderProvider()) { entry in
            OrderWidgetFace(entry: entry)
        }
        .configurationDisplayName(words.t("ios.widget.orderName"))
        .description(words.t("ios.widget.orderNote"))
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct OrderEntry: TimelineEntry {
    let date: Date
    let content: OrderWidgetContent
    let link: URL
}

private struct OrderWidgetFace: View {
    let entry: OrderEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        OrderWidgetView(content: entry.content, size: HomeWidgetSize(family))
            .widgetURL(entry.link)
            .containerBackground(for: .widget) { Brand.deepNavy }
    }
}

struct OrderProvider: TimelineProvider {
    func placeholder(in context: Context) -> OrderEntry {
        OrderTimeline.entries(snapshot: nil, now: Date()).first!
    }

    func getSnapshot(in context: Context, completion: @escaping (OrderEntry) -> Void) {
        completion(OrderTimeline.entries(snapshot: SharedShelf.read(), now: Date()).first!)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OrderEntry>) -> Void) {
        // The app reloads this whenever it writes, so nothing is asked again here.
        completion(Timeline(entries: OrderTimeline.entries(snapshot: SharedShelf.read(), now: Date()), policy: .never))
    }
}

/// The order widget's entries: `OrderWidgetPlan` decides what shows when,
/// and this puts the words to it.
enum OrderTimeline {
    static func entries(snapshot: WidgetSnapshot?, now: Date) -> [OrderEntry] {
        let words = WidgetWords.current(snapshot)
        let heading = words.t("ios.widget.orderName")
        func nothing(_ title: String, _ line: String) -> OrderWidgetContent {
            OrderWidgetContent(heading: heading, showing: .nothing(title: words.t(title), line: words.t(line)), rightToLeft: words.rightToLeft)
        }
        return OrderWidgetPlan.plan(snapshot: snapshot, now: now).map { at, showing in
            switch showing {
            case .open:
                OrderEntry(date: at, content: nothing("ios.widget.openTitle", "ios.widget.openNote"), link: WidgetLink.orders)
            case .signIn:
                OrderEntry(date: at, content: nothing("ios.widget.signInTitle", "ios.widget.signInNote"), link: WidgetLink.account)
            case .nothing:
                OrderEntry(date: at, content: nothing("ios.widget.nothingTitle", "ios.widget.nothingNote"), link: WidgetLink.orders)
            case .order(let stale):
                if let order = snapshot?.order {
                    OrderEntry(date: at, content: OrderWidgetContent(heading: heading, showing: .order(order.state, stale: stale), rightToLeft: words.rightToLeft), link: OrderActivityLink.url(order.reference))
                } else {
                    OrderEntry(date: at, content: nothing("ios.widget.nothingTitle", "ios.widget.nothingNote"), link: WidgetLink.orders)
                }
            }
        }
    }
}
