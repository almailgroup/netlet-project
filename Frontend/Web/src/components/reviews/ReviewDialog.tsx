/**
 * Rating something you received: the stars, a headline, what you would tell
 * somebody, and up to `MAX_REVIEW_PHOTOS` photos — from an opened order's
 * "Rate this item", the My orders row's "Rate your items" and the account's
 * Reviews alike, so the three cannot ask different things.
 *
 * **Editing starts from what was written.** It opened on empty boxes, and
 * saving a new star count then sent empty words that replaced the old ones.
 *
 * **Errors arrive with the press and leave with the fix**, the sign-in form's
 * rule: no stars, or words carrying a phone number, an email or a link (the
 * contact filter, which the server asks again). A photo is shrunk and
 * re-encoded here (`preparePhoto`, without the seller's fixes — a shopper's
 * framing is theirs) and stored the moment it is chosen, so the press of
 * Publish only names it; the server takes only this account's own uploads.
 *
 * The answer says whether the review is on the product page now or waiting
 * for a quick look (`ReviewState`), and the toast says which.
 *
 * A sheet from the foot of a phone's screen and a card from `sm`, portalled
 * to `<body>`, focus on the heading as it opens — `AddressConfirm`'s shape.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, LoaderCircle, PackageSearch, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Thumb } from "@/components/product/Thumb";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { preparePhoto } from "@/lib/preparePhoto";
import { pressHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import { contactFindings } from "@shared/commerce/contactFilter";
import { MAX_REVIEW_BODY, MAX_REVIEW_PHOTOS, MAX_REVIEW_TITLE, RATING_MAX, type ReviewState } from "@shared/commerce/reviews";
import { useConfirmRemoval } from "@/components/ui/ConfirmRemoval";

export type MyReview = {
  id: number;
  rating: number;
  title: string | null;
  body: string | null;
  photos: string[];
  state: ReviewState;
};

export type ReviewTarget = {
  orderItemId: number;
  productTitle: string;
  photo?: string | null;
  review: MyReview | null;
};

type Problem = "rating" | "words" | null;

export function ReviewDialog({ target, onClose, onDone }: {
  target: ReviewTarget;
  onClose: () => void;
  onDone: (state: ReviewState | "deleted") => void;
}) {
  const { t, tError } = useTranslation();
  const ask = useConfirmRemoval();
  const existing = target.review;
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [uploading, setUploading] = useState(0);
  const [problem, setProblem] = useState<Problem>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const ratingErrorId = useId();
  const wordsErrorId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStar = useRef<HTMLInputElement>(null);
  const bodyBox = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  const write = trpc.reviews.write.useMutation();
  const edit = trpc.reviews.edit.useMutation();
  const remove = trpc.reviews.remove.useMutation();
  const pending = write.isPending || edit.isPending;

  useOverlay(true, () => { if (!pending && !confirming) onClose(); });
  useEffect(() => { window.setTimeout(() => heading.current?.focus(), 40); }, []);

  /* Errors leave with the fix, never arrive on their own. */
  useEffect(() => { if (problem === "rating" && rating > 0) setProblem(null); }, [problem, rating]);
  useEffect(() => { if (problem === "words" && contactFindings(`${title}\n${body}`).length === 0) setProblem(null); }, [problem, title, body]);

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_REVIEW_PHOTOS - photos.length - uploading;
    for (const file of Array.from(files).slice(0, Math.max(0, room))) {
      setUploading(count => count + 1);
      try {
        const prepared = await preparePhoto(file, false);
        if (typeof prepared === "string") throw new Error(prepared);
        const response = await fetch("/api/media/review", { method: "POST", headers: { "Content-Type": prepared.type }, body: prepared.blob, credentials: "same-origin" });
        const answer = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!response.ok || !answer.url) throw new Error(answer.error ?? "review.photoFailed");
        setPhotos(current => (current.length < MAX_REVIEW_PHOTOS ? [...current, answer.url!] : current));
      } catch (error) {
        toast.error(tError(error instanceof Error ? error.message : "review.photoFailed"));
      } finally {
        setUploading(count => count - 1);
      }
    }
  };

  const done = (state: ReviewState) => {
    toast.success(t(state === "published" ? (existing ? "review.updated" : "review.saved") : "review.savedWaiting"));
    onDone(state);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (rating === 0) { setProblem("rating"); firstStar.current?.focus(); return; }
    if (contactFindings(`${title}\n${body}`).length > 0) { setProblem("words"); bodyBox.current?.focus(); return; }
    const fields = { rating, title: title.trim() || null, body: body.trim() || null, photos };
    const fail = (error: { message: string }) => toast.error(tError(error.message));
    // Editing rather than re-writing when one already exists: the order line
    // carries exactly one review, and a second insert would hit the unique
    // index rather than do what the shopper meant.
    if (existing) {
      edit.mutate({ reviewId: existing.id, ...fields }, { onSuccess: answer => done(answer.state), onError: fail });
      return;
    }
    write.mutate({ orderItemId: target.orderItemId, ...fields }, { onSuccess: answer => done(answer.state), onError: fail });
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end bg-[#061b3b]/50 sm:items-center sm:justify-center sm:p-4" onClick={() => { if (!pending) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="max-h-[92svh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-12px_40px_rgba(10,40,90,.22)] sm:max-w-[520px] sm:rounded-3xl sm:pb-5 sm:shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[#d5dfeb] sm:hidden" />
        <div className="flex items-start gap-3">
          <Thumb src={target.photo ?? null} alt="" className="size-14 shrink-0 rounded-xl border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-5" />} />
          <div className="min-w-0 flex-1">
            <h2 ref={heading} id={titleId} tabIndex={-1} className="text-[18px] font-extrabold leading-6 text-[#0a285a] outline-none">
              {t("review.dialogTitle", { name: "" })}<bdi>{target.productTitle}</bdi>
            </h2>
            <p className="mt-1 text-[13px] leading-5 ink-muted">{t("review.dialogNote")}</p>
          </div>
          <button type="button" onClick={onClose} disabled={pending} aria-label={t("common.close")} className="pressable -me-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full">
            <X className="size-5 text-[#0a285a]" aria-hidden />
          </button>
        </div>

        <form className="mt-5" onSubmit={submit} noValidate>
          <fieldset aria-describedby={problem === "rating" ? ratingErrorId : undefined}>
            <legend className="text-[13px] font-semibold text-[#0a285a]">{t("review.yourRating")}</legend>
            {/*
              Radio inputs rather than buttons, because five stars are one
              choice from a set — which is what a radio group is, and what
              gives arrow keys and a screen reader the behaviour people know.
            */}
            <div className="mt-2 flex gap-1.5">
              {Array.from({ length: RATING_MAX }, (_, index) => index + 1).map(star => (
                <label key={star} className="cursor-pointer rounded-lg p-0.5">
                  <input
                    ref={star === 1 ? firstStar : undefined}
                    type="radio"
                    name={`rating-${target.orderItemId}`}
                    value={star}
                    checked={rating === star}
                    onChange={() => { setRating(star); pressHaptic(); }}
                    className="peer sr-only"
                  />
                  <span className="sr-only">{t("review.stars", { count: star })}</span>
                  <Star
                    aria-hidden
                    className={`size-9 transition-colors peer-focus-visible:rounded peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[#f2683a] ${
                      star <= rating ? "fill-[#ffb800] text-[#ffb800]" : "text-[#c3ccda]"
                    }`}
                  />
                </label>
              ))}
            </div>
            {problem === "rating" ? <p id={ratingErrorId} className="mt-1.5 text-[13px] font-semibold text-[#a3281b]">{t("review.ratingRequired")}</p> : null}
          </fieldset>

          <label className="mt-5 block">
            <span className="block text-[13px] font-semibold text-[#0a285a]">{t("review.titleLabel")}</span>
            <input
              value={title}
              onChange={event => setTitle(event.target.value)}
              maxLength={MAX_REVIEW_TITLE}
              dir="auto"
              placeholder={t("review.titlePlaceholder")}
              className="glass-field mt-1.5 h-12 w-full rounded-xl px-4 text-[15px]"
            />
          </label>

          <label className="mt-4 block">
            <span className="block text-[13px] font-semibold text-[#0a285a]">{t("review.bodyLabel")}</span>
            <textarea
              ref={bodyBox}
              value={body}
              onChange={event => setBody(event.target.value)}
              maxLength={MAX_REVIEW_BODY}
              rows={4}
              dir="auto"
              placeholder={t("review.bodyPlaceholder")}
              aria-invalid={problem === "words"}
              aria-describedby={problem === "words" ? wordsErrorId : undefined}
              className="glass-field mt-1.5 w-full rounded-xl px-4 py-3 text-[15px] leading-6"
            />
            {problem === "words" ? <span id={wordsErrorId} className="mt-1.5 block text-[13px] font-semibold text-[#a3281b]">{t("review.offPlatform")}</span> : null}
          </label>

          <div className="mt-4">
            <p className="text-[13px] font-semibold text-[#0a285a]">{t("review.photosLabel")}</p>
            <p className="mt-0.5 text-[12px] leading-5 ink-muted">{t("review.photosHint", { max: String(MAX_REVIEW_PHOTOS) })}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {photos.map((photo, index) => (
                <li key={photo} className="relative">
                  <Thumb src={photo} alt="" className="size-20 rounded-xl border border-[#e7edf5] object-cover" />
                  <button
                    type="button"
                    onClick={() => void ask({ title: t("remove.photoTitle"), body: t("remove.photoBody") }).then(sure => { if (sure) setPhotos(current => current.filter(entry => entry !== photo)); })}
                    aria-label={t("review.removePhoto", { index: String(index + 1) })}
                    className="absolute -end-2 -top-2 grid size-7 place-items-center rounded-full border border-[#d5dfeb] bg-white shadow-sm"
                  >
                    <X className="size-3.5 text-[#0a285a]" aria-hidden />
                  </button>
                </li>
              ))}
              {Array.from({ length: uploading }, (_, index) => (
                <li key={`up-${index}`} className="grid size-20 place-items-center rounded-xl border border-dashed border-[#c3ccda] bg-[#f3f5f9]">
                  <LoaderCircle className="size-5 animate-spin text-[#536b8c]" aria-hidden />
                  <span className="sr-only">{t("review.uploading")}</span>
                </li>
              ))}
              {photos.length + uploading < MAX_REVIEW_PHOTOS ? (
                <li>
                  <button
                    type="button"
                    onClick={() => picker.current?.click()}
                    className="pressable grid size-20 place-items-center rounded-xl border border-dashed border-[#9fb0c8] bg-white text-center text-[11px] font-bold leading-4 text-[#0a285a]"
                  >
                    <span className="flex flex-col items-center gap-1 px-1">
                      <ImagePlus className="size-5" aria-hidden />
                      {t("review.addPhoto")}
                    </span>
                  </button>
                </li>
              ) : null}
            </ul>
            <input ref={picker} type="file" accept="image/*" multiple className="hidden" tabIndex={-1} aria-hidden onChange={event => { void addPhotos(event.target.files); event.target.value = ""; }} />
          </div>

          <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
            <button
              type="submit"
              disabled={pending || uploading > 0}
              className="pressable inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0a285a] text-sm font-extrabold text-white transition hover:bg-[#0d3372] disabled:opacity-60"
            >
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              {t("review.submit")}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="glass pressable inline-flex h-12 items-center justify-center rounded-xl border border-[#d5dfeb] text-sm font-extrabold text-[#0a285a] disabled:opacity-60"
            >
              {t("review.cancel")}
            </button>
          </div>

          {existing ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="pressable mx-auto mt-3 flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[13px] font-extrabold text-[#8c2f22] hover:bg-[#fdeceb]"
            >
              <Trash2 className="size-4" aria-hidden />{t("review.delete")}
            </button>
          ) : null}
        </form>

        <ConfirmDialog
          open={confirming}
          tone="danger"
          title={t("review.deleteWarning", { name: target.productTitle })}
          body={t("review.deleteBody")}
          confirmLabel={t("review.delete")}
          pending={remove.isPending}
          onConfirm={() => {
            if (!existing) { setConfirming(false); return; }
            remove.mutate({ reviewId: existing.id }, {
              onSuccess: () => { toast.success(t("review.deleted")); setConfirming(false); onDone("deleted"); },
              onError: error => toast.error(tError(error.message)),
            });
          }}
          onClose={() => setConfirming(false)}
        />
      </div>
    </div>,
    document.body,
  );
}
