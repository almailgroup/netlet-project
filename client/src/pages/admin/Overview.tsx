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
import { ArrowRight } from "lucide-react";
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

  if (isCourier) {
    return (
      <>
        <h1 className="text-xl font-extrabold">{t("admin.overview")}</h1>
        <h2 className="mt-6 text-[11px] font-extrabold tracking-[.12em] ink-accent uppercase">{t("admin.needsYou")}</h2>
        {(waitingParcels.data ?? 0) > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile tile={{ label: "dispatch.waiting", value: waitingParcels.data ?? 0, href: "/admin/dispatch", tone: "urgent" }} />
          </div>
        ) : (
          <p className="mt-3 rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">
            {t("dispatch.noneCourier")}
          </p>
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
  ].filter(tile => tile.value > 0);

  const standing: Tile[] = [
    { label: "admin.countPublished" as const, value: data.published, href: "/admin/products" },
    { label: "admin.countDraft" as const, value: data.draft, href: "/admin/products" },
    { label: "admin.countArchived" as const, value: data.archived, href: "/admin/products" },
    ...(maySeeVendors ? [{ label: "admin.countVendorsApproved" as const, value: data.vendorsApproved, href: "/admin/vendors" }] : []),
  ];

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.overview")}</h1>

      <h2 className="mt-6 text-[11px] font-extrabold tracking-[.12em] ink-accent uppercase">{t("admin.needsYou")}</h2>
      {waiting.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">
          {t("admin.allClear")}
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {waiting.map(tile => <Tile key={tile.label} tile={tile} />)}
        </div>
      )}

      {health.data ? <HealthPanel health={health.data} /> : null}

      <h2 className="mt-8 text-[11px] font-extrabold tracking-[.12em] text-[#536b8c] uppercase">{t("admin.atAGlance")}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {standing.map(tile => <Tile key={tile.label} tile={tile} />)}
      </div>
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
  rejections: "health.rejections",
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
  const tone = health.band === "good" ? "#155724" : health.band === "fair" ? "#8a6d3b" : "#8c2f22";

  return (
    <section className="mt-8">
      <h2 className="text-[11px] font-extrabold tracking-[.12em] text-[#536b8c] uppercase">{t("admin.health")}</h2>
      <div className="mt-3 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        <div className="flex flex-wrap items-baseline gap-3">
          {/* A score is a number: isolated so it reads the same in both scripts. */}
          <p className="text-3xl font-extrabold" style={{ color: tone }}><bdi dir="ltr">{health.score}</bdi></p>
          <p className="text-[12px] font-extrabold" style={{ color: tone }}>{t(BAND_LABEL[health.band])}</p>
          <p className="w-full text-[12px] leading-5 text-[#536b8c] sm:w-auto sm:flex-1">{t("admin.healthNote")}</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {health.components.map(part => (
            <div key={part.key} className="rounded-xl border border-[#e6e9ef] p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[12px] font-bold text-[#0a285a]">{t(COMPONENT_LABEL[part.key])}</p>
                <p className="text-[13px] font-extrabold text-[#536b8c]"><bdi dir="ltr">{part.score}</bdi></p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef1f6]">
                <div className="h-full rounded-full bg-[#0a285a]" style={{ width: `${part.score}%` }} />
              </div>
              {/* The numbers behind the bar, so the bar is checkable. The
                  count is isolated so it reads as a number in either script;
                  the label around it takes the page's direction. */}
              <p className="mt-2 text-[10px] ink-muted">
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

function Tile({ tile }: { tile: Tile }) {
  const { t } = useTranslation();
  const urgent = tile.tone === "urgent";
  return (
    <Link
      href={tile.href}
      className={`pressable block rounded-2xl border p-4 ${urgent ? "border-[#f2b69e] bg-[#fdeceb]" : "border-[#e6e9ef] bg-white"}`}
    >
      {/* The number is read as a number, so it stays LTR even in Arabic. */}
      <p className={`text-2xl font-extrabold ${urgent ? "text-[#8c2f22]" : "text-[#0a285a]"}`}>
        <bdi dir="ltr">{tile.value}</bdi>
      </p>
      <p className={`mt-1 flex items-center gap-1.5 text-[12px] font-bold ${urgent ? "text-[#8c2f22]" : "text-[#536b8c]"}`}>
        {t(tile.label)}
        <ArrowRight className="size-3.5 rtl:-scale-x-100" />
      </p>
    </Link>
  );
}
