/**
 * "Warranty" on the opened order — file a claim on something that stopped
 * working and follow it (migration 0072, on the owner's word: "submit
 * warranty claims and track their progress").
 *
 * Every claim on the order is listed with where it stands (`claimStage`, the
 * one word the store's desk reads too): waiting for the store, being
 * repaired, on its way back through a return for a replacement or refund,
 * done, declined with the store's reason, or withdrawn. The form offers only
 * the items `warrantyEligibility` allows, beside the store's own warranty
 * words, and the shopper's description and photos — never a phone number,
 * the contact filter's rule, said before anything is sent.
 */
import { useId, useState } from "react";
import { toast } from "sonner";
import { Camera, LoaderCircle, PackageSearch, ShieldCheck, X } from "lucide-react";
import { Thumb } from "@/components/product/Thumb";
import { useTranslation } from "@/hooks/useTranslation";
import { useDateFormat } from "@/hooks/useDateFormat";
import { preparePhoto } from "@/lib/preparePhoto";
import { trpc } from "@/lib/trpc";
import type { Detail } from "@/components/account/LineReturn";
import { MAX_WARRANTY_PHOTOS, MAX_WARRANTY_PROBLEM, problemIssue, type ClaimStage } from "@shared/commerce/warranty";
import type { MessageKey } from "@shared/i18n/dictionary";

const STAGE: Record<ClaimStage, { label: MessageKey; className: string }> = {
  waiting: { label: "warranty.stageWaiting", className: "bg-[#fdf1d6] text-[#7a5200]" },
  repairing: { label: "warranty.stageRepairing", className: "bg-[#dbe7fb] text-[#274b86]" },
  returning: { label: "warranty.stageReturning", className: "bg-[#dbe7fb] text-[#274b86]" },
  done: { label: "warranty.stageDone", className: "bg-[#d8ead8] text-[#2f5d33]" },
  declined: { label: "warranty.stageDeclined", className: "bg-[#fdeceb] text-[#8c2f22]" },
  withdrawn: { label: "warranty.stageWithdrawn", className: "bg-[#e7edf5] text-[#536b8c]" },
};

const REMEDY: Record<string, MessageKey> = {
  repair: "warranty.remedyRepair",
  replace: "warranty.remedyReplace",
  refund: "warranty.remedyRefund",
};

export function WarrantyStagePill({ stage }: { stage: ClaimStage }) {
  const { t } = useTranslation();
  const look = STAGE[stage];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-extrabold ${look.className}`}>{t(look.label)}</span>;
}

/** The claims on this order, newest first — drawn whenever there is one. */
export function WarrantyClaims({ detail, onChanged }: { detail: Detail; onChanged: () => void }) {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const withdraw = trpc.warranty.withdraw.useMutation({
    onSuccess: () => { toast.success(t("warranty.withdrawn")); onChanged(); },
    onError: error => toast.error(tError(error.message)),
  });
  if (!detail.warranty.length) return null;
  const titles = new Map(detail.lines.map(line => [line.id, line.productTitle]));
  return (
    <section aria-label={t("warranty.claims")} className="mt-3 space-y-2">
      {detail.warranty.map(claim => (
        <article key={claim.id} className="rounded-2xl border border-[#d5dfeb] bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-extrabold text-[#0a285a]">
              <ShieldCheck className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{t("warranty.claimOn", { item: `⁨${titles.get(claim.orderItemId) ?? ""}⁩` })}</span>
            </p>
            <WarrantyStagePill stage={claim.stage} />
          </div>
          <p dir="auto" className="mt-2 text-[13px] leading-5 text-[#1f2a44]">{claim.problem}</p>
          {claim.photos.length ? (
            <ul className="mt-2 flex gap-2">
              {claim.photos.map(photo => (
                <li key={photo}><img src={photo} alt="" loading="lazy" decoding="async" className="size-14 rounded-lg border border-[#e7edf5] object-cover" /></li>
              ))}
            </ul>
          ) : null}
          {claim.remedy ? <p className="mt-2 text-[12px] font-bold text-[#0a285a]">{t(REMEDY[claim.remedy] ?? "warranty.remedyRepair")}</p> : null}
          {claim.response ? (
            <p className="mt-1 rounded-xl bg-[#f4f6fa] px-3 py-2 text-[13px] leading-5 text-[#1f2a44]">
              <span className="font-bold">{t("warranty.storeSaid")} </span><bdi dir="auto">{claim.response}</bdi>
            </p>
          ) : null}
          <p className="mt-2 text-[12px] ink-muted">{t("warranty.filedOn", { date: formatDate(claim.createdAt) })}</p>
          {claim.stage === "returning" ? <p className="mt-1 text-[12px] ink-muted">{t("warranty.followReturn")}</p> : null}
          {claim.actions.includes("withdraw") ? (
            <button
              type="button"
              onClick={() => withdraw.mutate({ id: claim.id })}
              disabled={withdraw.isPending}
              className="pressable mt-2 inline-flex min-h-11 items-center rounded-full px-2 text-[12px] font-extrabold text-[#8c2f22] underline underline-offset-2 pointer-fine:min-h-8"
            >
              {t("warranty.withdraw")}
            </button>
          ) : null}
        </article>
      ))}
    </section>
  );
}

/**
 * The form: which item, what is wrong, and photos if they help. Opened from
 * an item's ⋯ it is about that item alone (`lineId`).
 */
export function WarrantyForm({ reference, detail, lineId, onDone, onCancel }: {
  reference: string;
  detail: Detail;
  lineId?: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, tError } = useTranslation();
  const ids = useId();
  const eligible = detail.lines.filter(line => line.warrantyEligibility.allowed && (lineId === undefined || line.id === lineId));
  const [chosen, setChosen] = useState<number | null>(eligible.length === 1 ? eligible[0].id : null);
  const [problem, setProblem] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [tried, setTried] = useState(false);
  const file = trpc.warranty.file.useMutation({
    onSuccess: () => { toast.success(t("warranty.sent")); onDone(); },
    onError: error => toast.error(tError(error.message)),
  });

  const issue = chosen === null ? "warranty.pickItem" : problemIssue(problem);
  const line = eligible.find(entry => entry.id === chosen) ?? null;

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_WARRANTY_PHOTOS - photos.length - uploading;
    for (const picked of Array.from(files).slice(0, Math.max(0, room))) {
      setUploading(count => count + 1);
      try {
        const prepared = await preparePhoto(picked, false);
        if (typeof prepared === "string") throw new Error(prepared);
        const response = await fetch("/api/media/review", { method: "POST", headers: { "Content-Type": prepared.type }, body: prepared.blob, credentials: "same-origin" });
        const answer = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!response.ok || !answer.url) throw new Error(answer.error ?? "review.photoFailed");
        setPhotos(current => (current.length < MAX_WARRANTY_PHOTOS ? [...current, answer.url!] : current));
      } catch (error) {
        toast.error(tError(error instanceof Error ? error.message : "review.photoFailed"));
      } finally {
        setUploading(count => count - 1);
      }
    }
  };

  return (
    <form
      noValidate
      aria-labelledby={`${ids}-title`}
      className="mt-3 rounded-2xl border border-[#d5dfeb] bg-white p-4"
      onSubmit={event => {
        event.preventDefault();
        setTried(true);
        if (issue || chosen === null) return;
        file.mutate({ reference, orderItemId: chosen, problem: problem.trim(), photos });
      }}
    >
      <h4 id={`${ids}-title`} className="text-[14px] font-extrabold text-[#0a285a]">{t("warranty.title")}</h4>
      <p className="mt-1 text-[12px] leading-5 ink-muted">{t("warranty.note")}</p>
      <fieldset className="mt-3">
        <legend className="text-[12px] font-extrabold ink-muted">{t("warranty.which")}</legend>
        <ul className="mt-2 space-y-2">
          {eligible.map(entry => (
            <li key={entry.id}>
              <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${chosen === entry.id ? "border-[#0a285a] bg-[#f4f6fa]" : "border-[#e7edf5]"}`}>
                <input type="radio" name={`${ids}-item`} checked={chosen === entry.id} onChange={() => setChosen(entry.id)} className="size-4 shrink-0 accent-[#0a285a]" />
                <Thumb src={entry.photo ?? null} alt="" className="size-10 shrink-0 rounded-lg border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-4" />} />
                <span dir="auto" className="min-w-0 flex-1 truncate text-[13px] font-bold text-[#0a285a]">{entry.productTitle}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {line ? (
        <p className="mt-2 text-[12px] leading-5 ink-muted">
          {line.warrantyTerms ? <>{t("warranty.storeTerms")} <bdi dir="auto" className="font-bold text-[#0a285a]">{line.warrantyTerms}</bdi></> : t("warranty.noTerms")}
        </p>
      ) : null}
      <label className="mt-3 block">
        <span className="block text-[12px] font-extrabold ink-muted">{t("warranty.problem")}</span>
        <textarea
          value={problem}
          onChange={event => setProblem(event.target.value)}
          maxLength={MAX_WARRANTY_PROBLEM}
          rows={3}
          dir="auto"
          aria-invalid={tried && issue && issue !== "warranty.pickItem" ? true : undefined}
          className="glass-field mt-1 w-full rounded-2xl px-3 py-2 text-sm"
        />
      </label>
      {tried && issue ? <p role="alert" className="mt-1 text-[12px] font-semibold text-[#8c2f22]">{t(issue)}</p> : null}

      <div className="mt-3">
        <span className="block text-[12px] font-extrabold ink-muted">{t("warranty.photos")}</span>
        <ul className="mt-2 flex flex-wrap gap-2">
          {photos.map(photo => (
            <li key={photo} className="relative">
              <img src={photo} alt="" loading="lazy" decoding="async" className="size-16 rounded-lg border border-[#e7edf5] object-cover" />
              <button
                type="button"
                onClick={() => setPhotos(current => current.filter(entry => entry !== photo))}
                aria-label={t("review.removePhoto")}
                className="absolute -end-2 -top-2 grid size-7 place-items-center rounded-full bg-[#0a285a] text-white"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
          {photos.length + uploading < MAX_WARRANTY_PHOTOS ? (
            <li>
              <label className="grid size-16 cursor-pointer place-items-center rounded-lg border border-dashed border-[#9fb0c6] text-[#0a285a]">
                {uploading ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <Camera className="size-5" aria-hidden />}
                <span className="sr-only">{t("warranty.addPhoto")}</span>
                <input type="file" accept="image/*" multiple className="sr-only" onChange={event => { void addPhotos(event.target.files); event.target.value = ""; }} />
              </label>
            </li>
          ) : null}
        </ul>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={file.isPending || uploading > 0} className="glass-navy type-control pressable inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-60 pointer-fine:min-h-9">
          {file.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {t("warranty.send")}
        </button>
        <button type="button" onClick={onCancel} className="glass type-control pressable min-h-11 rounded-full px-4 py-2 pointer-fine:min-h-9">
          {t("claims.cancel")}
        </button>
      </div>
    </form>
  );
}
