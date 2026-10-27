import SwiftUI

/// The portal's products — the web's `/admin/products`: the store's whole
/// shelf with the status a shopper never sees, searched and narrowed on the
/// server (a filter over the rows already fetched searches one page), every
/// one opening its editor, and many at once published, archived, drafted,
/// repriced or restocked through the single-product operation, so every
/// guard still applies and the answer names each one refused and why.
struct PortalProductsView: View {
    @State private var rows: [SellerProduct] = []
    @State private var total = 0
    @State private var page = 1
    @State private var loading = false
    @State private var failed: APIError?
    @State private var search = ""
    @State private var status = "all"
    @State private var department: Int?
    @State private var stock: String?
    @State private var store: Int?
    @State private var categories: [Category] = []
    @State private var stores: [StoreRow] = []
    @State private var selected: Set<Int> = []
    @State private var selecting = false
    @State private var bulk: String?
    @State private var percent = "10"
    @State private var amount = "1"
    @State private var refused: [(title: String, reason: String)] = []
    @State private var deleting: SellerProduct?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    /// `?vendor=` — an administrator arriving from a store's "See its products".
    init(vendorId: Int? = nil) {
        _store = State(initialValue: vendorId)
    }

    private var actor: SellerIdentity? { app.session.seller }
    private var own: Int? { actor?.ownVendor }
    private var mayBulk: Bool { actor?.can("product.edit", vendorId: own) == true }
    private var mayCreate: Bool { actor?.can("product.create", vendorId: own) == true }

    var body: some View {
        PortalScreen(title: l.t("admin.products"), refresh: { await reload() }) {
            if mayCreate {
                HStack(spacing: 10) {
                    Button {
                        app.open(.portal(store.map { "/admin/products/new?vendor=\($0)" } ?? "/admin/products/new"))
                    } label: {
                        Label(l.t("admin.newProduct"), systemImage: "plus")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }
            }
            filters
            if mayBulk && !rows.isEmpty {
                Button(selecting ? l.t("admin.bulkClear") : l.t("admin.bulkActions")) {
                    selecting.toggle()
                    if !selecting { selected = [] }
                }
                .font(.inter(14, .semibold))
                .foregroundStyle(Brand.navy)
                .buttonStyle(.tap)
            }
            if selecting && !selected.isEmpty { bulkBar }
            if !refused.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(l.t("admin.bulkRefusedTitle", ["count": "\(refused.count)"])).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
                    ForEach(Array(refused.enumerated()), id: \.offset) { _, entry in
                        Text(entry.title + ": " + entry.reason).font(.inter(13)).foregroundStyle(Brand.body)
                    }
                    Button(l.t("admin.bulkClear")) { refused = [] }.font(.inter(13, .semibold)).buttonStyle(.tap)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color(red: 1, green: 240 / 255, blue: 171 / 255)))
            }
            list
        }
        .task { await prepare() }
        .onChange(of: search) { Task { try? await Task.sleep(for: .milliseconds(300)); await reload() } }
        .onChange(of: status) { Task { await reload() } }
        .onChange(of: department) { Task { await reload() } }
        .onChange(of: stock) { Task { await reload() } }
        .onChange(of: store) { Task { await reload() } }
        .sheet(item: $deleting) { product in
            DeleteProductSheet(product: product) { Task { await reload() } }
        }
        .confirmationDialog(bulkTitle, isPresented: Binding(get: { bulk != nil && bulk != "reprice" && bulk != "restock" }, set: { if !$0 { bulk = nil } }), titleVisibility: .visible) {
            Button(bulkConfirm) { Task { await runBulk() } }
            Button(l.t("common.cancel"), role: .cancel) { bulk = nil }
        } message: {
            Text(l.t("admin.bulkStatusBody"))
        }
        .sheet(isPresented: Binding(get: { bulk == "reprice" || bulk == "restock" }, set: { if !$0 { bulk = nil } })) {
            bulkAmountSheet
        }
    }

    // MARK: Filters

    private var filters: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Brand.muted)
                TextField(l.t("admin.searchProducts"), text: $search)
                    .font(.inter(16))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .submitLabel(.search)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
            .accessibilityElement(children: .combine)
            .accessibilityLabel(l.t("admin.searchProducts"))
            PortalSegmented(label: l.t("admin.filterStatus"), value: $status, options: [
                ("all", l.t("admin.statusAll")), ("draft", l.t("status.draft")), ("pending_review", l.t("status.pending_review")),
                ("published", l.t("status.published")), ("archived", l.t("status.archived")),
            ])
            HStack(spacing: 8) {
                Menu {
                    Button(l.t("nav.allDepartments")) { department = nil }
                    ForEach(categories) { category in
                        Button(category.displayName(l.current)) { department = category.id }
                    }
                } label: {
                    MenuField(text: department.flatMap { id in categories.first { $0.id == id }?.displayName(l.current) }, placeholder: l.t("nav.allDepartments"))
                }
                .accessibilityLabel(l.t("admin.filterDepartment"))
                Menu {
                    Button(l.t("admin.stockAny")) { stock = nil }
                    Button(l.t("admin.stockLow")) { stock = "low" }
                    Button(l.t("admin.stockOut")) { stock = "out" }
                } label: {
                    MenuField(text: stock.map { $0 == "out" ? l.t("admin.stockOut") : l.t("admin.stockLow") }, placeholder: l.t("admin.stockAny"))
                }
                .accessibilityLabel(l.t("admin.filterStock"))
            }
            if actor?.kind == "admin" && stores.count > 1 {
                Menu {
                    Button(l.t("admin.statusAllStores")) { store = nil }
                    ForEach(stores, id: \.id) { row in Button(row.name) { store = row.id } }
                } label: {
                    MenuField(text: store.flatMap { id in stores.first { $0.id == id }?.name }, placeholder: l.t("admin.statusAllStores"))
                }
                .accessibilityLabel(l.t("admin.filterStore"))
            }
        }
    }

    // MARK: The list

    @ViewBuilder
    private var list: some View {
        if let failed, rows.isEmpty {
            ErrorStateView(error: failed) { await reload() }
        } else if rows.isEmpty && loading {
            ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 120)
        } else if rows.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t(search.isEmpty && status == "all" ? "admin.noProducts" : "admin.noMatches")).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                if search.isEmpty && status == "all" { Text(l.t("admin.noProductsNote")).font(.inter(13)).foregroundStyle(Brand.body) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .card()
        } else {
            Text(l.productCount(total)).font(.inter(13)).foregroundStyle(Brand.muted)
            LazyVStack(spacing: 8) {
                ForEach(rows) { row in productRow(row) }
                if rows.count < total {
                    ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 50)
                        .task { await more() }
                }
            }
        }
    }

    private func productRow(_ row: SellerProduct) -> some View {
        HStack(spacing: 12) {
            if selecting {
                Button {
                    if selected.contains(row.id) { selected.remove(row.id) } else { selected.insert(row.id) }
                } label: {
                    Image(systemName: selected.contains(row.id) ? "checkmark.square.fill" : "square")
                        .font(.system(size: 22))
                        .foregroundStyle(selected.contains(row.id) ? Brand.navy : Brand.chevron)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("admin.selectProduct", ["title": row.title]))
                .accessibilityAddTraits(selected.contains(row.id) ? .isSelected : [])
            }
            Button {
                if PortalPage.draws("/admin/products/\(row.id)") { app.open(.portal("/admin/products/\(row.id)")) }
            } label: {
                HStack(spacing: 12) {
                    Color.clear
                        .frame(width: 56, height: 56)
                        .overlay { RemoteImage(reference: row.cover) }
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        Text(row.displayTitle(l.current)).font(.inter(14, .semibold)).foregroundStyle(Brand.ink).lineLimit(2).multilineTextAlignment(.leading)
                        HStack(spacing: 6) {
                            StatusPill(label: l.t(row.statusKey), tone: tone(row.status))
                            Text(row.cheapest?.formatted(l.current) ?? "—").font(.inter(12, .semibold)).foregroundStyle(Brand.navy)
                            Text(row.stock == 0 ? l.t("admin.outOfStock") : "\(l.t("admin.columnStock")): \(row.stock)")
                                .font(.inter(12, row.stock == 0 ? .semibold : .regular))
                                .foregroundStyle(row.stock == 0 ? Brand.danger : Brand.muted)
                        }
                        let where_ = [actor?.kind == "admin" ? row.vendorName : nil, row.categoryName.map(departmentName)].compactMap { $0 }
                        if !where_.isEmpty {
                            Text(where_.joined(separator: " · ")).font(.inter(12)).foregroundStyle(Brand.muted).lineLimit(1)
                        }
                        if let note = row.reviewNote, !note.isEmpty {
                            Text(note).font(.inter(12)).foregroundStyle(Brand.danger).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.tap)
            if actor?.can("product.delete", vendorId: row.vendorId) == true && !selecting {
                Button {
                    deleting = row
                } label: {
                    Image(systemName: "trash").font(.system(size: 15)).foregroundStyle(Brand.danger).frame(width: 44, height: 44)
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("admin.deleteNamed", ["title": row.title]))
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
    }

    private func tone(_ status: String) -> OrderTone {
        switch status {
        case "published": return .done
        case "pending_review": return .preparing
        case "archived": return .over
        default: return .waiting
        }
    }

    private func departmentName(_ name: String) -> String {
        ReferenceData.shared.departments.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }.map { l.t($0.label) } ?? name
    }

    // MARK: Bulk

    private var bulkBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("admin.selectedCount", ["count": "\(selected.count)"])).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
            FlowLayout(spacing: 8) {
                bulkButton("publish", l.t("admin.publish"), "paperplane")
                bulkButton("archive", l.t("admin.bulkArchive"), "archivebox")
                bulkButton("draft", l.t("admin.bulkDraft"), "doc")
                bulkButton("reprice", l.t("admin.bulkReprice"), "percent")
                if actor?.can("stock.adjust", vendorId: own) == true { bulkButton("restock", l.t("admin.bulkRestock"), "shippingbox") }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.tint))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("admin.bulkActions"))
    }

    private func bulkButton(_ action: String, _ label: String, _ symbol: String) -> some View {
        Button { bulk = action } label: {
            Label(label, systemImage: symbol)
                .font(.inter(13, .semibold))
                .foregroundStyle(Brand.navy)
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(Capsule().fill(Color.white))
                .overlay(Capsule().strokeBorder(Brand.line, lineWidth: 1))
        }
        .buttonStyle(.tap)
    }

    private var bulkTitle: String {
        let count = ["count": "\(selected.count)"]
        switch bulk {
        case "publish": return l.t("admin.bulkPublishTitle", count)
        case "archive": return l.t("admin.bulkArchiveTitle", count)
        case "draft": return l.t("admin.bulkDraftTitle", count)
        case "reprice": return l.t("admin.bulkRepriceTitle", count)
        default: return l.t("admin.bulkRestockTitle", count)
        }
    }

    private var bulkConfirm: String {
        switch bulk {
        case "publish": return l.t("admin.publish")
        case "archive": return l.t("admin.bulkArchive")
        case "draft": return l.t("admin.bulkDraft")
        default: return l.t("admin.bulkApply")
        }
    }

    private var bulkAmountSheet: some View {
        let rules = PortalRules.shared.bulk
        let repricing = bulk == "reprice"
        let percentValue = Double(percent.replacingOccurrences(of: "−", with: "-")) ?? .nan
        let amountValue = Int(amount) ?? 0
        let problem = repricing ? (rules?.percentProblem(percentValue) ?? true) : (rules?.restockProblem(amountValue) ?? true)
        return NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text(bulkTitle).font(.inter(18, .bold)).foregroundStyle(Brand.navy)
                Text(l.t(repricing ? "admin.bulkRepriceBody" : "admin.bulkRestockBody")).font(.inter(14)).foregroundStyle(Brand.body)
                if repricing {
                    let example = Money(fils: Int((10_000 * (1 + (percentValue.isFinite ? percentValue : 0) / 100)).rounded()))
                    LabeledField(
                        label: l.t("admin.bulkPercent"), text: $percent,
                        hint: problem ? nil : l.t("admin.bulkPercentHint", ["example": example.formatted(l.current)]),
                        problem: problem ? l.t("admin.bulkPercentInvalid") : nil,
                        keyboard: .numbersAndPunctuation, leftToRight: true
                    )
                } else {
                    LabeledField(label: l.t("admin.bulkAmount"), text: $amount, problem: problem ? l.t("admin.bulkRestockInvalid") : nil, keyboard: .numberPad, leftToRight: true)
                }
                Button(l.t("admin.bulkApply")) { Task { await runBulk() } }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(problem)
                Spacer()
            }
            .padding(20)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { BarButton(l.t("common.cancel")) { bulk = nil } }
            }
        }
        .presentationDetents([.medium])
        .environment(\.layoutDirection, l.layoutDirection)
    }

    private func runBulk() async {
        guard let action = bulk else { return }
        let ids = Array(selected)
        var input = API.Bulk(ids: ids, action: action)
        if action == "reprice" { input.percent = Double(percent.replacingOccurrences(of: "−", with: "-")) }
        if action == "restock" { input.amount = Int(amount) }
        bulk = nil
        var result: BulkResult?
        guard await app.attempt(fallback: "admin.saveFailed", { result = try await app.services.api.call(API.bulkProducts, input) }), let result else { return }
        let titles = Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0.title) })
        refused = result.refused.map { entry in
            (titles[entry.id] ?? "#\(entry.id)", Phrasebook.shared.has(entry.reason) ? l.t(entry.reason) : l.t("admin.bulkRefused"))
        }
        if result.done > 0 { app.toast(l.t("admin.bulkDone", ["count": "\(result.done)"])) }
        selected = Set(result.refused.map(\.id).filter(ids.contains))
        await reload()
    }

    // MARK: Loading

    private func prepare() async {
        let api = app.services.api
        async let found = try? api.call(API.categories)
        if actor?.kind == "admin" { stores = (try? await api.call(API.vendorRows, .init(pageSize: 200)))?.rows ?? [] }
        categories = await found ?? []
        await reload()
    }

    private func query(page: Int) -> API.SellerList {
        let term = search.trimmingCharacters(in: .whitespaces)
        return API.SellerList(
            vendorId: store ?? own, page: page, pageSize: 30, query: term.isEmpty ? nil : term,
            status: status == "all" ? nil : status, categoryId: department, stock: stock
        )
    }

    private func reload() async {
        loading = true
        defer { loading = false }
        do {
            let found = try await app.services.api.call(API.sellerProducts, query(page: 1))
            rows = found.rows
            total = found.total
            page = 1
            failed = nil
            selected = selected.intersection(found.rows.map(\.id))
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled { failed = failure }
        }
    }

    private func more() async {
        guard !loading, rows.count < total else { return }
        loading = true
        defer { loading = false }
        if let found = try? await app.services.api.call(API.sellerProducts, query(page: page + 1)) {
            rows += found.rows.filter { row in !rows.contains { $0.id == row.id } }
            total = found.total
            page += 1
        }
    }
}

/// A store as a list names it, for choosing one.
struct StoreRow: Decodable, Hashable, Sendable {
    let id: Int
    let name: String
}

struct StoreRows: Decodable, Sendable {
    let rows: [StoreRow]
    let total: Int
}

extension API {
    struct PageSize: Encodable, Sendable {
        let pageSize: Int
    }

    static let vendorRows = Procedure<PageSize, StoreRows>(query: "inventory.vendors.list")
}

/// Deleting for good, which asks for the name: the list is a column of
/// near-identical rows and the wrong one is one row away. It shows what goes
/// with it, and what refuses it, before anybody confirms.
struct DeleteProductSheet: View {
    let product: SellerProduct
    let done: () -> Void
    @State private var check: DeletionCheck?
    @State private var failed: String?
    @State private var typed = ""
    @State private var deleting = false
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Image(systemName: "trash").font(.system(size: 24)).foregroundStyle(Brand.danger)
                    Text(l.t("admin.deleteTitle", ["title": product.title])).font(.inter(18, .bold)).foregroundStyle(Brand.ink)
                    Text(l.t("admin.deleteBody")).font(.inter(14)).foregroundStyle(Brand.body)
                    if let check {
                        let counts: [(String, Int)] = [
                            ("admin.deleteCountVariants", check.variants), ("admin.deleteCountPhotos", check.images),
                            ("admin.deleteCountUnits", check.unitsOnHand), ("admin.deleteCountCarts", check.inCarts),
                            ("admin.deleteCountSaved", check.savedBy), ("admin.deleteCountBundles", check.bundles),
                            ("admin.deleteCountSubscriptions", check.subscriptions),
                        ].filter { $0.1 > 0 }
                        if !counts.isEmpty {
                            Text(l.t("admin.deleteGoesWith")).font(.inter(14, .bold)).foregroundStyle(Brand.ink)
                            ForEach(counts, id: \.0) { key, value in
                                HStack { Text(l.t(key)); Spacer(); Text("\(value)").fontWeight(.semibold) }.font(.inter(14))
                            }
                        }
                        if check.openOrderLines > 0 {
                            Text(l.t("admin.deleteOpenOrders", ["count": "\(check.openOrderLines)"])).font(.inter(13)).foregroundStyle(Brand.body)
                        }
                        if !check.blockers.isEmpty {
                            Text(l.t("admin.deleteBlockedHeading")).font(.inter(14, .bold)).foregroundStyle(Brand.danger)
                            ForEach(check.blockers, id: \.self) { key in Text(l.t(key)).font(.inter(13)).foregroundStyle(Brand.body) }
                            Text(l.t("admin.deleteUnpublishInstead")).font(.inter(13)).foregroundStyle(Brand.muted)
                        } else {
                            LabeledField(label: l.t("admin.deleteTypeName", ["title": product.title]), text: $typed)
                            Button(role: .destructive) {
                                Task { await delete() }
                            } label: {
                                Label(l.t("admin.deleteProduct"), systemImage: "trash")
                            }
                            .buttonStyle(DangerButtonStyle())
                            .disabled(deleting || typed.trimmingCharacters(in: .whitespaces).lowercased() != product.title.trimmingCharacters(in: .whitespaces).lowercased())
                        }
                    } else if let failed {
                        Text(failed).font(.inter(14)).foregroundStyle(Brand.danger)
                    } else {
                        HStack(spacing: 8) { ProgressView(); Text(l.t("admin.deleteChecking")) }.font(.inter(14))
                    }
                }
                .padding(20)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { BarButton(l.t("common.cancel")) { dismiss() }.disabled(deleting) }
            }
        }
        .environment(\.layoutDirection, l.layoutDirection)
        .task {
            do {
                check = try await app.services.api.call(API.deletionCheck, .init(id: product.id))
            } catch {
                let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
                failed = l.t(key == "error.serverProblem" ? "admin.loadFailed" : key)
            }
        }
    }

    private func delete() async {
        deleting = true
        defer { deleting = false }
        var gone: DeletedProduct?
        if await app.attempt(fallback: "admin.saveFailed", { gone = try await app.services.api.call(API.deleteProduct, .init(id: product.id)) }) {
            app.toast(l.t("admin.deleted", ["title": gone?.title ?? product.title]))
            done()
            dismiss()
        }
    }
}
