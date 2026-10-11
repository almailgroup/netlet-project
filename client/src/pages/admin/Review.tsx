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
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { Check, LoaderCircle, Sparkles, X } from "lucide-react";
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
  const { t } = useTranslation();
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

  const review = trpc.inventory.products.review.useMutation({
    onSuccess: () => { void utils.inventory.products.list.invalidate(); toast.success(t("admin.saved")); },
    onError: () => toast.error(t("admin.forbidden")),
  });

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

  if (products.isLoading || products.isError) return <QueryGate queries={[products]}>{() => null}</QueryGate>;

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.review")}</h1>
      {waiting.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t("admin.nothingToReview")}</p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {waiting.map(row => (
            <article key={row.id} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/admin/products/${row.id}`} className="font-bold text-[#0a285a] hover:text-[#a44a2b]" dir="auto">
                    {row.title}
                  </Link>
                  <p className="mt-0.5 text-[11px] ink-muted">
                    {t("admin.columnVendor")} #{row.vendorId} · {row.variants.length === 1 ? t("admin.variantOne") : t("admin.variantCount", { count: row.variants.length })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => review.mutate({ id: row.id, approve: true })}
                    disabled={review.isPending}
                    className="glass glass-accent pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-extrabold disabled:opacity-60"
                  >
                    {review.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    {t("admin.approve")}
                  </button>
                  <button
                    onClick={() => review.mutate({ id: row.id, approve: false, note: notes[row.id] || undefined })}
                    disabled={review.isPending}
                    className="glass pressable inline-flex items-center gap-1.5 rounded-full border border-[#0a285a]/15 px-4 py-2 text-[11px] font-extrabold disabled:opacity-60"
                  >
                    <X className="size-3.5" />{t("admin.reject")}
                  </button>
                </div>
              </div>
              <ReviewFlags flags={flagsFor(row.id)} productId={row.id} modelAvailable={modelReview.data?.available ?? false} />

              <input
                dir="auto"
                value={notes[row.id] ?? ""}
                onChange={event => setNotes({ ...notes, [row.id]: event.target.value })}
                aria-label={t("admin.reviewNote")}
                placeholder={t("admin.reviewNote")}
                className="type-body mt-3 h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] outline-none focus:border-[#0a285a]"
              />
            </article>
          ))}
          {products.data ? <Pager page={products.data} onPage={setPage} /> : null}
        </div>
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
  const { t } = useTranslation();
  const [extra, setExtra] = useState<Flag | null>(null);
  const [asked, setAsked] = useState(false);

  const ask = trpc.inventory.products.modelFlag.useMutation({
    onSuccess: reply => {
      setAsked(true);
      setExtra(reply.flag);
      if (!reply.flag) toast.success(t("admin.flagModelNothing"));
    },
    onError: () => toast.error(t("admin.saveFailed")),
  });

  const all = extra ? [...flags, extra] : flags;

  return (
    <div className="mt-3">
      {all.length === 0 ? (
        <p className="text-[11px] ink-muted">{t("admin.flagsNone")}</p>
      ) : (
        <ul className="space-y-1">
          {all.map((flag, index) => (
            <li
              key={`${flag.finding}-${index}`}
              className={`rounded-xl px-3 py-2 text-[12px] leading-5 ${
                flag.severity === "serious"
                  ? "border border-[#f2b69e] bg-[#fdeceb] text-[#8c2f22]"
                  : "border border-[#d5dfeb] bg-[#f3f2ed] text-[#536b8c]"
              }`}
            >
              <span className="font-extrabold">{t(FINDING_LABEL[flag.finding] ?? "admin.flagModelConcern")}</span>
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
          className="glass type-control pressable mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 disabled:opacity-60"
        >
          {ask.isPending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
          {t(asked ? "admin.flagModelAsked" : "admin.flagModelAsk")}
        </button>
      ) : null}
    </div>
  );
}
