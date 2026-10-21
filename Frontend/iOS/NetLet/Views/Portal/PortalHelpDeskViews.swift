import PhotosUI
import SwiftUI

// MARK: - Support inbox

/// NetLet's help desk — the web's `/admin/support`: every conversation a
/// shopper opened, the ones waiting on NetLet first. A row opens the
/// conversation as its own page, where the web shows it beside the list.
struct PortalSupportView: View {
    @State private var filter = "open"
    @State private var page = 1
    @State private var inbox: StaffInboxPage?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("support.inboxTitle"), intro: l.t("support.inboxNote"), refresh: { await load() }) {
            PortalSegmented(label: l.t("support.inboxTitle"), value: $filter, options: SupportRules.filters.map {
                ($0, l.t($0 == "all" ? "support.filterAll" : SupportView.statusLabel($0)))
            })
            if let inbox {
                if inbox.rows.isEmpty {
                    PortalEmpty(text: l.t("support.inboxEmpty"))
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(inbox.rows.enumerated()), id: \.element.id) { index, row in
                            if index > 0 { Divider() }
                            NavigationLink(value: Route.portal("/admin/support/\(row.id)")) { conversationRow(row) }
                                .buttonStyle(PressFillStyle(cornerRadius: 0))
                        }
                    }
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    PortalPager(page: inbox.page, pageSize: inbox.pageSize, total: inbox.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task(id: filter) {
            page = 1
            await load()
        }
    }

    private func conversationRow(_ row: StaffInboxRow) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(l.t(SupportView.topicLabel(row.topic)) + (row.orderReference.map { " · \(latin($0))" } ?? ""))
                    .font(.inter(15, .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if row.unread {
                    StatusPill(label: l.t("support.unreadStaff"), tone: .portal("navy"))
                } else {
                    Text(l.t(SupportView.statusLabel(row.status))).font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            Text("\(latin(row.shopperEmail ?? "—")) · \(OrderWording.date(row.lastMessageAt, language: l.current))")
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(14)
        .contentShape(Rectangle())
    }

    private func load() async {
        do {
            inbox = try await app.services.api.call(API.staffInbox, .init(status: filter == "all" ? nil : filter, page: page))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, inbox == nil { failed = failure }
        }
    }
}

/// One conversation as NetLet reads it: the shopper's words, the automatic
/// first answer, NetLet's replies, and the reply box — with a model's draft to
/// start from where one can be had. A draft is only ever words in the box: it
/// is sent by a person pressing Send.
struct PortalSupportThreadView: View {
    let conversationId: Int
    @State private var thread: StaffSupportThread?
    @State private var failed: APIError?
    @State private var reply = ""
    @State private var drafted = false
    @State private var canDraft = false
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var limit: Int { ReferenceData.shared.rules.accountRules.maxSupportMessage }

    var body: some View {
        PortalScreen(title: thread.map { l.t(SupportView.topicLabel($0.topic)) } ?? l.t("support.inboxTitle"), refresh: { await load() }) {
            if let thread {
                PortalCard {
                    HStack(alignment: .top, spacing: 8) {
                        VStack(alignment: .leading, spacing: 3) {
                            if let reference = thread.orderReference {
                                Text(latin(reference)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                            }
                            Text([thread.shopperName, thread.shopperEmail.map(latin)].compactMap { $0 }.joined(separator: " · "))
                                .font(.inter(13))
                                .foregroundStyle(Brand.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        StatusPill(label: l.t(SupportView.statusLabel(thread.status)),
                                   tone: .portal(thread.status == "resolved" ? "good" : thread.status == "open" ? "warning" : "neutral"))
                    }
                }
                VStack(spacing: 10) {
                    ForEach(thread.messages) { message in
                        Bubble(
                            mine: message.author == "staff",
                            author: l.t(message.author == "automatic" ? "support.automaticSent" : message.author == "staff" ? "support.netlet" : "support.shopper"),
                            text: message.answer.map { parts in parts.map { l.t($0.key, $0.params) }.joined(separator: "\n\n") } ?? message.body ?? "",
                            stamp: OrderWording.dateTime(message.createdAt, language: l.current)
                        )
                    }
                }
                replyBox(thread)
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task {
            await load()
            canDraft = (try? await app.services.api.call(API.supportDraftAvailable)) ?? false
        }
    }

    private func replyBox(_ thread: StaffSupportThread) -> some View {
        let problem = SupportRules.problem(reply, limit: limit)
        return PortalCard {
            LabeledField(label: l.t("support.replyAsNetlet"), text: Binding(get: { reply }, set: { text in
                reply = text
                if text.isEmpty { drafted = false }
            }), axis: .vertical)
            if reply.count > limit { FieldProblem(key: "support.tooLong") }
            if drafted {
                Label(l.t("support.draftNote"), systemImage: "sparkles")
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            FlowLayout(spacing: 8) {
                Button { Task { await send() } } label: {
                    if busy { ProgressView().tint(.white) } else { Label(l.t("support.send"), systemImage: "paperplane.fill") }
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(problem != nil || busy)
                if canDraft && reply.isEmpty {
                    Button { Task { await draft() } } label: {
                        Label(l.t(busy ? "support.drafting" : "support.draft"), systemImage: "sparkles")
                    }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(busy)
                }
                if thread.status != "resolved" {
                    Button { Task { await resolve() } } label: { Label(l.t("support.resolve"), systemImage: "checkmark.circle") }
                        .buttonStyle(PortalSmallButtonStyle())
                        .disabled(busy)
                }
            }
        }
    }

    private func load() async {
        do {
            thread = try await app.services.api.call(API.staffThread, .init(id: conversationId))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, thread == nil { failed = failure }
        }
    }

    private func send() async {
        busy = true
        defer { busy = false }
        let body = reply
        if await app.attempt(done: "support.sent", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.staffReply, .init(id: conversationId, body: body))
        }) {
            reply = ""
            drafted = false
            await load()
        }
    }

    private func draft() async {
        busy = true
        defer { busy = false }
        do {
            let answer = try await app.services.api.call(API.supportDraft, .init(id: conversationId))
            if answer.kind == "draft", let text = answer.text {
                reply = text
                drafted = true
                Haptics.succeeded()
            } else {
                app.toast(l.t(answer.kind == "nothingToAnswer" ? "support.nothingToAnswer" : "support.draftUnavailable"))
            }
        } catch {
            let failure = APIError.from(error)
            if failure == .cancelled { return }
            Haptics.refused()
            let key = failure.messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(key == "error.serverProblem" ? "support.draftUnavailable" : key))
        }
    }

    private func resolve() async {
        busy = true
        defer { busy = false }
        if await app.attempt(done: "support.resolvedToast", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.staffResolve, .init(id: conversationId))
        }) {
            await load()
        }
    }
}

// MARK: - Guides

/// NetLet's guides — the web's `/admin/guides`: every guide, draft or
/// published, newest change first, and the way to start one.
struct PortalGuidesView: View {
    @State private var page = 1
    @State private var list: AdminGuidePage?
    @State private var failed: APIError?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalScreen(title: l.t("guides.adminTitle"), intro: l.t("guides.adminIntro"), refresh: { await load() }) {
            NavigationLink(value: Route.portal("/admin/guides/new")) {
                Label(l.t("guides.new"), systemImage: "plus")
            }
            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
            if let list {
                if list.total == 0 {
                    PortalCard {
                        Text(l.t("guides.adminEmpty")).font(.inter(16, .bold)).foregroundStyle(Brand.navy)
                        Text(l.t("guides.adminEmptyNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                } else {
                    ForEach(list.rows) { guide in
                        NavigationLink(value: Route.portal("/admin/guides/\(guide.id)")) { row(guide) }
                            .buttonStyle(PressFillStyle(cornerRadius: 14))
                    }
                    PortalPager(page: list.page, pageSize: list.pageSize, total: list.total) { next in
                        page = next
                        Task { await load() }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task { await load() }
    }

    private func row(_ guide: AdminGuide) -> some View {
        PortalCard {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "book")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Brand.navy)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Brand.tint))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(GuideRules.title(guide.content, arabic: l.current == .ar) ?? l.t("guides.untitled"))
                        .font(.inter(15, .semibold))
                        .foregroundStyle(Brand.navy)
                        .multilineTextAlignment(.leading)
                    FlowLayout(spacing: 6) {
                        StatusPill(label: l.t(guide.status == "published" ? "guides.published" : "guides.draft"), tone: .portal(guide.status == "published" ? "good" : "neutral"))
                        Text("\(l.t(guide.content.audience == "seller" ? "guides.forSellers" : "guides.forShoppers")) · \(l.t("guides.stepCount", ["count": "\(guide.content.steps.count)"]))")
                            .font(.inter(12))
                            .foregroundStyle(Brand.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "chevron.forward").font(.system(size: 13, weight: .semibold)).foregroundStyle(Brand.chevron).flipsForRightToLeftLayoutDirection(true)
            }
        }
    }

    private func load() async {
        do {
            list = try await app.services.api.call(API.guideList, .init(page: page))
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, list == nil { failed = failure }
        }
    }
}

/// One guide, written in both languages — the web's `GuideEditor`: a model
/// may draft the words and draw a step's picture, and nothing is saved until
/// Save or shown to anybody until Publish, which asks the same rules the
/// server does (`guideProblems`).
struct PortalGuideEditorView: View {
    /// Nil for a new guide.
    let guideId: Int?
    @State private var id: Int?
    @State private var loaded = false
    @State private var failed: APIError?
    @State private var content = GuideContent.empty
    @State private var saved = GuideContent.empty
    /// One key per step, kept beside the steps, so a step's own state (a
    /// picture just drawn) follows it when it moves.
    @State private var keys: [UUID] = [UUID()]
    @State private var status = "draft"
    @State private var slug: String?
    @State private var topic = ""
    @State private var aiAvailable = false
    @State private var drafting = false
    @State private var pendingDraft: GuideContent?
    @State private var deleting = false
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    private var limits: PortalRules.GuideLimits {
        PortalRules.shared.guides ?? .init(titleMax: 140, summaryMax: 400, stepTitleMax: 120, stepBodyMax: 1000, maxSteps: 10, topicMax: 200)
    }

    private var dirty: Bool { content != saved }

    var body: some View {
        PortalScreen(title: GuideRules.title(content, arabic: l.current == .ar) ?? l.t("guides.new")) {
            if loaded {
                FlowLayout(spacing: 8) {
                    StatusPill(label: l.t(status == "published" ? "guides.published" : "guides.draft"), tone: .portal(status == "published" ? "good" : "neutral"))
                    if status == "published", let slug {
                        Button { app.open(.guide(slug: slug)) } label: { Label(l.t("guides.viewOnShop"), systemImage: "arrow.up.forward.square") }
                            .buttonStyle(PortalSmallButtonStyle())
                    }
                }
                if aiAvailable { draftCard }
                aboutCard
                ForEach(Array(keys.enumerated()), id: \.element) { index, key in
                    GuideStepCard(
                        index: index,
                        count: keys.count,
                        step: stepBinding(key),
                        limits: limits,
                        drawable: aiAvailable,
                        move: { by in move(key, by: by) },
                        remove: { remove(key) }
                    )
                }
                if content.steps.count < limits.maxSteps {
                    Button {
                        content.steps.append(.empty)
                        keys.append(UUID())
                    } label: { Label(l.t("guides.addStep"), systemImage: "plus") }
                    .buttonStyle(PortalSmallButtonStyle())
                }
                publishCard
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .task {
            if !loaded { await load() }
            aiAvailable = (try? await app.services.api.call(API.guideAIAvailable)) ?? false
        }
        .confirmationDialog(l.t("guides.replaceTitle"), isPresented: Binding(get: { pendingDraft != nil }, set: { if !$0 { pendingDraft = nil } }), titleVisibility: .visible) {
            Button(l.t("guides.replaceConfirm"), role: .destructive) {
                if let pendingDraft { use(pendingDraft) }
                pendingDraft = nil
            }
            Button(l.t("common.cancel"), role: .cancel) { pendingDraft = nil }
        } message: {
            Text(l.t("guides.replaceBody"))
        }
        .confirmationDialog(l.t("guides.deleteTitle"), isPresented: $deleting, titleVisibility: .visible) {
            Button(l.t("guides.delete"), role: .destructive) { Task { await delete() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t(status == "published" ? "guides.deleteBodyPublished" : "guides.deleteBody"))
        }
    }

    // MARK: Cards

    private var draftCard: some View {
        PortalCard {
            Text(l.t("guides.draftTitle")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("guides.draftNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            LabeledField(label: l.t("guides.topic"), text: capped($topic, limits.topicMax), hint: l.t("guides.topicHint"))
            Button { Task { await draft() } } label: {
                if drafting { Label(l.t("guides.drafting"), systemImage: "hourglass") } else { Label(l.t("guides.draftButton"), systemImage: "sparkles") }
            }
            .buttonStyle(PortalSmallButtonStyle())
            .disabled(topic.trimmingCharacters(in: .whitespaces).isEmpty || drafting)
        }
    }

    private var aboutCard: some View {
        PortalCard {
            Text(l.t("guides.aboutTitle")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("guides.audience")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            PortalSegmented(label: l.t("guides.audience"), value: $content.audience, options: [
                ("shopper", l.t("guides.forShoppers")), ("seller", l.t("guides.forSellers")),
            ])
            LabeledField(label: l.t("guides.titleEn"), text: capped($content.title, limits.titleMax))
                .environment(\.layoutDirection, .leftToRight)
            LabeledField(label: l.t("guides.titleAr"), text: capped($content.titleAr, limits.titleMax))
                .environment(\.layoutDirection, .rightToLeft)
            LabeledField(label: "\(l.t("guides.summaryEn")) (\(l.t("admin.optional")))", text: capped($content.summary, limits.summaryMax), axis: .vertical)
                .environment(\.layoutDirection, .leftToRight)
            LabeledField(label: "\(l.t("guides.summaryAr")) (\(l.t("admin.optional")))", text: capped($content.summaryAr, limits.summaryMax), axis: .vertical)
                .environment(\.layoutDirection, .rightToLeft)
        }
    }

    private var publishCard: some View {
        let problems = GuideRules.problems(content)
        return PortalCard {
            Text(l.t("guides.publishTitle")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t(status == "published" ? "guides.publishedNote" : "guides.publishNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if id == nil {
                PortalNotice(text: l.t("guides.saveFirst"))
            } else if !problems.isEmpty {
                PortalNotice(text: problems.map { "• \(l.t($0))" }.joined(separator: "\n"), tone: .warning)
            } else if status == "draft" {
                PortalNotice(text: l.t("guides.ready"), tone: .success)
            }
            FlowLayout(spacing: 8) {
                if id != nil {
                    Button { deleting = true } label: { Label(l.t("guides.delete"), systemImage: "trash") }
                        .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                        .disabled(busy)
                }
                Button { Task { await save() } } label: {
                    if busy { ProgressView() } else { Label(l.t("guides.save"), systemImage: "square.and.arrow.down") }
                }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(busy || (!dirty && id != nil))
                if id != nil, status == "published" {
                    Button { Task { await setStatus("draft") } } label: { Text(l.t("guides.unpublish")) }
                        .buttonStyle(PortalSmallButtonStyle())
                        .disabled(busy)
                }
                if id != nil, status == "draft" {
                    Button { Task { await publish() } } label: { Label(l.t("guides.publish"), systemImage: "checkmark.circle") }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                        .disabled(busy || !problems.isEmpty)
                }
            }
        }
    }

    // MARK: Steps

    private func stepBinding(_ key: UUID) -> Binding<GuideContent.Step> {
        Binding(
            get: { keys.firstIndex(of: key).flatMap { content.steps.indices.contains($0) ? content.steps[$0] : nil } ?? .empty },
            set: { step in
                if let index = keys.firstIndex(of: key), content.steps.indices.contains(index) { content.steps[index] = step }
            }
        )
    }

    private func move(_ key: UUID, by offset: Int) {
        guard let index = keys.firstIndex(of: key), keys.indices.contains(index + offset) else { return }
        keys.swapAt(index, index + offset)
        content.steps.swapAt(index, index + offset)
    }

    private func remove(_ key: UUID) {
        guard keys.count > 1, let index = keys.firstIndex(of: key) else { return }
        keys.remove(at: index)
        content.steps.remove(at: index)
    }

    private func use(_ next: GuideContent) {
        content = next
        keys = next.steps.map { _ in UUID() }
    }

    private func capped(_ binding: Binding<String>, _ max: Int) -> Binding<String> {
        Binding(get: { binding.wrappedValue }, set: { binding.wrappedValue = String($0.prefix(max)) })
    }

    // MARK: Work

    private func adopt(_ guide: AdminGuide) {
        id = guide.id
        status = guide.status
        slug = guide.slug
        saved = guide.content
        if guide.content.steps.count != keys.count { keys = guide.content.steps.map { _ in UUID() } }
        content = guide.content
    }

    private func load() async {
        guard let guideId else {
            loaded = true
            return
        }
        do {
            adopt(try await app.services.api.call(API.guideGet, .init(id: guideId)))
            loaded = true
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { failed = failure }
        }
    }

    @discardableResult
    private func save() async -> Bool {
        busy = true
        defer { busy = false }
        let request = API.GuideSave(id: OrNull(id), guide: content)
        var answer: AdminGuide?
        let ok = await app.attempt(done: "guides.saved", fallback: "admin.saveFailed") {
            answer = try await app.services.api.call(API.guideSave, request)
        }
        if let answer { adopt(answer) }
        return ok
    }

    private func publish() async {
        if dirty, !(await save()) { return }
        await setStatus("published")
    }

    private func setStatus(_ next: String) async {
        guard let id else { return }
        busy = true
        defer { busy = false }
        var answer: AdminGuide?
        _ = await app.attempt(done: next == "published" ? "guides.publishedNow" : "guides.unpublishedNow", fallback: "admin.saveFailed") {
            answer = try await app.services.api.call(API.guideSetStatus, .init(id: id, status: next))
        }
        if let answer {
            status = answer.status
            slug = answer.slug
        }
    }

    private func delete() async {
        guard let id else { return }
        busy = true
        defer { busy = false }
        if await app.attempt(done: "guides.deleted", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.guideDelete, .init(id: id)) }) {
            dismiss()
        }
    }

    private func draft() async {
        drafting = true
        defer { drafting = false }
        let request = API.GuideTopic(topic: topic.trimmingCharacters(in: .whitespaces), audience: content.audience)
        var answer: GuideContent?
        _ = await app.attempt(fallback: "admin.saveFailed") {
            answer = try await app.services.api.call(API.guideDraft, request)
        }
        guard let answer else { return }
        if content.hasWords { pendingDraft = answer } else { use(answer) }
    }
}

/// One step of a guide: its words in both languages and its picture — one
/// of NetLet's own uploads, from the library or drawn by the model and kept
/// only once a person picks it.
private struct GuideStepCard: View {
    let index: Int
    let count: Int
    @Binding var step: GuideContent.Step
    let limits: PortalRules.GuideLimits
    let drawable: Bool
    let move: (Int) -> Void
    let remove: () -> Void
    @State private var picked: PhotosPickerItem?
    @State private var drawn: (jpeg: Data, image: UIImage)?
    @State private var drawing = false
    @State private var uploading = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalCard {
            HStack(spacing: 8) {
                Text("\(index + 1)").font(.inter(13, .bold)).foregroundStyle(.white).frame(width: 24, height: 24).background(Circle().fill(Brand.navy))
                Text(GuideRules.title(.init(audience: "", title: step.title, titleAr: step.titleAr, summary: "", summaryAr: "", steps: []), arabic: l.current == .ar)
                     ?? l.t("guides.stepN", ["n": "\(index + 1)"]))
                    .font(.inter(16, .bold))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
            }
            LabeledField(label: l.t("guides.stepTitleEn"), text: capped($step.title, limits.stepTitleMax))
                .environment(\.layoutDirection, .leftToRight)
            LabeledField(label: l.t("guides.stepTitleAr"), text: capped($step.titleAr, limits.stepTitleMax))
                .environment(\.layoutDirection, .rightToLeft)
            LabeledField(label: l.t("guides.stepBodyEn"), text: capped($step.body, limits.stepBodyMax), axis: .vertical)
                .environment(\.layoutDirection, .leftToRight)
            LabeledField(label: l.t("guides.stepBodyAr"), text: capped($step.bodyAr, limits.stepBodyMax), axis: .vertical)
                .environment(\.layoutDirection, .rightToLeft)
            Text(l.t("guides.picture")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            HStack(alignment: .top, spacing: 12) {
                picture
                    .frame(width: 112, height: 112)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.pearl))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                VStack(alignment: .leading, spacing: 8) {
                    if drawn != nil {
                        Text(l.t("guides.drawnNote")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                        FlowLayout(spacing: 8) {
                            Button { Task { await useDrawn() } } label: {
                                if uploading { ProgressView().tint(.white) } else { Text(l.t("guides.useDrawn")) }
                            }
                            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                            .disabled(uploading)
                            Button { drawn = nil } label: { Text(l.t("guides.discardDrawn")) }
                                .buttonStyle(PortalSmallButtonStyle())
                                .disabled(uploading)
                        }
                    } else {
                        FlowLayout(spacing: 8) {
                            if drawable {
                                Button { Task { await draw() } } label: {
                                    Label(l.t(drawing ? "guides.drawing" : "guides.draw"), systemImage: "sparkles")
                                }
                                .buttonStyle(PortalSmallButtonStyle())
                                .disabled((step.title + step.titleAr).isEmpty || drawing)
                            }
                            PhotosPicker(selection: $picked, matching: .images) {
                                if uploading { ProgressView() } else { Label(l.t("media.upload"), systemImage: "photo.on.rectangle") }
                            }
                            .buttonStyle(PortalSmallButtonStyle())
                            .disabled(uploading)
                            if step.imageUrl != nil {
                                Button { step.imageUrl = nil } label: { Text(l.t("guides.removePicture")) }
                                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            FlowLayout(spacing: 8) {
                Button { move(-1) } label: { Image(systemName: "arrow.up") }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(index == 0)
                    .accessibilityLabel(l.t("guides.moveUp"))
                Button { move(1) } label: { Image(systemName: "arrow.down") }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(index == count - 1)
                    .accessibilityLabel(l.t("guides.moveDown"))
                Button(action: remove) { Label(l.t("guides.removeStep"), systemImage: "trash") }
                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                    .disabled(count == 1)
            }
        }
        .onChange(of: picked) { Task { await upload() } }
    }

    @ViewBuilder private var picture: some View {
        if let drawn {
            Image(uiImage: drawn.image).resizable().scaledToFill().accessibilityLabel(l.t("guides.drawnAlt"))
        } else if let url = step.imageUrl {
            RemoteImage(reference: url)
        } else {
            Image(systemName: "photo")
                .font(.system(size: 26))
                .foregroundStyle(Brand.chevron)
                .accessibilityLabel(l.t("guides.noPicture"))
        }
    }

    private func capped(_ binding: Binding<String>, _ max: Int) -> Binding<String> {
        Binding(get: { binding.wrappedValue }, set: { binding.wrappedValue = String($0.prefix(max)) })
    }

    /// The picture is asked for in English where the step has it, as the web does.
    private func draw() async {
        drawing = true
        defer { drawing = false }
        let request = API.StepWords(title: step.title.isEmpty ? step.titleAr : step.title, body: step.body.isEmpty ? step.bodyAr : step.body)
        var answer: DrawnPicture?
        guard await app.attempt(fallback: "admin.saveFailed", { answer = try await app.services.api.call(API.guidePicture, request) }), let answer else { return }
        guard let bytes = Data(base64Encoded: answer.data) else {
            app.toast(l.t("media.notAnImage"))
            return
        }
        do {
            let jpeg = try ImagePreparation.jpeg(from: bytes, rules: ReferenceData.shared.rules.media)
            if let image = UIImage(data: jpeg) { drawn = (jpeg, image) }
        } catch ImagePreparation.Problem.tooSmall {
            app.toast(l.t("media.tooSmall"))
        } catch {
            app.toast(l.t("media.notAnImage"))
        }
    }

    private func useDrawn() async {
        guard let drawn else { return }
        uploading = true
        defer { uploading = false }
        do {
            let uploaded = try await app.services.seller.upload(jpeg: drawn.jpeg)
            step.imageUrl = uploaded.url
            self.drawn = nil
            Haptics.succeeded()
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(key == "error.serverProblem" ? "media.failed" : key))
        }
    }

    private func upload() async {
        guard let picked else { return }
        uploading = true
        defer {
            uploading = false
            self.picked = nil
        }
        guard let data = try? await picked.loadTransferable(type: Data.self) else { return }
        do {
            let jpeg = try ImagePreparation.jpeg(from: data, rules: ReferenceData.shared.rules.media)
            let uploaded = try await app.services.seller.upload(jpeg: jpeg)
            step.imageUrl = uploaded.url
            app.toast(l.t("guides.pictureAdded"))
            Haptics.succeeded()
        } catch ImagePreparation.Problem.tooSmall {
            app.toast(l.t("media.tooSmall"))
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(key == "error.serverProblem" ? "media.notAnImage" : key))
        }
    }
}

// MARK: - Delivery companies

/// The delivery companies NetLet works with — the web's `/admin/couriers`:
/// each company's contact and state, who signs in for it, and a new one.
/// Suspending a company asks first; it stops work being assigned to it.
struct PortalCouriersView: View {
    @State private var companies: [DeliveryCompany]?
    @State private var failed: APIError?
    @State private var suspending: DeliveryCompany?
    @State private var busy = false
    @State private var name = ""
    @State private var nameAr = ""
    @State private var phone = ""
    @State private var email = ""
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let mayMintLogins = app.session.seller?.can("platform.manageUsers") == true
        PortalScreen(title: l.t("admin.couriers"), intro: l.t("admin.couriersNote"), refresh: { await load() }) {
            if let companies {
                if companies.isEmpty {
                    PortalEmpty(text: l.t("dispatch.noCompanies"))
                } else {
                    ForEach(companies) { company in
                        PortalCard {
                            header(company)
                            if mayMintLogins {
                                Divider()
                                CourierMembersSection(courierId: company.id)
                            }
                        }
                    }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
            }
            newCompany
        }
        .task { await load() }
        .confirmationDialog(suspending.map { l.t("dispatch.suspendTitle", ["name": $0.name]) } ?? "",
                            isPresented: Binding(get: { suspending != nil }, set: { if !$0 { suspending = nil } }), titleVisibility: .visible) {
            Button(l.t("dispatch.suspend"), role: .destructive) {
                if let company = suspending { Task { await setStatus(company, "suspended") } }
            }
            Button(l.t("common.cancel"), role: .cancel) { suspending = nil }
        } message: {
            Text(l.t("dispatch.suspendBody"))
        }
    }

    private func header(_ company: DeliveryCompany) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "building.2")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Brand.tint))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(company.name + (company.nameAr.map { " · \($0)" } ?? ""))
                    .font(.inter(15, .bold))
                    .foregroundStyle(Brand.navy)
                    .fixedSize(horizontal: false, vertical: true)
                let contact = [company.contactPhone, company.contactEmail].compactMap { $0 }.filter { !$0.isEmpty }
                if !contact.isEmpty {
                    Text(contact.map(latin).joined(separator: " · ")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                FlowLayout(spacing: 8) {
                    StatusPill(label: l.t(company.status == "active" ? "dispatch.statusActive" : "dispatch.statusSuspended"),
                               tone: .portal(company.status == "active" ? "good" : "danger"))
                    if company.status == "active" {
                        Button { suspending = company } label: { Text(l.t("dispatch.suspend")) }
                            .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                            .disabled(busy)
                    } else {
                        Button { Task { await setStatus(company, "active") } } label: { Text(l.t("dispatch.restore")) }
                            .buttonStyle(PortalSmallButtonStyle())
                            .disabled(busy)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var newCompany: some View {
        PortalCard {
            Text(l.t("dispatch.newCourier")).font(.inter(16, .bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            LabeledField(label: l.t("dispatch.companyName"), text: capped($name, 160))
            LabeledField(label: "\(l.t("dispatch.companyNameAr")) (\(l.t("admin.optional")))", text: capped($nameAr, 160))
                .environment(\.layoutDirection, .rightToLeft)
            LabeledField(label: "\(l.t("dispatch.companyPhone")) (\(l.t("admin.optional")))", text: capped($phone, 40), keyboard: .phonePad, content: .telephoneNumber, leftToRight: true)
            LabeledField(label: "\(l.t("dispatch.companyEmail")) (\(l.t("admin.optional")))", text: capped($email, 320), keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
            Button { Task { await create() } } label: { Label(l.t("dispatch.create"), systemImage: "plus") }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        }
    }

    private func capped(_ binding: Binding<String>, _ max: Int) -> Binding<String> {
        Binding(get: { binding.wrappedValue }, set: { binding.wrappedValue = String($0.prefix(max)) })
    }

    private func load() async {
        do {
            companies = try await app.services.api.call(API.deliveryCompanies)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, companies == nil { failed = failure }
        }
    }

    private func setStatus(_ company: DeliveryCompany, _ status: String) async {
        busy = true
        defer {
            busy = false
            suspending = nil
        }
        if await app.attempt(fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.setCourierStatus, .init(courierId: company.id, status: status)) }) {
            await load()
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        let request = API.NewCourier(name: name.trimmingCharacters(in: .whitespaces), nameAr: .text(nameAr), contactPhone: .text(phone), contactEmail: .text(email))
        if await app.attempt(done: "dispatch.created", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.createCourier, request) }) {
            name = ""
            nameAr = ""
            phone = ""
            email = ""
            await load()
        }
    }
}

/// Who signs in for one delivery company, for an administrator who mints
/// logins: added by the address they registered with, and taken off after a
/// question.
private struct CourierMembersSection: View {
    let courierId: Int
    @State private var members: [CourierMember]?
    @State private var email = ""
    @State private var removing: CourierMember?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("dispatch.members")).font(.inter(14, .bold)).foregroundStyle(Brand.ink).accessibilityAddTraits(.isHeader)
            if let members {
                if members.isEmpty {
                    Text(l.t("dispatch.noMembers")).font(.inter(13)).foregroundStyle(Brand.muted)
                } else {
                    ForEach(members) { member in
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                if let name = member.name, !name.isEmpty { Text(name).font(.inter(14, .semibold)).foregroundStyle(Brand.ink) }
                                Text(latin(member.email)).font(.inter(12)).foregroundStyle(Brand.muted).lineLimit(1).truncationMode(.middle)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Button { removing = member } label: {
                                Image(systemName: "trash").font(.system(size: 15)).foregroundStyle(Brand.danger).frame(width: 44, height: 44)
                            }
                            .buttonStyle(.tap)
                            .disabled(busy)
                            .accessibilityLabel(l.t("dispatch.removeMember", ["id": member.name?.isEmpty == false ? member.name! : member.email]))
                        }
                    }
                }
            } else {
                ProgressView().tint(Brand.navy)
            }
            LabeledField(label: l.t("dispatch.memberId"), text: $email, hint: l.t("dispatch.addMemberNote"), keyboard: .emailAddress, content: .emailAddress, leftToRight: true)
            Button { Task { await add() } } label: { Label(l.t("dispatch.addMember"), systemImage: "person.badge.plus") }
                .buttonStyle(PortalSmallButtonStyle())
                .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        }
        .task { await load() }
        .confirmationDialog(removing.map { l.t("dispatch.removeMemberTitle", ["name": $0.name?.isEmpty == false ? $0.name! : $0.email]) } ?? "",
                            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button(l.t("admin.removeMember"), role: .destructive) {
                if let member = removing { Task { await remove(member) } }
            }
            Button(l.t("common.cancel"), role: .cancel) { removing = nil }
        } message: {
            Text(l.t("dispatch.removeMemberBody"))
        }
    }

    private func load() async {
        members = (try? await app.services.api.call(API.courierMembers, .init(courierId: courierId))) ?? members ?? []
    }

    private func add() async {
        busy = true
        defer { busy = false }
        let address = email.trimmingCharacters(in: .whitespaces)
        if await app.attempt(done: "dispatch.memberAdded", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.addCourierMember, .init(courierId: courierId, email: address))
        }) {
            email = ""
            await load()
        }
    }

    private func remove(_ member: CourierMember) async {
        busy = true
        defer {
            busy = false
            removing = nil
        }
        if await app.attempt(done: "dispatch.memberRemoved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.removeCourierMember, .init(courierId: courierId, userId: member.userId))
        }) {
            await load()
        }
    }
}
