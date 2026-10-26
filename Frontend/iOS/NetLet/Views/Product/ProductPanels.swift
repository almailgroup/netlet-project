import SwiftUI

// The product page's panels beyond the buy box, each the web's component of
// the same name in `components/product/`.

/// The optional extras a seller offers with the product — the web's `AddonPicker`.
struct AddonPicker: View {
    let addons: [ProductAddon]
    @Binding var chosen: Set<String>
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if !addons.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(l.t("product.addons")).font(.inter(14, .semibold)).foregroundStyle(Brand.muted)
                ForEach(addons) { addon in
                    Button {
                        if chosen.contains(addon.id) { chosen.remove(addon.id) } else { chosen.insert(addon.id) }
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: chosen.contains(addon.id) ? "checkmark.square.fill" : "square")
                                .font(.system(size: 20))
                                .foregroundStyle(Brand.navy)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(addon.label).font(.inter(14, .semibold)).foregroundStyle(Brand.ink).multilineTextAlignment(.leading)
                                Text(l.t(addon.kind == "installation" ? "product.addonInstallation" : addon.kind == "warranty" ? "product.addonWarranty" : "product.addonOther"))
                                    .font(.inter(12))
                                    .foregroundStyle(Brand.muted)
                            }
                            Spacer(minLength: 8)
                            Text(l.t("product.addonPerUnit", ["price": addon.price.formatted(l.current)]))
                                .font(.inter(13, .bold))
                                .foregroundStyle(Brand.navy)
                        }
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(chosen.contains(addon.id) ? Brand.tint : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                    .accessibilityAddTraits(chosen.contains(addon.id) ? .isSelected : [])
                }
            }
        }
    }
}

// MARK: - Size guide

/// The size guide's button and its sheet — the web's `SizeGuide`: the chart,
/// how the product's returned sizes lean, and "find my size" worked out on
/// the phone, with the numbers remembered here only when asked.
struct SizeGuideButton: View {
    let product: Product
    let chart: SizeChart
    let choose: (String) -> Void
    @State private var open = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button {
            open = true
        } label: {
            Label(l.t("sizeGuide.open"), systemImage: "ruler")
                .font(.inter(13, .bold))
                .foregroundStyle(Brand.navy)
                .underline()
                .frame(minHeight: 44)
        }
        .buttonStyle(.tap)
        .sheet(isPresented: $open) {
            SizeGuideSheet(product: product, chart: chart) { size in
                choose(size)
                open = false
            }
            .environment(\.layoutDirection, l.layoutDirection)
            .presentationDetents([.large])
        }
    }
}

private struct SizeGuideSheet: View {
    let product: Product
    let chart: SizeChart
    let choose: (String) -> Void
    @State private var values: [String: String] = [:]
    @State private var remember = false
    @State private var answer: SizeAnswer?
    @State private var fit: FitFeedback?
    @State private var past: [PastSizeLine] = []
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    private static let storeKey = "netlet.measurements"

    private var available: [String] {
        let sizes = product.variants.filter(\.availableForSale).compactMap { $0.value(of: chart.axis) }
        return sizes.isEmpty ? product.variants.filter(\.availableForSale).map(\.title) : sizes
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    table
                    if let fit, let tendency = fit.tendency {
                        Text(l.t(tendency == "runsSmall" ? "sizeGuide.runsSmall" : "sizeGuide.runsLarge", [
                            "count": "\(tendency == "runsSmall" ? fit.tooSmall : fit.tooLarge)",
                            "total": "\(fit.tooSmall + fit.tooLarge)",
                        ]))
                        .font(.inter(13, .semibold))
                        .foregroundStyle(Brand.accentInk)
                    }
                    if let suggestion = chart.fromPurchases(past) { purchases(suggestion) }
                    VStack(alignment: .leading, spacing: 10) {
                        Text(l.t("sizeGuide.findMine")).font(.inter(16, .heavy)).foregroundStyle(Brand.navy)
                        Text(l.t("sizeGuide.private")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                        ForEach(chart.measures, id: \.self) { measure in
                            LabeledField(
                                label: l.t("sizeGuide.yourMeasure", ["measure": l.t(SizeGuideSheet.label(measure))]),
                                text: Binding(get: { values[measure] ?? "" }, set: { values[measure] = $0.filter { $0.isNumber || $0 == "." } }),
                                keyboard: .decimalPad,
                                leftToRight: true
                            )
                        }
                        Toggle(isOn: $remember) { Text(l.t("sizeGuide.remember")).font(.inter(13)) }.tint(Brand.navy)
                        Button(l.t("sizeGuide.find")) { find() }.buttonStyle(PrimaryButtonStyle())
                    }
                    .card()
                    if let answer { result(answer) }
                }
                .padding(16)
            }
            .background(Brand.ground.ignoresSafeArea())
            .navigationTitle(l.t("sizeGuide.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(l.t("sizeGuide.close")) { dismiss() } }
            }
        }
        .task {
            if let data = UserDefaults.standard.data(forKey: Self.storeKey),
               let stored = try? JSONDecoder().decode([String: String].self, from: data), !stored.isEmpty {
                values = stored
                remember = true
            }
            fit = try? await app.services.api.call(API.fit, .init(productId: product.id))
            // The shopper's own past lines in this department (3.1.20: "based
            // on their past purchases"), read for them alone and weighed here.
            if app.session.isSignedIn {
                past = (try? await app.services.api.call(API.mySizes, .init(productId: product.id))) ?? []
            }
        }
    }

    private var table: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 10) {
                GridRow {
                    Text(chart.axis).font(.inter(13, .bold))
                    ForEach(chart.measures, id: \.self) { measure in
                        Text(l.t(SizeGuideSheet.label(measure))).font(.inter(13, .bold))
                    }
                }
                .foregroundStyle(Brand.navy)
                Divider()
                ForEach(chart.rows, id: \.size) { row in
                    GridRow {
                        Text(row.size).font(.inter(13, .bold)).foregroundStyle(answer?.size == row.size ? Brand.success : Brand.ink)
                        ForEach(chart.measures, id: \.self) { measure in
                            Text(row.range(measure).map { "\u{2066}\(SizeGuideSheet.number($0.low))–\(SizeGuideSheet.number($0.high))\u{2069}" } ?? "—")
                                .font(.inter(13))
                                .foregroundStyle(Brand.body)
                        }
                    }
                }
            }
            .padding(14)
        }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .accessibilityLabel(l.t("sizeGuide.chartLabel"))
    }

    /// What the shopper's own orders say, with the counts behind it, and
    /// the size to choose when it is on sale.
    private func purchases(_ suggestion: PurchaseSuggestion) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("sizeGuide.fromPurchasesTitle")).font(.inter(14, .heavy)).foregroundStyle(Brand.navy)
            Text(l.t("sizeGuide.fromPurchases", ["size": suggestion.size])).font(.inter(13)).foregroundStyle(Brand.navy)
                .fixedSize(horizontal: false, vertical: true)
            Text(l.t("sizeGuide.fromPurchasesBasis", ["kept": "\(suggestion.kept)", "tooSmall": "\(suggestion.tooSmall)", "tooLarge": "\(suggestion.tooLarge)"]))
                .font(.inter(12)).foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            if available.contains(where: { $0.caseInsensitiveCompare(suggestion.size) == .orderedSame }) {
                Button(l.t("sizeGuide.choose", ["size": suggestion.size])) { choose(suggestion.size) }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.top, 4)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.tint))
    }

    @ViewBuilder
    private func result(_ answer: SizeAnswer) -> some View {
        switch answer {
        case .nothingToCompare:
            Text(l.t("sizeGuide.nothing")).font(.inter(14)).foregroundStyle(Brand.body)
        case .belowChart:
            Text(l.t("sizeGuide.below")).font(.inter(14)).foregroundStyle(Brand.body)
        case .aboveChart:
            Text(l.t("sizeGuide.above")).font(.inter(14)).foregroundStyle(Brand.body)
        case .fits(let size, let comparisons), .closest(let size, let comparisons):
            VStack(alignment: .leading, spacing: 8) {
                Text(l.t(answer == .fits(size: size, comparisons: comparisons) ? "sizeGuide.fits" : "sizeGuide.closest", ["size": size]))
                    .font(.inter(16, .heavy))
                    .foregroundStyle(Brand.navy)
                ForEach(comparisons, id: \.measure) { entry in
                    Text("· " + l.t(entry.verdict == "within" ? "sizeGuide.verdictWithin" : entry.verdict == "below" ? "sizeGuide.verdictBelow" : "sizeGuide.verdictAbove", [
                        "measure": l.t(SizeGuideSheet.label(entry.measure)),
                        "value": SizeGuideSheet.number(entry.value),
                        "low": SizeGuideSheet.number(entry.low),
                        "high": SizeGuideSheet.number(entry.high),
                    ]))
                    .font(.inter(13))
                    .foregroundStyle(Brand.body)
                }
                let advice = fit?.advice(chart, answer: answer)
                if let advice, let tendency = fit?.tendency {
                    Text(l.t(tendency == "runsSmall" ? "sizeGuide.adviseUp" : "sizeGuide.adviseDown", ["size": advice]))
                        .font(.inter(13, .semibold))
                        .foregroundStyle(Brand.accentInk)
                }
                HStack(spacing: 10) {
                    if available.contains(where: { $0.caseInsensitiveCompare(size) == .orderedSame }) {
                        Button(l.t("sizeGuide.choose", ["size": size])) { choose(size) }.buttonStyle(PrimaryButtonStyle())
                    }
                    if let advice, available.contains(where: { $0.caseInsensitiveCompare(advice) == .orderedSame }) {
                        Button(l.t("sizeGuide.choose", ["size": advice])) { choose(advice) }.buttonStyle(SecondaryButtonStyle())
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        }
    }

    private func find() {
        var numbers: [String: Double] = [:]
        for measure in chart.measures {
            if let value = Double(values[measure] ?? ""), value > 0 { numbers[measure] = value }
        }
        answer = SizeAnswer.recommend(chart, measurements: numbers)
        Haptics.action()
        let kept = remember ? values : [:]
        UserDefaults.standard.set(try? JSONEncoder().encode(kept), forKey: Self.storeKey)
    }

    static func label(_ measure: String) -> String {
        switch measure {
        case "chest": return "sizeGuide.chest"
        case "waist": return "sizeGuide.waist"
        case "hips": return "sizeGuide.hips"
        case "inseam": return "sizeGuide.inseam"
        case "footLength": return "sizeGuide.footLength"
        default: return "sizeGuide.height"
        }
    }

    static func number(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
    }
}

// MARK: - Asking for a better price

/// "Ask for a better price" — the web's `PriceOfferPanel`: one line until
/// pressed; a request standing is drawn open, being something the shopper is
/// waiting on, with Withdraw.
struct PriceRequestPanel: View {
    let variant: ProductVariant
    @State private var open: Bool?
    @State private var held: HeldPriceRequest?
    @State private var expanded = false
    @State private var price = ""
    @State private var quantity = 1
    @State private var note = ""
    @State private var sending = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var numericId: Int? { Int(variant.id) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if open == true {
                let settled = held.map { ["declined", "expired", "withdrawn", "used"].contains($0.state) } ?? true
                let standing = app.session.isSignedIn && !settled
                VStack(alignment: .leading, spacing: 12) {
                    Button {
                        if !standing { withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() } }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "hand.raised")
                                .foregroundStyle(Brand.navy)
                                .frame(width: 36, height: 36)
                                .background(Circle().fill(Brand.tint))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(l.t("offers.heading")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                                if !standing { Text(l.t("offers.note")).font(.inter(12)).foregroundStyle(Brand.muted).multilineTextAlignment(.leading) }
                            }
                            Spacer()
                            if !standing {
                                Image(systemName: "chevron.down").foregroundStyle(Brand.muted).rotationEffect(.degrees(expanded ? 180 : 0))
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                    if standing || expanded { content(standing: standing) }
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            }
        }
        .task(id: variant.id) { await load() }
    }

    @ViewBuilder
    private func content(standing: Bool) -> some View {
        if !app.session.isSignedIn {
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("offers.signInFirst")).font(.inter(14, .bold))
                Text(l.t("offers.signInWhy")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                Button(l.t("header.signIn")) { app.authPresented = true }.buttonStyle(SecondaryButtonStyle())
            }
        } else if let held, standing {
            VStack(alignment: .leading, spacing: 6) {
                Text(held.state == "offered" && held.offeredPrice != nil
                     ? l.t("offers.statusOffered", ["price": held.offeredPrice!.formatted(l.current)])
                     : l.t("offers.statusPending"))
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                Text(standingNote(held)).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                if let said = held.vendorNote, !said.isEmpty {
                    Text(l.t("offers.sellerSaid", ["note": said])).font(.inter(13)).italic().foregroundStyle(Brand.body)
                }
                Button(l.t("offers.withdraw")) {
                    Task {
                        if await app.attempt({ _ = try await app.services.api.call(API.withdrawPriceRequest, .init(offerId: held.id)) }) { await load() }
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if let held {
                    Text(l.t(PriceRequestPanel.stateKey(held.state))).font(.inter(13, .semibold)).foregroundStyle(Brand.muted)
                }
                LabeledField(label: l.t("offers.yourPrice"), text: $price, placeholder: variant.price.amount,
                             hint: l.t("offers.listPrice", ["price": variant.price.formatted(l.current)]), keyboard: .decimalPad, leftToRight: true)
                HStack {
                    Text(l.t("offers.quantity")).font(.subheadline.weight(.semibold))
                    Spacer()
                    QuantityStepper(quantity: quantity, maximum: 999, name: l.t("offers.quantity")) { quantity = min(max(1, $0), 999) }
                }
                LabeledField(label: l.t("offers.messageLabel"), text: $note, placeholder: l.t("offers.messagePlaceholder"), axis: .vertical)
                Button {
                    Task { await ask() }
                } label: {
                    Text(l.t(sending ? "offers.sending" : "offers.send"))
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(price.trimmingCharacters(in: .whitespaces).isEmpty || sending)
            }
        }
    }

    private func standingNote(_ held: HeldPriceRequest) -> String {
        if held.state == "offered" {
            guard let expires = held.expiresAt, expires > Date() else { return l.t("offers.statusOfferedToday") }
            let left = max(1, Int(ceil(expires.timeIntervalSinceNow / 86_400)))
            return left <= 1 ? l.t("offers.statusOfferedToday") : l.t("offers.statusOfferedNote", ["days": "\(left)"])
        }
        return l.t("offers.statusPendingNote", [
            "price": held.askedPrice.formatted(l.current),
            "date": held.expiresAt.map { OrderWording.date($0, language: l.current) } ?? "—",
        ])
    }

    static func stateKey(_ state: String) -> String {
        switch state {
        case "declined": return "offers.statusDeclined"
        case "expired": return "offers.statusExpired"
        case "withdrawn": return "offers.statusWithdrawn"
        case "used": return "offers.statusUsed"
        default: return "offers.statusPending"
        }
    }

    private func load() async {
        guard let numericId, numericId > 0, app.features.isOn("priceOffers") else {
            open = false
            return
        }
        open = (try? await app.services.api.call(API.priceRequestsOpen, .init(variantIds: [numericId])))?.contains(numericId) ?? false
        if open == true, app.session.isSignedIn {
            held = (try? await app.services.api.call(API.myPriceRequest, .init(variantId: numericId))) ?? nil
        }
    }

    private func ask() async {
        guard let numericId else { return }
        sending = true
        defer { sending = false }
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let days = "\(ReferenceData.shared.rules.accountRules.askWindowDays)"
        let worked = await app.attempt {
            _ = try await app.services.api.call(API.askForPrice, .init(
                variantId: numericId,
                askedPrice: price.trimmingCharacters(in: .whitespaces),
                quantity: quantity,
                note: trimmed.isEmpty ? nil : trimmed
            ))
        }
        if worked {
            app.toast(l.t("offers.sent", ["days": days]))
            price = ""
            note = ""
            await load()
        }
    }
}

// MARK: - Following

/// "Tell me when the price drops", or "when it is back" on a sold-out product —
/// the web's `FollowProduct`.
struct FollowButton: View {
    let product: Product
    @State private var active = false
    @State private var waiting = 0
    @State private var working = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let inStock = product.isAvailable
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { await toggle(inStock: inStock) }
            } label: {
                Label(active ? l.t("follow.watching") : l.t(inStock ? "follow.priceDrop" : "follow.backInStock"),
                      systemImage: active ? "checkmark" : "bell.badge")
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(active ? Brand.tint : Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            }
            .buttonStyle(.action)
            .disabled(working)
            .accessibilityAddTraits(active ? .isSelected : [])
            if !inStock && waiting > 0 {
                Text(waiting == 1 ? l.t("follow.waitingOne") : l.t("follow.waiting", ["count": "\(waiting)"]))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
            }
        }
        .task(id: product.id) {
            if app.session.isSignedIn, let follows = try? await app.services.api.call(API.follows),
               let existing = follows.first(where: { $0.productId == product.id }) {
                active = inStock ? existing.priceDrop : existing.backInStock
            }
            if !inStock { waiting = (try? await app.services.api.call(API.followers, .init(productId: product.id))) ?? 0 }
        }
    }

    private func toggle(inStock: Bool) async {
        guard app.session.isSignedIn else {
            app.toast(l.t("follow.signInFirst"))
            return
        }
        working = true
        defer { working = false }
        let next = !active
        let worked = await app.attempt(fallback: "follow.failed") {
            _ = try await app.services.api.call(API.setFollow, .init(
                productId: product.id,
                priceDrop: inStock ? next : nil,
                backInStock: inStock ? nil : next
            ))
        }
        if worked {
            active = next
            app.toast(l.t(next ? "follow.on" : "follow.off", ["name": product.title]))
        }
    }
}

// MARK: - Subscribe & Save

/// Subscribe & Save — the web's `SubscribePanel`: the subscriber's price and
/// its promise, then how often, the first delivery and where.
struct SubscribePanel: View {
    let product: Product
    let variant: ProductVariant
    let quantity: Int
    @State private var open = false
    @State private var interval = 2
    @State private var firstRun = Date().addingTimeInterval(86_400)
    @State private var addresses: [SavedAddress]?
    @State private var addressId: Int?
    @State private var working = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var percent: Double { product.subscription?.savingPercent ?? 0 }

    /// The list price less the subscriber's saving, rounded down to the fil (`subscriberPrice`).
    private var unit: Money {
        guard percent > 0 else { return variant.price }
        let hundredths = Int((percent * 100).rounded())
        return Money(fils: variant.price.fils * (10_000 - hundredths) / 10_000, currencyCode: variant.price.currencyCode)
    }

    var body: some View {
        let count = min(quantity, 20)
        VStack(alignment: .leading, spacing: 10) {
            Label(percent > 0 ? l.t("subscribe.titleSave", ["percent": SizeGuideSheetNumber.text(percent)]) : l.t("subscribe.title"), systemImage: "repeat")
                .font(.inter(15, .heavy))
                .foregroundStyle(Brand.navy)
            Text(percent > 0
                 ? l.t("subscribe.priceSave", ["price": unit.formatted(l.current), "was": variant.price.formatted(l.current)])
                 : l.t("subscribe.price", ["price": unit.formatted(l.current)]))
                .font(.inter(14))
                .foregroundStyle(Brand.ink)
            Text(l.t("subscribe.promise", ["price": unit.formatted(l.current)])).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if !open {
                Button(l.t(app.session.isSignedIn ? "subscribe.start" : "subscribe.signIn")) {
                    if app.session.isSignedIn { open = true } else { app.authPresented = true }
                }
                .buttonStyle(SecondaryButtonStyle())
            } else {
                Picker(l.t("subscribe.every"), selection: $interval) {
                    ForEach(ReferenceData.shared.rules.accountRules.subscriptionIntervals, id: \.self) { weeks in
                        Text(weeks == 1 ? l.t("subscribe.weekly") : l.t("subscribe.weeks", ["count": "\(weeks)"])).tag(weeks)
                    }
                }
                .pickerStyle(.menu)
                .tint(Brand.navy)
                DatePicker(l.t("subscribe.firstDelivery"), selection: $firstRun,
                           in: Date().addingTimeInterval(86_400)...Date().addingTimeInterval(60 * 86_400), displayedComponents: .date)
                    .font(.inter(14))
                if let addresses {
                    if addresses.isEmpty {
                        HStack {
                            Text(l.t("subscribe.needAddress")).font(.inter(13)).foregroundStyle(Brand.body)
                            Button(l.t("subscribe.addAddress")) { app.open(.addresses) }
                                .font(.inter(13, .bold))
                                .foregroundStyle(Brand.navy)
                                .buttonStyle(.tap)
                        }
                    } else {
                        Picker(l.t("subscribe.deliverTo"), selection: Binding(get: { addressId ?? addresses.first?.id ?? 0 }, set: { addressId = $0 })) {
                            ForEach(addresses) { address in Text(address.label).tag(address.id) }
                        }
                        .pickerStyle(.menu)
                        .tint(Brand.navy)
                    }
                }
                Text(l.t("subscribe.summary", ["count": "\(count)", "total": (unit * count).formatted(l.current)])).font(.inter(13, .semibold))
                HStack(spacing: 10) {
                    Button(l.t("subscribe.confirm")) { Task { await subscribe(count: count) } }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(working || (addressId ?? addresses?.first?.id) == nil)
                    Button(l.t("subscribe.notNow")) { open = false }.buttonStyle(SecondaryButtonStyle())
                }
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.tint.opacity(0.6)))
        .task(id: open) {
            if open, addresses == nil { addresses = (try? await app.services.account.addresses()) ?? [] }
        }
    }

    private func subscribe(count: Int) async {
        guard let id = Int(variant.id), let address = addressId ?? addresses?.first?.id else { return }
        working = true
        defer { working = false }
        let day = DateFormatter()
        day.dateFormat = "yyyy-MM-dd"
        day.locale = Locale(identifier: "en_US_POSIX")
        day.timeZone = TimeZone(identifier: "Asia/Kuwait")
        var started: StartedSubscription?
        if await app.attempt({
            started = try await app.services.api.call(API.subscribe, .init(variantId: id, quantity: count, intervalWeeks: interval, addressId: address, firstRunOn: day.string(from: firstRun)))
        }), let started {
            app.toast(l.t("subscribe.done", ["date": OrderWording.day(started.nextRunOn, language: l.current)]))
            open = false
        }
    }
}

/// A percentage as people write it: "10", "7.5".
enum SizeGuideSheetNumber {
    static func text(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
    }
}

// MARK: - Sets

/// Sets this variant is part of, cheaper together — the web's `BundleOffer`.
/// A set goes into the bag whole or not at all.
struct BundlesPanel: View {
    let variantId: String
    @State private var bundles: [ProductBundle] = []
    @State private var adding: Int?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        // A stack rather than a group, so it is a view while it holds nothing
        // and still asks for the sets; the room above comes with the sets.
        VStack(alignment: .leading, spacing: 0) {
            if !bundles.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text(l.t("bundle.heading")).font(.inter(17, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                    ForEach(bundles) { bundle in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(bundle.name).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                            ForEach(bundle.members, id: \.variantId) { member in
                                Text("· \(member.productTitle)\(member.quantity > 1 ? " ×\(member.quantity)" : "")\(bundle.crossVendor ? member.vendorName.map { " · \($0)" } ?? "" : "")")
                                    .font(.inter(13))
                                    .foregroundStyle(Brand.body)
                            }
                            HStack(spacing: 8) {
                                Text(bundle.bundlePrice.formatted(l.current)).font(.inter(17, .heavy)).foregroundStyle(Brand.ink)
                                Text(bundle.separately.formatted(l.current)).font(.inter(13)).strikethrough().foregroundStyle(Brand.muted)
                                Text(l.t("bundle.saving", ["amount": bundle.saving.formatted(l.current)])).font(.inter(12, .bold)).foregroundStyle(Brand.success)
                            }
                            Button {
                                Task { await add(bundle) }
                            } label: {
                                HStack(spacing: 6) {
                                    if adding == bundle.id { ProgressView().tint(Brand.navy) } else { Image(systemName: "plus.square.on.square") }
                                    Text(l.t("bundle.add"))
                                }
                                .frame(maxWidth: .infinity, minHeight: 48)
                            }
                            .buttonStyle(PurchaseButtonStyle())
                            .disabled(adding != nil)
                            Text(l.t("bundle.allOrNothing")).font(.inter(12)).foregroundStyle(Brand.muted)
                        }
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                    }
                }
                .padding(.top, 16)
            }
        }
        .task(id: variantId) { bundles = (try? await app.services.api.call(API.bundles, .init(variantId: variantId))) ?? [] }
    }

    private func add(_ bundle: ProductBundle) async {
        adding = bundle.id
        defer { adding = nil }
        let lines = bundle.members.map { API.CartLine(variantId: "\($0.variantId)", quantity: $0.quantity, bundleId: bundle.id) }
        if await app.cart.add(lines: lines) {
            Haptics.succeeded()
            announce(l.t("bundle.added", ["name": bundle.name]))
            app.toast(l.t("bundle.added", ["name": bundle.name]))
        } else {
            Haptics.refused()
            app.toast(l.t("cart.addFailed"))
        }
    }
}

// MARK: - Reviews

/// Every published review of the product, with the summary over all of them
/// — the web's `ProductReviews`.
struct ReviewsSection: View {
    let product: Product
    @State private var page: ProductReviewsPage?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(l.t("review.heading")).shelfTitle()
            if let page {
                if page.total == 0 {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(l.t("review.none")).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                        Text(l.t("review.noneNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                } else {
                    if let summary = page.summary { summaryCard(summary) }
                    ForEach(page.items) { review in reviewCard(review) }
                }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .task(id: product.id) { page = try? await app.services.api.call(API.productReviews, .init(productId: product.id, limit: 20)) }
    }

    private func summaryCard(_ summary: ProductReviewsPage.Summary) -> some View {
        let maxStars = ReferenceData.shared.rules.accountRules.ratingMax
        return HStack(alignment: .top, spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                Text(String(format: "%.1f", summary.average)).font(.inter(34, .heavy)).foregroundStyle(Brand.ink)
                StarsView(rating: Int(summary.average.rounded()), size: 15)
                Text(summary.count == 1 ? l.t("review.countOne") : l.t("review.count", ["count": "\(summary.count)"]))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
            }
            VStack(spacing: 4) {
                ForEach((1...maxStars).reversed(), id: \.self) { star in
                    let count = summary.distribution["\(star)"] ?? 0
                    HStack(spacing: 8) {
                        Text("\(star)").font(.inter(12, .semibold)).foregroundStyle(Brand.muted).frame(width: 14)
                        GeometryReader { proxy in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Brand.tint)
                                Capsule().fill(Brand.star).frame(width: summary.count > 0 ? proxy.size.width * CGFloat(count) / CGFloat(summary.count) : 0)
                            }
                        }
                        .frame(height: 8)
                        Text("\(count)").font(.inter(12)).foregroundStyle(Brand.muted).frame(width: 24, alignment: .trailing)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(star == 1 ? l.t("review.starsOne") : l.t("review.stars", ["count": "\(star)"])): \(count)")
                }
            }
        }
        .card()
    }

    private func reviewCard(_ review: ProductReviewsPage.Review) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                StarsView(rating: review.rating)
                Text(l.t("review.verified")).font(.inter(11, .bold)).foregroundStyle(Brand.success)
                Spacer()
            }
            Text("\(review.author ?? l.t("review.anonymous")) · \(OrderWording.date(review.createdAt, language: l.current))")
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
            if let title = review.title, !title.isEmpty {
                Text(title).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
            }
            if let body = review.body, !body.isEmpty {
                Text(body).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
            if let reply = review.vendorReply, !reply.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(l.t("review.vendorReply")).font(.inter(12, .bold)).foregroundStyle(Brand.navy)
                    Text(reply).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

// MARK: - Bought together

/// What shoppers bought with it — the web's `BoughtTogether`.
struct BoughtTogetherShelf: View {
    let product: Product
    @State private var items: [Complement] = []
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text(l.t("together.heading")).shelfTitle()
                    Text(l.t("together.note")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    // Another seller wins over the percentage, being the fact that
                    // changes what the shopper signs up for; a share under a fifth
                    // is a number pretending to be a reason.
                    ProductGrid(products: items.map(\.product)) { product in
                        guard let item = items.first(where: { $0.product.id == product.id }) else { return nil }
                        if item.crossVendor { return l.t("together.otherSeller") }
                        if item.confidence >= 0.2 { return l.t("together.confidence", ["percent": "\(Int((item.confidence * 100).rounded()))"]) }
                        return nil
                    }
                }
                .padding(.top, 40)
            }
        }
        .task(id: product.id) {
            guard app.features.isOn("boughtTogether") else { return }
            items = (try? await app.services.api.call(API.boughtTogether, .init(productId: product.id, limit: 4, locale: l.current.rawValue))) ?? []
        }
    }
}
