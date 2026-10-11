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
import { ArrowRight, Search } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
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

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.invoices")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.invoicesNote")}</p>

      <form
        role="search"
        className="mt-5 flex max-w-md items-center gap-2"
        onSubmit={event => { event.preventDefault(); setPage(1); setQuery(typed.trim()); }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("admin.invoicesSearch")}</span>
          <input
            value={typed}
            onChange={event => setTyped(event.target.value)}
            maxLength={40}
            dir="ltr"
            placeholder="INV-2026-000001"
            className="glass-field h-10 w-full rounded-full px-4 text-sm"
          />
        </label>
        <button type="submit" className="glass-navy pressable grid size-10 shrink-0 place-items-center rounded-full" aria-label={t("admin.invoicesSearch")}>
          <Search className="size-4" aria-hidden />
        </button>
      </form>

      <QueryGate queries={[list]}>
        {() => {
          const result = list.data;
          const rows = result?.rows ?? [];
          if (rows.length === 0) {
            return <p className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">{t(query ? "admin.invoicesNoMatch" : "admin.invoicesNone")}</p>;
          }
          return (
            <div className="mt-5 space-y-2">
              {rows.map(row => (
                <Link
                  key={row.number}
                  href={`/invoices/${row.number}`}
                  className="pressable flex items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-4 hover:border-[#0a285a]/30"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#0a285a]">
                      <bdi dir="ltr">{row.number}</bdi>
                      <span className="ms-2 rounded-full bg-[#eaf1fb] px-2 py-0.5 text-[10px] font-extrabold">
                        {t(row.kind === "credit_note" ? "invoice.creditNote" : "invoice.title")}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] ink-muted">
                      <bdi dir="ltr">{row.orderReference}</bdi> · {formatDate(row.issuedAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-extrabold">{row.kind === "credit_note" ? "−" : ""}{money(row.total, "KWD")}</span>
                  <ArrowRight className="size-4 shrink-0 ink-muted rtl:-scale-x-100" aria-hidden />
                </Link>
              ))}
              {result ? <Pager page={result} onPage={setPage} /> : null}
            </div>
          );
        }}
      </QueryGate>
    </>
  );
}
