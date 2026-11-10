import SwiftUI
import UIKit

/// The web's own pictures, carried in the app: the logo, each department's
/// art, NetLet's street and the home page's slides.
///
/// `pnpm ios:resources` copies them byte for byte from `Frontend/Web` into
/// `Resources/Web/` and writes `assets.json` saying which file is which and
/// the slides' order — the street first, then `assets/hero/` by name, the
/// web's `heroSlides` — so a picture changed on the web is changed here by
/// running the script, and `exportShared.test.ts` fails until it has been.
/// The files are WebP and PNG, which the system decodes itself.
enum WebAssets {
    struct Manifest: Decodable {
        let logo: String
        let footerLogo: String
        let heroSlides: [String]
        let departments: [String: String]

        static let empty = Manifest(logo: "", footerLogo: "", heroSlides: [], departments: [:])
    }

    static let manifest: Manifest = (try? JSONDecoder().decode(Manifest.self, from: Bundle.main.resource("assets", "json"))) ?? .empty

    private static let cache = NSCache<NSString, UIImage>()

    /// A bundled picture by its file name, decoded once and kept.
    static func image(_ name: String) -> UIImage? {
        guard !name.isEmpty else { return nil }
        if let cached = cache.object(forKey: name as NSString) { return cached }
        let ext = (name as NSString).pathExtension
        let base = (name as NSString).deletingPathExtension
        guard let path = Bundle.main.path(forResource: base, ofType: ext), let image = UIImage(contentsOfFile: path) else { return nil }
        cache.setObject(image, forKey: name as NSString)
        return image
    }

    /// The names whose pixels are already decoded (`prepare`).
    private static let decoded = NSCache<NSString, NSNumber>()

    /// Decodes a bundled picture off the main thread and keeps it, so drawing
    /// it for the first time costs nothing. `image` only opens the file: its
    /// pixels are decoded when it is first drawn, on the main thread — and
    /// for the home page's pictures, each some 1,600 points wide and coming in
    /// one after another every three seconds, that was a pause in the middle
    /// of whatever the page was doing, a scroll included, five times in the
    /// first quarter of a minute.
    static func prepare(_ name: String) async {
        let key = name as NSString
        guard decoded.object(forKey: key) == nil, let opened = image(name) else { return }
        if let ready = await opened.byPreparingForDisplay() {
            cache.setObject(ready, forKey: key)
        }
        decoded.setObject(1, forKey: key)
    }

    static var logo: UIImage? { image(manifest.logo) }
    static var footerLogo: UIImage? { image(manifest.footerLogo) }
    /// NetLet's own street — the first of the home page's slides, and the
    /// band at the top of signing in, as on the web.
    static var street: UIImage? { manifest.heroSlides.first.flatMap(image) }

    /// A department's art by its slug, "all" for every department.
    static func department(_ slug: String) -> UIImage? {
        manifest.departments[slug].flatMap(image)
    }

    /// A department's art as its file's own bytes (WebP) — the style a
    /// subcategory's picture is drawn to match (`PortalSubcategoryPicturesView`).
    static func departmentFile(_ slug: String) -> Data? {
        guard let name = manifest.departments[slug] else { return nil }
        let ext = (name as NSString).pathExtension
        let base = (name as NSString).deletingPathExtension
        guard let path = Bundle.main.path(forResource: base, ofType: ext) else { return nil }
        return FileManager.default.contents(atPath: path)
    }
}

/// A bundled picture, or nothing at all when the file is missing — a gap is
/// quieter than a broken image.
struct BundledImage: View {
    let image: UIImage?
    var contentMode: ContentMode = .fit

    var body: some View {
        if let image {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: contentMode)
        } else {
            Color.clear
        }
    }
}
