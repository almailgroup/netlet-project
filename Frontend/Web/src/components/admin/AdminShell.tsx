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
import { ADMIN_MENU } from "@/content/adminMenu";
import { ArrowLeft, LogOut, BadgeCheck, BookOpen, Boxes, Building2, ClipboardCheck, ClipboardList, Coins, FileText, Gauge, Images, Handshake, Landmark, LayoutGrid, LifeBuoy, Megaphone, Menu, MonitorSmartphone, PackageSearch, Percent, Receipt, Repeat, RotateCcw, ScanEye, ScrollText, ShieldAlert, ShieldCheck, Sparkles, Store, Ticket, ToggleRight, Truck, Upload, Users, Warehouse } from "lucide-react";
import { isActiveHref, JumpButton, MenuDrawer, PageJump, Sidebar, useJumpShortcut, useRail, type FrameGroup } from "@/components/admin/frame";
import { CopilotPanel } from "@/components/admin/CopilotPanel";
import { usePageEntrance } from "@/hooks/usePageEntrance";
import { createContext, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PORTAL_SIDE, portalHref } from "@/lib/portalHost";
import { portalSideFor, type PortalSide } from "@shared/portal";
import { DeviceGate } from "@/components/admin/DeviceGate";

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

/** Each menu link's icon, by the page it opens. */
const MENU_ICONS: Record<string, ReactNode> = {
  "/admin": <Gauge className="size-4" />,
  "/admin/products": <LayoutGrid className="size-4" />,
  "/admin/stock": <PackageSearch className="size-4" />,
  "/admin/import": <Upload className="size-4" />,
  "/admin/bundles": <Boxes className="size-4" />,
  "/admin/review": <ClipboardCheck className="size-4" />,
  "/admin/subcategory-pictures": <Images className="size-4" />,
  "/admin/orders": <Receipt className="size-4" />,
  "/admin/dispatch": <Truck className="size-4" />,
  "/admin/fulfilment": <Warehouse className="size-4" />,
  "/admin/returns": <RotateCcw className="size-4" />,
  "/admin/warranty": <ShieldCheck className="size-4" />,
  "/admin/claims": <ShieldAlert className="size-4" />,
  "/admin/couriers": <Building2 className="size-4" />,
  "/admin/offers": <Handshake className="size-4" />,
  "/admin/support": <LifeBuoy className="size-4" />,
  "/admin/guides": <BookOpen className="size-4" />,
  "/admin/membership": <BadgeCheck className="size-4" />,
  "/admin/finance": <Coins className="size-4" />,
  "/admin/payouts": <Landmark className="size-4" />,
  "/admin/invoices": <FileText className="size-4" />,
  "/admin/promotions": <Ticket className="size-4" />,
  "/admin/ads": <Sparkles className="size-4" />,
  "/admin/affiliates": <Megaphone className="size-4" />,
  "/admin/commission": <Percent className="size-4" />,
  "/admin/team": <Users className="size-4" />,
  "/admin/vendors": <Store className="size-4" />,
  "/admin/applications": <ClipboardList className="size-4" />,
  "/admin/people": <ShieldCheck className="size-4" />,
  "/admin/devices": <MonitorSmartphone className="size-4" />,
  "/admin/audit": <ScrollText className="size-4" />,
  "/admin/fraud": <ScanEye className="size-4" />,
  "/admin/subscriptions": <Repeat className="size-4" />,
  "/admin/features": <ToggleRight className="size-4" />,
};

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

/** How long the frame's own answers — the device, who is asking — count as fresh. */
export const FRAME_FRESH_MS = 60_000;

/** The frame, mounted once round every `/admin` page (see `App`). */
export function AdminLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const enter = usePageEntrance(location);
  const [menuOpen, setMenuOpen] = useState(false);
  /* The frame outlives the page now, so a phone's open menu closes on any
     move, not only on a press inside it. */
  useEffect(() => setMenuOpen(false), [location]);
  /* The wide menu folded to its icons, the page jump and the co-pilot. Asked
     here, above every early return, so the frame's hooks never change in
     number between renders. */
  const [folded, setFolded] = useRail();
  const [jumpOpen, setJumpOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const copilotButton = useRef<HTMLButtonElement>(null);
  const framed = useRef(false);
  useJumpShortcut(() => {
    if (framed.current) setJumpOpen(true);
  });
  const { isAuthenticated, loading: authLoading, user, logout } = useAuth();
  const search = useSearch();
  /* On a portal's own address the portal keeps its own sign-in, so it has
     its own way out, asked first like the shop's. */
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  /*
   * The demo build is a signed-out guest everywhere — there is no server to
   * sign in to. The admin portal is the one page where that would show nothing
   * at all, so it opens against fixtures instead. This is the only place the
   * storefront's guest rule is bent, and only when there is no backend.
   */
  const reachable = DEMO_MODE || isAuthenticated;
  /* Whether this device may carry this account's rights (`Shared/auth/adminDevice.ts`):
     asked before anything of the portal is drawn, and again every five
     seconds while it waits, so the page opens by itself once the owner says yes. */
  const device = trpc.devices.access.useQuery(undefined, {
    enabled: !DEMO_MODE && isAuthenticated,
    /* Asked again only once a minute old (or every five seconds while it
       waits): with no freshness every page that mounted a reader of it asked
       the server again, beside the page's own reads. The server checks the
       device on every request regardless. */
    staleTime: FRAME_FRESH_MS,
    refetchInterval: query => (query.state.data?.signedIn && query.state.data.applies && query.state.data.access === "pending" ? 5000 : false),
  });
  /* An answer kept from before a sign-in or a sign-out is about somebody
     else: asked again, and nothing drawn from it meanwhile. Freshness alone
     would have drawn the signed-out answer for a minute after signing in,
     which is the waiting screen not appearing for a device that has just
     asked. */
  const deviceOutOfDate = !DEMO_MODE && Boolean(device.data) && device.data!.signedIn !== isAuthenticated;
  useEffect(() => {
    if (deviceOutOfDate) void device.refetch();
  }, [deviceOutOfDate]);
  const held = !deviceOutOfDate && device.data?.signedIn && device.data.applies && device.data.access !== "trusted" ? device.data : null;
  /* The moment the owner approves, everything this account was refused is its to read. */
  const wasHeld = useRef(false);
  const utils = trpc.useUtils();
  useEffect(() => {
    if (held) wasHeld.current = true;
    else if (wasHeld.current && device.data?.signedIn) {
      wasHeld.current = false;
      void utils.invalidate();
    }
  }, [held, device.data, utils]);
  /* Asked beside the device's answer, not after it (and both are asked as the
     app starts, `routeData`): one round trip before the page where there were
     three. Held, its answer is a shopper's, and nothing of it is drawn. */
  const me = trpc.inventory.me.useQuery(undefined, { enabled: reachable && !held, staleTime: FRAME_FRESH_MS });
  /* The same for who is asking: an answer for another account is asked again. */
  const meOutOfDate = !DEMO_MODE && Boolean(me.data && user && me.data.userId !== user.id);
  useEffect(() => {
    if (meOutOfDate) void me.refetch();
  }, [meOutOfDate]);

  if ((!DEMO_MODE && authLoading) || (!DEMO_MODE && isAuthenticated && (device.isLoading || deviceOutOfDate || meOutOfDate))) {
    return <Frame><p role="status" className="text-[14px] ink-muted">{t("admin.loading")}</p></Frame>;
  }

  if (held) return <Frame><DeviceGate state={held} /></Frame>;

  if (reachable && me.isLoading) {
    // Announced rather than only drawn: somebody on a screen reader arriving
    // mid-load otherwise lands on a page that says nothing at all.
    return <Frame><p role="status" className="text-[14px] ink-muted">{t("admin.loading")}</p></Frame>;
  }

  if (!reachable) {
    /* Straight to the sign-in page of the address this is — on a portal's
       own, that portal's sign-in — coming back to this page: a page saying
       "sign in first" over a button was one more press for everybody. */
    const here = `${location}${search ? `?${search}` : ""}`;
    return <Redirect to={`/signin?next=${encodeURIComponent(here)}`} replace />;
  }

  const actor = me.data;
  // A signed-in shopper reaching /admin is not an error — it is somebody
  // who has not been added to a vendor yet, and telling them who to ask is
  // more use than a 403.
  /* An employee holding a grant (3.3.9) and nothing else is let in to the one
     desk the grant opens; any other shopper is not. */
  if (!actor || (actor.kind === "customer" && !actor.grants?.length)) {
    return (
      <Frame>
        <h1 className="text-[22px] leading-8 font-extrabold text-[#0a285a]">{t("admin.noAccess")}</h1>
        <p className="mt-2 max-w-md text-[14px] leading-6 text-[#536b8c]">{t("admin.noAccessNote")}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {/* On a portal's own address this account is signed in to the
              portal alone, so another account is one press away. */}
          {PORTAL_SIDE ? (
            <button type="button" onClick={() => void logout()} className={buttonClass.primary}>
              {t("admin.otherAccount")}
            </button>
          ) : null}
          <Link href="/" className={buttonClass.secondary}>
            <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.backToStore")}
          </Link>
        </div>
      </Frame>
    );
  }


  /* Each portal has its own address (`PORTAL_DOMAIN`): somebody who belongs
     on the other one is sent there, on the same page. */
  const belongs = portalSideFor(actor);
  if (PORTAL_SIDE && belongs && belongs !== PORTAL_SIDE) {
    return <Frame><MoveToPortal side={belongs} address={`${location}${search ? `?${search}` : ""}`} /></Frame>;
  }

  /* The menu is `ADMIN_MENU` (`content/adminMenu.ts`), which the iOS app
     reads too; this frame adds each link's icon. */
  const groups: FrameGroup[] = ADMIN_MENU
    .map(group => ({ label: group.label, links: group.links.filter(link => canAny(actor, link.need)).map(link => ({ href: link.href, label: link.label, icon: MENU_ICONS[link.href] })) }))
    .filter(group => group.links.length > 0);

  /* Somebody whose only way in is a grant has no overview of a store to see:
     the portal's front door takes them to the first page they can use. */
  const first = groups.flatMap(group => group.links)[0];
  if (location === "/admin" && !can(actor, "product.view") && first && first.href !== "/admin") {
    return <Redirect to={first.href} replace />;
  }
  framed.current = true;

  const links = groups.flatMap(group => group.links);
  const current = links.find(link => isActiveHref(location, link.href));
  const pageLabel = (href: string) => {
    const link = links.find(entry => entry.href === href);
    return link ? t(link.label) : href;
  };
  /* The co-pilot reads what the shelf and the money pages read, so it is for
     an administrator and a store's people — not a delivery company's, nor an
     employee let in by one grant. */
  const copilot = actor.kind === "admin" || (actor.kind === "vendor" && can(actor, "product.view", actor.vendorId));
  const who = user?.name || user?.email || "";

  return (
    <ActorContext.Provider value={actor}>
    <div className="portal min-h-screen bg-[#f4f6fb] text-[#0a285a] lg:flex">
      <a
        href="#admin-main"
        className="glass glass-navy sr-only rounded-full px-4 py-2 text-xs font-extrabold focus:not-sr-only focus:fixed focus:start-4 focus:top-3 focus:z-[60]"
      >
        {t("nav.skipToContent")}
      </a>
      <Sidebar groups={groups} folded={folded} onFold={setFolded} />
      <MenuDrawer groups={groups} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <PageJump groups={groups} open={jumpOpen} onClose={() => setJumpOpen(false)} />

      <div className={`portal-column min-w-0 flex-1 ${copilotOpen ? "lg:pe-[400px]" : ""}`}>
        <header className="sticky top-0 z-30 border-b border-[#e3e8f0] bg-white">
          <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-label={t("shell.openMenu")}
              className="grid size-10 shrink-0 place-items-center rounded-xl text-[#0a285a] hover:bg-[#0a285a]/[.06] lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </button>
            {/* The page a phone is on, beside the menu that would change it. */}
            <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-[#0a285a] sm:hidden">{current ? t(current.label) : t("admin.title")}</p>
            <JumpButton onOpen={() => setJumpOpen(true)} />
            <div className="ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              {copilot ? (
                <button
                  ref={copilotButton}
                  type="button"
                  onClick={() => setCopilotOpen(open => !open)}
                  aria-expanded={copilotOpen}
                  aria-label={t("shell.copilot")}
                  className={`copilot-button inline-flex h-10 items-center gap-2 rounded-xl px-3 text-[14px] font-semibold ${copilotOpen ? "bg-[#0a285a] text-white" : "bg-[#eef0fd] text-[#3730a3] tint-on-hover"}`}
                >
                  <Sparkles className={`size-4 ${copilotOpen ? "text-[#ffab85]" : ""}`} aria-hidden />
                  <span className="hidden sm:inline">{t("shell.copilot")}</span>
                </button>
              ) : null}
              {/* The label hides below `md`; the `aria-label` is the same
                  string, so WCAG 2.5.3 holds when it is visible and there is
                  still a name when it is not. */}
              <Link href="/" aria-label={t("admin.backToStore")} title={t("admin.backToStore")} className="grid h-10 shrink-0 place-items-center rounded-xl px-2.5 text-[13px] font-semibold text-[#536b8c] hover:bg-[#0a285a]/[.06] hover:text-[#0a285a] md:flex md:gap-1.5">
                <Store className="size-[18px]" aria-hidden />
                <span className="hidden xl:inline">{t("admin.backToStore")}</span>
              </Link>
              <span aria-hidden className="hidden h-7 w-px bg-[#e3e8f0] md:block" />
              <div className="hidden items-center gap-2.5 md:flex">
                <span aria-hidden className="grid size-9 place-items-center rounded-full bg-[#0a285a] text-[13px] font-bold text-white">{initialsOf(who)}</span>
                <span className="min-w-0 leading-tight">
                  <span className="block max-w-40 truncate text-[13px] font-semibold text-[#0a285a]">{who ? <bdi>{who}</bdi> : t("shell.account")}</span>
                  <span className="block text-[12px] ink-muted">{t(roleLabelKey(actor))}</span>
                </span>
              </div>
              {PORTAL_SIDE ? (
                <button
                  type="button"
                  onClick={() => setSignOutOpen(true)}
                  aria-label={t("header.signOut")}
                  title={t("header.signOut")}
                  className="grid size-10 shrink-0 place-items-center rounded-xl text-[#536b8c] hover:bg-[#0a285a]/[.06] hover:text-[#0a285a]"
                >
                  <LogOut className="size-[18px] rtl:-scale-x-100" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        </header>
        {PORTAL_SIDE ? (
          <ConfirmDialog
            open={signOutOpen}
            tone="danger"
            icon={<LogOut className="size-5" />}
            title={t("account.signOutTitle")}
            body={t("account.signOutBody")}
            confirmLabel={t("header.signOut")}
            pending={signingOut}
            onClose={() => setSignOutOpen(false)}
            onConfirm={async () => {
              setSigningOut(true);
              try {
                await logout();
                toast.success(t("header.signedOut"));
                setSignOutOpen(false);
              } finally {
                setSigningOut(false);
              }
            }}
          />
        ) : null}

        {/* Any word that cannot fit breaks rather than pushing the page
            sideways: names, emails and links here are typed by merchants and
            shoppers, and one long enough held a phone layout 55px open.
            Only this part waits while a page's code arrives; the bar and the
            menu stay where they are. */}
        <main id="admin-main" tabIndex={-1} className="mx-auto w-full max-w-[1440px] min-w-0 px-4 py-6 outline-none [overflow-wrap:anywhere] sm:px-6 lg:px-8 lg:py-8">
          <Suspense fallback={<SkeletonCards count={3} label={t("admin.loading")} />}>
            <div key={location} className={enter}>{children}</div>
          </Suspense>
        </main>
      </div>
      {copilot ? (
        <CopilotPanel open={copilotOpen} onClose={() => setCopilotOpen(false)} opener={copilotButton} pageLabel={pageLabel} />
      ) : null}
    </div>
    </ActorContext.Provider>
  );
}

/** Up to two letters for the bar's avatar, from a name or an address. */
function initialsOf(name: string): string {
  const words = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? "").slice(0, 2)).toUpperCase() || "N";
}

/** Sends this tab to the portal its person belongs on, on the same page. */
/**
 * Somebody on the other portal's address: sent to their own, on the same page,
 * and signed in there by a one-time pass (`portalPass`) — each address keeps
 * its own sign-in, and asking for it twice in a row is the seam showing.
 * Without a pass (the server has no portal to hand on to) the address alone.
 */
function MoveToPortal({ side, address }: { side: PortalSide; address: string }) {
  const { t } = useTranslation();
  const pass = trpc.auth.portalPass.useMutation();
  const ask = pass.mutateAsync;
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    ask({ next: address })
      .then(answer => window.location.replace(answer?.url ?? portalHref(side, address)))
      .catch(() => window.location.replace(portalHref(side, address)));
  }, [ask, side, address]);
  return <p role="status" className="text-[14px] ink-muted">{t("admin.loading")}</p>;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div>{children}</div>
    </main>
  );
}
