/**
 * The review queue: products a vendor has asked to publish.
 *
 * Rejecting takes a note, and the note is not optional in spirit — a rejection
 * with no reason sends the vendor back to guess. It is written onto the
 * product, so they read it on the page they have to fix rather than in a
 * separate message they may never see.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { Pager } from "@/components/admin/Pager";
import { buttonClass, EmptyState, PageHeader, Pill, SkeletonRows, smallButtonClass, textareaClass } from "@/components/admin/ui";
import { Thumb } from "@/components/product/Thumb";
import { trpc } from "@/lib/trpc";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { Check, ImageOff, LoaderCircle, Sparkles, Undo2 } from "lucide-react";
import type { Flag } from "@shared/inventory/productReview";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function AdminReview() {
  usePageMeta(privatePageMeta("Review queue"));
  return <AdminShell need={"product.review"}>{() => <Queue />}</AdminShell>;
}

function Queue() {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [page, setPage] = useState(1);
  /*
   * The queue asks the server for what is waiting, rather than fetching a page
   * of products and filtering it: with paging the second would show the
   * pending items that happened to land on page one and report the queue empty
   * once it grew past that.
   */
  const products = trpc.inventory.products.list.useQuery(
    { status: "pending_review", page },
    { placeholderData: previous => previous },
  );

  /* The server's own reason: approving a product priced at zero is refused
     with "set a price first", which "not allowed" used to hide. */
  const review = trpc.inventory.products.review.useMutation({
    onSuccess: () => {
      void utils.inventory.products.list.invalidate();
      toast.success(t("admin.saved"));
    },
    onError: error => toast.error(tError(error.message)),
  });
  /* Which row is being decided, so one press does not put a spinner on
     every row's buttons. */
  const deciding = review.isPending ? review.variables?.id : undefined;

  const waiting = products.data?.rows ?? [];

  /*
   * What is wrong with each listing (3.6.2), over the page already on screen.
   * The queue was entirely human before this, so a blank listing with a phone
   * number in the title got the same attention as a well-made page.
   */
  const ids = waiting.map(row => row.id);
  const flags = trpc.inventory.products.flags.useQuery({ ids }, { enabled: ids.length > 0 });
  const flagsFor = (id: number) => flags.data?.find(entry => entry.productId === id)?.flags ?? [];
  /* Asked once for the page rather than per row: it is a fact about the
     deployment, not about a product. */
  const modelReview = trpc.inventory.products.modelReviewAvailable.useQuery();

  return (
    <>
      <PageHeader
        title={t("admin.review")}
        description={t("admin.reviewIntro")}
        meta={products.data && products.data.total > 0 ? <Pill tone="warning">{t("admin.reviewWaiting", { count: products.data.total })}</Pill> : null}
      />
      {products.isLoading ? (
        <SkeletonRows rows={3} label={t("admin.loading")} />
      ) : products.isError ? (
        <QueryGate queries={[products]}>{() => null}</QueryGate>
      ) : waiting.length === 0 ? (
        <EmptyState title={t("admin.nothingToReview")} />
      ) : (
        <>
          <ul className="space-y-4">
            {waiting.map(row => {
              const cover = row.images.find(image => image.kind !== "video")?.url;
              const prices = row.variants.map(variant => Number(variant.price)).filter(Number.isFinite);
              const cheapest = row.variants.reduce<string | null>((low, variant) => low === null || Number(variant.price) < Number(low) ? variant.price : low, null);
              const note = (notes[row.id] ?? "").trim();
              const noteId = `review-note-${row.id}`;
              const busy = deciding === row.id;
              return (
                <li key={row.id} className="overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
                  <div className="flex gap-4 p-4 sm:p-5">
                    <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-[#f4f6f9]">
                      <Thumb src={cover} alt="" className="size-full object-cover" icon={<ImageOff className="size-5 text-[#536b8c]" />} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/products/${row.id}`} className="text-[15px] font-bold text-[#0a285a] hover:underline" dir="auto">
                        {row.title}
                      </Link>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] ink-muted">
                        {row.vendorName ? <bdi className="font-semibold text-[#3d5376]">{row.vendorName}</bdi> : null}
                        <span aria-hidden>·</span>
                        <span>{row.variants.length === 1 ? t("admin.variantOne") : t("admin.variantCount", { count: row.variants.length })}</span>
                        {cheapest !== null && prices.length ? <><span aria-hidden>·</span><span>{money({ amount: cheapest, currencyCode: "KWD" })}</span></> : null}
                        <span aria-hidden>·</span>
                        <span>{formatDate(row.updatedAt)}</span>
                      </p>
                      <ReviewFlags flags={flagsFor(row.id)} productId={row.id} modelAvailable={modelReview.data?.available ?? false} />
                    </div>
                  </div>
                  <div className="border-t border-[#eef1f5] bg-[#fafbfd] px-4 py-4 sm:px-5">
                    <label htmlFor={noteId} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.reviewNote")}</label>
                    <textarea
                      id={noteId}
                      dir="auto"
                      rows={2}
                      maxLength={2000}
                      value={notes[row.id] ?? ""}
                      onChange={event => setNotes({ ...notes, [row.id]: event.target.value })}
                      aria-describedby={`${noteId}-hint`}
                      className={`${textareaClass} mt-1.5 min-h-16`}
                    />
                    <p id={`${noteId}-hint`} className="mt-1 text-[12px] ink-muted">{t("admin.reviewNoteHint")}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => review.mutate({ id: row.id, approve: false, note })}
                        disabled={review.isPending || note === ""}
                        className={buttonClass.secondary}
                      >
                        <Undo2 className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.reject")}
                      </button>
                      <button
                        type="button"
                        onClick={() => review.mutate({ id: row.id, approve: true, note: note || undefined })}
                        disabled={review.isPending}
                        className={buttonClass.primary}
                      >
                        {busy && review.variables?.approve ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                        {t("admin.approve")}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {products.data ? <Pager page={products.data} onPage={setPage} /> : null}
        </>
      )}
    </>
  );
}

const FINDING_LABEL: Record<string, MessageKey> = {
  noImages: "admin.flagNoImages",
  zeroPrice: "admin.flagZeroPrice",
  noCategory: "admin.flagNoCategory",
  thinDescription: "admin.flagThinDescription",
  contactInText: "admin.flagContactInText",
  shoutingTitle: "admin.flagShoutingTitle",
  bannedClaim: "admin.flagBannedClaim",
  modelConcern: "admin.flagModelConcern",
};

/**
 * What was found, and the button that asks a model for one more opinion.
 *
 * **Nothing here refuses anything.** Every finding is a reason to look, and
 * the approve and reject buttons above are untouched — a heuristic that could
 * block a publish would mean a seller's listing rejected by a word list.
 *
 * The model pass is a press rather than automatic: it costs money per listing,
 * and a queue of twenty would spend twenty calls on somebody scrolling. When
 * no key is configured the button is absent rather than saying so, the same
 * choice the shopper's assistant makes.
 */
function ReviewFlags({ flags, productId, modelAvailable }: { flags: Flag[]; productId: number; modelAvailable: boolean }) {
  const { t, tError } = useTranslation();
  const [extra, setExtra] = useState<Flag | null>(null);
  const [asked, setAsked] = useState(false);

  const ask = trpc.inventory.products.modelFlag.useMutation({
    onSuccess: reply => {
      setAsked(true);
      setExtra(reply.flag);
      if (!reply.flag) toast.success(t("admin.flagModelNothing"));
    },
    onError: error => toast.error(tError(error.message)),
  });

  const all = extra ? [...flags, extra] : flags;

  return (
    <div className="mt-3">
      {all.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[13px] text-[#2f5d33]"><Check className="size-4" aria-hidden />{t("admin.flagsNone")}</p>
      ) : (
        <ul className="space-y-1.5" aria-label={t("admin.reviewFindings")}>
          {all.map((flag, index) => (
            <li
              key={`${flag.finding}-${index}`}
              className={`rounded-lg px-3 py-2 text-[13px] leading-5 ${
                flag.severity === "serious"
                  ? "border border-[#f2b69e] bg-[#fdeceb] text-[#8c2f22]"
                  : "border border-[#ecd49a] bg-[#fff8e6] text-[#5c3f0c]"
              }`}
            >
              <span className="font-semibold">{t(FINDING_LABEL[flag.finding] ?? "admin.flagModelConcern")}</span>
              {/* The evidence travels with the finding, so "there is a phone
                  number in the title" shows which number. */}
              {flag.detail ? <span dir="auto"> · {flag.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {/* Absent with no key, rather than a button that answers "nothing found"
          about a question nobody asked. */}
      {modelAvailable ? (
        <button
          type="button"
          disabled={ask.isPending || asked}
          onClick={() => ask.mutate({ id: productId })}
          className={`${smallButtonClass.secondary} mt-2`}
        >
          {ask.isPending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
          {t(asked ? "admin.flagModelAsked" : "admin.flagModelAsk")}
        </button>
      ) : null}
    </div>
  );
}
