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
 */
import { useCustomer } from "@/contexts/CustomerContext";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { kuwaitDeliveryZones } from "@shared/customer";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

export function DeliveryZoneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { deliveryZoneId, setDeliveryZoneId } = useCustomer();
  const { isArabic, t } = useTranslation();
  useOverlay(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end bg-[#061b3b]/35 p-3 backdrop-blur-[2px] sm:items-center sm:justify-center" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="delivery-zone-title" className="w-full max-w-lg rounded-[1.5rem] bg-background p-5 shadow-2xl sm:p-7" onClick={event => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold tracking-[.14em] text-[#a44a2b] uppercase">{t("delivery.kuwait")}</p>
            <h2 id="delivery-zone-title" className="display-face mt-1 text-3xl text-[#0a285a]">{t("delivery.chooseGovernorate")}</h2>
            <p className="mt-2 text-sm leading-6 text-[#536b8c]">{t("delivery.note")}</p>
          </div>
          <button onClick={onClose} aria-label={t("delivery.close")} title={t("delivery.close")} className="glass pressable grid size-10 shrink-0 place-items-center rounded-full">
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
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
