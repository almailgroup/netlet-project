/**
 * The subcategories' pictures (`Shared/commerce/subcategoryPictures.ts`), on
 * the owner's word: "add real images for the subcategories, not just an
 * outline", drawn from the portal with NetLet's own gateway.
 *
 * One card a department, a tile a subcategory: what the shop shows now — the
 * picture kept here, or the subcategory's original, the file that comes with
 * the shop (`subcategoryArtPath`) — and beside it what was just drawn, which
 * goes nowhere until Keep is pressed. Removing a kept picture brings the
 * original back. Each drawing is sent the department's own art as the style
 * to match. A picture can also be uploaded by hand, which is how this page
 * works with no gateway.
 *
 * **"Draw the missing ones" went when every subcategory got a picture of its
 * own**: the owner sent all thirty-five, so nothing is missing, and a button
 * that can never be pressed is a dead control. One is drawn at a time, where
 * somebody wants another; "Keep every drawn one" keeps what is waiting.
 *
 * What was drawn is prepared like any photo — its own bytes checked, made the
 * square it is drawn in, re-encoded — and uploaded only when kept.
 */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, LoaderCircle, Sparkles, Square, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Card, Notice, PageHeader, smallButtonClass } from "@/components/admin/ui";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { DepartmentArt } from "@/components/browse/DepartmentArt";
import { SubcategoryIcon } from "@/components/browse/SubcategoryIcon";
import { prepareSquare } from "@/lib/prepareProfilePhoto";
import { trpc } from "@/lib/trpc";
import { DEPARTMENTS } from "@shared/commerce/departments";
import { MAX_UPLOAD_BYTES, type StoredType } from "@shared/commerce/media";
import { subcategoriesOf, type Subcategory, type SubcategoryIcon as SubcategoryIconName } from "@shared/commerce/subcategories";
import {
  SUBCATEGORY_PICTURE_EDGE,
  departmentArtPath,
  styleArtFor,
  everySubcategory,
  pictureFor,
  subcategoryArtPath,
  type SubcategoryPictures,
} from "@shared/commerce/subcategoryPictures";
import { privatePageMeta } from "@shared/seo";
import { useConfirmRemoval } from "@/components/ui/ConfirmRemoval";
import { isolate } from "@/lib/isolate";

export default function AdminSubcategoryPictures() {
  usePageMeta(privatePageMeta("Subcategory pictures"));
  return <AdminShell need="platform.configure">{() => <Desk />}</AdminShell>;
}

type Draft = { blob: Blob; url: string; type: StoredType };
type Busy = "drawing" | "keeping" | "removing";
/** A run over many: keeping every drawn one. */
type Run = { done: number; total: number };

const keyOf = (department: string, slug: string) => `${department}/${slug}`;

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

async function uploadPicture(blob: Blob, type: StoredType): Promise<string> {
  const response = await fetch(appPath("/api/media"), { method: "POST", headers: { "Content-Type": type }, body: blob, credentials: "same-origin" });
  const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!response.ok || !body.url) throw new Error(body.error ?? "media.failed");
  return body.url;
}

function Desk() {
  const { t, tError, isArabic } = useTranslation();
  const ask = useConfirmRemoval();
  const utils = trpc.useUtils();
  const pictures = trpc.subcategoryPictures.list.useQuery();
  const drawable = trpc.subcategoryPictures.drawable.useQuery();
  const draw = trpc.subcategoryPictures.draw.useMutation();
  const save = trpc.subcategoryPictures.set.useMutation();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [run, setRun] = useState<Run | null>(null);
  const stop = useRef(false);
  const references = useRef(new Map<string, { mimeType: "image/webp"; data: string } | null>());
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  useEffect(() => () => { for (const draft of Object.values(draftsRef.current)) URL.revokeObjectURL(draft.url); }, []);

  const nameOf = (subcategory: Subcategory) => (isArabic ? subcategory.nameAr : subcategory.name);
  const mark = (key: string, state: Busy | null) => setBusy(current => {
    const next = { ...current };
    if (state) next[key] = state; else delete next[key];
    return next;
  });
  const setDraft = (key: string, draft: Draft | null) => setDrafts(current => {
    const next = { ...current };
    if (current[key]) URL.revokeObjectURL(current[key].url);
    if (draft) next[key] = draft; else delete next[key];
    return next;
  });
  const kept = (map: SubcategoryPictures) => utils.subcategoryPictures.list.setData(undefined, map);

  /* The department's own art, as the style each drawing is to match. */
  const referenceFor = async (department: string) => {
    if (references.current.has(department)) return references.current.get(department) ?? null;
    let reference: { mimeType: "image/webp"; data: string } | null = null;
    try {
      /* A department whose pictures have not arrived is drawn in the style of one that has (`styleArtFor`). */
      const response = await fetch(appPath(departmentArtPath(styleArtFor(department))));
      if (response.ok) reference = { mimeType: "image/webp", data: await blobToBase64(await response.blob()) };
    } catch {
      reference = null;
    }
    references.current.set(department, reference);
    return reference;
  };

  /** Draws one; answers the refusal's key when it was refused, null when it worked. */
  const drawOne = async (department: string, subcategory: Subcategory): Promise<string | null> => {
    const key = keyOf(department, subcategory.slug);
    mark(key, "drawing");
    try {
      const answer = await draw.mutateAsync({ department, slug: subcategory.slug, reference: await referenceFor(department) });
      const bytes = Uint8Array.from(atob(answer.data), char => char.charCodeAt(0));
      const prepared = await prepareSquare(new Blob([bytes], { type: answer.mimeType }), SUBCATEGORY_PICTURE_EDGE, MAX_UPLOAD_BYTES);
      if (typeof prepared === "string") throw new Error(prepared);
      setDraft(key, { blob: prepared.blob, url: URL.createObjectURL(prepared.blob), type: prepared.type });
      return null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "drawing.failed";
      toast.error(`${nameOf(subcategory)}: ${tError(reason)}`);
      return reason;
    } finally {
      mark(key, null);
    }
  };

  const keepOne = async (department: string, subcategory: Subcategory, picture?: { blob: Blob; type: StoredType }) => {
    const key = keyOf(department, subcategory.slug);
    const chosen = picture ?? draftsRef.current[key];
    if (!chosen) return false;
    mark(key, "keeping");
    try {
      const path = await uploadPicture(chosen.blob, chosen.type);
      kept(await save.mutateAsync({ department, slug: subcategory.slug, path }));
      if (!picture) setDraft(key, null);
      toast.success(t("subpics.kept", { name: nameOf(subcategory) }));
      return true;
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "media.failed"));
      return false;
    } finally {
      mark(key, null);
    }
  };

  const removeOne = async (department: string, subcategory: Subcategory) => {
    /* Asks first, on the owner's word. */
    if (!(await ask({ title: t("remove.pictureTitle"), body: t("remove.pictureBody", { name: isolate(nameOf(subcategory)) }) }))) return;
    const key = keyOf(department, subcategory.slug);
    mark(key, "removing");
    try {
      kept(await save.mutateAsync({ department, slug: subcategory.slug, path: null }));
      toast(t("subpics.removed", { name: nameOf(subcategory) }));
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "media.failed"));
    } finally {
      mark(key, null);
    }
  };

  const uploadOne = async (department: string, subcategory: Subcategory, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const prepared = await prepareSquare(file, SUBCATEGORY_PICTURE_EDGE, MAX_UPLOAD_BYTES);
    if (typeof prepared === "string") { toast.error(t(prepared)); return; }
    await keepOne(department, subcategory, prepared);
  };

  const keepAll = async () => {
    const waiting = everySubcategory().filter(({ department, subcategory }) => draftsRef.current[keyOf(department, subcategory.slug)]);
    if (!waiting.length) return;
    stop.current = false;
    setRun({ done: 0, total: waiting.length });
    for (const [index, { department, subcategory }] of waiting.entries()) {
      if (stop.current) break;
      await keepOne(department, subcategory);
      setRun({ done: index + 1, total: waiting.length });
    }
    setRun(null);
  };

  const canDraw = drawable.data === true;
  const waitingCount = Object.keys(drafts).length;

  return (
    <>
      <PageHeader
        title={t("subpics.title")}
        description={t("subpics.intro")}
        actions={run ? (
          <button type="button" onClick={() => { stop.current = true; }} className={buttonClass.secondary}>
            <Square className="size-4" aria-hidden />{t("subpics.stop")}
          </button>
        ) : waitingCount > 0 ? (
          <button type="button" onClick={() => void keepAll()} className={buttonClass.primary}>
            <ImagePlus className="size-4" aria-hidden />{t("subpics.keepDrawn")}
          </button>
        ) : undefined}
      />
      {run ? (
        <p role="status" className="mb-4 flex items-center gap-2 text-[14px] font-semibold text-[#0a285a]">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          {t("subpics.progressKeeping", { done: run.done, total: run.total })}
        </p>
      ) : null}
      {drawable.data === false ? <Notice tone="warning" className="mb-4">{t("subpics.offNote")}</Notice> : null}
      <QueryGate queries={[pictures]}>
        {() => (
          <div className="grid gap-5">
            {DEPARTMENTS.map(department => (
              <Card key={department.slug} title={(
                <span className="flex items-center gap-3">
                  <DepartmentArt slug={department.slug} className="h-9 w-12" />
                  {t(department.label)}
                </span>
              )}>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {subcategoriesOf(department.slug).map(subcategory => {
                    const key = keyOf(department.slug, subcategory.slug);
                    return (
                      <PictureTile
                        key={key}
                        name={nameOf(subcategory)}
                        original={department.subcategoryArt ? subcategoryArtPath(department.slug, subcategory.slug) : null}
                        icon={subcategory.icon}
                        kept={pictureFor(pictures.data, department.slug, subcategory.slug)}
                        draft={drafts[key]?.url ?? null}
                        busy={busy[key] ?? null}
                        canDraw={canDraw && !run}
                        locked={Boolean(run)}
                        onDraw={() => void drawOne(department.slug, subcategory)}
                        onKeep={() => void keepOne(department.slug, subcategory)}
                        onDiscard={() => setDraft(key, null)}
                        onRemove={() => void removeOne(department.slug, subcategory)}
                        onUpload={event => void uploadOne(department.slug, subcategory, event)}
                      />
                    );
                  })}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </QueryGate>
    </>
  );
}

function PictureTile({ name, original, icon, kept, draft, busy, canDraw, locked, onDraw, onKeep, onDiscard, onRemove, onUpload }: {
  name: string;
  /**
   * The subcategory's own picture, which the shop shows while nothing is kept
   * here — or null for a department whose pictures have not arrived, where the
   * shop shows its icon.
   */
  original: string | null;
  icon: SubcategoryIconName;
  kept: string | null;
  draft: string | null;
  busy: Busy | null;
  canDraw: boolean;
  /** A run is going: nothing else is pressed meanwhile. */
  locked: boolean;
  onDraw: () => void;
  onKeep: () => void;
  onDiscard: () => void;
  onRemove: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { t } = useTranslation();
  const working = busy !== null || locked;
  return (
    <li className="min-w-0 rounded-xl border border-[#e3e8f0] bg-[#fbfcfe] p-3">
      <p className="text-[14px] font-bold leading-5 text-[#0a285a]"><bdi>{name}</bdi></p>
      <div className="mt-2.5 flex flex-wrap gap-3">
        <figure className="m-0">
          <span className="grid size-24 place-items-center overflow-hidden rounded-xl border border-[#e3e8f0] bg-white">
            {kept ?? original
              ? <img src={appPath(kept ?? original ?? "")} alt={t("subpics.keptAlt", { name })} loading="lazy" decoding="async" className="size-full object-contain" />
              : <span className="grid size-16 place-items-center rounded-xl bg-[#e2e6ed] text-[#2b3a55]"><SubcategoryIcon icon={icon} className="size-8" /></span>}
          </span>
          <figcaption className="mt-1 text-[12px] ink-muted">{t(kept ? "subpics.onShop" : original ? "subpics.original" : "subpics.iconOnly")}</figcaption>
        </figure>
        {draft || busy === "drawing" ? (
          <figure className="m-0">
            <span className="grid size-24 place-items-center overflow-hidden rounded-xl border border-dashed border-[#9fb3cf] bg-white">
              {draft
                ? <img src={draft} alt={t("subpics.draftAlt", { name })} decoding="async" loading="eager" className="size-full object-contain" />
                : <LoaderCircle className="size-6 animate-spin text-[#0a285a]" aria-label={t("subpics.drawing")} />}
            </span>
            <figcaption className="mt-1 text-[12px] ink-muted">{t(draft ? "subpics.drawn" : "subpics.drawing")}</figcaption>
          </figure>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {draft ? (
          <>
            <button type="button" onClick={onKeep} disabled={working} aria-label={t("subpics.keepName", { name })} className={smallButtonClass.primary}>
              {busy === "keeping" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}{t("subpics.keep")}
            </button>
            <button type="button" onClick={onDraw} disabled={working || !canDraw} aria-label={t("subpics.drawAgainName", { name })} className={smallButtonClass.secondary}>
              <Sparkles className="size-4" aria-hidden />{t("subpics.drawAgain")}
            </button>
            <button type="button" onClick={onDiscard} disabled={working} aria-label={t("subpics.discardName", { name })} className={smallButtonClass.secondary}>
              {t("subpics.discard")}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onDraw} disabled={working || !canDraw} aria-label={t(kept ? "subpics.drawAgainName" : "subpics.drawName", { name })} className={smallButtonClass.secondary}>
              {busy === "drawing" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}{t(kept ? "subpics.drawAgain" : "subpics.draw")}
            </button>
            <label className={`${smallButtonClass.secondary} cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#0a285a]`}>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onUpload} disabled={working} aria-label={t("subpics.uploadName", { name })} className="sr-only" />
              <Upload className="size-4" aria-hidden />{t("subpics.upload")}
            </label>
            {kept ? (
              <button type="button" onClick={onRemove} disabled={working} aria-label={t("subpics.removeName", { name })} className={smallButtonClass.quietDanger}>
                {busy === "removing" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}{t("subpics.remove")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
