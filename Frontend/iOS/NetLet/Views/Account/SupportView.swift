import SwiftUI

/// One message in a thread: the shopper's at the end, the other side's at the start.
struct Bubble: View {
    let mine: Bool
    let author: String
    var about: String?
    let text: String
    let stamp: String

    var body: some View {
        HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 4) {
                Text("\(author):").font(.inter(12, .bold)).foregroundStyle(mine ? Color.white.opacity(0.85) : Brand.muted)
                if let about {
                    Text(about).font(.inter(12)).foregroundStyle(mine ? Color.white.opacity(0.85) : Brand.muted)
                }
                Text(text)
                    .font(.inter(14))
                    .foregroundStyle(mine ? Color.white : Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                Text(stamp).font(.inter(11)).foregroundStyle(mine ? Color.white.opacity(0.75) : Brand.muted)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(mine ? Brand.navy : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(mine ? Color.clear : Brand.cardLine, lineWidth: 1))
            if !mine { Spacer(minLength: 40) }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A message box and Send. A message carrying a phone number, an email or a
/// link is refused by the server and said back.
struct Composer: View {
    let label: String
    let limit: Int
    var note: String?
    let send: (String) async -> Bool
    @State private var text = ""
    @State private var sending = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        VStack(alignment: .leading, spacing: 8) {
            LabeledField(label: label, text: $text, placeholder: label, axis: .vertical)
            if text.count > limit {
                FieldProblem(key: "support.tooLong")
            }
            HStack(alignment: .center, spacing: 10) {
                Text(note ?? "")
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    Task {
                        sending = true
                        defer { sending = false }
                        if await send(trimmed) { text = "" }
                    }
                } label: {
                    if sending {
                        ProgressView().tint(.white)
                    } else {
                        Label(l.t("chat.send"), systemImage: "paperplane.fill")
                    }
                }
                .buttonStyle(CompactPrimaryStyle())
                .disabled(trimmed.isEmpty || text.count > limit || sending)
            }
        }
        .card()
    }
}

/// A primary action that sizes to its words, for beside a line of text.
struct CompactPrimaryStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(14, .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .frame(minHeight: 44)
            .background(Capsule().fill(isEnabled ? (configuration.isPressed ? Brand.navyPressed : Brand.navy) : Brand.navy.opacity(0.35)))
            .pressHaptic(configuration.isPressed, strength: Haptics.actionStrength)
    }
}

// MARK: - Help from NetLet

/// Talking to NetLet — the web's `AccountSupport`: ask about an order or
/// anything else, read the conversations, and the other ways to reach a person.
struct SupportView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { SupportModel(api: app.services.api, orders: app.services.orders) }) { model in
            ShopPage(header: false, footer: false, refresh: { await model.load() }) {
                AccountSection(title: l.t("support.section"), hint: l.t("account.hint.help")) {
                    VStack(alignment: .leading, spacing: 14) {
                        AskForm(model: model)
                        OtherChannels(reference: model.reference)
                        LoadStateView(state: model.conversations.state, retry: { await model.load() }) { rows in
                            if rows.isEmpty {
                                Text(l.t("support.none")).font(.inter(14)).foregroundStyle(Brand.muted)
                            } else {
                                VStack(spacing: 10) {
                                    ForEach(rows) { row in conversation(row) }
                                }
                            }
                        }
                    }
                }
            }
            .task { await model.load() }
        }
    }

    private func conversation(_ row: SupportConversation) -> some View {
        Button {
            app.push(.supportThread(id: row.id))
        } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(l.t(SupportView.topicLabel(row.topic))).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                        if let reference = row.orderReference {
                            Text("· \u{2066}\(reference)\u{2069}").font(.inter(13)).foregroundStyle(Brand.muted)
                        }
                    }
                    Text(OrderWording.date(row.lastMessageAt, language: l.current)).font(.inter(12)).foregroundStyle(Brand.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if row.unread {
                    Text(l.t("support.newReply"))
                        .font(.inter(11, .bold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Brand.orange))
                }
                Text(l.t(SupportView.statusLabel(row.status)))
                    .font(.inter(12, .bold))
                    .foregroundStyle(row.status == "resolved" ? Brand.success : Brand.navy)
                Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Brand.chevron)
            }
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressFillStyle(cornerRadius: 16))
    }

    static func topicLabel(_ topic: String) -> String {
        switch topic {
        case "order": return "support.topicOrder"
        case "delivery": return "support.topicDelivery"
        case "return": return "support.topicReturn"
        case "payment": return "support.topicPayment"
        case "account": return "support.topicAccount"
        default: return "support.topicOther"
        }
    }

    static func statusLabel(_ status: String) -> String {
        switch status {
        case "waiting": return "support.statusWaiting"
        case "resolved": return "support.statusResolved"
        default: return "support.statusOpen"
        }
    }
}

@Observable
@MainActor
final class SupportModel {
    let conversations: Loader<[SupportConversation]>
    private(set) var orders: [OrderSummary] = []
    var topic = "order"
    var reference = ""
    var message = ""
    private(set) var asking = false
    let api: APICalling
    private let orderService: OrderServicing

    init(api: APICalling, orders: OrderServicing) {
        self.api = api
        orderService = orders
        conversations = Loader { try await api.call(API.supportConversations) }
    }

    func load() async {
        await conversations.load()
        if let page = try? await orderService.orders(page: 1) { orders = page.rows }
    }

    /// Opens a conversation, answering its id so the thread can be shown.
    func ask() async throws -> Int {
        asking = true
        defer { asking = false }
        let opened = try await api.call(API.openSupport, .init(topic: topic, orderReference: reference.isEmpty ? nil : reference, body: message))
        message = ""
        await conversations.load()
        return opened.id
    }
}

private struct AskForm: View {
    @Bindable var model: SupportModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let limit = ReferenceData.shared.rules.accountRules.maxSupportMessage
        let empty = model.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        VStack(alignment: .leading, spacing: 12) {
            Label(l.t("support.askTitle"), systemImage: "lifepreserver")
                .font(.inter(16, .heavy))
                .foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            Text(l.t("support.askNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("support.about")).font(.subheadline.weight(.semibold))
                Menu {
                    ForEach(ReferenceData.shared.rules.accountRules.supportTopics, id: \.self) { topic in
                        Button(l.t(SupportView.topicLabel(topic))) {
                            Haptics.tap()
                            model.topic = topic
                        }
                    }
                } label: {
                    MenuField(text: l.t(SupportView.topicLabel(model.topic)), placeholder: "")
                }
                .accessibilityLabel(l.t("support.about"))
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("support.whichOrder")).font(.subheadline.weight(.semibold))
                Menu {
                    Button(l.t("support.noOrder")) {
                        Haptics.tap()
                        model.reference = ""
                    }
                    ForEach(model.orders) { order in
                        Button(order.reference) {
                            Haptics.tap()
                            model.reference = order.reference
                        }
                    }
                } label: {
                    MenuField(text: model.reference.isEmpty ? l.t("support.noOrder") : model.reference, placeholder: "")
                }
                .accessibilityLabel(l.t("support.whichOrder"))
            }
            LabeledField(label: l.t("support.message"), text: $model.message, axis: .vertical)
            if model.message.count > limit { FieldProblem(key: "support.tooLong") }
            Button {
                Task {
                    var opened: Int?
                    if await app.attempt({ opened = try await model.ask() }), let opened {
                        app.push(.supportThread(id: opened))
                    }
                }
            } label: {
                if model.asking { ProgressView().tint(.white) } else { Text(l.t("support.send")) }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(empty || model.message.count > limit || model.asking)
        }
        .card()
    }
}

/// NetLet's WhatsApp and phone, where they are set — they open the phone's
/// own apps, with the chosen order's reference written in and nothing else.
private struct OtherChannels: View {
    let reference: String
    @State private var contact: ShopContact?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let contact, contact.whatsapp != nil || contact.phone != nil {
                VStack(alignment: .leading, spacing: 10) {
                    Text(l.t("support.otherChannels")).font(.inter(16, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                    HStack(spacing: 10) {
                        if let whatsapp = contact.whatsapp {
                            Button {
                                let text = reference.isEmpty ? l.t("support.whatsappHello") : l.t("support.whatsappAboutOrder", ["reference": reference])
                                let encoded = text.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
                                if let url = URL(string: "whatsapp://send?phone=\(whatsapp)&text=\(encoded)") { openURL(url) }
                            } label: {
                                Label(l.t("support.whatsapp"), systemImage: "message")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                        if let phone = contact.phone {
                            Button {
                                if let url = URL(string: "tel:+\(phone)") { openURL(url) }
                            } label: {
                                Label(l.t("support.call"), systemImage: "phone")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                    }
                    Text(l.t("support.otherChannelsNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                .card()
            }
        }
        .task { contact = try? await app.services.catalog.contact() }
    }
}

/// One conversation with NetLet: the automatic first answer, written from the
/// order's own facts, NetLet's people, a reply box and "That answered it".
struct SupportThreadView: View {
    let conversationId: Int
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.supportThread, .init(id: conversationId)) } }) { thread in
            ShopPage(header: false, footer: false, refresh: { await thread.load() }) {
                AccountSection(title: thread.value.map { l.t(SupportView.topicLabel($0.topic)) } ?? l.t("support.section"), hint: l.t("support.askNote")) {
                    LoadStateView(state: thread.state, retry: { await thread.load() }) { data in
                        VStack(alignment: .leading, spacing: 14) {
                            VStack(spacing: 10) {
                                ForEach(data.messages) { message in
                                    Bubble(
                                        mine: message.author == "shopper",
                                        author: l.t(message.author == "automatic" ? "support.automatic" : message.author == "shopper" ? "support.you" : "support.netlet"),
                                        text: message.answer.map { parts in parts.map { l.t($0.key, $0.params) }.joined(separator: "\n\n") } ?? message.body ?? "",
                                        stamp: OrderWording.date(message.createdAt, language: l.current)
                                    )
                                }
                            }
                            Composer(label: l.t("support.reply"), limit: ReferenceData.shared.rules.accountRules.maxSupportMessage, note: "") { body in
                                let sent = await app.attempt {
                                    _ = try await app.services.api.call(API.replyToSupport, .init(id: conversationId, body: body))
                                }
                                if sent { await thread.load() }
                                return sent
                            }
                            if data.status != "resolved" {
                                Button {
                                    Task {
                                        if await app.attempt(done: "support.resolvedToast", { _ = try await app.services.api.call(API.resolveSupport, .init(id: conversationId)) }) {
                                            await thread.load()
                                        }
                                    }
                                } label: {
                                    Label(l.t("support.answered"), systemImage: "checkmark.circle")
                                }
                                .buttonStyle(SecondaryButtonStyle())
                            }
                        }
                    }
                }
            }
            .task {
                await thread.load()
                await app.signals.refresh()
            }
        }
    }
}
