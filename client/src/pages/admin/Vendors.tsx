/**
 * The vendor list, admin only.
 *
 * A list, and only a list. Every card used to carry the status dropdown, the
 * commission box, its Save button and four badge toggles, so twenty stores
 * meant a wall of controls and no way to see the stores themselves — which is
 * the first question this page is asked. Editing one store now happens on that
 * store's own page.
 *
 * Commission still lives nowhere a vendor can reach, which the requirements
 * are explicit about. The server refuses a vendor regardless of what any of
 * this renders — these are the surfaces, not the enforcement.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import type { MessageKey } from "@shared/i18n/dictionary";
import { visibleBadges } from "@shared/inventory/vendorHealth";
import { missingStoreDetails } from "@shared/inventory/storeProfile";
import { ArrowRight, Plus } from "lucide-react";
import { Link } from "wouter";

export default function AdminVendors() {
  usePageMeta(privatePageMeta("Vendors"));
  return <AdminShell need={"platform.viewAll"}>{() => <VendorList />}</AdminShell>;
}

const STATUS_TONE: Record<string, string> = {
  approved: "bg-[#d4edda] text-[#155724]",
  pending: "bg-[#fff3cd] text-[#8a6d3b]",
  suspended: "bg-[#fdeceb] text-[#8c2f22]",
};

function VendorList() {
  const { t } = useTranslation();
  const vendors = trpc.inventory.vendors.list.useQuery();

  if (vendors.isLoading) return <p className="text-sm text-[#536b8c]">{t("admin.loading")}</p>;
  const rows = vendors.data ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-extrabold">{t("admin.vendors")}</h1>
        <Link
          href="/admin/vendors/new"
          className="glass glass-navy pressable inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-extrabold"
        >
          <Plus className="size-4" />{t("admin.newStore")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t("admin.noVendors")}</p>
          <Link
            href="/admin/vendors/new"
            className="glass glass-navy pressable mt-4 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-extrabold"
          >
            <Plus className="size-4" />{t("admin.newStore")}
          </Link>
        </div>
      ) : (
        <div className="mt-5 space-y-2">
          {rows.map(vendor => {
            const missing = missingStoreDetails(vendor).length;
            const badges = visibleBadges(vendor.badges);
            return (
              <Link
                key={vendor.id}
                href={`/admin/vendors/${vendor.id}`}
                className="pressable flex items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-4 hover:border-[#0a285a]/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p dir="auto" className="truncate font-bold text-[#0a285a]">{vendor.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${STATUS_TONE[vendor.status] ?? ""}`}>
                      {t(`vendorStatus.${vendor.status}` as MessageKey)}
                    </span>
                    {badges.map(badge => (
                      <span key={badge} className="rounded-full bg-[#eaf1fb] px-2 py-0.5 text-[10px] font-extrabold text-[#0a285a]">
                        {t(`badge.${badge}` as MessageKey)}
                      </span>
                    ))}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-[#9ea4b5]">
                    <span dir="ltr">/{vendor.slug}</span>
                    {" · "}
                    <span dir="ltr">{vendor.commissionPercent}%</span>
                    {missing > 0 ? (
                      <>
                        {" · "}
                        <span className="font-bold text-[#8a6d3b]">
                          {t(missing === 1 ? "admin.incomplete" : "admin.incompletePlural", { count: missing })}
                        </span>
                      </>
                    ) : null}
                  </p>
                </div>
                <ArrowRight className="size-4 shrink-0 text-[#9ea4b5] rtl:-scale-x-100" />
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
