#if DEBUG
import SwiftUI

/// Debug only: an item's status band in every state, one under another
/// (`-NetLetOpen journeyProbe`), so the CI photographs the store, the van, the
/// house, Track order, Rate and the stars given with Edit — the recorded
/// orders hold no item on the road — in both languages.
struct JourneyProbe: View {
    @Environment(LanguageSettings.self) private var l
    private struct Case {
        let progress: OrderProgress
        let rating: Int?
        let mayRate: Bool
    }

    private static func kind(_ kind: String, at: String? = nil) -> OrderProgress {
        OrderProgress(kind: kind, preordered: kind == "received" ? false : nil, at: at, delivered: nil, of: nil)
    }

    private let cases: [Case] = [
        Case(progress: kind("received"), rating: nil, mayRate: false),
        Case(progress: kind("preparing"), rating: nil, mayRate: false),
        Case(progress: kind("onTheWay"), rating: nil, mayRate: false),
        Case(progress: kind("delivered", at: "2026-10-17T22:33:45.311Z"), rating: nil, mayRate: false),
        Case(progress: kind("delivered", at: "2026-10-17T22:33:45.311Z"), rating: nil, mayRate: true),
        Case(progress: kind("delivered", at: "2026-10-17T22:33:45.311Z"), rating: 4, mayRate: false),
        Case(progress: kind("cancelled"), rating: nil, mayRate: false),
        Case(progress: kind("returned"), rating: nil, mayRate: false),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(Array(cases.enumerated()), id: \.offset) { index, entry in
                    ItemStatusBar(
                        progress: entry.progress,
                        expected: index == 1 ? (text: l.t("track.expectedOn", ["date": DeliveryLine.shortDay(Date(timeIntervalSince1970: 1_791_878_400), l.current)]), late: false) : nil,
                        rating: entry.rating,
                        mayRate: entry.mayRate,
                        title: "Smart watch",
                        tracked: entry.progress.kind != "cancelled" && entry.progress.kind != "returned",
                        onTrack: {},
                        onRate: {}
                    )
                }
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(.white))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            .padding(.horizontal, 16)
            .padding(.vertical, 70)
        }
        .background(Brand.ground.ignoresSafeArea())
    }
}
#endif
