#if DEBUG
import SwiftUI

/// Debug only: My orders' street at every stage, one under another
/// (`-NetLetOpen journeyProbe`), so the CI photographs the van on the road —
/// the recorded orders hold none on their way — in both languages.
struct JourneyProbe: View {
    private let stages: [OrderProgress] = [
        OrderProgress(kind: "received", preordered: false, at: nil, delivered: nil, of: nil),
        OrderProgress(kind: "preparing", preordered: nil, at: nil, delivered: nil, of: nil),
        OrderProgress(kind: "onTheWay", preordered: nil, at: nil, delivered: nil, of: nil),
        OrderProgress(kind: "partlyDelivered", preordered: nil, at: nil, delivered: 1, of: 2),
        OrderProgress(kind: "delivered", preordered: nil, at: "2026-10-17T22:33:45.311Z", delivered: nil, of: nil),
        OrderProgress(kind: "cancelled", preordered: nil, at: nil, delivered: nil, of: nil),
    ]

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                ForEach(Array(stages.enumerated()), id: \.offset) { _, progress in
                    OrderJourney(progress: progress)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(.white))
                        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 70)
        }
        .background(Brand.ground.ignoresSafeArea())
    }
}
#endif
