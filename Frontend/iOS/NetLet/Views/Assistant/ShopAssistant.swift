import SwiftUI

/// The button in the end corner of every shopping page that opens a
/// conversation with the shop — the web's `ShopAssistant`. Glass round a
/// navy mark and "Need help?" beside it, drawn only while the gateway is set
/// up and the assistant is switched on; a dot says an answer finished while
/// it was closed.
struct ShopAssistantButton: View {
    /// The product on screen, so the conversation starts about it.
    var product: Product?
    /// Folded to its mark while the tab bar is away, on the owner's word:
    /// "Need help?" goes out toward the screen's end edge — the right in
    /// English, the left in Arabic — and comes back on a scroll up.
    var folded = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if app.assistantOn && !app.chatOpen {
            Button {
                app.openChat(about: product)
            } label: {
                // "Need help?" beside the mark, on the owner's word — the
                // web's button at every width, glass round a navy mark.
                HStack(spacing: 0) {
                    AssistantMark(size: 40)
                        .overlay(alignment: .topTrailing) {
                            if app.chatUnread { PixelDot().offset(x: 2, y: -2) }
                        }
                    // The words' own box narrows as they leave and clips them,
                    // so they slide out under the pill's end rather than past it.
                    HStack(spacing: 0) {
                        if !folded {
                            Text(l.t("shopChat.needHelp"))
                                .font(.inter(15, .bold))
                                .foregroundStyle(Brand.navy)
                                .lineLimit(1)
                                .fixedSize()
                                .padding(.leading, 10)
                                .transition(.move(edge: .trailing).combined(with: .opacity))
                        }
                    }
                    .clipped()
                }
                .padding(5)
                .padding(.trailing, folded ? 0 : 11)
                .background(GlassSurface(top: 0.7, foot: 0.7).clipShape(Capsule()))
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.8), lineWidth: 1))
                .shadow(color: Brand.navy.opacity(0.22), radius: 12, x: 0, y: 6)
                .contentShape(Capsule())
            }
            .buttonStyle(.action)
            .accessibilityLabel(l.t("shopChat.needHelpName") + (app.chatUnread ? ", " + l.t("shopChat.unread") : ""))
            .transition(.scale(scale: 0.8).combined(with: .opacity))
        }
    }
}

/// The conversation, as a sheet rising over the page — the web's phone
/// `ShopChatPanel`: a welcome and starters fitted to the page, the answers
/// with NetLet's own shelves, the questions to ask next in one row above the
/// box, and the box. It keeps the conversation while the app runs; New chat
/// empties it.
struct ShopChatSheet: View {
    @State private var draft = ""
    @FocusState private var typing: Bool
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var chat: ChatModel { app.shopChat }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.5)
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if let product = chat.product { productChip(product) }
                        if chat.messages.isEmpty { welcome }
                        ForEach(chat.messages) { message in
                            row(message).id(message.id)
                        }
                        Color.clear.frame(height: 1).id("foot")
                    }
                    .padding(16)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: chat.last?.text) { proxy.scrollTo("foot", anchor: .bottom) }
                .onChange(of: chat.messages.count) { withAnimation { proxy.scrollTo("foot", anchor: .bottom) } }
                .onAppear { proxy.scrollTo("foot", anchor: .bottom) }
            }
            VStack(alignment: .leading, spacing: 10) {
                if !chat.busy {
                    let offer = chat.offer(starters: starters)
                    ChatSuggestionsRow(questions: offer.questions, label: l.t(offer.followUps ? "shopChat.followUps" : "shopChat.suggestions")) { question in
                        send(question)
                    }
                }
                ChatComposer(chat: chat, draft: $draft, placeholder: l.t("shopChat.placeholder"), label: l.t("shopChat.inputLabel"), focused: $typing) { text in
                    send(text)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 10)
        }
        .background(GlassSurface(top: 0.7, foot: 0.7).ignoresSafeArea())
        .environment(\.layoutDirection, l.layoutDirection)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear { app.chatUnread = false }
    }

    private var header: some View {
        HStack(spacing: 10) {
            AssistantMark(size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t("shopChat.title")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                Text(l.t("shopChat.note")).font(.inter(12)).foregroundStyle(Color(red: 43 / 255, green: 58 / 255, blue: 85 / 255)).lineLimit(2)
            }
            Spacer(minLength: 8)
            if !chat.messages.isEmpty {
                IconButton(symbol: "arrow.counterclockwise", label: l.t("shopChat.newChat")) {
                    chat.reset()
                    draft = ""
                }
            }
            IconButton(symbol: "xmark", label: l.t("shopChat.close")) { app.chatOpen = false }
        }
        .padding(.horizontal, 16)
        .padding(.top, 18)
        .padding(.bottom, 10)
    }

    private var welcome: some View {
        VStack(spacing: 10) {
            AssistantMark(size: 56)
            Text(l.t("shopChat.welcome")).font(.inter(18, .bold)).foregroundStyle(Brand.navy)
            Text(l.t("shopChat.greeting"))
                .font(.inter(14))
                .foregroundStyle(Brand.body)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    private func productChip(_ product: ProductBrief) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "shippingbox").foregroundStyle(Brand.muted)
            Text(l.t("shopChat.aboutProduct")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            Text(product.title).font(.inter(13, .semibold)).foregroundStyle(Brand.ink).lineLimit(1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Capsule().fill(Color.white.opacity(0.9)))
    }

    @ViewBuilder
    private func row(_ message: ChatModel.Message) -> some View {
        if message.fromShopper {
            HStack {
                Spacer(minLength: 40)
                Text(message.text)
                    .font(.inter(15))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Brand.navy))
                    .accessibilityLabel(l.t("shopChat.you") + " " + message.text)
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else if !message.text.isEmpty || message.state == "streaming" || message.id == chat.failed?.id {
            HStack(alignment: .top, spacing: 8) {
                AssistantMark(size: 26)
                VStack(alignment: .leading, spacing: 8) {
                    if !message.text.isEmpty {
                        ChatAnswerView(message: message, note: "shopChat.generated") { app.chatOpen = false }
                    } else if message.state == "streaming" {
                        TypingDots().padding(.vertical, 6)
                    }
                    if message.id == chat.failed?.id {
                        Text(l.t(GatewayRefusal(code: chat.error ?? "model_unavailable").messageKey))
                            .font(.inter(13))
                            .foregroundStyle(Brand.danger)
                        Button {
                            chat.retry()
                        } label: {
                            Label(l.t("shopChat.retry"), systemImage: "arrow.counterclockwise")
                                .font(.inter(13, .semibold))
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.92)))
                .accessibilityElement(children: .contain)
                .accessibilityLabel(l.t("shopChat.them"))
            }
        }
    }

    /// Fitted to the page: a product, a department, or anywhere.
    private var starters: [String] {
        if chat.product != nil {
            return ["shopChat.askProduct", "shopChat.askUse", "shopChat.askCompare", "shopChat.askDelivery"].map { l.t($0) }
        }
        return ["shopChat.askFind", "shopChat.askDelivery", "shopChat.askReturns", "shopChat.askPay"].map { l.t($0) }
    }

    private func send(_ text: String) {
        guard !chat.busy else { return }
        if chat.send(text) { draft = "" }
    }
}
