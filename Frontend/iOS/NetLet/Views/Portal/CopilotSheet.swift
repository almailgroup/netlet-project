import SwiftUI

/// The portal's co-pilot — the web's `CopilotPanel`, as a sheet from the bar
/// of every portal page (`Shared/ai/copilot.ts` is the rule).
///
/// **The brief first, and it needs no model**: what has run out, what runs out
/// this week, what waits and how sales are going, each with the one act that
/// answers it. Then a question box while NetLet AI is on, with a few questions
/// to start from; an answer says it is the model's and may carry up to two
/// proposals.
///
/// **A proposal is done only on Confirm, by the app.** Opening a page is a
/// press; setting a reorder point asks first, in a sentence saying what will
/// change, and then calls the procedure the stock page calls — which asks its
/// own permission again. The conversation lives as long as the sheet.
struct CopilotSheet: View {
    private struct Turn: Identifiable {
        let id = UUID()
        let role: String
        let text: String
        var actions: [CopilotAction] = []
        var failed = false
    }

    @State private var brief: CopilotBrief?
    @State private var briefFailed: APIError?
    @State private var turns: [Turn] = []
    @State private var draft = ""
    @State private var problem: String?
    @State private var asking = false
    @FocusState private var boxFocused: Bool
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollViewReader { reader in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        Text(l.t("copilot.intro")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                        briefSection
                        if brief?.ask == true {
                            conversation
                        } else if brief != nil {
                            PortalNotice(text: l.t("copilot.noModel"))
                        }
                        Color.clear.frame(height: 1).id("end")
                    }
                    .padding(16)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: turns.count) {
                    withAnimation(.easeOut(duration: 0.25)) { reader.scrollTo("end", anchor: .bottom) }
                }
                .onChange(of: asking) {
                    withAnimation(.easeOut(duration: 0.25)) { reader.scrollTo("end", anchor: .bottom) }
                }
            }
            .background(PortalLook.ground.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) {
                if brief?.ask == true { inputBar }
            }
            .navigationTitle(l.t("copilot.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { BarButton(l.t("common.close")) { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    if !turns.isEmpty {
                        BarButton(l.t("copilot.newChat")) {
                            turns = []
                            problem = nil
                        }
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task { await loadBrief() }
    }

    // MARK: The brief

    @ViewBuilder
    private var briefSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text(l.t("copilot.briefTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            } icon: {
                Image(systemName: "sparkles").foregroundStyle(PortalLook.series[0])
            }
            .accessibilityAddTraits(.isHeader)
            if let brief {
                ForEach(Array(brief.insights.enumerated()), id: \.offset) { _, insight in
                    insightRow(insight)
                }
            } else if let briefFailed {
                ErrorStateView(error: briefFailed) { await loadBrief() }
            } else {
                ForEach(0 ..< 3, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(PortalLook.shimmer).frame(height: 62)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(l.t("admin.loading"))
            }
        }
    }

    private func words(_ insight: CopilotInsight) -> String {
        var params: [String: String] = [:]
        for (name, value) in insight.params {
            params[name] = name == "amount" ? (Money(amount: value.text)?.formatted(l.current) ?? value.text) : value.text
        }
        for (name, key) in insight.words ?? [:] { params[name] = l.t(key) }
        return l.t(insight.key, params)
    }

    private func insightRow(_ insight: CopilotInsight) -> some View {
        let tone = PortalLook.insight(insight.tone)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: tone.symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tone.ink)
                    .frame(width: 30, height: 30)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(tone.plate))
                    .accessibilityHidden(true)
                Text(words(insight)).font(.inter(14)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true).padding(.top, 5)
                Spacer(minLength: 4)
                if let count = insight.count {
                    Text("\(count)")
                        .font(.inter(12, .bold))
                        .foregroundStyle(Color.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(Brand.navy))
                        .environment(\.layoutDirection, .leftToRight)
                        .padding(.top, 5)
                }
            }
            .accessibilityElement(children: .combine)
            if let action = insight.action {
                ProposalButton(action: action, pageName: pageName, leave: { dismiss() })
                    .padding(.leading, 40)
            }
        }
        .padding(12)
        .portalSurface(cornerRadius: 14)
    }

    /// A portal page's name, from the menu, for "Open …".
    private func pageName(_ href: String) -> String {
        if href == "/admin" { return l.t("admin.overview") }
        let link = PortalRules.shared.menu.flatMap(\.links).first { $0.href == href }
        return link.map { l.t($0.label) } ?? href
    }

    // MARK: The conversation

    private var suggestions: [String] {
        ["copilot.suggest.waiting", "copilot.suggest.restock", "copilot.suggest.week", "copilot.suggest.forecast"]
            + ((brief?.inquiries ?? 0) > 0 ? ["copilot.suggest.inquiries"] : [])
    }

    @ViewBuilder
    private var conversation: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("copilot.askTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            ForEach(turns) { turn in
                turnView(turn)
            }
            if asking {
                HStack(spacing: 8) {
                    ProgressView().tint(PortalLook.series[0])
                    Text(l.t("copilot.thinking")).font(.inter(13)).foregroundStyle(Brand.muted)
                }
                .padding(.vertical, 4)
            }
            if turns.isEmpty, !asking {
                FlowLayout(spacing: 8) {
                    ForEach(suggestions, id: \.self) { key in
                        Button {
                            Task { await send(l.t(key)) }
                        } label: {
                            Text(l.t(key))
                                .font(.inter(13, .semibold))
                                .foregroundStyle(Brand.navy)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(Capsule().fill(Color.white))
                                .overlay(Capsule().strokeBorder(PortalLook.hairline, lineWidth: 1))
                        }
                        .buttonStyle(.tap)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func turnView(_ turn: Turn) -> some View {
        if turn.role == "admin" {
            HStack {
                Spacer(minLength: 40)
                Text(turn.text)
                    .font(.inter(14))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.navy))
                    .accessibilityLabel("\(l.t("copilot.you")): \(turn.text)")
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text(turn.text)
                    .font(.inter(14))
                    .foregroundStyle(turn.failed ? Brand.danger : Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                ForEach(Array(turn.actions.enumerated()), id: \.offset) { _, action in
                    ProposalButton(action: action, pageName: pageName, leave: { dismiss() })
                }
                if !turn.failed {
                    Label(l.t("copilot.aiNote"), systemImage: "sparkles").font(.inter(11)).foregroundStyle(Brand.muted)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .portalSurface(cornerRadius: 16)
            .transition(.opacity)
        }
    }

    private var inputBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let problem {
                Text(l.t(problem)).font(.inter(12, .semibold)).foregroundStyle(Brand.danger)
            }
            HStack(alignment: .bottom, spacing: 8) {
                TextField(l.t("copilot.placeholder"), text: $draft, axis: .vertical)
                    .font(.inter(15))
                    .lineLimit(1 ... 4)
                    .focused($boxFocused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(boxFocused ? Brand.navy : PortalLook.hairline, lineWidth: boxFocused ? 1.5 : 1))
                    .onChange(of: draft) { if problem != nil { problem = nil } }
                    .submitLabel(.send)
                    .onSubmit { Task { await send(draft) } }
                Button {
                    Task { await send(draft) }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.white)
                        .frame(width: 42, height: 42)
                        .background(Circle().fill(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || asking ? Brand.chevron : Brand.navy))
                }
                .buttonStyle(.tap)
                .disabled(asking)
                .accessibilityLabel(l.t("copilot.send"))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.regularMaterial)
    }

    // MARK: Asking

    private func loadBrief() async {
        do {
            brief = try await app.services.api.call(API.copilotBrief)
            briefFailed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, brief == nil { briefFailed = failure }
        }
    }

    private func send(_ text: String) async {
        guard !asking else { return }
        if let refused = DashboardRules.questionProblem(text) {
            problem = refused
            boxFocused = true
            return
        }
        problem = nil
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            turns.append(Turn(role: "admin", text: question))
        }
        draft = ""
        asking = true
        defer { asking = false }
        let sent = turns.filter { !$0.failed }.suffix(DashboardRules.maxTurns).map { API.CopilotQuestion.Turn(role: $0.role, text: $0.text) }
        let reply: Turn
        do {
            let answer = try await app.services.api.call(API.copilotAsk, .init(turns: Array(sent), locale: l.current.rawValue))
            switch answer.kind {
            case "answer":
                reply = Turn(role: "copilot", text: answer.text ?? "", actions: answer.actions ?? [])
            case "tooMany":
                reply = Turn(role: "copilot", text: l.t("copilot.tooMany"), failed: true)
            case "refused":
                reply = Turn(role: "copilot", text: l.t(answer.reason ?? "copilot.unavailable"), failed: true)
            default:
                reply = Turn(role: "copilot", text: l.t("copilot.unavailable"), failed: true)
            }
        } catch {
            reply = Turn(role: "copilot", text: l.t("copilot.unavailable"), failed: true)
        }
        withAnimation(.easeOut(duration: 0.25)) { turns.append(reply) }
    }
}

/// One proposal: a page to open, or a reorder point set only after a second press.
private struct ProposalButton: View {
    let action: CopilotAction
    let pageName: (String) -> String
    let leave: () -> Void
    @State private var asking = false
    @State private var done = false
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if action.kind == "open", let page = action.page {
            Button {
                leave()
                app.open(.portal(page))
            } label: {
                HStack(spacing: 4) {
                    Text(l.t("copilot.actionOpen", ["page": pageName(page)])).multilineTextAlignment(.leading)
                    Image(systemName: "arrow.up.forward").font(.system(size: 10, weight: .bold)).flipsForRightToLeftLayoutDirection(true)
                }
            }
            .buttonStyle(PortalSmallButtonStyle())
            .disabled(!PortalPage.draws(page))
        } else if action.kind == "reorder", let variantId = action.variantId, let level = action.level {
            let params = ["product": action.product ?? "", "level": "\(level)"]
            if done {
                Label(l.t("copilot.reorderDone", params), systemImage: "checkmark.circle.fill")
                    .font(.inter(13, .semibold))
                    .foregroundStyle(PortalLook.tone(.healthy).ink)
            } else if !asking {
                Button(l.t("copilot.actionReorder", params)) {
                    withAnimation(.easeOut(duration: 0.2)) { asking = true }
                }
                .buttonStyle(PortalSmallButtonStyle())
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text(l.t("copilot.confirmReorder", params)).font(.inter(13)).foregroundStyle(Brand.navy).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Button(l.t("copilot.confirm")) {
                            Task { await confirm(variantId: variantId, level: level) }
                        }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                        .disabled(busy)
                        Button(l.t("common.cancel")) {
                            withAnimation(.easeOut(duration: 0.2)) { asking = false }
                        }
                        .buttonStyle(PortalSmallButtonStyle())
                    }
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(PortalLook.indigoWash))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PortalLook.series[0].opacity(0.25), lineWidth: 1))
            }
        }
    }

    private func confirm(variantId: Int, level: Int) async {
        busy = true
        defer { busy = false }
        if await app.attempt(fallback: "copilot.unavailable", {
            _ = try await app.services.api.call(API.setReorderPoint, .init(variantId: variantId, lowStockAt: OrNull(level)))
        }) {
            withAnimation(.easeOut(duration: 0.2)) { done = true }
        }
    }
}
