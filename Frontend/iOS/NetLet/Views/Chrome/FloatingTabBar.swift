import SwiftUI

/// The phone's tab bar, the web's `MobileTabBar`, drawn to the owner's picture:
/// a floating pill of four tabs — Home, Profile, Cart, Categories — on the
/// header's liquid glass. The current tab sits in a pale grey pill with its
/// icon and word in navy and bold (the house filled); the rest are near-black
/// outlines, dark rather than muted so the glass's tint keeps them legible
/// over anything that scrolls under them.
///
/// The grey pill is one shape that slides to the tab pressed (420ms on the
/// web's curve, mirrored in Arabic), and a cut for somebody who asked for
/// less motion. Pressing the tab you are on takes you to its top. It floats
/// above the home indicator rather than growing over it.
struct FloatingTabBar: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still
    @Namespace private var pill

    var body: some View {
        GeometryReader { proxy in
            let size: CGFloat = proxy.size.width < 360 ? 12 : proxy.size.width < 390 ? 13 : 14
            HStack(spacing: 0) {
                ForEach(AppModel.Tab.allCases, id: \.self) { tab in
                    button(tab, labelSize: size)
                }
            }
            .padding(5)
            .background(GlassCapsule())
            .padding(.horizontal, 12)
        }
        .frame(height: 62)
    }

    private func button(_ tab: AppModel.Tab, labelSize: CGFloat) -> some View {
        let lit = app.selectedTab == tab
        return Button {
            Haptics.tab()
            withAnimation(still ? nil : .timingCurve(0.32, 0.72, 0, 1, duration: 0.42)) {
                app.select(tab)
            }
        } label: {
            VStack(spacing: 2) {
                icon(tab, lit: lit)
                    .frame(width: 22, height: 22)
                    .cornerBadge(badge(tab))
                Text(label(tab))
                    .font(.inter(labelSize, lit ? .bold : .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .foregroundStyle(lit ? Brand.navy : Brand.nearBlack)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background {
                if lit {
                    Capsule()
                        .fill(Brand.tabPill)
                        .overlay(Capsule().strokeBorder(Color.black.opacity(0.04), lineWidth: 1))
                        .matchedGeometryEffect(id: "pill", in: pill)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label(tab))
        .accessibilityAddTraits(lit ? [.isSelected, .isButton] : .isButton)
    }

    private func label(_ tab: AppModel.Tab) -> String {
        switch tab {
        case .home: return l.t("nav.home")
        case .account: return l.t("nav.profile")
        case .cart: return l.t("nav.cart")
        case .categories: return l.t("nav.categories")
        }
    }

    private func badge(_ tab: AppModel.Tab) -> Int {
        tab == .cart ? app.cart.itemCount : 0
    }

    @ViewBuilder
    private func icon(_ tab: AppModel.Tab, lit: Bool) -> some View {
        switch tab {
        case .home:
            if lit {
                HouseShape().fill(style: FillStyle())
                    .overlay(HouseShape().stroke(style: StrokeStyle(lineWidth: 1.4, lineJoin: .round)))
            } else {
                HouseShape().stroke(style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))
            }
        case .account:
            Image(systemName: "person").font(.system(size: 19, weight: .regular))
        case .cart:
            Image(systemName: "cart").font(.system(size: 19, weight: .regular))
        case .categories:
            CategoriesShape().stroke(style: StrokeStyle(lineWidth: 1.8, lineJoin: .round))
        }
    }
}

extension View {
    /// A pixel badge hung off the end corner of an icon, outward — the web's
    /// `-end-3 -top-2` — on the right in English and the left in Arabic.
    func cornerBadge(_ value: Int) -> some View {
        modifier(CornerBadge(value: value))
    }
}

private struct CornerBadge: ViewModifier {
    let value: Int
    @Environment(\.layoutDirection) private var direction

    func body(content: Content) -> some View {
        let rightToLeft = direction == .rightToLeft
        // Placed in fixed left-to-right space, so the corner and the offset
        // mean what they say: the right in English, the left in Arabic.
        content
            .overlay(alignment: rightToLeft ? .topLeading : .topTrailing) {
                PixelBadge(value: value)
                    .fixedSize()
                    .offset(x: rightToLeft ? -12 : 12, y: -8)
            }
            .environment(\.layoutDirection, .leftToRight)
    }
}

/// The web's house, on its 24-unit grid: a roof, the walls and a door.
struct HouseShape: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * scale, y: rect.minY + y * scale)
        }
        var path = Path()
        path.move(to: point(12, 3.2))
        path.addLine(to: point(3.1, 11))
        path.addQuadCurve(to: point(3.5, 12.8), control: point(2.5, 12.6))
        path.addLine(to: point(5, 12.8))
        path.addLine(to: point(5, 20))
        path.addQuadCurve(to: point(6, 21), control: point(5, 21))
        path.addLine(to: point(10.3, 21))
        path.addLine(to: point(10.3, 15.4))
        path.addLine(to: point(13.7, 15.4))
        path.addLine(to: point(13.7, 21))
        path.addLine(to: point(18, 21))
        path.addQuadCurve(to: point(19, 20), control: point(19, 21))
        path.addLine(to: point(19, 12.8))
        path.addLine(to: point(20.5, 12.8))
        path.addQuadCurve(to: point(20.9, 11), control: point(21.5, 12.6))
        path.closeSubpath()
        return path
    }
}

/// Three squares and a circle: the departments.
struct CategoriesShape: Shape {
    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        func box(_ x: CGFloat, _ y: CGFloat) -> CGRect {
            CGRect(x: rect.minX + x * scale, y: rect.minY + y * scale, width: 7 * scale, height: 7 * scale)
        }
        var path = Path()
        path.addRoundedRect(in: box(3.5, 3.5), cornerSize: CGSize(width: 1.5 * scale, height: 1.5 * scale))
        path.addRoundedRect(in: box(13.5, 3.5), cornerSize: CGSize(width: 1.5 * scale, height: 1.5 * scale))
        path.addRoundedRect(in: box(3.5, 13.5), cornerSize: CGSize(width: 1.5 * scale, height: 1.5 * scale))
        path.addEllipse(in: box(13.5, 13.5))
        return path
    }
}
