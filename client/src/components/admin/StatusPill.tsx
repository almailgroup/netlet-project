/** A product's status, in the colour that matches what it means. */
import { useTranslation } from "@/hooks/useTranslation";
import type { MessageKey } from "@shared/i18n/dictionary";

const TONE: Record<string, string> = {
  draft: "bg-[#e7edf5] text-[#536b8c]",
  pending_review: "bg-[#fff0ab] text-[#705523]",
  published: "bg-[#d4edda] text-[#155724]",
  rejected: "bg-[#fdeceb] text-[#8c2f22]",
  archived: "bg-[#e7edf5] ink-muted",
};

export function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold ${TONE[status] ?? TONE.draft}`}>
      {t(`status.${status}` as MessageKey)}
    </span>
  );
}
