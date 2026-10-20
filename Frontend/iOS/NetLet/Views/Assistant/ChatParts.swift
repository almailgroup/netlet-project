import SwiftUI
import UIKit

/// The assistant's mark: a navy disc with sparkles, the web's `Mark`.
struct AssistantMark: View {
    var size: CGFloat = 40

    var body: some View {
        Image(systemName: "sparkles")
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Circle().fill(Brand.navy))
            .accessibilityHidden(true)
    }
}

/// One answer, the web's `ChatAnswer`: its words as paragraphs and lists,
/// the searches it suggests as NetLet's own shelves, a line saying it came
/// from a model, and Copy.
struct ChatAnswerView: View {
    let message: ChatModel.Message
    var note = "shopChat.generated"
    /// Following anything out of an answer; the shop chat puts itself away.
    var onNavigate: (() -> Void)?
    @State private var copied = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let streaming = message.state == "streaming"
        let pieces = ChatText.pieces(message.text, streaming: streaming)
        let searches = pieces.compactMap { piece -> String? in
            if case .search(let term) = piece { return term }
            return nil
        }
        let words = pieces.compactMap { piece -> String? in
            if case .text(let text) = piece { return text }
            return nil
        }.joined(separator: "\n\n")
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(DescriptionBlock.parse(words).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let text):
                    Text(text).font(.inter(15)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
                case .list(let items):
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("•").foregroundStyle(Brand.muted)
                                Text(item).font(.inter(15)).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
            }
            if streaming {
                TypingDots()
            }
            if !searches.isEmpty && !streaming {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(searches, id: \.self) { term in ChatSearchShelf(term: term, onNavigate: onNavigate) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(l.t("assistant.searchesLabel"))
            }
            if message.state == "blocked" {
                Text(l.t("assistant.blocked")).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            if message.state == "stopped" {
                Text(l.t("assistant.stopped")).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            if !streaming {
                HStack {
                    Text(l.t(note)).font(.inter(12)).foregroundStyle(Brand.muted)
                    Spacer()
                    if !words.isEmpty {
                        Button {
                            UIPasteboard.general.string = words
                            Haptics.succeeded()
                            copied = true
                            Task {
                                try? await Task.sleep(for: .seconds(1.6))
                                copied = false
                            }
                        } label: {
                            Label(l.t(copied ? "shopChat.copied" : "shopChat.copy"), systemImage: copied ? "checkmark" : "doc.on.doc")
                                .labelStyle(.iconOnly)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Brand.navy)
                                .frame(width: 36, height: 36)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.tap)
                        .accessibilityLabel(l.t(copied ? "shopChat.copied" : "shopChat.copy"))
                    }
                }
            }
        }
        .environment(\.layoutDirection, l.layoutDirection)
    }
}

/// Three dots while an answer is on its way; still for reduced motion.
struct TypingDots: View {
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { dot in
                Circle()
                    .fill(Brand.muted)
                    .frame(width: 7, height: 7)
                    .opacity(still ? 0.6 : on ? 1 : 0.3)
                    .animation(still ? nil : .easeInOut(duration: 0.5).repeatForever().delay(Double(dot) * 0.16), value: on)
            }
        }
        .onAppear { on = true }
        .accessibilityHidden(true)
    }
}

/// A search the answer suggested, as NetLet's own shelf: its first four
/// products at the catalogue's own prices, and See all. A model naming a
/// product could name one NetLet does not sell; the search shows what is on
/// the shelf at what it costs.
struct ChatSearchShelf: View {
    let term: String
    var onNavigate: (() -> Void)?
    @State private var products: [Product]?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button {
                    follow(.search(query: term))
                } label: {
                    Label(term, systemImage: "magnifyingglass")
                        .font(.inter(14, .semibold))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(1)
                }
                .buttonStyle(.tap)
                Spacer()
                if products?.isEmpty == false {
                    Button(l.t("shopChat.seeAll")) { follow(.search(query: term)) }
                        .font(.inter(13, .semibold))
                        .foregroundStyle(Brand.accentInk)
                        .buttonStyle(.tap)
                }
            }
            if let products {
                if !products.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(products, id: \.id) { product in ShelfCard(product: product, follow: follow) }
                        }
                    }
                }
            } else {
                HStack(spacing: 8) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.photo).frame(width: 120, height: 150)
                    }
                }
                .accessibilityHidden(true)
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.9)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .task(id: term) {
            products = (try? await app.services.api.call(API.search, .init(q: term, locale: l.current.rawValue, limit: 4)))?.products ?? []
        }
    }

    private func follow(_ route: Route) {
        onNavigate?()
        app.open(route)
    }
}

/// One product on an answer's shelf, with the card's plain Add on its photo
/// when there is nothing to choose.
private struct ShelfCard: View {
    let product: Product
    let follow: (Route) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                follow(.product(handle: product.handle))
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Color.clear
                        .frame(width: 120, height: 120)
                        .overlay { RemoteImage(reference: product.images.first?.url) }
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Text(product.title).font(.inter(12, .semibold)).foregroundStyle(Brand.ink).lineLimit(2).frame(width: 120, alignment: .leading)
                    Text(product.priceRange.min.formatted(l.current)).font(.inter(12, .bold)).foregroundStyle(Brand.navy)
                }
            }
            .buttonStyle(.tap)
        }
        .overlay(alignment: .topTrailing) { addDisc }
    }

    @ViewBuilder
    private var addDisc: some View {
        if product.variants.count == 1, let variant = product.variants.first, variant.availableForSale {
            let count = app.cart.quantity(of: variant.id)
            Button {
                Task {
                    if await app.cart.add(variantId: variant.id) {
                        announce(l.t("cart.added", ["name": product.title]))
                    } else {
                        app.toast(l.t("cart.addFailed"))
                    }
                }
            } label: {
                Group {
                    if count > 0 {
                        Text(count > 99 ? "99+" : "\(count)").font(.inter(12, .bold)).foregroundStyle(.white)
                    } else {
                        Image(systemName: "plus").font(.system(size: 13, weight: .bold)).foregroundStyle(Brand.navy)
                    }
                }
                .frame(width: 30, height: 30)
                .background(Circle().fill(count > 0 ? Brand.navy : Color.white))
                .overlay(Circle().strokeBorder(Brand.line, lineWidth: count > 0 ? 0 : 1))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.action)
            .accessibilityLabel(l.t("card.addName", ["name": product.title]) + (count > 0 ? " · " + l.t("card.inCart", ["count": "\(count)"]) : ""))
        }
    }
}

/// The questions to ask, one row above the box in both chats — wrapped, so
/// none is ever cut at an edge (`ChatSuggestions`).
struct ChatSuggestionsRow: View {
    let questions: [String]
    let label: String
    let onAsk: (String) -> Void

    var body: some View {
        if !questions.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(label).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
                FlowLayout(spacing: 6) {
                    ForEach(questions, id: \.self) { question in
                        Button {
                            onAsk(question)
                        } label: {
                            Text(question)
                                .font(.inter(13, .medium))
                                .foregroundStyle(Brand.navy)
                                .multilineTextAlignment(.leading)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(Color.white.opacity(0.92)))
                                .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.15), lineWidth: 1))
                        }
                        .buttonStyle(.tap)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)
        }
    }
}

/// The box a question is typed into — or spoken into, where speech is on —
/// with Send, or Stop while an answer comes. A draft carrying contact details
/// or too long is said above it and not sent.
struct ChatComposer: View {
    let chat: ChatModel
    @Binding var draft: String
    let placeholder: String
    let label: String
    var focused: FocusState<Bool>.Binding
    let send: (String) -> Void
    @State private var dictation: Dictation
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    init(chat: ChatModel, draft: Binding<String>, placeholder: String, label: String, focused: FocusState<Bool>.Binding, send: @escaping (String) -> Void) {
        self.chat = chat
        _draft = draft
        self.placeholder = placeholder
        self.label = label
        self.focused = focused
        self.send = send
        // Made here rather than as the property's initial value, which Swift 5
        // mode evaluates outside the main actor this object belongs to.
        _dictation = State(initialValue: Dictation())
    }

    var body: some View {
        let rules = ReferenceData.shared.rules.aiRules
        let problem = ChatModel.draftProblem(draft)
        VStack(alignment: .leading, spacing: 6) {
            if let line = noteLine(problem) {
                Text(line)
                    .font(.inter(12))
                    .foregroundStyle(problem == "contact_details" || problem == "too_large" || chat.error != nil ? Brand.danger : Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(dictation.listening ? l.t("search.voiceListening") : placeholder, text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.inter(16))
                    .focused(focused)
                    .submitLabel(.send)
                    .onSubmit { send(draft) }
                    .onChange(of: draft) {
                        if chat.error != nil && chat.failed == nil { chat.dismissError() }
                    }
                    .padding(.vertical, 10)
                    .accessibilityLabel(label)
                if draft.count >= rules.maxChatText - 200 {
                    Text("\(draft.count)/\(rules.maxChatText)").font(.inter(11)).foregroundStyle(Brand.muted).environment(\.layoutDirection, .leftToRight)
                        .padding(.bottom, 12)
                }
                if app.features.isOn("voiceSearch") && Dictation.isAvailable && !chat.busy {
                    Button {
                        if dictation.listening {
                            dictation.stop()
                        } else {
                            let before = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                            dictation.start(language: l.current) { heard in draft = before.isEmpty ? heard : before + " " + heard }
                        }
                    } label: {
                        Image(systemName: dictation.listening ? "mic.fill" : "mic")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(dictation.listening ? Color.white : Brand.navy)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(dictation.listening ? Brand.navy : Color.clear))
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t(dictation.listening ? "shopChat.stopListening" : "shopChat.speak"))
                    .padding(.bottom, 2)
                }
                if chat.busy {
                    Button(action: chat.stop) {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(Brand.navy))
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("assistant.stop"))
                    .padding(.bottom, 2)
                } else {
                    Button {
                        send(draft)
                    } label: {
                        Image(systemName: "paperplane.fill")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 40, height: 40)
                            .background(Circle().fill(problem == nil ? Brand.navy : Brand.navy.opacity(0.35)))
                            .flipsForRightToLeftLayoutDirection(true)
                    }
                    .buttonStyle(.action)
                    .disabled(problem != nil)
                    .accessibilityLabel(l.t("shopChat.send"))
                    .padding(.bottom, 2)
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, 4)
            .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
        }
        .onDisappear { dictation.cancel() }
    }

    private func noteLine(_ problem: String?) -> String? {
        if problem == "contact_details" { return l.t("ai.error.contact") }
        if problem == "too_large" { return l.t("ai.error.tooLarge") }
        if let error = chat.error, chat.failed == nil { return l.t(GatewayRefusal(code: error).messageKey) }
        if dictation.listening { return l.t("search.voiceListening") + " " + l.t("ios.voice.privacy") }
        if let trouble = dictation.problem { return l.t(Dictation.messageKey(trouble)) }
        return nil
    }
}
