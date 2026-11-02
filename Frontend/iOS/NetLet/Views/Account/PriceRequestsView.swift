import SwiftUI

/// The prices the shopper asked sellers for — the web's `AccountOffers`: each
/// product, what was asked, what the seller answered and how long an agreed
/// price stays good. A price still spendable is never described as gone.
struct PriceRequestsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.priceRequests) } }) { requests in
            ShopPage(header: false, refresh: { await requests.load() }) {
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
/// write one, change it, or take it down after asking, in `ReviewSheet`, the
/// sheet an order's "Rate this item" opens too. A review already written says
/// where it stands: on the product page, waiting for its check, or taken down.
struct ReviewsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var writing: ReviewTarget?

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.reviewableLines) } }) { lines in
            ShopPage(header: false, refresh: { await lines.load() }) {
                AccountSection(title: l.t("account.sectionReviews"), hint: l.t("account.hint.reviews")) {
                    LoadStateView(state: lines.state, retry: { await lines.load() }) { rows in
                        if rows.isEmpty {
                            EmptyStateView(systemImage: "shippingbox", title: l.t("review.nothingToReview"), note: l.t("review.nothingToReviewNote"))
                                .card(padding: 0)
                        } else {
                            VStack(spacing: 10) {
                                ForEach(rows) { line in
                                    ReviewableRow(line: line) {
                                        writing = ReviewTarget(orderItemId: line.orderItemId, productTitle: line.productTitle, review: line.review)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .task { await lines.load() }
            .sheet(item: $writing) { target in
                ReviewSheet(target: target) { Task { await lines.load() } }
            }
        }
    }
}

private struct ReviewableRow: View {
    let line: ReviewableLine
    let open: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let canWrite = line.eligibility.allowed
        let written = line.review != nil || line.eligibility.reason == "alreadyReviewed"
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text(line.productTitle).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                Text("\u{2066}\(line.orderReference)\u{2069}").font(.inter(12)).foregroundStyle(Brand.muted)
                if let rating = line.review?.rating ?? line.myRating {
                    HStack(spacing: 8) {
                        StarsView(rating: rating)
                        if let state = line.review?.state { ReviewStatePill(state: state) }
                    }
                    .padding(.top, 4)
                }
            }
            Spacer(minLength: 8)
            if canWrite || written {
                Button(l.t(written ? "review.edit" : "review.write")) { open() }
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

