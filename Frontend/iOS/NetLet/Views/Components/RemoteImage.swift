import SwiftUI

/// A merchant's picture, which is never a broken icon.
///
/// Until uploads are universal these are addresses a seller typed, so a dead
/// link is an ordinary state — the web's `Thumb` rule. Absent and failing both
/// draw the same quiet fallback, and the box keeps its size either way, so a
/// picture arriving late moves nothing.
struct RemoteImage: View {
    let reference: String?
    var contentMode: ContentMode = .fill
    var label: String?

    @Environment(AppModel.self) private var app

    var body: some View {
        let url = app.services.configuration.resolve(reference)
        Group {
            if let url {
                AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: contentMode)
                    case .failure:
                        fallback
                    default:
                        Brand.tint
                    }
                }
            } else {
                fallback
            }
        }
        .accessibilityElement()
        .accessibilityLabel(label ?? "")
        .accessibilityHidden(label == nil)
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
