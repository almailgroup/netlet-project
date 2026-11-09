/**
 * Rating the things you actually received, on `/account`.
 *
 * **Every delivered line is listed, including the ones that cannot be
 * reviewed, with the reason attached.** A list that quietly omits what
 * somebody is looking for teaches them the feature is broken — "you can
 * review this once it has been delivered" is an answer, and a page that has
 * silently dropped their kettle is not. That is the same argument `QueryGate`
 * makes about an empty table reading as a working one.
 *
 * The eligibility that decides which rows get a button is `eligibilityFor`
 * from `Shared/`, the same function the server refuses with, sent resolved.
 * A review already written says where it stands — on the product page,
 * waiting for its quick check, or taken down — because "I wrote one, where is
 * it?" is the question this page exists to answer. Writing and changing one
 * is `ReviewDialog`, the one My orders opens too.
 */
import { useState } from "react";
import { PackageSearch } from "lucide-react";
import { QueryGate } from "@/components/admin/QueryGate";
import { StarRow } from "@/components/product/ProductReviews";
import { ReviewDialog, type MyReview, type ReviewTarget } from "@/components/reviews/ReviewDialog";
import { ReviewStatePill } from "@/components/reviews/ReviewStatePill";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import type { MessageKey } from "@shared/i18n/dictionary";

type Line = {
  orderItemId: number;
  orderReference: string;
  productTitle: string;
  variantTitle: string | null;
  deliveredAt: string | null;
  review: MyReview | null;
  eligibility: { allowed: true } | { allowed: false; reason: string };
};

export function AccountReviews() {
  const { t } = useTranslation();
  const lines = trpc.reviews.mine.useQuery();
  const [writing, setWriting] = useState<ReviewTarget | null>(null);

  return (
    <QueryGate audience="shopper" queries={[lines]}>
      {() => {
        const rows = (lines.data ?? []) as Line[];
        if (rows.length === 0) {
          return (
            <div className="rounded-[1.35rem] border border-dashed border-[#c3ccda] bg-[#fbfaf6] p-6 text-center">
              <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-[#e7edf5]">
                <PackageSearch className="size-5 text-[#0a285a]" aria-hidden />
              </div>
              <p className="mt-3 text-sm font-extrabold text-[#0a285a]">{t("review.nothingToReview")}</p>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 ink-muted">{t("review.nothingToReviewNote")}</p>
            </div>
          );
        }

        return (
          <>
            <ul className="space-y-3">
              {rows.map(line => {
                const canWrite = line.eligibility.allowed;
                return (
                  <li key={line.orderItemId} className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p dir="auto" className="text-sm font-extrabold text-[#0a285a]">{line.productTitle}</p>
                        <p className="mt-0.5 text-xs ink-muted"><bdi dir="ltr">{line.orderReference}</bdi></p>
                        {line.review ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <StarRow value={line.review.rating} />
                            <ReviewStatePill state={line.review.state} />
                          </div>
                        ) : null}
                      </div>

                      {canWrite || line.review ? (
                        <button
                          type="button"
                          onClick={() => setWriting({ orderItemId: line.orderItemId, productTitle: line.productTitle, review: line.review })}
                          className="glass glass-navy pressable shrink-0 rounded-full px-4 py-2 text-xs font-extrabold"
                        >
                          {t(line.review ? "review.edit" : "review.write")}
                        </button>
                      ) : (
                        /* The reason, not silence. See the file comment. */
                        <span className="max-w-full rounded-2xl bg-[#e7edf5] px-3 py-2 text-[12px] font-extrabold leading-4 text-[#536b8c]">
                          {t(`review.${line.eligibility.allowed ? "write" : line.eligibility.reason}` as MessageKey)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {writing ? (
              <ReviewDialog target={writing} onClose={() => setWriting(null)} onDone={() => { setWriting(null); void lines.refetch(); }} />
            ) : null}
          </>
        );
      }}
    </QueryGate>
  );
}
