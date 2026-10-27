import SwiftUI

/// The prices the shopper asked sellers for — the web's `AccountOffers`: each
/// product, what was asked, what the seller answered and how long an agreed
/// price stays good. A price still spendable is never described as gone.
struct PriceRequestsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.priceRequests) } }) { requests in
            ShopPage(header: false, footer: false, refresh: { await requests.load() }) {
                AccountSection(title: l.t("offers.mine"), hint: l.t("account.hint.offers")) {
                    LoadStateView(state: requests.state, retry: { await requests.load() }) { rows in
                        if rows.isEmpty {
                            Text(l.t("offers.mineEmpty"))
                                .font(.inter(14))
                                .foregroundStyle(Brand.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .card()
                        } else {
                            VStack(spacing: 10) {
                                ForEach(rows) { row in card(row) }
                            }
                        }
                    }
                }
            }
            .task { await requests.load() }
        }
    }

    private func card(_ row: PriceRequest) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                if let handle = row.productHandle {
                    Button { app.push(.product(handle: handle)) } label: {
                        Text(row.productTitle).font(.inter(15, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.tap)
                } else {
                    Text(row.productTitle).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                }
                Spacer(minLength: 8)
                Text(state(row))
                    .font(.inter(12, .bold))
                    .foregroundStyle(row.state == "offered" ? Brand.success : Brand.navy)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(row.state == "offered" ? Brand.successFill : Brand.tint))
                    .multilineTextAlignment(.trailing)
            }
            if let variant = row.variantLabel {
                Text(variant).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            Text(note(row))
                .font(.inter(13))
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
            if let said = row.vendorNote, !said.isEmpty {
                Text(l.t("offers.sellerSaid", ["note": said]))
                    .font(.inter(13))
                    .italic()
                    .foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func state(_ row: PriceRequest) -> String {
        if row.state == "offered", let price = row.offeredPrice {
            return l.t("offers.statusOffered", ["price": price.formatted(l.current)])
        }
        switch row.state {
        case "declined": return l.t("offers.statusDeclined")
        case "expired": return l.t("offers.statusExpired")
        case "withdrawn": return l.t("offers.statusWithdrawn")
        case "used": return l.t("offers.statusUsed")
        default: return l.t("offers.statusPending")
        }
    }

    /// How long an agreed price stays good, or what was asked and until when
    /// the seller has to answer (`daysLeft`).
    private func note(_ row: PriceRequest) -> String {
        if row.state == "offered" {
            guard let expires = row.expiresAt, expires > Date() else { return l.t("offers.statusOfferedToday") }
            let left = max(1, Int(ceil(expires.timeIntervalSinceNow / 86_400)))
            return left <= 1 ? l.t("offers.statusOfferedToday") : l.t("offers.statusOfferedNote", ["days": "\(left)"])
        }
        return l.t("offers.statusPendingNote", [
            "price": row.askedPrice.formatted(l.current),
            "date": row.expiresAt.map { OrderWording.date($0, language: l.current) } ?? "—",
        ])
    }
}

/// The delivered lines the shopper can review — the web's `AccountReviews`:
/// write one, change it, or take it down after asking.
struct ReviewsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.reviewableLines) } }) { lines in
            ShopPage(header: false, footer: false, refresh: { await lines.load() }) {
                AccountSection(title: l.t("account.sectionReviews"), hint: l.t("account.hint.reviews")) {
                    LoadStateView(state: lines.state, retry: { await lines.load() }) { rows in
                        if rows.isEmpty {
                            EmptyStateView(systemImage: "shippingbox", title: l.t("review.nothingToReview"), note: l.t("review.nothingToReviewNote"))
                                .card(padding: 0)
                        } else {
                            VStack(spacing: 10) {
                                ForEach(rows) { line in ReviewableRow(line: line) { Task { await lines.load() } } }
                            }
                        }
                    }
                }
            }
            .task { await lines.load() }
        }
    }
}

private struct ReviewableRow: View {
    let line: ReviewableLine
    let changed: () -> Void
    @State private var open = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let canWrite = line.eligibility.allowed
        let written = !canWrite && line.eligibility.reason == "alreadyReviewed"
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(line.productTitle).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                    Text("\u{2066}\(line.orderReference)\u{2069}").font(.inter(12)).foregroundStyle(Brand.muted)
                    if let rating = line.myRating { StarsView(rating: rating).padding(.top, 2) }
                }
                Spacer(minLength: 8)
                if canWrite || written {
                    Button(l.t(written ? "review.edit" : "review.write")) { open.toggle() }
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(Capsule().fill(Brand.tint))
                        .buttonStyle(.tap)
                } else if let reason = line.eligibility.reason {
                    Text(l.t("review.\(reason)"))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 150, alignment: .trailing)
                }
            }
            if open {
                ReviewForm(line: line, editing: written) {
                    open = false
                    changed()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

/// Five stars, the given number filled.
struct StarsView: View {
    let rating: Int
    var size: CGFloat = 13
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...ReferenceData.shared.rules.accountRules.ratingMax, id: \.self) { star in
                Image(systemName: star <= rating ? "star.fill" : "star")
                    .font(.system(size: size))
                    .foregroundStyle(star <= rating ? Brand.star : Brand.line)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rating == 1 ? l.t("review.starsOne") : l.t("review.stars", ["count": "\(rating)"]))
    }
}

private struct ReviewForm: View {
    let line: ReviewableLine
    let editing: Bool
    let done: () -> Void
    @State private var rating = 0
    @State private var title = ""
    @State private var reviewBody = ""
    @State private var confirming = false
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let rules = ReferenceData.shared.rules.accountRules
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("review.yourRating")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            HStack(spacing: 6) {
                ForEach(1...rules.ratingMax, id: \.self) { star in
                    Button {
                        rating = star
                    } label: {
                        Image(systemName: star <= rating ? "star.fill" : "star")
                            .font(.system(size: 26))
                            .foregroundStyle(star <= rating ? Brand.star : Brand.line)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(star == 1 ? l.t("review.starsOne") : l.t("review.stars", ["count": "\(star)"]))
                    .accessibilityAddTraits(rating == star ? .isSelected : [])
                }
            }
            LabeledField(label: l.t("review.titleLabel"), text: $title, placeholder: l.t("review.titlePlaceholder"))
            LabeledField(label: l.t("review.bodyLabel"), text: $reviewBody, placeholder: l.t("review.bodyPlaceholder"), axis: .vertical)
            HStack(spacing: 10) {
                Button(l.t("review.submit")) { Task { await submit() } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(sending || title.count > rules.maxReviewTitle || reviewBody.count > rules.maxReviewBody)
                if editing {
                    Button(role: .destructive) { confirming = true } label: {
                        Label(l.t("review.delete"), systemImage: "trash")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
        }
        .onAppear { rating = line.myRating ?? 0 }
        .confirmationDialog(l.t("review.deleteWarning", ["name": line.productTitle]), isPresented: $confirming, titleVisibility: .visible) {
            Button(l.t("review.delete"), role: .destructive) {
                guard let id = line.reviewId else { return }
                Task {
                    if await app.attempt(done: "review.deleted", { _ = try await app.services.api.call(API.removeReview, .init(reviewId: id)) }) { done() }
                }
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("review.deleteBody"))
        }
    }

    private func submit() async {
        guard rating > 0 else {
            Haptics.refused()
            app.toast(l.t("review.ratingRequired"))
            return
        }
        sending = true
        defer { sending = false }
        let heading = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let words = reviewBody.trimmingCharacters(in: .whitespacesAndNewlines)
        let worked: Bool
        if editing, let id = line.reviewId {
            worked = await app.attempt(done: "review.updated") {
                _ = try await app.services.api.call(API.editReview, .init(reviewId: id, rating: rating, title: heading.isEmpty ? nil : heading, body: words.isEmpty ? nil : words))
            }
        } else {
            worked = await app.attempt(done: "review.saved") {
                _ = try await app.services.api.call(API.writeReview, .init(orderItemId: line.orderItemId, rating: rating, title: heading.isEmpty ? nil : heading, body: words.isEmpty ? nil : words))
            }
        }
        if worked { done() }
    }
}
