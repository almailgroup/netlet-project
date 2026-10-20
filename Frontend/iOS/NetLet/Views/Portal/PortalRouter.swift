import SwiftUI

/// Draws the portal page a web address names (`PortalPage`), the way the
/// web's route table does for `/admin/...`; an address the app has no page
/// for opens the overview, which offers only what it does draw.
struct PortalRouter: View {
    let path: String

    var body: some View {
        switch PortalPage(path) ?? .home {
        case .home: PortalHomeView()
        case .products(let vendorId): PortalProductsView(vendorId: vendorId)
        case .newProduct: NewListingView()
        case .orders: PortalOrdersView()
        case .stock: PortalStockView()
        case .offers: PortalOffersView()
        case .messages: PortalMessagesView()
        case .thread(let id): PortalThreadView(conversationId: id)
        case .returns: PortalReturnsView()
        case .team: PortalTeamView()
        case .payouts: PortalPayoutsView()
        }
    }
}
