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
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { Check, LoaderCircle, X } from "lucide-react";
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
  const products = trpc.inventory.products.list.useQuery({});

  const review = trpc.inventory.products.review.useMutation({
    onSuccess: () => { void utils.inventory.products.list.invalidate(); toast.success(t("admin.saved")); },
    onError: () => toast.error(t("admin.forbidden")),
  });

  const waiting = (products.data ?? []).filter(row => row.status === "pending_review");

  if (products.isLoading || products.isError) return <QueryGate queries={[products]}>{() => null}</QueryGate>;

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.review")}</h1>
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
                  <Link href={`/admin/products/${row.id}`} className="font-bold text-[#0a285a] hover:ink-accent" dir="auto">
                    {row.title}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-[#9ea4b5]">
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
              <input
                dir="auto"
                value={notes[row.id] ?? ""}
                onChange={event => setNotes({ ...notes, [row.id]: event.target.value })}
                aria-label={t("admin.reviewNote")}
                placeholder={t("admin.reviewNote")}
                className="type-body mt-3 h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] outline-none focus:border-[#f2683a]"
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
