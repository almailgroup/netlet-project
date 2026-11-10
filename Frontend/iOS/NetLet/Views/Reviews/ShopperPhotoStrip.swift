import PhotosUI
import SwiftUI

/// A shopper's photos for a review or a warranty claim: each is shrunk and
/// re-encoded on the phone (`ImagePreparation`) and stored the moment it is
/// chosen (`POST /api/media/review`), so what is sent is a `/media/…` path the
/// server checks is this shopper's own. One strip, so the review and the
/// claim cannot handle a photo two ways.
struct ShopperPhotoStrip: View {
    @Binding var photos: [String]
    /// How many are still on their way — the form waits for them.
    @Binding var uploading: Int
    let max: Int
    let label: String
    let hint: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var picked: [PhotosPickerItem] = []

    private var room: Int { Swift.max(0, max - photos.count - uploading) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline.weight(.semibold)).foregroundStyle(Brand.ink)
            if let hint {
                Text(hint)
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
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
        .onChange(of: picked) { _, items in
            guard !items.isEmpty else { return }
            let chosen = Array(items.prefix(room))
            picked = []
            Task { await upload(chosen) }
        }
    }

    private func upload(_ items: [PhotosPickerItem]) async {
        for item in items {
            uploading += 1
            defer { uploading -= 1 }
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { throw ImagePreparation.Problem.unreadable }
                let jpeg = try await ImagePreparation.jpegOffMain(from: data, rules: ReferenceData.shared.rules.media)
                let uploaded = try await app.services.seller.uploadReviewPhoto(jpeg: jpeg)
                if photos.count < max { photos.append(uploaded.url) }
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
}
