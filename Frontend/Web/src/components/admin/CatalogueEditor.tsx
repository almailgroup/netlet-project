/**
 * A product's catalogues in its editor (`Shared/inventory/productCatalogues.ts`),
 * for the store's managers and owner and for NetLet: the PDFs under the
 * product, where each stands — on the product page, waiting for NetLet, or
 * turned down with NetLet's reason — and a form to add one.
 *
 * **A file over 5 MB is made smaller here first** (`lib/shrinkPdf.ts`): its
 * pictures re-encoded smaller, its text left as it is, and the form says what
 * it came to. One that is still too large is refused with its size, before a
 * byte is sent. Then the file goes up in parts (`CATALOGUE_PART_BYTES`), the
 * button saying how far along it is.
 *
 * **The server decides where it lands**: the card says before the press
 * whether an upload goes on the page at once (NetLet's, or a store that
 * publishes without review) or waits for NetLet, from the editor's own answer.
 */
import { FileText, LoaderCircle, Paperclip, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, Field, Notice, Pill, buttonClass, fieldClass, isolate, smallButtonClass } from "@/components/admin/ui";
import { QueryGate } from "@/components/admin/QueryGate";
import { CatalogueActions } from "@/components/product/ProductCatalogues";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useTranslation } from "@/hooks/useTranslation";
import { useFileSize } from "@/lib/fileSize";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";
import {
  CATALOGUE_PART_BYTES,
  CATALOGUE_TITLE_MAX,
  MAX_CATALOGUES_PER_PRODUCT,
  MAX_CATALOGUE_BYTES,
  catalogueName,
  catalogueTitleProblem,
  startsLikePdf,
} from "@shared/inventory/productCatalogues";

type Problems = { file?: MessageKey; fileSize?: string; title?: MessageKey; titleAr?: MessageKey };

export function CatalogueEditor({ productId }: { productId: number }) {
  const { t, tError, locale } = useTranslation();
  const formatDate = useDateFormat();
  const size = useFileSize();
  const utils = trpc.useUtils();
  const editor = trpc.catalogues.editor.useQuery({ productId });
  const [removing, setRemoving] = useState<{ id: number; name: string } | null>(null);
  const remove = trpc.catalogues.remove.useMutation({
    onSuccess: () => { toast.success(t("catalogue.removed")); setRemoving(null); void utils.catalogues.editor.invalidate({ productId }); },
    onError: error => { setRemoving(null); toast.error(tError(error.message)); void utils.catalogues.editor.invalidate({ productId }); },
  });

  return (
    <Card
      id="catalogues"
      title={t("catalogue.heading")}
      description={t("catalogue.editorIntro", { count: MAX_CATALOGUES_PER_PRODUCT })}
    >
      <QueryGate queries={[editor]}>
        {() => {
          const data = editor.data!;
          if (!data.ready) return <Notice>{t("catalogue.unavailable")}</Notice>;
          return (
            <>
              <p className="mb-3 text-[13px] leading-5 ink-muted">{t(data.goesLive ? "catalogue.goesLive" : "catalogue.waitsForReview")}</p>
              {data.items.length ? (
                <ul className="divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
                  {data.items.map(item => {
                    const name = catalogueName(item, locale);
                    return (
                      <li key={item.id} className="flex flex-wrap items-start gap-x-3 gap-y-2.5 p-3.5">
                        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#eef2f8] text-[#0a285a]">
                          <FileText className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1 basis-40">
                          <p dir="auto" className="align-parent text-[14px] leading-6 font-bold break-words text-[#0a285a]">{name}</p>
                          <p className="mt-0.5 text-[13px] leading-5 break-words ink-muted">
                            <bdi>{item.fileName}</bdi> · {size(item.sizeBytes)} · {formatDate(item.createdAt)}
                            {item.byNetlet ? <> · {t("catalogue.byNetlet")}</> : null}
                          </p>
                          <p className="mt-2 flex flex-wrap gap-1.5">
                            <Pill tone={item.status === "live" ? "good" : item.status === "pending" ? "warning" : "danger"}>
                              {t(item.status === "live" ? "catalogue.statusLive" : item.status === "pending" ? "catalogue.statusPending" : "catalogue.statusDeclined")}
                            </Pill>
                          </p>
                          {item.status === "declined" && item.reviewNote ? (
                            <p dir="auto" className="mt-2 rounded-lg bg-[#fdeceb] px-3 py-2 text-[13px] leading-5 text-[#8c2f22]">
                              {t("catalogue.declinedNote", { note: isolate(item.reviewNote) })}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 lg:w-auto">
                          <div className="w-full sm:w-64">
                            <CatalogueActions card={item} name={name} />
                          </div>
                          <button type="button" onClick={() => setRemoving({ id: item.id, name })} aria-label={t("catalogue.removeName", { name: isolate(name) })} className={smallButtonClass.quietDanger}>
                            <Trash2 className="size-4" aria-hidden />{t("catalogue.remove")}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-[14px] ink-muted">{t("catalogue.none")}</p>
              )}
              {data.room > 0
                ? <AddCatalogue productId={productId} onAdded={() => void utils.catalogues.editor.invalidate({ productId })} />
                : <Notice className="mt-5">{t("catalogue.full", { count: MAX_CATALOGUES_PER_PRODUCT })}</Notice>}
            </>
          );
        }}
      </QueryGate>

      <ConfirmDialog
        open={removing !== null}
        title={t("catalogue.removeTitle")}
        body={t("catalogue.removeBody", { name: isolate(removing?.name ?? "") })}
        confirmLabel={t("catalogue.removeConfirm")}
        tone="danger"
        pending={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate({ id: removing.id })}
      />
    </Card>
  );
}

/**
 * Send one part, saying how much of it has gone. An `XMLHttpRequest` rather
 * than `fetch`, which says nothing about an upload's progress.
 */
function sendPart(url: string, headers: Record<string, string>, body: Blob, onProgress: (sent: number) => void): Promise<{ id: number; received: number; status: string }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.withCredentials = true;
    for (const [key, value] of Object.entries(headers)) request.setRequestHeader(key, value);
    request.upload.onprogress = event => onProgress(event.loaded);
    request.onerror = () => reject(new Error("catalogue.failed"));
    request.onload = () => {
      let answer: { error?: string } & Record<string, unknown> = {};
      try { answer = JSON.parse(request.responseText); } catch { /* not JSON: said below as a failure */ }
      if (request.status >= 200 && request.status < 300 && typeof answer.id === "number") resolve(answer as never);
      else reject(new Error(typeof answer.error === "string" ? answer.error : "catalogue.failed"));
    };
    request.send(body);
  });
}

/**
 * The form that adds one: the PDF and a title in each language, both
 * optional. What is wrong is said under its box when Upload is pressed and
 * leaves with the fix; a file that is not a PDF is said as it is chosen,
 * being the answer to that press.
 */
function AddCatalogue({ productId, onAdded }: { productId: number; onAdded: () => void }) {
  const { t, tError } = useTranslation();
  const size = useFileSize();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [problems, setProblems] = useState<Problems>({});
  const [stage, setStage] = useState<{ kind: "idle" } | { kind: "shrinking" } | { kind: "uploading"; percent: number }>({ kind: "idle" });
  const input = useRef<HTMLInputElement | null>(null);
  const choose = useRef<HTMLButtonElement | null>(null);
  const fileLabel = useId();
  const fileNote = useId();
  const titleId = useId();
  const titleArId = useId();
  const busy = stage.kind !== "idle";

  const pick = async (chosen: File | undefined) => {
    if (input.current) input.current.value = "";
    if (!chosen) return;
    const head = new Uint8Array(await chosen.slice(0, 8).arrayBuffer());
    const problem: MessageKey | null = chosen.size === 0 ? "catalogue.empty" : startsLikePdf(head) ? null : "catalogue.notPdf";
    setFile(problem ? null : chosen);
    setProblems(current => ({ ...current, file: problem ?? undefined, fileSize: undefined }));
  };

  const submit = async () => {
    const found: Problems = {};
    if (!file) found.file = problems.file ?? "catalogue.chooseFirst";
    const titleProblem = catalogueTitleProblem(title.trim());
    const titleArProblem = catalogueTitleProblem(titleAr.trim());
    if (titleProblem) found.title = titleProblem;
    if (titleArProblem) found.titleAr = titleArProblem;
    setProblems(found);
    if (found.file || !file) { choose.current?.focus(); return; }
    if (found.title) { document.getElementById(titleId)?.focus(); return; }
    if (found.titleAr) { document.getElementById(titleArId)?.focus(); return; }

    let body: Blob = file;
    try {
      if (file.size > MAX_CATALOGUE_BYTES) {
        setStage({ kind: "shrinking" });
        const { shrinkPdf } = await import("@/lib/shrinkPdf");
        const shrunk = await shrinkPdf(await file.arrayBuffer(), MAX_CATALOGUE_BYTES).catch(() => null);
        if (!shrunk || !shrunk.fits) {
          setStage({ kind: "idle" });
          setProblems({ file: "catalogue.stillTooLarge", fileSize: size(shrunk?.bytes.length ?? file.size) });
          choose.current?.focus();
          return;
        }
        body = new Blob([new Uint8Array(shrunk.bytes)], { type: "application/pdf" });
        toast(t("catalogue.shrunk", { from: size(file.size), to: size(body.size) }));
      }

      const total = body.size;
      setStage({ kind: "uploading", percent: 0 });
      const progress = (done: number) => setStage({ kind: "uploading", percent: Math.min(100, Math.round((done / total) * 100)) });
      const headers: Record<string, string> = {
        "Content-Type": "application/pdf",
        "X-NetLet-Size": String(total),
        "X-NetLet-File-Name": encodeURIComponent(file.name),
      };
      if (title.trim()) headers["X-NetLet-Title"] = encodeURIComponent(title.trim());
      if (titleAr.trim()) headers["X-NetLet-Title-Ar"] = encodeURIComponent(titleAr.trim());
      let answer = await sendPart(`/api/products/${productId}/catalogues`, headers, body.slice(0, CATALOGUE_PART_BYTES, "application/pdf"), progress);
      while (answer.status === "uploading") {
        const offset = answer.received;
        answer = await sendPart(
          `/api/catalogues/${answer.id}/parts`,
          { "Content-Type": "application/octet-stream", "X-NetLet-Offset": String(offset) },
          body.slice(offset, offset + CATALOGUE_PART_BYTES, "application/octet-stream"),
          sent => progress(offset + sent),
        );
      }
      toast.success(t(answer.status === "live" ? "catalogue.uploadedLive" : "catalogue.uploadedPending"));
      setFile(null);
      setTitle("");
      setTitleAr("");
      setProblems({});
      onAdded();
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "catalogue.failed"));
    } finally {
      setStage({ kind: "idle" });
    }
  };

  const fileMessage = problems.file
    ? problems.file === "catalogue.stillTooLarge" ? t("catalogue.stillTooLarge", { size: problems.fileSize ?? "" }) : t(problems.file)
    : t("catalogue.fileHint");

  return (
    <form className="mt-5 border-t border-[#eef1f5] pt-4" noValidate onSubmit={event => { event.preventDefault(); void submit(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p id={fileLabel} className="text-[13px] leading-5 font-semibold text-[#0a285a]">{t("catalogue.fileLabel")}</p>
          <div className="mt-1.5 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={event => void pick(event.target.files?.[0])}
            />
            <button
              ref={choose}
              type="button"
              onClick={() => input.current?.click()}
              disabled={busy}
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
            {fileMessage}
          </p>
        </div>
        <Field label={t("catalogue.titleLabel")} hint={t("catalogue.titleHint")} error={problems.title ? t(problems.title) : undefined} optional>
          <input
            id={titleId}
            dir="auto"
            value={title}
            maxLength={CATALOGUE_TITLE_MAX}
            disabled={busy}
            onChange={event => { setTitle(event.target.value); setProblems(current => ({ ...current, title: undefined })); }}
            className={fieldClass}
          />
        </Field>
        <Field label={t("catalogue.titleArLabel")} error={problems.titleAr ? t(problems.titleAr) : undefined} optional>
          <input
            id={titleArId}
            dir="rtl"
            lang="ar"
            value={titleAr}
            maxLength={CATALOGUE_TITLE_MAX}
            disabled={busy}
            onChange={event => { setTitleAr(event.target.value); setProblems(current => ({ ...current, titleAr: undefined })); }}
            className={fieldClass}
          />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <span className="text-[13px] ink-muted" role="status">
          {stage.kind === "shrinking" ? t("catalogue.shrinking") : stage.kind === "uploading" ? t("catalogue.uploading", { percent: stage.percent }) : ""}
        </span>
        <button type="submit" disabled={busy} className={buttonClass.primary}>
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          {t("catalogue.upload")}
        </button>
      </div>
    </form>
  );
}
