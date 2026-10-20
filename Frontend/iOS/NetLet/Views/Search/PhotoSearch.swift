import PhotosUI
import SwiftUI
import UIKit

/// What `search.photo` answers: words to search for, nothing it could read,
/// or that nothing is looking yet.
struct PhotoQuery: Decodable, Sendable {
    let kind: String
    let query: String?
}

struct PhotoAvailability: Decodable, Sendable {
    let available: Bool
}

extension API {
    struct PhotoInput: Encodable, Sendable {
        let image: String
        let locale: String
    }

    static let photoAvailable = Procedure<NoInput, PhotoAvailability>(query: "search.photoAvailable")
    static let photoSearch = Procedure<PhotoInput, PhotoQuery>(mutation: "search.photo")
}

/// Search with a photo — the web's photo panel. The phone's own pickers
/// (so the app holds no photo library permission), the picture shown back
/// with a line saying where it goes, shrunk to 768px in the app and sent
/// only on the press. The model may return a few words and nothing else;
/// they go into the field like typing.
struct PhotoSearchSheet: View {
    let onWords: (String) -> Void
    @State private var picked: PhotosPickerItem?
    @State private var photo: UIImage?
    @State private var camera = false
    @State private var scanning = false
    @State private var outcome: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(l.t("search.photoNote")).font(.inter(15)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                    if let photo {
                        Image(uiImage: photo)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity, maxHeight: 320)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .accessibilityLabel(l.t("search.photoYours"))
                        Text(l.t("search.photoPreviewNote")).font(.inter(13)).foregroundStyle(Brand.muted)
                        Text(l.t("search.photoConsent")).font(.inter(12)).foregroundStyle(Brand.muted).fixedSize(horizontal: false, vertical: true)
                        if scanning {
                            HStack(spacing: 8) {
                                ProgressView().tint(Brand.navy)
                                Text(l.t("search.photoScanning")).font(.inter(14)).foregroundStyle(Brand.ink)
                            }
                        } else {
                            Button(l.t("search.photoUse")) { Task { await search(photo) } }
                                .buttonStyle(PrimaryButtonStyle())
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(l.t("search.photoHow")).font(.inter(16, .bold)).foregroundStyle(Brand.navy)
                            Text(l.t("search.photoHowNote")).font(.inter(14)).foregroundStyle(Brand.body).fixedSize(horizontal: false, vertical: true)
                        }
                        .card()
                    }
                    if let outcome {
                        VStack(alignment: .leading, spacing: 4) {
                            if outcome == "nothing" {
                                Text(l.t("search.photoNoMatch")).font(.inter(15, .bold)).foregroundStyle(Brand.ink)
                                Text(l.t("search.photoNoMatchNote")).font(.inter(13)).foregroundStyle(Brand.body)
                            } else {
                                Text(l.t(outcome)).font(.inter(14)).foregroundStyle(Brand.danger)
                            }
                        }
                    }
                    HStack(spacing: 10) {
                        if UIImagePickerController.isSourceTypeAvailable(.camera) {
                            Button {
                                camera = true
                            } label: {
                                Label(l.t(photo == nil ? "search.photoTake" : "search.photoRetake"), systemImage: "camera")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                        }
                        PhotosPicker(selection: $picked, matching: .images) {
                            Label(l.t("search.photoChoose"), systemImage: "photo.on.rectangle")
                                .font(.inter(15, .semibold))
                                .foregroundStyle(Brand.navy)
                                .frame(maxWidth: .infinity, minHeight: 50)
                                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Brand.line, lineWidth: 1))
                        }
                        .simultaneousGesture(TapGesture().onEnded { Haptics.tap() })
                    }
                }
                .padding(16)
            }
            .background(Brand.ground.ignoresSafeArea())
            .navigationTitle(l.t("search.photoTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(l.t("search.close")) { dismiss() }
                }
            }
            .fullScreenCover(isPresented: $camera) {
                CameraPicker { image in
                    photo = image
                    outcome = nil
                }
                .ignoresSafeArea()
            }
            .onChange(of: picked) {
                guard let picked else { return }
                Task {
                    if let data = try? await picked.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        photo = image
                        outcome = nil
                    } else {
                        outcome = "search.photoUnreadable"
                    }
                }
            }
        }
        .environment(\.layoutDirection, l.layoutDirection)
    }

    private func search(_ image: UIImage) async {
        guard let dataURL = PhotoShrinker.dataURL(image) else {
            outcome = "search.photoUnreadable"
            return
        }
        scanning = true
        defer { scanning = false }
        outcome = nil
        do {
            let answer = try await app.services.api.call(API.photoSearch, .init(image: dataURL, locale: l.current.rawValue))
            switch answer.kind {
            case "query":
                if let words = answer.query, !words.isEmpty {
                    Haptics.succeeded()
                    onWords(words)
                    dismiss()
                } else {
                    outcome = "nothing"
                }
            case "unavailable": outcome = "search.photoOff"
            default: outcome = "nothing"
            }
        } catch {
            Haptics.refused()
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            outcome = key == "error.serverProblem" ? "search.photoOff" : key
        }
    }
}

/// A photo shrunk to the edge the server reads (`PHOTO_MAX_EDGE`) and sent
/// as a JPEG data address under the body ceiling (`MAX_PHOTO_CHARS`) —
/// enough to tell a kettle from a lamp.
enum PhotoShrinker {
    static func dataURL(_ image: UIImage) -> String? {
        let rules = ReferenceData.shared.rules.aiRules
        let edge = CGFloat(rules.photoMaxEdge)
        let scale = min(1, edge / max(image.size.width, image.size.height))
        let size = CGSize(width: (image.size.width * scale).rounded(), height: (image.size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        for quality in [0.8, 0.65, 0.5, 0.35] {
            guard let data = small.jpegData(compressionQuality: quality) else { return nil }
            let url = "data:image/jpeg;base64," + data.base64EncodedString()
            if url.count <= rules.maxPhotoChars { return url }
        }
        return nil
    }
}

/// The phone's own camera, for a photo taken now.
struct CameraPicker: UIViewControllerRepresentable {
    let onPhoto: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker

        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onPhoto(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
