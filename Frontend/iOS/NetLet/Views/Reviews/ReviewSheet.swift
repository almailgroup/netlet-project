import PhotosUI
import SwiftUI

/// What a review is being written for: one order line, and the review it
/// already has, if any.
struct ReviewTarget: Identifiable, Hashable {
    let orderItemId: Int
    let productTitle: String
    var photo: String? = nil
    var review: MyReview? = nil

    var id: Int { orderItemId }
}

/// Rating something you received — the web's `ReviewDialog`: the stars, a
/// headline, what you would tell somebody, and up to `maxReviewPhotos` photos,
/// from an order's "Rate this item", the orders list's "Rate your items" and
/// the account's Reviews alike, so the three cannot ask different things.
///
/// Editing starts from what was written. A photo is shrunk and re-encoded on
/// the phone (`ImagePreparation`) and stored the moment it is chosen, so
/// Publish only names it; the server takes only this account's own uploads.
/// Errors arrive with the press and leave with the fix: no stars, or words
/// carrying a phone number, an email or a link (`ContactFilter`, which the
/// server asks again). The answer says whether the review is on the product
/// page now or waiting for a quick look, and the toast says which.
struct ReviewSheet: View {
    let target: ReviewTarget
    let done: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss
    @State private var rating = 0
    @State private var title = ""
    @State private var words = ""
    @State private var photos: [String] = []
    @State private var picked: [PhotosPickerItem] = []
    @State private var uploading = 0
    @State private var problem: Problem?
    @State private var sending = false
    @State private var confirming = false

    private enum Problem { case rating, words }

    private var rules: Rules.Account { ReferenceData.shared.rules.accountRules }
    private var room: Int { max(0, rules.maxReviewPhotos - photos.count - uploading) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    stars
                    LabeledField(
                        label: l.t("review.titleLabel"),
                        text: $title,
                        placeholder: l.t("review.titlePlaceholder"),
                        problem: title.count > rules.maxReviewTitle ? l.t("ios.tooLong", ["max": "\(rules.maxReviewTitle)"]) : nil
                    )
                    LabeledField(
                        label: l.t("review.bodyLabel"),
                        text: $words,
                        placeholder: l.t("review.bodyPlaceholder"),
                        problem: problem == .words ? l.t("review.offPlatform")
                            : words.count > rules.maxReviewBody ? l.t("ios.tooLong", ["max": "\(rules.maxReviewBody)"]) : nil,
                        axis: .vertical
                    )
                    photoRow
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack(spacing: 8) {
                            if sending { ProgressView().tint(.white) }
                            Text(l.t("review.submit"))
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(sending || uploading > 0 || title.count > rules.maxReviewTitle || words.count > rules.maxReviewBody)
                    if target.review != nil {
                        Button(role: .destructive) { confirming = true } label: {
                            Label(l.t("review.delete"), systemImage: "trash")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                }
                .padding(16)
            }
            .background(Brand.ground)
            .navigationTitle(l.t("review.rateItem"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    BarButton(l.t("common.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .onAppear {
            guard let review = target.review else { return }
            rating = review.rating
            title = review.title ?? ""
            words = review.body ?? ""
            photos = review.photos
        }
        .onChange(of: rating) { _, value in if problem == .rating, value > 0 { problem = nil } }
        .onChange(of: words) { _, _ in if problem == .words, ContactFilter.findings("\(title)\n\(words)").isEmpty { problem = nil } }
        .onChange(of: title) { _, _ in if problem == .words, ContactFilter.findings("\(title)\n\(words)").isEmpty { problem = nil } }
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            let chosen = Array(items.prefix(room))
            picked = []
            Task { await upload(chosen) }
        }
        .confirmationDialog(l.t("review.deleteWarning", ["name": target.productTitle]), isPresented: $confirming, titleVisibility: .visible) {
            Button(l.t("review.delete"), role: .destructive) {
                guard let id = target.review?.id else { return }
                Task {
                    if await app.attempt(done: "review.deleted", { _ = try await app.services.api.call(API.removeReview, .init(reviewId: id)) }) {
                        done()
                        dismiss()
                    }
                }
            }
            Button(l.t("common.cancel"), role: .cancel) {}
        } message: {
            Text(l.t("review.deleteBody"))
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            RemoteImage(reference: target.photo, contentMode: .fit)
                .frame(width: 56, height: 56)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Brand.line, lineWidth: 1))
            VStack(alignment: .leading, spacing: 4) {
                Text(target.productTitle)
                    .font(.inter(16, .bold))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(l.t("review.dialogNote"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// Five stars, one choice from a set; each says its count to VoiceOver.
    private var stars: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("review.yourRating")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            HStack(spacing: 4) {
                ForEach(1...rules.ratingMax, id: \.self) { star in
                    Button {
                        rating = star
                    } label: {
                        Image(systemName: star <= rating ? "star.fill" : "star")
                            .font(.system(size: 30))
                            .foregroundStyle(star <= rating ? Brand.star : Brand.line)
                            .frame(width: 48, height: 48)
                    }
                    .buttonStyle(.action)
                    .accessibilityLabel(l.t("review.stars", ["count": "\(star)"]))
                    .accessibilityAddTraits(rating == star ? .isSelected : [])
                }
            }
            if problem == .rating {
                Text(l.t("review.ratingRequired")).font(.inter(13, .semibold)).foregroundStyle(Brand.danger)
            }
        }
    }

    private var photoRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(l.t("review.photosLabel")).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            Text(l.t("review.photosHint", ["max": "\(rules.maxReviewPhotos)"]))
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(photos.enumerated()), id: \.element) { index, photo in
                        RemoteImage(reference: photo)
                            .frame(width: 80, height: 80)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(alignment: .topTrailing) {
                                Button {
                                    photos.removeAll { $0 == photo }
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(Brand.navy)
                                        .frame(width: 26, height: 26)
                                        .background(Circle().fill(Color.white))
                                        .overlay(Circle().stroke(Brand.line, lineWidth: 1))
                                }
                                .buttonStyle(.tap)
                                .padding(4)
                                .accessibilityLabel(l.t("review.removePhoto", ["index": "\(index + 1)"]))
                            }
                    }
                    ForEach(0..<uploading, id: \.self) { _ in
                        ProgressView()
                            .tint(Brand.navy)
                            .frame(width: 80, height: 80)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
                            .accessibilityLabel(l.t("review.uploading"))
                    }
                    if room > 0 {
                        PhotosPicker(selection: $picked, maxSelectionCount: room, matching: .images) {
                            VStack(spacing: 4) {
                                Image(systemName: "photo.badge.plus").font(.system(size: 20))
                                Text(l.t("review.addPhoto")).font(.inter(11, .bold)).multilineTextAlignment(.center)
                            }
                            .foregroundStyle(Brand.navy)
                            .frame(width: 80, height: 80)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Brand.line, style: StrokeStyle(lineWidth: 1, dash: [4])))
                        }
                    }
                }
                .padding(.vertical, 6)
            }
        }
    }

    private func upload(_ items: [PhotosPickerItem]) async {
        for item in items {
            uploading += 1
            defer { uploading -= 1 }
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { throw ImagePreparation.Problem.unreadable }
                let jpeg = try ImagePreparation.jpeg(from: data, rules: ReferenceData.shared.rules.media)
                let uploaded = try await app.services.seller.uploadReviewPhoto(jpeg: jpeg)
                if photos.count < rules.maxReviewPhotos { photos.append(uploaded.url) }
            } catch ImagePreparation.Problem.tooSmall {
                Haptics.refused()
                app.toast(l.t("media.tooSmall"))
            } catch {
                Haptics.refused()
                let failure = APIError.from(error)
                let key = failure.messageKey(knownKey: Phrasebook.shared.has)
                app.toast(l.t(key == "error.serverProblem" ? "review.photoFailed" : key))
            }
        }
    }

    private func submit() async {
        guard rating > 0 else {
            Haptics.refused()
            problem = .rating
            return
        }
        guard ContactFilter.findings("\(title)\n\(words)").isEmpty else {
            Haptics.refused()
            problem = .words
            return
        }
        sending = true
        defer { sending = false }
        let heading = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
        var outcome: ReviewOutcome?
        let worked = await app.attempt {
            if let id = target.review?.id {
                outcome = try await app.services.api.call(API.editReview, .init(reviewId: id, rating: rating, title: heading.isEmpty ? nil : heading, body: text.isEmpty ? nil : text, photos: photos))
            } else {
                outcome = try await app.services.api.call(API.writeReview, .init(orderItemId: target.orderItemId, rating: rating, title: heading.isEmpty ? nil : heading, body: text.isEmpty ? nil : text, photos: photos))
            }
        }
        guard worked, let outcome else { return }
        app.toast(l.t(outcome.state == "published" ? (target.review == nil ? "review.saved" : "review.updated") : "review.savedWaiting"))
        done()
        dismiss()
    }
}

/// Where a shopper's own review stands — on the product page, waiting for its
/// quick check, or taken down — the web's `ReviewStatePill`.
struct ReviewStatePill: View {
    let state: String
    @Environment(LanguageSettings.self) private var l

    private struct Look {
        let key: String
        let symbol: String
        let ink: Color
        let fill: Color
    }

    private var look: Look {
        switch state {
        case "published":
            return Look(key: "review.statePublished", symbol: "checkmark.circle", ink: Brand.success, fill: Brand.success.opacity(0.12))
        case "waiting":
            return Look(key: "review.stateWaiting", symbol: "clock", ink: Color(red: 0.48, green: 0.32, blue: 0), fill: Color(red: 0.99, green: 0.95, blue: 0.84))
        default:
            return Look(key: "review.stateRemoved", symbol: "eye.slash", ink: Brand.muted, fill: Brand.tint)
        }
    }

    var body: some View {
        Label(l.t(look.key), systemImage: look.symbol)
            .font(.inter(12, .bold))
            .foregroundStyle(look.ink)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(Capsule().fill(look.fill))
    }
}
