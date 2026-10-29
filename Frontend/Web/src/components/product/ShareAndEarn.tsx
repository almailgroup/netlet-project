/**
 * "Share and earn points", under a product's buy buttons — for a member of
 * the affiliate programme only (3.7), on the owner's word: the product page is
 * where somebody decides a thing is worth telling a friend about, and the one
 * place a member's link is made. The same Share as the photo's, carrying
 * their code.
 */
import { Share2 } from "lucide-react";
import { PointsCoin } from "@/components/ui/PointsCoin";
import { useTranslation } from "@/hooks/useTranslation";

export function ShareAndEarn({ onShare }: { onShare: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#f4d7c4] bg-[#fff7f1] p-3.5">
      <PointsCoin size={34} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-[#0a285a]">{t("affiliate.shareAndEarn")}</p>
        <p className="text-[12px] leading-5 text-[#536b8c]">{t("affiliate.shareAndEarnHint")}</p>
      </div>
      <button type="button" onClick={onShare} className="glass-navy type-control pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4">
        <Share2 className="size-4" aria-hidden />{t("affiliate.share")}
      </button>
    </div>
  );
}
