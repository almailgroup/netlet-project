/**
 * The warranty desk (migration 0072): a store's claims, or every store's for
 * NetLet, waiting ones first.
 *
 * Each card is what the shopper filed — the item, their words and photos,
 * the store's own warranty words beside it — and the buttons
 * `warrantyActions` allows: accept with a remedy, or decline with a reason
 * the shopper reads; a repair accepted is the store's to mark done. A
 * replacement or a refund becomes an approved return on `/admin/returns`,
 * which collects the item and settles it, and this card follows it there.
 * The shopper is named by their first name and nothing else — a store needs
 * to know who, never how to reach them.
 */
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { EmptyState, PageHeader, Pill, Segmented, SkeletonRows, smallButtonClass, fieldClass } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { Actor } from "@shared/inventory/permissions";
import { MAX_WARRANTY_RESPONSE, type ClaimStage, type WarrantyRemedy } from "@shared/commerce/warranty";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import type { AppRouter } from "../../../../../Backend/src/routes";
import type { inferRouterOutputs } from "@trpc/server";

type Row = inferRouterOutputs<AppRouter>["warranty"]["list"][number];

const STAGE: Record<ClaimStage, { label: MessageKey; tone: "warning" | "navy" | "good" | "danger" | "neutral" }> = {
  waiting: { label: "warranty.stageWaiting", tone: "warning" },
  repairing: { label: "warranty.stageRepairing", tone: "navy" },
  returning: { label: "warranty.stageReturning", tone: "navy" },
  done: { label: "warranty.stageDone", tone: "good" },
  declined: { label: "warranty.stageDeclined", tone: "danger" },
  withdrawn: { label: "warranty.stageWithdrawn", tone: "neutral" },
};

const REMEDIES: { value: WarrantyRemedy; label: MessageKey }[] = [
  { value: "repair", label: "warranty.deskRepair" },
  { value: "replace", label: "warranty.deskReplace" },
  { value: "refund", label: "warranty.deskRefund" },
];

export default function AdminWarranty() {
  usePageMeta(privatePageMeta("Warranty"));
  return <AdminShell need="returns.handle">{actor => <Desk actor={actor} />}</AdminShell>;
}

function Desk({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const [view, setView] = useState<"waiting" | "all">("waiting");
  const list = trpc.warranty.list.useQuery({ waiting: view === "waiting" });
  return (
    <>
      <PageHeader title={t("warranty.deskTitle")} description={t("warranty.deskNote")} />
      <Segmented
        label={t("warranty.deskTitle")}
        className="mb-4 w-fit"
        value={view}
        onChange={setView}
        options={[{ value: "waiting", label: t("admin.returnsTabOpen") }, { value: "all", label: t("admin.returnsTabAll") }]}
      />
      {list.isLoading ? (
        <SkeletonRows rows={3} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[list]}>
          {() => {
            const rows = list.data ?? [];
            if (!rows.length) return <EmptyState title={t("warranty.deskNone")} />;
            return <ul className="space-y-3">{rows.map(row => <ClaimCard key={row.id} row={row} actor={actor} />)}</ul>;
          }}
        </QueryGate>
      )}
    </>
  );
}

function ClaimCard({ row, actor }: { row: Row; actor: Actor }) {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"accept" | "decline" | "complete" | null>(null);
  const [remedy, setRemedy] = useState<WarrantyRemedy>("repair");
  const [words, setWords] = useState("");
  const refresh = () => {
    void utils.warranty.list.invalidate();
    void utils.warranty.waitingCount.invalidate();
    void utils.returns.list.invalidate();
    void utils.returns.waiting.invalidate();
  };
  const fail = (error: { message: string }) => toast.error(tError(error.message));
  const decide = trpc.warranty.decide.useMutation({
    onSuccess: () => { setMode(null); setWords(""); toast.success(t("warranty.deskSaved")); refresh(); },
    onError: fail,
  });
  const complete = trpc.warranty.complete.useMutation({
    onSuccess: () => { setMode(null); setWords(""); toast.success(t("warranty.deskSaved")); refresh(); },
    onError: fail,
  });
  const stage = STAGE[row.stage];

  return (
    <li className="overflow-hidden rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p dir="auto" className="text-[15px] font-bold text-[#0a285a]">
            {row.productTitle}
            {row.quantity > 1 ? <span className="text-[13px] font-semibold text-[#536b8c]"> ×{row.quantity}</span> : null}
          </p>
          <p className="mt-0.5 text-[13px] ink-muted">
            <bdi dir="ltr" className="font-semibold text-[#3d5376]">{row.reference}</bdi>
            {actor.kind === "admin" && row.vendorName ? <> · <bdi>{row.vendorName}</bdi></> : null}
            {row.shopper ? <> · <bdi>{row.shopper}</bdi></> : null}
            {" · "}{formatDate(row.createdAt)}
          </p>
        </div>
        <Pill tone={stage.tone}>{t(stage.label)}</Pill>
      </div>
      <p className="mt-2 text-[12px] ink-muted">
        {row.deliveredAt ? t("warranty.deskDelivered", { date: formatDate(row.deliveredAt) }) : null}
        {row.terms ? <> · {t("warranty.storeTerms")} <bdi dir="auto" className="font-semibold text-[#3d5376]">{row.terms}</bdi></> : <> · {t("warranty.deskNoTerms")}</>}
      </p>
      <p dir="auto" className="mt-3 rounded-xl bg-[#f4f6f9] px-3.5 py-2.5 text-[14px] leading-6 text-[#3d5376]">{row.problem}</p>
      {row.photos.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {row.photos.map(photo => (
            <li key={photo}>
              <a href={photo} target="_blank" rel="noreferrer" aria-label={t("warranty.deskPhoto")}>
                <img src={photo} alt="" loading="lazy" decoding="async" className="size-20 rounded-lg border border-[#e7edf5] object-cover" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {row.response ? (
        <p className="mt-2 text-[13px] leading-5 text-[#3d5376]">
          <span className="font-semibold text-[#0a285a]">{t("warranty.deskAnswer")} </span><bdi dir="auto">{row.response}</bdi>
        </p>
      ) : null}
      {row.stage === "returning" ? (
        <p className="mt-2 text-[13px]"><Link href="/admin/returns" className="font-bold text-[#0a285a] underline underline-offset-2">{t("warranty.deskOpenReturn")}</Link></p>
      ) : null}

      {mode ? (
        <div className="mt-3 space-y-2 rounded-xl border border-[#d5dfeb] p-3">
          {mode === "accept" ? (
            <fieldset>
              <legend className="text-[13px] font-semibold text-[#0a285a]">{t("warranty.deskRemedy")}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {REMEDIES.map(option => (
                  <label key={option.value} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] ${remedy === option.value ? "border-[#0a285a] bg-[#f4f6fa] font-bold text-[#0a285a]" : "border-[#d5dfeb] text-[#3d5376]"}`}>
                    <input type="radio" name={`remedy-${row.id}`} checked={remedy === option.value} onChange={() => setRemedy(option.value)} className="size-4 accent-[#0a285a]" />
                    {t(option.label)}
                  </label>
                ))}
              </div>
              {remedy !== "repair" ? <p className="mt-2 text-[12px] ink-muted">{t("warranty.deskBecomesReturn")}</p> : null}
            </fieldset>
          ) : null}
          <label className="block">
            <span className="text-[13px] font-semibold text-[#0a285a]">
              {t(mode === "decline" ? "warranty.deskWhy" : mode === "complete" ? "warranty.deskDoneNote" : "warranty.deskHow")}
            </span>
            <textarea value={words} onChange={event => setWords(event.target.value)} maxLength={MAX_WARRANTY_RESPONSE} rows={2} dir="auto" className={`${fieldClass} mt-1 h-auto py-2`} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={decide.isPending || complete.isPending}
              onClick={() => mode === "complete"
                ? complete.mutate({ id: row.id, note: words })
                : decide.mutate({ id: row.id, accept: mode === "accept", remedy: mode === "accept" ? remedy : null, response: words })}
              className={smallButtonClass.primary}
            >
              {t(mode === "decline" ? "warranty.deskDecline" : mode === "complete" ? "warranty.deskComplete" : "warranty.deskAccept")}
            </button>
            <button type="button" onClick={() => setMode(null)} className={smallButtonClass.secondary}>{t("claims.cancel")}</button>
          </div>
        </div>
      ) : row.actions.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {row.actions.includes("accept") ? (
            <button type="button" onClick={() => setMode("accept")} className={smallButtonClass.primary}>
              <ShieldCheck className="size-3.5" aria-hidden />{t("warranty.deskAccept")}
            </button>
          ) : null}
          {row.actions.includes("decline") ? <button type="button" onClick={() => setMode("decline")} className={smallButtonClass.secondary}>{t("warranty.deskDecline")}</button> : null}
          {row.actions.includes("complete") ? <button type="button" onClick={() => setMode("complete")} className={smallButtonClass.primary}>{t("warranty.deskComplete")}</button> : null}
        </div>
      ) : null}
    </li>
  );
}
