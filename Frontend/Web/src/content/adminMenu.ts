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
import type { Capability } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";

export type AdminMenuLink = { href: string; label: MessageKey; need: Capability | Capability[] };
export type AdminMenuGroup = { label: MessageKey | null; links: AdminMenuLink[] };

export const ADMIN_MENU: AdminMenuGroup[] = [
  { label: null, links: [
    { href: "/admin", label: "admin.overview", need: "product.view" },
  ] },
  { label: "admin.navCatalogue", links: [
    { href: "/admin/products", label: "admin.products", need: "product.view" },
    { href: "/admin/stock", label: "admin.stock", need: "product.view" },
    { href: "/admin/import", label: "admin.import", need: "product.create" },
    { href: "/admin/bundles", label: "admin.bundles", need: "product.view" },
    { href: "/admin/review", label: "admin.review", need: "product.review" },
  ] },
  /* What a seller opens the portal to do most days is pack what somebody
     bought, so this group comes straight after the shelf. */
  { label: "admin.navOrders", links: [
    { href: "/admin/orders", label: "admin.orders", need: "product.view" },
    /* The delivery company's own board (2.2, 3.4.2). A courier clears
       `delivery.view` and nothing else, so this is the only link they see. */
    { href: "/admin/dispatch", label: "admin.dispatch", need: "delivery.view" },
    /* Stock NetLet holds (4.2): a manager sends it, NetLet runs the floor. */
    { href: "/admin/fulfilment", label: "fulfilment.title", need: ["fulfilment.send", "fulfilment.operate"] },
    { href: "/admin/returns", label: "admin.returns", need: "returns.handle" },
    { href: "/admin/claims", label: "admin.claims", need: ["delivery.view", "delivery.fileClaim"] },
    { href: "/admin/couriers", label: "admin.couriers", need: "delivery.assign" },
  ] },
  { label: "admin.navCustomers", links: [
    { href: "/admin/offers", label: "admin.offers", need: "offer.answer" },
    /* NetLet's own inbox (3.5.1). */
    { href: "/admin/support", label: "support.inboxTitle", need: "support.answer" },
    /* NetLet's how-to guides (3.5.3): what a shopper or seller reads before asking. */
    { href: "/admin/guides", label: "guides.adminTitle", need: "platform.configure" },
    { href: "/admin/membership", label: "membership.title", need: "membership.manage" },
  ] },
  { label: "admin.navMoney", links: [
    { href: "/admin/finance", label: "admin.finance", need: "platform.viewAll" },
    /* A store's manager reaches this one too: when their money comes is theirs to know. */
    { href: "/admin/payouts", label: "admin.payoutsPage", need: "payouts.view" },
    { href: "/admin/invoices", label: "admin.invoices", need: "platform.viewAll" },
    { href: "/admin/promotions", label: "admin.promotions", need: "platform.viewAll" },
    /* A store's owner books here; an administrator sees every store's bookings. */
    { href: "/admin/ads", label: "admin.ads", need: "ads.book" },
    { href: "/admin/affiliates", label: "admin.affiliates", need: "affiliate.manage" },
  ] },
  { label: "admin.navPlatform", links: [
    { href: "/admin/team", label: "admin.team", need: "vendor.viewMembers" },
    { href: "/admin/vendors", label: "admin.vendors", need: "platform.viewAll" },
    { href: "/admin/applications", label: "admin.applications", need: "platform.manageUsers" },
    { href: "/admin/people", label: "admin.people", need: "platform.manageUsers" },
    { href: "/admin/audit", label: "admin.audit", need: "platform.viewAll" },
    { href: "/admin/subscriptions", label: "subscriptions.adminTitle", need: "platform.configure" },
    { href: "/admin/features", label: "admin.features", need: "platform.configure" },
  ] },
];
