/**
 * The applicant's documents on `/sell` (3.3.1): one row per kind — the trade
 * licence, the signatory's civil ID, the bank's IBAN letter, an authorisation
 * to sign, anything else — each with its file, NetLet's decision on it, and
 * a way to add or replace it while the application can still be edited.
 *
 * The file goes straight to `POST /api/applications/documents`, checked here
 * first by the rule the route refuses on, so a 9 MB scan is refused before a
 * phone spends a minute sending it. Opening one is a download from NetLet,
 * never a page: only the applicant and NetLet's reviewers can reach it.
 */
import { LoaderCircle, Paperclip, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import {
  DOCUMENT_KINDS,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  currentByKind,
  type DocumentKind,
  type DocumentStatus,
} from "@shared/inventory/applicationDocuments";
import type { MessageKey } from "@shared/i18n/dictionary";

export const KIND_LABEL: Record<DocumentKind, MessageKey> = {
  trade_licence: "documents.kindTradeLicence",
  signatory_id: "documents.kindSignatoryId",
  iban_letter: "documents.kindIbanLetter",
  authorisation: "documents.kindAuthorisation",
  other: "documents.kindOther",
  contract: "documents.kindContract",
  signed_contract: "documents.kindSignedContract",
};

const KIND_HINT: Record<DocumentKind, MessageKey> = {
  trade_licence: "documents.hintTradeLicence",
  signatory_id: "documents.hintSignatoryId",
  iban_letter: "documents.hintIbanLetter",
  authorisation: "documents.hintAuthorisation",
  other: "documents.hintOther",
  contract: "documents.hintContract",
  signed_contract: "documents.hintSignedContract",
};

/** The papers an applicant applies with; the contract and its signed copy come after (3.3.1). */
export const PAPER_KINDS = DOCUMENT_KINDS.filter(kind => kind !== "contract" && kind !== "signed_contract");

export const STATUS_LABEL: Record<DocumentStatus, MessageKey> = {
  pending: "documents.statusPending",
  accepted: "documents.statusAccepted",
  rejected: "documents.statusRejected",
};

export const STATUS_TONE: Record<DocumentStatus, string> = {
  pending: "bg-[#fff3cd] text-[#6b4f1d]",
  accepted: "bg-[#d4edda] text-[#155724]",
  rejected: "bg-[#fdeceb] text-[#8c2f22]",
};

/** "820 KB", "3.4 MB": the size a person reads, not the byte count. */
export function useFileSize() {
  const { t, locale } = useTranslation();
  return (bytes: number) => {
    const megabytes = bytes >= 1_000_000;
    const value = megabytes ? bytes / 1_000_000 : Math.max(1, Math.round(bytes / 1000));
    const size = new Intl.NumberFormat(locale === "ar" ? "ar-KW" : "en", { maximumFractionDigits: megabytes ? 1 : 0 }).format(value);
    return t(megabytes ? "documents.sizeMb" : "documents.sizeKb", { size });
  };
}

export function documentHref(id: number): string {
  return `/api/applications/documents/${id}`;
}

export function DocumentUploads({ saved, editable, step = "papers" }: {
  saved: boolean;
  editable: boolean;
  /* The papers applied with, or the contract step (3.3.1) — which works while
     NetLet holds the application, so a page draws it outside whatever stops
     the papers changing then. */
  step?: "papers" | "contract";
}) {
  const { t, tError } = useTranslation();
  const size = useFileSize();
  const utils = trpc.useUtils();
  const documents = trpc.inventory.applications.myDocuments.useQuery(undefined, { enabled: saved });
  const [busy, setBusy] = useState<DocumentKind | null>(null);
  const inputs = useRef<Partial<Record<DocumentKind, HTMLInputElement | null>>>({});
  const remove = trpc.inventory.applications.removeDocument.useMutation({
    onSuccess: () => { toast.success(t("documents.removed")); void utils.inventory.applications.myDocuments.invalidate(); },
    onError: error => toast.error(tError(error.message)),
  });

  const upload = async (kind: DocumentKind, file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_DOCUMENT_BYTES) throw new Error("documents.tooLarge");
      if (!(DOCUMENT_TYPES as readonly string[]).includes(file.type)) throw new Error("documents.notAccepted");
      setBusy(kind);
      const response = await fetch("/api/applications/documents", {
        method: "POST",
        headers: { "Content-Type": file.type, "X-NetLet-Document-Kind": kind, "X-NetLet-File-Name": encodeURIComponent(file.name) },
        body: file,
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "documents.failed");
      toast.success(t("documents.uploaded"));
      void utils.inventory.applications.myDocuments.invalidate();
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "documents.failed"));
    } finally {
      setBusy(null);
      const input = inputs.current[kind];
      if (input) input.value = "";
    }
  };

  if (!saved) return step === "papers" ? <p className="mt-4 text-[13px] leading-6 text-[#536b8c]">{t("documents.saveFirst")}</p> : null;

  const current = currentByKind(documents.data ?? []);
  const row = (kind: DocumentKind, mayUpload: boolean) => {
        const entry = current.get(kind);
        const latest = entry?.latest;
        const inputId = `document-${kind}`;
        return (
          <li key={kind} className="p-3.5 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <p className="text-[14px] font-bold text-[#0a285a]">{t(KIND_LABEL[kind])}</p>
                <p id={`${inputId}-hint`} className="mt-0.5 text-[12px] leading-5 ink-muted">{t(KIND_HINT[kind])}</p>
              </div>
              {latest ? <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold ${STATUS_TONE[latest.status]}`}>{t(STATUS_LABEL[latest.status])}</span> : null}
            </div>
            {latest ? (
              <div className="mt-2 text-[13px] text-[#0a285a]">
                <a href={documentHref(latest.id)} download className="inline-flex max-w-full items-center gap-1.5 font-semibold underline-offset-2 hover:underline">
                  <Paperclip className="size-3.5 shrink-0" aria-hidden />
                  <bdi className="truncate">{latest.fileName}</bdi>
                </a>
                <span className="ink-muted"> · {size(latest.byteSize)}</span>
                {latest.status === "rejected" && latest.reviewNote ? (
                  <p dir="auto" className="mt-1 text-[#8c2f22]">{t("documents.reviewerNote", { note: latest.reviewNote })}</p>
                ) : null}
                {entry?.replacing ? <p className="mt-1 ink-muted">{t("documents.replacing", { name: entry.replacing.fileName })}</p> : null}
              </div>
            ) : null}
            {mayUpload ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <input
                  ref={element => { inputs.current[kind] = element; }}
                  id={inputId}
                  type="file"
                  accept={DOCUMENT_TYPES.join(",")}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={event => void upload(kind, event.target.files?.[0])}
                />
                <button
                  type="button"
                  onClick={() => inputs.current[kind]?.click()}
                  disabled={busy !== null}
                  aria-label={`${t(latest ? "documents.replace" : "documents.upload")}: ${t(KIND_LABEL[kind])}`}
                  aria-describedby={`${inputId}-hint`}
                  className="glass pressable inline-flex items-center gap-2 rounded-full border border-[#0a285a]/15 px-4 py-2 disabled:opacity-60"
                >
                  {busy === kind ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
                  {t(latest ? "documents.replace" : "documents.upload")}
                </button>
                {latest && latest.status !== "accepted" && editable ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate({ id: latest.id })}
                    disabled={remove.isPending}
                    aria-label={`${t("documents.remove")}: ${t(KIND_LABEL[kind])}`}
                    className="pressable inline-flex items-center gap-2 rounded-full px-3 py-2 text-[#8c2f22] hover:bg-[#fdeceb]"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("documents.remove")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
  };
  if (step === "contract") {
    const contract = current.get("contract")?.latest;
    if (!contract) return null;
    /* The contract step (3.3.1): NetLet's final contract, to read, sign and
       send back — while NetLet holds the application, too. */
    return (
      <section aria-labelledby="contract-step" className="mt-4 rounded-xl border border-[#0a285a]/20 bg-[#f6f8fb] p-3.5 sm:p-4">
        <h3 id="contract-step" className="text-[14px] font-bold text-[#0a285a]">{t("documents.contractTitle")}</h3>
        <p className="mt-0.5 text-[12px] leading-5 ink-muted">{t("documents.contractNote")}</p>
        <a href={documentHref(contract.id)} download className="mt-2 inline-flex max-w-full items-center gap-1.5 text-[13px] font-semibold text-[#0a285a] underline-offset-2 hover:underline">
          <Paperclip className="size-3.5 shrink-0" aria-hidden />
          <bdi className="truncate">{contract.fileName}</bdi>
        </a>
        <ul className="mt-3 rounded-xl border border-[#d5dfeb] bg-white">
          {row("signed_contract", current.get("signed_contract")?.latest?.status !== "accepted")}
        </ul>
      </section>
    );
  }
  return (
    <ul className="mt-4 divide-y divide-[#e6ebf2] rounded-xl border border-[#d5dfeb]">
      {PAPER_KINDS.map(kind => row(kind, editable))}
    </ul>
  );
}
