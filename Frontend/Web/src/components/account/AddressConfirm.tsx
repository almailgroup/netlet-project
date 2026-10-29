/**
 * "Is this your address?" — the address shown back before it is kept, on the
 * owner's word, with "Yes, save address" and "Edit address".
 *
 * A new address, and one moved (`whereChanged`), is where a driver will go, so
 * it is read back whole: the pin on a still map, the area and governorate,
 * the block, street, avenue, house, floor and flat in the order a driver reads
 * them, who the driver calls, and the notes. Edit address goes back to the
 * form as it was left; Escape and a press outside are the same answer, since
 * neither keeps anything.
 *
 * A sheet from the foot of a phone's screen and a card from `sm`, portalled to
 * `<body>` like every dialog the address book opens over, so the delivery
 * dialog's own box cannot become its containing block. Focus goes to the
 * heading, so a screen reader reads the question and the address under it
 * before any button.
 */
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, MapPin, Phone, StickyNote } from "lucide-react";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { StillMap } from "@/components/map/PinPicker";
import type { ShippingAddress } from "@shared/commerce/addresses";
import { areaLabel, composeAddressLine, hasParts } from "@shared/commerce/kuwaitAddress";
import { kuwaitDeliveryZones } from "@shared/customer";
import { storedPin } from "@shared/commerce/geo";

export function AddressConfirm({ open, address, pending, onConfirm, onEdit }: {
  open: boolean;
  address: ShippingAddress;
  pending: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  const { t, isArabic } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  useOverlay(open, () => { if (!pending) onEdit(); });
  useEffect(() => {
    if (open) window.setTimeout(() => heading.current?.focus(), 40);
  }, [open]);

  if (!open) return null;

  const pin = address.pin ? storedPin(address.pin) : null;
  const zone = kuwaitDeliveryZones.find(entry => entry.id === address.governorate);
  const zoneName = zone ? (isArabic ? zone.labelAr : zone.label) : "";
  const parts = address.parts ?? {};
  const area = hasParts(parts) ? areaLabel(parts.area, isArabic) : "";
  const where = [area, zoneName].filter(Boolean).join(isArabic ? "، " : ", ");
  const rest = hasParts(parts) ? composeAddressLine({ ...parts, area: null }, isArabic) : (address.addressLine ?? "").trim();
  const contact = [address.contactName?.trim(), address.contactPhone?.trim()].filter(Boolean);
  const notes = address.addressNotes?.trim();

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end bg-[#061b3b]/50 sm:items-center sm:justify-center sm:p-4" onClick={() => { if (!pending) onEdit(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={event => event.stopPropagation()}
        className="address-confirm max-h-[92svh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(10,40,90,.22)] sm:max-w-[440px] sm:rounded-3xl sm:pb-5 sm:shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d5dfeb] sm:hidden" />
        <h2 ref={heading} id={titleId} tabIndex={-1} className="text-[20px] font-extrabold text-[#0a285a] outline-none">
          {t("address.confirmTitle")}
        </h2>
        <p className="mt-1 text-[13px] leading-5 ink-muted">{t("address.confirmBody")}</p>

        <div id={bodyId} className="mt-4">
          {pin ? (
            <StillMap pin={pin} className="h-[150px]" />
          ) : (
            <p className="rounded-2xl bg-[#f3f5f9] px-4 py-3 text-[12px] leading-5 text-[#536b8c]">{t("address.confirmNoPin")}</p>
          )}

          <div className="mt-3 rounded-2xl border border-[#e6e9ef] p-4">
            <div className="flex items-start gap-3">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-[#fdeee7]">
                <MapPin className="size-4 ink-accent" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <bdi className="text-[15px] font-extrabold text-[#0a285a]">{address.label.trim()}</bdi>
                  {where ? <span className="rounded-full bg-[#eef2f8] px-2 py-0.5 text-[12px] font-bold text-[#0a285a]">{where}</span> : null}
                </p>
                {rest ? <p className="mt-1 text-[14px] leading-6 text-[#1d2b45]"><bdi>{rest}</bdi></p> : null}
              </div>
            </div>
            {contact.length ? (
              <p className="mt-3 flex items-center gap-2 border-t border-dashed border-[#e6e9ef] pt-3 text-[13px] text-[#1d2b45]">
                <Phone className="size-4 shrink-0 text-[#536b8c]" aria-hidden />
                <span>
                  <span className="ink-muted">{t("address.confirmCall")} </span>
                  {contact.map((value, index) => (
                    <span key={value}>
                      {index ? " · " : ""}
                      <bdi dir={index === 1 ? "ltr" : undefined} className="font-semibold">{value}</bdi>
                    </span>
                  ))}
                </span>
              </p>
            ) : null}
            {notes ? (
              <p className="mt-3 flex items-start gap-2 border-t border-dashed border-[#e6e9ef] pt-3 text-[13px] text-[#1d2b45]">
                <StickyNote className="mt-0.5 size-4 shrink-0 text-[#536b8c]" aria-hidden />
                <bdi className="min-w-0 break-words">{notes}</bdi>
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="pressable inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0a285a] text-sm font-extrabold text-white transition hover:bg-[#0d3372] disabled:opacity-60"
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t("address.confirmYes")}
          </button>
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            className="glass pressable inline-flex h-12 items-center justify-center rounded-xl border border-[#d5dfeb] text-sm font-extrabold text-[#0a285a] disabled:opacity-60"
          >
            {t("address.confirmEdit")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
