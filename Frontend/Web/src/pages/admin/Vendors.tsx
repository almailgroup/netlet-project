/**
 * The store list, admin only.
 *
 * A list, and only a list: editing one store happens on that store's own page.
 * What a row carries is what somebody scans the list for — whose store it is,
 * whether it is selling, how much is on its shelf and how much of that is live,
 * who can sign in for it, what NetLet charges it, and whether its paperwork is
 * complete. The counts come from the server with the page, so a store with
 * forty drafts and nothing live is visible without opening it.
 *
 * Search and the status filter go to the server, for the reason product search
 * does: a filter over one page answers "no matches" for a store on the next.
 * Each status says how many stores it holds before it is pressed.
 *
 * Every row is a link — the name — and the whole row answers a pointer; below
 * `md` the rows are cards, because six columns do not fit a phone.
 *
 * Commission still lives nowhere a vendor can reach. The server refuses a
 * vendor regardless of what any of this renders.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { StoreAvatar, StoreStatusPill } from "@/components/admin/StoreAvatar";
import { PageHeader, SkeletonRows, buttonClass, fieldClass } from "@/components/admin/ui";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";
import { missingStoreDetails } from "@shared/inventory/storeProfile";
import { privatePageMeta } from "@shared/seo";
import { CheckCircle2, CircleAlert, Search, Store } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

export default function AdminVendors() {
  usePageMeta(privatePageMeta("Vendors"));
  return <AdminShell need={"platform.viewAll"}>{() => <VendorList />}</AdminShell>;
}

const FILTERS = ["all", "approved", "pending", "suspended"] as const;
type Filter = (typeof FILTERS)[number];

function VendorList() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const term = search.trim();
  // `placeholderData` keeps the previous page drawn while the next arrives, so
  // stepping through does not blink the whole table out and back.
  const vendors = trpc.inventory.vendors.list.useQuery(
    { page, query: term || undefined, status: filter === "all" ? undefined : filter },
    { placeholderData: previous => previous },
  );
  const rows = vendors.data?.rows ?? [];
  const counts = vendors.data?.counts;

  const details = (vendor: (typeof rows)[number]) => {
    const missing = missingStoreDetails(vendor).length;
    return missing === 0 ? (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-[#2f5d33]">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden />{t("admin.complete")}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-[#6b4f1d]">
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        {t(missing === 1 ? "admin.incomplete" : "admin.incompletePlural", { count: missing })}
      </span>
    );
  };
  const shelf = (vendor: (typeof rows)[number]) =>
    vendor.productCount === 0 ? t("admin.productsNone") : t("admin.productsLiveOf", { live: vendor.liveCount, total: vendor.productCount });
  const team = (vendor: (typeof rows)[number]) =>
    vendor.memberCount === 0 ? t("admin.teamNone") : t("admin.teamCount", { count: vendor.memberCount });
  const commission = (vendor: (typeof rows)[number]) => `${Number(vendor.commissionPercent)}%`;

  return (
    <>
      <PageHeader
        title={t("admin.vendors")}
        description={t("admin.vendorsIntro")}
        actions={
          <Link href="/admin/vendors/new" className={buttonClass.primary}>
            <Store className="size-4" aria-hidden />{t("admin.openStoreButton")}
          </Link>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 ink-muted" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={event => { setSearch(event.target.value); setPage(1); }}
            aria-label={t("admin.searchStores")}
            placeholder={`${t("admin.searchStores")} — ${t("admin.searchStoresHint")}`}
            className={`${fieldClass} ps-10`}
          />
        </div>
        <div role="group" aria-label={t("admin.filterStatus")} className="hide-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-[#eef1f5] p-1">
          {FILTERS.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => { setFilter(option); setPage(1); }}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition ${filter === option ? "bg-white text-[#0a285a] shadow-sm" : "text-[#536b8c] hover:text-[#0a285a]"}`}
            >
              {option === "all" ? t("admin.statusAll") : t(`vendorStatus.${option}` as MessageKey)}
              {counts ? <span className="tabular-nums text-[12px] font-normal ink-muted">{counts[option]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {vendors.isLoading ? (
          <SkeletonRows label={t("admin.loading")} />
        ) : vendors.isError ? (
          <QueryGate queries={[vendors]}>{() => null}</QueryGate>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#b8c9dc] bg-white px-6 py-14 text-center">
            <p className="text-[15px] font-bold text-[#0a285a]">{t(term || filter !== "all" ? "admin.noMatches" : "admin.noVendors")}</p>
            {!term && filter === "all" ? (
              <Link href="/admin/vendors/new" className={`${buttonClass.primary} mt-5`}>
                <Store className="size-4" aria-hidden />{t("admin.openStoreButton")}
              </Link>
            ) : null}
          </div>
        ) : (
          <>
            <ul className={`space-y-2 md:hidden ${vendors.isFetching ? "opacity-70" : ""}`}>
              {rows.map(vendor => (
                <li key={vendor.id} className="rounded-2xl border border-[#e1e7ef] bg-white p-3">
                  <div className="flex items-center gap-3">
                    <StoreAvatar name={vendor.name} logoUrl={vendor.logoUrl} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/vendors/${vendor.id}`} dir="auto" className="line-clamp-1 text-[15px] font-bold text-[#0a285a] hover:underline">
                        {vendor.name}
                      </Link>
                      <p className="mt-0.5 truncate text-[12px] ink-muted"><bdi dir="ltr">/{vendor.slug}</bdi></p>
                    </div>
                    <StoreStatusPill status={vendor.status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-[#eef1f5] pt-3 text-[13px]">
                    <dt className="ink-muted">{t("admin.columnProducts")}</dt><dd className="font-semibold text-[#0a285a]">{shelf(vendor)}</dd>
                    <dt className="ink-muted">{t("admin.columnTeam")}</dt><dd className="font-semibold text-[#0a285a]">{team(vendor)}</dd>
                    <dt className="ink-muted">{t("admin.columnCommission")}</dt><dd className="font-semibold text-[#0a285a] tabular-nums"><bdi dir="ltr">{commission(vendor)}</bdi></dd>
                    <dt className="ink-muted">{t("admin.columnDetails")}</dt><dd>{details(vendor)}</dd>
                  </dl>
                </li>
              ))}
            </ul>

            <div className={`hidden overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white md:block ${vendors.isFetching ? "opacity-70" : ""}`}>
              <table className="w-full text-start text-[14px]">
                <thead className="border-b border-[#e1e7ef] bg-[#fafbfd] text-[13px] text-[#536b8c]">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-start font-semibold">{t("admin.columnStore")}</th>
                    <th scope="col" className="px-4 py-3 text-start font-semibold">{t("admin.columnStatus")}</th>
                    <th scope="col" className="px-4 py-3 text-start font-semibold">{t("admin.columnProducts")}</th>
                    <th scope="col" className="hidden px-4 py-3 text-start font-semibold lg:table-cell">{t("admin.columnTeam")}</th>
                    <th scope="col" className="px-4 py-3 text-end font-semibold">{t("admin.columnCommission")}</th>
                    <th scope="col" className="hidden px-4 py-3 text-start font-semibold xl:table-cell">{t("admin.columnDetails")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(vendor => (
                    <tr
                      key={vendor.id}
                      onClick={event => {
                        if ((event.target as HTMLElement).closest("a, button")) return;
                        navigate(`/admin/vendors/${vendor.id}`);
                      }}
                      className="cursor-pointer border-b border-[#f0f2f6] last:border-b-0 hover:bg-[#0a285a]/[.06]"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <StoreAvatar name={vendor.name} logoUrl={vendor.logoUrl} />
                          <div className="min-w-0">
                            <Link href={`/admin/vendors/${vendor.id}`} dir="auto" className="line-clamp-1 font-bold text-[#0a285a] hover:underline">
                              {vendor.name}
                            </Link>
                            <p className="mt-0.5 truncate text-[12px] ink-muted"><bdi dir="ltr">/{vendor.slug}</bdi></p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><StoreStatusPill status={vendor.status} /></td>
                      <td className="px-4 py-3 text-[#0a285a]">{shelf(vendor)}</td>
                      <td className="hidden px-4 py-3 text-[#536b8c] lg:table-cell">{team(vendor)}</td>
                      <td className="px-4 py-3 text-end font-semibold tabular-nums"><bdi dir="ltr">{commission(vendor)}</bdi></td>
                      <td className="hidden px-4 py-3 xl:table-cell">{details(vendor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {vendors.data ? <Pager page={vendors.data} onPage={setPage} /> : null}
          </>
        )}
      </div>
    </>
  );
}
