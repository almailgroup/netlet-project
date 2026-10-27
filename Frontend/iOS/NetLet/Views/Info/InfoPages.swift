import SwiftUI

/// A reading page's frame: the title, the line under it, the content — the
/// web's `PageBody width="reading"` with its `PageHeading`.
struct InfoPage<Content: View>: View {
    let title: String
    var note: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        ShopPage {
            VStack(alignment: .leading, spacing: 0) {
                Text(title).pageTitle().fixedSize(horizontal: false, vertical: true)
                if let note {
                    Text(note)
                        .font(.inter(15))
                        .lineSpacing(4)
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }
                Rectangle().fill(Brand.cardLine).frame(height: 1).padding(.top, 16).padding(.bottom, 20)
                content()
            }
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A row that opens another page: an icon, the words, an onward arrow.
struct OnwardLink: View {
    let symbol: String
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .foregroundStyle(Brand.navy)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Brand.tint))
                    .accessibilityHidden(true)
                Text(title).font(.inter(15, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                Image(systemName: "arrow.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Brand.navy)
                    .flipsForRightToLeftLayoutDirection(true)
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
    }
}

// MARK: - Help

/// The public front of help — the web's `/help`: find an order by its number
/// and email (or, signed in, go to the orders), the ways to reach a person,
/// the answers the shop's own rules give, and the newest guides.
struct HelpCentreView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        InfoPage(title: l.t("help.title"), note: l.t("help.intro")) {
            VStack(alignment: .leading, spacing: 16) {
                HelpAskBox()
                OrderLookupCard()
                ContactCard()
                if let groups = SiteContent.shared?.help.groups {
                    ForEach(groups) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(l.t(group.title)).shelfTitle().padding(.top, 8)
                            VStack(spacing: 0) {
                                ForEach(group.entries) { entry in
                                    HelpAnswer(entry: entry)
                                    if entry.id != group.entries.last?.id { Divider() }
                                }
                            }
                            .card(padding: 0)
                        }
                    }
                }
                GuidesShelf(limit: 4)
            }
        }
    }
}

/// One question, opened to its answer and the page it is acted on.
private struct HelpAnswer: View {
    let entry: SiteContent.Help.Entry
    @State private var open = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack {
                    Text(l.t(entry.question)).font(.inter(15, .semibold)).foregroundStyle(Brand.ink).multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Brand.muted)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            .accessibilityAddTraits(open ? .isSelected : [])
            if open {
                Text(l.t(entry.answer, entry.params))
                    .font(.inter(14))
                    .foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
                if let link = entry.link, let route = Route.from(link: link.href) {
                    Button {
                        app.open(route)
                    } label: {
                        HStack(spacing: 6) {
                            Text(l.t(link.label))
                            Image(systemName: "arrow.forward").flipsForRightToLeftLayoutDirection(true)
                        }
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.tap)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
    }
}

/// Where an order is, for somebody who has its number and email but no
/// session — or, signed in, the way to the orders themselves.
private struct OrderLookupCard: View {
    @State private var reference = ""
    @State private var email = ""
    @State private var finding = false
    @State private var found: LookedUpOrder?
    @State private var missed: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(l.t("help.lookupTitle"), systemImage: "magnifyingglass").font(.inter(17, .heavy)).foregroundStyle(Brand.navy)
            if app.session.isSignedIn {
                Text(l.t("help.lookupSignedIn")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                Button(l.t("help.lookupOpenOrders")) { app.open(.orders) }
                    .buttonStyle(PrimaryButtonStyle())
            } else {
                LabeledField(label: l.t("help.lookupReference"), text: $reference, hint: l.t("help.lookupNote"), leftToRight: true)
                LabeledField(label: l.t("help.lookupEmail"), text: $email, keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
                Button {
                    Task { await lookUp() }
                } label: {
                    if finding { ProgressView().tint(.white) } else { Text(l.t("help.lookupButton")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(finding || reference.trimmingCharacters(in: .whitespaces).isEmpty || email.trimmingCharacters(in: .whitespaces).count < 3)
                if let missed { Text(l.t(missed)).font(.inter(13)).foregroundStyle(Brand.danger) }
                if let found { result(found) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func result(_ order: LookedUpOrder) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\u{2066}\(order.reference)\u{2069}").font(.inter(15, .heavy)).foregroundStyle(Brand.navy)
                Spacer()
                Text(OrderWording.payment(status: order.status, language: l)).font(.inter(12, .bold)).foregroundStyle(Brand.navy)
            }
            Text(l.t("help.lookupPlaced", ["date": OrderWording.date(order.placedAt, language: l.current)])).font(.inter(13)).foregroundStyle(Brand.muted)
            ForEach(Array(order.lines.enumerated()), id: \.offset) { _, line in
                HStack {
                    Text("\(line.title) × \(line.quantity)").font(.inter(14)).foregroundStyle(Brand.ink)
                    Spacer()
                    Text(OrderWording.line(line.fulfilment, language: l)).font(.inter(12, .bold)).foregroundStyle(Brand.navy)
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint.opacity(0.6)))
    }

    private func lookUp() async {
        finding = true
        defer { finding = false }
        missed = nil
        found = nil
        do {
            found = try await app.services.api.call(API.lookupOrder, .init(
                reference: reference.trimmingCharacters(in: .whitespaces),
                email: email.trimmingCharacters(in: .whitespaces)
            ))
            if found == nil {
                Haptics.refused()
                missed = "help.lookupNone"
            } else {
                Haptics.succeeded()
            }
        } catch {
            Haptics.refused()
            let key = APIError.from(error).messageKey(knownKey: l.phrasebook.has)
            missed = key.hasPrefix("help.") ? key : "help.lookupNone"
        }
    }
}

/// How to reach a person: a message in the app, WhatsApp and the phone where set.
private struct ContactCard: View {
    @State private var contact: ShopContact?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(l.t("help.contactTitle"), systemImage: "message").font(.inter(17, .heavy)).foregroundStyle(Brand.navy)
            Button(l.t("help.contactMessage")) {
                if app.session.isSignedIn { app.open(.help) } else { app.authPresented = true }
            }
            .buttonStyle(PrimaryButtonStyle())
            HStack(spacing: 10) {
                if let whatsapp = contact?.whatsapp {
                    Button {
                        let hello = l.t("support.whatsappHello").addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
                        if let url = URL(string: "whatsapp://send?phone=\(whatsapp)&text=\(hello)") { openURL(url) }
                    } label: {
                        Label(l.t("support.whatsapp"), systemImage: "message")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                if let phone = contact?.phone {
                    Button {
                        if let url = URL(string: "tel:+\(phone)") { openURL(url) }
                    } label: {
                        Label(l.t("support.call"), systemImage: "phone")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
            if !app.session.isSignedIn {
                Text(l.t("help.contactMessageNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .task { contact = (try? await app.services.catalog.contact()) ?? ShopContact.fallback }
    }
}

// MARK: - Returns

/// What happens to a return — the web's `/returns`: the window, how each
/// reason is decided, and what comes after, with the way to start one.
struct ReturnsPolicyView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private let decided: [(String, String, String)] = [
        ("checkmark.circle", "returnsPage.faultTitle", "returnsPage.faultBody"),
        ("tshirt", "returnsPage.mindTitle", "returnsPage.mindBody"),
        ("text.bubble", "returnsPage.otherTitle", "returnsPage.otherBody"),
    ]
    private let after: [(String, String, String)] = [
        ("arrow.triangle.2.circlepath", "returnsPage.exchangeTitle", "returnsPage.exchangeBody"),
        ("shippingbox", "returns.condition.title", "returns.condition.body"),
        ("wallet.pass", "returns.refund.title", "returns.refund.body"),
    ]

    var body: some View {
        InfoPage(title: l.t("returnsPage.title"), note: l.t("returnsPage.intro", ["days": "\(ReferenceData.shared.rules.returnWindowDays)"])) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Button(l.t("returnsPage.start")) { app.open(.orders) }
                        .buttonStyle(PrimaryButtonStyle())
                    Text(l.t("returnsPage.startNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Text(l.t("returnsPage.howDecided")).shelfTitle().padding(.top, 8)
                rows(decided)
                Text(l.t("shipping.returns.title")).shelfTitle().padding(.top, 8)
                rows(after)
                OnwardLink(symbol: "lifepreserver", title: "\(l.t("returnsPage.questions")) \(l.t("support.section"))") { app.open(.helpCentre) }
            }
        }
    }

    private func rows(_ rows: [(String, String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(rows, id: \.1) { symbol, title, body in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: symbol)
                        .foregroundStyle(Brand.navy)
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(Brand.tint))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(l.t(title)).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                        Text(l.t(body, ["days": "\(ReferenceData.shared.rules.returnWindowDays)"]))
                            .font(.inter(14))
                            .foregroundStyle(Brand.body)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

// MARK: - Terms, privacy, the seller agreement

/// One of the three documents — the web's `pages/Legal.tsx`: its sections in
/// order, every sentence drawn with the code's own figures, and a paragraph
/// about a service the shop does not run left out.
struct LegalView: View {
    let document: LegalDocument
    @State private var company: ShopContact.Company?
    @State private var emailRunning = false
    @State private var drivingTimesRunning = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let legal = SiteContent.shared?.legal
        let doc = legal?.documents[document.rawValue]
        let figures = legal?.figures ?? [:]
        InfoPage(title: doc.map { l.t($0.title) } ?? "", note: doc.map { intro($0, figures: figures) }) {
            VStack(alignment: .leading, spacing: 20) {
                if let updated = legal?.updated {
                    Text(l.t("legal.updated", ["date": OrderWording.day(updated, language: l.current)]))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                }
                ForEach(doc?.sections ?? []) { section in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(l.t(section.title)).font(.inter(18, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                        ForEach(section.body.filter(shown), id: \.key) { paragraph in
                            Text(l.t(paragraph.key, figures))
                                .font(.inter(15))
                                .lineSpacing(4)
                                .foregroundStyle(Brand.body)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 10) {
                    Text(l.t("legal.questions")).font(.inter(14)).foregroundStyle(Brand.body)
                    OnwardLink(symbol: "lifepreserver", title: l.t("legal.goToHelp")) { app.open(.helpCentre) }
                    if document == .sellers {
                        OnwardLink(symbol: "storefront", title: l.t("footer.sellWithUs")) { app.open(.sell) }
                        OnwardLink(symbol: "doc.text", title: l.t("footer.terms")) { app.open(.legal(.terms)) }
                    } else {
                        OnwardLink(symbol: "doc.text", title: l.t(document == .terms ? "footer.privacy" : "footer.terms")) {
                            app.open(.legal(document == .terms ? .privacy : .terms))
                        }
                        OnwardLink(symbol: "arrow.uturn.backward", title: l.t("footer.returns")) { app.open(.returnsPolicy) }
                    }
                }
                .padding(.top, 8)
            }
        }
        .task {
            company = (try? await app.services.catalog.contact())?.company
            emailRunning = (try? await app.services.api.call(API.noticeChannels))?.email ?? false
            drivingTimesRunning = (try? await app.services.api.call(API.mapAvailability))?.drivingTimes ?? false
        }
    }

    /// Who runs the shop, when it is recorded — the introduction names the
    /// operator, without the name's own full stop (`nameInSentence`).
    private func intro(_ doc: SiteContent.Legal.Document, figures: [String: String]) -> String {
        guard let company else { return l.t(doc.plain, figures) }
        let name = (l.current == .ar ? company.nameAr ?? company.name : company.name)
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "[.\\s]+$", with: "", options: .regularExpression)
        return l.t(doc.intro, figures.merging(["operator": name]) { current, _ in current })
    }

    /// A paragraph about a service is drawn only while the shop runs it.
    private func shown(_ paragraph: SiteContent.Legal.Paragraph) -> Bool {
        switch paragraph.only {
        case nil: return true
        case "email": return emailRunning
        // Off unless the shop has switched it on: it sends shoppers' photos to Google.
        case "tryOn": return app.features.values["tryOn"] == true
        // Apple is asked for driving times only while a signing key is set up.
        case "drivingTimes": return drivingTimesRunning
        default: return false
        }
    }
}

// MARK: - Guides

/// Every published guide, shopping first and then selling — the web's `/guides`.
struct GuidesView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.guides) } }) { guides in
            InfoPage(title: l.t("guides.title"), note: l.t("guides.intro")) {
                LoadStateView(state: guides.state, retry: { await guides.load() }) { list in
                    let groups = [("shopper", "guides.shoppingTitle"), ("seller", "guides.sellingTitle")]
                        .map { audience, title in (title, list.filter { $0.audience == audience }) }
                        .filter { !$0.1.isEmpty }
                    if groups.isEmpty {
                        EmptyStateView(systemImage: "book", title: l.t("guides.empty"), note: l.t("guides.emptyNote"), actionTitle: l.t("help.title")) {
                            app.open(.helpCentre)
                        }
                        .card(padding: 0)
                    } else {
                        VStack(alignment: .leading, spacing: 20) {
                            ForEach(groups, id: \.0) { title, cards in
                                VStack(alignment: .leading, spacing: 12) {
                                    Text(l.t(title)).shelfTitle()
                                    ForEach(cards) { card in GuideCardView(guide: card) }
                                }
                            }
                        }
                    }
                }
            }
            .task { await guides.load() }
        }
    }
}

/// A few guides under the help page's answers, with the way to all of them.
private struct GuidesShelf: View {
    let limit: Int
    @State private var guides: [GuideCard] = []
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !guides.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text(l.t("guides.helpTitle")).shelfTitle()
                        Spacer()
                        Button(l.t("guides.all")) { app.open(.guides) }
                            .font(.inter(14, .bold))
                            .foregroundStyle(Brand.navy)
                            .frame(minHeight: 44)
                            .buttonStyle(.tap)
                    }
                    ForEach(guides.prefix(limit)) { guide in GuideCardView(guide: guide) }
                }
                .padding(.top, 8)
            }
        }
        .task { guides = (try? await app.services.api.call(API.guides)) ?? [] }
    }
}

struct GuideCardView: View {
    let guide: GuideCard
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let title = pickGuideText(l.current, en: guide.title, ar: guide.titleAr)
        let summary = pickGuideText(l.current, en: guide.summary, ar: guide.summaryAr)
        Button {
            app.open(.guide(slug: guide.slug))
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                Color.clear
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay {
                        RemoteImage(reference: guide.imageUrl)
                    }
                    .background(Brand.tint)
                    .clipped()
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(l.t(guide.audience == "seller" ? "guides.forSellers" : "guides.forShoppers")) · \(l.t("guides.stepCount", ["count": "\(guide.stepCount)"]))")
                        .font(.inter(12, .semibold))
                        .foregroundStyle(Brand.accentInk)
                    Text(title.text)
                        .font(.inter(17, .heavy))
                        .foregroundStyle(Brand.navy)
                        .multilineTextAlignment(.leading)
                        .environment(\.layoutDirection, title.language.isRightToLeft ? .rightToLeft : .leftToRight)
                    if !summary.text.isEmpty {
                        Text(summary.text)
                            .font(.inter(14))
                            .foregroundStyle(Brand.body)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
    }
}

/// One guide: who it is for, its steps in order, each with its picture.
struct GuideView: View {
    let slug: String
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.guide, .init(slug: slug)) } }) { guide in
            ShopPage(refresh: { await guide.load() }) {
                LoadStateView(state: guide.state, retry: { await guide.load() }) { found in
                    if let found {
                        content(found)
                    } else {
                        EmptyStateView(systemImage: "book", title: l.t("guides.notFound"), note: l.t("guides.notFoundNote"), actionTitle: l.t("guides.all")) {
                            app.open(.guides)
                        }
                    }
                }
            }
            .task { await guide.load() }
        }
    }

    private func content(_ guide: Guide) -> some View {
        let title = pickGuideText(l.current, en: guide.title, ar: guide.titleAr)
        let summary = pickGuideText(l.current, en: guide.summary, ar: guide.summaryAr)
        return VStack(alignment: .leading, spacing: 16) {
            Text(title.text).pageTitle().fixedSize(horizontal: false, vertical: true)
            Text("\(l.t(guide.audience == "seller" ? "guides.forSellers" : "guides.forShoppers")) · \(l.t("guides.stepCount", ["count": "\(guide.steps.count)"]))")
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.accentInk)
            if !summary.text.isEmpty {
                Text(summary.text).font(.inter(15)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(guide.steps.enumerated()), id: \.offset) { index, step in
                let stepTitle = pickGuideText(l.current, en: step.title, ar: step.titleAr)
                let body = pickGuideText(l.current, en: step.body, ar: step.bodyAr)
                VStack(alignment: .leading, spacing: 10) {
                    if let image = step.imageUrl {
                        Color.clear
                            .aspectRatio(4 / 3, contentMode: .fit)
                            .overlay { RemoteImage(reference: image, label: stepTitle.text) }
                            .background(Brand.tint)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(index + 1)")
                            .font(.inter(14, .heavy))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(Brand.navy))
                            .accessibilityLabel(l.t("guides.stepN", ["n": "\(index + 1)"]))
                        Text(stepTitle.text).font(.inter(17, .heavy)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(body.text.split(separator: "\n").map(String.init), id: \.self) { paragraph in
                        Text(paragraph).font(.inter(15)).lineSpacing(3).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
            }
            OnwardLink(symbol: "book", title: l.t("guides.all")) { app.open(.guides) }
            OnwardLink(symbol: "lifepreserver", title: l.t("guides.stillStuck")) { app.open(.helpCentre) }
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 48)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
