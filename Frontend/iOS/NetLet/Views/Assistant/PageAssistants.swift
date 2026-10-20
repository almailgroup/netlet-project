import SwiftUI

/// "Ask about this product" — the web's product assistant: one card, a line
/// saying the answers are a model's from this listing, the questions fitted
/// to the product (and after an answer, its own follow-ups), the conversation
/// and the box. It does nothing until pressed, and is absent rather than
/// broken while no gateway is set up.
struct ProductAssistantPanel: View {
    let product: Product
    @State private var chat: ChatModel?
    @State private var draft = ""
    @FocusState private var typing: Bool
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if app.assistantOn {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    AssistantMark(size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.t("assistant.heading")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                        Text(l.t("assistant.note")).font(.inter(12)).foregroundStyle(Brand.muted)
                    }
                }
                if let chat {
                    ForEach(chat.messages) { message in
                        if message.fromShopper {
                            Text(message.text)
                                .font(.inter(14, .semibold))
                                .foregroundStyle(Brand.navy)
                                .accessibilityLabel(l.t("shopChat.you") + " " + message.text)
                        } else if !message.text.isEmpty {
                            ChatAnswerView(message: message, note: "assistant.generated")
                                .padding(12)
                                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.tint.opacity(0.5)))
                        } else if message.state == "streaming" {
                            HStack(spacing: 8) {
                                TypingDots()
                                Text(l.t("assistant.thinking")).font(.inter(13)).foregroundStyle(Brand.muted)
                            }
                        }
                        if message.id == chat.failed?.id {
                            HStack {
                                Text(l.t(GatewayRefusal(code: chat.error ?? "model_unavailable").messageKey))
                                    .font(.inter(13))
                                    .foregroundStyle(Brand.danger)
                                Button(l.t("shopChat.retry")) { chat.retry() }
                                    .font(.inter(13, .semibold))
                                    .buttonStyle(.tap)
                            }
                        }
                    }
                    if !chat.busy {
                        let brief = ProductBrief(product)
                        let offer = chat.offer(starters: brief.suggestedQuestions.map { l.t($0) })
                        ChatSuggestionsRow(questions: offer.questions, label: l.t(offer.followUps ? "shopChat.followUps" : "assistant.suggestions")) { question in
                            if chat.send(question) { draft = "" }
                        }
                    }
                    ChatComposer(chat: chat, draft: $draft, placeholder: l.t("assistant.placeholder"), label: l.t("assistant.inputLabel"), focused: $typing) { text in
                        if chat.send(text) { draft = "" }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .onAppear { if chat == nil { chat = app.productChat(product) } }
        }
    }
}

/// The help page's box: one question, one answer, from the help page's own
/// answers and never from the shopper's account — the web's help assistant.
struct HelpAskBox: View {
    @State private var chat: ChatModel?
    @State private var draft = ""
    @FocusState private var typing: Bool
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if app.assistantOn {
            VStack(alignment: .leading, spacing: 10) {
                Label(l.t("help.askTitle"), systemImage: "sparkles")
                    .font(.inter(17, .bold))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                Text(l.t("help.askNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                if let chat {
                    ChatComposer(chat: chat, draft: $draft, placeholder: l.t("help.askLabel"), label: l.t("help.askLabel"), focused: $typing) { text in
                        if chat.send(text) { draft = "" }
                    }
                    if let answer = chat.messages.last(where: { !$0.fromShopper }) {
                        if !answer.text.isEmpty {
                            ChatAnswerView(message: answer, note: "help.askAnswerNote")
                                .padding(12)
                                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.tint.opacity(0.5)))
                        } else if answer.state == "streaming" {
                            TypingDots()
                        } else if answer.state == "failed" {
                            Text(l.t(GatewayRefusal(code: chat.error ?? "model_unavailable").messageKey)).font(.inter(13)).foregroundStyle(Brand.danger)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
            .onAppear { if chat == nil { chat = app.helpChat() } }
        }
    }
}
