import SwiftUI

// The opened order's after-sales sheets — the web's `OrderWarranty`,
// `OrderModify`, `OrderAddress` and `OrderHelp`, one sheet each. Nothing here
// decides: what is offered is the server's answer on `orders.get`, and every
// press is asked again under a lock on the server.

// MARK: Warranty

/// The claims on this order, newest first, with where each stands — drawn
/// whenever there is one. A claim nobody has answered can be withdrawn.
struct WarrantyClaimsList: View {
    let detail: OrderDetail
    let reload: () async -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var withdrawing: Int?

    var body: some View {
        if !detail.warranty.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(detail.warranty) { claim in
                    card(claim)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("warranty.claims"))
        }
    }

    private func card(_ claim: WarrantyClaim) -> some View {
        let item = detail.lines.first { $0.id == claim.orderItemId }?.productTitle ?? ""
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Label(l.t("warranty.claimOn", ["item": "\u{2068}\(item)\u{2069}"]), systemImage: "checkmark.shield")
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(2)
                Spacer(minLength: 8)
                WarrantyStagePill(stage: claim.stage)
            }
            Text(claim.problem)
                .font(.inter(14))
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
            if !claim.photos.isEmpty {
                HStack(spacing: 8) {
                    ForEach(claim.photos, id: \.self) { photo in
                        RemoteImage(reference: photo)
                            .frame(width: 56, height: 56)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .accessibilityHidden(true)
                    }
                }
            }
            if let remedy = claim.remedy {
                Text(l.t(WarrantyClaim.remedyKey(remedy))).font(.inter(13, .bold)).foregroundStyle(Brand.navy)
            }
            if let response = claim.response, !response.isEmpty {
                (Text(l.t("warranty.storeSaid") + " ").bold() + Text(response))
                    .font(.inter(13))
                    .foregroundStyle(Brand.ink)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
            }
            Text(l.t("warranty.filedOn", ["date": OrderWording.date(claim.createdAt, language: l.current)]))
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
            if claim.stage == "returning" {
                Text(l.t("warranty.followReturn"))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if claim.mayWithdraw {
                Button(l.t("warranty.withdraw")) { Task { await withdraw(claim.id) } }
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.danger)
                    .underline()
                    .frame(minHeight: 44)
                    .buttonStyle(.tap)
                    .disabled(withdrawing != nil)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    private func withdraw(_ id: Int) async {
        withdrawing = id
        defer { withdrawing = nil }
        if await app.attempt(done: "warranty.withdrawn", fallback: "error.serverProblem", {
            _ = try await app.services.api.call(API.withdrawWarranty, .init(id: id))
        }) {
            await reload()
        }
    }
}

/// Where a claim stands, one word the shopper and the store both read.
struct WarrantyStagePill: View {
    let stage: String
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        StatusPill(label: l.t(WarrantyClaim.stageKey(stage)), tone: tone)
    }

    private var tone: OrderTone {
        switch stage {
        case "done": return .done
        case "declined": return .stopped
        case "withdrawn": return .over
        case "repairing", "returning": return .shipped
        default: return .preparing
        }
    }
}

/// "Warranty": which item, what stopped working, and photos if they help —
/// the store answers with a repair, a replacement or a refund. Only the items
/// `warrantyEligibility` allows are offered, beside the store's own warranty
/// words, and the words are held to the contact filter before anything is sent.
struct WarrantySheet: View {
    let reference: String
    let detail: OrderDetail
    let done: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var chosen: Int?
    @State private var problemText = ""
    @State private var photos: [String] = []
    @State private var uploading = 0
    @State private var tried = false
    @State private var sending = false

    private var rules: Rules.AfterSales.Warranty { ReferenceData.shared.rules.afterSalesRules.warranty }
    private var lines: [OrderLine] { detail.warrantyClaimable }

    /// `problemIssue`, the server's own refusal asked early.
    private var issue: String? {
        if chosen == nil { return "warranty.pickItem" }
        let trimmed = problemText.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        if trimmed.count < rules.minProblem { return "warranty.tooShort" }
        if trimmed.count > rules.maxProblem { return "warranty.tooLong" }
        if !ContactFilter.findings(trimmed).isEmpty { return "warranty.contactDetails" }
        return nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(l.t("warranty.note"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(l.t("warranty.which")).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                    ForEach(lines) { line in
                        ChoiceRow(line: line, on: chosen == line.id) { chosen = line.id }
                    }
                    if let line = lines.first(where: { $0.id == chosen }) {
                        Group {
                            if let terms = line.warrantyTerms, !terms.isEmpty {
                                Text(l.t("warranty.storeTerms") + " ") + Text(terms).bold()
                            } else {
                                Text(l.t("warranty.noTerms"))
                            }
                        }
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    LabeledField(
                        label: l.t("warranty.problem"),
                        text: $problemText,
                        problem: tried && issue != nil && issue != "warranty.pickItem" ? l.t(issue!) : nil,
                        axis: .vertical
                    )
                    if tried, issue == "warranty.pickItem" {
                        Text(l.t("warranty.pickItem")).font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
                    }
                    ShopperPhotoStrip(photos: $photos, uploading: $uploading, max: rules.maxPhotos, label: l.t("warranty.photos"), hint: nil)
                    Button {
                        Task { await send() }
                    } label: {
                        HStack(spacing: 8) {
                            if sending { ProgressView().tint(.white) }
                            Text(l.t("warranty.send"))
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(sending || uploading > 0)
                }
                .padding(16)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("warranty.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear { if lines.count == 1 { chosen = lines[0].id } }
    }

    private func send() async {
        tried = true
        guard issue == nil, let item = chosen else {
            Haptics.refused()
            return
        }
        sending = true
        defer { sending = false }
        let words = problemText.trimmingCharacters(in: .whitespacesAndNewlines)
        if await app.attempt(done: "warranty.sent", fallback: "error.serverProblem", {
            _ = try await app.services.api.call(API.fileWarranty, .init(reference: reference, orderItemId: item, problem: words, photos: photos))
        }) {
            done()
            dismiss()
        }
    }
}

/// One item to choose: its photo, its name and a round tick — a radio row.
private struct ChoiceRow: View {
    let line: OrderLine
    let on: Bool
    let choose: () -> Void

    var body: some View {
        Button(action: choose) {
            HStack(spacing: 12) {
                Image(systemName: on ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(on ? Brand.navy : Brand.line)
                Color.clear
                    .frame(width: 44, height: 44)
                    .overlay { RemoteImage(reference: line.photo) }
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(line.productTitle).font(.inter(14, .semibold)).foregroundStyle(Brand.ink).lineLimit(2)
                    if let variant = line.variantLabel {
                        Text(variant).font(.inter(13)).foregroundStyle(Brand.muted)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(minHeight: 56)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(on ? Brand.navy : Brand.cardLine, lineWidth: 1))
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }
}

// MARK: Modify order

/// "Modify order" — lower a quantity or take an item out before a driver has
/// it (on the owner's word). Nothing changes until the shopper has seen what
/// it costs: "Review the change" asks for a quote, and "Confirm" sends the
/// change with the figure it showed — refused if that figure has moved, and
/// then asked again rather than applied at a price nobody saw. Raising a
/// quantity is a new order at today's price (the owner's choice).
struct OrderModifySheet: View {
    let reference: String
    let detail: OrderDetail
    let done: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var wanted: [Int: Int] = [:]
    @State private var quote: ChangeQuote?
    @State private var asking = false
    @State private var applying = false

    private var lines: [OrderLine] { detail.changeableLines }

    private var changes: [API.LineChange] {
        lines.compactMap { line in
            guard let quantity = wanted[line.id], quantity != line.quantity else { return nil }
            return API.LineChange(lineId: line.id, quantity: quantity)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(l.t("orders.modifyNote"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(lines) { line in
                        row(line)
                    }
                    if let quote {
                        quoteCard(quote)
                    } else if changes.isEmpty {
                        Text(l.t("orders.modifyNothingYet")).font(.inter(13)).foregroundStyle(Brand.muted)
                    }
                    if let quote {
                        Button {
                            Task { await apply(quote) }
                        } label: {
                            HStack(spacing: 8) {
                                if applying { ProgressView().tint(.white) }
                                Text(l.t("orders.changeConfirm"))
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(applying)
                    } else {
                        Button {
                            Task { await review() }
                        } label: {
                            HStack(spacing: 8) {
                                if asking { ProgressView().tint(.white) }
                                Text(l.t("orders.changeReview"))
                            }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(changes.isEmpty || asking)
                    }
                    Button(l.t("orders.keepOrder")) { dismiss() }
                        .buttonStyle(SecondaryButtonStyle())
                }
                .padding(16)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("orders.modify"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func row(_ line: OrderLine) -> some View {
        let now = wanted[line.id] ?? line.quantity
        return HStack(spacing: 12) {
            Color.clear
                .frame(width: 48, height: 48)
                .overlay { RemoteImage(reference: line.photo) }
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(line.productTitle).font(.inter(14, .semibold)).foregroundStyle(Brand.ink).lineLimit(2)
                Text(now == 0 ? l.t("orders.modifyRemoving") : l.t("orders.modifyOrdered", ["count": "\(line.quantity)"]))
                    .font(.inter(12))
                    .foregroundStyle(now == 0 ? Brand.danger : Brand.muted)
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                stepButton(symbol: now == 1 ? "trash" : "minus", label: l.t(now == 1 ? "orders.modifyRemove" : "orders.modifyLess"), enabled: now > 0) {
                    set(line.id, max(0, now - 1))
                }
                Text("\(now)")
                    .font(.inter(16, .heavy))
                    .monospacedDigit()
                    .foregroundStyle(Brand.navy)
                    .frame(minWidth: 26)
                stepButton(symbol: "plus", label: l.t("orders.modifyMore"), enabled: now < line.quantity) {
                    set(line.id, min(line.quantity, now + 1))
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("orders.modifyQuantity", ["item": line.productTitle]))
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    private func stepButton(symbol: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color.white))
                .overlay(Circle().strokeBorder(Brand.line, lineWidth: 1))
                .contentShape(Circle())
        }
        .buttonStyle(.action)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityLabel(label)
    }

    private func set(_ id: Int, _ quantity: Int) {
        quote = nil
        wanted[id] = quantity
    }

    private func quoteCard(_ quote: ChangeQuote) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("orders.quoteTitle")).font(.inter(15, .heavy)).foregroundStyle(Brand.navy)
            ForEach(quote.lines, id: \.lineId) { line in
                let title = detail.lines.first { $0.id == line.lineId }?.productTitle ?? ""
                Text("\(title): " + (line.to == 0 ? l.t("orders.quoteRemoved") : l.t("orders.quoteFromTo", ["from": "\(line.from)", "to": "\(line.to)"])))
            }
            ForEach(Array(quote.addedFees.enumerated()), id: \.offset) { _, fee in
                Text(fee.waived
                    ? l.t("orders.quoteFeeWaived", ["store": "\u{2068}\(fee.vendorName)\u{2069}"])
                    : l.t("orders.quoteFee", ["store": "\u{2068}\(fee.vendorName)\u{2069}", "fee": fee.fee.formatted(l.current)]))
            }
            if quote.codeLost {
                Text(l.t("orders.quoteCodeLost", ["amount": quote.discountBefore.formatted(l.current)]))
            } else if quote.discountAfter != quote.discountBefore {
                Text(l.t("orders.quoteCodeLess", ["amount": quote.discountAfter.formatted(l.current)]))
            }
            if quote.giftCardBack.fils > 0 {
                Text(l.t("orders.quoteGiftBack", ["amount": quote.giftCardBack.formatted(l.current)]))
            }
            if quote.pointsBack.fils > 0 {
                Text(l.t("orders.quotePointsBack", ["points": PointsFormat.count(quote.pointsBackCount, l.current)]))
            }
            HStack(spacing: 8) {
                Text(l.t("orders.quoteOwed")).font(.inter(15, .heavy)).foregroundStyle(Brand.navy)
                Text(quote.owedBefore.formatted(l.current))
                    .font(.inter(14))
                    .strikethrough()
                    .foregroundStyle(Brand.muted)
                Image(systemName: "arrow.forward").font(.system(size: 13, weight: .bold)).foregroundStyle(Brand.navy).accessibilityHidden(true)
                Text(quote.owedAfter.formatted(l.current)).font(.inter(15, .heavy)).foregroundStyle(Brand.navy)
            }
            .padding(.top, 4)
            Text(l.t("orders.quoteStock")).font(.inter(12)).foregroundStyle(Brand.muted)
        }
        .font(.inter(13))
        .foregroundStyle(Brand.ink)
        .fixedSize(horizontal: false, vertical: true)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.tint))
        .accessibilityElement(children: .combine)
    }

    private func review() async {
        guard !changes.isEmpty else { return }
        asking = true
        defer { asking = false }
        do {
            quote = try await app.services.api.call(API.changeQuote, .init(reference: reference, changes: changes))
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            if failure != .cancelled { app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has))) }
        }
    }

    private func apply(_ shown: ChangeQuote) async {
        applying = true
        defer { applying = false }
        do {
            _ = try await app.services.api.call(API.changeOrder, .init(reference: reference, changes: changes, expectOwed: shown.owedAfter.amount))
            Haptics.succeeded()
            app.toast(l.t("orders.changeDone"))
            done()
            dismiss()
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            guard failure != .cancelled else { return }
            app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has)))
            // The figure moved under the shopper: ask again, never apply at a price nobody saw.
            if failure.serverMessage == "orders.changeMoved" {
                quote = nil
                await review()
            }
        }
    }
}

// MARK: Change delivery address

/// "Change delivery address" — the order sent to another saved address while
/// nothing going there has left the stores. The choices are the address
/// book; what the driver collects is said back, since a store charges the
/// same anywhere in Kuwait.
struct OrderAddressSheet: View {
    let reference: String
    let detail: OrderDetail
    let done: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var addresses: [SavedAddress]?
    @State private var chosen: Int?
    @State private var moving = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    (Text(l.t("orders.addressNow") + " ") + Text(detail.order.addressLine ?? "—").bold())
                        .font(.inter(14))
                        .foregroundStyle(Brand.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let addresses {
                        if addresses.isEmpty {
                            Text(l.t("orders.addressNone")).font(.inter(14)).foregroundStyle(Brand.muted)
                        } else {
                            ForEach(addresses) { address in
                                choice(address)
                            }
                        }
                    } else {
                        ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 80)
                    }
                    Text(l.t("orders.addressFees"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Button {
                        Task { await move() }
                    } label: {
                        HStack(spacing: 8) {
                            if moving { ProgressView().tint(.white) }
                            Text(l.t("orders.addressSend"))
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(chosen == nil || moving)
                    Button(l.t("orders.addressAdd")) {
                        dismiss()
                        app.push(.addresses)
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .padding(16)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("orders.changeAddress"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task { addresses = (try? await app.services.account.addresses()) ?? [] }
    }

    private func choice(_ address: SavedAddress) -> some View {
        let on = chosen == address.id
        return Button {
            chosen = address.id
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: on ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(on ? Brand.navy : Brand.line)
                Image(systemName: "mappin").font(.system(size: 15)).foregroundStyle(Brand.muted).padding(.top, 3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(address.label).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    Text(address.line(l.current)).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(minHeight: 56)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(on ? Brand.navy : Brand.cardLine, lineWidth: 1))
        }
        .buttonStyle(.tap)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }

    private func move() async {
        guard let addressId = chosen else { return }
        moving = true
        defer { moving = false }
        do {
            let moved = try await app.services.api.call(API.changeOrderAddress, .init(reference: reference, addressId: addressId))
            Haptics.succeeded()
            app.toast(l.t("orders.addressDone", ["amount": moved.owed.formatted(l.current)]))
            done()
            dismiss()
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            if failure != .cancelled { app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has))) }
        }
    }
}

// MARK: Get help with this order

/// "Get help with this order" — NetLet AI answers first, from this order's
/// facts (`support.orderHelp`), and points at the buttons the shopper can
/// press themselves; it never claims to have done anything. A person is one
/// press away, always, and the next step when the model hands over, cannot
/// answer or is switched off: the conversation goes to NetLet's own support
/// with the order attached, where a person reads every message.
struct OrderHelpSheet: View {
    let reference: String
    /// What an answer's button opens — a panel on the order, or an act.
    let act: (String) -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var turns: [API.HelpTurn] = []
    /// Each assistant turn's buttons, by its place in `turns`.
    @State private var buttons: [Int: [String]] = [:]
    @State private var draft = ""
    @State private var problem: String?
    @State private var asking = false
    @State private var toPerson = false
    @State private var sentTo: Int?
    @State private var opening = false
    @State private var modelOff = false
    @FocusState private var boxFocused: Bool

    private var rules: Rules.AfterSales.Help { ReferenceData.shared.rules.afterSalesRules.help }

    var body: some View {
        NavigationStack {
            ScrollViewReader { reader in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(l.t(modelOff ? "orderHelp.notePerson" : "orderHelp.note"))
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        ForEach(Array(turns.enumerated()), id: \.offset) { index, turn in
                            bubble(turn, index: index).id(index)
                        }
                        if asking {
                            HStack(spacing: 8) {
                                ProgressView().tint(Brand.navy)
                                Text(l.t("orderHelp.thinking")).font(.inter(13)).foregroundStyle(Brand.muted)
                            }
                            .id("thinking")
                        }
                        if turns.isEmpty && sentTo == nil {
                            FlowLayout(spacing: 8) {
                                ForEach(rules.starters, id: \.self) { key in
                                    Button(l.t(key)) { send(l.t(key)) }
                                        .buttonStyle(OrderActionStyle())
                                }
                            }
                        }
                        if let sentTo {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(l.t("orderHelp.personWill")).font(.inter(14)).foregroundStyle(Brand.success)
                                Button(l.t("orderHelp.followThere")) {
                                    dismiss()
                                    app.push(.supportThread(id: sentTo))
                                }
                                .buttonStyle(SecondaryButtonStyle())
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.successFill))
                        } else {
                            composer
                            if toPerson || turns.contains(where: { $0.role == "assistant" }) {
                                personCard
                            }
                        }
                    }
                    .padding(16)
                }
                .onChange(of: turns.count) { _, count in
                    withAnimation { reader.scrollTo(count - 1, anchor: .bottom) }
                }
            }
            .background(Brand.ground)
            .navigationTitle(l.t("orders.getHelp"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .task {
            if let available = try? await app.services.api.call(API.orderHelpAvailable) { modelOff = !available }
        }
    }

    private func bubble(_ turn: API.HelpTurn, index: Int) -> some View {
        let mine = turn.role == "shopper"
        return HStack {
            if mine { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 6) {
                if !mine {
                    Label(l.t("orderHelp.fromModel"), systemImage: "sparkles")
                        .font(.inter(11, .bold))
                        .foregroundStyle(Brand.muted)
                }
                Text(turn.text)
                    .font(.inter(14))
                    .foregroundStyle(mine ? Color.white : Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if let actions = buttons[index], !actions.isEmpty {
                    FlowLayout(spacing: 6) {
                        ForEach(actions, id: \.self) { action in
                            Button(l.t(Self.label(action))) {
                                dismiss()
                                act(action)
                            }
                            .buttonStyle(OrderActionStyle())
                        }
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(mine ? Brand.navy : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(mine ? Color.clear : Brand.cardLine, lineWidth: 1))
            if !mine { Spacer(minLength: 40) }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                TextField(l.t("orderHelp.ask"), text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.inter(16))
                    .focused($boxFocused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(problem == nil ? Brand.line : Brand.danger, lineWidth: 1))
                    .onChange(of: draft) { _, _ in problem = nil }
                    .accessibilityLabel(l.t("orderHelp.ask"))
                Button {
                    send(draft)
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Brand.navy))
                        .flipsForRightToLeftLayoutDirection(true)
                }
                .buttonStyle(.action)
                .disabled(asking)
                .accessibilityLabel(l.t("orderHelp.send"))
            }
            if let problem {
                Text(l.t(problem)).font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
            }
        }
    }

    private var personCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t(toPerson ? "orderHelp.personNext" : "orderHelp.personAlways"))
                .font(.inter(13))
                .foregroundStyle(Brand.ink)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await handOver() }
            } label: {
                HStack(spacing: 8) {
                    if opening { ProgressView().tint(.white) } else { Image(systemName: "person.fill") }
                    Text(l.t("orderHelp.toPerson"))
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(opening || (turns.isEmpty && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(toPerson ? Brand.accentWash : Brand.tint))
    }

    /// `orderHelpProblem`: something to ask, short enough, and no contact details.
    private func issue(_ words: String) -> String? {
        if words.isEmpty { return "orderHelp.empty" }
        if words.count > rules.maxQuestion { return "orderHelp.tooLong" }
        if !ContactFilter.findings(words).isEmpty { return "orderHelp.contact" }
        return nil
    }

    private func send(_ text: String) {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let found = issue(words) {
            Haptics.refused()
            problem = found
            boxFocused = true
            return
        }
        problem = nil
        turns.append(API.HelpTurn(role: "shopper", text: words))
        draft = ""
        if modelOff {
            toPerson = true
            return
        }
        Task { await ask() }
    }

    private func ask() async {
        asking = true
        defer { asking = false }
        let sent = Array(turns.suffix(rules.turns))
        do {
            let answer = try await app.services.api.call(API.orderHelp, .init(reference: reference, locale: l.current.rawValue, turns: sent))
            switch answer.kind {
            case "answer":
                turns.append(API.HelpTurn(role: "assistant", text: answer.text ?? ""))
                buttons[turns.count - 1] = answer.actions ?? []
                if answer.person == true { toPerson = true }
            case "refused":
                problem = answer.reason ?? "orderHelp.contact"
            case "tooMany":
                problem = "orderHelp.tooMany"
                toPerson = true
            default:
                // No model, or no answer: straight to a person.
                toPerson = true
            }
        } catch {
            let failure = APIError.from(error)
            guard failure != .cancelled else { return }
            problem = failure.messageKey(knownKey: Phrasebook.shared.has)
            toPerson = true
        }
    }

    /// What a person reads: the shopper's questions and what NetLet AI said.
    private var transcript: String {
        let lines = turns.map { "\($0.role == "shopper" ? "Me" : "NetLet AI"): \($0.text)" }.joined(separator: "\n")
        let text = lines.isEmpty ? draft.trimmingCharacters(in: .whitespacesAndNewlines) : lines
        return String(text.suffix(1800))
    }

    private func handOver() async {
        opening = true
        defer { opening = false }
        do {
            let opened = try await app.services.api.call(API.openSupport, .init(topic: "order", orderReference: reference, body: transcript))
            Haptics.succeeded()
            app.toast(l.t("orderHelp.sentToPerson"))
            sentTo = opened.id
        } catch {
            Haptics.refused()
            let failure = APIError.from(error)
            if failure != .cancelled { app.toast(l.t(failure.messageKey(knownKey: Phrasebook.shared.has))) }
        }
    }

    /// What each button an answer offers is called, in the page's words.
    static func label(_ action: String) -> String {
        switch action {
        case "track": return "orders.track"
        case "refund": return "orders.requestRefund"
        case "warranty": return "warranty.title"
        case "cancel": return "orders.cancelOrder"
        case "modify": return "orders.modify"
        case "address": return "orders.changeAddress"
        case "buyAgain": return "orders.buyAgain"
        default: return "orders.rateItems"
        }
    }
}
