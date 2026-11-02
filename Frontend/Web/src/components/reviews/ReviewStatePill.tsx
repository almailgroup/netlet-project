/**
 * Where a shopper's own review stands — on the product page, waiting for its
 * quick check, or taken down — said beside it on the account and in an
 * opened order, in the same words in both.
 */
import { CircleCheck, Clock, EyeOff } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import type { ReviewState } from "@shared/commerce/reviews";

const LOOK = {
  published: { label: "review.statePublished", className: "bg-[#d8ead8] text-[#2f5d33]", icon: CircleCheck },
  waiting: { label: "review.stateWaiting", className: "bg-[#fdf1d6] text-[#7a5200]", icon: Clock },
  removed: { label: "review.stateRemoved", className: "bg-[#e7edf5] text-[#3d5170]", icon: EyeOff },
} as const;

export function ReviewStatePill({ state }: { state: ReviewState }) {
  const { t } = useTranslation();
  const look = LOOK[state];
  const Icon = look.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold ${look.className}`}>
      <Icon className="size-3.5" aria-hidden />
      {t(look.label)}
    </span>
  );
}
