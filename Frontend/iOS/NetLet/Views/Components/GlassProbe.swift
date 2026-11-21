#if DEBUG
import SwiftUI

/// Debug only: the app's glass over two flat swatches — the page's ground and
/// black — for `GlassUITests` to read off a screenshot what the glass makes of
/// each (`-NetLetOpen glassProbe`). Down each column: the header's glass (60%
/// to 45%), the light blur alone, and the floating bars' capsule, far enough
/// apart, and far enough from the other column, that no blur reaches another
/// piece's face or the other swatch where the test reads it.
struct GlassProbe: View {
    var body: some View {
        HStack(spacing: 0) {
            column("ground", Brand.ground)
            column("black", .black)
        }
        .ignoresSafeArea()
    }

    private func column(_ name: String, _ swatch: Color) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 100)
            GlassSurface(top: 0.6, foot: 0.45, rim: false)
                .frame(height: 64)
                .overlay(mark("probe-\(name)-bar"))
            Spacer().frame(height: 110)
            mark("probe-\(name)-bare").frame(width: 40, height: 40)
            Spacer().frame(height: 110)
            GlassBlur()
                .frame(height: 44)
                .overlay(mark("probe-\(name)-blur"))
            Spacer().frame(height: 150)
            GlassCapsule()
                .frame(height: 56)
                .overlay(mark("probe-\(name)-capsule"))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(swatch)
    }

    private func mark(_ id: String) -> some View {
        Color.clear
            .accessibilityElement()
            .accessibilityLabel(id)
            .accessibilityIdentifier(id)
    }
}
#endif
