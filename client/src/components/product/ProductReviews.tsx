/**
 * What other people thought, on the product page.
 *
 * Every row here is a verified purchase — `reviews` is keyed on an order line,
 * so the table has no way to hold anything else — and the page says so on each
 * one rather than leaving it implied. A shop that cannot prove its reviews are
 * real is a shop whose reviews nobody believes.
 *
 * **An empty state that explains itself.** "No reviews yet" alone reads as a
 * product nobody liked; the line under it says only delivered purchases can
 * review, which turns the same emptiness into a new product. That is the
 * badge rule again — say nothing, or say something true.
 *
 * The histogram is drawn from `distributionShare`, and the stars are text
 * before they are shapes: every rating carries its number in the accessible
 * name, because a row of filled paths tells a screen reader nothing.
 */
import { QueryGate } from "@/components/admin/QueryGate";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { distributionShare, RATING_MAX, RATING_MIN, type ReviewSummary } from "@shared/commerce/reviews";
import { Star } from "lucide-react";

/**
 * A row of five stars.
 *
 * `aria-hidden` on the shapes and the value in a `sr-only` span beside them:
 * five identical icons with no text is a decorative pattern to anything that
 * is not looking at it.
 */
export function StarRow({ value, size = "sm" }: { value: number; size?: "sm" | "lg" }) {
  const { t } = useTranslation();
  const box = size === "lg" ? "size-5" : "size-3.5";
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: RATING_MAX }, (_, index) => {
        const star = index + 1;
        return (
          <Star
            key={star}
            aria-hidden
            className={`${box} ${star <= Math.round(value) ? "fill-[#ffb800] text-[#ffb800]" : "text-[#c3ccda]"}`}
          />
        );
      })}
      <span className="sr-only">{t("review.outOf", { value })}</span>
    </span>
  );
}

export function ProductReviews({ productId, productTitle }: { productId: string; productTitle: string }) {
  const { t, locale } = useTranslation();
  const query = trpc.reviews.forProduct.useQuery({ productId, limit: 20 });

  return (
    <section id="reviews" className="scroll-mt-24 border-t border-[#d5dfeb] pt-8">
      <h2 className="display-face text-2xl text-[#0a285a] sm:text-3xl">{t("review.heading")}</h2>

      <QueryGate queries={[query]}>
        {() => {
          const data = query.data;
          if (!data || data.total === 0) {
            return (
              <div className="mt-4 rounded-[1.35rem] border border-dashed border-[#c3ccda] bg-[#fbfaf6] p-6">
                <p className="text-sm font-extrabold text-[#0a285a]">{t("review.none")}</p>
                {/* Why it is empty, so emptiness does not read as a verdict. */}
                <p className="mt-1 max-w-prose text-xs leading-5 ink-muted">{t("review.noneNote")}</p>
              </div>
            );
          }

          return (
            <>
              {data.summary ? <Summary summary={data.summary} /> : null}

              <ul className="mt-6 space-y-5">
                {data.items.map(review => (
                  <li key={review.id} className="border-b border-[#e7edf5] pb-5 last:border-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <StarRow value={review.rating} />
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#d8ead8] px-2.5 py-1 text-[10px] font-extrabold text-[#2f5d33]">
                        {t("review.verified")}
                      </span>
                      <span className="text-xs ink-muted">
                        {review.author || t("review.anonymous")}
                        {" · "}
                        {new Date(review.createdAt).toLocaleDateString(locale === "ar" ? "ar-KW" : "en-GB")}
                      </span>
                    </div>

                    {review.title ? (
                      <h3 dir="auto" className="mt-2 text-sm font-extrabold text-[#0a285a]">{review.title}</h3>
                    ) : null}
                    {review.body ? (
                      <p dir="auto" className="mt-1 max-w-prose text-sm leading-6 text-[#1f2229]">{review.body}</p>
                    ) : null}

                    {review.vendorReply ? (
                      <div className="mt-3 rounded-2xl bg-[#f3f2ed] p-4">
                        <p className="text-[10px] font-extrabold tracking-[.1em] ink-accent uppercase">
                          {t("review.vendorReply")}
                        </p>
                        <p dir="auto" className="mt-1 max-w-prose text-sm leading-6 text-[#1f2229]">{review.vendorReply}</p>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          );
        }}
      </QueryGate>
    </section>
  );
}

function Summary({ summary }: { summary: ReviewSummary }) {
  const { t } = useTranslation();
  const share = distributionShare(summary);

  return (
    <div className="mt-4 flex flex-col gap-6 rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5 sm:flex-row sm:items-center">
      <div className="shrink-0 text-center sm:text-start">
        {/* The number is Latin whichever language the page is in. */}
        <bdi dir="ltr" className="display-face block text-4xl text-[#0a285a]">{summary.average.toFixed(1)}</bdi>
        <div className="mt-1 flex justify-center sm:justify-start"><StarRow value={summary.average} size="lg" /></div>
        <p className="mt-1 text-xs ink-muted">
          {summary.count === 1 ? t("review.countOne") : t("review.count", { count: summary.count })}
        </p>
      </div>

      {/* Highest star first, the way every shop draws it. */}
      <ul className="min-w-0 flex-1 space-y-1.5">
        {Array.from({ length: RATING_MAX }, (_, index) => RATING_MAX - index).map(star => (
          <li key={star} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs ink-muted">
              {star === RATING_MIN ? t("review.starsOne") : t("review.stars", { count: star })}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#e7edf5]">
              <span
                className="block h-full rounded-full bg-[#ffb800]"
                style={{ width: `${Math.round(share[star] * 100)}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-end text-xs ink-muted tabular-nums">{summary.distribution[star]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
