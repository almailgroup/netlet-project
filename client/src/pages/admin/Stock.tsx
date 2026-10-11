/**
 * What is running out, and what has moved.
 *
 * Two halves of one question. The list answers "what do I need to reorder";
 * the log answers "why is this number what it is" — which only has an answer
 * because stock moves by a delta with a reason rather than by typing a new
 * total.
 *
 * Scoped by the server: a vendor sees their own shelves, an admin sees every
 * vendor's.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { Pager } from "@/components/admin/Pager";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import type { MessageKey } from "@shared/i18n/dictionary";
import { Link } from "wouter";

export default function AdminStock() {
  usePageMeta(privatePageMeta("Stock"));
  return <AdminShell need="product.view">{() => <Stock />}</AdminShell>;
}

function Stock() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const low = trpc.inventory.lowStock.useQuery({ page }, { placeholderData: previous => previous });
  const history = trpc.inventory.stockHistory.useQuery({ limit: 30 });

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.lowStockTitle")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.lowStockNote")}</p>

      {low.isLoading || low.isError ? (
        <div className="mt-5"><QueryGate queries={[low]}>{() => null}</QueryGate></div>
      ) : (low.data?.rows ?? []).length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t("admin.nothingLow")}</p>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {(low.data?.rows ?? []).map(row => {
            const out = row.stock <= 0;
            return (
              <Link
                key={row.variantId}
                href={`/admin/products/${row.productId}`}
                className={`pressable flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border p-4 ${out ? "border-[#f2b69e] bg-[#fdeceb]" : "border-[#e6e9ef] bg-white"}`}
              >
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate font-bold text-[#0a285a]">{row.productTitle}</p>
                  <p className="mt-0.5 text-[11px] ink-muted">
                    {!isDefaultVariantTitle(row.variantTitle) ? <span dir="auto">{row.variantTitle} · </span> : null}
                    {row.lowStockAt === null ? t("admin.noThreshold") : t("admin.reorderAt", { count: row.lowStockAt })}
                    {row.vendorName ? <span dir="auto"> · {row.vendorName}</span> : null}
                  </p>
                  {/* Demand the seller could not see before (3.1.1): how many
                      shoppers asked to hear when it is back. A count, never who. */}
                  {row.waiting > 0 ? <p className="mt-0.5 text-[11px] font-extrabold text-[#0a285a]">{t("admin.waitingForRestock", { count: row.waiting })}</p> : null}
                </div>
                <span
                  dir="ltr"
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-extrabold ${out ? "bg-[#8c2f22] text-white" : "bg-[#e7edf5] text-[#0a285a]"}`}
                >
                  {t("admin.remaining", { count: row.stock })}
                </span>
              </Link>
            );
          })}
          {low.data ? <Pager page={low.data} onPage={setPage} /> : null}
        </div>
      )}

      <h2 className="mt-9 text-sm font-extrabold">{t("admin.recentMovements")}</h2>
      {history.isLoading || history.isError ? (
        <div className="mt-3"><QueryGate queries={[history]}>{() => null}</QueryGate></div>
      ) : (history.data ?? []).length === 0 ? (
        <p className="mt-3 rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">
          {t("admin.noMovements")}
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {(history.data ?? []).map(row => (
            <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xl border border-[#e6e9ef] bg-white px-4 py-2.5">
              {/* A signed number is bidi-fragile: "+12" renders as "12+" when
                  the surrounding paragraph is RTL. Isolating it keeps the
                  sign where it belongs. */}
              <span
                dir="ltr"
                className={`shrink-0 text-[13px] font-extrabold ${row.delta < 0 ? "text-[#8c2f22]" : "text-[#155724]"}`}
              >
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </span>
              <span dir="auto" className="min-w-0 flex-1 truncate text-[12px] font-bold text-[#0a285a]">
                {row.productTitle}
              </span>
              <span className="text-[11px] text-[#536b8c]">
                {t(`reason.${row.reason}` as MessageKey)}
              </span>
              <span className="text-[11px] ink-muted">
                {row.actorEmail ? t("admin.movedBy", { name: row.actorName || row.actorEmail }) : t("admin.movedBySystem")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
