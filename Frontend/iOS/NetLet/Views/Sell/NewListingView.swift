import PhotosUI
import SwiftUI

/// Adding a product: photos from the library, the name in both languages, the
/// price and opening stock, the department, the description and — for
/// electronics — the warranty, then Create. The rules are the server's, asked
/// early, so a message appears under the box rather than after Create.
struct NewListingView: View {
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        ModelHost(make: { NewListingViewModel(service: app.services.seller) }) { model in
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
    @Environment(\.dismiss) private var dismiss
    @State private var picked: [PhotosPickerItem] = []

    var body: some View {
        Group {
            if let outcome = model.outcome {
                done(outcome)
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
                Text(l.t("admin.newIntro")).font(.subheadline).foregroundStyle(Brand.muted)
                photos
                basics
                price
                description
                if let refusal = model.refusal { FieldProblem(key: refusal) }
                Toggle(l.t("ios.sell.publishNow"), isOn: $model.publish).tint(Brand.navy)
                    .onChange(of: model.publish) { Haptics.tap() }
                Text(l.t("admin.newDraftNote")).font(.footnote).foregroundStyle(Brand.muted)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 6) {
                let count = model.submitted ? model.problems.count + (model.photoProblem == nil ? 0 : 1) : 0
                if count > 0 {
                    Text(count == 1 ? l.t("admin.newFixOne") : l.t("admin.newFixMany", ["count": "\(count)"]))
                        .font(.footnote).foregroundStyle(Brand.danger)
                }
                Button {
                    Task {
                        guard let vendorId = app.session.seller?.vendorId else { return }
                        _ = await model.create(vendorId: vendorId)
                    }
                } label: {
                    if model.creating {
                        HStack(spacing: 8) { ProgressView().tint(.white); Text(l.t("admin.newCreating")) }
                    } else {
                        Text(l.t(model.publish ? "admin.newCreatePublish" : "admin.newCreateDraft"))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.creating || model.uploading)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.regularMaterial)
            .overlay(alignment: .top) { Divider() }
        }
    }

    private var photos: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(l.t("admin.newStepPhotos")).font(.headline).foregroundStyle(Brand.navy)
                Spacer()
                Text(l.t("admin.newPhotoCount", ["count": "\(model.photos.count)", "max": "\(ReferenceData.shared.rules.listing.maxPhotos)"]))
                    .font(.footnote).foregroundStyle(Brand.muted)
            }
            Text(l.t("admin.newPhotosHint")).font(.footnote).foregroundStyle(Brand.muted)
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
                        PhotosPicker(selection: $picked, maxSelectionCount: ReferenceData.shared.rules.listing.maxPhotos - model.photos.count, matching: .images) {
                            VStack(spacing: 6) {
                                Image(systemName: "plus").font(.title2)
                                Text(l.t("admin.newPhotoAdd")).font(.footnote.weight(.semibold))
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
            FieldProblem(key: model.photoProblem)
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

    private var basics: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(l.t("admin.newStepBasics")).font(.headline).foregroundStyle(Brand.navy)
            LabeledField(label: l.t("admin.newTitle"), text: $model.draft.title, hint: l.t("admin.newTitleHint"), problem: model.problem(.title))
            LabeledField(label: l.t("admin.newTitleAr"), text: $model.draft.titleAr, problem: model.problem(.titleAr))
                .environment(\.layoutDirection, .rightToLeft)
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("browse.category")).font(.subheadline.weight(.semibold))
                Menu {
                    ForEach(model.categories.value ?? []) { category in
                        Button(category.displayName(l.current)) {
                            Haptics.tap()
                            model.categoryId = category.id
                        }
                    }
                } label: {
                    MenuField(
                        text: model.categories.value?.first(where: { $0.id == model.categoryId })?.displayName(l.current),
                        placeholder: l.t("sell.choose")
                    )
                }
            }
            if let slug = model.departmentSlug, ReferenceData.shared.rules.listing.warrantyRequiredDepartments.contains(slug) || !model.draft.warranty.isEmpty {
                LabeledField(
                    label: l.t("admin.newWarranty"),
                    text: $model.draft.warranty,
                    placeholder: l.t("admin.newWarrantyPlaceholder"),
                    hint: l.t("admin.newWarrantyHint"),
                    problem: model.problem(.warranty)
                )
            }
        }
        .card()
    }

    private var price: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(l.t("admin.newStepPrice")).font(.headline).foregroundStyle(Brand.navy)
            HStack(alignment: .top, spacing: 10) {
                LabeledField(label: l.t("admin.newPrice"), text: $model.draft.price, placeholder: "12.500", problem: model.problem(.price), keyboard: .decimalPad, leftToRight: true)
                LabeledField(label: l.t("admin.newStock"), text: $model.draft.stock, placeholder: "0", problem: model.problem(.stock), keyboard: .numberPad, leftToRight: true)
            }
            Text(l.t("admin.newStockHint")).font(.footnote).foregroundStyle(Brand.muted)
        }
        .card()
    }

    private var description: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(l.t("admin.newStepDescription")).font(.headline).foregroundStyle(Brand.navy)
            LabeledField(label: l.t("admin.newStepDescription"), text: $model.draft.description, hint: l.t("admin.newDescriptionHint"), problem: model.problem(.description), axis: .vertical)
        }
        .card()
    }

    private func done(_ outcome: NewListingViewModel.Outcome) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 52)).foregroundStyle(Brand.success).accessibilityHidden(true)
            switch outcome {
            case .published(let title):
                Text(l.t("admin.newCreated", ["title": title])).font(.headline).multilineTextAlignment(.center)
            case .inReview(let title):
                Text(l.t("admin.newCreated", ["title": title])).font(.headline).multilineTextAlignment(.center)
                Text(l.t("status.pending_review")).font(.subheadline).foregroundStyle(Brand.muted)
            case .draft(let title, let reason):
                Text(l.t("admin.newCreatedDraft", ["title": title, "reason": reason.isEmpty ? "" : l.t(reason)]))
                    .font(.headline).multilineTextAlignment(.center)
            }
            Button(l.t("admin.newDone")) { dismiss() }.buttonStyle(PrimaryButtonStyle())
            Button(l.t("admin.newHeading")) { model.reset() }.buttonStyle(SecondaryButtonStyle())
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
            if let image = UIImage(data: photo.preview) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Brand.tint
            }
            if photo.uploaded == nil && photo.failure == nil {
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
            Button(l.t("address.remove"), role: .destructive, action: remove)
        }
        .overlay(alignment: .topTrailing) {
            Button(action: remove) {
                Image(systemName: "xmark.circle.fill")
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Brand.navy)
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(l.t("address.remove"))
        }
        .accessibilityElement(children: .contain)
        .accessibilityHint(photo.failure.map { l.t($0) } ?? "")
    }
}
