import SwiftUI

/// The empty search field's words: "Search for" and an example that rolls up
/// to the next every few seconds, on the owner's word ("give recommendations
/// in the text for the search bar that cycle through smoothly"). The examples
/// are the shop's own (`HomeShelf.searchExamples`), never a phrase it may not
/// sell — the reason the web's field stopped cycling hard-coded ones.
///
/// Only the example moves: the words around it hold still, the new one rises
/// in from below as the last rises out, inside the line's own height, so the
/// field never jumps. It holds still under Reduce Motion and while VoiceOver
/// runs, which reads the field's own name rather than its changing words, and
/// it stops on the page it is not on (`.task`).
struct CyclingExample: View {
    let examples: [String]
    @Environment(LanguageSettings.self) private var l
    @Environment(\.accessibilityReduceMotion) private var still
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var turn = 0

    /// How long each example stays.
    static let seconds = 2.6

    var body: some View {
        if examples.isEmpty {
            Text(l.t("header.searchAria"))
        } else {
            // The sentence around the example, in the page's own order: the
            // template split where the example goes.
            let parts = l.t("header.searchPlaceholder", ["example": "\u{1}"]).components(separatedBy: "\u{1}")
            let before = parts.first?.trimmingCharacters(in: .whitespaces) ?? ""
            let after = parts.count > 1 ? parts[1].trimmingCharacters(in: .whitespaces) : ""
            HStack(spacing: 4) {
                if !before.isEmpty { Text(before).layoutPriority(1) }
                ZStack(alignment: .leading) {
                    Text(examples[turn % examples.count])
                        .id(turn)
                        .transition(.asymmetric(
                            insertion: .move(edge: .bottom).combined(with: .opacity),
                            removal: .move(edge: .top).combined(with: .opacity)
                        ))
                }
                .clipped()
                if !after.isEmpty { Text(after) }
            }
            .lineLimit(1)
            .task(id: examples) {
                turn = 0
                guard examples.count > 1, !still, !voiceOver else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(Self.seconds))
                    guard !Task.isCancelled else { return }
                    withAnimation(.spring(duration: 0.5, bounce: 0.12)) { turn += 1 }
                }
            }
        }
    }
}
