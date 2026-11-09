import SwiftUI

/// One tab of `TextTabs`: what it is and the words drawn for it.
struct TextTab<ID: Hashable>: Identifiable {
    let id: ID
    let label: String
}

/// A row of plain-word tabs, drawn to the owner's picture of a shop's "Your
/// orders" — the web's `TextTabs`: the chosen one dark with a short rounded
/// line under it that slides to the next, the rest muted, a hairline under the
/// row, which scrolls sideways when it is wider than the screen and keeps the
/// chosen one in view. My orders and Saved items and wishlists both wear it,
/// so the two cannot drift apart. The choice is made inside the slide's
/// animation, so the line moves with the press; anything slow the parent
/// starts afterwards.
struct TextTabs<ID: Hashable>: View {
    let tabs: [TextTab<ID>]
    let selection: ID
    let choose: (ID) -> Void
    @Environment(\.accessibilityReduceMotion) private var still
    @Namespace private var underline

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 24) {
                        ForEach(tabs) { tab in button(tab) }
                    }
                    .padding(.horizontal, 16)
                }
                .onAppear { proxy.scrollTo(selection, anchor: .center) }
                .onChange(of: selection) { _, chosen in
                    withAnimation(still ? nil : .snappy(duration: 0.3)) { proxy.scrollTo(chosen, anchor: .center) }
                }
            }
            Rectangle().fill(Brand.cardLine).frame(height: 1)
        }
        .padding(.horizontal, -16)
    }

    private func button(_ tab: TextTab<ID>) -> some View {
        let on = selection == tab.id
        return Button {
            withAnimation(still ? nil : .snappy(duration: 0.28)) { choose(tab.id) }
        } label: {
            VStack(spacing: 8) {
                Text(tab.label)
                    .font(.inter(16, on ? .semibold : .medium))
                    .foregroundStyle(on ? Brand.navy : Brand.muted)
                    .lineLimit(1)
                    .fixedSize()
                ZStack {
                    Capsule().fill(Color.clear).frame(width: 28, height: 4)
                    if on {
                        Capsule().fill(Brand.navy).frame(width: 28, height: 4)
                            .matchedGeometryEffect(id: "underline", in: underline)
                    }
                }
            }
            .padding(.top, 4)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.tap)
        .id(tab.id)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
