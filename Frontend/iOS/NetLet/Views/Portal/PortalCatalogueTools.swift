import SwiftUI
import UniformTypeIdentifiers

// MARK: - Bundles

/// Sets sold together for less — the web's `/admin/bundles`. A set saves
/// something or it is refused; NetLet's own sets may span two stores.
struct PortalBundlesView: View {
    struct Member: Identifiable, Hashable {
        let variantId: Int
        let title: String
        let option: String?
        let price: Money
        let image: String?
        var quantity: Int
        var id: Int { variantId }
    }

    @State private var bundles: [BundleRow]?
    @State private var failed: APIError?
    @State private var name = ""
    @State private var price = ""
    @State private var members: [Member] = []
    @State private var term = ""
    @State private var results: [SellerProduct] = []
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var separately: Money { Money(fils: members.reduce(0) { $0 + $1.price.fils * $1.quantity }) }
    private var priced: Money? { UploadPlan.isAmount(price.trimmingCharacters(in: .whitespaces)) ? Money(amount: price.trimmingCharacters(in: .whitespaces)) : nil }

    var body: some View {
        let saving = priced.map { separately - $0 }
        let noSaving = members.count >= 2 && saving.map { $0.fils <= 0 } == true
        PortalScreen(title: l.t("admin.bundles"), intro: l.t("admin.bundlesNote"), refresh: { await load() }) {
            PortalCard {
                Text(l.t("admin.bundleNew")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                LabeledField(label: l.t("admin.bundleName"), text: Binding(get: { name }, set: { name = String($0.prefix(200)) }))
                LabeledField(label: l.t("admin.bundlePrice"), text: Binding(get: { price }, set: { price = $0.filter { ("0"..."9").contains($0) || $0 == "." } }),
                             placeholder: "0.000", hint: priceHint(saving),
                             problem: noSaving ? l.t("bundle.noSaving") : nil, keyboard: .decimalPad, leftToRight: true)
                Text(l.t("admin.bundleMembers")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                if members.isEmpty {
                    Text(l.t("admin.bundleNoItems")).font(.inter(13)).foregroundStyle(Brand.muted)
                }
                ForEach(members) { member in memberRow(member) }
                finder
                Button { Task { await save() } } label: {
                    if self.saving { ProgressView().tint(.white) } else { Text(l.t("admin.bundleSave")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(self.saving || name.trimmingCharacters(in: .whitespaces).isEmpty || priced == nil || members.count < 2 || noSaving)
            }
            PortalSectionHeading(title: l.t("admin.bundleListTitle"))
            if let bundles {
                if bundles.isEmpty {
                    PortalEmpty(text: l.t("admin.bundlesEmpty"))
                } else {
                    ForEach(bundles) { bundle in bundleCard(bundle) }
                }
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .task { await load() }
        .onChange(of: term) { Task { await find() } }
    }

    /// What the set comes to bought separately, and what it saves.
    private func priceHint(_ saving: Money?) -> String? {
        guard !members.isEmpty else { return nil }
        let separate = l.t("admin.bundleTotalSeparately", ["amount": separately.formatted(l.current)])
        guard let saving, saving.fils > 0 else { return separate }
        return separate + " · " + l.t("admin.bundleSavingLine", ["amount": saving.formatted(l.current)])
    }

    private func memberRow(_ member: Member) -> some View {
        let label = member.option.map { "\(member.title) — \($0)" } ?? member.title
        return HStack(spacing: 10) {
            Color.clear.frame(width: 44, height: 44).overlay { RemoteImage(reference: member.image) }.clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(member.title).font(.inter(14, .semibold)).foregroundStyle(Brand.navy).lineLimit(2)
                Text([member.option, member.price.formatted(l.current)].compactMap { $0 }.joined(separator: " · ")).font(.inter(12)).foregroundStyle(Brand.muted)
            }
            Spacer(minLength: 4)
            Stepper(value: Binding(get: { member.quantity }, set: { value in
                if let index = members.firstIndex(where: { $0.id == member.id }) { members[index].quantity = value }
            }), in: 1...99) {
                Text("\(member.quantity)").font(.inter(14, .bold)).foregroundStyle(Brand.navy)
            }
            .fixedSize()
            .accessibilityLabel(l.t("admin.bundleQuantity", ["name": label]))
            Button { members.removeAll { $0.id == member.id } } label: {
                Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(Brand.danger).frame(width: 40, height: 40)
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("admin.bundleRemoveItem", ["name": label]))
        }
    }

    @ViewBuilder
    private var finder: some View {
        LabeledField(label: l.t("admin.bundleSearch"), text: $term, hint: l.t("admin.bundleSearchHint"))
        if term.trimmingCharacters(in: .whitespaces).count >= 2 {
            if results.isEmpty {
                Text(l.t("admin.bundleNoResults")).font(.inter(13)).foregroundStyle(Brand.muted)
            }
            ForEach(results) { product in
                VStack(alignment: .leading, spacing: 6) {
                    Text(product.title).font(.inter(14, .semibold)).foregroundStyle(Brand.navy)
                    if let store = product.vendorName { Text(store).font(.inter(12)).foregroundStyle(Brand.muted) }
                    FlowLayout(spacing: 6) {
                        ForEach(product.variants, id: \.id) { variant in
                            let option = variant.option
                            let inSet = members.contains { $0.variantId == variant.id }
                            Button {
                                add(Member(variantId: variant.id, title: product.title, option: option, price: variant.price, image: product.cover, quantity: 1))
                            } label: {
                                Label([option, variant.price.formatted(l.current), inSet ? "(\(l.t("admin.bundleInSet")))" : nil].compactMap { $0 }.joined(separator: " · "), systemImage: "plus")
                            }
                            .buttonStyle(PortalSmallButtonStyle())
                            .accessibilityLabel(l.t("admin.bundleAddThis", ["name": product.title]))
                        }
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.pearl.opacity(0.6)))
            }
        }
    }

    private func bundleCard(_ bundle: BundleRow) -> some View {
        PortalCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(bundle.name).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                    Text("\(bundle.bundlePrice.formatted(l.current)) · \(l.t("admin.bundleSeparately", ["amount": bundle.separately.formatted(l.current)]))").font(.inter(13)).foregroundStyle(Brand.body)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    if bundle.crossVendor {
                        StatusPill(label: l.t("admin.bundleCrossVendor", ["count": "\(Set(bundle.members.compactMap(\.vendorId)).count)"]), tone: .shipped)
                    }
                    StatusPill(label: l.t(bundle.active ? "admin.bundleActive" : "admin.bundleInactive"), tone: bundle.active ? .done : .waiting)
                }
            }
            ForEach(Array(bundle.members.enumerated()), id: \.offset) { _, member in
                Text("· \(member.productTitle)").font(.inter(13)).foregroundStyle(Brand.body)
            }
            Button(l.t(bundle.active ? "admin.bundleTakeOff" : "admin.bundlePutOn")) {
                Task {
                    if await app.attempt(fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.setBundleActive, .init(id: bundle.id, active: !bundle.active)) }) { await load() }
                }
            }
            .buttonStyle(PortalSmallButtonStyle(kind: bundle.active ? .danger : .secondary))
        }
    }

    private func add(_ member: Member) {
        if let index = members.firstIndex(where: { $0.variantId == member.variantId }) {
            members[index].quantity = min(99, members[index].quantity + 1)
        } else {
            members.append(member)
        }
    }

    private func find() async {
        let query = term.trimmingCharacters(in: .whitespaces)
        guard query.count >= 2 else { results = []; return }
        try? await Task.sleep(for: .milliseconds(250))
        guard query == term.trimmingCharacters(in: .whitespaces) else { return }
        results = (try? await app.services.api.call(API.sellerProducts, .init(pageSize: 6, query: query)))?.rows ?? results
    }

    private func load() async {
        do {
            bundles = try await app.services.api.call(API.bundleRows)
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, bundles == nil { failed = failure }
        }
    }

    private func save() async {
        guard let priced else { return }
        saving = true
        defer { saving = false }
        let actor = app.session.seller
        // NetLet's own sets belong to no store, which is how one spans two.
        let vendorId = actor?.can("platform.viewAll") == true ? nil : actor?.ownVendor
        let input = API.BundleInput(name: name.trimmingCharacters(in: .whitespaces), vendorId: OrNull(vendorId), bundlePrice: priced.amount,
                                    members: members.map { .init(variantId: $0.variantId, quantity: $0.quantity) })
        if await app.attempt(done: "admin.bundleSaved", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.saveBundle, input) }) {
            name = ""
            price = ""
            members = []
            await load()
        }
    }
}

// MARK: - Import

/// Many products from a spreadsheet — the web's `/admin/import`. The file is
/// read on the phone, every row that would be refused is named with its
/// line, and nothing is made until Create; what is made is drafts.
struct PortalImportView: View {
    @State private var plan: UploadPlan?
    @State private var fileName = ""
    @State private var picking = false
    @State private var stores: [StoreRow] = []
    @State private var store: Int?
    @State private var creating = false
    @State private var template: URL?
    /// How many rows the model filed that the words could not (3.3.5).
    @State private var modelFiled = 0
    @State private var filing = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    private var rules: WarehouseRules.Upload { WarehouseRules.shared.upload }

    /// The code page an older Excel saves an Arabic sheet in, when it is not UTF-8.
    private static let arabicWindows = String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(CFStringEncoding(CFStringEncodings.windowsArabic.rawValue)))

    var body: some View {
        let actor = app.session.seller
        let admin = actor?.kind == "admin"
        let vendorId = admin ? store : actor?.ownVendor
        PortalScreen(title: l.t("admin.import"), intro: l.t("admin.importNote")) {
            Button { shareTemplate() } label: { Label(l.t("admin.importTemplate"), systemImage: "arrow.down.doc") }
                .buttonStyle(PortalSmallButtonStyle())
            if admin {
                PortalCard {
                    Text(l.t("admin.importStoreTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                    Menu {
                        ForEach(stores, id: \.id) { row in Button(row.name) { store = row.id } }
                    } label: {
                        MenuField(text: stores.first { $0.id == store }?.name, placeholder: l.t("admin.chooseStore"))
                    }
                    Text(l.t("admin.newStoreHint")).font(.footnote).foregroundStyle(Brand.muted)
                }
            }
            PortalCard {
                Text(l.t("admin.importFileTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
                Text(l.t("admin.importFileHint")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                Button { picking = true } label: { Label(l.t("admin.importChoose"), systemImage: "square.and.arrow.up") }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                if !fileName.isEmpty { Text(fileName).font(.inter(12)).foregroundStyle(Brand.muted).environment(\.layoutDirection, .leftToRight) }
            }
            if let plan { check(plan, vendorId: vendorId, admin: admin) }
        }
        .task {
            if admin { stores = (try? await app.services.api.call(API.vendorRows, .init(pageSize: 200)))?.rows ?? [] }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText, .text]) { result in
            guard case .success(let url) = result else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: Self.arabicWindows) else {
                app.toast(l.t("admin.saveFailed"))
                return
            }
            fileName = url.lastPathComponent
            let read = UploadPlan.plan(text)
            plan = read
            modelFiled = 0
            Task { await file(read) }
        }
        .sheet(item: Binding(get: { template.map(SharedFile.init) }, set: { if $0 == nil { template = nil } })) { file in
            ActivitySheet(items: [file.url]).ignoresSafeArea()
        }
    }

    @ViewBuilder
    private func check(_ plan: UploadPlan, vendorId: Int?, admin: Bool) -> some View {
        let tooMany = plan.products.count > rules.limit
        PortalCard {
            Text(l.t("admin.importCheckTitle")).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            Text(l.t("admin.importSummary", ["rows": "\(plan.products.count)", "problems": "\(plan.problems.count)"])).font(.inter(13)).foregroundStyle(Brand.body)
            if plan.guessed > 0 {
                Label(l.t("admin.importGuessed", ["count": "\(plan.guessed)"]), systemImage: "sparkles").font(.inter(13)).foregroundStyle(Brand.navy)
                if modelFiled > 0 {
                    Text(l.t("admin.importModelFiled", ["count": "\(modelFiled)"])).font(.inter(13)).foregroundStyle(Brand.navy)
                }
            }
            if filing { Text(l.t("admin.importFiling")).font(.inter(13)).foregroundStyle(Brand.muted) }
            if !plan.problems.isEmpty {
                Text(l.t("admin.importProblems")).font(.inter(14, .bold)).foregroundStyle(Brand.danger)
                ForEach(Array(plan.problems.enumerated()), id: \.offset) { _, problem in
                    Text("\(l.t("admin.importLine", ["line": "\(problem.line)"])) · \(l.t(problem.reason))").font(.inter(13)).foregroundStyle(Brand.body)
                }
            }
            if !plan.products.isEmpty {
                Text(l.t("admin.importPreview")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                ForEach(plan.products.prefix(50), id: \.line) { product in
                    HStack(alignment: .top, spacing: 8) {
                        Text("\(product.line)").font(.inter(12)).foregroundStyle(Brand.muted).frame(width: 28, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(product.title).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                            Text([departmentName(product.category), product.categoryGuessed ? l.t("admin.importGuessTag") : nil].compactMap { $0 }.joined(separator: " · "))
                                .font(.inter(12)).foregroundStyle(Brand.muted)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(product.price).font(.inter(13, .semibold)).foregroundStyle(Brand.navy)
                            Text("\(l.t("admin.stock")): \(product.stock)").font(.inter(12)).foregroundStyle(Brand.muted)
                        }
                    }
                    Divider()
                }
                if plan.products.count > 50 {
                    Text(l.t("admin.importMore", ["count": "\(plan.products.count - 50)"])).font(.inter(12)).foregroundStyle(Brand.muted)
                }
            }
            if tooMany { Text(l.t("admin.importTooMany", ["limit": "\(rules.limit)"])).font(.inter(13, .semibold)).foregroundStyle(Brand.danger) }
            if admin && vendorId == nil && !plan.products.isEmpty { Text(l.t("admin.importStoreNeeded")).font(.inter(13)).foregroundStyle(Brand.accentInk) }
            Text(l.t("admin.importDrafts")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if app.session.seller?.can("product.create", vendorId: app.session.seller?.ownVendor) == true {
                Button { Task { await create(plan, vendorId: vendorId) } } label: {
                    if creating { ProgressView().tint(.white) } else { Label(l.t("admin.importCreate", ["count": "\(plan.products.count)"]), systemImage: "square.and.arrow.up") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(creating || plan.products.isEmpty || tooMany || vendorId == nil)
            }
        }
    }

    /// The rows the words could not place go to the model, a batch at a
    /// time, and come back as guesses the preview tags like any other. A
    /// refusal or nothing back leaves them as they were.
    private func file(_ read: UploadPlan) async {
        let actor = app.session.seller
        let vendorId = actor?.kind == "admin" ? store : actor?.ownVendor
        guard actor?.can("product.create", vendorId: actor?.ownVendor) == true else { return }
        let unplaced = read.products.filter { $0.category == nil }
        guard !unplaced.isEmpty else { return }
        filing = true
        defer { filing = false }
        var filed: [Int: String] = [:]
        let batch = max(1, rules.categoriseBatch)
        for start in stride(from: 0, to: unplaced.count, by: batch) {
            let rows = unplaced[start..<min(start + batch, unplaced.count)].map { API.CategoriseRow(line: $0.line, text: String("\($0.title) \($0.description)".prefix(600))) }
            guard let reply = try? await app.services.api.call(API.categoriseImport, .init(vendorId: vendorId, rows: Array(rows))), reply.available else { break }
            for (line, department) in reply.filed { if let number = Int(line) { filed[number] = department } }
        }
        guard !filed.isEmpty, plan?.products == read.products else { return }
        plan = read.filing(filed)
        modelFiled = filed.count
    }

    private func departmentName(_ name: String?) -> String {
        guard let name else { return l.t("admin.importNoCategory") }
        return ReferenceData.shared.departments.first { $0.name == name }.map { l.t($0.label) } ?? name
    }

    private func shareTemplate() {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("netlet-products.csv")
        do {
            try Data(("\u{FEFF}" + rules.template).utf8).write(to: url, options: .atomic)
            template = url
        } catch {
            app.toast(l.t("admin.saveFailed"))
        }
    }

    private func create(_ plan: UploadPlan, vendorId: Int?) async {
        guard let vendorId else { return }
        creating = true
        defer { creating = false }
        let rows = plan.products.map {
            API.ImportRow(title: $0.title, sku: $0.sku, price: $0.price, compareAtPrice: $0.compareAtPrice, stock: $0.stock,
                          category: $0.category, description: $0.description, imageUrl: $0.imageUrl)
        }
        var done: ImportDone?
        guard await app.attempt(fallback: "admin.saveFailed", { done = try await app.services.api.call(API.importProducts, .init(vendorId: vendorId, rows: rows)) }) else { return }
        app.toast(l.t("admin.importDone", ["count": "\(done?.created ?? rows.count)"]))
        dismiss()
    }
}
