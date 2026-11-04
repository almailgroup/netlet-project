import UIKit

/// The account's profile photo (`Shared/commerce/profilePhoto.ts`), held by
/// `AppModel` so the Profile tab's card and "Your profile" draw the same one.
///
/// The picture is fetched with the session cookie from the owner's own route
/// and kept in memory only — never on disk, never in the image pipeline's
/// cache — and forgotten at sign-out, so the next person on the phone never
/// sees it. `ready` is false until the shop keeps photos (migration 0076), and
/// nothing is offered then.
@Observable @MainActor
final class ProfilePhotoModel {
    private(set) var ready = false
    private(set) var image: UIImage?
    private(set) var saving = false
    private var shownURL: String?
    private let account: AccountServicing

    init(account: AccountServicing) {
        self.account = account
    }

    var hasPhoto: Bool { shownURL != nil }

    func load() async {
        guard let info = try? await account.profilePhoto() else { return }
        ready = info.ready
        await show(info.url)
    }

    private func show(_ url: String?) async {
        guard url != shownURL else { return }
        shownURL = url
        guard let url else { image = nil; return }
        let data = try? await account.profilePhotoData(path: url)
        // A later answer may have moved on while this one was on its way.
        guard shownURL == url else { return }
        image = data.flatMap(UIImage.init(data:))
    }

    /// Sends the prepared square and shows it at once, without asking for it back.
    func save(_ prepared: (data: Data, image: UIImage)) async throws {
        saving = true
        defer { saving = false }
        let info = try await account.uploadProfilePhoto(jpeg: prepared.data)
        ready = info.ready
        shownURL = info.url
        image = info.url == nil ? nil : prepared.image
    }

    func remove() async throws {
        saving = true
        defer { saving = false }
        let info = try await account.removeProfilePhoto()
        ready = info.ready
        shownURL = nil
        image = nil
    }

    func signedOut() {
        ready = false
        shownURL = nil
        image = nil
    }
}
