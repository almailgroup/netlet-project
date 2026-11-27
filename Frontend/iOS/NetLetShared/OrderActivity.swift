import ActivityKit
import SwiftUI

/// One order on its way, followed on the Lock Screen and in the Dynamic
/// Island, on the owner's word ("live tracking on the lock screen"). The app
/// composes every word (`OrderActivityContent`), in the shop's language, from
/// the order and the driver's position it already reads, so the extension
/// carries no dictionary and says exactly what the order page says. Compiled
/// into the app and the extension: ActivityKit matches the two by this type.
struct OrderActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable, Sendable {
        /// How far along the four steps the parcel shown is, 0 to 3.
        var step: Int
        /// Everything in the order has arrived.
        var arrived: Bool
        /// Where it is now, in large type: "On the way", "About 15 to 20
        /// minutes away", "Delivered on Thu 5 Nov".
        var headline: String
        /// Under it: the store, and the store's own estimate while no driver
        /// is sharing a position.
        var detail: String?
        /// The driver's minutes, short, for the Dynamic Island ("15–20 min").
        var minutes: String?
        /// The four steps' names, in the shop's language.
        var labels: [String]
        var rightToLeft: Bool
        /// What the Lock Screen says once this is old (its `staleDate` passed).
        var staleLine: String
        /// The activity's name to VoiceOver: "Order NL-20261104-HMGQQ".
        var title: String
    }

    /// The order's reference, which is how the app finds the activity again.
    let reference: String
}

/// Where a press on the activity goes: the order, opened in the app.
enum OrderActivityLink {
    static let scheme = "netlet"

    /// `netlet:///account/orders?order=…` — the site's own address for the
    /// order, which the app's `Route.from(link:)` already reads.
    static func url(_ reference: String) -> URL {
        let order = reference.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_"))) ?? ""
        return URL(string: "\(scheme):///account/orders?order=\(order)") ?? URL(string: "\(scheme):///account/orders")!
    }
}

/// The Lock Screen's card, white words on the shop's navy: the mark, the
/// driver's minutes, where it is and the four steps. The same view is the
/// medium order widget's face, and the app's probes draw both.
struct OrderActivityCard: View {
    let state: OrderActivityAttributes.ContentState
    var stale = false
    /// The Lock Screen's own margins; a home screen widget has the system's.
    var padded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                RoofGlyph()
                    .fill(Brand.orange)
                    .frame(width: 24, height: 13)
                Text(verbatim: "NetLet")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                Spacer(minLength: 8)
                if let minutes = state.minutes, !state.arrived {
                    Text(minutes)
                        .font(.system(size: 13, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(Brand.deepNavy)
                        .lineLimit(1)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Brand.orange))
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(state.headline)
                    .font(.system(size: 19, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                if let line = stale ? state.staleLine : state.detail {
                    Text(line)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.8))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
            OrderActivitySteps(state: state)
        }
        .padding(.horizontal, padded ? 16 : 0)
        .padding(.vertical, padded ? 14 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.layoutDirection, state.rightToLeft ? .rightToLeft : .leftToRight)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([state.title, state.headline, stale ? state.staleLine : state.detail].compactMap { $0 }.joined(separator: ", "))
    }
}

/// The four steps on one road — the order, the box, the van, the house —
/// those passed white, the one it is at in the brand's orange, those ahead
/// faint. Drawn on navy (the Lock Screen) and on black (the Dynamic Island).
struct OrderActivitySteps: View {
    let state: OrderActivityAttributes.ContentState
    var showsLabels = true

    static let symbols = ["doc.text.fill", "shippingbox.fill", "truck.box.fill", "house.fill"]

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            ForEach(0..<Self.symbols.count, id: \.self) { index in
                VStack(spacing: 4) {
                    ZStack {
                        HStack(spacing: 0) {
                            road(index == 0 ? nil : index)
                            road(index == Self.symbols.count - 1 ? nil : index + 1)
                        }
                        .frame(height: 3)
                        dot(index)
                    }
                    .frame(height: 26)
                    if showsLabels {
                        Text(index < state.labels.count ? state.labels[index] : "")
                            .font(.system(size: 11, weight: index == reached ? .bold : .medium))
                            .foregroundStyle(.white.opacity(index <= reached ? 0.95 : 0.6))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .padding(.horizontal, 2)
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }

    private var reached: Int { min(max(state.step, 0), Self.symbols.count - 1) }

    private func done(_ index: Int) -> Bool {
        index < reached || (index == reached && state.arrived)
    }

    /// Half the road into a step: travelled once the step is reached.
    @ViewBuilder
    private func road(_ into: Int?) -> some View {
        if let into {
            Rectangle().fill(.white.opacity(into <= reached ? 0.9 : 0.22))
        } else {
            Color.clear
        }
    }

    private func dot(_ index: Int) -> some View {
        let isDone = done(index)
        let now = index == reached && !isDone
        return ZStack {
            Circle().fill(isDone ? Color.white : now ? Brand.orange : Color(red: 0.2, green: 0.3, blue: 0.47))
            Image(systemName: Self.symbols[index])
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isDone || now ? Brand.deepNavy : Color.white.opacity(0.65))
                .flipsForRightToLeftLayoutDirection(Self.symbols[index].hasPrefix("truck"))
        }
        .frame(width: 26, height: 26)
    }
}

/// The Dynamic Island's two sides while it is compact: the van at the start,
/// the minutes (or where it is) at the end.
struct OrderIslandLeading: View {
    let state: OrderActivityAttributes.ContentState

    var body: some View {
        Image(systemName: state.arrived ? "house.fill" : "truck.box.fill")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Brand.orange)
            .accessibilityHidden(true)
    }
}

struct OrderIslandTrailing: View {
    let state: OrderActivityAttributes.ContentState

    var body: some View {
        Group {
            if state.arrived {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Brand.orange)
            } else if let minutes = state.minutes {
                Text(minutes)
                    .font(.system(size: 13, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: 64)
            } else {
                Image(systemName: OrderActivitySteps.symbols[min(max(state.step, 0), 3)])
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
            }
        }
        .accessibilityLabel(state.minutes ?? state.headline)
    }
}

/// The Dynamic Island held open: the mark and the minutes along the top, where
/// it is and the four steps under them.
struct OrderIslandExpanded: View {
    let state: OrderActivityAttributes.ContentState
    var stale = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(state.headline)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            if let line = stale ? state.staleLine : state.detail {
                Text(line)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.75))
                    .lineLimit(1)
            }
            OrderActivitySteps(state: state, showsLabels: false)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.layoutDirection, state.rightToLeft ? .rightToLeft : .leftToRight)
    }
}

/// The brand at the expanded island's start.
struct OrderIslandMark: View {
    var body: some View {
        HStack(spacing: 6) {
            RoofGlyph()
                .fill(Brand.orange)
                .frame(width: 22, height: 12)
            Text(verbatim: "NetLet")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
        }
        .accessibilityHidden(true)
    }
}
