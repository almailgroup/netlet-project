import PhotosUI
import SwiftUI

/// The account's circle wherever it is named to its owner — the Profile tab's
/// card and "Your profile": the profile photo when there is one
/// (`ProfilePhotoModel`), the initials otherwise. The web's `ProfileAvatar`.
struct ProfileAvatar: View {
    let user: User
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
                Text(AccountName.initials(user))
                    .font(.inter(size * 0.34, .bold))
                    .foregroundStyle(Brand.navy)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(ProfileInk.chip)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}

/// Choosing the profile photo, the first row of "Your profile" — the web's
/// `ProfilePhotoRow`: the photos library's own picker, the square drawn in
/// the circle before anything is sent, and Save is what sends it, the page's
/// rule that each card is its own decision. Remove asks first. Not drawn
/// until the shop keeps photos (`ready`), so nothing offers what cannot be
/// kept.
struct ProfilePhotoRow: View {
    let user: User
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var picked: PhotosPickerItem?
    @State private var chosen: Chosen?
    @State private var preparing = false
    @State private var confirmRemove = false

    private struct Chosen {
        let data: Data
        let image: UIImage
    }

    var body: some View {
        if app.profilePhoto.ready {
            // The first row of "Your profile"'s one list (`ProfileForm`), the
            // web's `ProfilePhotoRow`: the circle, what it is and the presses.
            HStack(alignment: .center, spacing: 14) {
                ProfileAvatar(user: user, size: 64, preview: chosen?.image)
                VStack(alignment: .leading, spacing: 4) {
                    Text(l.t("profilePhoto.title"))
                        .font(.inter(13, .medium))
                        .foregroundStyle(Brand.muted)
                        .accessibilityAddTraits(.isHeader)
                    Text(l.t(chosen != nil ? "profilePhoto.preview" : "profilePhoto.note"))
                        .font(.inter(13))
                        .foregroundStyle(Brand.body)
                        .fixedSize(horizontal: false, vertical: true)
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
                    .padding(.top, 4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.vertical, 14)
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
            chosen = Chosen(data: square.data, image: square.image)
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
