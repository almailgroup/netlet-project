/**
 * "Open the pin in Maps" — for whoever has to find the door (3.2.7).
 *
 * Drawn only when there is a pin; an address without one is ordinary, and a
 * link reading "no pin" is a control that changes nothing. An anchor, so it
 * opens in a new tab, copies, and long-presses like any other link.
 */
import { MapPin } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { mapsLink, type Pin } from "@shared/commerce/geo";

export function PinLink({ pin }: { pin: Pin | null | undefined }) {
  const { t } = useTranslation();
  if (!pin) return null;
  return (
    <a
      href={mapsLink(pin)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[12px] font-extrabold ink-accent underline underline-offset-2"
    >
      <MapPin className="size-3.5" aria-hidden />
      {t("pin.openInMaps")}
    </a>
  );
}
