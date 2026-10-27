import MapKit
import SwiftUI

/// The web's pills on an order: a soft fill and its own darker ink, one pair
/// per state (`FULFILMENT` in `AccountOrders.tsx`).
enum OrderTone {
    case waiting, preparing, shipped, done, stopped, over

    static func line(_ fulfilment: String) -> OrderTone {
        switch fulfilment {
        case "preparing": return .preparing
        case "shipped": return .shipped
        case "delivered": return .done
        case "cancelled": return .stopped
        case "returned": return .over
        default: return .waiting
        }
    }

    var fill: Color {
        switch self {
        case .waiting, .over: return Color(red: 231 / 255, green: 237 / 255, blue: 245 / 255)
        case .preparing: return Color(red: 255 / 255, green: 240 / 255, blue: 171 / 255)
        case .shipped: return Color(red: 219 / 255, green: 231 / 255, blue: 251 / 255)
        case .done: return Color(red: 216 / 255, green: 234 / 255, blue: 216 / 255)
        case .stopped: return Color(red: 253 / 255, green: 236 / 255, blue: 235 / 255)
        }
    }

    var ink: Color {
        switch self {
        case .waiting, .over: return Brand.muted
        case .preparing: return Color(red: 112 / 255, green: 85 / 255, blue: 35 / 255)
        case .shipped: return Color(red: 39 / 255, green: 75 / 255, blue: 134 / 255)
        case .done: return Brand.success
        case .stopped: return Brand.danger
        }
    }
}

struct StatusPill: View {
    let label: String
    let tone: OrderTone
    var systemImage: String?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 11, weight: .semibold)).accessibilityHidden(true) }
            Text(label)
        }
        .font(.inter(12, .semibold))
        .foregroundStyle(tone.ink)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(Capsule().fill(tone.fill))
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// A line's return: where one stands, the way to ask for one, and the form —
/// the web's `LineReturn`. Most requests decide themselves, so the reply is
/// said at once.
struct LineReturnPanel: View {
    let reference: String
    let line: OrderLine
    let detail: OrderDetail
    let reload: () async -> Void
    @State private var open = false
    @State private var kind = "refund"
    @State private var reason = "damaged"
    @State private var note = ""
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: Rules.Orders { ReferenceData.shared.rules.orderRules }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let latest = detail.latestReturn(for: line), latest.status != "cancelled" {
                status(latest)
            }
            if app.features.isOn("returns") && detail.mayAskReturn(for: line) {
                if open { form } else {
                    Button {
                        open = true
                    } label: {
                        Label(l.t("returns.start"), systemImage: "arrow.uturn.backward")
                            .font(.inter(13, .semibold))
                            .foregroundStyle(Brand.navy)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 36)
                            .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.3), lineWidth: 1))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.tap)
                }
            }
        }
    }

    private func status(_ request: ReturnRequest) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text(l.t(request.kind == "exchange" ? "returns.kindExchange" : "returns.kindRefund"))
                Text("·")
                Text(l.t(Self.statusKey(request.status)))
                if request.decidedBy == "auto" && request.status != "requested" {
                    Text("· " + l.t("returns.decidedAutomatically")).foregroundStyle(Brand.muted).fontWeight(.regular)
                }
            }
            .font(.inter(13, .semibold))
            .foregroundStyle(Brand.navy)
            Text(next(request))
                .font(.inter(13))
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
            if request.mayWithdraw {
                Button(l.t("returns.withdraw")) {
                    Task {
                        sending = true
                        defer { sending = false }
                        if await app.attempt(done: "returns.toastCancelled", { _ = try await app.services.api.call(API.cancelReturn, .init(requestId: request.id)) }) {
                            await reload()
                        }
                    }
                }
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.danger)
                .frame(minHeight: 36)
                .buttonStyle(.tap)
                .disabled(sending)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
    }

    private func next(_ request: ReturnRequest) -> String {
        var parts: [String] = []
        switch request.status {
        case "approved": parts.append(l.t("returns.nextApproved"))
        case "requested": parts.append(l.t("returns.nextRequested"))
        case "review": parts.append(l.t("returns.nextReview"))
        case "collected": parts.append(l.t("returns.nextCollected"))
        case "refunded":
            let amount = (request.refundAmount ?? .zero).formatted(l.current)
            parts.append(l.t(request.refundPaidAt != nil ? "returns.refundPaid" : "returns.refundDue", ["amount": amount]))
        case "exchanged":
            if let replacement = request.replacementReference { parts.append(l.t("returns.replacementSent") + " " + replacement) }
        default: break
        }
        if let decline = request.declineReason, !decline.isEmpty {
            parts.append(Phrasebook.shared.has(decline) ? l.t(decline) : decline)
        }
        parts.append(OrderWording.date(request.createdAt, language: l.current))
        return parts.joined(separator: " ")
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("returns.whatInstead")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            HStack(spacing: 8) {
                ForEach(rules.returnKinds, id: \.self) { option in
                    Button {
                        kind = option
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: kind == option ? "largecircle.fill.circle" : "circle")
                                .foregroundStyle(kind == option ? Brand.navy : Brand.chevron)
                            Text(l.t(option == "exchange" ? "returns.kindExchange" : "returns.kindRefund"))
                                .foregroundStyle(Brand.ink)
                        }
                        .font(.inter(14, .medium))
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(kind == option ? Brand.navy : Brand.line, lineWidth: 1))
                    }
                    .buttonStyle(.tap)
                    .accessibilityAddTraits(kind == option ? .isSelected : [])
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("returns.why")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                Menu {
                    ForEach(rules.returnReasons, id: \.self) { option in
                        Button {
                            Haptics.tap()
                            reason = option
                        } label: {
                            if reason == option { Label(l.t(Self.reasonKey(option)), systemImage: "checkmark") } else { Text(l.t(Self.reasonKey(option))) }
                        }
                    }
                } label: {
                    MenuField(text: l.t(Self.reasonKey(reason)), placeholder: l.t("returns.why"))
                }
            }
            LabeledField(
                label: l.t(reason == "other" ? "returns.noteRequired" : "returns.noteOptional"),
                text: $note,
                problem: note.count > rules.maxReturnNote ? l.t("ios.tooLong", ["max": "\(rules.maxReturnNote)"]) : nil,
                axis: .vertical
            )
            Text(l.t("returns.howItWorks"))
                .font(.inter(13))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button(l.t("returns.submit")) { Task { await submit() } }
                    .buttonStyle(CompactPrimaryStyle())
                    .disabled(sending || note.count > rules.maxReturnNote)
                Button(l.t("claims.cancel")) { open = false }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
    }

    private func submit() async {
        let words = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if reason == "other" && words.isEmpty {
            Haptics.refused()
            app.toast(l.t("returns.needsReason"))
            return
        }
        sending = true
        defer { sending = false }
        var answer = "requested"
        let worked = await app.attempt {
            answer = try await app.services.api.call(API.requestReturn, .init(
                reference: reference, orderItemId: line.id, kind: kind, reason: reason, note: words.isEmpty ? nil : words
            )).status
        }
        guard worked else { return }
        app.toast(l.t(answer == "approved" ? "returns.toastApproved" : answer == "declined" ? "returns.toastDeclined" : "returns.toastRequested"))
        open = false
        note = ""
        await reload()
    }

    static func reasonKey(_ reason: String) -> String {
        switch reason {
        case "damaged": return "returns.reasonDamaged"
        case "defective": return "returns.reasonDefective"
        case "wrongItem": return "returns.reasonWrongItem"
        case "notAsDescribed": return "returns.reasonNotAsDescribed"
        case "tooSmall": return "returns.reasonTooSmall"
        case "tooLarge": return "returns.reasonTooLarge"
        case "changedMind": return "returns.reasonChangedMind"
        default: return "returns.reasonOther"
        }
    }

    static func statusKey(_ status: String) -> String {
        switch status {
        case "review": return "returns.statusReview"
        case "approved": return "returns.statusApproved"
        case "declined": return "returns.statusDeclined"
        case "collected": return "returns.statusCollected"
        case "refunded": return "returns.statusRefunded"
        case "exchanged": return "returns.statusExchanged"
        case "cancelled": return "returns.statusCancelled"
        default: return "returns.statusRequested"
        }
    }
}

/// Each parcel once it is at the door: rate how it was delivered, report it
/// damaged — the web's `ParcelCare`. About the company that carried it,
/// never the goods.
struct ParcelCareSection: View {
    let reference: String
    let detail: OrderDetail
    let reload: () async -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let shown = detail.caredFor
        if !shown.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text(l.t("delivery.heading")).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                ForEach(shown) { parcel in
                    ParcelCard(reference: reference, parcel: parcel, reload: reload)
                    if parcel.id != shown.last?.id { Divider() }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }
}

/// A refusal from rating or claiming, said with the window it names.
@MainActor
func parcelRefusal(_ key: String, _ language: LanguageSettings) -> String {
    let rules = ReferenceData.shared.rules.orderRules
    let days = key.hasPrefix("claims.") ? rules.claimWindowDays : rules.ratingWindowDays
    return Phrasebook.shared.has(key) ? language.t(key, ["days": "\(days)"]) : key
}

private struct ParcelCard: View {
    let reference: String
    let parcel: Parcel
    let reload: () async -> Void
    @State private var reporting = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "truck.box").foregroundStyle(Brand.muted).accessibilityHidden(true)
                let vendor = parcel.vendorName ?? "—"
                Text(parcel.destinationLabel.map { l.t("delivery.parcelFromTo", ["vendor": vendor, "label": $0]) } ?? l.t("delivery.parcelFrom", ["vendor": vendor]))
                    .font(.inter(14, .semibold))
                    .foregroundStyle(Brand.ink)
                Spacer(minLength: 8)
                if let arrived = parcel.arrivedAt {
                    Text(l.t("delivery.arrivedOn", ["date": OrderWording.date(arrived, language: l.current)]))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                }
            }
            let ratingsOn = app.features.isOn("deliveryRatings")
            if ratingsOn || parcel.rating != nil {
                RateDelivery(reference: reference, parcel: parcel, readOnly: !ratingsOn, reload: reload)
            }
            if let claim = parcel.claim { ClaimStatus(claim: claim) }
            if app.features.isOn("damageClaims") {
                if reporting {
                    ReportDamage(reference: reference, parcel: parcel, done: { reporting = false }, reload: reload)
                } else if parcel.claimRefusal == nil {
                    Button {
                        reporting = true
                    } label: {
                        Label(l.t("claims.report"), systemImage: "exclamationmark.shield")
                            .font(.inter(13, .semibold))
                            .foregroundStyle(Brand.navy)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 36)
                            .overlay(Capsule().strokeBorder(Brand.navy.opacity(0.3), lineWidth: 1))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.tap)
                } else if let refusal = parcel.claimRefusal, refusal != "claims.alreadyOpen", refusal != "claims.alreadyPaid", parcel.arrivedAt != nil {
                    Text(parcelRefusal(refusal, l))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

private struct RateDelivery: View {
    let reference: String
    let parcel: Parcel
    let readOnly: Bool
    let reload: () async -> Void
    /// Three parts (3.4.4); a rating given before them opens with each at its one figure.
    @State private var parts: [String: Int] = [:]
    @State private var comment = ""
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var complete: Bool { DeliveryRatingParts.all.allSatisfy { (parts[$0] ?? 0) > 0 } }

    var body: some View {
        let state = parcel.ratingState
        let rules = ReferenceData.shared.rules
        if !state.allowed || readOnly {
            if let given = parcel.rating {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(l.t("delivery.yourRating")).font(.inter(13)).foregroundStyle(Brand.body)
                        StarsView(rating: given.rating, size: 13)
                            .accessibilityLabel(l.t("review.outOf", ["value": "\(given.rating)"]))
                    }
                    if let speed = given.speed, let condition = given.condition, let conduct = given.conduct {
                        let values = [speed, condition, conduct]
                        ForEach(0..<values.count, id: \.self) { index in
                            let part = DeliveryRatingParts.all[index]
                            let value = values[index]
                            HStack(spacing: 6) {
                                Text(l.t(DeliveryRatingParts.label(part))).font(.inter(12)).foregroundStyle(Brand.muted)
                                StarsView(rating: value, size: 11)
                                    .accessibilityLabel(l.t("review.outOf", ["value": "\(value)"]))
                            }
                        }
                    }
                }
            } else if !state.allowed, state.reason == "delivery.ratingClosed" {
                Text(parcelRefusal("delivery.ratingClosed", l)).font(.inter(13)).foregroundStyle(Brand.muted)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text(l.t("delivery.rateLegend")).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                Text(l.t("delivery.rateNote"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(DeliveryRatingParts.all, id: \.self) { part in
                    VStack(alignment: .leading, spacing: 0) {
                        Text(l.t(DeliveryRatingParts.label(part))).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                        HStack(spacing: 2) {
                            ForEach(1...rules.accountRules.ratingMax, id: \.self) { star in
                                let chosen = parts[part] ?? 0
                                Button {
                                    parts[part] = star
                                } label: {
                                    Image(systemName: star <= chosen ? "star.fill" : "star")
                                        .font(.system(size: 22))
                                        .foregroundStyle(star <= chosen ? Brand.star : Brand.line)
                                        .frame(width: 44, height: 40)
                                }
                                .buttonStyle(.tap)
                                .accessibilityLabel("\(l.t(DeliveryRatingParts.label(part))): \(star == 1 ? l.t("review.starsOne") : l.t("review.stars", ["count": "\(star)"]))")
                                .accessibilityAddTraits(chosen == star ? .isSelected : [])
                            }
                        }
                    }
                }
                if complete {
                    let overall = DeliveryRatingParts.overall(speed: parts["speed"] ?? 0, condition: parts["condition"] ?? 0, conduct: parts["conduct"] ?? 0)
                    HStack(spacing: 6) {
                        Text(l.t("delivery.overall")).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                        StarsView(rating: overall, size: 13)
                            .accessibilityLabel(l.t("review.outOf", ["value": "\(overall)"]))
                    }
                }
                LabeledField(
                    label: l.t("delivery.commentLabel"),
                    text: $comment,
                    placeholder: l.t("delivery.commentPlaceholder"),
                    problem: comment.count > rules.orderRules.maxDeliveryComment ? l.t("ios.tooLong", ["max": "\(rules.orderRules.maxDeliveryComment)"]) : nil
                )
                HStack(spacing: 10) {
                    Button(l.t("delivery.save")) { Task { await save() } }
                        .buttonStyle(CompactPrimaryStyle())
                        .disabled(sending || comment.count > rules.orderRules.maxDeliveryComment)
                    if parcel.rating != nil, let closes = state.closesAt {
                        Text(l.t("delivery.openUntil", ["date": OrderWording.date(closes, language: l.current)]))
                            .font(.inter(12))
                            .foregroundStyle(Brand.muted)
                    }
                }
            }
            .onAppear {
                if let given = parcel.rating {
                    parts = ["speed": given.speed ?? given.rating, "condition": given.condition ?? given.rating, "conduct": given.conduct ?? given.rating]
                }
                comment = parcel.rating?.comment ?? ""
            }
        }
    }

    private func save() async {
        guard complete else {
            Haptics.refused()
            app.toast(l.t("delivery.rateEveryPart"))
            return
        }
        sending = true
        defer { sending = false }
        let words = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        let days = ["days": "\(ReferenceData.shared.rules.orderRules.ratingWindowDays)"]
        if await app.attempt(done: "delivery.saved", params: days, {
            _ = try await app.services.api.call(API.rateDelivery, .init(reference: reference, parcelKey: parcel.key,
                                                                         speed: parts["speed"] ?? 0, condition: parts["condition"] ?? 0, conduct: parts["conduct"] ?? 0,
                                                                         comment: words.isEmpty ? nil : words))
        }) {
            await reload()
        }
    }
}

private struct ClaimStatus: View {
    let claim: Parcel.Claim
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let accepted = claim.status == "accepted"
        let rejected = claim.status == "rejected"
        VStack(alignment: .leading, spacing: 6) {
            StatusPill(
                label: accepted
                    ? l.t("claims.statusAccepted", ["amount": (claim.awardedAmount ?? claim.claimedAmount).formatted(l.current)])
                    : l.t(rejected ? "claims.statusRejected" : "claims.statusOpen"),
                tone: accepted ? .done : rejected ? .over : .preparing,
                systemImage: "exclamationmark.shield"
            )
            if let note = claim.decisionNote, !note.isEmpty {
                Text(note).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct ReportDamage: View {
    let reference: String
    let parcel: Parcel
    let done: () -> Void
    let reload: () async -> Void
    @State private var chosen: Set<Int> = []
    @State private var amount = ""
    @State private var description = ""
    @State private var evidence = ""
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let ceiling = parcel.ceiling(chosen)
        let rules = ReferenceData.shared.rules.orderRules
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("claims.reportHeading")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            Text(l.t("claims.reportNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            Text(l.t("claims.whichItems")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            VStack(spacing: 0) {
                ForEach(parcel.lines, id: \.lineId) { line in
                    Button {
                        if chosen.contains(line.lineId) { chosen.remove(line.lineId) } else { chosen.insert(line.lineId) }
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: chosen.contains(line.lineId) ? "checkmark.square.fill" : "square")
                                .font(.system(size: 20))
                                .foregroundStyle(chosen.contains(line.lineId) ? Brand.navy : Brand.chevron)
                            Text(line.productTitle).font(.inter(14)).foregroundStyle(Brand.ink).multilineTextAlignment(.leading)
                            Spacer(minLength: 8)
                            Text(line.lineTotal.formatted(l.current)).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                    .accessibilityAddTraits(chosen.contains(line.lineId) ? .isSelected : [])
                }
            }
            LabeledField(
                label: l.t("claims.amountLabel"),
                text: $amount,
                placeholder: ceiling.amount,
                hint: l.t("claims.amountHint", ["amount": ceiling.formatted(l.current)]),
                keyboard: .decimalPad,
                leftToRight: true
            )
            LabeledField(
                label: l.t("claims.descriptionLabel"),
                text: $description,
                problem: description.count > rules.maxClaimDescription ? l.t("ios.tooLong", ["max": "\(rules.maxClaimDescription)"]) : nil,
                axis: .vertical
            )
            LabeledField(label: l.t("claims.evidenceLabel"), text: $evidence, placeholder: "https://", keyboard: .URL, content: .URL, leftToRight: true)
            HStack(spacing: 10) {
                Button(l.t("claims.submit")) { Task { await submit(ceiling) } }
                    .buttonStyle(CompactPrimaryStyle())
                    .disabled(sending || chosen.isEmpty || description.count > rules.maxClaimDescription)
                Button(l.t("claims.cancel"), action: done)
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
        .onAppear { if parcel.lines.count == 1, let only = parcel.lines.first { chosen = [only.lineId] } }
    }

    private func submit(_ ceiling: Money) async {
        let words = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty else {
            Haptics.refused()
            app.toast(l.t("claims.needsDescription"))
            return
        }
        sending = true
        defer { sending = false }
        let typed = amount.trimmingCharacters(in: .whitespaces)
        let link = evidence.trimmingCharacters(in: .whitespaces)
        let days = ["days": "\(ReferenceData.shared.rules.orderRules.claimWindowDays)"]
        if await app.attempt(done: "claims.filed", params: days, {
            _ = try await app.services.api.call(API.claimDamage, .init(
                reference: reference,
                lineIds: parcel.lines.map(\.lineId).filter { chosen.contains($0) },
                amount: typed.isEmpty ? ceiling.amount : typed,
                description: words,
                evidenceUrl: link.isEmpty ? nil : link
            ))
        }) {
            done()
            await reload()
        }
    }
}

/// Where the parcels on the road are — the web's `TrackParcels`: which
/// company, a five-minute band from distance, and the driver on a map while
/// they choose to share it. Asked again every twenty seconds while shown.
struct TrackingPanel: View {
    let reference: String
    @State private var parcels: [TrackedParcel] = []
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(parcels.enumerated()), id: \.offset) { _, parcel in
                card(parcel)
            }
        }
        .task {
            while !Task.isCancelled {
                if let found = try? await app.services.api.call(API.tracking, .init(reference: reference)) { parcels = found }
                try? await Task.sleep(for: .seconds(20))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("tracking.title"))
    }

    private func card(_ parcel: TrackedParcel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(l.t("tracking.onTheWay", ["courier": parcel.courierName.isEmpty ? l.t("tracking.theDriver") : parcel.courierName]), systemImage: "truck.box.fill")
                .font(.inter(15, .bold))
                .foregroundStyle(Brand.navy)
            Text(([parcel.sellers.joined(separator: " · ")] + [parcel.doorLabel].compactMap { $0 }).joined(separator: " · "))
                .font(.inter(13))
                .foregroundStyle(Brand.muted)
            if let driver = parcel.driver {
                Text(eta(parcel))
                    .font(.inter(15, .semibold))
                    .foregroundStyle(Brand.ink)
                    .accessibilityAddTraits(.updatesFrequently)
                Text(updated(parcel))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                TrackMap(driver: driver, door: parcel.door)
                    .frame(height: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityLabel(l.t("tracking.mapLabel"))
            } else {
                Text(l.t("tracking.notSharing"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func eta(_ parcel: TrackedParcel) -> String {
        guard let eta = parcel.eta else { return l.t("tracking.noPin") }
        if eta.kind == "arriving" { return l.t("tracking.arriving") }
        return l.t("tracking.band", ["low": "\(eta.low ?? 0)", "high": "\(eta.high ?? 0)"])
    }

    private func updated(_ parcel: TrackedParcel) -> String {
        let minutes = parcel.recordedAt.map { max(0, Int((Date().timeIntervalSince($0) / 60).rounded())) }
        let line = (minutes ?? 0) < 1 && minutes != nil ? l.t("tracking.updatedNow") : l.t("tracking.updated", ["minutes": "\(minutes ?? 0)"])
        guard let eta = parcel.eta, eta.kind == "band" else { return line }
        return line + " · " + l.t(eta.source == "traffic" ? "tracking.estimateTraffic" : "tracking.estimate")
    }
}

/// The driver and the door on one map, framed to show both.
private struct TrackMap: View {
    let driver: Pin
    let door: Pin?

    var body: some View {
        Map(initialPosition: .automatic, interactionModes: [.pan, .zoom]) {
            Annotation("", coordinate: CLLocationCoordinate2D(latitude: driver.lat, longitude: driver.lng)) {
                Image(systemName: "truck.box.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Brand.navy))
                    .overlay(Circle().strokeBorder(.white, lineWidth: 2))
            }
            if let door {
                Annotation("", coordinate: CLLocationCoordinate2D(latitude: door.lat, longitude: door.lng)) {
                    Image(systemName: "house.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Brand.orange))
                        .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                }
            }
        }
        // A picture of the ground: never mirrored on the Arabic page.
        .environment(\.layoutDirection, .leftToRight)
    }
}

/// The order's invoice and any credit notes, each opening the document.
struct OrderDocumentsList: View {
    let documents: [OrderDocument]
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if !documents.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(l.t("invoice.documents")).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                ForEach(documents) { document in
                    Button {
                        app.open(.invoice(number: document.number))
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "doc.text").foregroundStyle(Brand.navy)
                            Text(l.t(document.isCredit ? "invoice.creditNoteNumber" : "invoice.invoiceNumber", ["number": document.number]))
                                .font(.inter(14, .semibold))
                                .foregroundStyle(Brand.navy)
                            Spacer()
                            Image(systemName: "chevron.forward").font(.footnote).foregroundStyle(Brand.chevron).flipsForRightToLeftLayoutDirection(true)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }
}
