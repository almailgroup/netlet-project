/**
 * The admin portal frame: who you are, and what that lets you reach.
 *
 * **Drawn once, and kept while the page inside it changes.** `AdminLayout` is
 * the frame — the bar, the grouped menu, the one `<main>` — and `App` mounts it
 * once round every `/admin` route. Every page used to wrap itself in a frame
 * of its own, so each press in the menu threw the bar and the menu away and
 * built them again: the menu lost its scroll on every move, a phone's open
 * menu snapped shut, and while the next page's code arrived the whole screen
 * gave way to a grey outline. `AdminShell` is what a page still wraps itself
 * in, and it is only the page's own gate now: whether *this* page is yours,
 * and the actor to draw it for.
 *
 * There is one admin portal, not an admin one beside a vendor one. The pages are
 * the same pages; what differs is scope, and scope is already decided by the
 * server — `products.list` returns one vendor's rows or every vendor's
 * depending on who asks. Building two shells would mean maintaining two
 * navigations that show the same links.
 *
 * Which links appear comes from `can()`, the same pure function the server
 * guards with. A hidden link is a courtesy, never a control: the server
 * refuses regardless, so the two cannot drift into a button that 403s.
 */
import { buttonClass, PageHeader, SkeletonCards } from "@/components/admin/ui";
import { useAuth } from "@/hooks/useAuth";
import { DEMO_MODE } from "@/lib/demoMode";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { can, type Actor, type Capability } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";
import { logoImage } from "@/lib/brandAssets";
import { ArrowLeft, BadgeCheck, BookOpen, ChevronDown, Menu, Boxes, Building2, ClipboardCheck, ClipboardList, Coins, FileText, Gauge, Handshake, Landmark, LayoutGrid, LifeBuoy, Megaphone, MessagesSquare, Repeat, Sparkles, PackageSearch, Receipt, RotateCcw, ScrollText, ShieldAlert, ShieldCheck, Store, Ticket, ToggleRight, Truck, Upload, Users, Warehouse } from "lucide-react";
import { usePageEntrance } from "@/hooks/usePageEntrance";
import { createContext, Suspense, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";

const ROLE_LABEL: Record<string, MessageKey> = {
  admin: "admin.roleAdmin",
  owner: "admin.roleOwner",
  manager: "admin.roleManager",
  staff: "admin.roleStaff",
};

/**
 * What this person is, in the header.
 *
 * A delivery company has no rank — its people all do the same job — so it is
 * answered by *kind* rather than falling through to the `staff` default, which
 * was calling a driver a store's staff member. The fallback stays for a vendor
 * membership with a rank this build does not know, where "staff" is the least
 * it could be.
 */
export function roleLabelKey(actor: Actor): MessageKey {
  if (actor.kind === "admin") return "admin.roleAdmin";
  if (actor.kind === "courier") return "admin.roleCourier";
  return ROLE_LABEL[(actor as { role?: string }).role ?? "staff"];
}

function canAny(actor: Actor, need: Capability | Capability[], vendorId?: number): boolean {
  return (Array.isArray(need) ? need : [need]).some(one => can(actor, one, vendorId));
}

/* Who is signed in to the portal, settled once by the frame for every page. */
const ActorContext = createContext<Actor | null>(null);

export function AdminShell({ need, children }: {
  /**
   * What this page requires. Hiding a nav link is a courtesy; a route typed
   * into the address bar arrives anyway, and rendering an empty page there
   * implies the page exists and has nothing in it — when the truth is that it
   * is not yours to see. The server refuses the data either way.
   *
   * A list means any of them: the damage-claims page is one page for the
   * seller who files, the company that answers and NetLet that decides, and
   * no single capability is shared by all three.
   */
  need?: Capability | Capability[];
  children: (actor: Actor) => ReactNode;
}) {
  const { t } = useTranslation();
  const actor = useContext(ActorContext);
  /* Never drawn outside the frame, which settles the actor before any page. */
  if (!actor) return null;
  if (need && !canAny(actor, need, actor.kind === "vendor" ? actor.vendorId : undefined)) {
    return (
      <>
        <PageHeader title={t("admin.forbidden")} />
        <Link href="/admin" className={buttonClass.secondary}>
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.overview")}
        </Link>
      </>
    );
  }
  return <>{children(actor)}</>;
}

/** An address under `/admin` that answers to no page — inside the frame, with the way back. */
export function AdminNotFound() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("notFound.title")} />
      <Link href="/admin" className={buttonClass.secondary}>
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.overview")}
      </Link>
    </>
  );
}

/** The frame, mounted once round every `/admin` page (see `App`). */
export function AdminLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const enter = usePageEntrance(location);
  const [menuOpen, setMenuOpen] = useState(false);
  /* The frame outlives the page now, so a phone's open menu closes on any
     move, not only on a press inside it. */
  useEffect(() => setMenuOpen(false), [location]);
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  /*
   * The demo build is a signed-out guest everywhere — there is no server to
   * sign in to. The admin portal is the one page where that would show nothing
   * at all, so it opens against fixtures instead. This is the only place the
   * storefront's guest rule is bent, and only when there is no backend.
   */
  const reachable = DEMO_MODE || isAuthenticated;
  const me = trpc.inventory.me.useQuery(undefined, { enabled: reachable });

  if ((!DEMO_MODE && authLoading) || (reachable && me.isLoading)) {
    // Announced rather than only drawn: somebody on a screen reader arriving
    // mid-load otherwise lands on a page that says nothing at all.
    return <Frame><p role="status" className="text-[14px] ink-muted">{t("admin.loading")}</p></Frame>;
  }

  if (!reachable) {
    return (
      <Frame>
        <h1 className="text-[22px] leading-8 font-extrabold text-[#0a285a]">{t("admin.signInFirst")}</h1>
        <Link href="/account" className={`${buttonClass.primary} mt-5`}>
          {t("header.signIn")}
        </Link>
      </Frame>
    );
  }

  const actor = me.data;
  // A signed-in shopper reaching /admin is not an error — it is somebody
  // who has not been added to a vendor yet, and telling them who to ask is
  // more use than a 403.
  if (!actor || actor.kind === "customer") {
    return (
      <Frame>
        <h1 className="text-[22px] leading-8 font-extrabold text-[#0a285a]">{t("admin.noAccess")}</h1>
        <p className="mt-2 max-w-md text-[14px] leading-6 text-[#536b8c]">{t("admin.noAccessNote")}</p>
        <Link href="/" className={`${buttonClass.secondary} mt-5`}>
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.backToStore")}
        </Link>
      </Frame>
    );
  }


  /*
   * Grouped, because the flat list had grown to twenty-eight links in one
   * column — the order a feature was built in, not the order anybody works.
   * Each group is what one kind of task reaches for, and a group a person
   * cannot use any of disappears with its heading.
   */
  const groups = ([
    { label: null, links: [
      { href: "/admin", label: "admin.overview", icon: <Gauge className="size-4" />, need: "product.view" },
    ] },
    { label: "admin.navCatalogue", links: [
      { href: "/admin/products", label: "admin.products", icon: <LayoutGrid className="size-4" />, need: "product.view" },
      { href: "/admin/stock", label: "admin.stock", icon: <PackageSearch className="size-4" />, need: "product.view" },
      { href: "/admin/import", label: "admin.import", icon: <Upload className="size-4" />, need: "product.create" },
      { href: "/admin/bundles", label: "admin.bundles", icon: <Boxes className="size-4" />, need: "product.view" },
      { href: "/admin/review", label: "admin.review", icon: <ClipboardCheck className="size-4" />, need: "product.review" },
    ] },
    /* What a seller opens the portal to do most days is pack what somebody
       bought, so this group comes straight after the shelf. */
    { label: "admin.navOrders", links: [
      { href: "/admin/orders", label: "admin.orders", icon: <Receipt className="size-4" />, need: "product.view" },
      /* The delivery company's own board (2.2, 3.4.2). A courier clears
         `delivery.view` and nothing else, so this is the only link they see. */
      { href: "/admin/dispatch", label: "admin.dispatch", icon: <Truck className="size-4" />, need: "delivery.view" },
      /* Stock NetLet holds (4.2): a manager sends it, NetLet runs the floor. */
      { href: "/admin/fulfilment", label: "fulfilment.title", icon: <Warehouse className="size-4" />, need: ["fulfilment.send", "fulfilment.operate"] },
      { href: "/admin/returns", label: "admin.returns", icon: <RotateCcw className="size-4" />, need: "returns.handle" },
      { href: "/admin/claims", label: "admin.claims", icon: <ShieldAlert className="size-4" />, need: ["delivery.view", "delivery.fileClaim"] },
      { href: "/admin/couriers", label: "admin.couriers", icon: <Building2 className="size-4" />, need: "delivery.assign" },
    ] },
    { label: "admin.navCustomers", links: [
      { href: "/admin/offers", label: "admin.offers", icon: <Handshake className="size-4" />, need: "offer.answer" },
      { href: "/admin/messages", label: "admin.messages", icon: <MessagesSquare className="size-4" />, need: "chat.answer" },
      /* NetLet's own inbox (3.5.1); a seller's conversations are the line above. */
      { href: "/admin/support", label: "support.inboxTitle", icon: <LifeBuoy className="size-4" />, need: "support.answer" },
      /* NetLet's how-to guides (3.5.3): what a shopper or seller reads before asking. */
      { href: "/admin/guides", label: "guides.adminTitle", icon: <BookOpen className="size-4" />, need: "platform.configure" },
      { href: "/admin/membership", label: "membership.title", icon: <BadgeCheck className="size-4" />, need: "membership.manage" },
    ] },
    { label: "admin.navMoney", links: [
      { href: "/admin/finance", label: "admin.finance", icon: <Coins className="size-4" />, need: "platform.viewAll" },
      /* A store's manager reaches this one too: when their money comes is theirs to know. */
      { href: "/admin/payouts", label: "admin.payoutsPage", icon: <Landmark className="size-4" />, need: "payouts.view" },
      { href: "/admin/invoices", label: "admin.invoices", icon: <FileText className="size-4" />, need: "platform.viewAll" },
      { href: "/admin/promotions", label: "admin.promotions", icon: <Ticket className="size-4" />, need: "platform.viewAll" },
      /* A store's owner books here; an administrator sees every store's bookings. */
      { href: "/admin/ads", label: "admin.ads", icon: <Sparkles className="size-4" />, need: "ads.book" },
      { href: "/admin/affiliates", label: "admin.affiliates", icon: <Megaphone className="size-4" />, need: "affiliate.manage" },
    ] },
    { label: "admin.navPlatform", links: [
      { href: "/admin/team", label: "admin.team", icon: <Users className="size-4" />, need: "vendor.viewMembers" },
      { href: "/admin/vendors", label: "admin.vendors", icon: <Store className="size-4" />, need: "platform.viewAll" },
      { href: "/admin/applications", label: "admin.applications", icon: <ClipboardList className="size-4" />, need: "platform.manageUsers" },
      { href: "/admin/people", label: "admin.people", icon: <ShieldCheck className="size-4" />, need: "platform.manageUsers" },
      { href: "/admin/audit", label: "admin.audit", icon: <ScrollText className="size-4" />, need: "platform.viewAll" },
      { href: "/admin/subscriptions", label: "subscriptions.adminTitle", icon: <Repeat className="size-4" />, need: "platform.configure" },
      { href: "/admin/features", label: "admin.features", icon: <ToggleRight className="size-4" />, need: "platform.configure" },
    ] },
  ] satisfies { label: MessageKey | null; links: { href: string; label: MessageKey; icon: ReactNode; need: Capability | Capability[] }[] }[])
    .map(group => ({ ...group, links: group.links.filter(link => canAny(actor, link.need)) }))
    .filter(group => group.links.length > 0);

  /* A product's own page is still Products: the link stays marked on every
     page under it, which the exact match used to drop the moment a row was
     opened. Overview is the one that must match exactly, or it would be
     marked everywhere. */
  const isActive = (href: string) => location === href || (href !== "/admin" && location.startsWith(`${href}/`));
  const current = groups.flatMap(group => group.links).find(link => isActive(link.href));

  const navList = (
    <div className="space-y-5">
      {groups.map(group => (
        <div key={group.label ?? "top"}>
          {group.label ? <p className="mb-1.5 px-3 text-[12px] font-semibold ink-muted">{t(group.label)}</p> : null}
          <ul className="space-y-0.5">
            {group.links.map(link => {
              const active = isActive(link.href);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] font-semibold transition ${active ? "bg-[#0a285a] text-white" : "text-[#3d5376] hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]"}`}
                  >
                    <span aria-hidden className="shrink-0">{link.icon}</span>{t(link.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );

  return (
    <ActorContext.Provider value={actor}>
    <div className="min-h-screen bg-background text-[#0a285a]">
      <a
        href="#admin-main"
        className="glass glass-navy sr-only rounded-full px-4 py-2 text-xs font-extrabold focus:not-sr-only focus:fixed focus:start-4 focus:top-3 focus:z-50"
      >
        {t("nav.skipToContent")}
      </a>
      <header className="sticky top-0 z-40 border-b border-[#e1e7ef] bg-white">
        <div className="container flex h-16 items-center gap-3 sm:gap-4">
          <Link href="/admin" className="flex shrink-0 items-center gap-2.5" aria-label={t("admin.overview")}>
            <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-7 w-auto object-contain" />
          </Link>
          <span aria-hidden className="hidden h-6 w-px bg-[#e1e7ef] sm:block" />
          {/* The label hides below `sm`, leaving an arrow with no accessible
              name at all — on every admin page, on a phone. The `aria-label`
              is the same string the span shows, so WCAG 2.5.3 holds when it
              is visible and there is still a name when it is not. */}
          <Link href="/" aria-label={t("admin.backToStore")} className="flex items-center gap-1.5 text-[13px] font-semibold text-[#536b8c] hover:text-[#0a285a]">
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            <span className="hidden sm:inline">{t("admin.backToStore")}</span>
          </Link>
          <span className="ms-auto hidden truncate text-[13px] text-[#536b8c] md:inline">
            {user?.name || user?.email ? t("admin.signedInAs", { name: user?.name ?? user?.email ?? "" }) : null}
          </span>
          <span className="ms-auto shrink-0 rounded-full bg-[#e7edf5] px-2.5 py-1 text-[12px] font-semibold text-[#0a285a] md:ms-0">
            {t(roleLabelKey(actor))}
          </span>
        </div>
      </header>

      <div className="container grid gap-6 py-6 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-8 lg:py-8">
        <nav aria-label={t("admin.title")} className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pb-6">
          {/* Below `lg` the menu folds into one button naming where you are:
              twenty-eight links in a sideways strip was a list nobody could
              see the end of. */}
          <button
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            aria-expanded={menuOpen}
            aria-controls="admin-menu"
            className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-[#cfd9e6] bg-white px-4 text-[14px] font-semibold hover:bg-[#f0f2f5] lg:hidden"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Menu className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{current ? t(current.label) : t("admin.menu")}</span>
            </span>
            <ChevronDown className={`size-4 shrink-0 transition ${menuOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
          <div id="admin-menu" className={`${menuOpen ? "mt-2 block rounded-xl border border-[#e1e7ef] bg-white p-2" : "hidden"} lg:mt-0 lg:block lg:border-0 lg:bg-transparent lg:p-0`}>
            {navList}
          </div>
        </nav>
        {/* Any word that cannot fit breaks rather than pushing the page
            sideways: names, emails and links here are typed by merchants and
            shoppers, and one long enough held a phone layout 55px open.
            Only this part waits while a page's code arrives; the bar and the
            menu stay where they are. */}
        <main id="admin-main" tabIndex={-1} className="min-w-0 outline-none [overflow-wrap:anywhere]">
          <Suspense fallback={<SkeletonCards count={3} label={t("admin.loading")} />}>
            <div key={location} className={enter}>{children}</div>
          </Suspense>
        </main>
      </div>
    </div>
    </ActorContext.Provider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div>{children}</div>
    </main>
  );
}
