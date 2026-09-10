/**
 * The vendor list, admin only.
 *
 * Commission lives here and nowhere a vendor can reach, which the requirements
 * are explicit about. The server refuses a vendor regardless of what this page
 * renders — this is the surface, not the enforcement.
 */
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useState } from "react";
import { toast } from "sonner";

const STATUSES = ["pending", "approved", "suspended"] as const;

export default function DashboardVendors() {
  usePageMeta(privatePageMeta("Vendors"));
  return <DashboardShell need={"platform.viewAll"}>{() => <VendorList />}</DashboardShell>;
}

function VendorList() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const vendors = trpc.inventory.vendors.list.useQuery();
  const [rates, setRates] = useState<Record<number, string>>({});

  const done = () => { void utils.inventory.vendors.list.invalidate(); toast.success(t("dash.saved")); };
  const fail = () => toast.error(t("dash.forbidden"));
  const setCommission = trpc.inventory.vendors.setCommission.useMutation({ onSuccess: done, onError: fail });
  const setStatus = trpc.inventory.vendors.setStatus.useMutation({ onSuccess: done, onError: fail });

  if (vendors.isLoading) return <p className="text-sm text-[#536b8c]">{t("dash.loading")}</p>;
  const rows = vendors.data ?? [];

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("dash.vendors")}</h1>
      {rows.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t("dash.noVendors")}</p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {rows.map(vendor => (
            <article key={vendor.id} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p dir="auto" className="font-bold text-[#0a285a]">{vendor.name}</p>
                  <p className="mt-0.5 text-[11px] text-[#9ea4b5]">/{vendor.slug}</p>
                </div>
                <label className="text-[11px] font-extrabold text-[#0a285a]">
                  {t("dash.vendorStatus")}
                  <select
                    value={vendor.status}
                    onChange={event => setStatus.mutate({ vendorId: vendor.id, status: event.target.value as (typeof STATUSES)[number] })}
                    className="type-body ms-2 h-9 rounded-xl border border-[#d5dfeb] bg-white px-2.5 text-[12px] outline-none focus:border-[#f2683a]"
                  >
                    {STATUSES.map(status => (
                      <option key={status} value={status}>{t(`vendorStatus.${status}` as MessageKey)}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[#e6e9ef] pt-3">
                <label className="text-[11px] font-extrabold text-[#0a285a]">
                  {t("dash.commissionPercent")}
                  <input
                    dir="ltr"
                    inputMode="decimal"
                    value={rates[vendor.id] ?? vendor.commissionPercent}
                    onChange={event => setRates({ ...rates, [vendor.id]: event.target.value })}
                    className="type-body ms-2 h-9 w-24 rounded-xl border border-[#d5dfeb] bg-white px-2.5 text-[12px] outline-none focus:border-[#f2683a]"
                  />
                </label>
                <button
                  onClick={() => setCommission.mutate({ vendorId: vendor.id, percent: rates[vendor.id] ?? vendor.commissionPercent })}
                  disabled={setCommission.isPending}
                  className="glass glass-navy pressable h-9 rounded-full px-4 text-[11px] font-extrabold disabled:opacity-60"
                >
                  {t("dash.save")}
                </button>
                {vendor.autoPublish ? (
                  <span className="ms-auto rounded-full bg-[#d4edda] px-2.5 py-1 text-[10px] font-extrabold text-[#155724]">
                    {t("dash.autoPublish")}
                  </span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
