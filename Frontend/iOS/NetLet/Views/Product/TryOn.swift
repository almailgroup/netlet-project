import PhotosUI
import SwiftUI

/// Seeing a garment on yourself (3.1.8) — the web's `TryOn`: a link beside the
/// size guide, drawn only where the server says the product can be tried on
/// (the `tryOn` switch, which starts off, and the Style department), opening a
/// sheet that says where the photo goes before one is chosen.
///
/// Signed in, because every try is a model call counted per account. The photo
/// is shrunk on the phone to photo search's size before it leaves, and the
/// picture comes back here and is kept nowhere.
struct TryOnButton: View {
    let product: Product
    @State private var offered = false
    @State private var open = false
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if offered {
                Button {
                    open = true
                } label: {
                    Label(l.t("tryOn.open"), systemImage: "sparkles")
                        .font(.inter(13, .bold))
                        .foregroundStyle(Brand.navy)
                        .underline()
                        .frame(minHeight: 44)
                }
                .buttonStyle(.tap)
                .sheet(isPresented: $open) {
                    TryOnSheet(product: product)
                        .environment(\.layoutDirection, l.layoutDirection)
                        .presentationDetents([.large])
                }
            }
        }
        .task(id: product.id) {
            guard let id = Int(product.id), id > 0 else { return }
            offered = (try? await app.services.api.call(API.tryOnOffered, .init(productId: id))) ?? false
        }
    }
}

private struct TryOnSheet: View {
    let product: Product
    @State private var picked: PhotosPickerItem?
    @State private var photo: UIImage?
    @State private var result: UIImage?
    @State private var working = false
    @State private var problem: String?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(l.t("tryOn.title"))
                            .font(.inter(18, .heavy))
                            .foregroundStyle(Brand.navy)
                            .accessibilityAddTraits(.isHeader)
                        Text(product.title)
                            .font(.inter(13))
                            .foregroundStyle(Brand.muted)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(Brand.body)
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                    }
                    .buttonStyle(PressFillStyle(cornerRadius: 22))
                    .accessibilityLabel(l.t("tryOn.close"))
                }
                Text(l.t("tryOn.privacy"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
                if !app.session.isSignedIn {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(l.t("tryOn.signIn")).font(.inter(14, .semibold)).foregroundStyle(Brand.ink)
                        Button(l.t("header.signIn")) { app.authPresented = true }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                    .card()
                } else {
                    pictures
                    HStack(spacing: 10) {
                        PhotosPicker(selection: $picked, matching: .images) {
                            Label(l.t(photo == nil ? "tryOn.choose" : "tryOn.another"), systemImage: "camera")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(working)
                        if photo != nil && result == nil {
                            Button {
                                Task { await tryIt() }
                            } label: {
                                HStack(spacing: 8) {
                                    if working { ProgressView().tint(.white) } else { Image(systemName: "sparkles") }
                                    Text(l.t(working ? "tryOn.working" : "tryOn.go"))
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(working)
                        }
                    }
                    if let problem {
                        Text(problem)
                            .font(.inter(13, .semibold))
                            .foregroundStyle(Brand.danger)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
            }
            .padding(20)
        }
        .background(Color.white.ignoresSafeArea())
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await choose(item) }
        }
    }

    @ViewBuilder
    private var pictures: some View {
        if photo != nil || result != nil {
            HStack(alignment: .top, spacing: 12) {
                if let photo {
                    figure(photo, caption: l.t("tryOn.yourPhoto"), label: l.t("tryOn.yourPhoto"))
                }
                if let result {
                    figure(result, caption: l.t("tryOn.madeByAi"), label: l.t("tryOn.resultAlt", ["product": product.title]))
                }
            }
        }
    }

    private func figure(_ image: UIImage, caption: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity)
                .background(Brand.photo)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityLabel(label)
            Text(caption)
                .font(.inter(12))
                .foregroundStyle(Brand.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private func choose(_ item: PhotosPickerItem) async {
        problem = nil
        result = nil
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
            problem = l.t("tryOn.unreadable")
            return
        }
        photo = image
    }

    private func tryIt() async {
        guard let photo, let id = Int(product.id) else { return }
        guard let dataURL = PhotoShrinker.dataURL(photo), let comma = dataURL.firstIndex(of: ",") else {
            problem = l.t("tryOn.unreadable")
            return
        }
        working = true
        problem = nil
        defer { working = false }
        do {
            let drawn = try await app.services.api.call(
                API.tryOnMake,
                .init(productId: id, photo: .init(mimeType: "image/jpeg", data: String(dataURL[dataURL.index(after: comma)...])))
            )
            guard let bytes = Data(base64Encoded: drawn.data), let image = UIImage(data: bytes) else {
                problem = l.t("drawing.failed")
                return
            }
            result = image
            Haptics.succeeded()
        } catch {
            Haptics.refused()
            problem = l.t(APIError.from(error).messageKey(knownKey: Phrasebook.shared.has))
        }
    }
}

extension API {
    struct ProductRef: Encodable, Sendable {
        let productId: Int
    }

    struct TryOnRequest: Encodable, Sendable {
        struct Photo: Encodable, Sendable {
            let mimeType: String
            let data: String
        }

        let productId: Int
        let photo: Photo
    }

    static let tryOnOffered = Procedure<ProductRef, Bool>(query: "tryOn.offered")
    static let tryOnMake = Procedure<TryOnRequest, DrawnPicture>(mutation: "tryOn.make")

    /// Whether the shopper signed in holds a membership (`membership.mine`).
    static let myMembership = Procedure<NoInput, MyMembership>(query: "membership.mine")
}

/// The membership the shopper holds (`membership.mine`): whether, until
/// when, and the order size free delivery starts at, if NetLet set one.
struct MyMembership: Decodable, Sendable {
    let member: Bool
    var until: Date? = nil
    var freeDeliveryOver: String? = nil
}
