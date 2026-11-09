/**
 * The delivery area, what NetLet tells a shopper, and what the shop keeps on
 * this device.
 *
 * **What NetLet tells a shopper is five groups, as a shop's settings are, on
 * the owner's word** (`Shared/commerce/noticeCategories.ts`): orders and
 * delivery, deals, personalised offers, recommendations, and account and
 * security. Each switch is one of the four the account already keeps, and
 * what no switch silences — an order's confirmation, a refund, a changed
 * password — is said beside it as always on.
 *
 * **The language and the currency are on My Profile itself now, on the
 * owner's word** ("clearly visible and directly accessible from the My
 * Profile page, rather than being hidden inside the Preferences section"),
 * with the country, in `QuickSettings`. They had moved in here from two rows
 * of their own; the third answer is a card at the top of the page.
 */
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import {
  defaultNotificationPreferences,
  kuwaitDeliveryZones,
  type NotificationKind,
} from "@shared/customer";
import { NOTICE_CATEGORIES } from "@shared/commerce/noticeCategories";
import { SettingPanel } from "@/components/ui/SettingPanel";
import { StoragePanel } from "@/components/account/StoragePanel";
import { HapticsPanel } from "@/components/account/HapticsPanel";
import { Bell, MapPin, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Select } from "@/components/ui/Select";

export function AccountPreferences() {
  const { t, isArabic } = useTranslation();
  const { deliveryZone, deliveryZoneId, setDeliveryZoneId } = useCustomer();
  const zoneName = (zone: { label: string; labelAr: string }) => (isArabic ? zone.labelAr : zone.label);

  const notifications = trpc.customer.notifications.list.useQuery();
  const setNotification = trpc.customer.notifications.set.useMutation({
    onSuccess: () => notifications.refetch(),
    onError: () => toast.error(t("account.preferenceFailed")),
  });
  const stored = new Map((notifications.data ?? []).map(item => [item.kind as NotificationKind, item.enabled]));

  return (
    <div className="space-y-4">
      <SettingPanel icon={<MapPin className="size-5" />} title={t("account.deliveryArea")} note={t("account.pricingUnconfigured")}>
        <p className="mt-1 text-sm ink-muted">
          {deliveryZone ? t("account.zoneSelected", { name: zoneName(deliveryZone) }) : t("account.chooseZone")}
        </p>
        <label className="mt-3 block">
          <span className="text-[12px] font-extrabold text-[#0a285a]">{t("delivery.governorate")}</span>
          {/* The wrapping <label> would otherwise give this a name made of
              every governorate in the list. */}
          <Select
            aria-label={t("delivery.governorate")}
            value={deliveryZoneId ?? ""}
            onChange={event => setDeliveryZoneId(event.target.value)}
            className="type-body mt-1.5 h-11 w-full max-w-xs rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a] focus:ring-2 focus:ring-[#f2683a]/25"
          >
            <option value="" disabled>{t("delivery.selectGovernorate")}</option>
            {kuwaitDeliveryZones.map(zone => (
              <option key={zone.id} value={zone.id}>{zoneName(zone)}</option>
            ))}
          </Select>
        </label>
      </SettingPanel>

      <SettingPanel icon={<Bell className="size-5" />} title={t("notify.title")} note={t("notify.intro")}>
        <ul className="space-y-2" aria-label={t("notify.title")}>
          {NOTICE_CATEGORIES.map(category => {
            const enabled = category.preference ? stored.get(category.preference) ?? defaultNotificationPreferences[category.preference] : true;
            const id = `notify-${category.id}`;
            return (
              <li key={category.id} className="rounded-xl border border-[#d5dfeb] bg-[#f8f9fc] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <label htmlFor={category.preference ? id : undefined} className="block text-sm font-bold text-[#0a285a]">{t(category.title)}</label>
                    <p id={`${id}-body`} className="mt-0.5 text-[12px] leading-5 ink-muted">{t(category.body)}</p>
                  </div>
                  {category.preference ? (
                    <input
                      id={id}
                      type="checkbox"
                      role="switch"
                      checked={enabled}
                      aria-describedby={`${id}-body`}
                      disabled={setNotification.isPending}
                      onChange={event => setNotification.mutate({ kind: category.preference!, enabled: event.target.checked })}
                      className="mt-1 size-5 shrink-0 accent-[#0a285a]"
                    />
                  ) : (
                    <span className="mt-0.5 shrink-0 rounded-full bg-[#e9f4ee] px-2.5 py-0.5 text-[12px] font-bold text-[#1f5e3a]">{t("notify.alwaysOn")}</span>
                  )}
                </div>
                {category.alwaysNote && category.preference ? (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-5 text-[#1f5e3a]"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t(category.alwaysNote)}</p>
                ) : category.alwaysNote ? (
                  <p className="mt-2 text-[12px] leading-5 ink-muted">{t(category.alwaysNote)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </SettingPanel>

      <HapticsPanel />

      <StoragePanel />
    </div>
  );
}
