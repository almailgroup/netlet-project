/**
 * A store's logo (or its initials when it has none or the address fails) and
 * its status — the two marks every store row and the store's own page carry.
 *
 * Every store row used to be a name and nothing else, so a list of twenty read
 * as one block of text. The logo is a URL an administrator typed, so failing is
 * ordinary: `Thumb` swaps to the initials rather than a broken-image glyph.
 */
import { Thumb } from "@/components/product/Thumb";
import { useTranslation } from "@/hooks/useTranslation";
import type { MessageKey } from "@shared/i18n/dictionary";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => Array.from(word)[0] ?? "")
    .join("")
    .toUpperCase();

export function StoreAvatar({ name, logoUrl, size = "md" }: { name: string; logoUrl?: string | null; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-16 rounded-2xl text-[20px]" : "size-11 rounded-xl text-[14px]";
  return (
    <div className={`${box} shrink-0 overflow-hidden border border-[#e1e7ef] bg-white`}>
      <Thumb
        src={logoUrl || undefined}
        alt=""
        className="size-full object-contain p-1"
        fallbackClassName="bg-[#e7edf5] text-[#0a285a]"
        icon={<span aria-hidden className="font-bold">{initials(name)}</span>}
      />
    </div>
  );
}

const STORE_STATUS_TONE: Record<string, string> = {
  approved: "bg-[#d4edda] text-[#155724]",
  pending: "bg-[#fff3cd] text-[#6b4f1d]",
  suspended: "bg-[#fdeceb] text-[#8c2f22]",
};

export function StoreStatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold ${STORE_STATUS_TONE[status] ?? ""}`}>
      {t(`vendorStatus.${status}` as MessageKey)}
    </span>
  );
}

