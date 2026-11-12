import PhotosUI
import SwiftUI

/// The account's circle wherever it is named to its owner — the Profile tab's
/// card and "Your profile": the profile photo when there is one
/// (`ProfilePhotoModel`), the default avatar otherwise (`DefaultAvatar`), never
/// the initials, on the owner's word. The web's `ProfileAvatar`.
struct ProfileAvatar: View {
    let size: CGFloat
    /// A photo being chosen, shown before it is saved.
    var preview: UIImage? = nil
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if let picture = preview ?? app.profilePhoto.image {
                Image(uiImage: picture)
                    .resizable()
                    .scaledToFill()
            } else {
                DefaultAvatar(size: size)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// A person on a pale circle — a head and the shoulders cut by the circle's
/// edge, as a phone's own contacts draw somebody with no photo — on the owner's
/// word ("instead of initials … just make it a default avatar"). The web's
/// `DefaultAvatar`, from the same 64 grid.
struct DefaultAvatar: View {
    let size: CGFloat

    static let ground = Color(red: 231 / 255, green: 236 / 255, blue: 243 / 255)
    static let figure = Color(red: 162 / 255, green: 176 / 255, blue: 197 / 255)

    var body: some View {
        ZStack {
            Circle().fill(Self.ground)
            Circle()
                .fill(Self.figure)
                .frame(width: size * 22 / 64, height: size * 22 / 64)
                .position(x: size / 2, y: size * 25 / 64)
            Ellipse()
                .fill(Self.figure)
                .frame(width: size * 42 / 64, height: size * 32 / 64)
                .position(x: size / 2, y: size * 60 / 64)
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// A profile photo chosen and squared on the phone, not yet sent.
struct ChosenProfilePhoto {
    let data: Data
    let image: UIImage
}

/// The photo's presses, under the name beside the circle on "Your profile"'s
/// first row (`ProfileForm`) — the web's `ProfileIdentity`: the photos
/// library's own picker, the square drawn in the circle before anything is
/// sent (`chosen`, which the row's circle shows), and Save is what sends it,
/// the page's rule that each detail is its own decision. Remove asks first.
/// Not drawn until the shop keeps photos (`ready`), so nothing offers what
/// cannot be kept.
struct ProfilePhotoControls: View {
    @Binding var chosen: ChosenProfilePhoto?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var picked: PhotosPickerItem?
    @State private var preparing = false
    @State private var confirmRemove = false

    var body: some View {
        if app.profilePhoto.ready {
            VStack(alignment: .leading, spacing: 6) {
                if chosen != nil {
                    Text(l.t("profilePhoto.preview"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
                }
                FlowLayout(spacing: 8) {
                    if chosen != nil {
                        Button {
                            Task { await save() }
                        } label: {
                            if app.profilePhoto.saving { ProgressView().tint(Brand.navy) } else { Text(l.t("profilePhoto.save")) }
                        }
                        .buttonStyle(OrderActionStyle())
                        .disabled(app.profilePhoto.saving)
                        Button(l.t("common.cancel")) { chosen = nil }
                            .buttonStyle(OrderActionStyle())
                            .disabled(app.profilePhoto.saving)
                    } else {
                        PhotosPicker(selection: $picked, matching: .images) {
                            Label {
                                Text(preparing ? l.t("profilePhoto.preparing") : l.t(app.profilePhoto.hasPhoto ? "profilePhoto.change" : "profilePhoto.add"))
                            } icon: {
                                if preparing { ProgressView().tint(Brand.navy) } else { Image(systemName: "camera") }
                            }
                        }
                        .buttonStyle(OrderActionStyle())
                        .disabled(preparing)
                        if app.profilePhoto.hasPhoto {
                            Button {
                                confirmRemove = true
                            } label: {
                                Label(l.t("profilePhoto.remove"), systemImage: "trash")
                            }
                            .buttonStyle(OrderActionStyle())
                        }
                    }
                }
                if chosen == nil {
                    Text(l.t("profilePhoto.note"))
                        .font(.inter(12))
                        .foregroundStyle(Brand.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("profilePhoto.title"))
            .onChange(of: picked) { _, item in
                guard let item else { return }
                picked = nil
                Task { await prepare(item) }
            }
            .alert(l.t("profilePhoto.removeTitle"), isPresented: $confirmRemove) {
                Button(l.t("profilePhoto.remove"), role: .destructive) {
                    Haptics.action()
                    Task { await remove() }
                }
                Button(l.t("common.cancel"), role: .cancel) {}
            } message: {
                Text(l.t("profilePhoto.removeBody"))
            }
        }
    }

    private func prepare(_ item: PhotosPickerItem) async {
        preparing = true
        defer { preparing = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                throw ImagePreparation.Problem.unreadable
            }
            let rules = ReferenceData.shared.rules
            let square = try await ImagePreparation.squareJPEGOffMain(
                from: image,
                edge: rules.accountRules.profilePhotoEdge,
                minEdge: rules.media.minEdge,
                maxBytes: rules.accountRules.maxProfilePhotoBytes
            )
            chosen = ChosenProfilePhoto(data: square.data, image: square.image)
        } catch {
            Haptics.refused()
            app.toast(l.t("media.notAnImage"))
        }
    }

    private func save() async {
        guard let chosen else { return }
        do {
            try await app.profilePhoto.save((data: chosen.data, image: chosen.image))
            self.chosen = nil
            Haptics.succeeded()
            app.toast(l.t("profilePhoto.saved"))
        } catch {
            refused(error)
        }
    }

    private func remove() async {
        do {
            try await app.profilePhoto.remove()
            app.toast(l.t("profilePhoto.removed"))
        } catch {
            refused(error)
        }
    }

    private func refused(_ error: Error) {
        Haptics.refused()
        let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
        app.toast(l.t(key == "error.serverProblem" ? "media.failed" : key))
    }
}
