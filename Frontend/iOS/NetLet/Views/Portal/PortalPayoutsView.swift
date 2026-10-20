import SwiftUI
import UIKit

/// Payouts — the web's `/admin/payouts`. Nobody assembles a batch: it is
/// every order the schedule says has come due and has not been paid. A run is
/// frozen before the money moves and never recomputed after, so preparing,
/// filing and marking sent are three presses, each asked first.
/// A store reads its own; NetLet prepares, files and records.
struct PortalPayoutsView: View {
    @State private var batches: [PayoutBatch]?
    @State private var prepared: PreparedRuns?
    @State private var files: BankFiles?
    @State private var due: [PayoutDue]?
    @State private var history: PortalPageOf<PayoutRun>?
    @State private var historyPage = 1
    @State private var preparedPage = 1
    @State private var filesPage = 1
    @State private var failed: APIError?
    @State private var confirm: Confirmation?
    @State private var busy = false
    @State private var shared: URL?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var admin: Bool { app.session.seller?.kind == "admin" }

    /// One question before money moves, and what pressing yes does.
    struct Confirmation: Identifiable {
        let id = UUID()
        let title: String
        let body: String
        let verb: String
        var destructive = false
        let run: () async -> Void
    }

    var body: some View {
        PortalScreen(title: l.t("admin.payoutsPage"), intro: l.t(admin ? "admin.payoutsNoteAdmin" : "admin.payoutsNoteStore"), refresh: { await load() }) {
            if let failed, batches == nil {
                ErrorStateView(error: failed) { await load() }
            } else if batches == nil {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 160)
            } else {
                ready
                if admin {
                    waiting
                    bankFiles
                }
                dueSection
                historySection
            }
        }
        .task { await load() }
        .alert(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), presenting: confirm) { question in
            Button(question.verb, role: question.destructive ? .destructive : nil) { Task { await question.run() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: { question in
            Text(question.body)
        }
        .sheet(item: Binding(get: { shared.map(SharedFile.init) }, set: { if $0 == nil { shared = nil } })) { file in
            ActivitySheet(items: [file.url]).ignoresSafeArea()
        }
    }

    // MARK: Ready

    @ViewBuilder
    private var ready: some View {
        let rows = batches ?? []
        HStack(alignment: .firstTextBaseline) {
            PortalSectionHeading(title: l.t("admin.payoutsReady"))
            let payable = rows.filter(\.payable).count
            if admin && payable >= 2 {
                Button(l.t("admin.payoutPrepareAll", ["count": "\(payable)"])) {
                    confirm = Confirmation(title: l.t("admin.payoutPrepareAllTitle", ["count": "\(payable)"]), body: l.t("admin.payoutPrepareAllBody"), verb: l.t("admin.payoutPrepare")) {
                        await prepareAll()
                    }
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                .disabled(busy)
            }
        }
        if rows.isEmpty {
            PortalEmpty(text: l.t("admin.payoutsNothingReady"))
        } else {
            ForEach(rows) { batch in batchCard(batch) }
        }
    }

    private func batchCard(_ batch: PayoutBatch) -> some View {
        PortalCard {
            HStack {
                Text(batch.vendorName).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                Spacer()
                Text(batch.total.formatted(l.current)).font(.inter(15, .bold)).foregroundStyle(batch.total.fils < 0 ? Brand.danger : Brand.navy)
            }
            if let iban = batch.iban {
                Text("\(l.t("admin.payoutTo")) \(latin(iban))").font(.inter(13)).foregroundStyle(Brand.muted)
            } else {
                Text(l.t("admin.payoutNoIban")).font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
            }
            // A batch that nets negative sends nothing and says what the store owes.
            if !batch.payable {
                Text(l.t("admin.payoutOwedBack", ["amount": Money(fils: abs(batch.total.fils)).formatted(l.current)])).font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
            }
            VStack(spacing: 4) {
                ForEach(Array(batch.lines.enumerated()), id: \.offset) { _, line in
                    HStack(spacing: 6) {
                        Text(line.reference).font(.inter(13)).foregroundStyle(Brand.body).environment(\.layoutDirection, .leftToRight)
                        if line.kind == "clawback" { tag(l.t("admin.payoutClawback")) }
                        if line.kind == "fee" { tag(l.t(line.reference.hasPrefix("FF-") ? "fulfilment.packingFee" : "admin.payoutPlacementFee")) }
                        Spacer()
                        Text(line.amount.formatted(l.current)).font(.inter(13, .semibold)).foregroundStyle(line.amount.fils < 0 ? Brand.danger : Brand.navy)
                    }
                }
            }
            if admin && batch.payable {
                if batch.iban != nil {
                    Button(l.t("admin.payoutPrepare")) {
                        let amount = batch.total.formatted(l.current)
                        confirm = Confirmation(title: l.t("admin.payoutPrepareTitle", ["amount": amount, "name": batch.vendorName]), body: l.t("admin.payoutPrepareBody"), verb: l.t("admin.payoutPrepare")) {
                            await prepare(batch)
                        }
                    }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled(busy)
                } else {
                    Text(l.t("admin.payoutNeedsIban")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func tag(_ text: String) -> some View {
        Text(text).font(.inter(11, .semibold)).foregroundStyle(Brand.muted)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Capsule().fill(Brand.tint))
    }

    // MARK: Waiting to be sent

    @ViewBuilder
    private var waiting: some View {
        HStack(alignment: .firstTextBaseline) {
            PortalSectionHeading(title: l.t("admin.payoutsWaiting"), note: l.t("admin.payoutsWaitingNote"))
            if let unfiled = prepared?.unfiled, unfiled > 0 {
                Button(l.t("admin.payoutMakeFile", ["count": "\(unfiled)"])) { Task { await makeFile() } }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled(busy)
            }
        }
        if let prepared {
            if prepared.rows.isEmpty {
                PortalEmpty(text: l.t("admin.payoutsNoneWaiting"))
            } else {
                ForEach(prepared.rows) { run in preparedCard(run) }
                PortalPager(page: prepared.page, pageSize: prepared.pageSize, total: prepared.total) { next in
                    preparedPage = next
                    Task { await load() }
                }
            }
        }
    }

    private func preparedCard(_ run: PreparedRun) -> some View {
        let amount = run.total.formatted(l.current)
        return PortalCard {
            HStack {
                Text(run.vendorName).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                Spacer()
                Text(amount).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            }
            Text([
                "\(l.t("admin.payoutTo")) \(latin(run.iban ?? "—"))",
                run.fileReference.map { l.t("admin.payoutInFile", ["reference": $0]) } ?? l.t("admin.payoutNotInFile"),
                run.preparedAt.map { l.t("admin.payoutPreparedOn", ["date": OrderWording.date($0, language: l.current)]) },
            ].compactMap { $0 }.joined(separator: " · "))
            .font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            SentForm(fileTarget: false) { reference in
                confirm = Confirmation(title: l.t("admin.payoutMarkSentTitle", ["amount": amount, "name": run.vendorName]), body: l.t("admin.payoutMarkSentBody", ["reference": reference]), verb: l.t("admin.payoutMarkSent")) {
                    await markSent(.init(runId: run.id, bankReference: reference))
                }
            }
            Button(l.t("admin.payoutCancel")) {
                confirm = Confirmation(title: l.t("admin.payoutCancelTitle", ["amount": amount, "name": run.vendorName]), body: l.t("admin.payoutCancelBody"), verb: l.t("admin.payoutCancel"), destructive: true) {
                    await void(run)
                }
            }
            .buttonStyle(PortalSmallButtonStyle())
            .disabled(busy)
        }
    }

    // MARK: Bank files

    @ViewBuilder
    private var bankFiles: some View {
        PortalSectionHeading(title: l.t("admin.payoutFiles"), note: l.t("admin.payoutFilesNote"))
        if let problem = files?.pain001 {
            Text("\(l.t("admin.payoutXmlUnavailable")) \(Phrasebook.shared.has(problem) ? l.t(problem) : "")")
                .font(.inter(13)).foregroundStyle(Brand.accentInk).fixedSize(horizontal: false, vertical: true)
        }
        if let files {
            if files.rows.isEmpty {
                PortalEmpty(text: l.t("admin.payoutNoFiles"))
            } else {
                ForEach(files.rows) { file in fileCard(file, xmlReady: files.pain001 == nil) }
                PortalPager(page: files.page, pageSize: files.pageSize, total: files.total) { next in
                    filesPage = next
                    Task { await load() }
                }
            }
        }
    }

    private func fileCard(_ file: BankFile, xmlReady: Bool) -> some View {
        PortalCard {
            HStack {
                Text("\(latin(file.reference)) · \(OrderWording.date(file.createdAt, language: l.current))").font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                Spacer()
                Text(file.total.formatted(l.current)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
            }
            Text(l.t("admin.payoutFileCounts", ["waiting": "\(file.waiting)", "sent": "\(file.sent)", "cancelled": "\(file.cancelled)"])).font(.inter(13)).foregroundStyle(Brand.muted)
            if file.waiting + file.sent > 0 {
                HStack(spacing: 8) {
                    Button(l.t("admin.payoutDownloadXml")) { Task { await download(file, format: "pain001") } }
                        .buttonStyle(PortalSmallButtonStyle()).disabled(!xmlReady || busy)
                    Button(l.t("admin.payoutDownloadCsv")) { Task { await download(file, format: "csv") } }
                        .buttonStyle(PortalSmallButtonStyle()).disabled(busy)
                }
            }
            if file.waiting > 0 {
                SentForm(fileTarget: true) { reference in
                    confirm = Confirmation(title: l.t("admin.payoutMarkFileTitle", ["file": file.reference]), body: l.t("admin.payoutMarkFileBody", ["reference": reference]), verb: l.t("admin.payoutMarkSent")) {
                        await markSent(.init(fileId: file.id, bankReference: reference))
                    }
                }
            }
        }
    }

    // MARK: Due

    @ViewBuilder
    private var dueSection: some View {
        let settlement = PortalRules.shared.settlement
        PortalSectionHeading(title: l.t("admin.payoutsDue"), note: l.t("admin.payoutsDueNote", [
            "cod": "\(settlement?.cod ?? 14)", "cardMin": "\(settlement?.cardMin ?? 1)", "cardMax": "\(settlement?.cardMax ?? 3)",
        ]))
        if let due {
            if due.isEmpty {
                PortalEmpty(text: l.t("admin.payoutsDueEmpty"))
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(due.enumerated()), id: \.offset) { index, row in
                        if index > 0 { Divider() }
                        let shown = dueState(row)
                        HStack(alignment: .top, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.reference).font(.inter(13, .semibold)).foregroundStyle(Brand.navy).environment(\.layoutDirection, .leftToRight)
                                Text(row.vendorName).font(.inter(12)).foregroundStyle(Brand.muted)
                            }
                            Spacer(minLength: 6)
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(row.owed.formatted(l.current)).font(.inter(13, .bold)).foregroundStyle(Brand.navy)
                                Text(shown.text).font(.inter(12, shown.loud ? .bold : .regular)).foregroundStyle(shown.color).multilineTextAlignment(.trailing)
                            }
                        }
                        .padding(12)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
            }
        }
    }

    /// When an order's money comes, said the way the schedule reads (`PayoutsDue`).
    private func dueState(_ row: PayoutDue) -> (text: String, color: Color, loud: Bool) {
        if row.paid.fils > 0 && row.paid.fils >= row.owed.fils { return (l.t("admin.payoutSent"), Brand.muted, false) }
        if row.sending.fils > 0 && row.paid.fils + row.sending.fils >= row.owed.fils { return (l.t("admin.payoutBeingSent"), Brand.navy, false) }
        if row.due.state == "refunded" { return (l.t("admin.payoutRefunded"), Brand.muted, false) }
        // A due order whose every line came back owes nothing; "Overdue" against KWD 0 would say otherwise.
        if row.due.state == "due" && row.owed.fils <= 0 && row.paid.fils == 0 && row.sending.fils == 0 { return (l.t("admin.payoutNothingOwed"), Brand.muted, false) }
        if row.due.state == "unpaid" { return (l.t("admin.payoutUnpaid"), Brand.muted, false) }
        guard let window = row.due.window else { return (l.t("admin.payoutUnpaid"), Brand.muted, false) }
        let from = OrderWording.date(window.from, language: l.current)
        if row.due.state == "held" { return (l.t("admin.payoutHeld", ["from": from]), Brand.body, false) }
        let text = window.from == window.to ? l.t("admin.payoutDueOn", ["from": from])
            : l.t("admin.payoutDueBetween", ["from": from, "to": OrderWording.date(window.to, language: l.current)])
        return row.due.overdue == true ? ("\(l.t("admin.payoutOverdue")) · \(text)", Brand.danger, true) : (text, Brand.navy, false)
    }

    // MARK: History

    @ViewBuilder
    private var historySection: some View {
        PortalSectionHeading(title: l.t("admin.payoutsHistory"))
        if let history {
            if history.rows.isEmpty {
                PortalEmpty(text: l.t("admin.payoutsNoHistory"))
            } else {
                ForEach(history.rows) { run in HistoryCard(run: run) }
                PortalPager(page: history.page, pageSize: history.pageSize, total: history.total) { next in
                    historyPage = next
                    Task { await load() }
                }
            }
        }
    }

    // MARK: Acts

    private func load() async {
        let api = app.services.api
        let admin = self.admin
        async let dueRows = try? api.call(API.payoutsDue, .init())
        async let runs = try? api.call(API.payoutHistory, .init(page: historyPage))
        do {
            batches = try await api.call(API.payoutBatches)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, batches == nil { failed = failure }
        }
        if admin {
            prepared = (try? await api.call(API.preparedPayouts, .init(page: preparedPage))) ?? prepared
            files = (try? await api.call(API.payoutFiles, .init(page: filesPage))) ?? files
        }
        due = await dueRows ?? due ?? []
        history = await runs ?? history
    }

    private func run(_ work: () async throws -> Void) async -> Bool {
        busy = true
        defer { busy = false }
        return await app.attempt(fallback: "admin.saveFailed", work)
    }

    private func prepareAll() async {
        var answer: PreparedAll?
        guard await run({ answer = try await app.services.api.call(API.prepareAllPayouts) }), let answer else { return }
        app.toast(l.t("admin.payoutPreparedAll", ["count": "\(answer.prepared)"]))
        if !answer.skipped.isEmpty { app.toast(l.t("admin.payoutSkipped", ["names": answer.skipped.joined(separator: l.current == .ar ? "، " : ", ")])) }
        await load()
    }

    private func prepare(_ batch: PayoutBatch) async {
        var answer: PreparedOne?
        guard await run({ answer = try await app.services.api.call(API.preparePayout, .init(vendorId: batch.vendorId)) }), let answer else { return }
        app.toast(l.t("admin.payoutPrepared", ["amount": answer.total.formatted(l.current), "name": batch.vendorName]))
        await load()
    }

    private func makeFile() async {
        var answer: MadeFile?
        guard await run({ answer = try await app.services.api.call(API.makePayoutFile) }), let answer else { return }
        app.toast(l.t("admin.payoutFileMade", ["reference": answer.reference, "count": "\(answer.transfers)"]))
        await load()
    }

    private func markSent(_ input: API.RunSent) async {
        var answer: MarkedSent?
        guard await run({ answer = try await app.services.api.call(API.markPayoutSent, input) }), let answer else { return }
        app.toast(l.t("admin.payoutMarkedSent", ["count": "\(answer.runs)"]))
        await load()
    }

    private func void(_ prepared: PreparedRun) async {
        guard await run({ _ = try await app.services.api.call(API.cancelPayout, .init(runId: prepared.id)) }) else { return }
        app.toast(l.t("admin.payoutCancelled"))
        await load()
    }

    /// The file is handed to the share sheet, from which it goes to the bank's
    /// app or to Files; the page never decides where.
    private func download(_ file: BankFile, format: String) async {
        var content: PayoutFileContent?
        guard await run({ content = try await app.services.api.call(API.downloadPayoutFile, .init(fileId: file.id, format: format)) }), let content else { return }
        let name = content.filename.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try Data(content.content.utf8).write(to: url, options: .atomic)
            shared = url
        } catch {
            app.toast(l.t("admin.saveFailed"))
        }
    }
}

/// A bank's reference for a transfer, typed in before it is marked sent.
private struct SentForm: View {
    let fileTarget: Bool
    let submit: (String) -> Void
    @State private var reference = ""
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let trimmed = reference.trimmingCharacters(in: .whitespaces)
        HStack(alignment: .bottom, spacing: 8) {
            LabeledField(label: l.t("admin.payoutReference"), text: Binding(get: { reference }, set: { reference = String($0.prefix(PortalRules.shared.maxBankReference ?? 80)) }), leftToRight: true)
            Button(l.t(fileTarget ? "admin.payoutMarkFileSent" : "admin.payoutMarkSent")) {
                submit(trimmed)
                reference = ""
            }
            .buttonStyle(PortalSmallButtonStyle(kind: .primary))
            .disabled(trimmed.isEmpty)
            .padding(.bottom, 4)
        }
    }
}

/// A sent or sending payout, opened to show what it paid.
private struct HistoryCard: View {
    let run: PayoutRun
    @State private var open = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        PortalCard {
            Button { withAnimation(.easeOut(duration: 0.2)) { open.toggle() } } label: {
                HStack(spacing: 6) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(run.vendorName).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                        if let when = run.paidAt ?? run.preparedAt {
                            Text(OrderWording.date(when, language: l.current)).font(.inter(12)).foregroundStyle(Brand.muted)
                        }
                    }
                    if run.status == "prepared" { StatusPill(label: l.t("admin.payoutBeingSent"), tone: .shipped) }
                    Spacer()
                    Text(run.total.formatted(l.current)).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(Brand.muted).rotationEffect(.degrees(open ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            if open {
                Text([run.bankReference.map { "\(l.t("admin.payoutReference")): \(latin($0))" } ?? l.t("admin.payoutBeingSent"), run.iban.map(latin)].compactMap { $0 }.joined(separator: " · "))
                    .font(.inter(12)).foregroundStyle(Brand.muted)
                ForEach(Array(run.lines.enumerated()), id: \.offset) { _, line in
                    HStack {
                        Text(line.reference).font(.inter(12)).foregroundStyle(Brand.body).environment(\.layoutDirection, .leftToRight)
                        Spacer()
                        Text(line.amount.formatted(l.current)).font(.inter(12, .semibold)).foregroundStyle(Brand.navy)
                    }
                }
            }
        }
    }
}

/// A file ready to hand to another app.
struct SharedFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

/// The system's share sheet, for a file the page made.
struct ActivitySheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
