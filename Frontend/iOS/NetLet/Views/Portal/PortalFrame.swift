import SwiftUI

/// What the web's side column gives every portal page, on a phone: each menu
/// link's icon, the page jump, and the menu itself drawn as the column is —
/// grouped by task, an icon plate per page. The web's `MENU_ICONS` names a
/// drawing per page; these are the system's nearest, one per address.
enum PortalIcons {
    static let byPage: [String: String] = [
        "/admin": "speedometer",
        "/admin/products": "square.grid.2x2",
        "/admin/stock": "shippingbox",
        "/admin/import": "square.and.arrow.down.on.square",
        "/admin/bundles": "square.stack.3d.up",
        "/admin/review": "checklist",
        "/admin/subcategory-pictures": "photo.on.rectangle.angled",
        "/admin/orders": "list.bullet.rectangle.portrait",
        "/admin/dispatch": "box.truck",
        "/admin/fulfilment": "archivebox",
        "/admin/returns": "arrow.uturn.backward",
        "/admin/warranty": "checkmark.shield",
        "/admin/claims": "exclamationmark.shield",
        "/admin/couriers": "building.2",
        "/admin/offers": "tag",
        "/admin/support": "lifepreserver",
        "/admin/guides": "book",
        "/admin/membership": "checkmark.seal",
        "/admin/finance": "banknote",
        "/admin/payouts": "building.columns",
        "/admin/invoices": "doc.text",
        "/admin/promotions": "ticket",
        "/admin/ads": "megaphone",
        "/admin/affiliates": "link",
        "/admin/commission": "percent",
        "/admin/team": "person.2",
        "/admin/store-documents": "folder",
        "/admin/vendors": "storefront",
        "/admin/applications": "list.clipboard",
        "/admin/people": "person.crop.circle.badge.checkmark",
        "/admin/devices": "iphone",
        "/admin/audit": "scroll",
        "/admin/fraud": "eye",
        "/admin/subscriptions": "repeat",
        "/admin/features": "switch.2",
    ]

    static func symbol(_ href: String) -> String { byPage[href] ?? "circle" }
}

/// A page's icon on its plate, the web column's link mark.
struct PortalIconPlate: View {
    let href: String
    var size: CGFloat = 32

    var body: some View {
        Image(systemName: PortalIcons.symbol(href))
            .font(.system(size: size * 0.47, weight: .semibold))
            .foregroundStyle(Brand.navy)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).fill(PortalLook.ground))
            .flipsForRightToLeftLayoutDirection(href == "/admin/returns")
            .accessibilityHidden(true)
    }
}

/// The page jump (`PageJump`): the menu typed, folded the way the shop's
/// search folds Arabic, so "مخزون" finds Stock whichever spelling is typed.
/// Only the pages this person may open and the app draws.
struct PortalJumpSheet: View {
    let actor: SellerIdentity
    @State private var query = ""
    @Environment(AppModel.self) private var app
    @Environment(LanguageSettings.self) private var l
    @Environment(\.dismiss) private var dismiss

    private var links: [PortalRules.Link] {
        PortalRules.shared.menu(for: actor).flatMap(\.links)
    }

    private var matches: [PortalRules.Link] {
        let words = SearchRank.fold(query).split(separator: " ").map(String.init)
        guard !words.isEmpty else { return links }
        return links.filter { link in
            let name = SearchRank.fold(l.t(link.label))
            return words.allSatisfy { name.contains($0) }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if matches.isEmpty {
                    Text(l.t("shell.jumpNone")).font(.inter(14)).foregroundStyle(Brand.muted)
                } else {
                    Section(l.t("shell.jumpPages")) {
                        ForEach(matches, id: \.href) { link in
                            Button {
                                dismiss()
                                app.open(.portal(link.href))
                            } label: {
                                HStack(spacing: 12) {
                                    PortalIconPlate(href: link.href, size: 30)
                                    Text(l.t(link.label)).font(.inter(15, .semibold)).foregroundStyle(Brand.ink)
                                    Spacer()
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.tap)
                        }
                    }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: l.t("shell.jumpPlaceholder"))
            .navigationTitle(l.t("shell.jumpTo"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { BarButton(l.t("common.close")) { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
