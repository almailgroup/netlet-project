/**
 * The vendor list, admin only.
 *
 * Commission lives here and nowhere a vendor can reach, which the requirements
 * are explicit about. The server refuses a vendor regardless of what this page
 * renders — this is the surface, not the enforcement.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import type { MessageKey } from "@shared/i18n/dictionary";
import { TRUST_BADGES, visibleBadges, type TrustBadge } from "@shared/inventory/vendorHealth";
import { useState } from "react";
import { toast } from "sonner";

const STATUSES = ["pending", "approved", "suspended"] as const;

export default function AdminVendors() {
  usePageMeta(privatePageMeta("Vendors"));
  return <AdminShell need={"platform.viewAll"}>{() => <VendorList />}</AdminShell>;
}

function VendorList() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const vendors = trpc.inventory.vendors.list.useQuery();
  const [rates, setRates] = useState<Record<number, string>>({});

  const done = () => { void utils.inventory.vendors.list.invalidate(); toast.success(t("admin.saved")); };
  const fail = () => toast.error(t("admin.forbidden"));
  const setCommission = trpc.inventory.vendors.setCommission.useMutation({ onSuccess: done, onError: fail });
  const setStatus = trpc.inventory.vendors.setStatus.useMutation({ onSuccess: done, onError: fail });
  const setBadges = trpc.inventory.vendors.setBadges.useMutation({ onSuccess: done, onError: fail });

  /* A badge toggles on click and saves immediately. There is no Save here on
     purpose: a checkbox that needs a second press to mean anything is how a
     badge ends up awarded in the UI and not in the database. */
  const toggleBadge = (vendorId: number, held: TrustBadge[], badge: TrustBadge) =>
    setBadges.mutate({
      vendorId,
      badges: held.includes(badge) ? held.filter(one => one !== badge) : [...held, badge],
    });

  if (vendors.isLoading) return <p className="text-sm text-[#536b8c]">{t("admin.loading")}</p>;
  const rows = vendors.data ?? [];

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.vendors")}</h1>
      {rows.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t("admin.noVendors")}</p>
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
                  {t("admin.vendorStatus")}
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
                  {t("admin.commissionPercent")}
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
                  {t("admin.save")}
                </button>
                {vendor.autoPublish ? (
                  <span className="ms-auto rounded-full bg-[#d4edda] px-2.5 py-1 text-[10px] font-extrabold text-[#155724]">
                    {t("admin.autoPublish")}
                  </span>
                ) : null}
              </div>

              <BadgeRow
                held={visibleBadges(vendor.badges)}
                busy={setBadges.isPending}
                onToggle={badge => toggleBadge(vendor.id, visibleBadges(vendor.badges), badge)}
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The awarded badges, as toggles.
 *
 * Every badge is shown, held or not, so an admin can see what is available to
 * award rather than only what has been. `earnedBadges` computes the other
 * three from a vendor's numbers; these are the awarded copy of record, which
 * is what a shopper is shown.
 */
function BadgeRow({
  held,
  busy,
  onToggle,
}: {
  held: TrustBadge[];
  busy: boolean;
  onToggle: (badge: TrustBadge) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 border-t border-[#e6e9ef] pt-3">
      <p className="text-[11px] font-extrabold text-[#0a285a]">{t("admin.badges")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {TRUST_BADGES.map(badge => {
          const on = held.includes(badge);
          return (
            <button
              key={badge}
              type="button"
              aria-pressed={on}
              disabled={busy}
              onClick={() => onToggle(badge)}
              className={`pressable rounded-full px-3 py-1.5 text-[11px] font-extrabold transition disabled:opacity-60 ${
                on
                  ? "bg-[#0a285a] text-white"
                  : "border border-[#d5dfeb] bg-white text-[#536b8c] hover:border-[#0a285a]"
              }`}
            >
              {t(`badge.${badge}` as MessageKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
