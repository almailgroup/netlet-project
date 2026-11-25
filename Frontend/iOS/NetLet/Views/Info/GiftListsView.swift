import SwiftUI

/// Finding somebody's wishlist by their phone number or the name they show on
/// it — the web's `/gifts`. "Nobody has that number" and "they publish
/// nothing" are the same answer, so the lookup cannot be used to ask who
/// shops here. The form is `GiftFinder`, which the account's Wishlists and
/// gifts draws too.
struct GiftLookupView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        InfoPage(title: l.t("gift.heading"), note: l.t("gift.intro")) {
            if !app.features.isOn("wishlists") {
                Text(l.t("gift.switchedOff")).font(.inter(14)).foregroundStyle(Brand.muted)
            } else {
                GiftFinder()
            }
        }
    }
}

/// The lookup's box and what it found — on `/gifts` and inside the account's
/// Wishlists and gifts, on the owner's word ("finding a user for buying their
/// wishlist should be in Wishlist and gifts itself"); the web's `GiftFinder`.
struct GiftFinder: View {
    /// Inside another card already: the box without a card of its own.
    var inset = false
    @State private var typed = ""
    @State private var invalid = false
    @State private var searching = false
    @State private var found: [GiftList]?
    @State private var refusal: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                LabeledField(
                    label: l.t("gift.lookupLabel"),
                    text: $typed,
                    placeholder: l.t("gift.lookupPlaceholder"),
                    problem: invalid ? "gift.lookupInvalid" : nil
                )
                .autocorrectionDisabled()
                .textInputAutocapitalization(.words)
                .submitLabel(.search)
                .onSubmit { Task { await find() } }
                Button {
                    Task { await find() }
                } label: {
                    if searching { ProgressView().tint(.white) } else { Label(l.t("gift.lookupSubmit"), systemImage: "magnifyingglass") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(searching)
            }
            .modifier(FinderCard(inset: inset))
            if let refusal {
                Text(l.t(refusal)).font(.inter(14)).foregroundStyle(Brand.danger)
            } else if let found {
                if found.isEmpty {
                    GiftNotFound()
                } else {
                    ForEach(found) { list in GiftListCard(list: list) { await find() } }
                }
            }
        }
    }

    private func find() async {
        guard let query = GiftLookup.read(typed) else {
            invalid = true
            Haptics.refused()
            return
        }
        invalid = false
        searching = true
        defer { searching = false }
        refusal = nil
        do {
            switch query {
            case .phone(let phone): found = try await app.services.api.call(API.giftListsByPhone, .init(phone: phone))
            case .name(let name): found = try await app.services.api.call(API.giftListsByName, .init(name: name))
            }
        } catch {
            let key = APIError.from(error).messageKey(knownKey: l.phrasebook.has)
            refusal = key.hasPrefix("ios.") || key.hasPrefix("error.") ? "gift.loadFailed" : key
        }
    }
}

/// The finder's box as a card of its own, or bare inside another.
private struct FinderCard: ViewModifier {
    let inset: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if inset { content } else { content.card() }
    }
}

/// One published list, opened by its link — the web's `/gifts/<token>`.
struct GiftListView: View {
    let token: String
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { Loader { try await app.services.api.call(API.giftList, .init(token: token)) } }) { list in
            InfoPage(title: l.t("gift.heading"), note: l.t("gift.intro")) {
                VStack(alignment: .leading, spacing: 14) {
                    if !app.features.isOn("wishlists") {
                        Text(l.t("gift.switchedOff")).font(.inter(14)).foregroundStyle(Brand.muted)
                    } else {
                        LoadStateView(state: list.state, retry: { await list.load() }) { found in
                            if let found {
                                GiftListCard(list: found) { await list.load() }
                            } else {
                                GiftNotFound(byLink: true)
                            }
                        }
                    }
                    Button(l.t("gift.backToLookup")) { app.open(.gifts) }
                        .font(.inter(14, .bold))
                        .foregroundStyle(Brand.navy)
                        .frame(minHeight: 44)
                        .buttonStyle(.tap)
                }
            }
            .task { await list.load() }
        }
    }
}

/// Nothing to show. From a link the words are about the link, which the
/// person holding it used — the web's `NotFound`.
private struct GiftNotFound: View {
    var byLink = false
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "lock").font(.system(size: 28)).foregroundStyle(Brand.muted).accessibilityHidden(true)
            Text(l.t(byLink ? "gift.linkGone" : "gift.none")).font(.inter(15, .bold)).foregroundStyle(Brand.ink).multilineTextAlignment(.center)
            Text(l.t(byLink ? "gift.linkGoneNote" : "gift.noneNote")).font(.inter(13)).foregroundStyle(Brand.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .card(padding: 24)
    }
}

/// A list as a giver sees it: whose it is, each present and whether it is
/// still free. Claiming is one press with bagging, because they are one
/// intention; a present with sizes asks which before it is claimed.
private struct GiftListCard: View {
    let list: GiftList
    let changed: () async -> Void
    @State private var products: [String: Product] = [:]
    @State private var settled = false
    /* Who a gift is from (migration 0092), one choice for the page: a typed
       name to start, the account's first name in the box, or anonymous. */
    @State private var showName = true
    @State private var typed: String?
    @State private var nameProblem: String?
    @FocusState private var nameFocused: Bool
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var namesOpen: Bool { list.namesOpen == true }
    private var shownName: String { typed ?? GiverName.suggested(app.session.user?.name) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(list.ownerName.map { l.t("gift.listOf", ["name": $0]) } ?? l.t("gift.listPlain"))
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.accentInk)
            Text(list.title).font(.inter(20, .heavy)).foregroundStyle(Brand.navy)
            Label(l.t(namesOpen ? "gift.secretUntilArrival" : "gift.secret"), systemImage: "lock")
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            if !app.session.isSignedIn && list.items.contains(where: { $0.state == "available" }) {
                Text(l.t("gift.signInToRelease")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            if namesOpen && list.items.contains(where: { $0.state == "available" }) {
                giverChoice
            }
            if list.items.isEmpty {
                Text(l.t("gift.emptyList")).font(.inter(14)).foregroundStyle(Brand.muted)
            } else {
                ForEach(list.items, id: \.productId) { item in
                    GiftRow(token: list.token, item: item, product: products[item.productId], settled: settled,
                            namesOpen: namesOpen, giverFor: giverFor, changed: changed)
                    if item.productId != list.items.last?.productId { Divider() }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .task(id: list.items.map(\.productId)) {
            let ids = list.items.map(\.productId)
            if let found = try? await app.services.api.call(API.productsByIds, .init(ids: ids, locale: l.current.rawValue)) {
                for product in found { products[product.id] = product }
            }
            settled = true
        }
    }

    /// What a claim pressed on this page says it is from: the name to show,
    /// nil to stay anonymous — or `.refused` when the name cannot be shown,
    /// said under the box, which takes focus, and nothing is claimed.
    private func giverFor() -> GiverChoice {
        guard namesOpen, app.session.isSignedIn, showName else { return .from(nil) }
        if let problem = GiverName.problem(shownName) {
            nameProblem = problem
            nameFocused = true
            Haptics.refused()
            return .refused
        }
        nameProblem = nil
        return .from(GiverName.clean(shownName))
    }

    /// "Who is it from?" — Show my name, with the name to show, or Stay
    /// anonymous; a signed-out giver is told they stay anonymous.
    private var giverChoice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("gift.fromTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                .accessibilityAddTraits(.isHeader)
            Text(list.ownerName.map { l.t("gift.fromIntroNamed", ["name": $0]) } ?? l.t("gift.fromIntro"))
                .font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if app.session.isSignedIn {
                choiceTile(chosen: showName, title: "gift.fromName", note: "gift.fromNameNote", symbol: "person") {
                    showName = true
                    nameProblem = nil
                }
                choiceTile(chosen: !showName, title: "gift.fromAnonymous", note: "gift.fromAnonymousNote", symbol: "eye.slash") {
                    showName = false
                    nameProblem = nil
                }
                if showName {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(l.t("gift.fromNameLabel")).font(.inter(13, .semibold)).foregroundStyle(Brand.ink)
                        TextField("", text: Binding(get: { shownName }, set: { value in
                            typed = value
                            if nameProblem != nil { nameProblem = GiverName.problem(value) }
                        }))
                        .focused($nameFocused)
                        .textContentType(.nickname)
                        .textInputAutocapitalization(.words)
                        .font(.inter(16))
                        .padding(.horizontal, 14)
                        .frame(minHeight: 48)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(nameProblem != nil ? Brand.danger : Brand.line, lineWidth: nameProblem == nil ? 1 : 1.5)
                        )
                        .accessibilityLabel(l.t("gift.fromNameLabel"))
                        FieldProblem(key: nameProblem.map { "wishlist.\($0)" })
                    }
                    .padding(.top, 2)
                }
            } else {
                Label(l.t("gift.fromSignedOut"), systemImage: "eye.slash")
                    .font(.inter(12)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                Button(l.t("gift.fromSignIn")) { app.selectedTab = .account }
                    .font(.inter(13, .bold))
                    .foregroundStyle(Brand.navy)
                    .buttonStyle(.tap)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.tint.opacity(0.5)))
    }

    private func choiceTile(chosen: Bool, title: String, note: String, symbol: String, choose: @escaping () -> Void) -> some View {
        Button(action: choose) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: chosen ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 18))
                    .foregroundStyle(chosen ? Brand.navy : Brand.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Label(l.t(title), systemImage: symbol).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                    Text(l.t(note)).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(chosen ? Brand.navy : Brand.line, lineWidth: chosen ? 2 : 1)
            )
        }
        .buttonStyle(.tap)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(chosen ? [.isSelected] : [])
    }
}

/// What a claim pressed on the gift page says it is from.
private enum GiverChoice {
    case from(String?)
    case refused
}

private struct GiftRow: View {
    let token: String
    let item: GiftList.Item
    let product: Product?
    let settled: Bool
    let namesOpen: Bool
    let giverFor: () -> GiverChoice
    let changed: () async -> Void
    @State private var chosen: String?
    @State private var askChoice = false
    @State private var took = false
    @State private var working = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let buyable = product?.variants.filter(\.availableForSale) ?? []
        let choosing = (product?.variants.count ?? 0) > 1 && !buyable.isEmpty
        let variant = choosing ? buyable.first(where: { $0.id == chosen }) : buyable.first
        let yours = item.state != "bought" && (item.claimedByYou || took || (item.state == "claimed" && HeldClaims.holds(token: token, productId: item.productId)))
        HStack(alignment: .top, spacing: 12) {
            RemoteImage(reference: product?.images.first?.url, label: product?.title)
                .frame(width: 56, height: 56)
                .background(Brand.photo)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 6) {
                if let product {
                    Button { app.open(.product(handle: product.handle)) } label: {
                        Text(product.title).font(.inter(15, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.tap)
                } else if settled {
                    Text(l.t("product.unavailable")).font(.inter(14, .semibold)).foregroundStyle(Brand.muted)
                }
                if let note = item.note, !note.isEmpty {
                    Text(note).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                }
                if let price = variant?.price ?? product?.priceRange.min {
                    Text(price.formatted(l.current)).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                }
                if item.state == "bought" {
                    tag(l.t("gift.bought"), success: true)
                } else if yours {
                    HStack(spacing: 8) {
                        tag(l.t("gift.yours"), success: true)
                        Button(l.t("cart.title")) { app.selectedTab = .cart }
                            .font(.inter(13, .bold))
                            .foregroundStyle(Brand.navy)
                            .buttonStyle(.tap)
                        if item.claimedByYou {
                            Button(l.t("gift.release")) { Task { await release() } }
                                .font(.inter(13, .bold))
                                .foregroundStyle(Brand.danger)
                                .buttonStyle(.tap)
                                .disabled(working)
                        }
                    }
                    /* Who the giver said it is from, a fact about them alone. */
                    if namesOpen {
                        let name = item.claimedByYou ? item.yourName : nil
                        Label(name.map { l.t("gift.yourFromName", ["name": $0]) } ?? l.t("gift.yourFromAnonymous"),
                              systemImage: name == nil ? "eye.slash" : "person")
                            .font(.inter(12))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                } else if item.state == "claimed" {
                    tag(l.t("gift.claimed"), success: false)
                } else if product != nil && buyable.isEmpty {
                    tag(l.t("gift.soldOut"), success: false)
                } else if let product {
                    if choosing {
                        Menu {
                            ForEach(product.variants) { option in
                                Button(option.availableForSale ? GiftRow.label(option) : "\(GiftRow.label(option)) — \(l.t("gift.soldOut"))") {
                                    Haptics.tap()
                                    chosen = option.id
                                    askChoice = false
                                }
                                .disabled(!option.availableForSale)
                            }
                        } label: {
                            MenuField(text: product.variants.first(where: { $0.id == chosen }).map(GiftRow.label), placeholder: l.t("product.chooseOption"))
                        }
                        .accessibilityLabel("\(l.t("product.chooseOption")): \(product.title)")
                    }
                    Button {
                        Task { await claim(variant) }
                    } label: {
                        Label(l.t("gift.claim"), systemImage: "gift")
                    }
                    .buttonStyle(CompactPrimaryStyle())
                    .disabled(working)
                    if askChoice && variant == nil {
                        FieldProblem(key: "gift.chooseFirst")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// A variant by its options ("M · Navy"), or its name when it has none.
    static func label(_ variant: ProductVariant) -> String {
        let values = variant.selectedOptions.map(\.value).filter { !$0.isEmpty }
        return values.isEmpty ? variant.title : values.joined(separator: " · ")
    }

    private func tag(_ text: String, success: Bool) -> some View {
        Label(text, systemImage: "checkmark")
            .font(.inter(12, .bold))
            .foregroundStyle(success ? Brand.success : Brand.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(success ? Brand.successFill : Brand.tint))
    }

    private func claim(_ variant: ProductVariant?) async {
        guard let variant else {
            askChoice = true
            Haptics.refused()
            return
        }
        guard case .from(let shownAs) = giverFor() else { return }
        working = true
        defer { working = false }
        let worked = await app.attempt(done: "gift.claimed_toast", fallback: "gift.loadFailed") {
            _ = try await app.services.api.call(API.claimGift, .init(token: token, productId: item.productId, shownAs: shownAs))
        }
        guard worked else {
            await changed()
            return
        }
        if !app.session.isSignedIn { HeldClaims.remember(token: token, productId: item.productId) }
        took = true
        _ = await app.cart.add(variantId: variant.id, quantity: item.quantity)
        await changed()
    }

    private func release() async {
        working = true
        defer { working = false }
        if await app.attempt(done: "gift.released", fallback: "gift.loadFailed", {
            _ = try await app.services.api.call(API.releaseGift, .init(token: token, productId: item.productId))
        }) {
            took = false
            await changed()
        }
    }
}
