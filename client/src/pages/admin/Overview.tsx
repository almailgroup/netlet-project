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
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, type Actor } from "@shared/inventory/permissions";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function AdminOverview() {
  usePageMeta(privatePageMeta("Overview"));
  return <AdminShell>{actor => <Overview actor={actor} />}</AdminShell>;
}

type Tile = { label: MessageKey; value: number; href: string; tone?: "urgent" | "quiet" };

function Overview({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const counts = trpc.inventory.overview.useQuery();

  if (counts.isLoading) return <p className="text-sm text-[#536b8c]">{t("admin.loading")}</p>;
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
    ...(mayReview ? [{ label: "admin.countPendingReview" as const, value: data.pendingReview, href: "/admin/review", tone: "urgent" as const }] : []),
    ...(maySeeVendors ? [{ label: "admin.countVendorsPending" as const, value: data.vendorsPending, href: "/admin/vendors", tone: "urgent" as const }] : []),
    { label: "admin.countOutOfStock" as const, value: data.outOfStock, href: "/admin/stock", tone: "urgent" as const },
    { label: "admin.countLowStock" as const, value: data.lowStock, href: "/admin/stock", tone: "urgent" as const },
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

      <h2 className="mt-6 text-[11px] font-extrabold tracking-[.12em] text-[#f2683a] uppercase">{t("admin.needsYou")}</h2>
      {waiting.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">
          {t("admin.allClear")}
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {waiting.map(tile => <Tile key={tile.label} tile={tile} />)}
        </div>
      )}

      <h2 className="mt-8 text-[11px] font-extrabold tracking-[.12em] text-[#536b8c] uppercase">{t("admin.atAGlance")}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {standing.map(tile => <Tile key={tile.label} tile={tile} />)}
      </div>
    </>
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
      <p dir="ltr" className={`text-2xl font-extrabold ${urgent ? "text-[#8c2f22]" : "text-[#0a285a]"}`}>
        {tile.value}
      </p>
      <p className={`mt-1 flex items-center gap-1.5 text-[12px] font-bold ${urgent ? "text-[#8c2f22]" : "text-[#536b8c]"}`}>
        {t(tile.label)}
        <ArrowRight className="size-3.5 rtl:-scale-x-100" />
      </p>
    </Link>
  );
}
