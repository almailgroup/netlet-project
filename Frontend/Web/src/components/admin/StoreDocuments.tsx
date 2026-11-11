/**
 * A store's documents (`Shared/inventory/storeDocuments.ts`), on the owner's
 * word: "for the vendors there should be a section that will allow to upload
 * documents for the vendor. Store documents."
 *
 * One card, drawn on a store's page for NetLet and on the store's own
 * "Store documents" page for its owner: the papers kept with the store, each
 * with what it is, when it was added and by whom, where its last day stands,
 * a download and — where the server says this person may — a way to remove
 * it; then a form to add one.
 *
 * **The server decides every button.** Each row carries `mayRemove`, and the
 * list says whether the person asking is NetLet (who may also keep a file
 * from the store). The page checks a file by the shared rule before sending
 * it, so a 9 MB scan is refused before a phone spends a minute on it, and the
 * route refuses the same file besides.
 *
 * A file is opened as a download from NetLet, never as a page: the address
 * answers only NetLet and the store's owner.
 */
import { Download, FileImage, FileText, Lock, LoaderCircle, Paperclip, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, Field, Notice, Pill, Toggle, buttonClass, fieldClass, isolate, smallButtonClass, surfaceClass } from "@/components/admin/ui";
import { QueryGate } from "@/components/admin/QueryGate";
import { useFileSize } from "@/components/account/DocumentUploads";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "@shared/inventory/applicationDocuments";
import type { MessageKey } from "@shared/i18n/dictionary";
import {
  STORE_DOCUMENT_KINDS,
  STORE_DOCUMENT_KIND_LABEL,
  STORE_DOCUMENT_TITLE_MAX,
  isStoreDocumentKind,
  readExpiry,
  type ExpiryState,
  type StoreDocumentKind,
} from "@shared/inventory/storeDocuments";

export function storeDocumentHref(id: number): string {
  return `/api/vendors/documents/${id}`;
}

type Problems = { kind?: MessageKey; file?: MessageKey; expires?: MessageKey };

export function StoreDocuments({ vendorId, audience }: {
  vendorId: number;
  /**
   * Whose page this is: NetLet's view of a store, where it is one card among
   * the store's sections, or the store's own page, which the page's heading
   * already names. Words and frame only — the server decides what each may do.
   */
  audience: "netlet" | "store";
}) {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const size = useFileSize();
  const utils = trpc.useUtils();
  const list = trpc.storeDocuments.list.useQuery({ vendorId });
  const [removing, setRemoving] = useState<{ id: number; name: string } | null>(null);
  const remove = trpc.storeDocuments.remove.useMutation({
    onSuccess: () => { toast.success(t("storeDocs.removed")); setRemoving(null); void utils.storeDocuments.list.invalidate(); },
    onError: error => { setRemoving(null); toast.error(tError(error.message)); void utils.storeDocuments.list.invalidate(); },
  });

  const expiryPill = (expiry: ExpiryState, expiresOn: string | null) => {
    if (expiry.kind === "none" || !expiresOn) return null;
    if (expiry.kind === "expired") return <Pill tone="danger">{t("storeDocs.expired", { date: formatDate(expiresOn) })}</Pill>;
    if (expiry.kind === "soon") return <Pill tone="warning">{expiry.days === 0 ? t("storeDocs.expiresToday") : t("storeDocs.expiresIn", { count: expiry.days })}</Pill>;
    return <Pill tone="neutral">{t("storeDocs.validUntil", { date: formatDate(expiresOn) })}</Pill>;
  };

  const body = (
    <>
      <QueryGate queries={[list]}>
        {() => {
          const data = list.data!;
          if (!data.ready) return <Notice>{t("storeDocs.unavailable")}</Notice>;
          const attention = data.documents.some(document => document.expiry.kind === "expired" || document.expiry.kind === "soon");
          return (
            <>
              {attention ? <Notice tone="warning" className="mb-3">{t("storeDocs.attention")}</Notice> : null}
              {data.documents.length ? (
                <ul className="divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
                  {data.documents.map(document => {
                    const kind = t(STORE_DOCUMENT_KIND_LABEL[document.kind]);
                    const name = document.title ?? kind;
                    const Icon = document.contentType === "application/pdf" ? FileText : FileImage;
                    const by = document.by === "netlet"
                      ? t("storeDocs.byNetLet")
                      : document.uploader
                        ? t("storeDocs.byPerson", { name: isolate(document.uploader) })
                        : document.by === "store" ? t("storeDocs.byStore") : null;
                    return (
                      <li key={document.id} className="flex flex-wrap items-start gap-x-3 gap-y-2.5 p-3.5">
                        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#eef2f8] text-[#0a285a]">
                          <Icon className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1 basis-40">
                          <p dir="auto" className="align-parent text-[14px] leading-6 font-bold break-words text-[#0a285a]">{name}</p>
                          <p className="mt-0.5 text-[13px] leading-5 break-words ink-muted">
                            {document.title ? <>{kind} · </> : null}
                            <bdi>{document.fileName}</bdi> · {size(document.byteSize)} · {formatDate(document.createdAt)}
                            {by ? <> · {by}</> : null}
                          </p>
                          {document.netletOnly || document.expiry.kind !== "none" ? (
                            <p className="mt-2 flex flex-wrap gap-1.5">
                              {expiryPill(document.expiry, document.expiresOn)}
                              {document.netletOnly ? <Pill tone="navy"><Lock className="size-3" aria-hidden />{t("storeDocs.netletOnly")}</Pill> : null}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <a href={storeDocumentHref(document.id)} download aria-label={t("storeDocs.downloadNamed", { name: isolate(name) })} className={smallButtonClass.secondary}>
                            <Download className="size-4" aria-hidden />{t("storeDocs.download")}
                          </a>
                          {document.mayRemove ? (
                            <button type="button" onClick={() => setRemoving({ id: document.id, name })} aria-label={t("storeDocs.removeNamed", { name: isolate(name) })} className={smallButtonClass.quietDanger}>
                              <Trash2 className="size-4" aria-hidden />{t("documents.remove")}
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[14px] ink-muted">{t("storeDocs.none")}</p>
              )}
              {data.room > 0
                ? <AddDocument vendorId={vendorId} netlet={data.netlet} heading={audience === "store" ? "h2" : "h3"} />
                : <Notice className="mt-5">{t("storeDocs.tooManyFiles")}</Notice>}
            </>
          );
        }}
      </QueryGate>

      <ConfirmDialog
        open={removing !== null}
        title={t("storeDocs.removeTitle")}
        body={t("storeDocs.removeBody", { name: isolate(removing?.name ?? "") })}
        confirmLabel={t("documents.remove")}
        tone="danger"
        pending={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate({ id: removing.id })}
      />
    </>
  );
  /* The store's own page names itself in its heading; a card saying
     "Store documents" under it would say it twice. */
  if (audience === "store") return <section aria-label={t("storeDocs.title")} className={`${surfaceClass} p-5 sm:p-6`}>{body}</section>;
  return <Card id="documents" title={t("storeDocs.title")} description={t("storeDocs.noteAdmin")}>{body}</Card>;
}

/**
 * The form that adds one: what kind of paper, a name, its last day, the file
 * and — for NetLet — whether the store sees it. What is wrong is said under
 * its box when Upload is pressed and leaves with the fix; a file that cannot
 * be taken is said as it is chosen, being the answer to that press.
 */
function AddDocument({ vendorId, netlet, heading: Heading }: {
  vendorId: number;
  netlet: boolean;
  /** One level under whatever names the section: the card's `h2`, or the store's own page's `h1`. */
  heading: "h2" | "h3";
}) {
  const { t, tError } = useTranslation();
  const size = useFileSize();
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<StoreDocumentKind | "">("");
  const [title, setTitle] = useState("");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [onlyNetLet, setOnlyNetLet] = useState(false);
  const [problems, setProblems] = useState<Problems>({});
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const choose = useRef<HTMLButtonElement | null>(null);
  const kindBox = useRef<HTMLDivElement | null>(null);
  const fileLabel = useId();
  const fileNote = useId();

  const fileProblem = (chosen: File): MessageKey | null => {
    if (chosen.size === 0) return "documents.empty";
    if (chosen.size > MAX_DOCUMENT_BYTES) return "documents.tooLarge";
    if (!(DOCUMENT_TYPES as readonly string[]).includes(chosen.type)) return "documents.notAccepted";
    return null;
  };

  const pick = (chosen: File | undefined) => {
    if (!chosen) return;
    const problem = fileProblem(chosen);
    setFile(problem ? null : chosen);
    setProblems(current => ({ ...current, file: problem ?? undefined }));
    if (input.current) input.current.value = "";
  };

  const submit = async () => {
    const found: Problems = {};
    if (!isStoreDocumentKind(kind)) found.kind = "storeDocs.chooseKind";
    if (!readExpiry(expires).ok) found.expires = "storeDocs.badExpiry";
    if (!file) found.file = problems.file ?? "storeDocs.needFile";
    setProblems(found);
    if (found.kind) { kindBox.current?.querySelector<HTMLElement>("button, select")?.focus(); return; }
    if (found.expires) { document.getElementById(`store-document-expires-${vendorId}`)?.focus(); return; }
    if (found.file || !file) { choose.current?.focus(); return; }
    setBusy(true);
    try {
      const headers: Record<string, string> = {
        "Content-Type": file.type,
        "X-NetLet-Document-Kind": kind,
        "X-NetLet-File-Name": encodeURIComponent(file.name),
      };
      if (title.trim()) headers["X-NetLet-Document-Title"] = encodeURIComponent(title.trim());
      if (expires) headers["X-NetLet-Document-Expires"] = expires;
      if (netlet && onlyNetLet) headers["X-NetLet-Only"] = "1";
      const response = await fetch(`/api/vendors/${vendorId}/documents`, { method: "POST", headers, body: file, credentials: "same-origin" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "documents.failed");
      toast.success(t("storeDocs.uploaded"));
      setKind("");
      setTitle("");
      setExpires("");
      setFile(null);
      setOnlyNetLet(false);
      setProblems({});
      void utils.storeDocuments.list.invalidate();
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "documents.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-5 border-t border-[#eef1f5] pt-4"
      noValidate
      onSubmit={event => { event.preventDefault(); void submit(); }}
    >
      <Heading className="text-[14px] font-bold text-[#0a285a]">{t("storeDocs.add")}</Heading>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div ref={kindBox}>
          <Field label={t("storeDocs.kind")} error={problems.kind ? t(problems.kind) : undefined}>
            <Select
              value={kind}
              onChange={event => {
                const value = event.target.value;
                setKind(isStoreDocumentKind(value) ? value : "");
                setProblems(current => ({ ...current, kind: undefined }));
              }}
            >
              <option value="">{t("storeDocs.kindPlaceholder")}</option>
              {STORE_DOCUMENT_KINDS.map(entry => (
                <option key={entry} value={entry}>{t(STORE_DOCUMENT_KIND_LABEL[entry])}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("storeDocs.name")} hint={t("storeDocs.nameHint")} optional>
          <input dir="auto" value={title} maxLength={STORE_DOCUMENT_TITLE_MAX} onChange={event => setTitle(event.target.value)} className={fieldClass} />
        </Field>
        <Field label={t("storeDocs.expires")} hint={t("storeDocs.expiresHint")} error={problems.expires ? t(problems.expires) : undefined} optional>
          <input
            id={`store-document-expires-${vendorId}`}
            type="date"
            value={expires}
            min="2000-01-01"
            max="2100-12-31"
            onChange={event => { setExpires(event.target.value); setProblems(current => ({ ...current, expires: undefined })); }}
            className={fieldClass}
          />
        </Field>
        <div>
          <p id={fileLabel} className="text-[13px] leading-5 font-semibold text-[#0a285a]">{t("storeDocs.file")}</p>
          <div className="mt-1.5 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
            <input
              ref={input}
              type="file"
              accept={DOCUMENT_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={event => pick(event.target.files?.[0])}
            />
            <button
              ref={choose}
              type="button"
              onClick={() => input.current?.click()}
              aria-labelledby={`${fileLabel} ${fileLabel}-press`}
              aria-describedby={fileNote}
              aria-invalid={problems.file ? true : undefined}
              className={buttonClass.secondary}
            >
              <Paperclip className="size-4" aria-hidden /><span id={`${fileLabel}-press`}>{t("storeDocs.chooseFile")}</span>
            </button>
            {file ? (
              <span className="min-w-0 text-[13px] leading-5 text-[#0a285a]">
                <bdi className="font-semibold break-all">{file.name}</bdi> <span className="ink-muted">· {size(file.size)}</span>
              </span>
            ) : null}
          </div>
          <p id={fileNote} className={`mt-1.5 text-[12px] leading-5 ${problems.file ? "font-semibold text-[#8c2f22]" : "ink-muted"}`} role={problems.file ? "alert" : undefined}>
            {problems.file ? t(problems.file) : t("storeDocs.fileHint")}
          </p>
        </div>
      </div>
      {netlet ? (
        <Toggle className="mt-4" checked={onlyNetLet} onChange={setOnlyNetLet} label={t("storeDocs.onlyNetLet")} hint={t("storeDocs.onlyNetLetHint")} />
      ) : null}
      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={busy} className={buttonClass.primary}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {t(busy ? "storeDocs.uploading" : "storeDocs.upload")}
        </button>
      </div>
    </form>
  );
}
