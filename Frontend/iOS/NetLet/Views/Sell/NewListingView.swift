import PhotosUI
import SwiftUI

/// Adding a product — the web's `/admin/products/new`, step for step: a
/// model's draft to start from, the basics (the store for an administrator,
/// the name in both languages, the department, the warranty where it is
/// required), photos, the price, the description and rows, and how the
/// listing reads in a search. The rules are the server's, asked early, so a
/// message appears under the box rather than after Create; Create lands on
/// the product's editor, where sizes, extras and the rest are.
struct NewListingView: View {
    var vendorId: Int?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { NewListingViewModel(service: app.services.seller, api: app.services.api, seller: app.session.seller, vendorId: vendorId) }) { model in
            NewListingForm(model: model)
        }
        .navigationTitle(l.t("admin.newHeading"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct NewListingForm: View {
    @Bindable var model: NewListingViewModel
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var picked: [PhotosPickerItem] = []
    @State private var draftPicked: PhotosPickerItem?

    private var listing: Rules.Listing { ReferenceData.shared.rules.listing }

    var body: some View {
        Group {
            if model.noStore {
                Text(l.t("admin.needVendorFirst")).font(.subheadline).foregroundStyle(Brand.muted).padding(24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            } else {
                form
            }
        }
        .background(Brand.ground.ignoresSafeArea())
        .task { await model.load() }
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(l.t("admin.newIntro")).font(.subheadline).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                if app.ai?.catalog == true, model.vendorId != nil { generateCard }
                basics
                photos
                price
                description
                searchPreview
                checklist
                if let refusal = model.refusal { FieldProblem(key: refusal) }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) { actions }
    }

    // MARK: Create

    private var actions: some View {
        VStack(spacing: 8) {
            let count = model.submitted ? model.wrong.count : 0
            if count > 0 {
                Text(count == 1 ? l.t("admin.newFixOne") : l.t("admin.newFixMany", ["count": "\(count)"]))
                    .font(.footnote).foregroundStyle(Brand.danger)
            }
            if model.mayPublish {
                Button { Task { await create(publish: true) } } label: {
                    busyLabel(model.creating == "publish", model.publishGoesToReview ? "admin.newCreateReview" : "admin.newCreatePublish")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.creating != nil || model.uploading)
                Button { Task { await create(publish: false) } } label: {
                    busyLabel(model.creating == "draft", "admin.newCreateDraft")
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(model.creating != nil || model.uploading)
            } else {
                Button { Task { await create(publish: false) } } label: {
                    busyLabel(model.creating == "draft", "admin.newCreateDraft")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.creating != nil || model.uploading)
            }
            Text(l.t("admin.newDraftNote")).font(.caption).foregroundStyle(Brand.muted).multilineTextAlignment(.center)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.regularMaterial)
        .overlay(alignment: .top) { Divider() }
    }

    @ViewBuilder private func busyLabel(_ busy: Bool, _ key: String) -> some View {
        if busy {
            HStack(spacing: 8) { ProgressView(); Text(l.t("admin.newCreating")) }
        } else {
            Text(l.t(key))
        }
    }

    private func create(publish: Bool) async {
        guard let created = await model.create(publish: publish, language: l) else {
            Haptics.refused()
            return
        }
        Haptics.succeeded()
        app.toast(created.message)
        app.replace(with: .portal("/admin/products/\(created.id)"))
    }

    // MARK: Generate with AI

    private var generateCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(l.t("admin.genHeading"), systemImage: "sparkles").font(.headline).foregroundStyle(Brand.navy)
            Text(l.t("admin.genIntro")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            LabeledField(label: l.t("admin.genNotes"), text: Binding(get: { model.notes }, set: { model.notes = String($0.prefix(ReferenceData.shared.rules.aiRules.maxNotes)) }),
                         placeholder: l.t("admin.genNotesPlaceholder"), hint: l.t("admin.genNotesHint"), axis: .vertical)
            Text(l.t("admin.genPhotos")).font(.subheadline.weight(.semibold))
            Text(l.t("admin.genPhotosHint")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                ForEach(model.draftPhotos) { photo in
                    thumbnail(photo).frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                if model.draftPhotos.isEmpty { Text(l.t("admin.genPhotosNone")).font(.footnote).foregroundStyle(Brand.muted) }
                if model.canAddPhoto, model.draftPhotos.count < ReferenceData.shared.rules.aiRules.maxDraftImages {
                    PhotosPicker(selection: $draftPicked, matching: .images) {
                        Image(systemName: "plus").font(.body.weight(.semibold)).foregroundStyle(Brand.navy).frame(width: 56, height: 56)
                            .background(RoundedRectangle(cornerRadius: 10).strokeBorder(Brand.navy.opacity(0.3), style: StrokeStyle(lineWidth: 1.5, dash: [5])))
                    }
                    .accessibilityLabel(l.t("media.upload"))
                }
            }
            if model.needInput { FieldProblem(key: "admin.genNeedInput") }
            switch model.generator {
            case .idle:
                generateButton
            case .failed(let key):
                FieldProblem(key: key)
                generateButton
            case .working:
                HStack(spacing: 10) {
                    ProgressView()
                    Text(l.t("admin.genWorking")).font(.subheadline).foregroundStyle(Brand.muted)
                    Spacer()
                    Button(l.t("admin.genCancel")) { model.cancelGenerating() }.buttonStyle(.tap).foregroundStyle(Brand.navy)
                }
            case .done(let draft):
                generated(draft)
            }
        }
        .card()
        .onChange(of: draftPicked) { _, item in
            guard let item else { return }
            draftPicked = nil
            Task { if let data = try? await item.loadTransferable(type: Data.self) { await model.addPhoto(data) } }
        }
    }

    private var generateButton: some View {
        Button { model.generate(locale: l.current == .ar ? "ar" : "en") } label: { Label(l.t("admin.genGenerate"), systemImage: "sparkles") }
            .buttonStyle(SecondaryButtonStyle())
    }

    private func generated(_ draft: CatalogDraft) -> some View {
        let fields = ListingRules.shared.fields(draft.department)
        func label(_ key: String) -> String { fields.first { $0.key == key }?.shown(l.current) ?? key }
        func unit(_ key: String) -> String { fields.first { $0.key == key }?.unit.map { " \($0)" } ?? "" }
        let none = l.t("admin.genNone")
        return VStack(alignment: .leading, spacing: 10) {
            Text(l.t("admin.genDraftHeading")).font(.subheadline.weight(.bold)).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            Text(l.t("admin.genDraftNote")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            draftItem("admin.genNameEn", draft.title.en.isEmpty ? none : draft.title.en)
            draftItem("admin.genNameAr", draft.title.ar.isEmpty ? none : draft.title.ar)
            draftItem("admin.genDepartment", draft.department.map { slug in
                model.categories.value?.first { $0.slug == slug }?.displayName(l.current) ?? slug
            } ?? none)
            draftItem("admin.genTags", draft.tags.isEmpty ? none : draft.tags.joined(separator: l.current == .ar ? "، " : ", "))
            draftItem("admin.genSpecs", draft.attributes.isEmpty ? none : draft.attributes.map { "\(label($0.key)): \($0.value)\(unit($0.key))" }.joined(separator: "\n"))
            if !draft.missing.isEmpty {
                Text(l.t("admin.genMissing", ["fields": draft.missing.map(label).joined(separator: l.current == .ar ? "، " : ", ")]))
                    .font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            draftItem("admin.genDescriptionEn", draft.description.en.isEmpty ? none : draft.description.en)
            draftItem("admin.genDescriptionAr", draft.description.ar.isEmpty ? none : draft.description.ar)
            if !draft.seo.title.isEmpty || !draft.seo.description.isEmpty {
                draftItem("admin.genSeo", [draft.seo.title, draft.seo.description].filter { !$0.isEmpty }.joined(separator: "\n"))
                Text(l.t("admin.genSeoNote")).font(.caption).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                Button(l.t("admin.genUse")) {
                    model.use(draft)
                    Haptics.succeeded()
                    app.toast(l.t("admin.genApplied"))
                }
                .buttonStyle(PrimaryButtonStyle())
                Button(l.t("admin.genDiscard")) { model.discardDraft() }.buttonStyle(SecondaryButtonStyle())
            }
            Text(l.t("admin.genUseNote")).font(.caption).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
    }

    private func draftItem(_ term: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(l.t(term)).font(.caption.weight(.semibold)).foregroundStyle(Brand.muted)
            Text(value).font(.subheadline).foregroundStyle(Brand.ink).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: 1. Basics

    private var basics: some View {
        VStack(alignment: .leading, spacing: 14) {
            stepHeading(1, "admin.newStepBasics")
            if model.isAdmin, !model.stores.isEmpty {
                ChoiceField(label: l.t("admin.newStore"), hint: l.t("admin.newStoreHint"), current: model.vendorId.map(String.init), placeholder: l.t("admin.newStore"),
                            options: model.stores.map { store in
                                ("\(store.id)", store.status == "approved" ? store.name : "\(store.name) — \(l.t(StoreRules.statusKey(store.status)))")
                            }) { model.chosenVendor = $0.flatMap(Int.init) }
            }
            LabeledField(label: l.t("admin.newTitle"), text: bound(\.title, .title), hint: l.t("admin.newTitleHint"), problem: model.problem(.title))
            LabeledField(label: l.t("admin.newTitleAr"), text: bound(\.titleAr, .titleAr), problem: model.problem(.titleAr))
                .environment(\.layoutDirection, .rightToLeft)
            if model.arabicDraftOn, model.vendorId != nil {
                VStack(alignment: .leading, spacing: 4) {
                    Button {
                        Task {
                            if let problem = await model.draftArabicName() { app.toast(l.t(problem)) } else { Haptics.succeeded() }
                        }
                    } label: {
                        Label(l.t("admin.arabicDraft"), systemImage: model.draftingArabic ? "hourglass" : "sparkles").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.tap)
                    .foregroundStyle(Brand.navy)
                    .disabled(model.draft.title.trimmingCharacters(in: .whitespaces).isEmpty || model.draftingArabic)
                    Text(l.t("admin.arabicDraftNote")).font(.caption).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                }
            }
            ChoiceField(label: l.t("admin.fieldCategory"), current: model.categoryId.map(String.init) ?? "", placeholder: l.t("admin.fieldNoCategory"),
                        options: [("", l.t("admin.fieldNoCategory"))] + (model.categories.value ?? []).map { ("\($0.id)", $0.displayName(l.current)) }) {
                model.categoryId = $0.flatMap(Int.init)
            }
            if model.needsWarranty || !model.draft.warranty.isEmpty {
                LabeledField(label: l.t("admin.newWarranty"), text: bound(\.warranty, .warranty), placeholder: l.t("admin.newWarrantyPlaceholder"),
                             hint: l.t("admin.newWarrantyHint"), problem: model.problem(.warranty))
            }
        }
        .card()
    }

    // MARK: 2. Photos

    private var photos: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                stepHeading(2, "admin.newStepPhotos")
                Spacer()
                Text(l.t("admin.newPhotoCount", ["count": "\(model.photos.count)", "max": "\(listing.maxPhotos)"]))
                    .font(.footnote).foregroundStyle(Brand.muted)
            }
            Text(l.t("admin.newPhotosHint")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(model.photos.enumerated()), id: \.element.id) { index, photo in
                        PhotoTile(photo: photo, cover: index == 0) {
                            model.removePhoto(photo.id)
                        } makeCover: {
                            model.makeCover(photo.id)
                        }
                    }
                    if model.canAddPhoto {
                        PhotosPicker(selection: $picked, maxSelectionCount: listing.maxPhotos - model.photos.count, matching: .images) {
                            VStack(spacing: 6) {
                                Image(systemName: "plus").font(.title2)
                                Text(l.t("media.upload")).font(.footnote.weight(.semibold)).multilineTextAlignment(.center)
                            }
                            .foregroundStyle(Brand.navy)
                            .frame(width: 96, height: 96)
                            .background(RoundedRectangle(cornerRadius: 12).strokeBorder(Brand.navy.opacity(0.3), style: StrokeStyle(lineWidth: 1.5, dash: [5])))
                        }
                        .accessibilityLabel(l.t("media.upload"))
                    }
                }
            }
            if model.photos.isEmpty { Text(l.t("admin.newPhotosNone")).font(.footnote).foregroundStyle(Brand.muted) }
            if model.canAddPhoto {
                HStack(alignment: .bottom, spacing: 8) {
                    LabeledField(label: l.t("admin.newPhotoLink"), text: Binding(get: { model.photoLink }, set: { model.photoLink = $0; model.clearLinkProblem() }),
                                 placeholder: "https://", keyboard: .URL, content: .URL, leftToRight: true)
                    Button(l.t("admin.newPhotoAdd")) { model.addLink() }
                        .buttonStyle(SecondaryButtonStyle())
                        .fixedSize()
                        .disabled(model.photoLink.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if let problem = model.photoLinkProblem {
                    Text(l.t(problem, ["scheme": "https://"])).font(.footnote).foregroundStyle(Brand.danger)
                }
            }
        }
        .card()
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            picked = []
            Task {
                for item in items {
                    if let data = try? await item.loadTransferable(type: Data.self) { await model.addPhoto(data) }
                }
            }
        }
    }

    @ViewBuilder private func thumbnail(_ photo: NewListingViewModel.Photo) -> some View {
        if let data = photo.preview, let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFill()
        } else if let link = photo.link {
            RemoteImage(reference: link)
        } else {
            Brand.tint
        }
    }

    // MARK: 3. Price

    private var price: some View {
        VStack(alignment: .leading, spacing: 14) {
            stepHeading(3, "admin.newStepPrice")
            HStack(alignment: .top, spacing: 10) {
                LabeledField(label: l.t("admin.newPrice"), text: bound(\.price, .price), placeholder: "0.000", hint: l.t("admin.priceHint"),
                             problem: model.problem(.price), keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: "\(l.t("admin.newWas")) (\(l.t("admin.optional")))", text: bound(\.compareAtPrice, .compareAtPrice), placeholder: "0.000",
                             hint: l.t("admin.newWasHint"), problem: model.problem(.compareAtPrice), keyboard: .decimalPad, leftToRight: true)
            }
            HStack(alignment: .top, spacing: 10) {
                LabeledField(label: "\(l.t("admin.newSku")) (\(l.t("admin.optional")))", text: bound(\.sku, .sku), hint: l.t("admin.newSkuHint"),
                             problem: model.problem(.sku), leftToRight: true)
                LabeledField(label: l.t("admin.newStock"), text: bound(\.stock, .stock), placeholder: "0", hint: l.t("admin.newStockHint"),
                             problem: model.problem(.stock), keyboard: .numberPad, leftToRight: true)
            }
            shopperSees
        }
        .card()
    }

    /// The price as a shopper will read it, with the saving where the was-price is a real one.
    @ViewBuilder private var shopperSees: some View {
        let problems = Validation.listingProblems(model.draft, departmentSlug: model.departmentSlug, rules: listing)
        if problems[.price] == nil, let now = Money(amount: model.draft.price.trimmingCharacters(in: .whitespaces)) {
            let was = problems[.compareAtPrice] == nil ? Money(amount: model.draft.compareAtPrice.trimmingCharacters(in: .whitespaces)) : nil
            HStack(spacing: 8) {
                Text(l.t("admin.newShopperSees")).font(.footnote).foregroundStyle(Brand.muted)
                Text(now.formatted(l.current)).font(.subheadline.weight(.bold)).foregroundStyle(Brand.navy)
                if let was, was.fils > now.fils {
                    Text(was.formatted(l.current)).font(.footnote).strikethrough().foregroundStyle(Brand.muted)
                    Text("−\(Int((Double(was.fils - now.fils) / Double(was.fils) * 100).rounded()))%")
                        .font(.caption.weight(.bold)).foregroundStyle(Brand.navy)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Capsule().fill(Brand.orange))
                        .environment(\.layoutDirection, .leftToRight)
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Brand.tint))
        }
    }

    // MARK: 4. Description

    private var description: some View {
        VStack(alignment: .leading, spacing: 14) {
            stepHeading(4, "admin.newStepDescription")
            LabeledField(label: l.t("admin.fieldDescription"), text: bound(\.description, .description),
                         hint: "\(l.t("admin.newDescriptionHint")) \(l.t("admin.newCharacters", ["count": "\(model.draft.description.count)"]))",
                         problem: model.problem(.description), axis: .vertical)
            LabeledField(label: "\(l.t("admin.fieldDescriptionAr")) (\(l.t("admin.optional")))",
                         text: Binding(get: { model.descriptionAr }, set: { model.descriptionAr = String($0.prefix(listing.maxDescription)) }),
                         hint: l.t("admin.fieldDescriptionArHint"), axis: .vertical)
                .environment(\.layoutDirection, .rightToLeft)
            LabeledField(label: "\(l.t("admin.fieldTags")) (\(l.t("admin.optional")))", text: $model.tags, hint: l.t("admin.tagsHint"))
            if !model.shownSpecs.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(l.t("admin.newSpecs")).font(.subheadline.weight(.semibold))
                    Text(l.t("admin.newSpecsHint")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                    ForEach(model.shownSpecs) { row in specRow(row) }
                }
            }
        }
        .card()
    }

    private func specRow(_ row: NewListingViewModel.Spec) -> some View {
        let field = ListingRules.shared.fields(model.departmentSlug).first { $0.key == row.key }
        let name = (field?.shown(l.current) ?? row.key) + (field?.unit.map { " (\($0))" } ?? "")
        return HStack(alignment: .bottom, spacing: 8) {
            LabeledField(label: name, text: Binding(
                get: { model.specs.first { $0.key == row.key }?.value ?? "" },
                set: { value in
                    if let index = model.specs.firstIndex(where: { $0.key == row.key }) { model.specs[index].value = String(value.prefix(500)) }
                }
            ))
            Button { model.specs.removeAll { $0.key == row.key } } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(Brand.muted).frame(width: 44, height: 50)
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("admin.newSpecRemove", ["label": field?.shown(l.current) ?? row.key]))
        }
    }

    // MARK: 5. In a search

    private var searchPreview: some View {
        let fits = (title: 60, snippet: 160)
        let title = model.draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let heading = "\(title.isEmpty ? l.t("admin.newTitle") : title) — NetLet"
        let description = model.draft.description.trimmingCharacters(in: .whitespacesAndNewlines)
        let snippet = description.isEmpty
            ? "\(title.isEmpty ? l.t("admin.newTitle") : title)\(model.vendorName.map { " by \($0)" } ?? "") on NetLet."
            : SearchPreview.text(description, limit: fits.snippet)
        let host = APIConfiguration.current().baseURL.host() ?? "netlet"
        return VStack(alignment: .leading, spacing: 10) {
            stepHeading(5, "admin.newStepSearch")
            Text(l.t("admin.newSearchHint")).font(.footnote).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
            if title.isEmpty {
                Text(l.t("admin.newSearchEmpty")).font(.footnote).foregroundStyle(Brand.muted)
            } else {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(host) › products › \(SearchPreview.handle(title))").font(.caption).foregroundStyle(Brand.success).lineLimit(1)
                        .environment(\.layoutDirection, .leftToRight)
                    Text(heading.count > fits.title ? String(heading.prefix(fits.title - 1)).trimmingCharacters(in: .whitespaces) + "…" : heading)
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Color(red: 0.10, green: 0.05, blue: 0.67)).lineLimit(1)
                    Text(snippet).font(.footnote).foregroundStyle(Brand.body).lineLimit(3)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Brand.cardLine, lineWidth: 1))
                .accessibilityElement(children: .combine)
                .accessibilityLabel(l.t("admin.newSearchPreview"))
                Text(l.t("admin.newSearchTitleCount", ["count": "\(heading.count)", "max": "\(fits.title)"]) + (heading.count > fits.title ? " — \(l.t("admin.newSearchCut"))" : ""))
                    .font(.caption).foregroundStyle(heading.count > fits.title ? Brand.danger : Brand.muted)
                Text(description.isEmpty ? l.t("admin.newSearchAddDescription")
                     : l.t("admin.newSearchSnippetCount", ["count": "\(min(description.count, fits.snippet))", "max": "\(fits.snippet)"]))
                    .font(.caption).foregroundStyle(Brand.muted)
            }
        }
        .card()
    }

    // MARK: Checklist

    private var checklist: some View {
        let problems = Validation.listingProblems(model.draft, departmentSlug: model.departmentSlug, rules: listing)
        var items: [(key: String, done: Bool, required: Bool)] = [
            ("admin.newCheckTitle", problems[.title] == nil, true),
            ("admin.newCheckTitleAr", problems[.titleAr] == nil, true),
        ]
        if model.needsWarranty { items.append(("admin.newCheckWarranty", problems[.warranty] == nil, true)) }
        items += [
            ("admin.newCheckPrice", problems[.price] == nil, true),
            ("admin.newCheckPhoto", !model.photos.isEmpty, false),
            ("admin.newCheckDescription", !model.draft.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, false),
            ("admin.newCheckCategory", model.categoryId != nil, false),
        ]
        return VStack(alignment: .leading, spacing: 8) {
            Text(l.t("admin.newChecklist")).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
            ForEach(items, id: \.key) { item in
                HStack(spacing: 8) {
                    Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(item.done ? Brand.success : Brand.chevron)
                        .accessibilityHidden(true)
                    Text(l.t(item.key)).font(.subheadline).foregroundStyle(item.done ? Brand.navy : Brand.muted)
                    Spacer(minLength: 4)
                    if !item.done {
                        Text(l.t(item.required ? "admin.newRequired" : "admin.newRecommended")).font(.caption.weight(.semibold))
                            .foregroundStyle(item.required ? Brand.danger : Brand.muted)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(l.t(item.done ? "admin.newDone" : "admin.newNotYet"))
            }
        }
        .card()
    }

    // MARK: Helpers

    private func stepHeading(_ number: Int, _ key: String) -> some View {
        HStack(spacing: 8) {
            Text("\(number)").font(.caption.weight(.bold)).foregroundStyle(.white).frame(width: 22, height: 22).background(Circle().fill(Brand.navy))
                .accessibilityHidden(true)
            Text(l.t(key)).font(.headline).foregroundStyle(Brand.navy).accessibilityAddTraits(.isHeader)
        }
    }

    /// A box on the draft that clears the server's refusal of it as it changes.
    private func bound(_ path: WritableKeyPath<Validation.ListingDraft, String>, _ field: Validation.ListingField) -> Binding<String> {
        Binding(get: { model.draft[keyPath: path] }, set: { value in
            model.draft[keyPath: path] = value
            model.edit(field)
        })
    }
}

/// How a listing reads in a search before it exists: the address a draft's
/// name makes (`handleBase`) and the description cut as a snippet is
/// (`toPreviewText`).
enum SearchPreview {
    static func handle(_ title: String) -> String {
        let slug = title.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return slug.isEmpty ? "product" : String(slug.prefix(150))
    }

    static func text(_ text: String, limit: Int) -> String {
        let flat = text.split(whereSeparator: \.isNewline)
            .map { $0.replacingOccurrences(of: "^\\s*(?:[-•*]|\\d+[.)])\\s+", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        guard flat.count > limit else { return flat }
        let cut = String(flat.prefix(limit - 1))
        if let space = cut.lastIndex(of: " "), cut.distance(from: cut.startIndex, to: space) > Int(Double(limit) * 0.6) {
            return String(cut[..<space]).trimmingCharacters(in: .whitespaces) + "…"
        }
        return cut.trimmingCharacters(in: .whitespaces) + "…"
    }
}

private struct PhotoTile: View {
    let photo: NewListingViewModel.Photo
    let cover: Bool
    let remove: () -> Void
    let makeCover: () -> Void
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ZStack {
            if let data = photo.preview, let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFill()
            } else if let link = photo.link {
                RemoteImage(reference: link)
            } else {
                Brand.tint
            }
            if photo.pending {
                Color.black.opacity(0.3)
                ProgressView().tint(.white)
            }
            if photo.failure != nil {
                Color.white.opacity(0.85)
                Image(systemName: "exclamationmark.triangle").foregroundStyle(Brand.danger)
            }
        }
        .frame(width: 96, height: 96)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(alignment: .bottomLeading) {
            if cover {
                Text(l.t("admin.newPhotoCover"))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .background(Capsule().fill(Brand.navy))
                    .padding(4)
            }
        }
        .contextMenu {
            if !cover { Button(l.t("admin.newPhotoMakeCover"), action: makeCover) }
            Button(l.t("admin.removeImage"), role: .destructive, action: remove)
        }
        .overlay(alignment: .topTrailing) {
            Button(action: remove) {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Brand.navy)
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(l.t("admin.removeImage"))
        }
        .overlay(alignment: .bottomTrailing) {
            if !cover {
                Button(action: makeCover) {
                    Image(systemName: "star")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Brand.navy)
                        .frame(width: 26, height: 26)
                        .background(Circle().fill(Color.white))
                        .frame(width: 44, height: 44, alignment: .bottomTrailing)
                        .padding(4)
                }
                .accessibilityLabel(l.t("admin.newPhotoMakeCover"))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityHint(photo.failure.map { l.t($0) } ?? "")
    }
}
