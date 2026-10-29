import AVKit
import SwiftUI
import UIKit

/// The product page's photographs and the two viewers they open — the web's
/// `ProductGallery`, `PhotoSheet` and `ZoomViewer` as a phone draws them.
///
/// A press on the photo opens every photo, the width of the screen and square,
/// one under another, at the one being looked at; a press on one of those opens
/// it full screen on white, to pinch, double-tap and drag. Close steps back one
/// layer at a time, and back from full screen the photo last looked at is the
/// one in view. A video sits in the sequence between the photographs and plays
/// where it is, with the system's own controls and never by itself.

/// The frame round every photo, `#e2e5eb`.
private let photoLine = Color(red: 226 / 255, green: 229 / 255, blue: 235 / 255)

// MARK: - On the page

/// The photo the page opens on: a square stage that swipes between the
/// gallery's items, share, save and the viewer in its end corner, an arrow at
/// each side, the count at its start, and under it up to four thumbnails with
/// "+N" for the rest.
struct ProductPhotos: View {
    let product: Product
    @Binding var index: Int
    /// Opens every photo, at `index`.
    let open: () -> Void

    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var findingSimilar = false
    @Environment(\.displayScale) private var scale

    var body: some View {
        let media = product.gallery
        VStack(alignment: .leading, spacing: 12) {
            stage(media)
            if media.count > 1 {
                rail(media)
                Text(l.t("product.galleryHintTouch"))
                    .font(.inter(12, .semibold))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        // The photographs a swipe will bring, fetched while the first is looked at.
        .task(id: product.id) {
            let pixels = ImagePipeline.pixels(for: CGSize(width: 350, height: 350), scale: scale)
            let photos = media.filter { !$0.isVideo }.dropFirst().compactMap { app.services.configuration.resolve($0.url) }
            guard !photos.isEmpty else { return }
            await ImagePipeline.shared.prefetch(Array(photos), pixels: pixels)
        }
    }

    private func stage(_ media: [ProductMedia]) -> some View {
        TabView(selection: $index) {
            if media.isEmpty {
                Image(systemName: "shippingbox")
                    .font(.system(size: 72, weight: .light))
                    .foregroundStyle(Brand.tint)
                    .tag(0)
            }
            ForEach(Array(media.enumerated()), id: \.offset) { offset, item in
                Group {
                    if item.isVideo {
                        GalleryVideo(
                            url: item.url,
                            poster: item.posterUrl,
                            playLabel: l.t("product.showVideo", ["index": "\(offset + 1)", "total": "\(media.count)"])
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .padding(20)
                    } else {
                        Button(action: open) {
                            RemoteImage(reference: item.url, contentMode: .fit)
                                .padding(20)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.tap)
                        .accessibilityLabel(item.altText ?? product.title)
                        .accessibilityHint(l.t("product.openViewer"))
                    }
                }
                .tag(offset)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(height: 340)
        .frame(maxWidth: .infinity)
        .background(Color.white)
        .overlay {
            if media.count > 1 {
                HStack {
                    arrow(previous: true, count: media.count)
                    Spacer()
                    arrow(previous: false, count: media.count)
                }
                .padding(.horizontal, 12)
            }
        }
        .overlay(alignment: .topTrailing) {
            VStack(spacing: 8) {
                ShareLink(
                    item: shareURL,
                    subject: Text(product.title),
                    message: Text(l.t("product.shareText", ["name": product.title]))
                ) {
                    disc(symbol: "square.and.arrow.up", tint: Brand.navy)
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("product.share", ["name": product.title]))
                saveButton
                Button(action: open) {
                    disc(symbol: "plus.magnifyingglass", tint: Brand.navy)
                }
                .buttonStyle(.tap)
                .accessibilityLabel(l.t("product.openViewer"))
            }
            .padding(12)
        }
        .overlay(alignment: .bottomTrailing) {
            // "Find similar" (3.1.6: visual search "also from any product
            // page"), words on it as on the web. Not over a video, whose
            // controls are there.
            if !(media.indices.contains(index) && media[index].isVideo) {
                Button {
                    Task { await findSimilar() }
                } label: {
                    HStack(spacing: 6) {
                        if findingSimilar {
                            ProgressView().controlSize(.small).tint(Brand.navy)
                        } else {
                            Image(systemName: "text.viewfinder").font(.system(size: 14, weight: .medium))
                        }
                        Text(l.t("product.findSimilar")).font(.inter(14, .medium))
                    }
                    .foregroundStyle(Brand.navy)
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(Capsule().fill(Color.white))
                    .shadow(color: Brand.navy.opacity(0.14), radius: 5, x: 0, y: 2)
                }
                .buttonStyle(.tap)
                .disabled(findingSimilar)
                .padding(12)
            }
        }
        .overlay(alignment: .bottomLeading) {
            if media.count > 1 {
                Text(verbatim: "\u{2066}\(index + 1) / \(media.count)\u{2069}")
                    .font(.inter(12, .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Brand.navy.opacity(0.85)))
                    .padding(12)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(photoLine, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("product.productImages"))
    }

    /// The server reads this product's photo and title and names the kind of
    /// thing; the press lands on a search for it within the department.
    private func findSimilar() async {
        findingSimilar = true
        defer { findingSimilar = false }
        var reply: SimilarReply?
        guard await app.attempt(fallback: "error.serverProblem", {
            reply = try await app.services.api.call(API.findSimilar, .init(productId: product.id, locale: l.current.rawValue))
        }), let reply else { return }
        app.push(reply.route)
    }

    /// The heart, as the card's: red once saved, and a toast saying so.
    private var saveButton: some View {
        let saved = app.saved.isHearted(product.id)
        return Button {
            Task { await app.heart(product) }
        } label: {
            disc(symbol: saved ? "heart.fill" : "heart", tint: saved ? Color(red: 230 / 255, green: 28 / 255, blue: 56 / 255) : Brand.navy)
        }
        .buttonStyle(.action)
        .accessibilityLabel(l.t(saved ? "product.removeSaved" : "product.save", ["name": product.title]))
        .accessibilityAddTraits(saved ? .isSelected : [])
    }

    /// Signed in, the address carries the sharer's code: a product link (3.1.14).
    private var shareURL: URL {
        app.services.configuration.url(path: ReferralCode.productPath(handle: product.handle, userId: app.session.user?.id))
    }

    /// One of the white discs on the photo.
    private func disc(symbol: String, tint: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(tint)
            .frame(width: 40, height: 40)
            .background(Circle().fill(Color.white))
            .shadow(color: Brand.navy.opacity(0.14), radius: 5, x: 0, y: 2)
            .contentShape(Circle().inset(by: -2))
    }

    /// Previous at the start, next at the end, each pointing the way it goes
    /// on either page.
    private func arrow(previous: Bool, count: Int) -> some View {
        Button {
            withAnimation(still ? nil : .easeOut(duration: 0.25)) {
                index = GalleryRules.step(index, by: previous ? -1 : 1, count: count)
            }
        } label: {
            Image(systemName: previous ? "chevron.backward" : "chevron.forward")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Color.white))
                .shadow(color: Brand.navy.opacity(0.18), radius: 6, x: 0, y: 2)
                .contentShape(Circle().inset(by: -2))
        }
        .buttonStyle(.tap)
        .accessibilityLabel(l.t(previous ? "product.prevImage" : "product.nextImage"))
    }

    /// Up to four thumbnails, the current one ringed in navy, and "+N" for the
    /// rest, which opens them all.
    private func rail(_ media: [ProductMedia]) -> some View {
        let (shown, more) = GalleryRules.rail(count: media.count)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(0..<shown, id: \.self) { offset in
                    let item = media[offset]
                    Button {
                        withAnimation(still ? nil : .easeOut(duration: 0.2)) { index = offset }
                    } label: {
                        thumbnail(item)
                            .frame(width: 62, height: 62)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(index == offset ? Brand.navy : photoLine, lineWidth: 2)
                            )
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t(item.isVideo ? "product.showVideo" : "product.showImage", ["index": "\(offset + 1)", "total": "\(media.count)"]))
                    .accessibilityAddTraits(index == offset ? [.isSelected] : [])
                }
                if more > 0 {
                    Button(action: open) {
                        VStack(spacing: 2) {
                            Text(verbatim: "+\(more)").font(.inter(16, .heavy))
                            Text(l.t("home.viewAll")).font(.inter(9, .bold)).lineLimit(1).minimumScaleFactor(0.8)
                        }
                        .foregroundStyle(.white)
                        .frame(width: 62, height: 62)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.navy))
                    }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("product.viewAllImages", ["count": "\(media.count)"]))
                }
            }
        }
    }

    @ViewBuilder
    private func thumbnail(_ item: ProductMedia) -> some View {
        if item.isVideo {
            ZStack {
                if let poster = item.posterUrl {
                    RemoteImage(reference: poster, contentMode: .fit).padding(4)
                }
                Image(systemName: "play.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(Brand.navy.opacity(0.85)))
            }
        } else {
            RemoteImage(reference: item.url, contentMode: .fit).padding(4)
        }
    }
}

// MARK: - Every photo

/// A phone's "Images": every item of the gallery, the width of the screen and
/// square, one under another, opening at the one being looked at. Square, so
/// a photo further up that has not loaded cannot push the one on screen down
/// when it does. A video plays where it is; a photo opens full screen — as a
/// layer over this list inside the same cover, the web's `ZoomViewer` over its
/// `PhotoSheet`, rather than a second cover presented from the first.
struct PhotoSheet: View {
    let product: Product
    @Binding var index: Int
    let close: () -> Void

    @State private var full: Bool
    @AccessibilityFocusState private var focusedPhoto: Int?
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    /// `startFull` opens straight on the full-screen viewer, from the first
    /// frame — for the screenshots CI takes.
    init(product: Product, index: Binding<Int>, startFull: Bool = false, close: @escaping () -> Void) {
        self.product = product
        _index = index
        self.close = close
        _full = State(initialValue: startFull)
    }

    var body: some View {
        let media = product.gallery
        ZStack {
            list(media)
                .accessibilityHidden(full)
            if full {
                ZoomViewer(items: media, index: $index, title: product.title) { full = false }
                    .transition(.opacity)
                    .accessibilityAddTraits(.isModal)
                    .zIndex(1)
            }
        }
        .animation(still ? nil : .easeOut(duration: 0.2), value: full)
    }

    private func list(_ media: [ProductMedia]) -> some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text(l.t("product.photosHint"))
                            .font(.inter(13, .semibold))
                            .foregroundStyle(Brand.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        LazyVStack(spacing: 12) {
                            ForEach(Array(media.enumerated()), id: \.offset) { offset, item in
                                row(item, offset: offset, total: media.count)
                                    .id(offset)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 16)
                }
                .task {
                    // Once, on opening, after the first layout: the list does
                    // not follow the page's photo afterwards.
                    await Task.yield()
                    proxy.scrollTo(index, anchor: .top)
                }
                .onChange(of: full) { _, open in
                    // Back from full screen, the photo last looked at — perhaps
                    // not the one pressed, if the shopper swiped along — is the
                    // one in view, and the one VoiceOver is on, once the list is
                    // back in the accessibility tree.
                    guard !open else { return }
                    proxy.scrollTo(index)
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(250))
                        focusedPhoto = index
                    }
                }
            }
        }
        .background(Color(red: 247 / 255, green: 247 / 255, blue: 245 / 255).ignoresSafeArea())
        // Escape here is the list's; full screen answers its own first, so one
        // Escape steps back one layer (`useOverlay`'s stack).
        .accessibilityAction(.escape) { close() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(l.t("product.images"))
                    .font(.inter(18, .heavy))
                    .foregroundStyle(Brand.navy)
                    .accessibilityAddTraits(.isHeader)
                Text(product.title)
                    .font(.inter(13))
                    .foregroundStyle(Brand.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Brand.body)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(PressFillStyle(cornerRadius: 22))
            .accessibilityLabel(l.t("product.closeViewer"))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.white.ignoresSafeArea(edges: .top))
        .overlay(alignment: .bottom) { Rectangle().fill(Brand.cardLine).frame(height: 1) }
    }

    @ViewBuilder
    private func row(_ item: ProductMedia, offset: Int, total: Int) -> some View {
        if item.isVideo {
            Color.black
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    GalleryVideo(
                        url: item.url,
                        poster: item.posterUrl,
                        playLabel: l.t("product.showVideo", ["index": "\(offset + 1)", "total": "\(total)"])
                    )
                }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(photoLine, lineWidth: 1))
                .accessibilityFocused($focusedPhoto, equals: offset)
        } else {
            Button {
                index = offset
                full = true
            } label: {
                Color.white
                    .aspectRatio(1, contentMode: .fit)
                    .overlay {
                        RemoteImage(reference: item.url, contentMode: .fit)
                            .padding(16)
                    }
                    .overlay(alignment: .bottomTrailing) {
                        HStack(spacing: 6) {
                            Image(systemName: "plus.magnifyingglass").font(.system(size: 12, weight: .bold))
                            Text(verbatim: "\u{2066}\(offset + 1) / \(total)\u{2069}")
                        }
                        .font(.inter(12, .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(Brand.navy.opacity(0.85)))
                        .padding(10)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(photoLine, lineWidth: 1))
            }
            .buttonStyle(.tap)
            .accessibilityLabel(l.t("product.openPhoto", ["index": "\(offset + 1)", "total": "\(total)"]))
            .accessibilityFocused($focusedPhoto, equals: offset)
        }
    }
}

// MARK: - Full screen

/// One photo the whole screen, on white because product photographs are shot
/// on white. Two fingers pinch about the spot between them, a double tap goes
/// to 2.5× at the spot and back, one finger moves a zoomed photo only as far
/// as it hangs over the screen, and a swipe goes to the next — mirrored on the
/// Arabic page. The buttons do all of it for anybody who cannot pinch.
struct ZoomViewer: View {
    let items: [ProductMedia]
    @Binding var index: Int
    let title: String
    let close: () -> Void

    @State private var scale: CGFloat = 1
    @State private var request: ZoomRequest?
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still

    private var item: ProductMedia? { items.indices.contains(index) ? items[index] : items.first }
    private var many: Bool { items.count > 1 }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text(verbatim: many ? "\u{2066}\(index + 1) / \(items.count)\u{2069}" : " ")
                    .font(.inter(14, .bold))
                    .foregroundStyle(Brand.navy)
                    .frame(minWidth: 44, alignment: .leading)
                    .padding(.horizontal, 8)
                    .accessibilityHidden(!many)
                Spacer()
                Button(action: close) { disc("xmark", size: 20) }
                    .buttonStyle(.tap)
                    .accessibilityLabel(l.t("product.closeZoom"))
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 8)
            stage
            HStack(spacing: 12) {
                Button { zoom(to: GalleryRules.zoomedOut(from: scale)) } label: { disc("minus.magnifyingglass", size: 18) }
                    .buttonStyle(.tap)
                    .disabled(scale <= 1 || item?.isVideo == true)
                    .opacity(scale <= 1 || item?.isVideo == true ? 0.35 : 1)
                    .accessibilityLabel(l.t("product.zoomOut"))
                Text(l.t(scale > 1 ? "product.zoomDrag" : "product.zoomHint"))
                    .font(.inter(13, .semibold))
                    .foregroundStyle(Brand.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                Button { zoom(to: GalleryRules.zoomedIn(from: scale)) } label: { disc("plus.magnifyingglass", size: 18) }
                    .buttonStyle(.tap)
                    .disabled(scale >= GalleryRules.maxZoom || item?.isVideo == true)
                    .opacity(scale >= GalleryRules.maxZoom || item?.isVideo == true ? 0.35 : 1)
                    .accessibilityLabel(l.t("product.zoomIn"))
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 12)
        }
        .background(Color.white.ignoresSafeArea())
        .accessibilityAction(.escape) { close() }
        .onChange(of: index) {
            scale = 1
            request = nil
        }
    }

    private var stage: some View {
        TabView(selection: $index) {
            ForEach(Array(items.enumerated()), id: \.offset) { offset, media in
                ZoomPage(
                    media: media,
                    label: media.altText ?? title,
                    playLabel: l.t("product.showVideo", ["index": "\(offset + 1)", "total": "\(items.count)"]),
                    current: offset == index,
                    request: offset == index ? request : nil
                ) { next in
                    if offset == index, next != scale { scale = next }
                }
                .tag(offset)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .overlay {
            if many && scale <= 1 {
                HStack {
                    arrow(previous: true)
                    Spacer()
                    arrow(previous: false)
                }
                .padding(.horizontal, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(l.t("product.zoomStage"))
        .accessibilityZoomAction { action in
            guard item?.isVideo != true else { return }
            switch action.direction {
            case .zoomIn: zoom(to: GalleryRules.zoomedIn(from: scale))
            default: zoom(to: GalleryRules.zoomedOut(from: scale))
            }
        }
    }

    private func zoom(to target: CGFloat) {
        request = ZoomRequest(scale: target, serial: (request?.serial ?? 0) + 1)
    }

    private func arrow(previous: Bool) -> some View {
        Button {
            withAnimation(still ? nil : .easeOut(duration: 0.25)) {
                index = GalleryRules.step(index, by: previous ? -1 : 1, count: items.count)
            }
        } label: {
            Image(systemName: previous ? "chevron.backward" : "chevron.forward")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 44, height: 44)
                .background(Circle().fill(Color.white))
                .shadow(color: Brand.navy.opacity(0.18), radius: 6, x: 0, y: 2)
        }
        .buttonStyle(.tap)
        .accessibilityLabel(l.t(previous ? "product.prevImage" : "product.nextImage"))
    }

    private func disc(_ symbol: String, size: CGFloat) -> some View {
        Image(systemName: symbol)
            .font(.system(size: size, weight: .medium))
            .foregroundStyle(Brand.navy)
            .frame(width: 44, height: 44)
            .background(Circle().fill(Brand.navy.opacity(0.06)))
            .contentShape(Circle())
    }
}

/// A zoom a button asked for; a new serial is a new request.
struct ZoomRequest: Equatable {
    let scale: CGFloat
    let serial: Int
}

/// One page of the full-screen viewer: the photo once it has loaded, the
/// quiet fallback if it will not, or the video.
private struct ZoomPage: View {
    let media: ProductMedia
    let label: String
    let playLabel: String
    let current: Bool
    let request: ZoomRequest?
    let onScale: (CGFloat) -> Void

    @State private var image: UIImage?
    @State private var failed = false
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            if media.isVideo {
                GalleryVideo(url: media.url, poster: media.posterUrl, playLabel: playLabel)
            } else if let image {
                ZoomablePhoto(image: image, current: current, request: request, onScale: onScale)
                    .accessibilityElement()
                    .accessibilityLabel(label)
                    .accessibilityAddTraits(.isImage)
            } else if failed {
                Image(systemName: "photo")
                    .font(.system(size: 40))
                    .foregroundStyle(Brand.muted.opacity(0.6))
                    .accessibilityLabel(label)
            } else {
                ProgressView().tint(Brand.navy)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: media.url) {
            guard !media.isVideo, image == nil else { return }
            guard let url = app.services.configuration.resolve(media.url) else {
                failed = true
                return
            }
            image = await PhotoLoader.image(at: url)
            failed = image == nil
        }
    }
}

/// Photographs for the full-screen viewer, through the app's one image
/// pipeline at the largest size it decodes — enough to zoom into — so the
/// bytes a card already fetched are not fetched again.
enum PhotoLoader {
    static let pixels = 3072

    static func image(at url: URL) async -> UIImage? {
        await ImagePipeline.shared.image(url, pixels: pixels)
    }
}

/// The system's own zooming scroll view round one photo: pinching about the
/// fingers, momentum and the rubber band at the edges are iOS's, a photo
/// smaller than the screen sits in its middle, and a double tap zooms to the
/// spot. Nested in the viewer's pages, a swipe at the photo's own size — or
/// past the edge of a zoomed one — goes to the next, as in Photos.
private struct ZoomablePhoto: UIViewRepresentable {
    let image: UIImage
    let current: Bool
    let request: ZoomRequest?
    let onScale: (CGFloat) -> Void

    func makeUIView(context: Context) -> ZoomScrollView {
        let view = ZoomScrollView()
        view.onScale = onScale
        view.show(image)
        return view
    }

    func updateUIView(_ view: ZoomScrollView, context: Context) {
        view.onScale = onScale
        if view.photo.image !== image { view.show(image) }
        // A photo swiped away is at its own size when it comes back.
        if !current, view.zoomScale != 1 { view.setZoomScale(1, animated: false) }
        if current, let request, request.serial != view.answered {
            view.answered = request.serial
            view.zoom(toScale: request.scale)
        }
    }
}

private final class ZoomScrollView: UIScrollView, UIScrollViewDelegate {
    let photo = UIImageView()
    var onScale: ((CGFloat) -> Void)?
    /// The last button press answered.
    var answered = 0
    private var laidOutFor: CGSize = .zero

    override init(frame: CGRect) {
        super.init(frame: frame)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = GalleryRules.maxZoom
        bouncesZoom = true
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        backgroundColor = .clear
        photo.contentMode = .scaleAspectFit
        addSubview(photo)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not used")
    }

    func show(_ image: UIImage) {
        photo.image = image
        laidOutFor = .zero
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != laidOutFor, bounds.width > 0, bounds.height > 0 else { return }
        laidOutFor = bounds.size
        zoomScale = 1
        let size = GalleryRules.fitted(photo.image?.size ?? bounds.size, in: bounds.size)
        photo.frame = CGRect(origin: .zero, size: size)
        contentSize = size
        centre()
    }

    /// The photo in the middle of the screen while it is smaller than it.
    private func centre() {
        let size = photo.frame.size
        let x = max(0, (bounds.width - size.width) / 2)
        let y = max(0, (bounds.height - size.height) / 2)
        contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { photo }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        centre()
        let scale = zoomScale
        // Told after this pass, never while SwiftUI is drawing.
        DispatchQueue.main.async { [weak self] in self?.onScale?(scale) }
    }

    @objc private func doubleTapped(_ recogniser: UITapGestureRecognizer) {
        if zoomScale > 1 {
            setZoomScale(1, animated: true)
        } else {
            let spot = recogniser.location(in: photo)
            zoom(to: GalleryRules.zoomRect(around: spot, scale: GalleryRules.tapZoom, viewport: bounds.size), animated: true)
        }
    }

    /// A button's zoom, about the middle of what is on screen.
    func zoom(toScale scale: CGFloat) {
        guard scale > 1 else {
            setZoomScale(1, animated: true)
            return
        }
        let middle = convert(CGPoint(x: bounds.midX, y: bounds.midY), to: photo)
        zoom(to: GalleryRules.zoomRect(around: middle, scale: scale, viewport: bounds.size), animated: true)
    }
}

// MARK: - Video

/// A product video, the web's `<video controls playsInline preload="metadata">`:
/// its poster and a play button until pressed, then the system's player.
/// Never plays by itself, and stops when it leaves the screen.
struct GalleryVideo: View {
    let url: String
    let poster: String?
    let playLabel: String

    @State private var player: AVPlayer?
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            Color.black
            if let player {
                VideoPlayer(player: player)
            } else {
                if let poster {
                    RemoteImage(reference: poster, contentMode: .fit)
                }
                Button {
                    guard let resolved = app.services.configuration.resolve(url) else { return }
                    let started = AVPlayer(url: resolved)
                    player = started
                    started.play()
                } label: {
                    Image(systemName: "play.fill")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 64, height: 64)
                        .background(Circle().fill(Brand.navy.opacity(0.85)))
                }
                .buttonStyle(.tap)
                .accessibilityLabel(playLabel)
            }
        }
        .onDisappear { player?.pause() }
    }
}
