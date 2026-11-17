/**
 * Product views: how many people opened the store's product pages, in the app
 * or on the website, where they came from, and what they ordered
 * (`components/admin/ProductViews.tsx` draws it, `inventory.views` reads it).
 * A store's people read their own store's; an administrator any store's, or
 * every store's together.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { RangeControl, useViewRange, ViewsReportView } from "@/components/admin/ProductViews";
import { fieldClass, PageHeader, SkeletonCards } from "@/components/admin/ui";
import { Select } from "@/components/ui/Select";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { privatePageMeta } from "@shared/seo";
import { trpc } from "@/lib/trpc";
import type { Actor } from "@shared/inventory/permissions";
import { useState } from "react";
import { failedToLoad } from "@/lib/queryState";

export default function AdminViews() {
  usePageMeta(privatePageMeta("Product views"));
  return <AdminShell need="product.view">{actor => <Views actor={actor} />}</AdminShell>;
}

function Views({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const [range, setRange] = useViewRange();
  const admin = actor.kind === "admin";
  const [store, setStore] = useState("");
  const stores = trpc.inventory.vendors.list.useQuery({ pageSize: 200 }, { enabled: admin });
  const report = trpc.inventory.views.useQuery(
    { range, vendorId: admin && store ? Number(store) : undefined },
    { placeholderData: previous => previous },
  );

  const controls = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {admin && (stores.data?.rows.length ?? 0) > 1 ? (
        <Select value={store} onChange={event => setStore(event.target.value)} aria-label={t("admin.filterStore")} className={`${fieldClass} sm:w-56`}>
          <option value="">{t("admin.statusAllStores")}</option>
          {(stores.data?.rows ?? []).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </Select>
      ) : null}
      <RangeControl range={range} onChange={setRange} />
    </div>
  );

  return (
    <>
      <PageHeader title={t("views.title")} description={t("views.intro")} actions={controls} />
      {report.data ? (
        <div className={`transition-opacity ${report.isFetching && report.isPlaceholderData ? "opacity-60" : ""}`}>
          <ViewsReportView report={report.data} />
        </div>
      ) : failedToLoad(report) ? (
        <QueryGate queries={[report]}>{() => null}</QueryGate>
      ) : (
        <SkeletonCards count={4} label={t("admin.loading")} />
      )}
    </>
  );
}
