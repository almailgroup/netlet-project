/**
 * Every invoice and credit note NetLet has issued (3.6.6), for an
 * administrator: newest first, paged, and searchable by document number or
 * order reference — the two things somebody arrives holding.
 *
 * Search runs on the server, for the reason every admin filter here does: a
 * filter over the page already fetched reports "no matches" for a document on
 * page four.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Search } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, EmptyState, fieldClass, PageHeader, Pill, SkeletonRows, tableClass } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { privatePageMeta } from "@shared/seo";

export default function AdminInvoices() {
  usePageMeta(privatePageMeta("Invoices"));
  return <AdminShell need="platform.viewAll">{() => <Invoices />}</AdminShell>;
}

function Invoices() {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const [page, setPage] = useState(1);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const list = trpc.invoices.list.useQuery({ page, query: query || null }, { placeholderData: previous => previous });
  const kind = (value: string) => (
    <Pill tone={value === "credit_note" ? "warning" : "navy"}>{t(value === "credit_note" ? "invoice.creditNote" : "invoice.title")}</Pill>
  );
  const total = (row: { kind: string; total: string }) => (
    <span className="font-bold tabular-nums text-[#0a285a]">{row.kind === "credit_note" ? "−" : ""}{money(row.total, "KWD")}</span>
  );

  return (
    <>
      <PageHeader title={t("admin.invoices")} description={t("admin.invoicesNote")} />

      <form
        role="search"
        className="mb-5 flex max-w-md items-center gap-2"
        onSubmit={event => { event.preventDefault(); setPage(1); setQuery(typed.trim()); }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("admin.invoicesSearch")}</span>
          <input
            type="search"
            value={typed}
            onChange={event => setTyped(event.target.value)}
            maxLength={40}
            dir="ltr"
            placeholder="INV-2026-000001"
            className={fieldClass}
          />
        </label>
        <button type="submit" className={`${buttonClass.primary} w-11 px-0`} aria-label={t("admin.invoicesSearch")}>
          <Search className="size-4" aria-hidden />
        </button>
      </form>

      {list.isLoading ? (
        <SkeletonRows label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[list]}>
          {() => {
            const result = list.data;
            const rows = result?.rows ?? [];
            if (rows.length === 0) return <EmptyState title={t(query ? "admin.invoicesNoMatch" : "admin.invoicesNone")} />;
            return (
              <>
                <ul className="space-y-2 md:hidden">
                  {rows.map(row => (
                    <li key={row.number}>
                      <Link href={`/invoices/${row.number}`} className="block rounded-2xl border border-[#e1e7ef] bg-white p-3.5 hover:border-[#0a285a]/30 hover:bg-[#f0f2f5]">
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0 font-bold text-[#0a285a]"><bdi dir="ltr">{row.number}</bdi></span>
                          {total(row)}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] ink-muted">
                          {kind(row.kind)}
                          <bdi dir="ltr">{row.orderReference}</bdi>
                          <span aria-hidden>·</span>
                          {formatDate(row.issuedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className={`hidden md:block ${tableClass.wrap}`}>
                  <table className={tableClass.table}>
                    <thead className={tableClass.head}>
                      <tr>
                        <th scope="col" className={tableClass.th}>{t("admin.columnDocument")}</th>
                        <th scope="col" className={tableClass.th}>{t("admin.columnKind")}</th>
                        <th scope="col" className={tableClass.th}>{t("admin.columnOrder")}</th>
                        <th scope="col" className={tableClass.th}>{t("admin.columnIssued")}</th>
                        <th scope="col" className={tableClass.thEnd}>{t("admin.columnTotal")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.number} className={`${tableClass.row} hover:bg-[#0a285a]/[.06]`}>
                          <td className={tableClass.td}>
                            <Link href={`/invoices/${row.number}`} className="font-bold text-[#0a285a] hover:underline"><bdi dir="ltr">{row.number}</bdi></Link>
                          </td>
                          <td className={tableClass.td}>{kind(row.kind)}</td>
                          <td className={`${tableClass.td} text-[#536b8c]`}><bdi dir="ltr">{row.orderReference}</bdi></td>
                          <td className={`${tableClass.td} whitespace-nowrap text-[#536b8c]`}>{formatDate(row.issuedAt)}</td>
                          <td className={`${tableClass.td} text-end whitespace-nowrap`}>{total(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {result ? <Pager page={result} onPage={setPage} /> : null}
              </>
            );
          }}
        </QueryGate>
      )}
    </>
  );
}
