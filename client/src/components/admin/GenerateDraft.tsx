/**
 * "Generate with AI" on the new-product form, on the owner's word: a few lines
 * about the product and a photo or two, and the AI gateway drafts the name in
 * both languages, both descriptions, the department, the department's
 * specification rows and tags (`useProductGenerator`, `shared/ai/catalogDraft.ts`).
 *
 * **Nothing is filled in until the seller says so.** The draft is shown whole,
 * labelled as a model's, with what the notes and photos did not answer named,
 * and "Use this draft" is what writes it into the form — where every field is
 * still the seller's to change before Create. A model's guess about a phone's
 * storage is a claim the shop makes to a shopper, so it is read before it is
 * kept, the "Draft the Arabic name" rule.
 *
 * **The search title and description are shown and not kept.** NetLet has no
 * column for them — the search preview is `productMeta`'s rule over the name
 * and the description — and keeping them is a migration nobody has approved.
 *
 * Drawn only while the gateway is configured and `ai` is on
 * (`ai.available`'s `catalog`), and only for somebody who may create a product
 * in the chosen store, since that is who the token is signed for.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImageOff, LoaderCircle, Sparkles } from "lucide-react";
import { PhotoUpload } from "@/components/admin/PhotoUpload";
import { Card, Field, buttonClass, fieldClass } from "@/components/admin/ui";
import { Thumb } from "@/components/product/Thumb";
import { useProductGenerator } from "@/hooks/useProductGenerator";
import { useTranslation } from "@/hooks/useTranslation";
import { draftPhotoUrls, photosForDraft } from "@/lib/draftPhotos";
import { MAX_IMAGES, MAX_NOTES, type CatalogDraft, type GatewayErrorCode } from "@shared/ai/gateway";
import { fieldFor } from "@shared/commerce/attributeSchema";
import { descriptionBlocks } from "@shared/commerce/productDetail";
import type { MessageKey } from "@shared/i18n/dictionary";

/** What a seller is told for each refusal, in a seller's terms rather than a shopper's. */
function generatorMessage(code: GatewayErrorCode): MessageKey {
  switch (code) {
    case "rate_limited":
      return "admin.genErrorBusy";
    case "too_large":
      return "admin.genErrorTooLarge";
    case "model_refused":
      return "admin.genErrorRefused";
    default:
      return "admin.genErrorFailed";
  }
}

export function GenerateDraft({ vendorId, departmentSlug, photos, canAddPhoto, onPhoto, departmentName, onUse }: {
  vendorId: number | null;
  /** The department the seller chose, which stands: the model only fills a blank. */
  departmentSlug: string | null;
  /** The form's gallery; the first uploads in it are what the model looks at. */
  photos: string[];
  canAddPhoto: boolean;
  onPhoto: (url: string) => void;
  departmentName: (slug: string) => string;
  onUse: (draft: CatalogDraft) => void;
}) {
  const { t, locale } = useTranslation();
  const generator = useProductGenerator(vendorId);
  const [notes, setNotes] = useState("");
  const [needInput, setNeedInput] = useState(false);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  const sending = draftPhotoUrls(photos);
  const working = generator.status === "working";

  /* A draft is announced by taking focus to its heading, so a screen reader
     reads where it landed and a keyboard is one Tab from "Use this draft". */
  useEffect(() => {
    if (generator.status === "done" && generator.draft) draftHeading.current?.focus();
  }, [generator.status, generator.draft]);

  if (!generator.available || vendorId === null) return null;

  const generate = async () => {
    if (!notes.trim() && sending.length === 0) {
      setNeedInput(true);
      return;
    }
    setNeedInput(false);
    await generator.generate({ notes: notes.trim(), department: departmentSlug, photos: await photosForDraft(photos) });
  };

  const draft = generator.status === "done" ? generator.draft : null;
  const label = (key: string) => {
    const field = fieldFor(draft?.department, key);
    return field ? (locale === "ar" ? field.labelAr : field.label) : key;
  };
  const unit = (key: string) => fieldFor(draft?.department, key)?.unit;
  const listSeparator = locale === "ar" ? "، " : ", ";

  return (
    <Card
      title={<><Sparkles className="size-[18px] shrink-0 text-[#a44a2b]" aria-hidden />{t("admin.genHeading")}</>}
      description={t("admin.genIntro")}
    >
      <div className="grid gap-4">
        <Field label={t("admin.genNotes")} hint={t("admin.genNotesHint")}>
          <textarea
            id="generate-notes"
            dir="auto"
            value={notes}
            maxLength={MAX_NOTES}
            onChange={event => { setNotes(event.target.value); setNeedInput(false); }}
            rows={3}
            placeholder={t("admin.genNotesPlaceholder")}
            className={`${fieldClass} h-auto min-h-24 py-2.5 leading-6`}
          />
        </Field>

        <div>
          <p className="text-[13px] font-semibold text-[#0a285a]">{t("admin.genPhotos")}</p>
          <p className="mt-0.5 text-[12px] leading-5 ink-muted">{t("admin.genPhotosHint")}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            {sending.map(url => (
              <span key={url} className="size-14 overflow-hidden rounded-lg border border-[#e1e7ef] bg-[#f4f6f9]">
                <Thumb src={url} alt="" className="size-full object-cover" icon={<ImageOff className="size-4 text-[#536b8c]" />} />
              </span>
            ))}
            {sending.length === 0 ? <span className="text-[13px] ink-muted">{t("admin.genPhotosNone")}</span> : null}
            {canAddPhoto && sending.length < MAX_IMAGES ? <PhotoUpload onUploaded={onPhoto} addedNote="admin.newPhotoAdded" /> : null}
          </div>
        </div>

        <div aria-live="polite">
          {needInput ? <p className="text-[13px] font-semibold text-[#8c2f22]">{t("admin.genNeedInput")}</p> : null}
          {generator.status === "error" && generator.error ? (
            <p className="text-[13px] font-semibold text-[#8c2f22]">{t(generatorMessage(generator.error))}</p>
          ) : null}
          {working ? <p className="sr-only">{t("admin.genWorking")}</p> : null}
        </div>

        {draft ? null : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void generate()} disabled={working} className={buttonClass.primary}>
              {working ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
              {t(working ? "admin.genWorking" : "admin.genGenerate")}
            </button>
            {working ? <button type="button" onClick={generator.cancel} className={buttonClass.secondary}>{t("admin.genCancel")}</button> : null}
          </div>
        )}

        {draft ? (
          <div className="rounded-xl border border-[#d5dfeb] bg-[#f7f9fc] p-4 sm:p-5">
            <h3 ref={draftHeading} tabIndex={-1} className="text-[15px] font-bold text-[#0a285a] outline-none">{t("admin.genDraftHeading")}</h3>
            <p className="mt-0.5 text-[12px] leading-5 ink-muted">{t("admin.genDraftNote")}</p>

            <dl className="mt-4 grid gap-x-6 gap-y-4 text-[14px] sm:grid-cols-2">
              <DraftItem term={t("admin.genNameEn")}>
                {draft.title.en ? <bdi dir="auto">{draft.title.en}</bdi> : <Missing />}
              </DraftItem>
              <DraftItem term={t("admin.genNameAr")}>
                {draft.title.ar ? <bdi dir="rtl" lang="ar">{draft.title.ar}</bdi> : <Missing />}
              </DraftItem>
              <DraftItem term={t("admin.genDepartment")}>
                {draft.department ? departmentName(draft.department) : <Missing />}
              </DraftItem>
              <DraftItem term={t("admin.genTags")}>
                {draft.tags.length ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {draft.tags.map(tag => <li key={tag} dir="auto" className="rounded-full bg-white px-2.5 py-0.5 text-[13px] text-[#0a285a] ring-1 ring-[#d5dfeb]">{tag}</li>)}
                  </ul>
                ) : <Missing />}
              </DraftItem>
              <DraftItem term={t("admin.genSpecs")} wide>
                {draft.attributes.length ? (
                  <ul className="space-y-1">
                    {draft.attributes.map(row => (
                      <li key={row.key}>
                        <span className="font-semibold">{label(row.key)}:</span>{" "}
                        <bdi dir="auto">{row.value}{unit(row.key) ? ` ${unit(row.key)}` : ""}</bdi>
                      </li>
                    ))}
                  </ul>
                ) : <Missing />}
                {draft.missing.length ? (
                  <p className="mt-1.5 text-[12px] leading-5 ink-muted">
                    {t("admin.genMissing", { fields: draft.missing.map(label).join(listSeparator) })}
                  </p>
                ) : null}
              </DraftItem>
              <DraftItem term={t("admin.genDescriptionEn")}>
                {draft.description.en ? <DraftText text={draft.description.en} /> : <Missing />}
              </DraftItem>
              <DraftItem term={t("admin.genDescriptionAr")}>
                {draft.description.ar ? <DraftText text={draft.description.ar} lang="ar" /> : <Missing />}
              </DraftItem>
              {draft.seo.title || draft.seo.description ? (
                <DraftItem term={t("admin.genSeo")} wide>
                  <div className="rounded-lg border border-[#e1e7ef] bg-white p-3">
                    <p dir="auto" className="text-[16px] leading-6 text-[#1a0dab]">{draft.seo.title}</p>
                    <p dir="auto" className="mt-0.5 text-[13px] leading-5 text-[#4d5156]">{draft.seo.description}</p>
                  </div>
                  <p className="mt-1.5 text-[12px] leading-5 ink-muted">{t("admin.genSeoNote")}</p>
                </DraftItem>
              ) : null}
            </dl>

            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => { onUse(draft); generator.reset(); }} className={buttonClass.primary}>
                {t("admin.genUse")}
              </button>
              <button type="button" onClick={() => { generator.reset(); document.getElementById("generate-notes")?.focus(); }} className={buttonClass.secondary}>
                {t("admin.genDiscard")}
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-5 ink-muted">{t("admin.genUseNote")}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function DraftItem({ term, wide, children }: { term: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? "sm:col-span-2" : ""}`}>
      <dt className="text-[12px] font-semibold ink-muted">{term}</dt>
      <dd className="mt-1 break-words text-[#0a285a]">{children}</dd>
    </div>
  );
}

function Missing() {
  const { t } = useTranslation();
  return <span className="ink-muted">{t("admin.genNone")}</span>;
}

/** Paragraphs and "- " lists, as the product page will draw them. */
function DraftText({ text, lang }: { text: string; lang?: string }) {
  return (
    <div dir={lang === "ar" ? "rtl" : "auto"} lang={lang} className="space-y-2 leading-6 text-[#2b3242]">
      {descriptionBlocks(text).map((block, index) => block.kind === "paragraph"
        ? <p key={index} className="whitespace-pre-line">{block.text}</p>
        : (
          <ul key={index} className="list-disc space-y-1 ps-5 marker:text-[#0a285a]/50">
            {block.items.map((item, line) => <li key={line}>{item.label ? <><b className="font-bold">{item.label}:</b> {item.text}</> : item.text}</li>)}
          </ul>
        ))}
    </div>
  );
}
