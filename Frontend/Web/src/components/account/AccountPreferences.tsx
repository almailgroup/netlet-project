/**
 * The three settings a shopper actually changes, in one place.
 *
 * Language is here because it is a *stored* preference — it follows the
 * account between devices — and the only way to change it used to be the
 * toggle in the header, which reads as a view control rather than a setting.
 * An account page that manages notifications and delivery but not the
 * language the site speaks to you in is missing the one people look for.
 */
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import {
  defaultNotificationPreferences,
  kuwaitDeliveryZones,
  notificationKinds,
  notificationLabelKeys,
  type NotificationKind,
} from "@shared/customer";
import { SettingPanel } from "@/components/ui/SettingPanel";
import { Bell, Globe, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Select } from "@/components/ui/Select";

export function AccountPreferences() {
  const { t, isArabic, locale } = useTranslation();
  const { deliveryZone, deliveryZoneId, setDeliveryZoneId, setLocale } = useCustomer();
  const zoneName = (zone: { label: string; labelAr: string }) => (isArabic ? zone.labelAr : zone.label);

  const notifications = trpc.customer.notifications.list.useQuery();
  const setNotification = trpc.customer.notifications.set.useMutation({
    onSuccess: () => notifications.refetch(),
    onError: () => toast.error(t("account.preferenceFailed")),
  });
  const stored = new Map((notifications.data ?? []).map(item => [item.kind as NotificationKind, item.enabled]));

  return (
    <div className="space-y-4">
      <SettingPanel icon={<Globe className="size-5" />} title={t("account.language")} note={t("account.languageNote")}>
        {/* Two buttons rather than a select: there are exactly two, and each
            is written in its own language so it is legible to whoever needs
            it, not only to whoever can already read the current one. */}
        <div role="group" aria-label={t("account.language")} className="mt-3 inline-flex gap-1 rounded-2xl bg-[#eef1f6] p-1">
          {(["en", "ar"] as const).map(code => {
            const active = locale === code;
            return (
              <button
                key={code}
                type="button"
                aria-pressed={active}
                onClick={() => setLocale(code)}
                className={`rounded-xl px-4 py-2 text-[13px] font-extrabold transition ${
                  active ? "bg-white text-[#0a285a] shadow-[0_1px_3px_rgba(10,40,90,.12)]" : "ink-muted hover:text-[#0a285a]"
                }`}
              >
                {t(code === "en" ? "account.english" : "account.arabic")}
              </button>
            );
          })}
        </div>
      </SettingPanel>

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

      <SettingPanel icon={<Bell className="size-5" />} title={t("account.notifications")} note={t("account.notificationsNote")}>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {notificationKinds.map(kind => {
            const enabled = stored.get(kind) ?? defaultNotificationPreferences[kind];
            return (
              <label
                key={kind}
                className="tint-on-hover flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[#d5dfeb] bg-[#f3f2ed] px-4 py-3 text-sm font-bold text-[#0a285a]"
              >
                <span>{t(notificationLabelKeys[kind])}</span>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={setNotification.isPending}
                  onChange={event => setNotification.mutate({ kind, enabled: event.target.checked })}
                  className="size-4 accent-[#f2683a]"
                />
              </label>
            );
          })}
        </div>
      </SettingPanel>
    </div>
  );
}
