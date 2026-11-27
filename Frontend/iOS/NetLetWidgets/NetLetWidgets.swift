import ActivityKit
import SwiftUI
import WidgetKit

/// NetLet's widget extension: what the app shows outside itself — an order on
/// its way on the Lock Screen and in the Dynamic Island, and on the home
/// screen today's deals and your newest order. Their faces are in
/// `NetLetShared/` (`OrderActivity.swift`, `HomeWidgetViews.swift`), which the
/// app draws too, for the screenshots.
@main
struct NetLetWidgetBundle: WidgetBundle {
    var body: some Widget {
        OrderLiveActivity()
        DealsWidget()
        OrderWidget()
    }
}

/// An order on its way (`OrderActivityAttributes`), started and kept current
/// by the app (`LiveTracking`). A press anywhere opens the order in the app.
struct OrderLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: OrderActivityAttributes.self) { context in
            OrderActivityCard(state: context.state, stale: context.isStale)
                .activityBackgroundTint(Brand.deepNavy)
                .activitySystemActionForegroundColor(.white)
                .widgetURL(OrderActivityLink.url(context.attributes.reference))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    OrderIslandMark()
                        .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    OrderIslandTrailing(state: context.state)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    OrderIslandExpanded(state: context.state, stale: context.isStale)
                        .padding(.horizontal, 6)
                }
            } compactLeading: {
                OrderIslandLeading(state: context.state)
            } compactTrailing: {
                OrderIslandTrailing(state: context.state)
            } minimal: {
                OrderIslandLeading(state: context.state)
            }
            .widgetURL(OrderActivityLink.url(context.attributes.reference))
            .keylineTint(Brand.orange)
        }
    }
}
