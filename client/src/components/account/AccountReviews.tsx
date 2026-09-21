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
 * The eligibility that decides which rows get a form is `eligibilityFor` from
 * `shared/`, the same function the server refuses with — so this page cannot
 * offer a review the API would reject. It sends the *resolved* verdict rather
 * than the ingredients, so the clock and the order status are the server's.
 */
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { QueryGate } from "@/components/admin/QueryGate";
import { StarRow } from "@/components/product/ProductReviews";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { MAX_REVIEW_BODY, MAX_REVIEW_TITLE, RATING_MAX } from "@shared/commerce/reviews";
import type { MessageKey } from "@shared/i18n/dictionary";
import { PackageSearch, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Line = {
  orderItemId: number;
  orderReference: string;
  productTitle: string;
  deliveredAt: string | null;
  reviewId: number | null;
  myRating: number | null;
  eligibility: { allowed: true } | { allowed: false; reason: string };
};

export function AccountReviews() {
  const { t } = useTranslation();
  const lines = trpc.reviews.mine.useQuery();

  return (
    <QueryGate queries={[lines]}>
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
          <ul className="space-y-3">
            {rows.map(line => (
              <ReviewableLine key={line.orderItemId} line={line} onChanged={() => void lines.refetch()} />
            ))}
          </ul>
        );
      }}
    </QueryGate>
  );
}

function ReviewableLine({ line, onChanged }: { line: Line; onChanged: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const canWrite = line.eligibility.allowed;
  const alreadyWritten = !canWrite && line.eligibility.reason === "alreadyReviewed";

  return (
    <li className="rounded-[1.35rem] border border-[#d5dfeb] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p dir="auto" className="text-sm font-extrabold text-[#0a285a]">{line.productTitle}</p>
          <p className="mt-0.5 text-xs ink-muted">
            <bdi dir="ltr">{line.orderReference}</bdi>
          </p>
          {line.myRating !== null ? (
            <div className="mt-2"><StarRow value={line.myRating} /></div>
          ) : null}
        </div>

        {canWrite || alreadyWritten ? (
          <button
            onClick={() => setOpen(value => !value)}
            className="glass glass-navy pressable shrink-0 rounded-full px-4 py-2 text-xs font-extrabold"
          >
            {t(alreadyWritten ? "review.edit" : "review.write")}
          </button>
        ) : (
          /* The reason, not silence. See the file comment. */
          <span className="shrink-0 rounded-full bg-[#e7edf5] px-3 py-2 text-[11px] font-extrabold text-[#536b8c]">
            {t(`review.${line.eligibility.reason}` as MessageKey)}
          </span>
        )}
      </div>

      {open ? (
        <ReviewForm
          line={line}
          editing={alreadyWritten}
          onDone={() => { setOpen(false); onChanged(); }}
        />
      ) : null}
    </li>
  );
}

function ReviewForm({ line, editing, onDone }: { line: Line; editing: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const [rating, setRating] = useState(line.myRating ?? 0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);

  const write = trpc.reviews.write.useMutation();
  const edit = trpc.reviews.edit.useMutation();
  const remove = trpc.reviews.remove.useMutation();

  const fail = (error: { message: string }) => toast.error(t(error.message as MessageKey));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (rating === 0) { toast.error(t("review.ratingRequired")); return; }

    const fields = { rating, title: title.trim() || null, body: body.trim() || null };

    // Editing rather than re-writing when one already exists: the order line
    // carries exactly one review, and asking the server to insert a second
    // would hit the unique index rather than do what the shopper meant.
    if (editing && line.reviewId !== null) {
      edit.mutate({ reviewId: line.reviewId, ...fields }, {
        onSuccess: () => { toast.success(t("review.updated")); onDone(); },
        onError: fail,
      });
      return;
    }

    write.mutate({ orderItemId: line.orderItemId, ...fields }, {
      onSuccess: () => { toast.success(t("review.saved")); onDone(); },
      onError: fail,
    });
  };

  return (
    <form className="mt-4 border-t border-[#e7edf5] pt-4" onSubmit={submit}>
      <fieldset>
        <legend className="text-[11px] font-extrabold tracking-[.1em] ink-muted uppercase">{t("review.yourRating")}</legend>
        {/*
          Radio inputs rather than buttons, because five stars are one choice
          from a set — which is what a radio group *is*, and what gives arrow
          keys and a screen reader the behaviour people already know.
        */}
        <div className="mt-2 flex gap-1">
          {Array.from({ length: RATING_MAX }, (_, index) => index + 1).map(star => (
            <label key={star} className="cursor-pointer">
              <input
                type="radio"
                name={`rating-${line.orderItemId}`}
                value={star}
                checked={rating === star}
                onChange={() => setRating(star)}
                className="sr-only peer"
              />
              <span className="sr-only">{t(star === 1 ? "review.starsOne" : "review.stars", { count: star })}</span>
              <Star
                aria-hidden
                className={`size-7 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#f2683a] ${
                  star <= rating ? "fill-[#ffb800] text-[#ffb800]" : "text-[#c3ccda]"
                }`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 block">
        <span className="block text-[11px] font-extrabold tracking-[.1em] ink-muted uppercase">{t("review.titleLabel")}</span>
        <input
          value={title}
          onChange={event => setTitle(event.target.value)}
          maxLength={MAX_REVIEW_TITLE}
          dir="auto"
          placeholder={t("review.titlePlaceholder")}
          className="glass-field mt-1 w-full rounded-full px-4 py-2.5 text-sm"
        />
      </label>

      <label className="mt-3 block">
        <span className="block text-[11px] font-extrabold tracking-[.1em] ink-muted uppercase">{t("review.bodyLabel")}</span>
        <textarea
          value={body}
          onChange={event => setBody(event.target.value)}
          maxLength={MAX_REVIEW_BODY}
          rows={4}
          dir="auto"
          placeholder={t("review.bodyPlaceholder")}
          className="glass-field mt-1 w-full rounded-2xl px-4 py-3 text-sm"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={write.isPending || edit.isPending}
          className="glass glass-navy pressable rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
        >
          {t("review.submit")}
        </button>

        {editing ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-extrabold text-[#8c2f22] hover:bg-[#fdeceb]"
          >
            <Trash2 className="size-3.5" aria-hidden />{t("review.delete")}
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={t("review.deleteWarning", { name: line.productTitle })}
        body={t("review.deleteBody")}
        confirmLabel={t("review.delete")}
        pending={remove.isPending}
        onConfirm={() => {
          if (line.reviewId === null) { setConfirming(false); return; }
          remove.mutate({ reviewId: line.reviewId }, {
            onSuccess: () => { toast.success(t("review.deleted")); setConfirming(false); onDone(); },
            onError: fail,
          });
        }}
        onClose={() => setConfirming(false)}
      />
    </form>
  );
}
