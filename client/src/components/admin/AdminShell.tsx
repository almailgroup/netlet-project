/**
 * The admin portal frame: who you are, and what that lets you reach.
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
import { useAuth } from "@/hooks/useAuth";
import { DEMO_MODE } from "@/lib/demoMode";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { can, type Actor, type Capability } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowLeft, ClipboardCheck, Coins, Gauge, Handshake, LayoutGrid, PackageSearch, Receipt, ScrollText, ShieldCheck, Store, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";

const ROLE_LABEL: Record<string, MessageKey> = {
  admin: "admin.roleAdmin",
  owner: "admin.roleOwner",
  manager: "admin.roleManager",
  staff: "admin.roleStaff",
};

export function roleLabelKey(actor: Actor): MessageKey {
  return actor.kind === "admin" ? "admin.roleAdmin" : ROLE_LABEL[(actor as { role?: string }).role ?? "staff"];
}

export function AdminShell({ need, children }: {
  /**
   * What this page requires. Hiding a nav link is a courtesy; a route typed
   * into the address bar arrives anyway, and rendering an empty page there
   * implies the page exists and has nothing in it — when the truth is that it
   * is not yours to see. The server refuses the data either way.
   */
  need?: Capability;
  children: (actor: Actor) => ReactNode;
}) {
  const { t } = useTranslation();
  const [location] = useLocation();
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
    return <Frame><p role="status" className="text-sm ink-muted">{t("admin.loading")}</p></Frame>;
  }

  if (!reachable) {
    return (
      <Frame>
        <h1 className="text-lg font-extrabold text-[#0a285a]">{t("admin.signInFirst")}</h1>
        <Link href="/account" className="glass glass-navy pressable mt-4 inline-flex rounded-full px-5 py-3 text-xs font-extrabold">
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
        <h1 className="text-lg font-extrabold text-[#0a285a]">{t("admin.noAccess")}</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-[#536b8c]">{t("admin.noAccessNote")}</p>
        <Link href="/" className="glass pressable mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-extrabold">
          <ArrowLeft className="size-4 rtl:-scale-x-100" />{t("admin.backToStore")}
        </Link>
      </Frame>
    );
  }

  if (need && !can(actor, need, actor.kind === "vendor" ? actor.vendorId : undefined)) {
    return (
      <Frame>
        <h1 className="text-lg font-extrabold text-[#0a285a]">{t("admin.forbidden")}</h1>
        <Link href="/admin" className="glass pressable mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-extrabold">
          <ArrowLeft className="size-4 rtl:-scale-x-100" />{t("admin.overview")}
        </Link>
      </Frame>
    );
  }

  const links = ([
    { href: "/admin", label: "admin.overview", icon: <Gauge className="size-4" />, need: "product.view" },
    { href: "/admin/products", label: "admin.products", icon: <LayoutGrid className="size-4" />, need: "product.view" },
    { href: "/admin/stock", label: "admin.stock", icon: <PackageSearch className="size-4" />, need: "product.view" },
    /* Above the review queue and below stock: what a seller opens the portal
       to do most days is pack what somebody bought. */
    { href: "/admin/orders", label: "admin.orders", icon: <Receipt className="size-4" />, need: "product.view" },
    { href: "/admin/review", label: "admin.review", icon: <ClipboardCheck className="size-4" />, need: "product.review" },
    { href: "/admin/offers", label: "admin.offers", icon: <Handshake className="size-4" />, need: "offer.answer" },
    { href: "/admin/vendors", label: "admin.vendors", icon: <Store className="size-4" />, need: "platform.viewAll" },
    { href: "/admin/people", label: "admin.people", icon: <ShieldCheck className="size-4" />, need: "platform.manageUsers" },
    { href: "/admin/finance", label: "admin.finance", icon: <Coins className="size-4" />, need: "platform.viewAll" },
    { href: "/admin/audit", label: "admin.audit", icon: <ScrollText className="size-4" />, need: "platform.viewAll" },
    { href: "/admin/team", label: "admin.team", icon: <Users className="size-4" />, need: "vendor.viewMembers" },
  ] satisfies { href: string; label: MessageKey; icon: ReactNode; need: Capability }[])
    .filter(link => can(actor, link.need));

  return (
    <main className="min-h-screen bg-background text-[#0a285a]">
      <header className="sticky top-0 z-40 border-b border-[#d5dfeb] bg-background/95 backdrop-blur-xl">
        <div className="container flex h-[64px] items-center gap-4">
          {/* The label hides below `sm`, leaving an arrow with no accessible
              name at all — on every admin page, on a phone. The `aria-label`
              is the same string the span shows, so WCAG 2.5.3 holds when it
              is visible and there is still a name when it is not. */}
          <Link href="/" aria-label={t("admin.backToStore")} className="flex items-center gap-2 text-sm font-extrabold">
            <ArrowLeft className="size-4 rtl:-scale-x-100" />
            <span className="hidden sm:inline">{t("admin.backToStore")}</span>
          </Link>
          <span className="ms-auto text-[11px] font-semibold text-[#536b8c]">
            {user?.name || user?.email ? t("admin.signedInAs", { name: user?.name ?? user?.email ?? "" }) : null}
          </span>
          <span className="rounded-full bg-[#e7edf5] px-2.5 py-1 text-[10px] font-extrabold text-[#0a285a]">
            {t(roleLabelKey(actor))}
          </span>
        </div>
      </header>

      <div className="container grid gap-6 py-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label={t("admin.title")} className="hide-scrollbar flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {links.map(link => {
            const active = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`pressable inline-flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px] font-bold ${active ? "glass glass-navy" : "text-[#536b8c] hover:bg-[#e7edf5]"}`}
              >
                {link.icon}{t(link.label)}
              </Link>
            );
          })}
        </nav>
        <section className="min-w-0">{children(actor)}</section>
      </div>
    </main>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div>{children}</div>
    </main>
  );
}
