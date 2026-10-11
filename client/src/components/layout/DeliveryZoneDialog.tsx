/**
 * Choosing the governorate the shop delivers to.
 *
 * It lived inside `Home.tsx`, because the area could only be set from the home
 * page's own header. Every shopping page carries the area now — delivery is
 * priced per seller and soon per governorate, so a shopper on a product page
 * needs to see and change it there — and this is the one dialog all of them
 * open.
 *
 * **Portalled to `<body>`.** The header that opens it carries
 * `backdrop-filter`, which makes it the containing block for every
 * `position: fixed` descendant: rendered inside the bar, `inset-0` resolved
 * against a 120px header and the dialog hung off the top of the screen. The
 * search sheets learned the same lesson; this is the second user of the fix.
 *
 * **A signed-in shopper's own addresses come first.** "Home, Hawalli" is the
 * answer they would give, and picking one also makes it the address checkout
 * starts from — the same memory checkout keeps (`lib/lastAddress`). An address
 * that names no governorate is left out, since it cannot answer the question.
 */
import { useCustomer } from "@/contexts/CustomerContext";
import { useAuth } from "@/hooks/useAuth";
import { rememberAddress } from "@/lib/lastAddress";
import { trpc } from "@/lib/trpc";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { kuwaitDeliveryZones } from "@shared/customer";
import { House, X } from "lucide-react";
import { createPortal } from "react-dom";

export function DeliveryZoneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { deliveryZoneId, setDeliveryZoneId } = useCustomer();
  const { isArabic, t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const book = trpc.customer.addresses.list.useQuery(undefined, { enabled: open && isAuthenticated, staleTime: 5 * 60 * 1000 });
  useOverlay(open, onClose);
  if (!open) return null;
  const zoneName = (id: string) => {
    const zone = kuwaitDeliveryZones.find(entry => entry.id === id);
    return zone ? (isArabic ? zone.labelAr : zone.label) : null;
  };
  const addresses = (isAuthenticated ? book.data ?? [] : []).filter(address => address.governorate && zoneName(address.governorate));
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end bg-[#061b3b]/35 p-3 sm:items-center sm:justify-center" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="delivery-zone-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.5rem] bg-background p-5 shadow-2xl sm:p-7" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="delivery-zone-title" className="text-xl font-extrabold text-[#0a285a]">{t("delivery.chooseGovernorate")}</h2>
            <p className="mt-2 text-sm leading-6 text-[#536b8c]">{t("delivery.note")}</p>
          </div>
          <button onClick={onClose} aria-label={t("delivery.close")} title={t("delivery.close")} className="glass pressable grid size-10 shrink-0 place-items-center rounded-full">
            <X className="size-5" />
          </button>
        </div>
        {addresses.length ? (
          <>
            <h3 className="mt-6 text-[13px] font-bold ink-muted">{t("delivery.yourAddresses")}</h3>
            <div className="mt-2 grid gap-2">
              {addresses.map(address => (
                <button
                  key={address.id}
                  onClick={() => { setDeliveryZoneId(address.governorate!); rememberAddress(address.id); onClose(); }}
                  className="pressable flex items-center gap-3 rounded-2xl border border-[#d5dfeb] bg-white p-4 text-start hover:border-[#aac0da]"
                >
                  <House className="size-4 shrink-0 ink-accent" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-sm font-extrabold text-[#0a285a]">{address.label}</span>
                    <span dir="auto" className="block truncate text-xs ink-muted">{zoneName(address.governorate!)} · {address.addressLine}</span>
                  </span>
                </button>
              ))}
            </div>
            <h3 className="mt-5 text-[13px] font-bold ink-muted">{t("delivery.orGovernorate")}</h3>
          </>
        ) : null}
        <div className={`${addresses.length ? "mt-2" : "mt-6"} grid gap-2 sm:grid-cols-2`}>
          {kuwaitDeliveryZones.map(zone => (
            <button
              key={zone.id}
              onClick={() => { setDeliveryZoneId(zone.id); onClose(); }}
              aria-pressed={deliveryZoneId === zone.id}
              className={`pressable rounded-2xl border p-4 text-start ${deliveryZoneId === zone.id ? "border-[#f2683a] bg-[#fff7e3]" : "border-[#d5dfeb] bg-white hover:border-[#aac0da]"}`}
            >
              <span className="block text-sm font-extrabold text-[#0a285a]">{isArabic ? zone.labelAr : zone.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}
