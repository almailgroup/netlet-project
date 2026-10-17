/**
 * "Add a product": one form, five short sections, one press.
 *
 * "New product" used to create a blank draft called "New product" with a
 * variant at KWD 0.000 the moment it was pressed, and drop the seller into the
 * full editor — eleven sections, each with its own Save, most of them about
 * things a first listing does not need. Leaving at that point left a "New
 * product" on the shelf for ever. This asks for what a shopper decides on —
 * a name, a price, a photo, a description — checks it as it is typed, and
 * writes it in one transaction (`createProduct`), so pressing Create is one
 * outcome and backing out is none. Sizes, specifications and extras stay in the
 * editor, where the product it lands on next.
 *
 * **The rules are the server's, asked early.** `draftProblems` is the shared
 * half of the router's own refusals, so the form names the problem under the
 * box while somebody types and the Create button never produces an error the
 * form could have shown. A field is judged once it has been left, or once
 * Create is pressed — red under a box somebody has not reached yet tells them
 * they are failing at something they have not started.
 *
 * **"Generate with AI" drafts it from a few notes and photos** (`GenerateDraft`,
 * above the first step, only while the AI gateway is set up): the draft is
 * shown first and written into these boxes only on "Use this draft", so what
 * is created is still what the seller read. It is also how a product starts
 * with its Arabic description and the department's specification rows, which
 * the form otherwise leaves to the editor — a row the draft filled is drawn
 * here, under the description, to change or take out.
 *
 * **The search preview is what the page will actually say.** It is drawn from
 * `productMeta`'s own rule — the name with the shop's after it, the description
 * cut to 160 characters, the address made from the name — not a separate SEO
 * title that nothing reads.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { GenerateDraft } from "@/components/admin/GenerateDraft";
import { PhotoUpload } from "@/components/admin/PhotoUpload";
import { Card, Field, PageHeader, buttonClass, fieldClass, isolate, smallButtonClass } from "@/components/admin/ui";
import { Thumb } from "@/components/product/Thumb";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { trpc } from "@/lib/trpc";
import { savingsPercent } from "@shared/commerce/productDetail";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { can, type Actor } from "@shared/inventory/permissions";
import {
  MAX_DESCRIPTION,
  MAX_PHOTOS,
  SEARCH_SNIPPET_FITS,
  SEARCH_TITLE_FITS,
  draftProblems,
  warrantyRequired,
  handleBase,
  photoUrlProblem,
  type DraftField,
  type ProductDraft,
} from "@shared/inventory/productDraft";
import { privatePageMeta, toPreviewText } from "@shared/seo";
import { fieldFor } from "@shared/commerce/attributeSchema";
import type { CatalogDraft } from "@shared/ai/gateway";
import { ArrowLeft, Check, Circle, ImageOff, LoaderCircle, Sparkles, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { Select } from "@/components/ui/Select";

export default function AdminNewProduct() {
  usePageMeta(privatePageMeta("New product"));
  return <AdminShell need="product.create">{actor => <NewProductForm actor={actor} />}</AdminShell>;
}

const EMPTY: ProductDraft = { title: "", titleAr: "", price: "", compareAtPrice: "", sku: "", stock: "", description: "", warranty: "" };

/** The order fields are visited in, so the first problem is the one focused. */
const FIELD_ORDER: DraftField[] = ["title", "titleAr", "warranty", "price", "compareAtPrice", "sku", "stock", "description"];
const idFor = (field: DraftField) => `new-product-${field}`;

function NewProductForm({ actor }: { actor: Actor }) {
  const { t, locale } = useTranslation();
  const money = useMoney();
  const [, navigate] = useLocation();
  const search = useSearch();
  const utils = trpc.useUtils();

  const [draft, setDraft] = useState<ProductDraft>(EMPTY);
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState("");
  const [descriptionAr, setDescriptionAr] = useState("");
  /* Rows a "Generate with AI" draft filled, by the department's own keys. */
  const [specs, setSpecs] = useState<{ key: string; value: string }[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoLink, setPhotoLink] = useState("");
  const [photoLinkError, setPhotoLinkError] = useState<MessageKey | null>(null);
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({});
  const [attempted, setAttempted] = useState(false);
  /* What the server refused that the form could not know — a SKU another of
     the store's products already carries. Cleared as soon as it is edited. */
  const [serverErrors, setServerErrors] = useState<Partial<Record<DraftField, MessageKey>>>({});
  /* `?vendor=` is how a store's own page sends somebody here to add a product
     to that store, so it arrives already chosen. */
  const [chosenVendor, setChosenVendor] = useState(() => new URLSearchParams(search).get("vendor") ?? "");
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);

  const categories = trpc.inventory.categories.useQuery();
  const vendors = trpc.inventory.vendors.list.useQuery({ pageSize: 200 }, { enabled: actor.kind === "admin" });
  /* Whether this store publishes straight away, so the button can say what
     will actually happen — the editor's Publish rule, asked before the press. */
  const store = trpc.inventory.myStore.useQuery(undefined, { enabled: actor.kind === "vendor" });
  const create = trpc.inventory.products.create.useMutation();
  const setStatus = trpc.inventory.products.setStatus.useMutation();

  const vendorRows = vendors.data?.rows ?? [];
  /* A chosen id counts only if it is a store that exists; otherwise the first,
     which on a fresh install is the house store the seed writes. */
  const chosen = vendorRows.find(row => String(row.id) === chosenVendor);
  const vendorId = actor.kind === "vendor" ? actor.vendorId : chosen?.id ?? vendorRows[0]?.id ?? null;
  const vendorName = actor.kind === "vendor" ? store.data?.name ?? null : vendorRows.find(row => row.id === vendorId)?.name ?? null;
  const mayPublish = vendorId !== null && can(actor, "product.publish", vendorId);
  const publishGoesToReview = actor.kind === "vendor" && store.data ? !store.data.autoPublish : false;

  /* The chosen department decides whether a warranty must be stated. */
  const departmentSlug = (categories.data ?? []).find(category => String(category.id) === categoryId)?.slug ?? null;
  const needsWarranty = warrantyRequired(departmentSlug);
  /* A row belongs to its department: choosing another hides the rows it does
     not ask for, and the server drops them too (`openingSpecs`). */
  const shownSpecs = specs.filter(row => fieldFor(departmentSlug, row.key));
  const problems = useMemo(() => ({ ...draftProblems(draft, { departmentSlug }), ...serverErrors }), [draft, serverErrors, departmentSlug]);
  const arabicDraftOn = trpc.inventory.products.arabicDraftAvailable.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const draftArabic = trpc.inventory.products.draftArabicTitle.useMutation({
    onSuccess: reply => {
      if (reply.kind === "draft") edit("titleAr")(reply.text);
      else toast(t("admin.arabicDraftUnavailable"));
    },
    onError: () => toast(t("admin.arabicDraftUnavailable")),
  });
  const shown = (field: DraftField): MessageKey | undefined =>
    touched[field] || attempted || serverErrors[field] ? problems[field] : undefined;

  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY) || photos.length > 0 || tags.trim() !== "" || categoryId !== ""
    || descriptionAr.trim() !== "" || specs.length > 0;
  /* Leaving with a half-filled form loses it, and nothing has been written —
     so the browser asks first. Only the browser's own prompt: an in-app one
     would have to intercept every link in the shell to be honest. */
  useEffect(() => {
    if (!dirty || busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  const edit = (field: DraftField) => (value: string) => {
    setDraft(current => ({ ...current, [field]: value }));
    if (serverErrors[field]) setServerErrors(current => ({ ...current, [field]: undefined }));
  };
  const leave = (field: DraftField) => () => setTouched(current => ({ ...current, [field]: true }));

  const addPhoto = (url: string) => setPhotos(current => (current.includes(url) || current.length >= MAX_PHOTOS ? current : [...current, url]));
  const addLink = () => {
    const problem = photoUrlProblem(photoLink) ?? (photoLink.trim() ? null : "admin.newPhotoUrl");
    setPhotoLinkError(problem);
    if (problem) return;
    addPhoto(photoLink.trim());
    setPhotoLink("");
  };

  /*
   * "Use this draft": what the draft has replaces what the box holds, and what
   * it lacks leaves the box alone — a draft with no Arabic description does not
   * empty one the seller typed. The department only fills a blank, since the
   * seller's choice was sent with the request and stood. Focus goes to the name,
   * the first thing to read.
   */
  const applyDraft = (generated: CatalogDraft) => {
    const warranty = generated.attributes.find(row => row.key === "warranty")?.value;
    setDraft(current => ({
      ...current,
      title: generated.title.en || current.title,
      titleAr: generated.title.ar || current.titleAr,
      description: generated.description.en || current.description,
      warranty: warranty || current.warranty,
    }));
    if (generated.description.ar) setDescriptionAr(generated.description.ar);
    const category = (categories.data ?? []).find(row => row.slug === generated.department);
    if (category && !categoryId) setCategoryId(String(category.id));
    if (generated.tags.length) setTags(generated.tags.join(", "));
    setSpecs(generated.attributes.filter(row => row.key !== "warranty"));
    setServerErrors({});
    toast.success(t("admin.genApplied"));
    requestAnimationFrame(() => document.getElementById(idFor("title"))?.focus());
  };

  const submit = async (publish: boolean) => {
    setAttempted(true);
    if (vendorId === null) {
      toast.error(t("admin.needVendorFirst"));
      return;
    }
    const wrong = FIELD_ORDER.filter(field => problems[field]);
    if (wrong.length) {
      toast.error(wrong.length === 1 ? t("admin.newFixOne") : t("admin.newFixMany", { count: wrong.length }));
      if (wrong[0]) document.getElementById(idFor(wrong[0]))?.focus();
      return;
    }
    setBusy(publish ? "publish" : "draft");
    try {
      const title = draft.title.trim();
      const row = await create.mutateAsync({
        vendorId,
        title,
        titleAr: draft.titleAr.trim() || null,
        warranty: (draft.warranty ?? "").trim() || null,
        description: draft.description.trim() || null,
        descriptionAr: descriptionAr.trim() || null,
        categoryId: categoryId ? Number(categoryId) : null,
        tags: tags.split(",").map(tag => tag.trim()).filter(Boolean),
        specs: shownSpecs.filter(row => row.value.trim()),
        variant: {
          price: draft.price.trim(),
          compareAtPrice: draft.compareAtPrice.trim() || null,
          sku: draft.sku.trim() || null,
          stock: draft.stock.trim() ? Number(draft.stock) : 0,
        },
        images: photos.map(url => ({ url })),
      });
      void utils.inventory.products.list.invalidate();
      void utils.inventory.overview.invalidate();

      if (publish) {
        /* Publishing has rules of its own — a discount permit behind a
           was-price — so it can refuse after the product exists. Then the
           product is a draft, and the message says why rather than "failed". */
        try {
          const status = await setStatus.mutateAsync({ id: row.id, status: "published" });
          toast.success(t("admin.newCreated", { title: isolate(title) }), {
            description: t(status === "pending_review" ? "admin.sentForReview" : "admin.nowLive"),
          });
        } catch (error) {
          const key = error instanceof Error && isMessageKey(error.message) ? error.message : "admin.saveFailed";
          toast.warning(t("admin.newCreatedDraft", { title: isolate(title), reason: t(key) }));
        }
      } else {
        toast.success(t("admin.newCreated", { title: isolate(title) }), { description: t("admin.newDraftNote") });
      }
      navigate(`/admin/products/${row.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "admin.skuTaken") {
        setServerErrors(current => ({ ...current, sku: "admin.skuTaken" }));
        document.getElementById(idFor("sku"))?.focus();
      }
      toast.error(isMessageKey(message) ? t(message) : t("admin.saveFailed"));
      setBusy(null);
    }
  };

  /* What the shopper's card will say about the price, from the card's own rule. */
  const priceOk = !problems.price;
  const saving = priceOk && !problems.compareAtPrice && draft.compareAtPrice.trim()
    ? savingsPercent({ amount: draft.price.trim(), currencyCode: "KWD" }, { amount: draft.compareAtPrice.trim(), currencyCode: "KWD" })
    : 0;

  /* `productMeta`'s rule, word for word: the name with the shop's after it,
     and the description cut where a share card cuts it. */
  const titleForSearch = `${draft.title.trim() || t("admin.newTitle")} — NetLet`;
  const snippet = draft.description.trim()
    ? toPreviewText(draft.description, SEARCH_SNIPPET_FITS)
    : `${draft.title.trim() || t("admin.newTitle")}${vendorName ? ` by ${vendorName}` : ""} on NetLet.`;
  const host = typeof window === "undefined" ? "netlet" : window.location.host;

  const checklist: { key: MessageKey; done: boolean; required: boolean }[] = [
    { key: "admin.newCheckTitle", done: !problems.title, required: true },
    { key: "admin.newCheckTitleAr", done: !problems.titleAr, required: true },
    ...(needsWarranty ? [{ key: "admin.newCheckWarranty" as MessageKey, done: !problems.warranty, required: true }] : []),
    { key: "admin.newCheckPrice", done: !problems.price, required: true },
    { key: "admin.newCheckPhoto", done: photos.length > 0, required: false },
    { key: "admin.newCheckDescription", done: draft.description.trim().length > 0, required: false },
    { key: "admin.newCheckCategory", done: categoryId !== "", required: false },
  ];

  const categoryName = (row: { name: string; nameAr: string | null }) => (locale === "ar" ? row.nameAr || row.name : row.name);
  const departmentName = (slug: string) => {
    const row = (categories.data ?? []).find(category => category.slug === slug);
    return row ? categoryName(row) : slug;
  };

  /* An administrator on an installation with no store yet has nothing to put
     a product in, and a form that cannot be submitted is worse than saying so. */
  const noStore = actor.kind === "admin" && vendors.isSuccess && vendorRows.length === 0;

  const back = (
    <Link href="/admin/products" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#536b8c] hover:text-[#0a285a]">
      <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.products")}
    </Link>
  );

  if (noStore) {
    return (
      <>
        <PageHeader title={t("admin.newHeading")}>{back}</PageHeader>
        <p className="rounded-2xl border border-[#f2b69e] bg-[#fdeceb] px-5 py-4 text-[14px] font-semibold text-[#8c2f22]">{t("admin.needVendorFirst")}</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("admin.newHeading")} description={t("admin.newIntro")}>{back}</PageHeader>

      <form
        noValidate
        onSubmit={event => { event.preventDefault(); void submit(false); }}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
      >
        <div className="min-w-0 space-y-5">
          <GenerateDraft
            vendorId={vendorId}
            departmentSlug={departmentSlug}
            photos={photos}
            canAddPhoto={photos.length < MAX_PHOTOS}
            onPhoto={addPhoto}
            departmentName={departmentName}
            onUse={applyDraft}
          />

          <Card step={1} title={t("admin.newStepBasics")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Always drawn for an administrator, even with one store: which
                  store sells a product decides its commission, its delivery fee
                  and whose discount permit governs it, and a choice that is only
                  offered once there are two is one nobody knows they made. */}
              {actor.kind === "admin" && vendorRows.length > 0 ? (
                <Field label={t("admin.newStore")} hint={t("admin.newStoreHint")} className="sm:col-span-2">
                  <Select value={vendorId ?? ""} onChange={event => setChosenVendor(event.target.value)} className={fieldClass}>
                    {vendorRows.map(vendor => (
                      <option key={vendor.id} value={vendor.id}>
                        {vendor.name}{vendor.status !== "approved" ? ` — ${t(`vendorStatus.${vendor.status}` as MessageKey)}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field label={t("admin.newTitle")} hint={t("admin.newTitleHint")} error={shown("title") && t(shown("title")!)} className="sm:col-span-2">
                <input
                  id={idFor("title")}
                  dir="auto"
                  value={draft.title}
                  onChange={event => edit("title")(event.target.value)}
                  onBlur={leave("title")}
                  maxLength={300}
                  autoComplete="off"
                  required
                  className={fieldClass}
                />
              </Field>
              <Field label={t("admin.newTitleAr")} error={shown("titleAr") && t(shown("titleAr")!)}>
                <input id={idFor("titleAr")} dir="rtl" lang="ar" value={draft.titleAr} onChange={event => edit("titleAr")(event.target.value)} onBlur={leave("titleAr")} autoComplete="off" required className={fieldClass} />
              </Field>
              {/* A draft for the seller to read, never a name saved unseen. */}
              {arabicDraftOn.data && vendorId ? (
                <div className="-mt-2 sm:col-span-2">
                  <button
                    type="button"
                    disabled={!draft.title.trim() || draftArabic.isPending}
                    onClick={() => draftArabic.mutate({ vendorId, title: draft.title.trim() })}
                    className={`${smallButtonClass.secondary}`}
                  >
                    {draftArabic.isPending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
                    {t("admin.arabicDraft")}
                  </button>
                  <p className="mt-1.5 text-[12px] ink-muted">{t("admin.arabicDraftNote")}</p>
                </div>
              ) : null}
              <Field label={t("admin.fieldCategory")}>
                <Select value={categoryId} onChange={event => setCategoryId(event.target.value)} className={fieldClass}>
                  <option value="">{t("admin.fieldNoCategory")}</option>
                  {(categories.data ?? []).map(category => (
                    <option key={category.id} value={category.id}>{categoryName(category)}</option>
                  ))}
                </Select>
              </Field>
              {needsWarranty ? (
                <Field label={t("admin.newWarranty")} hint={t("admin.newWarrantyHint")} error={shown("warranty") && t(shown("warranty")!)}>
                  <input id={idFor("warranty")} dir="auto" value={draft.warranty ?? ""} onChange={event => edit("warranty")(event.target.value)} onBlur={leave("warranty")} maxLength={200} placeholder={t("admin.newWarrantyPlaceholder")} autoComplete="off" required className={fieldClass} />
                </Field>
              ) : null}
            </div>
          </Card>

          <Card step={2} title={t("admin.newStepPhotos")} description={t("admin.newPhotosHint")}>
            {photos.length ? (
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-6">
                {photos.map((url, index) => (
                  <li key={url} className="group relative">
                    <div className={`aspect-square overflow-hidden rounded-xl border bg-[#f4f6f9] ${index === 0 ? "border-[#0a285a] ring-2 ring-[#0a285a]/15" : "border-[#e1e7ef]"}`}>
                      <Thumb src={url} alt="" className="size-full object-cover" icon={<ImageOff className="size-5 text-[#536b8c]" />} />
                    </div>
                    {index === 0 ? (
                      <span className="absolute start-1.5 top-1.5 rounded-md bg-[#0a285a] px-1.5 py-0.5 text-[12px] font-semibold text-white">{t("admin.newPhotoCover")}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPhotos(current => [url, ...current.filter(entry => entry !== url)])}
                        className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#0a285a] hover:underline"
                      >
                        <Star className="size-3.5" aria-hidden />{t("admin.newPhotoMakeCover")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPhotos(current => current.filter(entry => entry !== url))}
                      aria-label={t("admin.removeImage")}
                      title={t("admin.removeImage")}
                      className="absolute end-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-white text-[#0a285a] shadow-sm ring-1 ring-[#e1e7ef] hover:bg-[#fdeceb] hover:text-[#8c2f22]"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-[#cfd9e6] bg-[#fafbfd] px-4 py-6 text-center text-[13px] ink-muted">{t("admin.newPhotosNone")}</p>
            )}
            <p className="mt-2 text-[12px] ink-muted">{t("admin.newPhotoCount", { count: photos.length, max: MAX_PHOTOS })}</p>

            {photos.length < MAX_PHOTOS ? (
              <div className="mt-4 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <PhotoUpload onUploaded={addPhoto} addedNote="admin.newPhotoAdded" />
                </div>
                <Field label={t("admin.newPhotoLink")} error={photoLinkError && t(photoLinkError, { scheme: "https://" })}>
                  <PhotoLink value={photoLink} onChange={value => { setPhotoLink(value); setPhotoLinkError(null); }} onAdd={addLink} />
                </Field>
              </div>
            ) : null}
          </Card>

          <Card step={3} title={t("admin.newStepPrice")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("admin.newPrice")} hint={t("admin.priceHint")} error={shown("price") && t(shown("price")!)}>
                <input id={idFor("price")} dir="ltr" inputMode="decimal" value={draft.price} onChange={event => edit("price")(event.target.value)} onBlur={leave("price")} placeholder="0.000" autoComplete="off" required className={fieldClass} />
              </Field>
              <Field label={t("admin.newWas")} optional hint={t("admin.newWasHint")} error={shown("compareAtPrice") && t(shown("compareAtPrice")!)}>
                <input id={idFor("compareAtPrice")} dir="ltr" inputMode="decimal" value={draft.compareAtPrice} onChange={event => edit("compareAtPrice")(event.target.value)} onBlur={leave("compareAtPrice")} placeholder="0.000" autoComplete="off" className={fieldClass} />
              </Field>
              <Field label={t("admin.newSku")} optional hint={t("admin.newSkuHint")} error={shown("sku") && t(shown("sku")!)}>
                <input id={idFor("sku")} dir="ltr" value={draft.sku} onChange={event => edit("sku")(event.target.value)} onBlur={leave("sku")} autoComplete="off" spellCheck={false} className={fieldClass} />
              </Field>
              <Field label={t("admin.newStock")} hint={t("admin.newStockHint")} error={shown("stock") && t(shown("stock")!)}>
                <input id={idFor("stock")} dir="ltr" inputMode="numeric" value={draft.stock} onChange={event => edit("stock")(event.target.value)} onBlur={leave("stock")} placeholder="0" autoComplete="off" className={fieldClass} />
              </Field>
            </div>
            {priceOk ? (
              <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[#f4f6f9] px-4 py-3">
                <span className="text-[13px] ink-muted">{t("admin.newShopperSees")}</span>
                <span className="text-[16px] font-bold text-[#0a285a]">{money({ amount: draft.price.trim(), currencyCode: "KWD" })}</span>
                {saving > 0 ? (
                  <>
                    <span className="text-[13px] ink-muted line-through">{money({ amount: draft.compareAtPrice.trim(), currencyCode: "KWD" })}</span>
                    <span dir="ltr" className="rounded-md bg-[#f2683a] px-1.5 py-0.5 text-[12px] font-bold text-[#0a285a]">−{saving}%</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card step={4} title={t("admin.newStepDescription")}>
            <div className="grid gap-4">
              <Field label={t("admin.fieldDescription")} hint={`${t("admin.newDescriptionHint")} ${t("admin.newCharacters", { count: draft.description.length })}`} error={shown("description") && t(shown("description")!)}>
                <textarea id={idFor("description")} dir="auto" value={draft.description} onChange={event => edit("description")(event.target.value)} onBlur={leave("description")} rows={6} className={`${fieldClass} h-auto min-h-36 py-2.5 leading-6`} />
              </Field>
              <Field label={t("admin.fieldDescriptionAr")} optional hint={t("admin.fieldDescriptionArHint")}>
                <textarea dir="rtl" lang="ar" value={descriptionAr} onChange={event => setDescriptionAr(event.target.value)} maxLength={MAX_DESCRIPTION} rows={4} className={`${fieldClass} h-auto min-h-28 py-2.5 leading-6`} />
              </Field>
              <Field label={t("admin.fieldTags")} optional hint={t("admin.tagsHint")}>
                <input dir="auto" value={tags} onChange={event => setTags(event.target.value)} autoComplete="off" className={fieldClass} />
              </Field>
              {shownSpecs.length ? (
                <fieldset className="min-w-0">
                  <legend className="text-[13px] leading-5 font-semibold text-[#0a285a]">{t("admin.newSpecs")}</legend>
                  <p className="mt-0.5 text-[12px] leading-5 ink-muted">{t("admin.newSpecsHint")}</p>
                  <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
                    {shownSpecs.map(row => {
                      const field = fieldFor(departmentSlug, row.key)!;
                      const name = locale === "ar" ? field.labelAr : field.label;
                      return (
                        <div key={row.key} className="flex min-w-0 items-end gap-2">
                          <label className="min-w-0 flex-1">
                            <span className="block text-[12px] leading-5 font-semibold text-[#0a285a]">{name}{field.unit ? <> (<bdi dir="ltr">{field.unit}</bdi>)</> : null}</span>
                            <input
                              dir="auto"
                              value={row.value}
                              maxLength={500}
                              onChange={event => setSpecs(current => current.map(entry => entry.key === row.key ? { ...entry, value: event.target.value } : entry))}
                              autoComplete="off"
                              className={`${fieldClass} mt-1`}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => setSpecs(current => current.filter(entry => entry.key !== row.key))}
                            aria-label={t("admin.newSpecRemove", { label: name })}
                            title={t("admin.newSpecRemove", { label: name })}
                            className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#cfd9e6] bg-white text-[#0a285a] hover:bg-[#fdeceb] hover:text-[#8c2f22]"
                          >
                            <X className="size-4" aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}
            </div>
          </Card>

          <Card step={5} title={t("admin.newStepSearch")} description={t("admin.newSearchHint")}>
            {!draft.title.trim() ? (
              <p className="rounded-xl border border-dashed border-[#cfd9e6] bg-[#fafbfd] px-4 py-6 text-center text-[13px] ink-muted">{t("admin.newSearchEmpty")}</p>
            ) : (
              <>
                <figure aria-label={t("admin.newSearchPreview")} className="rounded-xl border border-[#e1e7ef] p-4">
                  <p className="truncate text-[12px] text-[#4d5156]"><bdi dir="ltr">{host} › products › {handleBase(draft.title)}</bdi></p>
                  <p dir="auto" className="mt-1 text-[18px] leading-6 text-[#1a0dab]">
                    {titleForSearch.length > SEARCH_TITLE_FITS ? `${titleForSearch.slice(0, SEARCH_TITLE_FITS - 1).trimEnd()}…` : titleForSearch}
                  </p>
                  <p dir="auto" className="mt-1 text-[13px] leading-5 text-[#4d5156]">{snippet}</p>
                </figure>
                <ul className="mt-3 space-y-1 text-[12px] leading-5">
                  <li className={titleForSearch.length > SEARCH_TITLE_FITS ? "font-semibold text-[#8c2f22]" : "ink-muted"}>
                    {t("admin.newSearchTitleCount", { count: titleForSearch.length, max: SEARCH_TITLE_FITS })}
                    {titleForSearch.length > SEARCH_TITLE_FITS ? ` — ${t("admin.newSearchCut")}` : ""}
                  </li>
                  <li className="ink-muted">
                    {draft.description.trim()
                      ? t("admin.newSearchSnippetCount", { count: Math.min(draft.description.trim().length, SEARCH_SNIPPET_FITS), max: SEARCH_SNIPPET_FITS })
                      : t("admin.newSearchAddDescription")}
                  </li>
                </ul>
              </>
            )}
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24">
          <div className="rounded-2xl border border-[#e1e7ef] bg-white p-5">
            <h2 className="text-[15px] font-bold text-[#0a285a]">{t("admin.newChecklist")}</h2>
            <ul className="mt-3 space-y-2.5">
              {checklist.map(item => (
                <li key={item.key} className="flex items-center gap-2.5 text-[14px]">
                  {item.done ? (
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#2f5d33] text-white"><Check className="size-3.5" aria-hidden /></span>
                  ) : (
                    <Circle className={`size-5 shrink-0 ${item.required ? "text-[#0a285a]" : "text-[#9aa8bb]"}`} aria-hidden />
                  )}
                  <span className={item.done ? "text-[#0a285a]" : "text-[#536b8c]"}>{t(item.key)}</span>
                  <span className="sr-only">{t(item.done ? "admin.newDone" : "admin.newNotYet")}</span>
                  {!item.done ? (
                    <span className={`ms-auto rounded-full px-2 py-0.5 text-[12px] font-semibold ${item.required ? "bg-[#fdeceb] text-[#8c2f22]" : "bg-[#eef1f5] text-[#536b8c]"}`}>
                      {t(item.required ? "admin.newRequired" : "admin.newRecommended")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>

            <div className="mt-5 grid gap-2">
              {mayPublish ? (
                <button type="button" onClick={() => void submit(true)} disabled={busy !== null} className={buttonClass.primary}>
                  {busy === "publish" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                  {t(busy === "publish" ? "admin.newCreating" : publishGoesToReview ? "admin.newCreateReview" : "admin.newCreatePublish")}
                </button>
              ) : null}
              <button type="submit" disabled={busy !== null} className={mayPublish ? buttonClass.secondary : buttonClass.primary}>
                {busy === "draft" ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                {t(busy === "draft" ? "admin.newCreating" : "admin.newCreateDraft")}
              </button>
            </div>
            <p className="mt-3 text-[12px] leading-5 ink-muted">{t("admin.newDraftNote")}</p>
          </div>
        </aside>
      </form>
    </>
  );
}

/** A pasted address and its Add, with Enter adding rather than submitting the form. */
function PhotoLink({ id, value, onChange, onAdd, ...aria }: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <input
        id={id}
        {...aria}
        dir="ltr"
        type="url"
        inputMode="url"
        value={value}
        placeholder="https://"
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onAdd(); } }}
        className={fieldClass}
      />
      <button type="button" onClick={onAdd} className={buttonClass.secondary}>{t("admin.newPhotoAdd")}</button>
    </div>
  );
}
