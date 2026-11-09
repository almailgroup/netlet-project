/**
 * What the admin portal opens on.
 *
 * Counts, not lists. The first question on arriving is "is anything waiting
 * for me", and a number answers that faster than a table does — but every
 * number here is a link to the page that acts on it, because a count with
 * nowhere to go is decoration.
 *
 * The same page serves an admin and a vendor. The server decides scope, so a
 * vendor sees their own products and no platform-wide vendor counts at all.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, type Actor } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";
import type { HealthDetailKey } from "@shared/inventory/vendorHealth";
import { Notice, PageHeader, SectionHeading, Segmented, surfaceClass } from "@/components/admin/ui";
import { StoreWarnings } from "@/components/admin/StoreWarnings";
import { ActivityPanel, DepartmentsPanel, KpiRow, Panel, StockPanel, TopPanel, TrendPanel, useToday } from "@/components/admin/Dashboard";
import { readStored, writeStored } from "@/lib/browserStore";
import { DASHBOARD_RANGES, DEFAULT_DASHBOARD_RANGE, type DashboardRange } from "@shared/commerce/dashboard";
import { ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

const RANGE_KEY = "portal:range";

/** The period the dashboard was last read over on this device. */
function storedRange(): DashboardRange {
  const stored = Number(readStored(RANGE_KEY));
  return (DASHBOARD_RANGES as readonly number[]).includes(stored) ? (stored as DashboardRange) : DEFAULT_DASHBOARD_RANGE;
}

export default function AdminOverview() {
  usePageMeta(privatePageMeta("Overview"));
  return <AdminShell>{actor => <Overview actor={actor} />}</AdminShell>;
}

type Tile = { label: MessageKey; value: number; href: string; tone?: "urgent" | "quiet" };

function Overview({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  /*
   * A delivery company reaches no part of the catalog, so asking for the
   * inventory counts would be asking a question the server refuses — and
   * `QueryGate` would then show them a 403 as the first thing on the page. The
   * overview answers "is anything waiting for me" for whoever is asking, which
   * for a courier is parcels.
   */
  const isCourier = actor.kind === "courier";
  const counts = trpc.inventory.overview.useQuery(undefined, { enabled: !isCourier });
  const health = trpc.inventory.health.useQuery(undefined, { retry: false });
  /*
   * Asked before the early returns below, so the hook order never changes
   * between renders — `enabled` is what stops a staff member's browser asking
   * a question the server would refuse.
   */
  const vendorScope = actor.kind === "vendor" ? actor.vendorId : undefined;
  /* The dashboard is the money, so a rank that reads payouts gets it; one that
     reads only the shelf gets the shelf's card. */
  const mayMoney = !isCourier && can(actor, "payouts.view", vendorScope);
  const [range, setRange] = useState<DashboardRange>(storedRange);
  const board = trpc.inventory.dashboard.useQuery({ range }, { enabled: mayMoney, placeholderData: previous => previous, retry: false });
  const shelf = trpc.inventory.stockHealth.useQuery(undefined, { enabled: !isCourier && !mayMoney });
  const today = useToday();
  const waitingOffers = trpc.offers.waiting.useQuery(
    { vendorId: vendorScope },
    { enabled: can(actor, "offer.answer", vendorScope) },
  );
  /* Requirement 3.3.8: a seller's changes have always been logged, and a log
     nobody opens is not visibility. This is the count of what this
     administrator has not read. */
  const sellerChanges = trpc.inventory.sellerChanges.useQuery(
    { limit: 1 },
    { enabled: can(actor, "platform.viewAll") },
  );
  /* Somebody waiting to be let in is the most time-sensitive thing in the
     portal: a seller who applied and heard nothing goes and sells elsewhere. */
  const waitingApplications = trpc.inventory.applications.waiting.useQuery(undefined, {
    enabled: can(actor, "platform.manageUsers"),
  });
  /* Parcels waiting for a driver (2.2, 3.4.2), counted through the same board
     the tile links to so the two cannot disagree. */
  const waitingParcels = trpc.dispatch.waiting.useQuery(undefined, {
    enabled: can(actor, "delivery.view"),
  });
  /* Damage claims (3.4.2): for NetLet the ones to decide, for a company the
     ones against it still waiting on its answer. */
  const openClaims = trpc.dispatch.claims.openCount.useQuery(undefined, {
    enabled: can(actor, "delivery.view"),
  });
  /* Returns waiting on this store (3.2.8): collecting, receiving, or cash still
     to hand back. */
  const waitingReturns = trpc.returns.waiting.useQuery(undefined, {
    enabled: can(actor, "returns.handle", actor.kind === "vendor" ? actor.vendorId : undefined),
  });
  /* Warranty claims nobody has answered (migration 0072). */
  const waitingWarranty = trpc.warranty.waitingCount.useQuery(undefined, {
    enabled: can(actor, "returns.handle", actor.kind === "vendor" ? actor.vendorId : undefined),
  });
  /* Stores' commission proposals waiting on whoever sets rates (3.3.2). */
  const waitingProposals = trpc.commission.waiting.useQuery(undefined, { enabled: can(actor, "vendor.setCommission") });
  /* Affiliate applications waiting on NetLet (3.7). */
  const waitingAffiliates = trpc.affiliates.waiting.useQuery(undefined, { enabled: can(actor, "affiliate.manage") });
  /* Home banners a store has paid for, waiting on NetLet before they can run. */
  const waitingBanners = trpc.ads.bannersWaiting.useQuery(undefined, { enabled: can(actor, "product.review") });
  /* Shoppers waiting on NetLet itself (3.5.1). */
  const waitingSupport = trpc.support.waiting.useQuery(undefined, { enabled: can(actor, "support.answer") });
  const atCentres = trpc.fulfilment.waiting.useQuery(undefined, { enabled: can(actor, "fulfilment.operate") });
  /* Fraud watch's alerts this administrator has not looked at (3.6.5). */
  const fraudAlerts = trpc.orders.fraudUnseen.useQuery(undefined, { enabled: can(actor, "platform.viewAll") });
  /* Product reviews the automatic check left for a person: the fraud desk's "Waiting" view. */
  const waitingReviews = trpc.reviews.waitingCount.useQuery(undefined, { enabled: actor.kind === "admin" });
  /* Devices asking for an administrator's rights, waiting on the owner alone. */
  const waitingDevices = trpc.devices.waiting.useQuery(undefined, { enabled: can(actor, "platform.devices") });

  if (isCourier) {
    return (
      <>
        <PageHeader title={t("admin.overview")} description={t("admin.overviewIntro")} />
        <SectionHeading>{t("admin.needsYou")}</SectionHeading>
        {(waitingParcels.data ?? 0) + (openClaims.data ?? 0) > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(waitingParcels.data ?? 0) > 0 ? (
              <Tile tile={{ label: "dispatch.waiting", value: waitingParcels.data ?? 0, href: "/admin/dispatch", tone: "urgent" }} />
            ) : null}
            {(openClaims.data ?? 0) > 0 ? (
              <Tile tile={{ label: "admin.claimsOpenTile", value: openClaims.data ?? 0, href: "/admin/claims", tone: "urgent" }} />
            ) : null}
          </div>
        ) : (
          <AllClear>{t("dispatch.noneCourier")}</AllClear>
        )}
      </>
    );
  }

  if (counts.isLoading || counts.isError) return <QueryGate queries={[counts]}>{() => null}</QueryGate>;
  const data = counts.data;
  if (!data) return <p className="text-sm text-[#536b8c]">{t("admin.loading")}</p>;

  const mayReview = can(actor, "product.review");
  const maySeeVendors = can(actor, "platform.viewAll");

  /*
   * "Waiting on you" is only the things somebody has to act on. A count of
   * live products is reassuring; a count of products stuck in review is work.
   * Mixing the two teaches people to stop reading the row.
   */
  const waiting: Tile[] = [
    { label: "devices.waitingTile" as const, value: waitingDevices.data ?? 0, href: "/admin/devices", tone: "urgent" as const },
    { label: "admin.applications" as const, value: waitingApplications.data ?? 0, href: "/admin/applications", tone: "urgent" as const },
    ...(mayReview ? [{ label: "admin.countPendingReview" as const, value: data.pendingReview, href: "/admin/review", tone: "urgent" as const }] : []),
    ...(maySeeVendors ? [{ label: "admin.countVendorsPending" as const, value: data.vendorsPending, href: "/admin/vendors", tone: "urgent" as const }] : []),
    ...(can(actor, "vendor.setCommission") ? [{ label: "commission.waitingTile" as const, value: waitingProposals.data ?? 0, href: "/admin/commission", tone: "urgent" as const }] : []),
    /* A live store charging nothing: allowed, since zero is an instruction,
       but usually a rate nobody set — and it costs every sale until noticed.
       One store goes straight to its page, where the rate is set. */
    ...(maySeeVendors ? [{
      label: "admin.zeroCommissionTile" as const,
      value: data.zeroCommission.length,
      href: data.zeroCommission.length === 1 ? `/admin/vendors/${data.zeroCommission[0].id}` : "/admin/vendors",
      tone: "urgent" as const,
    }] : []),
    { label: "admin.countOutOfStock" as const, value: data.outOfStock, href: "/admin/stock", tone: "urgent" as const },
    { label: "admin.countLowStock" as const, value: data.lowStock, href: "/admin/stock", tone: "urgent" as const },
    /* A shopper waiting on a price is work, and it runs out: a request nobody
       answers inside the week expires, so this belongs beside the review queue
       rather than among the standing totals. */
    { label: "admin.offersWaiting" as const, value: waitingOffers.data ?? 0, href: "/admin/offers", tone: "urgent" as const },
    /* Unread rather than "this week": a rolling window never reaches zero and
       therefore never means anything, and the tile hides itself at zero like
       every other one here. */
    { label: "admin.sellerChanges" as const, value: sellerChanges.data?.unseen ?? 0, href: "/admin/audit", tone: "urgent" as const },
    { label: "dispatch.waiting" as const, value: waitingParcels.data ?? 0, href: "/admin/dispatch", tone: "urgent" as const },
    { label: "admin.claimsOpenTile" as const, value: openClaims.data ?? 0, href: "/admin/claims", tone: "urgent" as const },
    { label: "admin.returnsWaiting" as const, value: waitingReturns.data ?? 0, href: "/admin/returns", tone: "urgent" as const },
    { label: "warranty.waitingTile" as const, value: waitingWarranty.data ?? 0, href: "/admin/warranty", tone: "urgent" as const },
    { label: "admin.affiliatesWaiting" as const, value: waitingAffiliates.data ?? 0, href: "/admin/affiliates", tone: "urgent" as const },
    { label: "admin.bannersWaiting" as const, value: waitingBanners.data ?? 0, href: "/admin/ads", tone: "urgent" as const },
    { label: "support.waitingTile" as const, value: waitingSupport.data ?? 0, href: "/admin/support", tone: "urgent" as const },
    { label: "fraud.ordersTile" as const, value: fraudAlerts.data?.orders ?? 0, href: "/admin/orders", tone: "urgent" as const },
    { label: "fraud.watchTile" as const, value: fraudAlerts.data?.watch ?? 0, href: "/admin/fraud", tone: "urgent" as const },
    { label: "review.waitingTile" as const, value: waitingReviews.data ?? 0, href: "/admin/fraud?view=waiting", tone: "urgent" as const },
    { label: "fulfilment.toReceiveTile" as const, value: atCentres.data?.toReceive ?? 0, href: "/admin/fulfilment" },
    { label: "fulfilment.toPickTile" as const, value: atCentres.data?.toPick ?? 0, href: "/admin/fulfilment", tone: "urgent" as const },
  ].filter(tile => tile.value > 0);

  const standing: Tile[] = [
    { label: "admin.countPublished" as const, value: data.published, href: "/admin/products" },
    { label: "admin.countDraft" as const, value: data.draft, href: "/admin/products" },
    { label: "admin.countArchived" as const, value: data.archived, href: "/admin/products" },
    ...(maySeeVendors ? [{ label: "admin.countVendorsApproved" as const, value: data.vendorsApproved, href: "/admin/vendors" }] : []),
  ];

  const rangeControl = mayMoney ? (
    <Segmented
      label={t("dashboard.range")}
      value={String(range) as `${DashboardRange}`}
      onChange={value => {
        const next = Number(value) as DashboardRange;
        setRange(next);
        writeStored(RANGE_KEY, String(next));
      }}
      options={[
        { value: "7", label: t("dashboard.range7") },
        { value: "30", label: t("dashboard.range30") },
        { value: "90", label: t("dashboard.range90") },
      ]}
    />
  ) : null;

  return (
    <>
      <PageHeader title={t("admin.overview")} description={t("dashboard.asOf", { date: today })} actions={rangeControl} />

      {mayMoney && board.data ? (
        /* Sized by its own column, not the window: with the co-pilot open the
           column is 400px narrower, and the window's breakpoints cut a dinar
           amount to "K". */
        <div className={`@container space-y-4 transition-opacity ${board.isFetching && board.isPlaceholderData ? "opacity-60" : ""}`}>
          {board.data.truncated ? <Notice tone="warning">{t("dashboard.truncated")}</Notice> : null}
          <KpiRow board={board.data} />
          <div className="grid items-start gap-4 @5xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TrendPanel board={board.data} />
            <div className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-1">
              <NeedsYou waiting={waiting} />
              <StockPanel stock={board.data.stock} />
            </div>
          </div>
          <div className="grid items-start gap-4 @3xl:grid-cols-2">
            <DepartmentsPanel board={board.data} />
            <ActivityPanel board={board.data} />
          </div>
          <TopPanel board={board.data} />
        </div>
      ) : mayMoney && board.isError ? (
        <QueryGate queries={[board]}>{() => null}</QueryGate>
      ) : mayMoney ? (
        <DashboardSkeleton label={t("admin.loading")} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <NeedsYou waiting={waiting} />
          {shelf.data ? <StockPanel stock={shelf.data} /> : null}
        </div>
      )}

      {health.data ? <HealthPanel health={health.data} /> : null}

      {/* The store's own warnings (3.3.18), drawn only when it has any. */}
      {actor.kind === "vendor" ? <div className="mt-8"><StoreWarnings manage={false} /></div> : null}

      <section aria-labelledby="at-a-glance" className="mt-8">
        <SectionHeading><span id="at-a-glance">{t("admin.atAGlance")}</span></SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {standing.map(tile => <Tile key={tile.label} tile={tile} />)}
        </div>
      </section>
    </>
  );
}

/**
 * What waits on this person, as one list beside the sales line: each queue
 * named, its count, and the page that clears it. Only queues with something
 * in them; nothing waiting is said in a sentence.
 */
function NeedsYou({ waiting }: { waiting: Tile[] }) {
  const { t } = useTranslation();
  return (
    <Panel id="needs-you" title={t("admin.needsYou")}>
      {waiting.length === 0 ? (
        <p className="flex items-center gap-2.5 rounded-xl bg-[#eef8f0] px-4 py-4 text-[14px] text-[#1f4d2a]">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />{t("admin.allClear")}
        </p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {waiting.map(tile => (
            <li key={tile.label}>
              <Link href={tile.href} className="group flex min-h-11 items-center gap-3 rounded-xl px-2 py-2 hover:bg-[#0a285a]/[.06]">
                <span aria-hidden className={`h-7 w-1 shrink-0 rounded-full ${tile.tone === "urgent" ? "bg-[#f2683a]" : "bg-[#cbd4e0]"}`} />
                <span className="min-w-0 flex-1 text-[14px] font-semibold text-[#0a285a]">{t(tile.label)}</span>
                <span className="shrink-0 rounded-full bg-[#0a285a] px-2.5 py-0.5 text-[12px] font-bold tabular-nums text-white"><bdi dir="ltr">{tile.value}</bdi></span>
                <ChevronRight className="size-4 shrink-0 text-[#536b8c] rtl:-scale-x-100" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The dashboard's shape while it is read, so nothing moves when the figures land. */
function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="@container space-y-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="grid grid-cols-1 gap-3 @md:grid-cols-2 @5xl:grid-cols-4">
        {[0, 1, 2, 3].map(index => (
          <div key={index} className={`h-[132px] p-5 ${surfaceClass}`}>
            <div className="portal-shimmer h-4 w-1/2 rounded" />
            <div className="portal-shimmer mt-5 h-7 w-2/3 rounded" />
            <div className="portal-shimmer mt-4 h-3 w-3/4 rounded" />
          </div>
        ))}
      </div>
      <div aria-hidden className="grid gap-4 @5xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={`h-[380px] p-5 ${surfaceClass}`}><div className="portal-shimmer h-full w-full rounded-xl" /></div>
        <div className={`h-[380px] p-5 ${surfaceClass}`}><div className="portal-shimmer h-full w-full rounded-xl" /></div>
      </div>
    </div>
  );
}

const COMPONENT_LABEL = {
  catalog: "admin.healthCatalog",
  stock: "admin.healthStock",
  compliance: "admin.healthCompliance",
  rating: "admin.healthRating",
} as const;

const BAND_LABEL = { good: "admin.healthGood", fair: "admin.healthFair", poor: "admin.healthPoor" } as const;

/*
 * Every figure the score is shown with, labelled.
 *
 * Typed against `HealthDetailKey` rather than `string`, so a figure added to
 * `vendorHealth` without a label here fails the build. The alternative is what
 * this replaced: "outOfStock 0 · variants 4" rendered into an Arabic page.
 */
const DETAIL_LABEL: Record<HealthDetailKey, MessageKey> = {
  published: "health.published",
  pendingReview: "health.pendingReview",
  outOfStock: "health.outOfStock",
  variants: "health.variants",
  warnings: "health.warnings",
  suspendAt: "health.suspendAt",
  rating: "health.rating",
  outOf: "health.outOf",
};

/**
 * Account health, with its working shown.
 *
 * The requirement is transparency, so each component carries the raw counts it
 * was computed from. A score a vendor cannot reproduce is a grade with no
 * appeal.
 */
function HealthPanel({ health }: {
  health: {
    score: number;
    band: "good" | "fair" | "poor";
    components: { key: "catalog" | "stock" | "compliance" | "rating"; score: number; detail: Partial<Record<HealthDetailKey, number>> }[];
  };
}) {
  const { t } = useTranslation();
  const tone = health.band === "good" ? "#155724" : health.band === "fair" ? "#6b4f1d" : "#8c2f22";

  return (
    <section aria-labelledby="account-health" className="mt-8">
      <SectionHeading description={t("admin.healthNote")}><span id="account-health">{t("admin.health")}</span></SectionHeading>
      <div className={`p-5 ${surfaceClass}`}>
        <div className="flex flex-wrap items-baseline gap-3">
          {/* A score is a number: isolated so it reads the same in both scripts. */}
          <p className="text-[32px] leading-none font-extrabold" style={{ color: tone }}><bdi dir="ltr">{health.score}</bdi></p>
          <p className="text-[14px] font-semibold" style={{ color: tone }}>{t(BAND_LABEL[health.band])}</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {health.components.map(part => (
            <div key={part.key} className="rounded-xl border border-[#e1e7ef] p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[14px] font-semibold text-[#0a285a]">{t(COMPONENT_LABEL[part.key])}</p>
                <p className="text-[14px] font-bold text-[#536b8c]"><bdi dir="ltr">{part.score}</bdi></p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef1f6]">
                <div className="h-full rounded-full bg-[#0a285a]" style={{ width: `${part.score}%` }} />
              </div>
              {/* The numbers behind the bar, so the bar is checkable. The
                  count is isolated so it reads as a number in either script;
                  the label around it takes the page's direction. */}
              <p className="mt-2 text-[12px] leading-5 ink-muted">
                {Object.keys(part.detail).length === 0
                  ? "—"
                  : (Object.entries(part.detail) as [HealthDetailKey, number][]).map(([key, value], index) => (
                      <span key={key}>
                        {index > 0 ? " · " : null}
                        {t(DETAIL_LABEL[key])} <span dir="ltr">{value}</span>
                      </span>
                    ))}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * One count and where it is acted on. Work waiting carries a mark on its
 * leading edge rather than a red box: a page of alarm-red tiles is one people
 * learn to stop reading, and the number is the news.
 */
function Tile({ tile }: { tile: Tile }) {
  const { t } = useTranslation();
  const urgent = tile.tone === "urgent";
  return (
    <Link
      href={tile.href}
      className={`group block p-4 transition hover:border-[#0a285a]/30 hover:bg-[#f0f2f5] ${surfaceClass} ${urgent ? "border-s-4 border-s-[#d9622b]" : ""}`}
    >
      {/* The number is read as a number, so it stays LTR even in Arabic. */}
      <p className="text-[28px] leading-9 font-extrabold text-[#0a285a] tabular-nums">
        <bdi dir="ltr">{tile.value}</bdi>
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[14px] font-semibold text-[#536b8c] group-hover:text-[#0a285a]">
        {t(tile.label)}
        <ArrowRight className="size-4 shrink-0 rtl:-scale-x-100" aria-hidden />
      </p>
    </Link>
  );
}

/** Nothing waiting, said plainly and without a box that looks like a warning. */
function AllClear({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)] px-5 py-5 text-[14px] text-[#2f5d33]">
      <CheckCircle2 className="size-5 shrink-0" aria-hidden />{children}
    </p>
  );
}
