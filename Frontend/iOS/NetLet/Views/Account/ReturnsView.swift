import SwiftUI

/// Every return the shopper has asked for, across their orders — the web's
/// `AccountReturns`, on the owner's word ("add returns option in the profile
/// page"). A return is started from its order; this is where somebody comes
/// back to ask where their refund is: the item as the order froze it, today's
/// photo to know it by, what was asked and where it has got to, and the way
/// to the order, where it can still be withdrawn.
struct ReturnsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.shopperReturns) } }) { returns in
            ShopPage(header: false, refresh: { await returns.load() }) {
                AccountSection(title: l.t("account.sectionReturns"), hint: l.t("account.hint.returns")) {
                    LoadStateView(state: returns.state, retry: { await returns.load() }) { rows in
                        if rows.isEmpty {
                            VStack(spacing: 12) {
                                EmptyStateView(
                                    systemImage: "arrow.uturn.backward",
                                    title: l.t("returns.mineEmpty"),
                                    note: l.t("returns.mineEmptyNote"),
                                    actionTitle: l.t("account.myOrders")
                                ) { app.push(.orders) }
                                .card(padding: 0)
                                policyLink
                            }
                        } else {
                            VStack(spacing: 12) {
                                VStack(spacing: 0) {
                                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                                        if index > 0 { DashedRule() }
                                        returnRow(row)
                                    }
                                }
                                .padding(.horizontal, 16)
                                .panel()
                                policyLink
                            }
                        }
                    }
                }
            }
            .task { await returns.load() }
        }
    }

    private var policyLink: some View {
        Button { app.push(.returnsPolicy) } label: {
            Text(l.t("returns.policyLink"))
                .font(.inter(14, .bold))
                .foregroundStyle(Brand.accentInk)
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
    }

    private func returnRow(_ row: ShopperReturn) -> some View {
        HStack(alignment: .top, spacing: 12) {
            RemoteImage(reference: row.photo, contentMode: .fit)
                .frame(width: 64, height: 64)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.photo))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.productTitle)
                        .font(.inter(15, .bold))
                        .foregroundStyle(Brand.navy)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(details(row))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                }
                Text(l.t(row.kind == "exchange" ? "returns.kindExchange" : "returns.kindRefund") + " · " + l.t(LineReturnPanel.statusKey(row.status)))
                    .font(.inter(13, .bold))
                    .foregroundStyle(tone(row.status).ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(tone(row.status).fill))
                    .fixedSize(horizontal: false, vertical: true)
                if let next = next(row) {
                    Text(next)
                        .font(.inter(13))
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(l.t("returns.askedOn", ["date": OrderWording.date(row.createdAt, language: l.current)]))
                    .font(.inter(12.5))
                    .foregroundStyle(Brand.muted)
                Button { app.push(.order(reference: row.orderReference)) } label: {
                    HStack(spacing: 4) {
                        Text(l.t("returns.viewOrder"))
                        Text(verbatim: row.orderReference).environment(\.layoutDirection, .leftToRight)
                    }
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.accentInk)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.tap)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 14)
    }

    private func details(_ row: ShopperReturn) -> String {
        let quantity = l.t("cart.quantityShort", ["count": "\(row.quantity)"])
        if let variant = row.variantTitle, !variant.isEmpty, variant != "Default" { return "\(variant) · \(quantity)" }
        return quantity
    }

    /// The opened order's own words for what happens next.
    private func next(_ row: ShopperReturn) -> String? {
        var parts: [String] = []
        switch row.status {
        case "approved": parts.append(l.t("returns.nextApproved"))
        case "requested": parts.append(l.t("returns.nextRequested"))
        case "review": parts.append(l.t("returns.nextReview"))
        case "collected": parts.append(l.t("returns.nextCollected"))
        case "refunded":
            let amount = (row.refundAmount ?? .zero).formatted(l.current)
            parts.append(l.t(row.refundPaidAt != nil ? "returns.refundPaid" : "returns.refundDue", ["amount": amount]))
        case "exchanged":
            if let replacement = row.replacementReference { parts.append(l.t("returns.replacementSent") + " " + replacement) }
        default: break
        }
        if let decline = row.declineReason, !decline.isEmpty {
            parts.append(Phrasebook.shared.has(decline) ? l.t(decline) : decline)
        }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    /// Green once the money or the swap is done, red if declined, navy while it moves.
    private func tone(_ status: String) -> (ink: Color, fill: Color) {
        switch status {
        case "refunded", "exchanged": return (Brand.success, Brand.successFill)
        case "declined": return (Brand.danger, Brand.danger.opacity(0.08))
        case "cancelled": return (Brand.body, Brand.photo)
        default: return (Brand.navy, Brand.tint)
        }
    }
}
