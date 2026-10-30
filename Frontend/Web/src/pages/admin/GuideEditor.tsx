/**
 * One guide (3.5.3), written or drafted, in both languages, with a picture per
 * step — `/admin/guides/new` and `/admin/guides/:id`.
 *
 * "Draft with AI" asks the model for the steps from a topic and puts them in
 * the boxes (asking first over anything already typed); nothing is saved
 * until Save, and nothing reaches the shop until Publish, which says under it
 * what is still missing — `guideProblems`, the rule the server asks again.
 * A step's picture is drawn by the model on the step's own press, shown here
 * first, and uploaded like any photo only on "Use this picture"; or it is a
 * photo or screenshot uploaded by hand.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ImageOff, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link, useLocation, useRoute } from "wouter";
import { AdminShell } from "@/components/admin/AdminShell";
import { PhotoUpload } from "@/components/admin/PhotoUpload";
import { QueryGate } from "@/components/admin/QueryGate";
import { BackLink, buttonClass, Card, Field, fieldClass, Notice, PageHeader, Pill, Segmented, smallButtonClass, textareaClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { DEMO_MODE } from "@/lib/demoMode";
import { preparePhoto } from "@/lib/preparePhoto";
import { trpc } from "@/lib/trpc";
import {
  GUIDE_SUMMARY_MAX,
  GUIDE_TITLE_MAX,
  GUIDE_TOPIC_MAX,
  MAX_GUIDE_STEPS,
  STEP_BODY_MAX,
  STEP_TITLE_MAX,
  guideProblems,
  type GuideAudience,
  type GuideContent,
  type GuideStatus,
  type GuideStep,
} from "@shared/commerce/guides";
import { privatePageMeta } from "@shared/seo";

const EMPTY_STEP: GuideStep = { title: "", titleAr: "", body: "", bodyAr: "", imageUrl: null };
const EMPTY: GuideContent = { audience: "shopper", title: "", titleAr: "", summary: "", summaryAr: "", steps: [{ ...EMPTY_STEP }] };

export default function AdminGuideEditor() {
  usePageMeta(privatePageMeta("Guide"));
  const [, params] = useRoute("/admin/guides/:id");
  const raw = params?.id ?? "new";
  const id = raw === "new" ? null : Number(raw);
  return (
    <AdminShell need="platform.configure">
      {() => (id === null ? <Editor key="new" id={null} initial={EMPTY} status="draft" slug={null} /> : <Existing key={id} id={id} />)}
    </AdminShell>
  );
}

function Existing({ id }: { id: number }) {
  const { t } = useTranslation();
  const valid = Number.isInteger(id) && id > 0;
  const guide = trpc.guides.get.useQuery({ id }, { enabled: valid, retry: false });
  /* No such guide — deleted, or a typed address. Said with a heading and the
     way back, never "could not load" over a Try again that cannot find it,
     nor an outline left waiting on a query that was never sent. */
  if (!valid || guide.error?.data?.code === "NOT_FOUND") return (
    <>
      <BackLink href="/admin/guides">{t("guides.adminTitle")}</BackLink>
      <PageHeader title={t("guides.notFound")} />
    </>
  );
  return (
    <QueryGate queries={[guide]}>
      {() => {
        const row = guide.data!;
        const { id: _id, slug, status, publishedAt: _p, updatedAt: _u, ...content } = row;
        return <Editor id={id} initial={content} status={status} slug={slug} />;
      }}
    </QueryGate>
  );
}

function hasWords(content: GuideContent): boolean {
  return Boolean(content.title || content.titleAr || content.summary || content.summaryAr || content.steps.some(step => step.title || step.titleAr || step.body || step.bodyAr || step.imageUrl));
}

function Editor({ id, initial, status, slug }: { id: number | null; initial: GuideContent; status: GuideStatus; slug: string | null }) {
  const { t, tError } = useTranslation();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [content, setContent] = useState<GuideContent>(initial);
  const [saved, setSaved] = useState<GuideContent>(initial);
  const [topic, setTopic] = useState("");
  const [pendingDraft, setPendingDraft] = useState<GuideContent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const ai = trpc.guides.aiAvailable.useQuery(undefined, { enabled: !DEMO_MODE, staleTime: 300_000 });
  const dirty = JSON.stringify(content) !== JSON.stringify(saved);
  const problems = useMemo(() => guideProblems(content), [content]);

  const refresh = () => Promise.all([utils.guides.list.invalidate(), id ? utils.guides.get.invalidate({ id }) : undefined]);

  const save = trpc.guides.save.useMutation({
    onSuccess: row => {
      const { id: newId, slug: _s, status: _st, publishedAt: _p, updatedAt: _u, ...next } = row;
      setSaved(next);
      setContent(next);
      toast.success(t("guides.saved"));
      void refresh();
      if (id === null) navigate(`/admin/guides/${newId}`, { replace: true });
    },
    onError: error => toast.error(tError(error.message)),
  });
  const setStatus = trpc.guides.setStatus.useMutation({
    onSuccess: row => {
      toast.success(t(row.status === "published" ? "guides.publishedNow" : "guides.unpublishedNow"));
      void refresh();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const remove = trpc.guides.delete.useMutation({
    onSuccess: () => {
      toast.success(t("guides.deleted"));
      void utils.guides.list.invalidate();
      navigate("/admin/guides", { replace: true });
    },
    onError: error => toast.error(tError(error.message)),
  });
  const draft = trpc.guides.draft.useMutation({
    onSuccess: next => {
      if (hasWords(content)) setPendingDraft(next);
      else setContent(next);
    },
    onError: error => toast.error(tError(error.message)),
  });

  const patch = (change: Partial<GuideContent>) => setContent(current => ({ ...current, ...change }));
  const patchStep = (index: number, change: Partial<GuideStep>) =>
    setContent(current => ({ ...current, steps: current.steps.map((step, at) => (at === index ? { ...step, ...change } : step)) }));
  const moveStep = (index: number, by: -1 | 1) =>
    setContent(current => {
      const steps = [...current.steps];
      const [step] = steps.splice(index, 1);
      steps.splice(index + by, 0, step);
      return { ...current, steps };
    });

  const publish = async () => {
    if (id === null) return;
    if (dirty) await save.mutateAsync({ id, guide: content }).catch(() => undefined);
    setStatus.mutate({ id, status: "published" });
  };

  const busy = save.isPending || setStatus.isPending || remove.isPending;

  return (
    <>
      <PageHeader
        title={content.title || content.titleAr || t("guides.new")}
        meta={(
          <>
            <Pill tone={status === "published" ? "good" : "neutral"}>{t(status === "published" ? "guides.published" : "guides.draft")}</Pill>
            {status === "published" && slug ? <Link href={`/guides/${slug}`} className="font-semibold text-[#0a285a] underline underline-offset-2">{t("guides.viewOnShop")}</Link> : null}
          </>
        )}
      >
        <BackLink href="/admin/guides">{t("guides.adminTitle")}</BackLink>
      </PageHeader>

      <div className="grid gap-5">
        {ai.data ? (
          <Card title={t("guides.draftTitle")} description={t("guides.draftNote")}>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label={t("guides.topic")} hint={t("guides.topicHint")}>
                <input value={topic} maxLength={GUIDE_TOPIC_MAX} onChange={event => setTopic(event.target.value)} className={fieldClass} />
              </Field>
              <button
                type="button"
                onClick={() => draft.mutate({ topic, audience: content.audience })}
                disabled={!topic.trim() || draft.isPending}
                className={buttonClass.secondary}
              >
                {draft.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                {t(draft.isPending ? "guides.drafting" : "guides.draftButton")}
              </button>
            </div>
          </Card>
        ) : null}

        <Card title={t("guides.aboutTitle")}>
          <div className="grid gap-4">
            <div>
              <p className="text-[13px] leading-5 font-semibold text-[#0a285a]">{t("guides.audience")}</p>
              <Segmented<GuideAudience>
                label={t("guides.audience")}
                className="mt-1.5 w-fit"
                value={content.audience}
                onChange={audience => patch({ audience })}
                options={[{ value: "shopper", label: t("guides.forShoppers") }, { value: "seller", label: t("guides.forSellers") }]}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("guides.titleEn")}>
                <input dir="ltr" lang="en" value={content.title} maxLength={GUIDE_TITLE_MAX} onChange={event => patch({ title: event.target.value })} className={fieldClass} />
              </Field>
              <Field label={t("guides.titleAr")}>
                <input dir="rtl" lang="ar" value={content.titleAr} maxLength={GUIDE_TITLE_MAX} onChange={event => patch({ titleAr: event.target.value })} className={fieldClass} />
              </Field>
              <Field label={t("guides.summaryEn")} optional>
                <textarea dir="ltr" lang="en" rows={2} value={content.summary} maxLength={GUIDE_SUMMARY_MAX} onChange={event => patch({ summary: event.target.value })} className={textareaClass} />
              </Field>
              <Field label={t("guides.summaryAr")} optional>
                <textarea dir="rtl" lang="ar" rows={2} value={content.summaryAr} maxLength={GUIDE_SUMMARY_MAX} onChange={event => patch({ summaryAr: event.target.value })} className={textareaClass} />
              </Field>
            </div>
          </div>
        </Card>

        {content.steps.map((step, index) => (
          <StepCard
            key={index}
            index={index}
            count={content.steps.length}
            step={step}
            drawable={Boolean(ai.data)}
            onChange={change => patchStep(index, change)}
            onMove={by => moveStep(index, by)}
            onRemove={() => setContent(current => ({ ...current, steps: current.steps.filter((_, at) => at !== index) }))}
          />
        ))}

        {content.steps.length < MAX_GUIDE_STEPS ? (
          <button type="button" onClick={() => patch({ steps: [...content.steps, { ...EMPTY_STEP }] })} className={`${buttonClass.secondary} w-fit`}>
            <Plus className="size-4" aria-hidden />{t("guides.addStep")}
          </button>
        ) : null}

        <Card
          title={t("guides.publishTitle")}
          description={t(status === "published" ? "guides.publishedNote" : "guides.publishNote")}
          footer={(
            <>
              {id !== null ? (
                <button type="button" onClick={() => setDeleting(true)} disabled={busy} className={`${buttonClass.quietDanger} me-auto`}>
                  <Trash2 className="size-4" aria-hidden />{t("guides.delete")}
                </button>
              ) : null}
              <button type="button" onClick={() => save.mutate({ id, guide: content })} disabled={busy || (!dirty && id !== null)} className={buttonClass.secondary}>
                {save.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t("guides.save")}
              </button>
              {id !== null && status === "published" ? (
                <button type="button" onClick={() => setStatus.mutate({ id, status: "draft" })} disabled={busy} className={buttonClass.secondary}>{t("guides.unpublish")}</button>
              ) : null}
              {id !== null && status === "draft" ? (
                <button type="button" onClick={() => void publish()} disabled={busy || problems.length > 0} className={buttonClass.primary}>{t("guides.publish")}</button>
              ) : null}
            </>
          )}
        >
          {id === null ? <Notice>{t("guides.saveFirst")}</Notice> : problems.length > 0 ? (
            <Notice tone="warning">
              <ul className="list-disc ps-4">{problems.map(problem => <li key={problem}>{t(problem)}</li>)}</ul>
            </Notice>
          ) : status === "draft" ? <Notice tone="success">{t("guides.ready")}</Notice> : null}
        </Card>
      </div>

      <ConfirmDialog
        open={pendingDraft !== null}
        title={t("guides.replaceTitle")}
        body={t("guides.replaceBody")}
        confirmLabel={t("guides.replaceConfirm")}
        onConfirm={() => { if (pendingDraft) setContent(pendingDraft); setPendingDraft(null); }}
        onClose={() => setPendingDraft(null)}
      />
      <ConfirmDialog
        open={deleting}
        tone="danger"
        title={t("guides.deleteTitle")}
        body={t(status === "published" ? "guides.deleteBodyPublished" : "guides.deleteBody")}
        confirmLabel={t("guides.delete")}
        pending={remove.isPending}
        onConfirm={() => { if (id !== null) remove.mutate({ id }); }}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}

type Drawn = { blob: Blob; url: string; type: string };

function StepCard({ index, count, step, drawable, onChange, onMove, onRemove }: {
  index: number;
  count: number;
  step: GuideStep;
  drawable: boolean;
  onChange: (change: Partial<GuideStep>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t, tError } = useTranslation();
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => () => { if (drawn) URL.revokeObjectURL(drawn.url); }, [drawn]);

  /* What the model drew is prepared like any photo — its own bytes checked,
     re-encoded, shrunk — and shown before anything is uploaded. */
  const picture = trpc.guides.picture.useMutation({
    onSuccess: async answer => {
      const bytes = Uint8Array.from(atob(answer.data), char => char.charCodeAt(0));
      const prepared = await preparePhoto(new Blob([bytes], { type: answer.mimeType }), false);
      if (typeof prepared === "string") { toast.error(t(prepared)); return; }
      setDrawn({ blob: prepared.blob, url: URL.createObjectURL(prepared.blob), type: prepared.type });
    },
    onError: error => toast.error(tError(error.message)),
  });

  const acceptDrawn = async () => {
    if (!drawn) return;
    setUploading(true);
    try {
      const response = await fetch("/api/media", { method: "POST", headers: { "Content-Type": drawn.type }, body: drawn.blob, credentials: "same-origin" });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error ?? "media.failed");
      onChange({ imageUrl: body.url });
      setDrawn(null);
    } catch (error) {
      toast.error(tError(error instanceof Error ? error.message : "media.failed"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card
      step={index + 1}
      title={step.title || step.titleAr || t("guides.stepN", { n: index + 1 })}
      footer={(
        <>
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t("guides.moveUp")} title={t("guides.moveUp")} className={smallButtonClass.secondary}><ArrowUp className="size-4" aria-hidden /></button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t("guides.moveDown")} title={t("guides.moveDown")} className={smallButtonClass.secondary}><ArrowDown className="size-4" aria-hidden /></button>
          <button type="button" onClick={onRemove} disabled={count === 1} className={smallButtonClass.quietDanger}><Trash2 className="size-4" aria-hidden />{t("guides.removeStep")}</button>
        </>
      )}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("guides.stepTitleEn")}>
          <input dir="ltr" lang="en" value={step.title} maxLength={STEP_TITLE_MAX} onChange={event => onChange({ title: event.target.value })} className={fieldClass} />
        </Field>
        <Field label={t("guides.stepTitleAr")}>
          <input dir="rtl" lang="ar" value={step.titleAr} maxLength={STEP_TITLE_MAX} onChange={event => onChange({ titleAr: event.target.value })} className={fieldClass} />
        </Field>
        <Field label={t("guides.stepBodyEn")}>
          <textarea dir="ltr" lang="en" rows={3} value={step.body} maxLength={STEP_BODY_MAX} onChange={event => onChange({ body: event.target.value })} className={textareaClass} />
        </Field>
        <Field label={t("guides.stepBodyAr")}>
          <textarea dir="rtl" lang="ar" rows={3} value={step.bodyAr} maxLength={STEP_BODY_MAX} onChange={event => onChange({ bodyAr: event.target.value })} className={textareaClass} />
        </Field>
      </div>

      <div className="mt-4">
        <p className="text-[13px] leading-5 font-semibold text-[#0a285a]">{t("guides.picture")}</p>
        <div className="mt-2 flex flex-wrap items-start gap-4">
          <div className="grid aspect-[4/3] w-48 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#e1e7ef] bg-[#f4f6f9]">
            {drawn ? (
              <img src={drawn.url} alt={t("guides.drawnAlt")} loading="eager" decoding="async" className="size-full object-cover" />
            ) : step.imageUrl ? (
              <img src={step.imageUrl} alt={step.title || step.titleAr} loading="lazy" decoding="async" className="size-full object-cover" />
            ) : (
              <ImageOff className="size-6 text-[#9aa8bb]" aria-label={t("guides.noPicture")} />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {drawn ? (
              <>
                <p className="text-[12px] leading-5 ink-muted">{t("guides.drawnNote")}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void acceptDrawn()} disabled={uploading} className={smallButtonClass.primary}>
                    {uploading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}{t("guides.useDrawn")}
                  </button>
                  <button type="button" onClick={() => setDrawn(null)} disabled={uploading} className={smallButtonClass.secondary}>{t("guides.discardDrawn")}</button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-start gap-2">
                {drawable ? (
                  <button
                    type="button"
                    onClick={() => picture.mutate({ title: step.title || step.titleAr, body: step.body || step.bodyAr })}
                    disabled={!(step.title || step.titleAr) || picture.isPending}
                    className={smallButtonClass.secondary}
                  >
                    {picture.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
                    {t(picture.isPending ? "guides.drawing" : "guides.draw")}
                  </button>
                ) : null}
                <PhotoUpload fromMaker={false} addedNote="guides.pictureAdded" onUploaded={url => onChange({ imageUrl: url })} />
                {step.imageUrl ? (
                  <button type="button" onClick={() => onChange({ imageUrl: null })} className={smallButtonClass.quietDanger}>{t("guides.removePicture")}</button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
