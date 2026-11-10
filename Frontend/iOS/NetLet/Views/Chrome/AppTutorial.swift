import SwiftUI

/// The tutorial a new install opens on, on the owner's word ("work on app
/// tutorial, for a new user that downloads and opens the app. Explain how to
/// login or create account and use the app. But make sure that there is skip
/// tutorial option").
///
/// Five pages a thumb swipes through or Next steps: what NetLet is; signing
/// in or creating an account (the switch, the email and the six-digit code
/// the form asks for); finding things (the search field, by typing, speaking
/// or a photo, and the departments); adding to the cart (the plus on a
/// photo, the hold that previews, the cart in the tab bar); and paying at the
/// door and following each parcel. Each page's picture is the shop's own
/// controls, drawn small and acted out once as the page arrives — the switch
/// sliding to Create account and the code filling in, the search typing, the
/// plus becoming a count and the cart's badge hopping, the parcel's steps
/// filling — so a new shopper has seen each thing before meeting it.
///
/// **Skip is on every page**, at the top, and the language beside it, since
/// somebody who reads Arabic should not have to finish an English tutorial
/// to find the switch. The last page ends where the shopper wants to go:
/// Create account and Sign in open the Profile tab's form in that mode
/// (`AppModel.authModePreset`), and Start shopping puts the tutorial away.
/// However it ends it is not shown again on its own (`seenKey`); "How to use
/// the app" under Help and information opens it again.
///
/// **A new install meets it under the opening animation**, so the roof's
/// window opens onto its first page, which moves only once it is seen
/// (`ready`). Somebody updating the app who is already signed in is not
/// shown it. Reduce Motion keeps every picture still in its finished state,
/// and the pages cut rather than glide.
struct AppTutorial: View {
    /// The opening animation has opened onto it, so its pictures may move.
    var ready: Bool
    @State private var page: Int
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    static let seenKey = "netlet.tutorialSeen"
    static let pageCount = 5

    init(ready: Bool, start: Int = 0) {
        self.ready = ready
        _page = State(initialValue: min(max(start, 0), Self.pageCount - 1))
    }

    /// Whether the app opens on the tutorial: once, on a new install. Not for
    /// somebody already signed in (an update, not a new shopper), and not
    /// under a UI test or a screenshot unless the screenshot asks for it.
    static func showsAtLaunch(open: String?) -> Bool {
        #if DEBUG
        if let open, open == "tutorial" || open.hasPrefix("tutorial:") { return true }
        #endif
        if UITestHooks.on || open != nil { return false }
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: seenKey) { return false }
        let cookie = ReferenceData.shared.rules.sessionCookie
        if HTTPCookieStorage.shared.cookies?.contains(where: { $0.name == cookie }) == true {
            defaults.set(true, forKey: seenKey)
            return false
        }
        return true
    }

    /// The page a screenshot opens on (`tutorial:<page>`), the first otherwise.
    static func startPage(open: String?) -> Int {
        guard let open, open.hasPrefix("tutorial:"), let page = Int(open.dropFirst("tutorial:".count)) else { return 0 }
        return page
    }

    private var last: Bool { page == Self.pageCount - 1 }

    var body: some View {
        VStack(spacing: 0) {
            topBar
            TabView(selection: $page) {
                ForEach(0..<Self.pageCount, id: \.self) { index in
                    TutorialPage(index: index, active: ready && page == index)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            dots
                .padding(.bottom, 20)
            buttons
                .padding(.horizontal, 20)
                .padding(.bottom, 12)
        }
        .background(background.ignoresSafeArea())
        .accessibilityAddTraits(.isModal)
    }

    private var background: some View {
        LinearGradient(
            colors: [Brand.tint, Brand.ground, Brand.ground],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// The language at the start, Skip at the end.
    private var topBar: some View {
        HStack(spacing: 12) {
            LanguageSwitch()
            Spacer(minLength: 8)
            Button {
                finish(.skip)
            } label: {
                Text(l.t("ios.tutorial.skip"))
                    .font(.inter(15, .bold))
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 18)
                    .frame(minHeight: 40)
                    .liquidGlass(.frost)
            }
            .buttonStyle(TutorialPressStyle())
            .accessibilityHint(l.t("ios.tutorial.skipHint"))
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    /// One dot a page, the current one drawn long.
    private var dots: some View {
        HStack(spacing: 6) {
            ForEach(0..<Self.pageCount, id: \.self) { index in
                Capsule()
                    .fill(index == page ? Brand.navy : Brand.line)
                    .frame(width: index == page ? 24 : 8, height: 8)
            }
        }
        .animation(still ? nil : .spring(response: 0.4, dampingFraction: 0.8), value: page)
        .accessibilityElement()
        .accessibilityLabel(l.t("ios.tutorial.progress", ["current": "\(page + 1)", "total": "\(Self.pageCount)"]))
    }

    /// Next, until the last page, which ends where the shopper wants to go.
    @ViewBuilder
    private var buttons: some View {
        if !last {
            Button {
                withAnimation(still ? nil : .spring(response: 0.5, dampingFraction: 0.88)) { page += 1 }
            } label: {
                HStack(spacing: 8) {
                    Text(l.t("ios.tutorial.next"))
                    Image(systemName: "arrow.forward")
                        .font(.system(size: 15, weight: .bold))
                        .flipsForRightToLeftLayoutDirection(true)
                        .accessibilityHidden(true)
                }
                .tutorialFilled()
            }
            .buttonStyle(TutorialPressStyle())
        } else if app.session.isSignedIn {
            Button { finish(.shop) } label: {
                Text(l.t("ios.tutorial.startShopping")).tutorialFilled()
            }
            .buttonStyle(TutorialPressStyle())
        } else {
            VStack(spacing: 10) {
                Button { finish(.register) } label: {
                    Text(l.t("auth.modeRegister")).tutorialFilled()
                }
                .buttonStyle(TutorialPressStyle())
                Button { finish(.signIn) } label: {
                    Text(l.t("header.signIn"))
                        .font(.inter(16, .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .liquidGlass(.clear)
                }
                .buttonStyle(TutorialPressStyle())
                Button { finish(.shop) } label: {
                    Text(l.t("ios.tutorial.startShopping"))
                        .font(.inter(15, .bold))
                        .foregroundStyle(Brand.accentInk)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(TutorialPressStyle())
            }
            .transition(.opacity.combined(with: .offset(y: 12)))
        }
    }

    private func finish(_ exit: AppModel.TutorialExit) {
        withAnimation(still ? .easeOut(duration: 0.2) : .spring(response: 0.55, dampingFraction: 0.9)) {
            app.finishTutorial(exit)
        }
    }
}

private extension View {
    /// The tutorial's main button: navy Liquid Glass, full width, a capsule.
    func tutorialFilled() -> some View {
        self
            .font(.inter(16, .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 54)
            .liquidGlass(.navy)
    }
}

/// A press that gives under the thumb and springs back, felt as it lands.
private struct TutorialPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var still

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !still ? 0.96 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(still ? nil : .spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
            .pressHaptic(configuration.isPressed)
    }
}

/// One page: its picture, its title and what it says. The picture and the
/// words rise into place the first time the page is the one showing.
private struct TutorialPage: View {
    let index: Int
    let active: Bool
    @State private var shown = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    private var up: Bool { shown || still }

    var body: some View {
        GeometryReader { geometry in
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 0) {
                    Spacer(minLength: 8)
                    picture
                        .frame(maxWidth: 340)
                        .frame(height: min(300, max(200, geometry.size.height * 0.5)))
                        .opacity(up ? 1 : 0)
                        .scaleEffect(up ? 1 : 0.92)
                        .animation(still ? nil : .spring(response: 0.6, dampingFraction: 0.78), value: up)
                    VStack(spacing: 12) {
                        Text(title)
                            .font(.inter(26, .heavy))
                            .foregroundStyle(Brand.navy)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isHeader)
                        Text(words)
                            .font(.inter(16))
                            .foregroundStyle(Brand.body)
                            .multilineTextAlignment(.center)
                            .lineSpacing(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 28)
                    .padding(.top, 28)
                    .opacity(up ? 1 : 0)
                    .offset(y: up ? 0 : 16)
                    .animation(still ? nil : .spring(response: 0.55, dampingFraction: 0.86).delay(0.1), value: up)
                    Spacer(minLength: 8)
                }
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
        }
        .onAppear { if active { shown = true } }
        .onChange(of: active) { _, now in if now { shown = true } }
    }

    private var title: String {
        switch index {
        case 0: return l.t("ios.tutorial.welcomeTitle")
        case 1: return l.t("ios.tutorial.accountTitle")
        case 2: return l.t("ios.tutorial.findTitle")
        case 3: return l.t("ios.tutorial.cartTitle")
        default: return l.t("ios.tutorial.ordersTitle")
        }
    }

    private var words: String {
        switch index {
        case 0: return l.t("ios.tutorial.welcomeBody")
        case 1: return l.t("ios.tutorial.accountBody", ["profile": l.t("nav.profile"), "create": l.t("auth.modeRegister")])
        case 2: return l.t("ios.tutorial.findBody", ["categories": l.t("nav.categories")])
        case 3: return l.t("ios.tutorial.cartBody", ["cart": l.t("nav.cart")])
        default:
            return l.t("ios.tutorial.ordersBody", [
                "profile": l.t("nav.profile"),
                "orders": l.t("account.myOrders"),
                "days": "\(app.returnWindowDays)",
            ])
        }
    }

    @ViewBuilder
    private var picture: some View {
        switch index {
        case 0: WelcomePicture(active: active)
        case 1: AccountPicture(active: active)
        case 2: FindPicture(active: active)
        case 3: CartPicture(active: active)
        default: OrdersPicture(active: active)
        }
    }
}

// MARK: - The pictures

/// A white card the pictures are drawn on, the shop's own panel.
private struct PictureCard<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(Color.white)
                    .shadow(color: Brand.navy.opacity(0.1), radius: 18, x: 0, y: 10)
            )
            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .padding(.horizontal, 24)
            .accessibilityHidden(true)
    }
}

/// Plays a picture's little scene once each time its page arrives: `steps`
/// moments, `gap` apart, after a short wait. Under Reduce Motion the scene
/// is drawn finished.
private struct PictureScene: ViewModifier {
    let active: Bool
    let steps: Int
    var gap: Double = 0.45
    var wait: Double = 0.35
    @Binding var moment: Int
    @Environment(\.accessibilityReduceMotion) private var still

    func body(content: Content) -> some View {
        content
            .task(id: active) {
                guard active else { return }
                if still {
                    moment = steps
                    return
                }
                moment = 0
                try? await Task.sleep(for: .seconds(wait))
                for step in 1...steps {
                    guard !Task.isCancelled else { return }
                    withAnimation(.spring(response: 0.45, dampingFraction: 0.75)) { moment = step }
                    try? await Task.sleep(for: .seconds(gap))
                }
            }
    }
}

/// NetLet's street with the logo on it, and three of the departments'
/// pictures floating gently round it.
private struct WelcomePicture: View {
    let active: Bool
    @State private var float = false
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        ZStack {
            BundledImage(image: WebAssets.street, contentMode: .fill)
                .frame(maxWidth: .infinity)
                .frame(height: 200)
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay(
                    LinearGradient(colors: [.clear, Brand.navy.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                )
                .overlay(alignment: .bottomLeading) {
                    BundledImage(image: WebAssets.logo)
                        .frame(width: 110, height: 40)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(Color.white))
                        .padding(14)
                }
                .shadow(color: Brand.navy.opacity(0.14), radius: 18, x: 0, y: 10)
                .padding(.horizontal, 40)
            floating("electronics", x: -130, y: -110, delay: 0)
            floating("beauty", x: 135, y: -80, delay: 0.4)
            floating("grocery", x: 120, y: 112, delay: 0.8)
        }
        .accessibilityHidden(true)
        .onChange(of: active) { _, now in if now { float = true } }
        .onAppear { if active { float = true } }
    }

    private func floating(_ slug: String, x: CGFloat, y: CGFloat, delay: Double) -> some View {
        BundledImage(image: WebAssets.department(slug))
            .padding(8)
            .frame(width: 74, height: 74)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white)
                    .shadow(color: Brand.navy.opacity(0.12), radius: 10, x: 0, y: 6)
            )
            .offset(x: x, y: y + (float && !still ? -6 : 6))
            .animation(still ? nil : .easeInOut(duration: 2.2).repeatForever(autoreverses: true).delay(delay), value: float)
    }
}

/// The sign-in form drawn small: the switch slides to Create account, the
/// email is there, and the six-digit code fills in box by box, then a tick.
private struct AccountPicture: View {
    let active: Bool
    @State private var moment = 0
    @Environment(LanguageSettings.self) private var l
    private let code = ["4", "8", "2", "9", "1", "6"]

    var body: some View {
        PictureCard {
            VStack(alignment: .leading, spacing: 14) {
                modeSwitch
                VStack(alignment: .leading, spacing: 4) {
                    Text(l.t("auth.email"))
                        .font(.inter(12, .semibold))
                        .foregroundStyle(Brand.muted)
                    Text(verbatim: "you@example.com")
                        .font(.inter(15, .medium))
                        .foregroundStyle(Brand.ink)
                        .environment(\.layoutDirection, .leftToRight)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                }
                HStack(spacing: 8) {
                    ForEach(0..<code.count, id: \.self) { index in
                        let filled = moment >= index + 2
                        Text(filled ? code[index] : "")
                            .font(.inter(20, .heavy))
                            .foregroundStyle(Brand.navy)
                            .frame(maxWidth: .infinity)
                            .frame(height: 46)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(filled ? Brand.tint : Color.white)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .strokeBorder(filled ? Brand.navy : Brand.line, lineWidth: filled ? 1.5 : 1)
                            )
                            .scaleEffect(filled ? 1 : 0.94)
                    }
                }
                .environment(\.layoutDirection, .leftToRight)
                .overlay(alignment: .topTrailing) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(Brand.success, Color.white)
                        .background(Circle().fill(Color.white).padding(2))
                        .offset(x: 10, y: -14)
                        .scaleEffect(moment >= code.count + 2 ? 1 : 0.2)
                        .opacity(moment >= code.count + 2 ? 1 : 0)
                }
            }
        }
        .modifier(PictureScene(active: active, steps: code.count + 2, gap: 0.22, moment: $moment))
    }

    private var modeSwitch: some View {
        HStack(spacing: 0) {
            half(l.t("header.signIn"), on: moment < 1)
            half(l.t("auth.modeRegister"), on: moment >= 1)
        }
        .padding(4)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color(red: 238 / 255, green: 240 / 255, blue: 244 / 255)))
    }

    private func half(_ title: String, on: Bool) -> some View {
        Text(title)
            .font(.inter(13.5, on ? .bold : .semibold))
            .foregroundStyle(on ? Brand.navy : Brand.muted)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(on ? Color.white : Color.clear)
                    .shadow(color: Brand.navy.opacity(on ? 0.12 : 0), radius: 4, x: 0, y: 2)
            )
    }
}

/// The search field typing a department's name, a microphone and a camera
/// beside it, and the departments' pictures popping in under it.
private struct FindPicture: View {
    let active: Bool
    @State private var moment = 0
    @Environment(LanguageSettings.self) private var l

    private var word: String {
        ReferenceData.shared.departments.first.map { l.t($0.label) } ?? ""
    }

    var body: some View {
        let letters = Array(word)
        PictureCard {
            VStack(spacing: 18) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Brand.muted)
                    Text(String(letters.prefix(min(moment, letters.count))))
                        .font(.inter(16, .medium))
                        .foregroundStyle(Brand.ink)
                        .lineLimit(1)
                    Rectangle()
                        .fill(Brand.navy)
                        .frame(width: 2, height: 20)
                        .opacity(moment <= letters.count ? 1 : 0)
                    Spacer(minLength: 0)
                    Image(systemName: "mic")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Brand.muted)
                    Image(systemName: "camera")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Brand.muted)
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(Brand.navy))
                }
                .padding(.leading, 14)
                .padding(.trailing, 5)
                .frame(height: 48)
                .background(Capsule().fill(Color.white))
                .overlay(Capsule().strokeBorder(moment > 0 ? Brand.navy : Brand.line, lineWidth: moment > 0 ? 1.5 : 1))
                HStack(spacing: 12) {
                    ForEach(Array(ReferenceData.shared.departments.prefix(3).enumerated()), id: \.element.id) { index, department in
                        let shown = moment > letters.count + index
                        VStack(spacing: 6) {
                            BundledImage(image: WebAssets.department(department.slug))
                                .padding(6)
                                .frame(width: 72, height: 72)
                                .background(
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .fill(Brand.photo)
                                )
                            Text(l.t(department.label))
                                .font(.inter(11.5, .semibold))
                                .foregroundStyle(Brand.navy)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .frame(maxWidth: .infinity)
                        .scaleEffect(shown ? 1 : 0.6)
                        .opacity(shown ? 1 : 0)
                    }
                }
            }
        }
        .modifier(PictureScene(active: active, steps: letters.count + 4, gap: 0.12, moment: $moment))
    }
}

/// A product card: a finger presses the plus on its photo, the plus becomes
/// the count, and the cart's badge in the tab bar hops.
private struct CartPicture: View {
    let active: Bool
    @State private var moment = 0
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(alignment: .bottom, spacing: 18) {
            card
            cartTab
        }
        .padding(.horizontal, 24)
        .accessibilityHidden(true)
        .modifier(PictureScene(active: active, steps: 3, gap: 0.55, wait: 0.5, moment: $moment))
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 8) {
            BundledImage(image: WebAssets.department("electronics"))
                .padding(14)
                .frame(maxWidth: .infinity)
                .frame(height: 150)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Brand.photo))
                .overlay(alignment: .bottomTrailing) { photoControl.padding(10) }
            Capsule().fill(Brand.line).frame(width: 120, height: 10)
            Capsule().fill(Brand.line.opacity(0.6)).frame(width: 80, height: 10)
            Capsule().fill(Brand.navy.opacity(0.85)).frame(width: 70, height: 12)
        }
        .padding(12)
        .frame(maxWidth: 220)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.white)
                .shadow(color: Brand.navy.opacity(0.1), radius: 16, x: 0, y: 8)
        )
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    /// The plus, a finger on it, then the navy count.
    @ViewBuilder
    private var photoControl: some View {
        if moment >= 2 {
            HStack(spacing: 10) {
                Image(systemName: "minus").font(.system(size: 12, weight: .bold))
                Text(verbatim: "1").font(.inter(15, .heavy))
                Image(systemName: "plus").font(.system(size: 12, weight: .bold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(Capsule().fill(Brand.navy))
            .environment(\.layoutDirection, .leftToRight)
            .transition(.scale(scale: 0.4, anchor: .trailing).combined(with: .opacity))
        } else {
            Image(systemName: "plus")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Brand.navy)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.white).shadow(color: Brand.navy.opacity(0.18), radius: 4, x: 0, y: 2))
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: "hand.point.up.left.fill")
                        .font(.system(size: 24))
                        .foregroundStyle(Brand.orange)
                        .offset(x: 14, y: moment >= 1 ? 16 : 34)
                        .opacity(moment >= 1 ? 1 : 0)
                }
                .scaleEffect(moment == 1 ? 0.9 : 1)
                .transition(.opacity)
        }
    }

    /// The tab bar's cart, as the bar draws it — the icon alone — its badge
    /// hopping in once the plus is pressed.
    private var cartTab: some View {
        TabIcon.cart.image(filled: moment >= 3)
            .foregroundStyle(Brand.navy)
            .overlay(alignment: .topTrailing) {
                CountBadge(value: moment >= 3 ? 1 : 0)
                    .offset(x: 10, y: -8)
                    .scaleEffect(moment >= 3 ? 1 : 0.3)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(Capsule().fill(moment >= 3 ? Color(red: 236 / 255, green: 236 / 255, blue: 239 / 255) : Color.white))
            .padding(5)
            .background(Capsule().fill(Color.white).shadow(color: Brand.navy.opacity(0.1), radius: 10, x: 0, y: 4))
    }
}

/// Cash at the door, and a parcel's four steps filling one after another.
private struct OrdersPicture: View {
    let active: Bool
    @State private var moment = 0
    @Environment(LanguageSettings.self) private var l

    private let steps: [(key: String, symbol: String)] = [
        ("track.placed", "bag"),
        ("track.preparing", "shippingbox"),
        ("track.onTheWay", "box.truck"),
        ("track.delivered", "house"),
    ]

    var body: some View {
        PictureCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 8) {
                    Image(systemName: "banknote")
                        .font(.system(size: 15, weight: .semibold))
                    Text(l.t("checkout.payCod"))
                        .font(.inter(13.5, .bold))
                }
                .foregroundStyle(Brand.success)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(Capsule().fill(Brand.successFill))
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                        let done = moment > index
                        HStack(spacing: 12) {
                            Image(systemName: step.symbol)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(done ? Color.white : Brand.muted)
                                .frame(width: 34, height: 34)
                                .background(Circle().fill(done ? Brand.navy : Brand.photo))
                                .scaleEffect(moment == index + 1 ? 1.1 : 1)
                            Text(l.t(step.key))
                                .font(.inter(14.5, done ? .bold : .medium))
                                .foregroundStyle(done ? Brand.navy : Brand.muted)
                            Spacer(minLength: 0)
                        }
                        if index < steps.count - 1 {
                            Capsule()
                                .fill(moment > index + 1 ? Brand.navy : Brand.line)
                                .frame(width: 3, height: 14)
                                .padding(.leading, 15.5)
                        }
                    }
                }
            }
        }
        .modifier(PictureScene(active: active, steps: 3, gap: 0.6, wait: 0.4, moment: $moment))
    }
}
