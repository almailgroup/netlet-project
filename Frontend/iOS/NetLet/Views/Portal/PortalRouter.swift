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
        case .newProduct(let vendorId): NewListingView(vendorId: vendorId)
        case .product(let id): PortalProductEditorView(productId: id)
        case .orders: PortalOrdersView()
        case .stock: PortalStockView()
        case .offers: PortalOffersView()
        case .messages: PortalMessagesView()
        case .thread(let id): PortalThreadView(conversationId: id)
        case .returns: PortalReturnsView()
        case .team: PortalTeamView()
        case .payouts: PortalPayoutsView()
        case .bundles: PortalBundlesView()
        case .importProducts: PortalImportView()
        case .dispatch: PortalDispatchView()
        case .claims: PortalClaimsView()
        case .fulfilment: PortalFulfilmentView()
        case .ads: PortalAdsView()
        case .review: PortalReviewView()
        case .applications: PortalApplicationsView()
        case .people: PortalPeopleView()
        case .audit: PortalAuditView()
        case .features: PortalFeaturesView()
        case .subscriptions: PortalSubscriptionsView()
        case .vendors: PortalStoresView()
        case .newVendor: PortalNewStoreView()
        case .vendor(let id): PortalStoreView(vendorId: id)
        case .finance: PortalFinanceView()
        case .invoices: PortalInvoicesView()
        case .promotions: PortalPromotionsView()
        case .affiliates: PortalAffiliatesView()
        case .membership: PortalMembershipView()
        case .support: PortalSupportView()
        case .supportThread(let id): PortalSupportThreadView(conversationId: id)
        case .guides: PortalGuidesView()
        case .guide(let id): PortalGuideEditorView(guideId: id)
        case .couriers: PortalCouriersView()
        }
    }
}
