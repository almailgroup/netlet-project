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
import { PageHeader, SectionHeading } from "@/components/admin/ui";
import { StoreWarnings } from "@/components/admin/StoreWarnings";
import { SalesPanel } from "@/components/admin/SalesPanel";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "wouter";

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
  /* Stores' commission proposals waiting on whoever sets rates (3.3.2). */
  const waitingProposals = trpc.commission.waiting.useQuery(undefined, { enabled: can(actor, "vendor.setCommission") });
  /* Affiliate applications waiting on NetLet (3.7). */
  const waitingAffiliates = trpc.affiliates.waiting.useQuery(undefined, { enabled: can(actor, "affiliate.manage") });
  /* Home banners a store has paid for, waiting on NetLet before they can run. */
  const waitingBanners = trpc.ads.bannersWaiting.useQuery(undefined, { enabled: can(actor, "product.review") });
  /* Shoppers waiting on NetLet itself (3.5.1). */
  const waitingSupport = trpc.support.waiting.useQuery(undefined, { enabled: can(actor, "support.answer") });
  const atCentres = trpc.fulfilment.waiting.useQuery(undefined, { enabled: can(actor, "fulfilment.operate") });

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
    { label: "admin.affiliatesWaiting" as const, value: waitingAffiliates.data ?? 0, href: "/admin/affiliates", tone: "urgent" as const },
    { label: "admin.bannersWaiting" as const, value: waitingBanners.data ?? 0, href: "/admin/ads", tone: "urgent" as const },
    { label: "support.waitingTile" as const, value: waitingSupport.data ?? 0, href: "/admin/support", tone: "urgent" as const },
    { label: "fulfilment.toReceiveTile" as const, value: atCentres.data?.toReceive ?? 0, href: "/admin/fulfilment" },
    { label: "fulfilment.toPickTile" as const, value: atCentres.data?.toPick ?? 0, href: "/admin/fulfilment", tone: "urgent" as const },
  ].filter(tile => tile.value > 0);

  const standing: Tile[] = [
    { label: "admin.countPublished" as const, value: data.published, href: "/admin/products" },
    { label: "admin.countDraft" as const, value: data.draft, href: "/admin/products" },
    { label: "admin.countArchived" as const, value: data.archived, href: "/admin/products" },
    ...(maySeeVendors ? [{ label: "admin.countVendorsApproved" as const, value: data.vendorsApproved, href: "/admin/vendors" }] : []),
  ];

  return (
    <>
      <PageHeader title={t("admin.overview")} description={t("admin.overviewIntro")} />

      <section aria-labelledby="needs-you">
        <SectionHeading><span id="needs-you">{t("admin.needsYou")}</span></SectionHeading>
        {waiting.length === 0 ? (
          <AllClear>{t("admin.allClear")}</AllClear>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {waiting.map(tile => <Tile key={tile.label} tile={tile} />)}
          </div>
        )}
      </section>

      {can(actor, "payouts.view", vendorScope) ? <SalesPanel /> : null}

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
      <div className="rounded-2xl border border-[#e1e7ef] bg-white p-5">
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
      className={`group block rounded-2xl border border-[#e1e7ef] bg-white p-4 transition hover:border-[#0a285a]/30 hover:bg-[#f0f2f5] hover:shadow-sm ${urgent ? "border-s-4 border-s-[#d9622b]" : ""}`}
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
    <p className="flex items-center gap-2.5 rounded-2xl border border-[#e1e7ef] bg-white px-5 py-5 text-[14px] text-[#2f5d33]">
      <CheckCircle2 className="size-5 shrink-0" aria-hidden />{children}
    </p>
  );
}
