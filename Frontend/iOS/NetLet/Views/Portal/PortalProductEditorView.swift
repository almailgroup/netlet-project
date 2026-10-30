import PhotosUI
import SwiftUI

/// One product in the portal — the web's `/admin/products/:id`. Each section
/// saves its own fields only, so somebody fixing a spelling does not rewrite
/// the price on the way past; publishing is its own act and says what
/// happened ("In review" for a store whose listings are checked first).
struct PortalProductEditorView: View {
    let productId: Int
    @State private var product: EditableProduct?
    @State private var loaded = false
    @State private var failed: APIError?
    @State private var categories: [Category] = []
    @State private var stores: [StoreRow] = []
    @State private var open: Set<String> = ["details"]
    @State private var deleting: SellerProduct?
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    private var actor: SellerIdentity? { app.session.seller }

    var body: some View {
        PortalScreen(title: product?.title ?? l.t("admin.products"), refresh: { await load() }) {
            if let product {
                header(product)
                editor(product)
            } else if loaded {
                PortalEmpty(text: l.t("product.notFound"))
            } else if let failed {
                ErrorStateView(error: failed) { await load() }
            } else {
                ProgressView().tint(Brand.navy).frame(maxWidth: .infinity, minHeight: 160)
            }
        }
        .task { await prepare() }
        .sheet(item: $deleting) { row in
            DeleteProductSheet(product: row) { dismiss() }
        }
    }

    // MARK: Header

    @ViewBuilder
    private func header(_ product: EditableProduct) -> some View {
        let mayPublish = actor?.can("product.publish", vendorId: product.vendorId) == true
        FlowLayout(spacing: 8) {
            StatusPill(label: l.t(SellerProduct.statusKeyFor(product.status)), tone: .portal(product.status == "published" ? "good" : product.status == "pending_review" ? "warning" : "neutral"))
            if product.status == "published" {
                Button { app.open(.product(handle: product.handle)) } label: { Label(l.t("admin.viewInShop"), systemImage: "arrow.up.forward.square") }
                    .buttonStyle(PortalSmallButtonStyle())
            }
            if mayPublish {
                if product.status == "published" {
                    Button(l.t("admin.unpublish")) { Task { await setStatus(product, "draft") } }
                        .buttonStyle(PortalSmallButtonStyle()).disabled(busy)
                } else {
                    Button(l.t("admin.publish")) { Task { await setStatus(product, "published") } }
                        .buttonStyle(PortalSmallButtonStyle(kind: .primary)).disabled(busy)
                }
            }
        }
        // A was-price the store's permit does not cover stays saved and is not shown.
        if let hidden = product.offerHidden {
            Label(l.t(hidden == "expired" ? "admin.offerHiddenExpired" : "admin.offerHiddenMissing"), systemImage: "info.circle")
                .font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
        }
        if let note = product.reviewNote, !note.isEmpty {
            Text(note).font(.inter(13)).foregroundStyle(Brand.danger).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Sections

    @ViewBuilder
    private func editor(_ product: EditableProduct) -> some View {
        let mayEdit = actor?.can("product.edit", vendorId: product.vendorId) == true
        section("details", l.t("admin.sectionDetails")) {
            DetailsSection(product: product, categories: categories, mayEdit: mayEdit) { await reload() }
        }
        section("photos", l.t("admin.images")) {
            GallerySection(product: product, mayEdit: mayEdit) { await reload() }
        }
        section("variants", l.t("admin.variants")) {
            VariantsSection(product: product, mayEdit: mayEdit) { await reload() }
        }
        section("shipping", l.t("admin.sectionShipping")) {
            ShippingSection(product: product, departmentSlug: categories.first { $0.id == product.categoryId }?.slug, mayEdit: mayEdit) { await reload() }
        }
        section("sizes", l.t("admin.sectionSizes")) {
            SizeChartSection(product: product, mayEdit: mayEdit) { await reload() }
        }
        section("extras", l.t("admin.addons")) {
            AddonsSection(product: product, mayEdit: mayEdit) { await reload() }
        }
        if mayEdit {
            section("affiliates", l.t("admin.productAffiliates")) {
                AffiliateSection(product: product) { await reload() }
            }
        }
        if actor?.can("vendor.setCommission") == true {
            section("commission", l.t("admin.productCommission")) {
                CommissionSection(product: product) { await reload() }
            }
        } else if mayEdit {
            /* A store asking for a rate of its own (3.3.2); NetLet decides. */
            section("propose", l.t("commission.proposeTitle")) {
                ProposeCommissionSection(product: product, mayStoreWide: actor?.can("vendor.editProfile", vendorId: product.vendorId) == true)
            }
        }
        if actor?.can("product.reassign") == true {
            section("store", l.t("admin.sectionStore")) {
                StoreSection(product: product, stores: stores) { await reload() }
            }
        }
        if actor?.can("product.delete", vendorId: product.vendorId) == true {
            PortalCard {
                Text(l.t("admin.deleteProduct")).font(.inter(15, .bold)).foregroundStyle(Brand.danger)
                Text(l.t("admin.deleteSectionNote")).font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                Button { deleting = summary(product) } label: { Label(l.t("admin.deleteProduct"), systemImage: "trash") }
                    .buttonStyle(PortalSmallButtonStyle(kind: .danger))
            }
        }
    }

    /// A section that opens in place: on a phone the editor is one long page,
    /// so each part folds, and the details start open.
    private func section<Content: View>(_ id: String, _ title: String, @ViewBuilder content: @escaping () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) {
                    if open.contains(id) { open.remove(id) } else { open.insert(id) }
                }
            } label: {
                HStack {
                    Text(title).font(.inter(16, .bold)).foregroundStyle(Brand.navy)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.muted).rotationEffect(.degrees(open.contains(id) ? 180 : 0))
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 14))
            .accessibilityAddTraits(open.contains(id) ? .isSelected : [])
            if open.contains(id) {
                Divider()
                VStack(alignment: .leading, spacing: 12, content: content).padding(14)
            }
        }
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func summary(_ product: EditableProduct) -> SellerProduct {
        SellerProduct(id: product.id, handle: product.handle, title: product.title, titleAr: product.titleAr, status: product.status,
                      reviewNote: product.reviewNote, variants: [], vendorId: product.vendorId)
    }

    // MARK: Loading and acts

    private func prepare() async {
        let api = app.services.api
        async let found = try? api.call(API.categories)
        if actor?.can("product.reassign") == true {
            stores = (try? await api.call(API.vendorRows, .init(pageSize: 200)))?.rows ?? []
        }
        categories = await found ?? []
        await load()
    }

    private func load() async {
        do {
            product = try await app.services.api.call(API.editableProduct, .init(id: productId))
            loaded = true
            failed = nil
        } catch {
            let failure = APIError.from(error)
            if failure != .cancelled, product == nil { failed = failure }
        }
    }

    private func reload() async { await load() }

    private func setStatus(_ product: EditableProduct, _ status: String) async {
        busy = true
        defer { busy = false }
        var answer: String?
        guard await app.attempt(fallback: "admin.saveFailed", { answer = try await app.services.api.call(API.saveProductStatus, .init(id: product.id, status: status)) }) else { return }
        app.toast(l.t(answer == "pending_review" ? "admin.sentForReview" : answer == "published" ? "admin.nowLive" : "admin.saved"))
        if answer != "draft", let hidden = product.offerHidden {
            app.toast(l.t(hidden == "expired" ? "admin.offerHiddenExpired" : "admin.offerHiddenMissing"))
        }
        await load()
    }
}

extension SellerProduct {
    static func statusKeyFor(_ status: String) -> String {
        switch status {
        case "published": return "status.published"
        case "pending_review": return "status.pending_review"
        case "archived": return "status.archived"
        default: return "status.draft"
        }
    }
}

/// The save button every section ends on.
struct SectionSave: View {
    let pending: Bool
    var disabled = false
    let action: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Button(action: action) {
            if pending { ProgressView().tint(.white) } else { Label(l.t("admin.save"), systemImage: "square.and.arrow.down") }
        }
        .buttonStyle(PortalSmallButtonStyle(kind: .primary))
        .disabled(pending || disabled)
    }
}

/// A menu of choices with its label above it, the portal's `Select`. An
/// option keyed "" is the "none" choice and is handed back as nil.
struct ChoiceField: View {
    let label: String
    var hint: String?
    let current: String?
    let placeholder: String
    let options: [(String, String)]
    var enabled = true
    let choose: (String?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            Menu {
                ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                    Button(option.1) {
                        Haptics.tap()
                        choose(option.0.isEmpty ? nil : option.0)
                    }
                }
            } label: {
                MenuField(text: current.flatMap { value in options.first { $0.0 == value }?.1 }, placeholder: placeholder)
            }
            .disabled(!enabled)
            .accessibilityLabel(label)
            if let hint { Text(hint).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true) }
        }
    }
}

// MARK: - Details

private struct DetailsSection: View {
    let product: EditableProduct
    let categories: [Category]
    let mayEdit: Bool
    let saved: () async -> Void
    @State private var title = ""
    @State private var titleAr = ""
    @State private var description = ""
    @State private var descriptionAr = ""
    @State private var categoryId: Int?
    @State private var tags = ""
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            LabeledField(label: l.t("admin.fieldTitle"), text: $title)
            LabeledField(label: l.t("admin.fieldTitleAr"), text: $titleAr)
                .environment(\.layoutDirection, .rightToLeft)
            ChoiceField(label: l.t("admin.fieldCategory"), current: categoryId.map(String.init), placeholder: l.t("admin.fieldNoCategory"),
                        options: [("", l.t("admin.fieldNoCategory"))] + categories.map { (String($0.id), $0.displayName(l.current)) }, enabled: mayEdit) {
                categoryId = $0.flatMap(Int.init)
            }
            LabeledField(label: l.t("admin.fieldDescription"), text: $description, axis: .vertical)
            LabeledField(label: l.t("admin.fieldDescriptionAr"), text: $descriptionAr, hint: l.t("admin.fieldDescriptionArHint"), axis: .vertical)
                .environment(\.layoutDirection, .rightToLeft)
            LabeledField(label: l.t("admin.fieldTags"), text: $tags, hint: l.t("admin.tagsHint"))
            if mayEdit {
                SectionSave(pending: saving, disabled: title.trimmingCharacters(in: .whitespaces).isEmpty) { Task { await save() } }
            }
        }
        .disabled(!mayEdit)
        .onAppear(perform: fill)
        .onChange(of: product.id) { fill() }
    }

    private func fill() {
        title = product.title
        titleAr = product.titleAr ?? ""
        description = product.description ?? ""
        descriptionAr = product.descriptionAr ?? ""
        categoryId = product.categoryId
        tags = product.tags.joined(separator: ", ")
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let input = API.ProductDetails(
            id: product.id, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            titleAr: .text(titleAr), description: .text(description), descriptionAr: .text(descriptionAr),
            categoryId: OrNull(categoryId), tags: tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        )
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.saveProductDetails, input) }) {
            await saved()
        }
    }
}

// MARK: - Photos

private struct GallerySection: View {
    let product: EditableProduct
    let mayEdit: Bool
    let saved: () async -> Void

    struct Item: Identifiable, Hashable {
        let id = UUID()
        var url: String
        var altText: String
        var kind: String
        var posterUrl: String
    }

    @State private var items: [Item] = []
    @State private var picked: PhotosPickerItem?
    @State private var uploading = false
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            Text(l.t("admin.imagesHint")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if items.isEmpty {
                Text(l.t("admin.noImages")).font(.inter(14)).foregroundStyle(Brand.muted)
            }
            ForEach(items) { entry in
                let item = edit(entry.id)
                HStack(alignment: .top, spacing: 10) {
                    Color.clear.frame(width: 64, height: 64)
                        .overlay { RemoteImage(reference: entry.kind == "video" ? (entry.posterUrl.isEmpty ? nil : entry.posterUrl) : entry.url) }
                        .overlay { if entry.kind == "video" { Image(systemName: "play.fill").foregroundStyle(.white).shadow(radius: 2) } }
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 8) {
                        LabeledField(label: l.t("admin.imageUrl"), text: item.url, keyboard: .URL, content: .URL, leftToRight: true)
                        LabeledField(label: l.t("admin.imageAlt"), text: item.altText)
                        ChoiceField(label: l.t("admin.mediaKind"), current: entry.kind, placeholder: l.t("admin.mediaImage"),
                                    options: [("image", l.t("admin.mediaImage")), ("video", l.t("admin.mediaVideo"))], enabled: mayEdit) {
                            item.wrappedValue.kind = $0 ?? "image"
                        }
                        if entry.kind == "video" {
                            LabeledField(label: l.t("admin.mediaPoster"), text: item.posterUrl, hint: l.t("admin.mediaPosterHint"), keyboard: .URL, leftToRight: true)
                        }
                    }
                    if mayEdit {
                        Button { items.removeAll { $0.id == entry.id } } label: {
                            Image(systemName: "trash").font(.system(size: 15)).foregroundStyle(Brand.danger).frame(width: 44, height: 44)
                        }
                        .buttonStyle(.tap)
                        .accessibilityLabel(l.t("admin.removeImage"))
                    }
                }
                Divider()
            }
            if mayEdit {
                FlowLayout(spacing: 8) {
                    // A photo from the library is made ready on the phone and
                    // uploaded at once, like the new-product form's.
                    PhotosPicker(selection: $picked, matching: .images) {
                        if uploading { ProgressView() } else { Label(l.t("media.upload"), systemImage: "photo.on.rectangle") }
                    }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(uploading || items.count >= ReferenceData.shared.rules.listing.maxPhotos)
                    Button { items.append(Item(url: "", altText: "", kind: "image", posterUrl: "")) } label: { Label(l.t("admin.addImage"), systemImage: "plus") }
                        .buttonStyle(PortalSmallButtonStyle())
                    SectionSave(pending: saving) { Task { await save() } }
                }
            }
        }
        .onAppear(perform: fill)
        .onChange(of: product.images) { fill() }
        .onChange(of: picked) { Task { await upload() } }
    }

    private func edit(_ id: UUID) -> Binding<Item> {
        Binding(get: { items.first { $0.id == id } ?? Item(url: "", altText: "", kind: "image", posterUrl: "") },
                set: { new in if let index = items.firstIndex(where: { $0.id == id }) { items[index] = new } })
    }

    private func fill() {
        items = product.images.map { Item(url: $0.url, altText: $0.altText ?? "", kind: $0.kind, posterUrl: $0.posterUrl ?? "") }
    }

    private func upload() async {
        guard let picked else { return }
        uploading = true
        defer {
            uploading = false
            self.picked = nil
        }
        guard let data = try? await picked.loadTransferable(type: Data.self) else { return }
        do {
            let jpeg = try ImagePreparation.jpeg(from: data, rules: ReferenceData.shared.rules.media)
            let uploaded = try await app.services.seller.upload(jpeg: jpeg)
            items.append(Item(url: uploaded.url, altText: "", kind: "image", posterUrl: ""))
            Haptics.succeeded()
        } catch ImagePreparation.Problem.tooSmall {
            app.toast(l.t("media.tooSmall"))
        } catch {
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(key == "error.serverProblem" ? "media.notAnImage" : key))
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let images = items.filter { !$0.url.trimmingCharacters(in: .whitespaces).isEmpty }.map { item in
            API.GalleryItem(url: item.url.trimmingCharacters(in: .whitespaces), altText: .text(item.altText), kind: item.kind,
                            posterUrl: item.kind == "video" ? .text(item.posterUrl) : OrNull(nil))
        }
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.saveGallery, .init(id: product.id, images: images)) }) {
            await saved()
        }
    }
}

// MARK: - Variants

private struct VariantsSection: View {
    let product: EditableProduct
    let mayEdit: Bool
    let saved: () async -> Void
    @State private var adding = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let records = product.variants.map { $0.options ?? [:] }
        Group {
            // Says how shoppers will choose: by the options when they tell every
            // variant apart, by name otherwise (`choiceMode`).
            if product.variants.count > 1 {
                Label(ListingRules.optionsDistinguish(records)
                      ? l.t("admin.variantsByOptions", ["names": ListingRules.varyingOptionNames(records).joined(separator: l.current == .ar ? "، " : ", ")])
                      : l.t("admin.variantsByName"), systemImage: "info.circle")
                    .font(.inter(13)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(product.variants) { variant in
                VariantEditor(productId: product.id, variant: variant, knownNames: Array(Set(records.flatMap(\.keys))).sorted(), mayEdit: mayEdit,
                              mayStock: app.session.seller?.can("stock.adjust", vendorId: product.vendorId) == true && (variant.centreId == nil || app.session.seller?.kind == "admin"),
                              saved: saved)
                    .id(variant.id)
            }
            if mayEdit {
                Button { Task { await add() } } label: { Label(l.t("admin.addVariant"), systemImage: "plus") }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(adding)
            }
        }
    }

    private func add() async {
        adding = true
        defer { adding = false }
        let input = API.VariantInput(productId: product.id, title: l.t("admin.addVariant"), price: "0.000")
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.saveVariant, input) }) {
            await saved()
        }
    }
}

/// One variant: its name, code, prices, how it is sold, its options, its
/// pre-order allowance and its stock — which only moves by a delta with a
/// reason, never by typing a new total.
private struct VariantEditor: View {
    let productId: Int
    let variant: EditableProduct.Variant
    let knownNames: [String]
    let mayEdit: Bool
    let mayStock: Bool
    let saved: () async -> Void
    @State private var title = ""
    @State private var sku = ""
    @State private var price = ""
    @State private var compareAt = ""
    @State private var memberPrice = ""
    @State private var unit = "each"
    @State private var step = "1"
    @State private var preorder = "0"
    @State private var releaseOn: Date?
    @State private var pairs: [ListingRules.OptionPair] = []
    @State private var delta = 1
    @State private var reason = "received"
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: ListingRules { .shared }

    var body: some View {
        let stepValue = Double(step) ?? .nan
        let measureOk = rules.isValidMeasure(unit: unit, step: stepValue)
        let allowance = Int(preorder) ?? -1
        let held = variant.centreId != nil
        let preorderOk = allowance >= 0 && !(held && allowance > 0)
        let memberProblem = memberPriceProblem(list: Money(amount: price), member: memberPrice)
        let optionProblem = rules.optionProblem(pairs)
        let perUnit = Money(amount: price).flatMap { rules.unitPrice($0, unit: unit, step: stepValue) }
        let perUnitText = perUnit.map { l.t("unit.perUnit", ["price": $0.price.amount, "unit": l.t(UnitWords.unit($0.unit))]) } ?? "—"
        VStack(alignment: .leading, spacing: 10) {
            LabeledField(label: l.t("admin.variantTitle"), text: $title)
            HStack(alignment: .top, spacing: 8) {
                LabeledField(label: l.t("admin.variantSku"), text: $sku, leftToRight: true)
                LabeledField(label: l.t("admin.variantPrice"), text: $price, hint: l.t("admin.priceHint"), keyboard: .decimalPad, leftToRight: true)
            }
            HStack(alignment: .top, spacing: 8) {
                LabeledField(label: l.t("admin.variantCompareAt"), text: $compareAt, keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: l.t("membership.memberPriceLabel"), text: $memberPrice,
                             hint: memberProblem == nil ? l.t("membership.memberPriceHint") : nil,
                             problem: memberProblem.map { l.t($0) }, keyboard: .decimalPad, leftToRight: true)
            }
            HStack(alignment: .top, spacing: 8) {
                ChoiceField(label: l.t("admin.variantUnit"), current: unit, placeholder: l.t("unit.each"),
                            options: rules.sellUnits.map { ($0, l.t(UnitWords.unit($0))) }, enabled: mayEdit) { chosen in
                    unit = chosen ?? "each"
                    if unit == "each" { step = "1" }
                }
                LabeledField(label: l.t("admin.variantStep"), text: $step, problem: measureOk ? nil : l.t("admin.variantStepInvalid"), keyboard: .decimalPad, leftToRight: true)
                    .disabled(unit == "each")
            }
            Text("\(l.t("admin.variantUnitPrice")): \(perUnitText)")
                .font(.inter(13)).foregroundStyle(Brand.body)
            options(optionProblem)
            HStack(alignment: .top, spacing: 8) {
                LabeledField(label: l.t("admin.preorderStock"), text: $preorder, hint: l.t("admin.preorderStockHint"), keyboard: .numberPad, leftToRight: true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(l.t("admin.preorderReleaseAt")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
                    DatePicker(l.t("admin.preorderReleaseAt"), selection: Binding(get: { releaseOn ?? Date() }, set: { releaseOn = $0 }), displayedComponents: .date)
                        .labelsHidden()
                        .kuwaitDays()
                        .disabled(allowance <= 0)
                    Text(l.t("admin.preorderReleaseHint")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack {
                (Text("\(l.t("admin.variantStock")): ") + Text("\(variant.stock)").fontWeight(.bold).foregroundColor(variant.stock == 0 ? Brand.danger : Brand.navy))
                    .font(.inter(14))
                if held { StatusPill(label: l.t("fulfilment.heldBadge"), tone: .shipped) }
                Spacer()
                if mayEdit {
                    SectionSave(pending: saving, disabled: !measureOk || !preorderOk || memberProblem != nil || optionProblem != nil) { Task { await save(stepValue, allowance) } }
                }
            }
            if mayStock { adjuster }
        }
        .disabled(!mayEdit && !mayStock)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.pearl.opacity(0.6)))
        .onAppear(perform: fill)
    }

    @ViewBuilder
    private func options(_ problem: String?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(l.t("admin.variantOptions")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            Text("\(l.t("admin.variantOptionsHint")) \(l.t("admin.variantPhotoHint"))").font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            ForEach(pairs.indices, id: \.self) { index in
                HStack(spacing: 6) {
                    TextField(l.t("admin.optionName"), text: Binding(get: { index < pairs.count ? pairs[index].name : "" }, set: { if index < pairs.count { pairs[index].name = String($0.prefix(rules.optionNameMax)) } }))
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel(l.t("admin.optionName"))
                    TextField(l.t("admin.optionValue"), text: Binding(get: { index < pairs.count ? pairs[index].value : "" }, set: { if index < pairs.count { pairs[index].value = String($0.prefix(rules.optionValueMax)) } }))
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel(l.t("admin.optionValue"))
                    if mayEdit {
                        Button { pairs.remove(at: index) } label: {
                            Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(Brand.danger).frame(width: 40, height: 40)
                        }
                        .buttonStyle(.tap)
                        .accessibilityLabel(l.t("admin.removeOption"))
                    }
                }
            }
            if mayEdit {
                Button {
                    let used = Set(pairs.map { $0.name.trimmingCharacters(in: .whitespaces).lowercased() })
                    pairs.append(.init(name: knownNames.first { !used.contains($0.lowercased()) } ?? "", value: ""))
                } label: { Label(l.t("admin.addOption"), systemImage: "plus") }
                .buttonStyle(PortalSmallButtonStyle())
            }
            if let problem { Text(l.t(problem)).font(.footnote).foregroundStyle(Brand.danger) }
        }
    }

    private var adjuster: some View {
        let problem = ListingRules.stockMoveProblem(delta, reason: reason)
        return VStack(alignment: .leading, spacing: 8) {
            Divider()
            HStack(spacing: 8) {
                Text(l.t("admin.adjustBy")).font(.inter(13, .semibold)).foregroundStyle(Brand.ink)
                Stepper(value: $delta, in: -100_000...100_000) {
                    Text(delta > 0 ? "+\(delta)" : "\(delta)").font(.inter(15, .bold)).foregroundStyle(Brand.navy).environment(\.layoutDirection, .leftToRight)
                }
                .accessibilityLabel(l.t("admin.adjustBy"))
            }
            HStack(spacing: 8) {
                ChoiceField(label: l.t("admin.reason"), current: reason, placeholder: "",
                            options: rules.stockReasons.map { ($0, StockWords.reason($0).map { l.t($0) } ?? $0) }) { reason = $0 ?? "received" }
                Button(l.t("admin.adjustStock")) { Task { await adjust() } }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled(saving || problem != nil)
            }
            if problem == "stock.wrongDirection" { Text(l.t("stock.wrongDirection")).font(.footnote).foregroundStyle(Brand.danger) }
        }
    }

    private func fill() {
        title = variant.title
        sku = variant.sku ?? ""
        price = variant.price
        compareAt = variant.compareAtPrice ?? ""
        memberPrice = variant.memberPrice ?? ""
        unit = variant.unit ?? "each"
        step = SizeGuideSheetNumber.text(variant.step)
        preorder = "\(variant.preorderStock ?? 0)"
        releaseOn = variant.preorderReleaseAt
        pairs = (variant.options ?? [:]).sorted { $0.key < $1.key }.map { .init(name: $0.key, value: $0.value) }
    }

    private func save(_ stepValue: Double, _ allowance: Int) async {
        saving = true
        defer { saving = false }
        let day: String? = allowance > 0 ? releaseOn.map { date in
            let formatter = DateFormatter()
            formatter.calendar = Calendar(identifier: .gregorian)
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(identifier: "Asia/Kuwait")
            formatter.dateFormat = "yyyy-MM-dd"
            return formatter.string(from: date)
        } : nil
        let input = API.VariantInput(
            id: variant.id, productId: productId, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            sku: .text(sku), price: price.trimmingCharacters(in: .whitespaces), compareAtPrice: .text(compareAt),
            unit: unit, stepAmount: stepValue, preorderStock: allowance, preorderReleaseAt: OrNull(day),
            memberPrice: .text(memberPrice), options: rules.optionsRecord(pairs)
        )
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", { _ = try await app.services.api.call(API.saveVariant, input) }) {
            await saved()
        }
    }

    private func adjust() async {
        saving = true
        defer { saving = false }
        var count: Int?
        guard await app.attempt(fallback: "admin.saveFailed", { count = try await app.services.api.call(API.adjustVariantStock, .init(variantId: variant.id, delta: delta, reason: reason)) }) else { return }
        app.toast(l.t("admin.stockUpdated", ["count": "\(count ?? variant.stock + delta)"]))
        delta = 1
        await saved()
    }
}

enum UnitWords {
    static func unit(_ unit: String) -> String {
        switch unit {
        case "g": return "unit.g"
        case "kg": return "unit.kg"
        case "ml": return "unit.ml"
        case "l": return "unit.l"
        default: return "unit.each"
        }
    }
}

// MARK: - Shipping and specifications

private struct ShippingSection: View {
    let product: EditableProduct
    let departmentSlug: String?
    let mayEdit: Bool
    let saved: () async -> Void
    @State private var specs: [String: String] = [:]
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: ListingRules { .shared }

    var body: some View {
        let fields = rules.fields(departmentSlug)
        let kept = rules.freeFormRows(product.attributes ?? [], departmentSlug: departmentSlug)
        Group {
            // A seller's band, or the store's when it says nothing: NetLet
            // promises nothing for a seller.
            ChoiceField(label: l.t("admin.fieldDeliverySpeedProduct"), current: product.deliverySpeed, placeholder: l.t("admin.speedInherit"),
                        options: [("", l.t("admin.speedInherit"))] + rules.deliverySpeeds.map { ($0, l.t(ShippingWords.speed($0))) }, enabled: mayEdit) { speed in
                Task { await run { try await $0.call(API.saveDeliverySpeed, .init(productId: product.id, speed: OrNull(speed))) } }
            }
            ChoiceField(label: l.t("admin.fieldSizeClass"),
                        hint: rules.vehicle(forSizeClass: product.sizeClass).map { l.t("admin.needsVehicle", ["vehicle": l.t(ShippingWords.vehicle($0))]) },
                        current: product.sizeClass, placeholder: l.t("admin.sizeUnset"),
                        options: [("", l.t("admin.sizeUnset"))] + rules.sizeClasses.map { ($0, l.t(ShippingWords.size($0))) }, enabled: mayEdit) { size in
                Task { await run { try await $0.call(API.saveSizeClass, .init(productId: product.id, sizeClass: OrNull(size))) } }
            }
            ChoiceField(label: l.t("admin.offersProductOpen"), current: product.acceptsOffers.map { $0 ? "true" : "false" }, placeholder: l.t("admin.offersProductInherit"),
                        options: [("", l.t("admin.offersProductInherit")), ("true", l.t("admin.offersProductYes")), ("false", l.t("admin.offersProductNo"))], enabled: mayEdit) { choice in
                Task { await run { try await $0.call(API.saveProductTakesAsks, .init(productId: product.id, accepts: OrNull(choice.map { $0 == "true" }))) } }
            }
            if !fields.isEmpty {
                Divider()
                Text(l.t("admin.specifications")).font(.inter(14, .bold)).foregroundStyle(Brand.navy)
                ForEach(fields, id: \.key) { field in
                    if let options = field.options {
                        ChoiceField(label: field.shown(l.current), current: specs[field.key].flatMap { $0.isEmpty ? nil : $0 }, placeholder: l.t("admin.sizeUnset"),
                                    options: [("", l.t("admin.sizeUnset"))] + options.map { ($0, $0) }, enabled: mayEdit) { specs[field.key] = $0 ?? "" }
                    } else {
                        LabeledField(label: field.shown(l.current), text: Binding(get: { specs[field.key] ?? "" }, set: { specs[field.key] = $0 }), hint: field.unit)
                    }
                }
                // Anything the schema does not know is kept, listed and untouched.
                if !kept.isEmpty {
                    Text(l.t("admin.specificationsKept", ["rows": kept.map(\.label).joined(separator: ", ")])).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
                if mayEdit {
                    SectionSave(pending: saving) {
                        Task {
                            let merged = rules.mergeAttributes(product.attributes ?? [], departmentSlug: departmentSlug, values: specs)
                            await run { try await $0.call(API.saveProductAttributes, .init(id: product.id, attributes: merged)) }
                        }
                    }
                }
            }
        }
        .onAppear(perform: fill)
        .onChange(of: product.attributes) { fill() }
    }

    private func fill() {
        specs = Dictionary((product.attributes ?? []).filter { $0.namespace == "spec" }.map { ($0.key, $0.value) }, uniquingKeysWith: { first, _ in first })
    }

    private func run(_ work: @escaping (APICalling) async throws -> Acknowledged) async {
        saving = true
        defer { saving = false }
        let api = app.services.api
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", { _ = try await work(api) }) { await saved() }
    }
}

enum ShippingWords {
    static func speed(_ speed: String) -> String {
        switch speed {
        case "same_day": return "speed.same_day"
        case "next_day": return "speed.next_day"
        case "two_to_four": return "speed.two_to_four"
        case "up_to_week": return "speed.up_to_week"
        default: return "speed.made_to_order"
        }
    }

    static func size(_ size: String) -> String {
        switch size {
        case "small": return "size.small"
        case "medium": return "size.medium"
        case "large": return "size.large"
        default: return "size.oversize"
        }
    }

    static func vehicle(_ vehicle: String) -> String {
        switch vehicle {
        case "bike": return "vehicle.bike"
        case "car": return "vehicle.car"
        case "van": return "vehicle.van"
        default: return "vehicle.truck"
        }
    }
}

// MARK: - Size guide

/// A seller's chart: a range in centimetres per measurement per size, saved
/// only when `chartProblem` finds nothing — the rule the server refuses by.
private struct SizeChartSection: View {
    let product: EditableProduct
    let mayEdit: Bool
    let saved: () async -> Void

    struct DraftRow: Identifiable {
        let id = UUID()
        var size: String
        var ranges: [String: (String, String)]
    }

    @State private var axis = ""
    @State private var measures: [String] = []
    @State private var rows: [DraftRow] = []
    @State private var drafting = false
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var rules: ListingRules { .shared }

    private var axes: [String] { Array(Set(product.variants.flatMap { ($0.options ?? [:]).keys })).sorted() }

    private var chart: SizeChart {
        SizeChart(axis: axis, measures: measures, rows: rows.map { row in
            SizeChart.Row(size: row.size, ranges: Dictionary(uniqueKeysWithValues: measures.map { measure in
                let pair = row.ranges[measure] ?? ("", "")
                return (measure, [Double(pair.0) ?? .nan, Double(pair.1) ?? .nan])
            }))
        })
    }

    var body: some View {
        Group {
            Text(l.t("sizeGuide.editorHint")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if !drafting {
                if mayEdit {
                    Button { start() } label: { Label(l.t("sizeGuide.add"), systemImage: "plus") }.buttonStyle(PortalSmallButtonStyle())
                } else {
                    Text(l.t("sizeGuide.none")).font(.inter(14)).foregroundStyle(Brand.muted)
                }
            } else {
                draftView
            }
        }
        .onAppear(perform: fill)
        .onChange(of: product.sizeChart) { fill() }
    }

    @ViewBuilder
    private var draftView: some View {
        let problem = rules.chartProblem(chart)
        if axes.count > 1 {
            ChoiceField(label: l.t("sizeGuide.axis"), current: axis, placeholder: axis, options: axes.map { ($0, $0) }, enabled: mayEdit) { axis = $0 ?? axis }
        }
        Text(l.t("sizeGuide.measures")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
        FlowLayout(spacing: 8) {
            ForEach(rules.measures, id: \.self) { measure in
                let on = measures.contains(measure)
                Button {
                    measures = on ? measures.filter { $0 != measure } : rules.measures.filter { $0 == measure || measures.contains($0) }
                } label: {
                    Label(l.t(MeasureWords.label(measure)), systemImage: on ? "checkmark.square.fill" : "square")
                }
                .buttonStyle(PortalSmallButtonStyle(kind: on ? .primary : .secondary))
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        ForEach(rows) { entry in
            let row = edit(entry.id)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    TextField(l.t("sizeGuide.size"), text: Binding(get: { row.wrappedValue.size }, set: { row.wrappedValue.size = String($0.prefix(rules.maxSizeLabel)) }))
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel(l.t("sizeGuide.size"))
                    if mayEdit {
                        Button { rows.removeAll { $0.id == entry.id } } label: {
                            Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(Brand.danger).frame(width: 40, height: 40)
                        }
                        .buttonStyle(.tap)
                        .accessibilityLabel(l.t("sizeGuide.removeSize", ["size": entry.size.isEmpty ? "—" : entry.size]))
                    }
                }
                ForEach(measures, id: \.self) { measure in
                    HStack(spacing: 6) {
                        Text(l.t("sizeGuide.rangeCm", ["measure": l.t(MeasureWords.label(measure))])).font(.inter(12)).foregroundStyle(Brand.body).frame(maxWidth: .infinity, alignment: .leading)
                        rangeBox(row, measure, end: 0)
                        Text("–").foregroundStyle(Brand.muted)
                        rangeBox(row, measure, end: 1)
                    }
                }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.pearl.opacity(0.6)))
        }
        if let problem { Text(l.t(problem)).font(.footnote).foregroundStyle(Brand.danger) }
        if mayEdit {
            FlowLayout(spacing: 8) {
                if rows.count < rules.maxSizes {
                    Button { rows.append(DraftRow(size: "", ranges: [:])) } label: { Label(l.t("sizeGuide.addSize"), systemImage: "plus") }
                        .buttonStyle(PortalSmallButtonStyle())
                }
                SectionSave(pending: saving, disabled: problem != nil) { Task { await save(chart) } }
                Button(l.t("sizeGuide.remove")) {
                    if product.sizeChart != nil { Task { await save(nil) } } else { drafting = false }
                }
                .buttonStyle(PortalSmallButtonStyle(kind: .danger))
                .disabled(saving)
            }
        }
    }

    private func edit(_ id: UUID) -> Binding<DraftRow> {
        Binding(get: { rows.first { $0.id == id } ?? DraftRow(size: "", ranges: [:]) },
                set: { new in if let index = rows.firstIndex(where: { $0.id == id }) { rows[index] = new } })
    }

    private func rangeBox(_ row: Binding<DraftRow>, _ measure: String, end: Int) -> some View {
        TextField("", text: Binding(
            get: { end == 0 ? row.wrappedValue.ranges[measure]?.0 ?? "" : row.wrappedValue.ranges[measure]?.1 ?? "" },
            set: { typed in
                let clean = typed.filter { ("0"..."9").contains($0) || $0 == "." }
                var pair = row.wrappedValue.ranges[measure] ?? ("", "")
                if end == 0 { pair.0 = clean } else { pair.1 = clean }
                row.wrappedValue.ranges[measure] = pair
            }
        ))
        .keyboardType(.decimalPad)
        .textFieldStyle(.roundedBorder)
        .frame(width: 64)
        .environment(\.layoutDirection, .leftToRight)
        .accessibilityLabel(l.t(end == 0 ? "sizeGuide.from" : "sizeGuide.to", ["measure": l.t(MeasureWords.label(measure)), "size": row.wrappedValue.size.isEmpty ? "—" : row.wrappedValue.size]))
    }

    private func fill() {
        guard let chart = product.sizeChart else {
            drafting = false
            return
        }
        axis = chart.axis
        measures = chart.measures
        rows = chart.rows.map { row in
            DraftRow(size: row.size, ranges: Dictionary(uniqueKeysWithValues: row.ranges.compactMap { key, pair -> (String, (String, String))? in
                guard pair.count == 2 else { return nil }
                return (key, (SizeGuideSheetNumber.text(pair[0]), SizeGuideSheetNumber.text(pair[1])))
            }))
        }
        drafting = true
    }

    private func start() {
        let preferred = axes.first { $0.range(of: "size", options: .caseInsensitive) != nil || $0.contains("مقاس") } ?? axes.first ?? "Size"
        let sizes = Array(Set(product.variants.compactMap { $0.options?[preferred] })).sorted()
        axis = preferred
        measures = ["chest"]
        rows = (sizes.isEmpty ? [""] : sizes).prefix(rules.maxSizes).map { DraftRow(size: $0, ranges: [:]) }
        drafting = true
    }

    private func save(_ chart: SizeChart?) async {
        saving = true
        defer { saving = false }
        let input = chart.map { chart in
            API.ChartInput(axis: chart.axis.trimmingCharacters(in: .whitespaces), measures: chart.measures, rows: chart.rows.map { row in
                .init(size: row.size.trimmingCharacters(in: .whitespaces), ranges: row.ranges.mapValues { $0.map { ($0 * 10).rounded() / 10 } })
            })
        }
        if await app.attempt(done: chart == nil ? "sizeGuide.removed" : "sizeGuide.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.saveSizeChart, .init(productId: product.id, chart: OrNull(input)))
        }) {
            if chart == nil { drafting = false }
            await saved()
        }
    }
}

// MARK: - Extras

private struct AddonsSection: View {
    let product: EditableProduct
    let mayEdit: Bool
    let saved: () async -> Void

    struct Item: Identifiable {
        let id = UUID()
        var kind: String
        var label: String
        var labelAr: String
        var price: String
    }

    @State private var items: [Item] = []
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            Text(l.t("admin.addonsNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if items.isEmpty { Text(l.t("admin.addonsEmpty")).font(.inter(14)).foregroundStyle(Brand.muted) }
            ForEach(items) { entry in
                let item = edit(entry.id)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top) {
                        LabeledField(label: l.t("admin.addonLabel"), text: item.label)
                        if mayEdit {
                            Button { items.removeAll { $0.id == entry.id } } label: {
                                Image(systemName: "trash").font(.system(size: 14)).foregroundStyle(Brand.danger).frame(width: 44, height: 44)
                            }
                            .buttonStyle(.tap)
                            .accessibilityLabel(l.t("admin.addonRemove"))
                        }
                    }
                    HStack(alignment: .top, spacing: 8) {
                        ChoiceField(label: l.t("admin.addonKind"), current: entry.kind, placeholder: "",
                                    options: ListingRules.shared.addonKinds.map { ($0, l.t(AddonWords.kind($0))) }, enabled: mayEdit) { item.wrappedValue.kind = $0 ?? "other" }
                        LabeledField(label: l.t("admin.addonPrice"), text: item.price, keyboard: .decimalPad, leftToRight: true)
                    }
                }
                Divider()
            }
            if mayEdit {
                HStack(spacing: 8) {
                    Button { items.append(Item(kind: "installation", label: "", labelAr: "", price: "")) } label: { Label(l.t("admin.addonAdd"), systemImage: "plus") }
                        .buttonStyle(PortalSmallButtonStyle())
                    SectionSave(pending: saving) { Task { await save() } }
                }
            }
        }
        .onAppear(perform: fill)
    }

    private func edit(_ id: UUID) -> Binding<Item> {
        Binding(get: { items.first { $0.id == id } ?? Item(kind: "other", label: "", labelAr: "", price: "") },
                set: { new in if let index = items.firstIndex(where: { $0.id == id }) { items[index] = new } })
    }

    private func fill() {
        items = (product.addons ?? []).map { Item(kind: $0.kind, label: $0.label, labelAr: $0.labelAr ?? "", price: $0.price) }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let addons = items.filter { !$0.label.trimmingCharacters(in: .whitespaces).isEmpty && !$0.price.trimmingCharacters(in: .whitespaces).isEmpty }.map {
            API.AddonInput(kind: $0.kind, label: $0.label.trimmingCharacters(in: .whitespaces), labelAr: .text($0.labelAr), price: $0.price.trimmingCharacters(in: .whitespaces))
        }
        do {
            _ = try await app.services.api.call(API.saveAddons, .init(id: product.id, addons: addons))
            Haptics.succeeded()
            app.toast(l.t("admin.saved"))
            await saved()
        } catch {
            let failure = APIError.from(error)
            guard failure != .cancelled else { return }
            Haptics.refused()
            // An extra priced at nothing is refused by name: it is not sellable.
            let key = failure.messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(failure.serverMessage == "ADDON_NOT_SELLABLE" ? "admin.addonFree" : key == "error.serverProblem" ? "admin.saveFailed" : key))
        }
    }
}

enum AddonWords {
    static func kind(_ kind: String) -> String {
        switch kind {
        case "installation": return "product.addonInstallation"
        case "warranty": return "product.addonWarranty"
        default: return "product.addonOther"
        }
    }
}

// MARK: - Commission (administrators only)

private struct CommissionSection: View {
    let product: EditableProduct
    let saved: () async -> Void
    @State private var percent = ""
    @State private var fixed = ""
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        Group {
            Text(l.t("admin.productCommissionNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 8) {
                LabeledField(label: l.t("admin.commissionPercent"), text: $percent, hint: l.t("admin.commissionPercentHint"), keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: l.t("admin.commissionFixed"), text: $fixed, keyboard: .decimalPad, leftToRight: true)
            }
            SectionSave(pending: saving) { Task { await save() } }
        }
        .onAppear {
            percent = product.commissionPercent ?? ""
            fixed = product.commissionFixed ?? ""
        }
    }

    // An explicit zero is an override; an empty box is no override at all.
    private func save() async {
        saving = true
        defer { saving = false }
        if await app.attempt(done: "admin.saved", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.saveProductCommission, .init(id: product.id, percent: .text(percent), fixed: .text(fixed)))
        }) { await saved() }
    }
}

// MARK: - Affiliates (3.7.1)

/// Offering this product to affiliates at a rate the store funds: on a sale an
/// affiliate's link brings, that share of the line comes off what the store
/// nets. Off is the default — a store's margin is its own to spend.
private struct AffiliateSection: View {
    let product: EditableProduct
    let saved: () async -> Void
    @State private var offered = false
    @State private var rate = ""
    @State private var saving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var ceiling: Double { PortalRules.shared.money?.maxAffiliatePercent ?? 20 }
    private var ceilingText: String { ceiling == ceiling.rounded() ? "\(Int(ceiling))" : "\(ceiling)" }
    private var normalised: String? { AffiliateRules.storeRate(rate, ceiling: ceiling) }
    private var changed: Bool {
        offered ? (normalised != nil && normalised != product.affiliatePercent) : product.affiliatePercent != nil
    }

    var body: some View {
        Group {
            Text(l.t("admin.productAffiliatesNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            Toggle(l.t("admin.affiliateOffer"), isOn: $offered)
                .font(.inter(14, .semibold))
                .tint(Brand.navy)
            if offered {
                LabeledField(label: l.t("admin.affiliateStoreRate"), text: $rate,
                             hint: rate.trimmingCharacters(in: .whitespaces).isEmpty || normalised != nil ? l.t("admin.affiliateStoreRateHint", ["ceiling": ceilingText]) : nil,
                             problem: !rate.trimmingCharacters(in: .whitespaces).isEmpty && normalised == nil ? l.t("affiliate.badRate") : nil,
                             keyboard: .decimalPad, leftToRight: true)
            }
            SectionSave(pending: saving, disabled: !changed) { Task { await save() } }
        }
        .onAppear {
            offered = product.affiliatePercent != nil
            rate = product.affiliatePercent ?? ""
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var answer: API.AffiliatePercent?
        guard await app.attempt(fallback: "admin.saveFailed", {
            answer = try await app.services.api.call(API.setProductAffiliate, .init(productId: product.id, percent: OrNull(offered ? normalised : nil)))
        }) else { return }
        app.toast(l.t(answer?.percent != nil ? "admin.affiliateOffered" : "admin.affiliateWithdrawn"))
        await saved()
    }
}

// MARK: - Proposing a commission (3.3.2)

/// A store's commission proposals, from the product it is about: the open one
/// with Withdraw, otherwise the last answer and a form — this product or (an
/// owner) the whole store, a percentage or an amount per sale, and why.
/// Nothing here changes a rate; NetLet's desk decides.
private struct ProposeCommissionSection: View {
    let product: EditableProduct
    let mayStoreWide: Bool
    @State private var proposals: [CommissionProposal] = []
    @State private var storeWide = false
    @State private var fixedAmount = false
    @State private var value = ""
    @State private var reason = ""
    @State private var busy = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    private var mine: [CommissionProposal] {
        proposals.filter { storeWide ? $0.productId == nil : $0.productId == product.id }
    }

    private var problem: String? {
        value.trimmingCharacters(in: .whitespaces).isEmpty ? nil : ProposalRules.problem(percent: fixedAmount ? nil : value, fixed: fixedAmount ? value : nil)
    }

    var body: some View {
        Group {
            Text(l.t("commission.proposeNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if mayStoreWide {
                Picker(l.t("commission.scope"), selection: $storeWide) {
                    Text(l.t("commission.scopeProduct")).tag(false)
                    Text(l.t("commission.scopeStore")).tag(true)
                }
                .pickerStyle(.segmented)
            }
            if let open = mine.first(where: { $0.status == "pending" }) {
                PortalNotice(text: [l.t("commission.waiting", ["figure": CommissionWording.figure(open.percent, open.fixed, l)]), open.reason.map { "“\($0)”" }]
                    .compactMap { $0 }.joined(separator: " "), tone: .warning)
                Button(l.t("commission.withdraw")) { Task { await withdraw(open) } }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(busy)
            } else {
                if let last = mine.first(where: { $0.status == "accepted" || $0.status == "declined" }) {
                    Text([l.t(last.status == "accepted" ? "commission.lastAccepted" : "commission.lastDeclined", ["figure": CommissionWording.figure(last.percent, last.fixed, l)]),
                          last.decisionNote.map { "“\($0)”" }].compactMap { $0 }.joined(separator: " "))
                        .font(.inter(13))
                        .foregroundStyle(last.status == "accepted" ? Brand.success : Brand.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Picker(l.t("sell.commissionRate"), selection: $fixedAmount) {
                    Text(l.t("sell.commissionKindPercent")).tag(false)
                    Text(l.t("sell.commissionKindFixed")).tag(true)
                }
                .pickerStyle(.segmented)
                LabeledField(label: l.t(fixedAmount ? "sell.commissionFixed" : "sell.commissionRate"), text: $value,
                             problem: problem.map { l.t($0) }, keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: l.t("sell.commissionWhy"), text: Binding(get: { reason }, set: { reason = String($0.prefix(ProposalRules.maxReason)) }))
                Button(l.t("commission.send")) { Task { await send() } }
                    .buttonStyle(PortalSmallButtonStyle(kind: .primary))
                    .disabled(busy || value.trimmingCharacters(in: .whitespaces).isEmpty || problem != nil)
            }
        }
        .task { await load() }
    }

    private func load() async {
        proposals = (try? await app.services.api.call(API.commissionProposals, .init(vendorId: product.vendorId)))?.rows ?? []
    }

    private func send() async {
        busy = true
        defer { busy = false }
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        let words = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard await app.attempt(done: "commission.proposed", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.proposeCommission, .init(
                vendorId: product.vendorId,
                productId: OrNull(storeWide ? nil : product.id),
                percent: OrNull(fixedAmount ? nil : trimmed),
                fixed: OrNull(fixedAmount ? trimmed : nil),
                reason: OrNull(words.isEmpty ? nil : words)))
        }) else { return }
        value = ""
        reason = ""
        await load()
    }

    private func withdraw(_ proposal: CommissionProposal) async {
        busy = true
        defer { busy = false }
        if await app.attempt(done: "commission.withdrawn", fallback: "admin.saveFailed", {
            _ = try await app.services.api.call(API.withdrawProposal, .init(proposalId: proposal.id))
        }) { await load() }
    }
}

/// "8%" or "KWD 0.500 per sale": a commission figure as the desk and the store read it.
@MainActor
enum CommissionWording {
    static func figure(_ percent: String?, _ fixed: String?, _ l: LanguageSettings) -> String {
        if let percent { return l.t("commission.figurePercent", ["rate": trimmedNumber(percent)]) }
        return l.t("commission.figureFixed", ["amount": Money(fils: Money.parseFils(fixed ?? "0") ?? 0).formatted(l.current)])
    }

    /// What a store is charged now: its percentage and its amount, whichever it has.
    static func current(_ percent: String?, _ fixed: String?, _ l: LanguageSettings) -> String {
        let parts = [percent.flatMap { Double($0) ?? 0 > 0 ? l.t("commission.figurePercent", ["rate": trimmedNumber($0)]) : nil },
                     fixed.map { l.t("commission.figureFixed", ["amount": Money(fils: Money.parseFils($0) ?? 0).formatted(l.current)]) }].compactMap { $0 }
        return parts.isEmpty ? l.t("commission.figurePercent", ["rate": "0"]) : parts.joined(separator: " + ")
    }

    static func trimmedNumber(_ text: String) -> String {
        guard let value = Double(text) else { return text }
        return value == value.rounded() ? "\(Int(value))" : String(value)
    }
}

// MARK: - Store (administrators only)

private struct StoreSection: View {
    let product: EditableProduct
    let stores: [StoreRow]
    let saved: () async -> Void
    @State private var target: StoreRow?
    @State private var confirming = false
    @State private var moving = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        let current = stores.first { $0.id == product.vendorId }?.name ?? "#\(product.vendorId)"
        let others = stores.filter { $0.id != product.vendorId }
        Group {
            Text(l.t("admin.sectionStoreNote")).font(.inter(13)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            Text(current).font(.inter(15, .bold)).foregroundStyle(Brand.navy)
            if !others.isEmpty {
                ChoiceField(label: l.t("admin.moveTo"), current: target.map { String($0.id) }, placeholder: "—", options: others.map { (String($0.id), $0.name) }) { chosen in
                    target = others.first { String($0.id) == chosen }
                }
                Button { confirming = true } label: { Label(l.t("admin.moveButton"), systemImage: "arrow.left.arrow.right") }
                    .buttonStyle(PortalSmallButtonStyle())
                    .disabled(target == nil || moving)
            }
        }
        .alert(l.t("admin.moveTitle", ["title": product.title, "store": target?.name ?? ""]), isPresented: $confirming) {
            Button(l.t("admin.moveButton")) { Task { await move() } }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("admin.moveBody", ["from": current, "store": target?.name ?? ""]))
        }
    }

    private func move() async {
        guard let target else { return }
        moving = true
        defer { moving = false }
        var answer: ProductMoved?
        guard await app.attempt(fallback: "admin.saveFailed", { answer = try await app.services.api.call(API.moveProduct, .init(id: product.id, vendorId: target.id)) }), let answer else { return }
        app.toast(l.t("admin.moved", ["store": answer.to.name]))
        if answer.bundlesWithdrawn > 0 { app.toast(l.t("admin.movedBundles", ["count": "\(answer.bundlesWithdrawn)"])) }
        self.target = nil
        await saved()
    }
}

enum MeasureWords {
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
}
