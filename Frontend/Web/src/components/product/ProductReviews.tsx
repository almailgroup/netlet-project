/**
 * What other people thought, on the product page.
 *
 * **Ratings and reviews are two figures, and the page says both.** Every
 * rating counts in the average and the breakdown; a review is a rating with
 * words or photos, and only those are listed (`isWritten`), because a page of
 * bare star rows is a list nobody learns anything from. So the summary reads
 * "4.3 · 12 ratings · 5 reviews", the way a shop's does.
 *
 * Every row here is a verified purchase — `reviews` is keyed on an order line,
 * so the table has no way to hold anything else — and the page says so on each
 * one, with a line saying what that means, rather than leaving it implied. A
 * shop that cannot prove its reviews are real is a shop whose reviews nobody
 * believes. A review that is still waiting for its check is in neither figure.
 *
 * **The breakdown is a share of the ratings, in whole percentages that add up
 * to a hundred** (`distributionPercent`), drawn five stars first; each row is
 * one sentence to a screen reader ("5 stars: 67% of ratings").
 *
 * Sorted newest first, or by the stars either way (`REVIEW_SORTS`), on the
 * server, so "Lowest rated" is the lowest of all of them and not of the page
 * already fetched. "Show more" asks for the next `REVIEW_PAGE`.
 *
 * **An empty state that explains itself.** "No reviews yet" alone reads as a
 * product nobody liked; the line under it says only delivered purchases can
 * review, which turns the same emptiness into a new product.
 */
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import { BadgeCheck, ChevronLeft, ChevronRight, LoaderCircle, Star, X } from "lucide-react";
import { QueryGate } from "@/components/admin/QueryGate";
import { Select } from "@/components/ui/Select";
import { StarRow as Stars } from "@/components/ui/StarRow";
import { Thumb } from "@/components/product/Thumb";
import { useOverlay } from "@/hooks/useOverlay";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  distributionPercent,
  distributionShare,
  RATING_MAX,
  REVIEW_PAGE,
  REVIEW_SORTS,
  type ReviewSort,
  type ReviewSummary,
} from "@shared/commerce/reviews";
import type { MessageKey } from "@shared/i18n/dictionary";

const SORT_LABELS: Record<ReviewSort, MessageKey> = {
  newest: "review.sortNewest",
  highest: "review.sortHighest",
  lowest: "review.sortLowest",
};

/*
 * A review's words take their own direction (`dir="auto"`) and the page's
 * alignment (`align-parent`): an English review on the Arabic page reads left
 * to right and still sits on the page's side, under its stars, rather than
 * at the far edge of an Arabic column.
 */

/**
 * A row of five whole stars, for a single review's rating.
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

type Review = {
  id: number;
  rating: number;
  title: string | null;
  body: string | null;
  photos: string[];
  author: string;
  createdAt: string;
  vendorReply: string | null;
};

export function ProductReviews({ productId }: { productId: string; productTitle?: string }) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [shown, setShown] = useState(REVIEW_PAGE);
  const [viewing, setViewing] = useState<{ photos: string[]; index: number; author: string } | null>(null);
  const query = trpc.reviews.forProduct.useQuery(
    { productId, limit: shown, sort },
    { placeholderData: previous => previous },
  );

  return (
    <section id="reviews" aria-labelledby="reviews-heading" className="scroll-mt-24 border-t border-[#d5dfeb] pt-8">
      <h2 id="reviews-heading" className="font-extrabold text-2xl text-[#0a285a] sm:text-3xl">{t("review.heading")}</h2>

      <QueryGate queries={[query]}>
        {() => {
          const data = query.data;
          if (!data?.summary) {
            return (
              <div className="mt-4 rounded-[1.35rem] border border-dashed border-[#c3ccda] bg-[#fbfaf6] p-6">
                <p className="text-sm font-extrabold text-[#0a285a]">{t("review.none")}</p>
                {/* Why it is empty, so emptiness does not read as a verdict. */}
                <p className="mt-1 max-w-prose text-xs leading-5 ink-muted">{t("review.noneNote")}</p>
              </div>
            );
          }
          const items = data.items as Review[];

          return (
            <>
              <Summary summary={data.summary} written={data.total} />

              <p className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-[#2f5d33]">
                <BadgeCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("review.verifiedNote")}
              </p>

              {data.total === 0 ? (
                <p className="mt-6 text-sm ink-muted">{t("review.noWritten")}</p>
              ) : (
                <>
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[15px] font-extrabold text-[#0a285a]">{t("review.writtenCount", { count: data.total })}</p>
                    <Select
                      aria-label={t("review.sortLabel")}
                      value={sort}
                      onChange={event => { setSort(event.target.value as ReviewSort); setShown(REVIEW_PAGE); }}
                      className="min-w-[11rem]"
                    >
                      {REVIEW_SORTS.map(option => <option key={option} value={option}>{t(SORT_LABELS[option])}</option>)}
                    </Select>
                  </div>

                  <ul className="mt-4 space-y-5" aria-busy={query.isFetching}>
                    {items.map(review => (
                      <ReviewRow key={review.id} review={review} onPhoto={index => setViewing({ photos: review.photos, index, author: review.author || t("review.anonymous") })} />
                    ))}
                  </ul>

                  {items.length < data.total ? (
                    <button
                      type="button"
                      onClick={() => setShown(count => count + REVIEW_PAGE)}
                      disabled={query.isFetching}
                      className="glass type-control pressable mt-5 inline-flex min-h-11 items-center gap-2 rounded-full px-5 disabled:opacity-60"
                    >
                      {query.isFetching ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                      {t("review.showMore")}
                    </button>
                  ) : null}
                </>
              )}
            </>
          );
        }}
      </QueryGate>

      {viewing ? <PhotoViewer {...viewing} onClose={() => setViewing(null)} /> : null}
    </section>
  );
}

function ReviewRow({ review, onPhoto }: { review: Review; onPhoto: (index: number) => void }) {
  const { t } = useTranslation();
  const formatDate = useDateFormat();
  const author = review.author || t("review.anonymous");
  return (
    <li className="border-b border-[#e7edf5] pb-5 last:border-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StarRow value={review.rating} />
        <span className="inline-flex items-center gap-1 rounded-full bg-[#d8ead8] px-2.5 py-1 text-[12px] font-extrabold text-[#2f5d33]">
          <BadgeCheck className="size-3.5" aria-hidden />
          {t("review.verified")}
        </span>
      </div>

      {review.title ? (
        <h3 dir="auto" className="align-parent mt-2 max-w-prose text-[15px] font-extrabold text-[#0a285a]">{review.title}</h3>
      ) : null}
      {review.body ? (
        <p dir="auto" className="align-parent mt-1 max-w-prose whitespace-pre-line text-sm leading-6 text-[#1f2229]">{review.body}</p>
      ) : null}

      {review.photos.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {review.photos.map((photo, index) => (
            <li key={photo}>
              <button
                type="button"
                onClick={() => onPhoto(index)}
                aria-label={t("review.photoOf", { index: String(index + 1), count: String(review.photos.length), author })}
                className="pressable block overflow-hidden rounded-xl border border-[#e7edf5] bg-white"
              >
                <Thumb src={photo} alt="" className="size-20 object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-2 text-xs ink-muted">
        <bdi>{author}</bdi>
        {" · "}
        {formatDate(review.createdAt)}
      </p>

      {review.vendorReply ? (
        <div className="mt-3 rounded-2xl bg-[#f3f2ed] p-4">
          <p className="text-[12px] font-semibold ink-accent">{t("review.vendorReply")}</p>
          <p dir="auto" className="align-parent mt-1 max-w-prose text-sm leading-6 text-[#1f2229]">{review.vendorReply}</p>
        </div>
      ) : null}
    </li>
  );
}

/** The average, both counts, and each star's share of the ratings. */
function Summary({ summary, written }: { summary: ReviewSummary; written: number }) {
  const { t } = useTranslation();
  const share = distributionShare(summary);
  const percent = distributionPercent(summary);

  return (
    <div className="mt-4 flex flex-col gap-6 rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5 sm:flex-row sm:items-center sm:gap-10">
      <div className="shrink-0 text-center sm:text-start">
        {/* The number is Latin whichever language the page is in. */}
        <p className="font-extrabold text-[44px] leading-none text-[#0a285a]">
          <bdi dir="ltr">{summary.average.toFixed(1)}</bdi>
          <span className="sr-only"> {t("review.outOf", { value: summary.average.toFixed(1) })}</span>
        </p>
        <div className="mt-2 flex justify-center sm:justify-start"><Stars value={summary.average} size={20} /></div>
        <p className="mt-2 text-[13px] ink-muted">
          {t("review.ratingsCount", { count: summary.count })}
          {" · "}
          {t("review.writtenCount", { count: written })}
        </p>
      </div>

      {/* Highest star first, the way every shop draws it. */}
      <ul className="min-w-0 flex-1 space-y-2">
        {Array.from({ length: RATING_MAX }, (_, index) => RATING_MAX - index).map(star => (
          <li key={star} className="flex items-center gap-3">
            <span className="sr-only">{t("review.shareOf", { stars: t("review.stars", { count: star }), percent: String(percent[star]) })}</span>
            <span aria-hidden className="inline-flex w-9 shrink-0 items-center gap-1 text-[13px] font-bold text-[#0a285a]">
              <bdi dir="ltr">{star}</bdi>
              <Star className="size-3.5 fill-[#ffb800] text-[#ffb800]" />
            </span>
            <span aria-hidden className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[#e7edf5]">
              <span className="block h-full rounded-full bg-[#ffb800]" style={{ width: `${share[star] * 100}%` }} />
            </span>
            <bdi aria-hidden dir="ltr" className="w-10 shrink-0 text-end text-[13px] tabular-nums ink-muted">{percent[star]}%</bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A review's photos, large: one at a time, with arrows that run the page's
 * way and a count. A modal, so it owes what every modal here does
 * (`useOverlay`), and focus goes to its Close as it opens.
 */
function PhotoViewer({ photos, index: start, author, onClose }: { photos: string[]; index: number; author: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(start);
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  useOverlay(true, onClose);
  useEffect(() => { close.current?.focus(); }, []);
  const step = (by: number) => setIndex(current => (current + by + photos.length) % photos.length);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#061b3b]/80 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            const forward = (event.key === "ArrowRight") !== (document.documentElement.dir === "rtl");
            step(forward ? 1 : -1);
          }
        }}
        className="relative w-full max-w-3xl rounded-3xl bg-white p-3 sm:p-4"
      >
        <div className="flex items-center justify-between gap-3 px-1 pb-3">
          <h2 id={titleId} className="text-[15px] font-extrabold text-[#0a285a]">
            {t("review.photoOf", { index: String(index + 1), count: String(photos.length), author })}
          </h2>
          <button ref={close} type="button" onClick={onClose} aria-label={t("common.close")} className="pressable grid size-11 shrink-0 place-items-center rounded-full">
            <X className="size-5 text-[#0a285a]" aria-hidden />
          </button>
        </div>
        <div className="relative grid place-items-center overflow-hidden rounded-2xl bg-[#f3f5f9]">
          <Thumb src={photos[index]} alt="" className="max-h-[70svh] w-full object-contain" eager />
          {photos.length > 1 ? (
            <>
              <button type="button" onClick={() => step(-1)} aria-label={t("review.previousPhoto")} className="glass pressable absolute start-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full">
                <ChevronLeft className="size-5 rtl:-scale-x-100" aria-hidden />
              </button>
              <button type="button" onClick={() => step(1)} aria-label={t("review.nextPhoto")} className="glass pressable absolute end-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full">
                <ChevronRight className="size-5 rtl:-scale-x-100" aria-hidden />
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
