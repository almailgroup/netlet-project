import SwiftUI

/// Checkout's round icons — the web's `RoundChoice`, on the owner's word ("for
/// the payment method make it icons, round shaped icons … the same for the
/// codes, gift cards and points"): a circle with its mark, its name under it,
/// and a line under that saying where it stands. The payment methods are a row
/// of them where only cash can be chosen, and the code, the gift card and the
/// points are three that each open their own box (`BagSavingsCard`).
///
/// **The marks of KNET, Visa and Mastercard and Apple Pay are mockups**, on the
/// owner's word ("for now add a mockup design"): NetLet's own drawing of how
/// each will look, never a brand's file, and none can be chosen until a card
/// service is integrated (3.2.1).
/// A circle's corner badge: green for something applied, red for a refusal.
enum RoundBadge { case done, problem }

struct RoundFace<Mark: View>: View {
    let fill: Color
    let ring: Bool
    var badge: RoundBadge?
    @ViewBuilder let mark: () -> Mark

    var body: some View {
        ZStack {
            Circle().fill(fill)
            mark()
        }
        .frame(width: 56, height: 56)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(ring ? Brand.navy : Brand.cardLine, lineWidth: ring ? 2 : 1))
        .padding(3)
        .overlay(Circle().strokeBorder(Brand.navy.opacity(ring ? 0.18 : 0), lineWidth: 3))
        .overlay(alignment: .topTrailing) {
            if let badge {
                ZStack {
                    Circle().fill(badge == .done ? Brand.success : Brand.danger)
                    if badge == .done {
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .black))
                    } else {
                        Text("!").font(.inter(11, .heavy))
                    }
                }
                .foregroundStyle(.white)
                .frame(width: 20, height: 20)
                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                .transition(.scale.combined(with: .opacity))
            }
        }
        .accessibilityHidden(true)
    }
}

/// The name under a circle and the line under that: two lines of name at most, centred.
struct RoundLabel: View {
    enum Tone { case muted, good, bad }
    let title: String
    var note: String?
    var tone: Tone = .muted

    var body: some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.inter(12, .bold))
                .foregroundStyle(Brand.navy)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
            if let note {
                Text(note)
                    .font(.inter(11, .semibold))
                    .foregroundStyle(tone == .good ? Brand.success : tone == .bad ? Brand.danger : Brand.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 6)
    }
}

/// The ways to pay, each as it will look inside its circle.
enum PaymentMark: String, CaseIterable, Identifiable {
    case cod, knet, card, apple
    var id: String { rawValue }

    /// The circle's own fill: cash in navy once chosen, Apple Pay on black, the cards on white.
    func fill(chosen: Bool) -> Color {
        switch self {
        case .cod: return chosen ? Brand.navyFill : Color(light: 0xEEF3FA, dark: 0x1A283D)
        case .apple: return .black
        case .knet, .card: return .white
        }
    }

    @ViewBuilder
    func mark(chosen: Bool) -> some View {
        switch self {
        case .cod:
            Image(systemName: "banknote")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(chosen ? Color.white : Brand.navy)
        case .knet:
            // KNET's own blue with a green bar under the word: a mockup, not the mark.
            VStack(spacing: 4) {
                Text("KNET")
                    .font(.system(size: 13, weight: .black))
                    .foregroundStyle(Color(red: 11 / 255, green: 78 / 255, blue: 162 / 255))
                Capsule().fill(Color(red: 47 / 255, green: 168 / 255, blue: 79 / 255)).frame(width: 26, height: 3)
            }
            .environment(\.layoutDirection, .leftToRight)
        case .card:
            VStack(spacing: 3) {
                Text("VISA")
                    .font(.system(size: 11, weight: .black).italic())
                    .foregroundStyle(Color(red: 26 / 255, green: 31 / 255, blue: 113 / 255))
                ZStack {
                    Circle().fill(Color(red: 235 / 255, green: 0, blue: 27 / 255)).frame(width: 15, height: 15).offset(x: -5)
                    Circle().fill(Color(red: 247 / 255, green: 158 / 255, blue: 27 / 255)).frame(width: 15, height: 15).offset(x: 5)
                        .opacity(0.92)
                }
                .frame(width: 26, height: 15)
            }
            .environment(\.layoutDirection, .leftToRight)
        case .apple:
            HStack(spacing: 1) {
                Image(systemName: "apple.logo").font(.system(size: 13, weight: .semibold))
                Text("Pay").font(.system(size: 13, weight: .semibold))
            }
            .foregroundStyle(.white)
            .environment(\.layoutDirection, .leftToRight)
        }
    }
}

/// The code, the gift card and the points, each on a fill of its own drawn from the navy and the orange.
enum SavingsMark: String, CaseIterable, Identifiable {
    case discount, gift, points
    var id: String { rawValue }

    var fill: Color {
        switch self {
        case .discount: return Color(light: 0xEAF1FB, dark: 0x1A283D)
        case .gift: return Color(light: 0xFDF0E8, dark: 0x3A2219)
        case .points: return Color(light: 0xFFF6DF, dark: 0x3A321A)
        }
    }

    @ViewBuilder
    var mark: some View {
        switch self {
        case .discount:
            Image(systemName: "ticket").font(.system(size: 22, weight: .medium)).foregroundStyle(Brand.navy)
        case .gift:
            Image(systemName: "gift").font(.system(size: 22, weight: .medium)).foregroundStyle(Brand.accentInk)
        case .points:
            PointsCoin(size: 30)
        }
    }
}
