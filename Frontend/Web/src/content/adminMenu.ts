/**
 * The portal's menu: which pages there are, in which group, and what each
 * asks of the person signed in (`can`). The web's `AdminShell` draws it and
 * the iOS app reads the same list (`Frontend/iOS/scripts/exportShared.ts`),
 * so the two portals cannot offer different pages to the same person.
 *
 * Grouped, because the flat list had grown to twenty-eight links in one
 * column — the order a feature was built in, not the order anybody works.
 * Each group is what one kind of task reaches for, and a group a person
 * cannot use any of disappears with its heading.
 */
import { can, type Actor, type Capability } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";

/** `storeOnly`: a page about one store, for that store's own people. An
 *  administrator passes `can()` for it (they reach every store) but works a
 *  store's team and papers on that store's page under Vendors, so the page
 *  only ever told them to look elsewhere — and "Team" beside "NetLet team"
 *  read as the same thing. Left out of their menu on the owner's word. */
export type AdminMenuLink = { href: string; label: MessageKey; need: Capability | Capability[]; storeOnly?: true };
export type AdminMenuGroup = { label: MessageKey | null; links: AdminMenuLink[] };

/** The menu this person may use: what `can()` allows them, less a store's own
 *  pages for an administrator. A group with nothing left goes with its heading. */
export function menuFor(actor: Actor): AdminMenuGroup[] {
  const own = actor.kind === "vendor" ? actor.vendorId : undefined;
  const allowed = (link: AdminMenuLink) =>
    !(link.storeOnly && actor.kind === "admin")
    && (Array.isArray(link.need) ? link.need : [link.need]).some(one => can(actor, one, own));
  return ADMIN_MENU
    .map(group => ({ label: group.label, links: group.links.filter(allowed) }))
    .filter(group => group.links.length > 0);
}

export const ADMIN_MENU: AdminMenuGroup[] = [
  { label: null, links: [
    { href: "/admin", label: "admin.overview", need: "portal.home" },
  ] },
  { label: "admin.navCatalogue", links: [
    { href: "/admin/products", label: "admin.products", need: "product.view" },
    { href: "/admin/stock", label: "admin.stock", need: "product.view" },
    /* How many opened each product, in the app or on the website, and what came of it (0084). */
    { href: "/admin/views", label: "views.title", need: "product.view" },
    { href: "/admin/import", label: "admin.import", need: "product.create" },
    { href: "/admin/bundles", label: "admin.bundles", need: "product.view" },
    { href: "/admin/review", label: "admin.review", need: "product.review" },
    /* The pictures beside the subcategories on the Categories page, drawn here. */
    { href: "/admin/subcategory-pictures", label: "subpics.title", need: "content.manage" },
    /* The seasons and occasions on the home page that NetLet curates by hand. */
    { href: "/admin/occasions", label: "occasions.title", need: "content.manage" },
  ] },
  /* What a seller opens the portal to do most days is pack what somebody
     bought, so this group comes straight after the shelf. */
  { label: "admin.navOrders", links: [
    { href: "/admin/orders", label: "admin.orders", need: "orders.view" },
    /* The delivery company's own board (2.2, 3.4.2). A courier clears
       `delivery.view` and nothing else, so this is the only link they see. */
    { href: "/admin/dispatch", label: "admin.dispatch", need: "delivery.view" },
    /* Stock NetLet holds (4.2): a manager sends it, NetLet runs the floor. */
    { href: "/admin/fulfilment", label: "fulfilment.title", need: ["fulfilment.send", "fulfilment.operate"] },
    { href: "/admin/returns", label: "admin.returns", need: "returns.handle" },
    /* Warranty claims (migration 0072): the store answers, NetLet answers any. */
    { href: "/admin/warranty", label: "warranty.deskTitle", need: "returns.handle" },
    { href: "/admin/claims", label: "admin.claims", need: ["delivery.view", "delivery.fileClaim"] },
    { href: "/admin/couriers", label: "admin.couriers", need: "delivery.assign" },
  ] },
  { label: "admin.navCustomers", links: [
    { href: "/admin/offers", label: "admin.offers", need: "offer.answer" },
    /* NetLet's own inbox (3.5.1). */
    { href: "/admin/support", label: "support.inboxTitle", need: "support.answer" },
    /* NetLet's how-to guides (3.5.3): what a shopper or seller reads before asking. */
    { href: "/admin/guides", label: "guides.adminTitle", need: "content.manage" },
    { href: "/admin/membership", label: "membership.title", need: "membership.manage" },
  ] },
  { label: "admin.navMoney", links: [
    { href: "/admin/finance", label: "admin.finance", need: "finance.view" },
    /* A store's manager reaches this one too: when their money comes is theirs to know. */
    { href: "/admin/payouts", label: "admin.payoutsPage", need: "payouts.view" },
    { href: "/admin/invoices", label: "admin.invoices", need: "finance.view" },
    /* A store's owner or manager makes its own product codes here (0074). */
    { href: "/admin/promotions", label: "admin.promotions", need: ["promotion.netlet", "promotion.manage"] },
    /* A store's owner books here; an administrator sees every store's bookings. */
    { href: "/admin/ads", label: "admin.ads", need: "ads.book" },
    /* The home page's first products, asked for, reviewed and paid for. */
    { href: "/admin/sponsored", label: "admin.sponsored", need: "ads.book" },
    { href: "/admin/affiliates", label: "admin.affiliates", need: "affiliate.manage" },
    /* Stores' rates and their proposals (3.3.2, 3.3.9): an administrator's, or
       an employee's granted exactly that and nothing else. */
    { href: "/admin/commission", label: "commission.deskTitle", need: "vendor.setCommission" },
  ] },
  { label: "admin.navPlatform", links: [
    { href: "/admin/team", label: "admin.team", need: "vendor.viewMembers", storeOnly: true },
    /* The store's own papers, for its owner; NetLet reads each store's on its page. */
    { href: "/admin/store-documents", label: "storeDocs.title", need: "vendor.editProfile", storeOnly: true },
    /* How the store's shoppers may pay, for its owner and managers (0093). */
    { href: "/admin/payment-methods", label: "storePay.title", need: "vendor.payments", storeOnly: true },
    { href: "/admin/vendors", label: "admin.vendors", need: "stores.view" },
    { href: "/admin/applications", label: "admin.applications", need: "stores.manage" },
    /* NetLet's own team: who opens which part of this panel, with which role. */
    { href: "/admin/staff", label: "team.title", need: "team.manage" },
    /* Every account, to put somebody in a store or make a full administrator. */
    { href: "/admin/people", label: "admin.people", need: "stores.manage" },
    /* Which devices may carry an administrator's rights: the owner's alone. */
    { href: "/admin/devices", label: "devices.title", need: "platform.devices" },
    { href: "/admin/audit", label: "admin.audit", need: "audit.view" },
    /* Reviews and referrals that do not look like a shopper's own (3.6.5); orders carry their own flags. */
    { href: "/admin/fraud", label: "fraud.title", need: "fraud.view" },
    { href: "/admin/subscriptions", label: "subscriptions.adminTitle", need: "platform.configure" },
    { href: "/admin/features", label: "admin.features", need: "platform.configure" },
  ] },
];
