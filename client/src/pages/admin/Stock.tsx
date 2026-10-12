/**
 * What is running out, and what has moved.
 *
 * Two halves of one question. The list answers "what do I need to reorder";
 * the log answers "why is this number what it is" — which only has an answer
 * because stock moves by a delta with a reason rather than by typing a new
 * total.
 *
 * Both are tables on a wide screen and cards on a phone: the columns are what
 * somebody compares down the page (how many left against the reorder point),
 * and a list of sentences made them read across instead.
 *
 * Scoped by the server: a vendor sees their own shelves, an admin sees every
 * vendor's.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { EmptyState, PageHeader, Pill, SectionHeading, SkeletonRows, tableClass } from "@/components/admin/ui";
import { useDateTimeFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import { useState } from "react";
import { Link } from "wouter";

export default function AdminStock() {
  usePageMeta(privatePageMeta("Stock"));
  return <AdminShell need="product.view">{() => <Stock />}</AdminShell>;
}

function Stock() {
  const { t } = useTranslation();
  const when = useDateTimeFormat();
  const [page, setPage] = useState(1);
  const low = trpc.inventory.lowStock.useQuery({ page }, { placeholderData: previous => previous });
  const history = trpc.inventory.stockHistory.useQuery({ limit: 30 });
  const lowRows = low.data?.rows ?? [];
  const moves = history.data ?? [];

  const left = (stock: number) =>
    stock <= 0 ? <Pill tone="danger">{t("admin.outOfStock")}</Pill> : <Pill tone="warning">{t("admin.remaining", { count: stock })}</Pill>;
  /* A signed number is bidi-fragile: "+12" renders as "12+" when the
     surrounding paragraph is RTL, so it is isolated. */
  const change = (delta: number) => (
    <bdi dir="ltr" className={`font-bold tabular-nums ${delta < 0 ? "text-[#8c2f22]" : "text-[#2f5d33]"}`}>
      {delta > 0 ? `+${delta}` : delta}
    </bdi>
  );
  const by = (row: (typeof moves)[number]) =>
    row.actorEmail ? t("admin.movedBy", { name: row.actorName || row.actorEmail }) : t("admin.movedBySystem");

  return (
    <>
      <PageHeader title={t("admin.stockTitle")} description={t("admin.stockIntro")} />

      <section aria-labelledby="low-stock">
        <SectionHeading description={t("admin.lowStockNote")}><span id="low-stock">{t("admin.lowStockTitle")}</span></SectionHeading>
        {low.isLoading ? (
          <SkeletonRows label={t("admin.loading")} />
        ) : low.isError ? (
          <QueryGate queries={[low]}>{() => null}</QueryGate>
        ) : lowRows.length === 0 ? (
          <EmptyState title={t("admin.nothingLow")} />
        ) : (
          <>
            <ul className="space-y-2 md:hidden">
              {lowRows.map(row => (
                <li key={row.variantId} className="rounded-2xl border border-[#e1e7ef] bg-white p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/admin/products/${row.productId}`} dir="auto" className="min-w-0 font-bold text-[#0a285a] hover:underline">
                      {row.productTitle}
                    </Link>
                    {left(row.stock)}
                  </div>
                  <p className="mt-1 text-[13px] leading-5 ink-muted">
                    {!isDefaultVariantTitle(row.variantTitle) ? <span dir="auto">{row.variantTitle} · </span> : null}
                    {row.lowStockAt === null ? t("admin.noThreshold") : t("admin.reorderAt", { count: row.lowStockAt })}
                    {row.vendorName ? <span dir="auto"> · {row.vendorName}</span> : null}
                  </p>
                  {/* Demand the seller could not see before (3.1.1): how many
                      shoppers asked to hear when it is back. A count, never who. */}
                  {row.waiting > 0 ? <p className="mt-1 text-[13px] font-semibold text-[#0a285a]">{t("admin.waitingForRestock", { count: row.waiting })}</p> : null}
                </li>
              ))}
            </ul>
            <div className={`hidden md:block ${tableClass.wrap}`}>
              <table className={tableClass.table}>
                <thead className={tableClass.head}>
                  <tr>
                    <th scope="col" className={tableClass.th}>{t("admin.columnProduct")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.columnStore")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.columnReorder")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.columnWaiting")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.columnLeft")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lowRows.map(row => (
                    <tr key={row.variantId} className={`${tableClass.row} hover:bg-[#0a285a]/[.06]`}>
                      <td className={tableClass.td}>
                        <Link href={`/admin/products/${row.productId}`} dir="auto" className="font-bold text-[#0a285a] hover:underline">{row.productTitle}</Link>
                        {!isDefaultVariantTitle(row.variantTitle) ? <p dir="auto" className="mt-0.5 text-[13px] ink-muted">{row.variantTitle}</p> : null}
                      </td>
                      <td dir="auto" className={`${tableClass.td} text-[#536b8c]`}>{row.vendorName ?? "—"}</td>
                      <td className={`${tableClass.td} text-[#536b8c] tabular-nums`}>{row.lowStockAt ?? "—"}</td>
                      <td className={`${tableClass.td} tabular-nums ${row.waiting > 0 ? "font-semibold text-[#0a285a]" : "text-[#536b8c]"}`}>{row.waiting}</td>
                      <td className={`${tableClass.td} text-end`}>{left(row.stock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {low.data ? <Pager page={low.data} onPage={setPage} /> : null}
          </>
        )}
      </section>

      <section aria-labelledby="movements" className="mt-10">
        <SectionHeading><span id="movements">{t("admin.recentMovements")}</span></SectionHeading>
        {history.isLoading ? (
          <SkeletonRows rows={4} label={t("admin.loading")} />
        ) : history.isError ? (
          <QueryGate queries={[history]}>{() => null}</QueryGate>
        ) : moves.length === 0 ? (
          <EmptyState title={t("admin.noMovements")} />
        ) : (
          <>
            <ol className="space-y-2 md:hidden">
              {moves.map(row => (
                <li key={row.id} className="rounded-2xl border border-[#e1e7ef] bg-white p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/admin/products/${row.productId}`} dir="auto" className="min-w-0 font-semibold text-[#0a285a] hover:underline">{row.productTitle}</Link>
                    {change(row.delta)}
                  </div>
                  <p className="mt-1 text-[13px] leading-5 ink-muted">
                    {t(`reason.${row.reason}` as MessageKey)} · {by(row)} · {when(row.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
            <div className={`hidden md:block ${tableClass.wrap}`}>
              <table className={tableClass.table}>
                <thead className={tableClass.head}>
                  <tr>
                    <th scope="col" className={tableClass.th}>{t("admin.columnWhen")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.columnProduct")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.reason")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.columnChange")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.columnAfter")}</th>
                    <th scope="col" className={tableClass.th}>{t("admin.columnBy")}</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map(row => (
                    <tr key={row.id} className={tableClass.row}>
                      <td className={`${tableClass.td} whitespace-nowrap text-[#536b8c]`}>{when(row.createdAt)}</td>
                      <td className={tableClass.td}>
                        <Link href={`/admin/products/${row.productId}`} dir="auto" className="font-semibold text-[#0a285a] hover:underline">{row.productTitle}</Link>
                        {!isDefaultVariantTitle(row.variantTitle) ? <p dir="auto" className="mt-0.5 text-[13px] ink-muted">{row.variantTitle}</p> : null}
                      </td>
                      <td className={`${tableClass.td} text-[#536b8c]`}>{t(`reason.${row.reason}` as MessageKey)}</td>
                      <td className={`${tableClass.td} text-end`}>{change(row.delta)}</td>
                      <td className={`${tableClass.td} text-end tabular-nums text-[#0a285a]`}>{row.resulting}</td>
                      <td className={`${tableClass.td} text-[#536b8c]`}>{row.actorEmail ? <bdi>{row.actorName || row.actorEmail}</bdi> : t("admin.movedBySystem")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
