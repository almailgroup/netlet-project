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

    static let ground = Color(light: 0xE7ECF3, dark: 0x1D293A)
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

/// The circle on "Your profile"'s first row, and the photo's presses on it —
/// **the photo is changed on the picture itself, on the owner's word** ("the
/// image changes should be on the picture's side"): the circle is the photos
/// library's own picker, with a camera on its corner, and Remove sits under it
/// once there is a photo; it was an "Add a photo" pill under the name. The web's
/// `ProfileIdentity`. The square is drawn in the circle before anything is sent
/// (`chosen`), and Save under the name (`ProfilePhotoSave`) is what sends it —
/// the page's rule that each detail is its own decision. Remove asks first.
/// Until the shop keeps photos (`ready`) the circle is not a button, so nothing
/// offers what cannot be kept.
struct ProfilePhotoControls: View {
    @Binding var chosen: ChosenProfilePhoto?
    /// Whether the circle takes a press: not while the name's form is open.
    var pressable = true
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @State private var picked: PhotosPickerItem?
    @State private var preparing = false
    @State private var confirmRemove = false

    var body: some View {
        let open = app.profilePhoto.ready && pressable && chosen == nil
        VStack(spacing: 4) {
            if open {
                PhotosPicker(selection: $picked, matching: .images) {
                    ProfileAvatar(size: 64, preview: chosen?.image)
                        .overlay(alignment: .bottomTrailing) {
                            // The camera on the picture's corner says the picture is where it changes.
                            ZStack {
                                Circle().fill(Brand.navyFill)
                                if preparing {
                                    ProgressView().tint(.white).scaleEffect(0.6)
                                } else {
                                    Image(systemName: "camera.fill")
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundStyle(.white)
                                }
                            }
                            .frame(width: 26, height: 26)
                            .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
                            .offset(x: 2, y: 2)
                        }
                        .contentShape(Circle())
                }
                .buttonStyle(.tap)
                .disabled(preparing)
                .accessibilityLabel(preparing ? l.t("profilePhoto.preparing") : l.t(app.profilePhoto.hasPhoto ? "profilePhoto.change" : "profilePhoto.add"))
                if app.profilePhoto.hasPhoto {
                    Button {
                        confirmRemove = true
                    } label: {
                        Label(l.t("profilePhoto.remove"), systemImage: "trash")
                            .labelStyle(.titleAndIcon)
                            .font(.inter(12, .semibold))
                            .foregroundStyle(Brand.muted)
                            .padding(.horizontal, 6)
                            .frame(minHeight: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.tap)
                }
            } else {
                ProfileAvatar(size: 64, preview: chosen?.image)
            }
        }
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

/// A photo chosen and squared, not yet sent: saved under the name, with who
/// sees it — the web's preview step in `ProfileIdentity`.
struct ProfilePhotoSave: View {
    @Binding var chosen: ChosenProfilePhoto?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        if app.profilePhoto.ready, chosen != nil {
            VStack(alignment: .leading, spacing: 6) {
                Text(l.t("profilePhoto.preview"))
                    .font(.inter(13))
                    .foregroundStyle(Brand.body)
                    .fixedSize(horizontal: false, vertical: true)
                FlowLayout(spacing: 8) {
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
                }
                Text(l.t("profilePhoto.note"))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(l.t("profilePhoto.title"))
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
            Haptics.refused()
            let key = APIError.from(error).messageKey(knownKey: Phrasebook.shared.has)
            app.toast(l.t(key == "error.serverProblem" ? "media.failed" : key))
        }
    }
}
