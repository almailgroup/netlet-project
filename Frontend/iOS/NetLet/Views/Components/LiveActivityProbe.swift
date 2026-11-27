#if DEBUG
import SwiftUI

/// Debug only: the Lock Screen card and the Dynamic Island an order on its
/// way wears (`-NetLetOpen liveActivityProbe`), drawn by the same views the
/// widget extension draws, in the app's language — a Live Activity is never
/// started in the recorded demo, so this is how the CI photographs it and a
/// UI test reads it.
struct LiveActivityProbe: View {
    @Environment(LanguageSettings.self) private var l

    private func state(step: Int, arrived: Bool = false, headline: String, detail: String?, minutes: String?) -> OrderActivityAttributes.ContentState {
        .init(
            step: step,
            arrived: arrived,
            headline: headline,
            detail: detail,
            minutes: minutes,
            labels: OrderActivityContent.labelKeys.map { l.t($0) },
            rightToLeft: l.current.isRightToLeft,
            staleLine: l.t("ios.live.stale"),
            title: l.t("ios.live.title", ["reference": "NL-20261104-HMGQQ"])
        )
    }

    private var store: String { l.t("track.from", ["store": "\u{2068}Acme Electronics\u{2069}"]) }

    var body: some View {
        let driving = state(step: 2, headline: l.t("tracking.band", ["low": "15", "high": "20"]), detail: store, minutes: l.t("ios.live.minutes", ["low": "15", "high": "20"]))
        let waiting = state(step: 2, headline: l.t("track.onTheWay"), detail: store + " · " + l.t("track.expectedOn", ["date": DeliveryLine.shortDay(Date(), l.current)]), minutes: nil)
        let arrived = state(step: 3, arrived: true, headline: l.t("track.delivered"), detail: store, minutes: nil)
        ScrollView {
            VStack(spacing: 14) {
                card(driving, id: "live-card-driving")
                card(waiting, id: "live-card-waiting", stale: true)
                card(arrived, id: "live-card-arrived")
                // The Dynamic Island, compact and held open.
                HStack {
                    OrderIslandLeading(state: driving)
                    Spacer(minLength: 120)
                    OrderIslandTrailing(state: driving)
                }
                .padding(.horizontal, 18)
                .frame(height: 37)
                .background(Capsule().fill(Color.black))
                .frame(width: 250)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("live-island-compact")
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        OrderIslandMark()
                        Spacer()
                        OrderIslandTrailing(state: driving)
                    }
                    OrderIslandExpanded(state: driving)
                }
                .padding(18)
                .background(RoundedRectangle(cornerRadius: 40, style: .continuous).fill(Color.black))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("live-island-expanded")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 60)
        }
        .background(
            LinearGradient(colors: [Color(red: 0.32, green: 0.4, blue: 0.55), Color(red: 0.12, green: 0.16, blue: 0.26)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
        )
    }

    /// A card as the Lock Screen draws it: navy, rounded, the system's margins.
    private func card(_ state: OrderActivityAttributes.ContentState, id: String, stale: Bool = false) -> some View {
        OrderActivityCard(state: state, stale: stale)
            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Brand.navy))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(id)
    }
}
#endif
