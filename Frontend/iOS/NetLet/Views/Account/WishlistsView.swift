import SwiftUI

/// The shopper's wishlists — the web's `WishlistManager`: the number family
/// find their lists by, each list private or published with its share link,
/// and a new one made by name.
struct WishlistsView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { WishlistsModel(api: app.services.api) }) { model in
            ShopPage(header: false, refresh: { await model.load() }) {
                AccountSection(title: l.t("account.sectionWishlists"), hint: l.t("account.hint.wishlists")) {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(l.t(app.features.isOn("wishlists") ? "wish.intro" : "wish.switchedOff"))
                            .font(.inter(14))
                            .foregroundStyle(Brand.body)
                            .fixedSize(horizontal: false, vertical: true)
                        PhoneCard(model: model)
                        LoadStateView(state: model.lists.state, retry: { await model.load() }) { lists in
                            VStack(alignment: .leading, spacing: 12) {
                                if lists.isEmpty {
                                    VStack(spacing: 6) {
                                        Image(systemName: "gift").font(.system(size: 30)).foregroundStyle(Brand.muted).accessibilityHidden(true)
                                        Text(l.t("wish.empty")).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                                        Text(l.t("wish.emptyNote")).font(.inter(13)).foregroundStyle(Brand.muted).multilineTextAlignment(.center)
                                    }
                                    .frame(maxWidth: .infinity)
                                    .card(padding: 24)
                                } else {
                                    ForEach(lists) { list in ListRow(list: list, model: model) }
                                }
                                if app.features.isOn("wishlists") { NewListForm(model: model) }
                            }
                        }
                    }
                }
            }
            .task { await model.load() }
        }
    }
}

@Observable
@MainActor
final class WishlistsModel {
    let lists: Loader<[WishlistSummary]>
    private(set) var phone: String?
    /// Each published list's share token, read as the list is drawn.
    private(set) var tokens: [Int: String] = [:]
    let api: APICalling

    init(api: APICalling) {
        self.api = api
        lists = Loader { try await api.call(API.wishlists) }
    }

    func load() async {
        await lists.load()
        phone = (try? await api.call(API.wishlistPhone)) ?? phone
        for list in lists.value ?? [] where list.isPublic && tokens[list.id] == nil {
            if let token = try? await api.call(API.wishlistShareToken, .init(listId: list.id)) { tokens[list.id] = token }
        }
    }

    func setPhone(_ value: String?) async throws {
        phone = try await api.call(API.setWishlistPhone, .init(phone: value))
    }

    func create(_ title: String) async throws {
        _ = try await api.call(API.createWishlist, .init(title: title))
        await load()
    }

    func setVisibility(_ list: WishlistSummary, public published: Bool) async throws {
        _ = try await api.call(API.updateWishlist, .init(listId: list.id, visibility: published ? "public" : "private"))
        // Unpublishing mints a new token, so a link already pasted somewhere stops working.
        tokens[list.id] = nil
        await load()
    }

    func remove(_ list: WishlistSummary) async throws {
        _ = try await api.call(API.removeWishlist, .init(listId: list.id))
        await load()
    }
}

/// The number a family finds the published lists by.
private struct PhoneCard: View {
    let model: WishlistsModel
    @State private var typed = ""
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("wish.phoneHeading")).font(.inter(16, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("wish.phoneNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if let current = model.phone {
                HStack {
                    Text("\u{2066}\(PhoneNumber.display(current))\u{2069}").font(.inter(16, .bold)).foregroundStyle(Brand.ink)
                    Spacer()
                    Button(l.t("wish.phoneClear")) { save(nil) }
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.danger)
                        .frame(minHeight: 44)
                        .disabled(saving)
                }
            } else {
                LabeledField(
                    label: l.t("wish.phoneLabel"),
                    text: $typed,
                    placeholder: l.t("wish.phonePlaceholder"),
                    keyboard: .phonePad,
                    content: .telephoneNumber,
                    leftToRight: true
                )
                Button(l.t("wish.phoneSave")) { save(typed.trimmingCharacters(in: .whitespaces)) }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(PhoneNumber.normalise(typed) == nil || saving)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }

    private func save(_ value: String?) {
        Task {
            saving = true
            defer { saving = false }
            if await app.attempt(done: value == nil ? "wish.phoneCleared" : "wish.phoneSaved", { try await model.setPhone(value) }) {
                typed = ""
            }
        }
    }
}

private struct ListRow: View {
    let list: WishlistSummary
    let model: WishlistsModel
    @State private var confirming: Confirm?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    enum Confirm: Identifiable {
        case unpublish, delete
        var id: Self { self }
    }

    var body: some View {
        let link = model.tokens[list.id].map { app.services.configuration.url(path: "/gifts/\($0)") }
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Button { app.push(.wishlist(id: list.id)) } label: {
                        Text(list.title).font(.inter(16, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.tap)
                    Text(list.itemCount == 1 ? l.t("wish.itemCountOne") : l.t("wish.itemCount", ["count": "\(list.itemCount)"]))
                        .font(.inter(13))
                        .foregroundStyle(Brand.muted)
                }
                Spacer()
                Label(l.t(list.isPublic ? "wish.public" : "wish.private"), systemImage: list.isPublic ? "gift" : "lock")
                    .font(.inter(12, .bold))
                    .foregroundStyle(list.isPublic ? Brand.success : Brand.muted)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(list.isPublic ? Brand.successFill : Brand.tint))
            }
            Text(l.t(list.isPublic ? "wish.publicNote" : "wish.privateNote"))
                .font(.inter(13))
                .foregroundStyle(Brand.body)
                .fixedSize(horizontal: false, vertical: true)
            if list.isPublic && model.phone == nil {
                Text(l.t("wish.phoneNeeded")).font(.inter(12)).foregroundStyle(Brand.accentInk)
            }
            FlowLayout(spacing: 8) {
                small(l.t("wish.open"), symbol: "list.bullet") { app.push(.wishlist(id: list.id)) }
                if list.isPublic {
                    if let link {
                        ShareLink(item: link, subject: Text(list.title)) {
                            pill(l.t("wish.shareLink"), symbol: "square.and.arrow.up")
                        }
                        .simultaneousGesture(TapGesture().onEnded { Haptics.tap() })
                    }
                    small(l.t("wish.unpublish"), symbol: "lock") { confirming = .unpublish }
                } else {
                    small(l.t("wish.publish"), symbol: "gift") {
                        Task { await app.attempt { try await model.setVisibility(list, public: true) } }
                    }
                }
                small(l.t("wish.deleteList"), symbol: "trash", danger: true) { confirming = .delete }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
        .confirmationDialog(title, isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible) {
            switch confirming {
            case .unpublish:
                Button(l.t("wish.unpublishConfirm")) {
                    Task { await app.attempt { try await model.setVisibility(list, public: false) } }
                }
            case .delete:
                Button(l.t("wish.deleteConfirm"), role: .destructive) {
                    Task { await app.attempt { try await model.remove(list) } }
                }
            case nil:
                EmptyView()
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t(confirming == .delete ? "wish.deleteBody" : "wish.unpublishBody"))
        }
    }

    private var title: String {
        confirming == .delete ? l.t("wish.deleteWarning", ["name": list.title]) : l.t("wish.unpublishWarning")
    }

    private func small(_ title: String, symbol: String, danger: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) { pill(title, symbol: symbol, danger: danger) }
            .buttonStyle(.tap)
    }

    private func pill(_ title: String, symbol: String, danger: Bool = false) -> some View {
        Label(title, systemImage: symbol)
            .font(.inter(13, .bold))
            .foregroundStyle(danger ? Brand.danger : Brand.navy)
            .padding(.horizontal, 12)
            .frame(minHeight: 40)
            .background(Capsule().fill(Color.white))
            .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
    }
}

private struct NewListForm: View {
    let model: WishlistsModel
    @State private var title = ""
    @State private var creating = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LabeledField(label: l.t("wish.newListName"), text: $title, placeholder: l.t("wish.newListPlaceholder"))
            Button {
                Task {
                    creating = true
                    defer { creating = false }
                    let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
                    if await app.attempt({ try await model.create(name) }) { title = "" }
                }
            } label: {
                Label(l.t("wish.create"), systemImage: "plus")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || creating)
        }
        .card()
    }
}

/// One list opened by its owner: what it is shown as, what is on it with a
/// note each, and the saved products to add from — the web's `ListDetail`.
/// Who claimed what is never shown here: that would spoil the surprise.
struct WishlistDetailView: View {
    let listId: Int
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { WishlistDetailModel(listId: listId, api: app.services.api, account: app.services.account, language: l.current) }) { model in
            ShopPage(header: false, refresh: { await model.load() }) {
                AccountSection(title: model.detail.value?.list.title ?? l.t("account.sectionWishlists"), hint: l.t("account.hint.wishlists")) {
                    LoadStateView(state: model.detail.state, retry: { await model.load() }) { detail in
                        WishlistDetailBody(detail: detail, model: model)
                    }
                }
            }
            .task { await model.load() }
        }
    }
}

@Observable
@MainActor
final class WishlistDetailModel {
    let listId: Int
    let detail: Loader<WishlistDetail>
    private(set) var products: [String: Product] = [:]
    private(set) var savedIds: [String] = []
    /// Set once the products have been asked for, so "no longer available" is said only after.
    private(set) var settled = false
    let api: APICalling
    private let account: AccountServicing
    private let language: Language

    init(listId: Int, api: APICalling, account: AccountServicing, language: Language) {
        self.listId = listId
        self.api = api
        self.account = account
        self.language = language
        detail = Loader { try await api.call(API.wishlist, .init(listId: listId)) }
    }

    func load() async {
        await detail.load()
        savedIds = (try? await account.savedProducts()) ?? savedIds
        let wanted = Array(Set((detail.value?.items.map(\.productId) ?? []) + savedIds)).filter { products[$0] == nil }
        if !wanted.isEmpty, let found = try? await api.call(API.productsByIds, .init(ids: wanted, locale: language.rawValue)) {
            for product in found { products[product.id] = product }
        }
        settled = true
    }

    func add(_ product: Product) async throws {
        _ = try await api.call(API.addToWishlist, .init(listId: listId, productId: product.id))
        await detail.load()
    }

    func remove(_ item: WishlistDetail.Item) async throws {
        _ = try await api.call(API.removeFromWishlist, .init(listId: listId, itemId: item.id))
        await detail.load()
    }

    func saveNote(_ item: WishlistDetail.Item, note: String) async throws {
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        _ = try await api.call(API.addToWishlist, .init(listId: listId, productId: item.productId, note: trimmed.isEmpty ? nil : trimmed))
        await detail.load()
    }

    func saveOwnerName(_ name: String) async throws {
        _ = try await api.call(API.updateWishlist, .init(listId: listId, ownerName: name.trimmingCharacters(in: .whitespacesAndNewlines)))
        await detail.load()
    }
}

private struct WishlistDetailBody: View {
    let detail: WishlistDetail
    let model: WishlistDetailModel
    @State private var shownAs = ""
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let on = app.features.isOn("wishlists")
        let onList = Set(detail.items.map(\.productId))
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                LabeledField(label: l.t("wish.shownAs"), text: $shownAs, placeholder: l.t("wish.shownAsPlaceholder"), hint: l.t("wish.shownAsNote"))
                Button(l.t("account.saveChanges")) {
                    Task { await app.attempt(done: "wish.savedToast") { try await model.saveOwnerName(shownAs) } }
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .card()
            .onAppear { shownAs = detail.list.ownerName ?? "" }

            VStack(alignment: .leading, spacing: 10) {
                if detail.items.isEmpty {
                    Text(l.t("wish.listEmpty")).font(.inter(14)).foregroundStyle(Brand.muted)
                } else {
                    ForEach(detail.items) { item in itemRow(item, editable: on) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()

            if on {
                VStack(alignment: .leading, spacing: 10) {
                    Text(l.t("wish.addFromSaved")).font(.inter(16, .heavy)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
                    Text(l.t("wish.addFromSavedNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    let saved = model.savedIds.compactMap { model.products[$0] }
                    if saved.isEmpty {
                        Text(l.t("wish.nothingSaved")).font(.inter(13)).foregroundStyle(Brand.muted)
                    } else {
                        ForEach(saved) { product in savedRow(product, already: onList.contains(product.id)) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .card()
            }
        }
    }

    private func itemRow(_ item: WishlistDetail.Item, editable: Bool) -> some View {
        let product = model.products[item.productId]
        let name = product?.title ?? (model.settled ? l.t("product.unavailable") : "")
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                RemoteImage(reference: product?.images.first?.url, label: name)
                    .frame(width: 52, height: 52)
                    .background(Brand.photo)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    if let product {
                        Button { app.push(.product(handle: product.handle)) } label: {
                            Text(product.title).font(.inter(14, .bold)).foregroundStyle(Brand.navy).multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.tap)
                        Text(product.priceRange.min.formatted(l.current)).font(.inter(13)).foregroundStyle(Brand.ink)
                    } else {
                        Text(name).font(.inter(14, .bold)).foregroundStyle(Brand.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                IconButton(symbol: "trash", label: l.t("wish.removeItem", ["name": name.isEmpty ? item.productId : name]), role: .destructive) {
                    Task { await app.attempt(done: "wish.removed") { try await model.remove(item) } }
                }
            }
            if editable {
                NoteField(item: item, model: model)
            } else if let note = item.note, !note.isEmpty {
                Text(note).font(.inter(13)).foregroundStyle(Brand.body)
            }
            if item.id != detail.items.last?.id { Divider() }
        }
    }

    private func savedRow(_ product: Product, already: Bool) -> some View {
        HStack(spacing: 12) {
            RemoteImage(reference: product.images.first?.url, label: product.title)
                .frame(width: 44, height: 44)
                .background(Brand.photo)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text(product.title).font(.inter(14)).foregroundStyle(Brand.ink).frame(maxWidth: .infinity, alignment: .leading)
            Button {
                Task {
                    await app.attempt { try await model.add(product) }
                }
            } label: {
                Label(l.t(already ? "wish.onList" : "wish.add"), systemImage: already ? "checkmark" : "plus")
                    .font(.inter(13, .bold))
                    .foregroundStyle(already ? Brand.success : Brand.navy)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 40)
                    .background(Capsule().fill(already ? Brand.successFill : Brand.tint))
            }
            .buttonStyle(.action)
            .disabled(already)
            .accessibilityLabel(already ? l.t("wish.onList") : "\(l.t("wish.add")): \(product.title)")
        }
    }
}

/// A note on one item for whoever buys it ("Size M please"), saved when the
/// shopper is done typing.
private struct NoteField: View {
    let item: WishlistDetail.Item
    let model: WishlistDetailModel
    @State private var note = ""
    @FocusState private var focused: Bool
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(l.t("wish.noteLabel")).font(.inter(12, .semibold)).foregroundStyle(Brand.muted)
            TextField(l.t("wish.notePlaceholder"), text: $note)
                .font(.inter(14))
                .focused($focused)
                .submitLabel(.done)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                .onSubmit(commit)
                .onChange(of: focused) { _, now in if !now { commit() } }
        }
        .onAppear { note = item.note ?? "" }
    }

    private func commit() {
        guard note.trimmingCharacters(in: .whitespacesAndNewlines) != (item.note ?? "") else { return }
        Task { await app.attempt(done: "wish.savedToast") { try await model.saveNote(item, note: note) } }
    }
}
