import SwiftUI

/// A merchant's picture, which is never a broken icon.
///
/// Until uploads are universal these are addresses a seller typed, so a dead
/// link is an ordinary state — the web's `Thumb` rule. Absent and failing both
/// draw the same quiet fallback, and the box keeps its size either way, so a
/// picture arriving late moves nothing.
///
/// The picture comes from `ImagePipeline`, at the size of the box it fills:
/// drawn on the first frame when it has been seen before, faded in when it
/// arrives, and still on its way if the box scrolls off and comes back — the
/// load belongs to the picture, not to this view (see `ImagePipeline` for the
/// photos that never arrived under `AsyncImage`).
struct RemoteImage: View {
    let reference: String?
    var contentMode: ContentMode = .fill
    var label: String?

    @Environment(AppModel.self) private var app
    @Environment(\.displayScale) private var scale
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        let url = app.services.configuration.resolve(reference)
        GeometryReader { box in
            // A box not yet laid out asks for nothing: its size decides the copy.
            PipelinedImage(url: url, pixels: ImagePipeline.pixels(for: box.size, scale: scale), sized: box.size.width >= 1 && box.size.height >= 1,
                           contentMode: contentMode, still: still)
                .frame(width: box.size.width, height: box.size.height)
        }
        .accessibilityElement()
        .accessibilityLabel(label ?? "")
        .accessibilityHidden(label == nil)
    }
}

/// The picture at one size, asked of the pipeline once the box has one.
private struct PipelinedImage: View {
    let url: URL?
    let pixels: Int
    let sized: Bool
    let contentMode: ContentMode
    let still: Bool

    @State private var image: UIImage?
    @State private var failed = false
    /// Whose picture `image` is, so a box handed another address never shows
    /// the last one while the new one comes — and a box that only changed
    /// size keeps its picture until the copy for the new size is ready.
    @State private var shownURL: URL?

    var body: some View {
        let key = sized ? url.map { ImagePipeline.key($0, pixels: pixels) } : nil
        // Seen before at this size: drawn on this frame rather than after a round trip.
        let cached = sized ? url.flatMap { ImagePipeline.shared.cached($0, pixels: pixels) } : nil
        let ready = cached ?? (url != nil && shownURL == url ? image : nil)
        ZStack {
            if let ready {
                Image(uiImage: ready)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else if url == nil || failed {
                fallback
            } else {
                Brand.tint
            }
        }
        .task(id: key) {
            guard let url, key != nil, cached == nil else { return }
            failed = false
            let loaded = await ImagePipeline.shared.image(url, pixels: pixels)
            // Gone from the screen: the pipeline keeps the picture for the next time.
            guard !Task.isCancelled else { return }
            withAnimation(still || shownURL == url ? nil : .easeOut(duration: 0.2)) {
                if let loaded {
                    image = loaded
                    shownURL = url
                }
                failed = loaded == nil && shownURL != url
            }
        }
    }

    private var fallback: some View {
        ZStack {
            Brand.tint
            Image(systemName: "photo")
                .font(.title2)
                .foregroundStyle(Brand.muted.opacity(0.6))
        }
    }
}
