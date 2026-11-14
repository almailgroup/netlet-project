import QuickLook
import SwiftUI

/// A product's catalogues, under the product on its page — the web's
/// `ProductCatalogues`, on the owner's word ("add Product catalogue for
/// products. That shows below the product"): each PDF by its title in the
/// page's language, or its file's name, with its size, View and Download.
/// Nothing at all for a product with none.
///
/// View opens the file in Quick Look; Download hands it to the share sheet,
/// where Save to Files is. Either way the file is fetched first — whole, or
/// part by part when it is too large for one answer (`downloadCatalogue`).
struct ProductCataloguesSection: View {
    let productId: String
    // A VStack, not a Group: a `.task` on a Group with nothing in it never runs.
    @State private var cards: [CatalogueCard] = []
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !cards.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text(l.t("catalogue.heading")).shelfTitle()
                    ForEach(cards) { card in
                        CatalogueCardView(card: card)
                    }
                }
                .padding(.top, 40)
            }
        }
        .task(id: productId) {
            cards = (try? await app.services.api.call(API.cataloguesForProduct, .init(productId: productId))) ?? []
        }
    }
}

/// One catalogue: what it is, how big, and the two ways to have it.
struct CatalogueCardView: View {
    let card: CatalogueCard
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CatalogueIdentity(card: card)
            CatalogueActions(card: card)
        }
        .card(padding: 14)
    }
}

/// The file's icon, its name and "PDF, 2.4 MB".
struct CatalogueIdentity: View {
    let card: CatalogueCard
    var detail: String?
    @Environment(LanguageSettings.self) private var l

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "doc.text")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Brand.navy)
                .frame(width: 46, height: 46)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Brand.tint))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(card.name(l.current))
                    .font(.inter(15, .bold))
                    .foregroundStyle(Brand.navy)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                // The size isolated: on the Arabic page the Latin "PDF" would
                // pull its number into its own run and the line read backwards.
                Text(detail ?? l.t("catalogue.fileKind", ["size": OrderWording.isolated(DocumentWords.size(card.sizeBytes, l))]))
                    .font(.inter(12))
                    .foregroundStyle(Brand.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }
}

/// View (Quick Look) and Download (the share sheet), each fetching the file first.
struct CatalogueActions: View {
    let card: CatalogueCard
    @State private var fetching: Kind?
    @State private var preview: URL?
    @State private var sharing: SharedFile?
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l

    enum Kind { case view, download }

    var body: some View {
        HStack(spacing: 8) {
            Button {
                Task { await fetch(.view) }
            } label: {
                label(.view, icon: "eye", text: l.t("catalogue.view"))
            }
            .buttonStyle(CatalogueButtonStyle(navy: true))
            .accessibilityLabel(l.t("catalogue.viewName", ["name": card.name(l.current)]))
            Button {
                Task { await fetch(.download) }
            } label: {
                label(.download, icon: "arrow.down.circle", text: l.t("catalogue.download"))
            }
            .buttonStyle(CatalogueButtonStyle(navy: false))
            .accessibilityLabel(l.t("catalogue.downloadName", ["name": card.name(l.current)]))
        }
        .disabled(fetching != nil)
        .quickLookPreview($preview)
        .sheet(item: $sharing) { file in
            ActivitySheet(items: [file.url]).languageDirection()
        }
    }

    private func label(_ kind: Kind, icon: String, text: String) -> some View {
        HStack(spacing: 6) {
            if fetching == kind {
                ProgressView().tint(kind == .view ? .white : Brand.navy)
            } else {
                Image(systemName: icon)
            }
            Text(text).lineLimit(1)
        }
    }

    private func fetch(_ kind: Kind) async {
        fetching = kind
        defer { fetching = nil }
        var file: URL?
        guard await app.attempt(fallback: "catalogue.openFailed", {
            file = try await app.services.seller.downloadCatalogue(id: card.id, sizeBytes: card.sizeBytes, fileName: card.fileName)
        }), let file else { return }
        if kind == .view { preview = file } else { sharing = SharedFile(url: file) }
    }
}

/// A catalogue's two buttons: navy glass for View, clear glass for Download,
/// a thumb's height, the words never broken.
struct CatalogueButtonStyle: ButtonStyle {
    let navy: Bool
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(14, .semibold))
            .foregroundStyle(navy ? Color.white : Brand.navy.opacity(isEnabled ? 1 : 0.45))
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.horizontal, 12)
            .liquidGlass(navy ? .navy : .clear, enabled: isEnabled, pressed: configuration.isPressed)
            .pressHaptic(configuration.isPressed)
    }
}
