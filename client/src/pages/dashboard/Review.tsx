/**
 * The review queue: products a vendor has asked to publish.
 *
 * Rejecting takes a note, and the note is not optional in spirit — a rejection
 * with no reason sends the vendor back to guess. It is written onto the
 * product, so they read it on the page they have to fix rather than in a
 * separate message they may never see.
 */
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { Check, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

export default function DashboardReview() {
  usePageMeta(privatePageMeta("Review queue"));
  return <DashboardShell need={"product.review"}>{() => <Queue />}</DashboardShell>;
}

function Queue() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [notes, setNotes] = useState<Record<number, string>>({});
  const products = trpc.inventory.products.list.useQuery({});

  const review = trpc.inventory.products.review.useMutation({
    onSuccess: () => { void utils.inventory.products.list.invalidate(); toast.success(t("dash.saved")); },
    onError: () => toast.error(t("dash.forbidden")),
  });

  const waiting = (products.data ?? []).filter(row => row.status === "pending_review");

  if (products.isLoading) return <p className="text-sm text-[#536b8c]">{t("dash.loading")}</p>;

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("dash.review")}</h1>
      {waiting.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t("dash.nothingToReview")}</p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {waiting.map(row => (
            <article key={row.id} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/dashboard/products/${row.id}`} className="font-bold text-[#0a285a] hover:text-[#f2683a]" dir="auto">
                    {row.title}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-[#9ea4b5]">
                    {t("dash.columnVendor")} #{row.vendorId} · {row.variants.length === 1 ? t("dash.variantOne") : t("dash.variantCount", { count: row.variants.length })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => review.mutate({ id: row.id, approve: true })}
                    disabled={review.isPending}
                    className="glass glass-accent pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-extrabold disabled:opacity-60"
                  >
                    {review.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    {t("dash.approve")}
                  </button>
                  <button
                    onClick={() => review.mutate({ id: row.id, approve: false, note: notes[row.id] || undefined })}
                    disabled={review.isPending}
                    className="glass pressable inline-flex items-center gap-1.5 rounded-full border border-[#0a285a]/15 px-4 py-2 text-[11px] font-extrabold disabled:opacity-60"
                  >
                    <X className="size-3.5" />{t("dash.reject")}
                  </button>
                </div>
              </div>
              <input
                dir="auto"
                value={notes[row.id] ?? ""}
                onChange={event => setNotes({ ...notes, [row.id]: event.target.value })}
                aria-label={t("dash.reviewNote")}
                placeholder={t("dash.reviewNote")}
                className="type-body mt-3 h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] outline-none focus:border-[#f2683a]"
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
