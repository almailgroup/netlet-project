import SwiftUI

/// The help centre's self-service in the app (`Shared/commerce/selfService.ts`
/// is the rule, `support.selfHelp` the server's answer): the issues a shopper
/// can name, the answer from their own order, and the acts that would settle
/// it — each done on Confirm, by the same call the item's own sheet makes.
/// Drawn by the order's help sheet (`OrderHelpSheet`) and the help centre
/// (`IssueCentre`), so the two offer the same.
enum HelpIssues {
    /// Where a conversation about an issue is filed on NetLet's desk (`topicFor`).
    static func topic(_ issue: String?) -> String {
        switch issue {
        case nil: return "order"
        case "late": return "delivery"
        case "payment": return "payment"
        case "account": return "account"
        default: return "return"
        }
    }

    static func symbol(_ issue: String) -> String {
        switch issue {
        case "late": return "clock"
        case "damaged": return "shippingbox.and.arrow.backward"
        case "wrong": return "questionmark.app"
        case "return": return "arrow.uturn.backward"
        case "exchange": return "arrow.left.arrow.right"
        case "warranty": return "checkmark.shield"
        case "payment": return "banknote"
        default: return "person.crop.circle"
        }
    }

    /// What a panel an answer opens is called.
    static func panelLabel(_ panel: String, item: Bool) -> String {
        switch panel {
        case "track": return item ? "orders.trackItem" : "orders.track"
        case "refund": return "orders.requestRefund"
        case "returnForm": return "help.offer.otherReason"
        case "warranty": return "warranty.title"
        case "address": return "orders.changeAddress"
        case "modify": return "orders.modify"
        default: return "orders.rateItems"
        }
    }

    /// An account page an answer sends a shopper to, and its name.
    static func page(_ to: String) -> (route: Route, label: String) {
        switch to {
        case "security": return (.security, "help.page.security")
        case "profile": return (.profile, "help.page.profile")
        case "notifications": return (.preferences, "help.page.notifications")
        case "addresses": return (.addresses, "help.page.addresses")
        default: return (.returns, "help.page.returns")
        }
    }

    /// How a return's answer is reported to a person (`doneForReturn`).
    static func doneForReturn(kind: String, status: String) -> String {
        let decided = status == "approved" ? "Approved" : status == "declined" ? "Declined" : "Waiting"
        return (kind == "exchange" ? "exchange" : "return") + decided
    }
}

/// The issues as presses, each with its picture.
struct IssueChips: View {
    let issues: [String]
    let pick: (String) -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(issues, id: \.self) { issue in
                Button {
                    pick(issue)
                } label: {
                    Label(l.t("help.issue.\(issue)"), systemImage: HelpIssues.symbol(issue))
                }
                .buttonStyle(OrderActionStyle())
            }
        }
    }
}

/// The order's items to choose from, for an issue about one of them.
struct HelpItemPicker: View {
    let items: [SelfHelpAnswer.Item]
    let pick: (Int) -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("help.chooseItem")).font(.inter(14, .heavy)).foregroundStyle(Brand.navy)
            ForEach(items) { item in
                Button {
                    Haptics.tap()
                    pick(item.id)
                } label: {
                    HStack(spacing: 12) {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.white)
                            .frame(width: 44, height: 44)
                            .overlay { RemoteImage(reference: item.photo, label: item.title) }
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title).font(.inter(14, .bold)).foregroundStyle(Brand.navy).lineLimit(2).multilineTextAlignment(.leading)
                            if let variant = item.variant {
                                Text(variant).font(.inter(12)).foregroundStyle(Brand.muted)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                }
                .buttonStyle(.tap)
            }
        }
    }
}

/// The answer from the order: what is true now, then what would settle it.
struct HelpAnswerView: View {
    let reference: String?
    let answer: SelfHelpAnswer
    let items: [SelfHelpAnswer.Item]
    let reload: () async -> Void
    let open: (String, Int?) -> Void
    let record: (API.Handover.Done) -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(l.t("help.fromOrder"), systemImage: "checklist")
                .font(.inter(11, .bold))
                .foregroundStyle(Brand.muted)
            ForEach(Array(answer.say.enumerated()), id: \.offset) { _, part in
                Text(l.t(part.key, part.params))
                    .font(.inter(14))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !answer.offers.isEmpty {
                HelpOffersView(reference: reference, offers: answer.offers, items: items, reload: reload, open: open, record: record)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }
}

/// Acts first, as cards with Confirm; then the panels and pages, as presses.
struct HelpOffersView: View {
    let reference: String?
    let offers: [HelpOffer]
    let items: [SelfHelpAnswer.Item]
    let reload: () async -> Void
    let open: (String, Int?) -> Void
    let record: (API.Handover.Done) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let acts = offers.filter(\.isAct)
        let links = offers.filter { !$0.isAct }
        VStack(alignment: .leading, spacing: 8) {
            if let reference {
                ForEach(Array(acts.enumerated()), id: \.offset) { _, offer in
                    HelpActCard(reference: reference, offer: offer, item: items.first { $0.id == offer.lineId }, reload: reload, record: record)
                }
            }
            if !links.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(Array(links.enumerated()), id: \.offset) { _, offer in
                        if offer.kind == "page", let to = offer.to {
                            let page = HelpIssues.page(to)
                            Button(l.t(page.label)) { app.open(page.route) }
                                .buttonStyle(OrderActionStyle())
                        } else if let panel = offer.panel {
                            Button(l.t(HelpIssues.panelLabel(panel, item: offer.lineId != nil))) { open(panel, offer.lineId) }
                                .buttonStyle(OrderActionStyle())
                        }
                    }
                }
            }
            if !acts.isEmpty, reference != nil {
                Text(l.t("help.offer.note")).font(.inter(11)).foregroundStyle(Brand.muted)
            }
        }
    }
}

/// One act, said in full, done on Confirm.
struct HelpActCard: View {
    let reference: String
    let offer: HelpOffer
    let item: SelfHelpAnswer.Item?
    let reload: () async -> Void
    let record: (API.Handover.Done) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var dismissed = false
    @State private var outcome: (done: Bool, text: String)?
    @State private var working = false
    @State private var kind = ""
    @State private var reason = ""
    @State private var quote: ChangeQuote?

    private var title: String { item?.title ?? "" }

    var body: some View {
        if dismissed {
            EmptyView()
        } else if let outcome {
            Label {
                Text(outcome.text).font(.inter(13)).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: outcome.done ? "checkmark.circle.fill" : "exclamationmark.circle")
            }
            .foregroundStyle(outcome.done ? Brand.success : Brand.danger)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(outcome.done ? Brand.successFill : Brand.danger.opacity(0.08)))
        } else {
            card
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(heading).font(.inter(14, .heavy)).foregroundStyle(Brand.navy)
            Text(bodyText).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            if offer.kind == "return" {
                choices
            }
            HStack(spacing: 8) {
                Button {
                    Task { await run() }
                } label: {
                    HStack(spacing: 6) {
                        if working { ProgressView().tint(.white) }
                        Text(confirmLabel)
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(working || (offer.kind == "cancelItem" && quote == nil) || (offer.kind == "buyAgain" && offer.lineId != nil && item?.variantId == nil))
                Button(l.t("help.offer.notNow")) { dismissed = true }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
        .task {
            if kind.isEmpty { kind = offer.returnKinds?.first ?? "refund" }
            if reason.isEmpty { reason = offer.reasons?.first ?? "damaged" }
            if offer.kind == "cancelItem", let lineId = offer.lineId, quote == nil {
                quote = try? await app.services.api.call(API.changeQuote, .init(reference: reference, changes: [.init(lineId: lineId, quantity: 0)]))
            }
        }
    }

    @ViewBuilder private var choices: some View {
        if let kinds = offer.returnKinds, kinds.count > 1 {
            Picker(heading, selection: $kind) {
                ForEach(kinds, id: \.self) { option in
                    Text(l.t(option == "exchange" ? "help.offer.exchange" : "help.offer.refund")).tag(option)
                }
            }
            .pickerStyle(.segmented)
        }
        if let reasons = offer.reasons, reasons.count > 1 {
            VStack(alignment: .leading, spacing: 4) {
                Text(l.t("help.offer.why")).font(.inter(12, .heavy)).foregroundStyle(Brand.muted)
                Menu {
                    ForEach(reasons, id: \.self) { option in
                        Button(l.t(LineReturnPanel.reasonKey(option))) { reason = option }
                    }
                } label: {
                    MenuField(text: l.t(LineReturnPanel.reasonKey(reason)), placeholder: l.t("help.offer.why"))
                }
            }
        }
    }

    private var heading: String {
        switch offer.kind {
        case "return": return l.t("help.offer.returnTitle", ["item": title])
        case "cancelOrder": return l.t("help.offer.cancelOrder")
        case "cancelItem": return l.t("help.offer.cancelItem", ["item": title])
        default: return l.t(offer.lineId == nil ? "help.offer.buyAgainAll" : "help.offer.buyAgain")
        }
    }

    private var bodyText: String {
        switch offer.kind {
        case "return": return l.t(kind == "exchange" ? "help.offer.exchangeBody" : "help.offer.returnBody")
        case "cancelOrder": return l.t("help.offer.cancelOrderBody")
        case "cancelItem":
            guard let quote else { return "…" }
            return l.t("help.offer.cancelItemBody", ["owed": quote.owedAfter.formatted(l.current), "was": quote.owedBefore.formatted(l.current)])
        default: return l.t("help.offer.buyAgainBody")
        }
    }

    private var confirmLabel: String {
        switch offer.kind {
        case "return": return l.t(kind == "exchange" ? "help.offer.confirmExchange" : "help.offer.confirmReturn")
        default: return heading
        }
    }

    private func run() async {
        working = true
        defer { working = false }
        Haptics.action()
        do {
            switch offer.kind {
            case "return":
                guard let lineId = offer.lineId else { return }
                let reply = try await app.services.api.call(API.requestReturn, .init(reference: reference, orderItemId: lineId, kind: kind, reason: reason, note: nil))
                if reply.status == "declined" {
                    outcome = (false, l.t("help.result.declined", ["reason": reply.declineReason.map { l.t($0) } ?? ""]))
                } else {
                    outcome = (true, l.t(reply.status == "approved" ? "help.result.approved" : "help.result.waiting"))
                }
                record(.init(act: HelpIssues.doneForReturn(kind: kind, status: reply.status), lineId: lineId))
            case "cancelOrder":
                _ = try await app.services.api.call(API.cancelOrder, .init(reference: reference))
                outcome = (true, l.t("help.result.cancelOrder"))
                record(.init(act: "cancelOrder", lineId: nil))
            case "cancelItem":
                guard let lineId = offer.lineId, let quote else { return }
                _ = try await app.services.api.call(API.changeOrder, .init(reference: reference, changes: [.init(lineId: lineId, quantity: 0)], expectOwed: quote.owedAfter.amount))
                outcome = (true, l.t("help.result.cancelItem", ["item": title]))
                record(.init(act: "cancelItem", lineId: lineId))
            default:
                if offer.lineId == nil {
                    let answer = try await app.services.api.call(API.buyAgain, .init(reference: reference, cartId: app.cart.cartId))
                    if let id = answer.cartId, id != app.cart.cartId { await app.cart.adopt(cartId: id) } else { await app.cart.restore() }
                    guard answer.added > 0 else { throw APIError.server(code: "CONFLICT", message: "orders.buyAgainNone", status: 409) }
                } else if let variantId = item?.variantId {
                    guard await app.cart.add(variantId: String(variantId), quantity: item?.quantity ?? 1) else { throw APIError.server(code: "CONFLICT", message: "orders.buyAgainNone", status: 409) }
                }
                outcome = (true, l.t("help.result.buyAgain"))
                record(.init(act: "buyAgain", lineId: offer.lineId))
            }
            Haptics.succeeded()
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            guard failure != .cancelled else { return }
            outcome = (false, l.t(failure.messageKey(knownKey: Phrasebook.shared.has)))
            record(.init(act: "failed", lineId: offer.lineId))
        }
        await reload()
    }
}

/// The top of the help centre — the web's `IssueCentre`: what happened,
/// answered from the shopper's own order before anybody is asked. Choose the
/// issue, then the order and the item where it is about one; the answer is the
/// opened order's own (`support.selfHelp`), with its acts done on Confirm
/// here. A panel that needs words or photos opens the order on it. A person is
/// one press away under every answer, handed the issue, the item and what was
/// done. Signed out, a press asks to sign in.
struct IssueCentre: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var issue: String?
    @State private var orders: [OrderSummary]?
    @State private var reference: String?
    @State private var lineId: Int?
    @State private var answer: SelfHelpAnswer?
    @State private var loading = false
    @State private var done: [API.Handover.Done] = []
    @State private var sentTo: Int?
    @State private var opening = false

    private var issues: [String] { ReferenceData.shared.rules.afterSalesRules.help.issues }
    private var aboutOrder: Bool { issue != nil && issue != "account" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("help.issuesTitle")).font(.inter(17, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("help.issuesIntro")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                ForEach(issues, id: \.self) { each in
                    tile(each)
                }
            }
            if issue != nil && !app.session.isSignedIn {
                VStack(alignment: .leading, spacing: 8) {
                    Text(l.t("help.signInForOrders")).font(.inter(14)).foregroundStyle(Brand.ink)
                    Button(l.t("header.signIn")) { app.openAccount(nil) }
                        .buttonStyle(PrimaryButtonStyle())
                }
            } else if aboutOrder && reference == nil {
                orderPicker
            }
            if loading { ProgressView().tint(Brand.navy) }
            if let answer {
                if answer.picksItem {
                    HelpItemPicker(items: answer.items) { picked in
                        lineId = picked
                        Task { await load() }
                    }
                } else {
                    HelpAnswerView(reference: reference, answer: answer, items: answer.items, reload: {}, open: openOrder, record: { done.append($0) })
                    person(next: answer.person == "next")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func tile(_ each: String) -> some View {
        let chosen = issue == each
        return Button {
            Haptics.tap()
            choose(chosen ? nil : each)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: HelpIssues.symbol(each))
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 36, height: 36)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
                Text(l.t("help.issue.\(each)"))
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(chosen ? Brand.tint : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(chosen ? Brand.navy : Brand.cardLine, lineWidth: chosen ? 1.5 : 1))
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(chosen ? .isSelected : [])
    }

    private var orderPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("help.chooseOrder")).font(.inter(14, .heavy)).foregroundStyle(Brand.navy)
            if let orders {
                if orders.isEmpty {
                    Text(l.t("help.noOrders")).font(.inter(14)).foregroundStyle(Brand.muted)
                }
                ForEach(orders) { order in
                    Button {
                        Haptics.tap()
                        reference = order.reference
                        Task { await load() }
                    } label: {
                        HStack(spacing: 12) {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.white)
                                .frame(width: 44, height: 44)
                                .overlay { RemoteImage(reference: order.summary.photos.first, label: order.summary.first?.title ?? order.reference) }
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(order.summary.first?.title ?? order.reference).font(.inter(14, .bold)).foregroundStyle(Brand.navy).lineLimit(1)
                                Text(order.reference).font(.inter(12)).foregroundStyle(Brand.muted).environment(\.layoutDirection, .leftToRight)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                    }
                    .buttonStyle(.tap)
                }
            } else {
                ProgressView().tint(Brand.navy)
            }
        }
        .task {
            if orders == nil { orders = (try? await app.services.api.call(API.orders, .init(page: 1, pageSize: 10)))?.rows ?? [] }
        }
    }

    @ViewBuilder private func person(next: Bool) -> some View {
        if let sentTo {
            VStack(alignment: .leading, spacing: 8) {
                Text(l.t("orderHelp.personWill")).font(.inter(14)).foregroundStyle(Brand.success)
                Button(l.t("orderHelp.followThere")) { app.open(.supportThread(id: sentTo)) }
                    .buttonStyle(SecondaryButtonStyle())
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text(l.t(next ? "orderHelp.personNext" : "orderHelp.personAlways")).font(.inter(13)).foregroundStyle(Brand.ink)
                Button {
                    Task { await handOver() }
                } label: {
                    HStack(spacing: 8) {
                        if opening { ProgressView().tint(.white) } else { Image(systemName: "person.fill") }
                        Text(l.t("orderHelp.toPerson"))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(opening)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(next ? Brand.accentWash : Brand.tint))
        }
    }

    private func choose(_ next: String?) {
        issue = next
        reference = nil
        lineId = nil
        answer = nil
        done = []
        sentTo = nil
        if next == "account", app.session.isSignedIn { Task { await load() } }
    }

    private func load() async {
        guard let issue else { return }
        loading = true
        defer { loading = false }
        answer = try? await app.services.api.call(API.selfHelp, .init(issue: issue, reference: reference, lineId: lineId, locale: l.current.rawValue))
    }

    /// A panel that needs words or photos opens the order on it.
    private func openOrder(_ panel: String, _ line: Int?) {
        guard let reference else { return }
        app.orderSheet = panel == "returnForm" ? "refund" : panel
        app.open(.order(reference: reference))
    }

    private func handOver() async {
        opening = true
        defer { opening = false }
        let handover = API.Handover(issue: issue, lineId: lineId, done: done)
        do {
            let opened = try await app.services.api.call(API.openSupport, .init(topic: HelpIssues.topic(issue), orderReference: reference, body: issue.map { l.t("help.issue.\($0)") } ?? "", handover: handover))
            Haptics.succeeded()
            app.toast(l.t("orderHelp.sentToPerson"))
            sentTo = opened.id
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            if failure != .cancelled { app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has))) }
        }
    }
}
