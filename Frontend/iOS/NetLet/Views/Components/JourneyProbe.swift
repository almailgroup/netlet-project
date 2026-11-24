#if DEBUG
import SwiftUI

/// Debug only: an item's status tile in every state, side by side
/// (`-NetLetOpen journeyProbe`), so the CI photographs the store, the van, the
/// house, Rate and the stars given — the recorded orders hold no item on the
/// road — in both languages.
struct JourneyProbe: View {
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
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .top), count: 2), spacing: 16) {
                ForEach(Array(cases.enumerated()), id: \.offset) { _, entry in
                    ItemStatusTile(progress: entry.progress, rating: entry.rating, mayRate: entry.mayRate, title: "Smart watch") {}
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
