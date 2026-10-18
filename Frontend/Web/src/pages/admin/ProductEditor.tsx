/**
 * One product: its details, its variants, its stock, and whether it is live.
 *
 * The publish control says what will actually happen rather than what was
 * asked for. A vendor without `autoPublish` pressing Publish sends the product
 * for review, and the page says so — a button labelled "Publish" that quietly
 * produces "In review" is the kind of small dishonesty that makes people
 * distrust a tool.
 *
 * Stock is adjusted by a delta, never typed as a new total. "We received 12"
 * is what happened; setting the box to 47 loses why it changed and races with
 * anyone else editing.
 */
import { STOCK_REASONS, stockMoveProblem } from "@shared/inventory/stockMoves";
import { SizeChartEditor } from "@/components/admin/SizeChartEditor";
import { AdminShell } from "@/components/admin/AdminShell";
import { Thumb } from "@/components/product/Thumb";
import { QueryGate } from "@/components/admin/QueryGate";
import { StatusPill } from "@/components/admin/StatusPill";
import { trpc } from "@/lib/trpc";
import { ADDON_KINDS, type AddonKind } from "@shared/commerce/addons";
import { useTranslation } from "@/hooks/useTranslation";
import { memberPriceProblem } from "@shared/commerce/membership";
import { isValidMeasure, SELL_UNITS, unitPrice, type SellUnit } from "@shared/commerce/units";
import { DELIVERY_SPEEDS, type DeliverySpeed } from "@shared/commerce/deliverySpeed";
import { SIZE_CLASSES, vehicleFor, type SizeClass } from "@shared/commerce/vehicle";
import { fieldsFor, freeFormRows, mergeAttributes } from "@shared/commerce/attributeSchema";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, type Actor } from "@shared/inventory/permissions";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { ArrowLeft, ArrowLeftRight, ExternalLink, Info, LoaderCircle, Minus, Play, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { PhotoUpload } from "@/components/admin/PhotoUpload";
import { DeleteProductDialog } from "@/components/admin/DeleteProductDialog";
import { Card, PageHeader, buttonClass, fieldClass, isolate } from "@/components/admin/ui";
import { StoreAvatar } from "@/components/admin/StoreAvatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { OPTION_NAME_MAX, OPTION_VALUE_MAX, optionPairs, optionPairsProblem, optionsDistinguish, optionsRecord, varyingOptionNames, type OptionPair } from "@shared/inventory/variantOptions";

const REASONS = STOCK_REASONS;

export default function AdminProductEditor() {
  usePageMeta(privatePageMeta("Product"));
  const [, params] = useRoute("/admin/products/:id");
  const id = Number(params?.id ?? 0);
  return <AdminShell need="product.view">{actor => <Editor actor={actor} productId={id} />}</AdminShell>;
}

/* The portal's one field style (`ui.tsx`), under the name this file has
   always used for it. */
const inputClass = fieldClass;

function Editor({ actor, productId }: { actor: Actor; productId: number }) {
  const { t, locale } = useTranslation();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const [deleting, setDeleting] = useState(false);
  /* Moving a product to another store (admin only): the store chosen, and
     whether the confirmation is open. */
  const [moveTo, setMoveTo] = useState("");
  const [confirmMove, setConfirmMove] = useState(false);
  const mayMove = can(actor, "product.reassign");
  const stores = trpc.inventory.vendors.list.useQuery({ pageSize: 200 }, { enabled: mayMove });
  const product = trpc.inventory.products.get.useQuery({ id: productId }, { enabled: productId > 0 });
  const categories = trpc.inventory.categories.useQuery();

  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ title: "", titleAr: "", description: "", descriptionAr: "", categoryId: "", tags: "" });
  const [images, setImages] = useState<{ url: string; altText: string; kind: "image" | "video"; posterUrl: string }[]>([]);
  /* The optional extras this product offers (3.1.2), edited as a whole list
     for the reason the images are: they are read as a set. */
  const [addons, setAddons] = useState<{ kind: AddonKind; label: string; labelAr: string; price: string }[]>([]);
  useEffect(() => {
    if (!product.data) return;
    setDraft({
      title: product.data.title,
      titleAr: product.data.titleAr ?? "",
      description: product.data.description ?? "",
      descriptionAr: product.data.descriptionAr ?? "",
      categoryId: product.data.categoryId ? String(product.data.categoryId) : "",
      tags: product.data.tags.join(", "),
    });
    /* Seed the specification form from what the product already holds, keyed
       the way the schema keys it — so a second save replaces rather than
       duplicating. */
    setSpecs(Object.fromEntries(
      (product.data.attributes ?? [])
        .filter(row => row.namespace === "spec")
        .map(row => [row.key, row.value]),
    ));
    // The raw rows carry `kind` and `posterUrl`, so a video already on the
    // product comes back as a video rather than being silently rewritten to a
    // photograph on the next save.
    setImages(product.data.images.map(item => ({
      url: item.url,
      altText: item.altText ?? "",
      kind: item.kind,
      posterUrl: item.posterUrl ?? "",
    })));
    setAddons((product.data.addons ?? []).map(addon => ({
      kind: addon.kind as AddonKind,
      label: addon.label,
      labelAr: addon.labelAr ?? "",
      price: addon.price,
    })));
  }, [product.data?.id]);

  const refresh = () => {
    void utils.inventory.products.get.invalidate({ id: productId });
    void utils.inventory.products.list.invalidate();
  };
  /*
   * The server's own refusal, when it wrote one.
   *
   * This used to read any message containing a dot as a permission error, so
   * every named refusal came out as "You do not have permission to do that" —
   * including "set a price before publishing", which is not a permission
   * problem and sent whoever read it looking for the wrong thing.
   */
  const fail = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed"));

  const save = trpc.inventory.products.update.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const saveSpecs = trpc.inventory.products.setAttributes.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const setSize = trpc.inventory.products.setSizeClass.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const setSpeed = trpc.inventory.products.setDeliverySpeed.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const setOffers = trpc.offers.setProductOpen.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const setStatus = trpc.inventory.products.setStatus.useMutation({
    onSuccess: status => {
      refresh();
      /* Live, and the was-price withheld for want of a permit: said with the
         confirmation, because it is the one thing about this publish the
         seller would otherwise find out from their own shop. */
      const hidden = status !== "draft" ? product.data?.offerHidden : null;
      toast.success(
        t(status === "pending_review" ? "admin.sentForReview" : status === "published" ? "admin.nowLive" : "admin.saved"),
        hidden ? { description: t(hidden === "expired" ? "admin.offerHiddenExpired" : "admin.offerHiddenMissing") } : undefined,
      );
    },
    onError: fail,
  });
  const saveImages = trpc.inventory.products.setImages.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });
  const saveAddons = trpc.inventory.products.setAddons.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    /* The one refusal a seller can act on: a free extra is a feature of the
       product, and the message says where to put it instead. */
    onError: error => (error.message === "ADDON_NOT_SELLABLE" ? toast.error(t("admin.addonFree")) : fail(error)),
  });
  const saveVariant = trpc.inventory.variants.save.useMutation({ onSuccess: () => { refresh(); toast.success(t("admin.saved")); }, onError: fail });
  const adjust = trpc.inventory.variants.adjustStock.useMutation({
    onSuccess: count => { refresh(); toast.success(t("admin.stockUpdated", { count })); },
    onError: fail,
  });
  const move = trpc.inventory.products.move.useMutation({
    onSuccess: result => {
      refresh();
      setConfirmMove(false);
      setMoveTo("");
      void utils.inventory.vendors.list.invalidate();
      toast.success(
        t("admin.moved", { store: isolate(result.to.name) }),
        result.bundlesWithdrawn > 0 ? { description: t("admin.movedBundles", { count: result.bundlesWithdrawn }) } : undefined,
      );
    },
    onError: error => { setConfirmMove(false); fail(error); },
  });
  const setCommission = trpc.inventory.products.setCommission.useMutation({
    onSuccess: () => { refresh(); toast.success(t("admin.saved")); },
    onError: fail,
  });

  if (product.isLoading || product.isError) return <QueryGate queries={[product]}>{() => null}</QueryGate>;
  if (!product.data) return <p className="text-sm font-bold">{t("product.notFound")}</p>;

  const row = product.data;
  const mayEdit = can(actor, "product.edit", row.vendorId);
  /* Derived from the class the seller picked, so the two cannot disagree. */
  const needsVehicle = vehicleFor({ sizeClass: row.sizeClass });
  /*
   * Which specification rows this department expects (3.1.7). Resolved from
   * the category's slug rather than its name, because the name is what a
   * merchant reads and the slug is what code groups on — the same split the
   * attribute keys themselves exist to make.
   */
  const departmentSlug = (categories.data ?? []).find(c => String(c.id) === String(row.categoryId))?.slug ?? null;
  const schemaFields = fieldsFor(departmentSlug);
  const extraRows = freeFormRows(row.attributes ?? [], departmentSlug);
  const mayPublish = can(actor, "product.publish", row.vendorId);
  const mayStock = can(actor, "stock.adjust", row.vendorId);
  /* No vendor rank reaches this, so the whole panel is absent for one rather
     than shown disabled — a greyed-out commission box invites the question of
     how to enable it. */
  const mayPrice = can(actor, "vendor.setCommission");
  const mayDelete = can(actor, "product.delete", row.vendorId);
  const variantRecords = row.variants.map(variant => variant.options ?? {});
  const knownOptionNames = Array.from(new Set(variantRecords.flatMap(options => Object.keys(options))));

  /* The sections, in the order a listing is finished: what it is, what it
     looks like, what it costs, then the rest. The jump list is drawn from the
     same array so a section cannot be added without a way to reach it. */
  const sections: { id: string; label: MessageKey }[] = [
    { id: "details", label: "admin.sectionDetails" },
    { id: "photos", label: "admin.images" },
    { id: "variants", label: "admin.variants" },
    { id: "shipping", label: "admin.sectionShipping" },
    { id: "sizes", label: "admin.sectionSizes" },
    { id: "extras", label: "admin.addons" },
    ...(mayPrice ? [{ id: "commission", label: "admin.productCommission" as MessageKey }] : []),
    ...(mayMove ? [{ id: "store", label: "admin.sectionStore" as MessageKey }] : []),
    ...(mayDelete ? [{ id: "delete", label: "admin.deleteProduct" as MessageKey }] : []),
  ];
  const saveButton = (pending: boolean, onClick: () => void, disabled = false) => (
    <button type="button" onClick={onClick} disabled={pending || disabled} className={buttonClass.primary}>
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
      {t(pending ? "admin.saving" : "admin.save")}
    </button>
  );

  return (
    <>
      <PageHeader
        title={row.title}
        actions={
          <>
            <StatusPill status={row.status} />
            {row.status === "published" ? (
              <a href={`/products/${encodeURIComponent(row.handle)}`} target="_blank" rel="noreferrer" className={buttonClass.secondary}>
                <ExternalLink className="size-4" aria-hidden />{t("admin.viewInShop")}
              </a>
            ) : null}
            {mayPublish ? (
              row.status === "published" ? (
                <button type="button" onClick={() => setStatus.mutate({ id: row.id, status: "draft" })} disabled={setStatus.isPending} className={buttonClass.secondary}>
                  {t("admin.unpublish")}
                </button>
              ) : (
                <button type="button" onClick={() => setStatus.mutate({ id: row.id, status: "published" })} disabled={setStatus.isPending} className={buttonClass.primary}>
                  {setStatus.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                  {t("admin.publish")}
                </button>
              )
            ) : null}
          </>
        }
      >
        <Link href="/admin/products" className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#536b8c] hover:text-[#0a285a]">
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("admin.products")}
        </Link>
      </PageHeader>

      {/* The shop is selling this at its price and not showing the saving,
          because the store's discount permit is missing or out of date. Said
          for as long as it is true, not only in the toast after Publish. */}
      {row.offerHidden ? (
        <div role="note" className="-mt-2 mb-5 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-[#ecd49a] bg-[#fff8e6] px-4 py-3 text-[14px] leading-6 text-[#5c3f0c]">
          <Info className="mt-1 size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{t(row.offerHidden === "expired" ? "admin.offerHiddenExpired" : "admin.offerHiddenMissing")}</p>
          {can(actor, "platform.viewAll") ? (
            <Link href={`/admin/vendors/${row.vendorId}`} className="font-semibold whitespace-nowrap underline underline-offset-2 hover:text-[#0a285a]">
              {t("admin.offerHiddenLink")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* An admin's verdict is written back here, so a rejected vendor sees why
          without being told separately. */}
      {row.reviewNote ? (
        <p dir="auto" className="-mt-2 mb-5 rounded-xl border border-[#f2b69e] bg-[#fdeceb] px-4 py-3 text-[14px] text-[#8c2f22]">{row.reviewNote}</p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[200px_minmax(0,1fr)] xl:items-start">
        {/* Eight sections is a long page, and it was one with no way to move
            through it but scrolling. A list of anchors, beside the form where
            there is room and across the top where there is not. */}
        <nav aria-label={t("admin.onThisPage")} className="min-w-0 xl:sticky xl:top-24">
          <p className="hidden text-[12px] font-semibold ink-muted xl:block">{t("admin.onThisPage")}</p>
          <ul className="hide-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 xl:mx-0 xl:mt-2 xl:flex-col xl:overflow-visible xl:px-0">
            {sections.map(section => (
              <li key={section.id} className="shrink-0">
                <a
                  href={`#${section.id}`}
                  className={`block rounded-lg px-3 py-2 text-[13px] font-semibold whitespace-nowrap transition hover:bg-[#0a285a]/[.06] hover:text-[#0a285a] ${section.id === "delete" ? "text-[#8c2f22]" : "text-[#536b8c]"}`}
                >
                  {t(section.label)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-5">
          <Card
            id="details"
            title={t("admin.sectionDetails")}
            footer={mayEdit ? saveButton(save.isPending, () => save.mutate({
              id: row.id,
              title: draft.title,
              titleAr: draft.titleAr || null,
              description: draft.description || null,
              descriptionAr: draft.descriptionAr || null,
              categoryId: draft.categoryId ? Number(draft.categoryId) : null,
              tags: draft.tags.split(",").map(tag => tag.trim()).filter(Boolean),
            }), !draft.title.trim()) : null}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Labelled label={t("admin.fieldTitle")}>
                <input dir="auto" value={draft.title} disabled={!mayEdit} onChange={e => setDraft({ ...draft, title: e.target.value })} aria-invalid={!draft.title.trim()} className={inputClass} />
              </Labelled>
              <Labelled label={t("admin.fieldTitleAr")}>
                <input dir="rtl" lang="ar" value={draft.titleAr} disabled={!mayEdit} onChange={e => setDraft({ ...draft, titleAr: e.target.value })} className={inputClass} />
              </Labelled>
              <Labelled label={t("admin.fieldCategory")} className="sm:col-span-2">
                <Select value={draft.categoryId} disabled={!mayEdit} onChange={e => setDraft({ ...draft, categoryId: e.target.value })} className={inputClass}>
                  <option value="">{t("admin.fieldNoCategory")}</option>
                  {(categories.data ?? []).map(category => (
                    <option key={category.id} value={category.id}>{locale === "ar" ? category.nameAr || category.name : category.name}</option>
                  ))}
                </Select>
              </Labelled>
              <Labelled label={t("admin.fieldDescription")} className="sm:col-span-2">
                <textarea dir="auto" value={draft.description} disabled={!mayEdit} onChange={e => setDraft({ ...draft, description: e.target.value })} rows={6} className={`${inputClass} h-auto min-h-36 py-2.5 leading-6`} />
              </Labelled>
              <Labelled label={t("admin.fieldDescriptionAr")} hint={t("admin.fieldDescriptionArHint")} className="sm:col-span-2">
                <textarea dir="rtl" lang="ar" value={draft.descriptionAr} disabled={!mayEdit} onChange={e => setDraft({ ...draft, descriptionAr: e.target.value })} rows={4} className={`${inputClass} h-auto min-h-28 py-2.5 leading-6`} />
              </Labelled>
              <Labelled label={t("admin.fieldTags")} hint={t("admin.tagsHint")} className="sm:col-span-2">
                <input dir="auto" value={draft.tags} disabled={!mayEdit} onChange={e => setDraft({ ...draft, tags: e.target.value })} className={inputClass} />
              </Labelled>
            </div>
          </Card>

          {/* Images are saved as a whole list, in order, so removing the third
              and adding a fourth are the same operation. Position is the array
              index — reordering is a save, not a separate protocol. */}
          <Card
            id="photos"
            title={t("admin.images")}
            description={t("admin.imagesHint")}
            footer={mayEdit ? (
              <>
                <button
                  type="button"
                  onClick={() => setImages([...images, { url: "", altText: "", kind: "image" as const, posterUrl: "" }])}
                  className={`${buttonClass.secondary} me-auto`}
                >
                  <Plus className="size-4" aria-hidden />{t("admin.addImage")}
                </button>
                {saveButton(saveImages.isPending, () => saveImages.mutate({
                  id: row.id,
                  /* A row left blank is an abandoned edit, not an image. The
                     kind and the poster travel too: without them every save
                     turned a product's video back into a "photo" of an .mp4. */
                  images: images
                    .filter(image => image.url.trim())
                    .map(image => ({
                      url: image.url.trim(),
                      altText: image.altText.trim() || null,
                      kind: image.kind,
                      posterUrl: image.kind === "video" ? image.posterUrl.trim() || null : null,
                    })),
                }))}
              </>
            ) : null}
          >
            {images.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#cfd9e6] bg-[#fafbfd] px-4 py-6 text-center text-[13px] ink-muted">{t("admin.noImages")}</p>
            ) : (
              <ul className="space-y-3">
                {images.map((image, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-xl border border-[#e1e7ef] p-3">
                    {/* A live preview is the only way to tell a good URL from a
                        typo before the product is on the shelf. A video previews
                        from its poster: loading the clip to draw a 64px square
                        would cost the vendor a download per row. */}
                    <div className={`size-16 shrink-0 overflow-hidden rounded-lg bg-[#f4f6f9] ${index === 0 ? "ring-2 ring-[#0a285a]/30" : ""}`}>
                      <Thumb
                        src={image.kind === "video" ? (image.posterUrl || undefined) : image.url}
                        alt=""
                        className="size-full object-cover"
                        icon={image.kind === "video" ? <Play className="size-5 text-[#536b8c]" /> : undefined}
                      />
                    </div>
                    <div className="grid min-w-0 flex-1 gap-2">
                      <input
                        dir="ltr"
                        value={image.url}
                        disabled={!mayEdit}
                        placeholder={t("admin.imageUrl")}
                        aria-label={t("admin.imageUrl")}
                        onChange={e => setImages(images.map((entry, i) => i === index ? { ...entry, url: e.target.value } : entry))}
                        className={inputClass}
                      />
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                        <input
                          dir="auto"
                          value={image.altText}
                          disabled={!mayEdit}
                          placeholder={t("admin.imageAlt")}
                          aria-label={t("admin.imageAlt")}
                          onChange={e => setImages(images.map((entry, i) => i === index ? { ...entry, altText: e.target.value } : entry))}
                          className={inputClass}
                        />
                        <Select
                          value={image.kind}
                          disabled={!mayEdit}
                          aria-label={t("admin.mediaKind")}
                          onChange={e => setImages(images.map((entry, i) => i === index ? { ...entry, kind: e.target.value as "image" | "video" } : entry))}
                          className={inputClass}
                        >
                          <option value="image">{t("admin.mediaImage")}</option>
                          <option value="video">{t("admin.mediaVideo")}</option>
                        </Select>
                      </div>
                      {image.kind === "video" ? (
                        <>
                          <input
                            dir="ltr"
                            value={image.posterUrl}
                            disabled={!mayEdit}
                            placeholder={t("admin.mediaPoster")}
                            aria-label={t("admin.mediaPoster")}
                            aria-describedby={`poster-hint-${index}`}
                            onChange={e => setImages(images.map((entry, i) => i === index ? { ...entry, posterUrl: e.target.value } : entry))}
                            className={inputClass}
                          />
                          <p id={`poster-hint-${index}`} className="text-[12px] ink-muted">{t("admin.mediaPosterHint")}</p>
                        </>
                      ) : null}
                    </div>
                    {mayEdit ? (
                      <button
                        type="button"
                        onClick={() => setImages(images.filter((_, i) => i !== index))}
                        aria-label={t("admin.removeImage")}
                        title={t("admin.removeImage")}
                        className="grid size-10 shrink-0 place-items-center rounded-lg text-[#536b8c] hover:bg-[#fdeceb] hover:text-[#8c2f22]"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {/* A photo from the seller's own device, fixed on the way in (3.3.4).
                It joins the list like a pasted URL and is saved with the rest. */}
            {mayEdit ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <PhotoUpload productName={draft.title} onUploaded={url => setImages(current => [...current, { url, altText: "", kind: "image" as const, posterUrl: "" }])} />
              </div>
            ) : null}
          </Card>

          <Card
            id="variants"
            title={t("admin.variants")}
            footer={mayEdit ? (
              <button
                type="button"
                onClick={() => saveVariant.mutate({ productId: row.id, title: t("admin.addVariant"), price: "0.000" })}
                className={`${buttonClass.secondary} me-auto`}
              >
                <Plus className="size-4" aria-hidden />{t("admin.addVariant")}
              </button>
            ) : null}
          >
            {/* Whether the options tell the variants apart is the rule the
                product page draws by, so this says what the shopper will see. */}
            {row.variants.length > 1 ? (
              <p className="mb-4 flex items-start gap-2 rounded-xl bg-[#f3f6fa] px-3 py-2.5 text-[13px] leading-5 text-[#0a285a]">
                <Info className="mt-0.5 size-4 shrink-0 ink-muted" aria-hidden />
                {optionsDistinguish(variantRecords)
                  ? t("admin.variantsByOptions", { names: varyingOptionNames(variantRecords).join(locale === "ar" ? "، " : ", ") })
                  : t("admin.variantsByName")}
              </p>
            ) : null}
            <div className="space-y-4">
              {row.variants.map(variant => (
                <VariantRow
                  key={variant.id}
                  variant={variant}
                  knownNames={knownOptionNames}
                  mayEdit={mayEdit}
                  /* NetLet's shelf is counted by NetLet (4.2); the server refuses a
                     seller's adjustment there, so the control is not offered. */
                  mayStock={mayStock && (variant.centreId == null || actor.kind === "admin")}
                  onSave={values => saveVariant.mutate({ id: variant.id, productId: row.id, ...values })}
                  onAdjust={(delta, reason) => adjust.mutate({ variantId: variant.id, delta, reason })}
                  pending={saveVariant.isPending || adjust.isPending}
                />
              ))}
            </div>
          </Card>

          {/* Each control saves on its own, like every section of a store's
              page: one Save across the page writes a change somebody made while
              editing something else entirely. Three states, not a checkbox —
              "always", "never" and "follow the store" are different
              instructions and a boolean would have lost the third, exactly as
              the per-product commission rate does. */}
          <Card id="shipping" title={t("admin.sectionShipping")}>
            <div className="grid gap-4 sm:grid-cols-2">
              {/* This product's own band, overriding the store's (3.2.5). A sofa
                  built to order and a cable off the shelf leave the same
                  warehouse. */}
              <Labelled label={t("admin.fieldDeliverySpeedProduct")}>
                <Select
                  value={row.deliverySpeed ?? ""}
                  disabled={!mayEdit || setSpeed.isPending}
                  onChange={e => setSpeed.mutate({ productId: row.id, speed: e.target.value === "" ? null : (e.target.value as DeliverySpeed) })}
                  className={inputClass}
                >
                  <option value="">{t("admin.speedInherit")}</option>
                  {DELIVERY_SPEEDS.map(speed => (
                    <option key={speed} value={speed}>{t(`speed.${speed}` as MessageKey)}</option>
                  ))}
                </Select>
              </Labelled>
              {/* How big it is, and what that means for dispatch (3.4.14). The
                  vehicle is derived rather than a second dropdown: two fields
                  that must agree eventually do not. */}
              <Labelled label={t("admin.fieldSizeClass")} hint={needsVehicle ? t("admin.needsVehicle", { vehicle: t(`vehicle.${needsVehicle}` as MessageKey) }) : undefined}>
                <Select
                  value={row.sizeClass ?? ""}
                  disabled={!mayEdit || setSize.isPending}
                  onChange={e => setSize.mutate({ productId: row.id, sizeClass: e.target.value === "" ? null : (e.target.value as SizeClass) })}
                  className={inputClass}
                >
                  <option value="">{t("admin.sizeUnset")}</option>
                  {SIZE_CLASSES.map(size => (
                    <option key={size} value={size}>{t(`size.${size}` as MessageKey)}</option>
                  ))}
                </Select>
              </Labelled>
              <Labelled label={t("admin.offersProductOpen")} className="sm:col-span-2">
                <Select
                  value={row.acceptsOffers === null || row.acceptsOffers === undefined ? "" : String(row.acceptsOffers)}
                  disabled={!mayEdit || setOffers.isPending}
                  onChange={e => setOffers.mutate({
                    productId: row.id,
                    accepts: e.target.value === "" ? null : e.target.value === "true",
                  })}
                  className={inputClass}
                >
                  <option value="">{t("admin.offersProductInherit")}</option>
                  <option value="true">{t("admin.offersProductYes")}</option>
                  <option value="false">{t("admin.offersProductNo")}</option>
                </Select>
              </Labelled>
            </div>

            {/* The rows this department expects (3.1.7). The schema *offers*
                rows rather than restricting them: anything a seller typed that
                it does not know about is listed below, untouched, because a
                schema that deletes merchant data on first save is one nobody
                uses twice. */}
            {schemaFields.length ? (
              <div className="mt-6 border-t border-[#eef1f5] pt-5">
                <h3 className="text-[14px] font-bold text-[#0a285a]">{t("admin.specifications")}</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {schemaFields.map(spec => (
                    <Labelled
                      key={spec.key}
                      label={locale === "ar" ? spec.labelAr : spec.label}
                      hint={spec.unit ?? undefined}
                    >
                      {spec.options ? (
                        <Select
                          value={specs[spec.key] ?? ""}
                          disabled={!mayEdit}
                          onChange={e => setSpecs(map => ({ ...map, [spec.key]: e.target.value }))}
                          className={inputClass}
                        >
                          <option value="">{t("admin.sizeUnset")}</option>
                          {spec.options.map(option => <option key={option} value={option}>{option}</option>)}
                        </Select>
                      ) : (
                        <input
                          dir="auto"
                          value={specs[spec.key] ?? ""}
                          disabled={!mayEdit}
                          onChange={e => setSpecs(map => ({ ...map, [spec.key]: e.target.value }))}
                          className={inputClass}
                        />
                      )}
                    </Labelled>
                  ))}
                </div>
                {extraRows.length ? (
                  <p className="mt-3 text-[12px] ink-muted">
                    {t("admin.specificationsKept", { rows: extraRows.map(r => r.label).join(", ") })}
                  </p>
                ) : null}
                {mayEdit ? (
                  <div className="mt-4 flex justify-end">
                    {saveButton(saveSpecs.isPending, () => saveSpecs.mutate({ id: row.id, attributes: mergeAttributes(row.attributes ?? [], departmentSlug, specs) }))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>

          {/* The size chart (3.1.20): the sizes start from this product's own. */}
          <div id="sizes" className="scroll-mt-24">
            <SizeChartEditor
              productId={row.id}
              chart={row.sizeChart ?? null}
              variantOptions={row.variants.map(variant => variant.options ?? {})}
              mayEdit={mayEdit}
            />
          </div>

          {/* Optional extras (3.1.2): a fact about the product rather than
              about one size of it — a fitting is the same visit whichever
              colour was picked. */}
          <Card
            id="extras"
            title={t("admin.addons")}
            description={t("admin.addonsNote")}
            footer={mayEdit ? (
              <>
                <button
                  type="button"
                  onClick={() => setAddons([...addons, { kind: "installation" as AddonKind, label: "", labelAr: "", price: "" }])}
                  className={`${buttonClass.secondary} me-auto`}
                >
                  <Plus className="size-4" aria-hidden />{t("admin.addonAdd")}
                </button>
                {saveButton(saveAddons.isPending, () => saveAddons.mutate({
                  id: row.id,
                  // A row left blank is an abandoned edit, not an extra.
                  addons: addons
                    .filter(addon => addon.label.trim() && addon.price.trim())
                    .map(addon => ({
                      kind: addon.kind,
                      label: addon.label.trim(),
                      labelAr: addon.labelAr.trim() || null,
                      price: addon.price.trim(),
                    })),
                }))}
              </>
            ) : null}
          >
            {addons.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#cfd9e6] bg-[#fafbfd] px-4 py-6 text-center text-[13px] ink-muted">{t("admin.addonsEmpty")}</p>
            ) : (
              <ul className="space-y-3">
                {addons.map((addon, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-xl border border-[#e1e7ef] p-3">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_160px_130px]">
                      <input
                        dir="auto"
                        value={addon.label}
                        disabled={!mayEdit}
                        placeholder={t("admin.addonLabel")}
                        aria-label={t("admin.addonLabel")}
                        onChange={e => setAddons(addons.map((entry, i) => i === index ? { ...entry, label: e.target.value } : entry))}
                        className={inputClass}
                      />
                      <Select
                        value={addon.kind}
                        disabled={!mayEdit}
                        aria-label={t("admin.addonKind")}
                        onChange={e => setAddons(addons.map((entry, i) => i === index ? { ...entry, kind: e.target.value as AddonKind } : entry))}
                        className={inputClass}
                      >
                        {ADDON_KINDS.map(kind => (
                          <option key={kind} value={kind}>
                            {t(kind === "installation" ? "product.addonInstallation" : kind === "warranty" ? "product.addonWarranty" : "product.addonOther")}
                          </option>
                        ))}
                      </Select>
                      <input
                        dir="ltr"
                        inputMode="decimal"
                        value={addon.price}
                        disabled={!mayEdit}
                        placeholder={t("admin.addonPrice")}
                        aria-label={t("admin.addonPrice")}
                        onChange={e => setAddons(addons.map((entry, i) => i === index ? { ...entry, price: e.target.value } : entry))}
                        className={inputClass}
                      />
                    </div>
                    {mayEdit ? (
                      <button
                        type="button"
                        onClick={() => setAddons(addons.filter((_, i) => i !== index))}
                        aria-label={t("admin.addonRemove")}
                        title={t("admin.addonRemove")}
                        className="grid size-10 shrink-0 place-items-center rounded-lg text-[#536b8c] hover:bg-[#fdeceb] hover:text-[#8c2f22]"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {mayPrice ? (
            <CommissionPanel
              percent={row.commissionPercent}
              fixed={row.commissionFixed}
              pending={setCommission.isPending}
              onSave={rule => setCommission.mutate({ id: row.id, ...rule })}
            />
          ) : null}

          {/* Which store sells it, and handing it to another (admin only).
              `Backend/src/services/productMove.ts` decides what follows the product and
              what stays with the store that sold it; the dialog says so
              before anybody confirms. */}
          {mayMove ? (() => {
            const current = (stores.data?.rows ?? []).find(store => store.id === row.vendorId);
            const others = (stores.data?.rows ?? []).filter(store => store.id !== row.vendorId);
            const target = others.find(store => String(store.id) === moveTo);
            const currentName = current?.name ?? `#${row.vendorId}`;
            return (
              <Card id="store" title={t("admin.sectionStore")} description={t("admin.sectionStoreNote")}>
                <div className="flex flex-wrap items-center gap-3">
                  <StoreAvatar name={currentName} logoUrl={current?.logoUrl} />
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-[15px] font-bold text-[#0a285a]">{currentName}</p>
                    <Link href={`/admin/vendors/${row.vendorId}`} className="text-[13px] font-semibold text-[#536b8c] hover:text-[#0a285a] hover:underline">
                      {t("admin.storeLink")}
                    </Link>
                  </div>
                </div>
                {others.length ? (
                  <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#eef1f5] pt-4">
                    <label className="block min-w-0 flex-1 basis-60">
                      <span className="block text-[13px] leading-5 font-semibold text-[#0a285a]">{t("admin.moveTo")}</span>
                      <Select value={moveTo} onChange={event => setMoveTo(event.target.value)} className={`${inputClass} mt-1.5`}>
                        <option value="">—</option>
                        {others.map(store => (
                          <option key={store.id} value={store.id}>
                            {store.name}{store.status !== "approved" ? ` — ${t(`vendorStatus.${store.status}` as MessageKey)}` : ""}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <button type="button" onClick={() => setConfirmMove(true)} disabled={!target || move.isPending} className={buttonClass.secondary}>
                      <ArrowLeftRight className="size-4" aria-hidden />{t("admin.moveButton")}
                    </button>
                  </div>
                ) : null}
                <ConfirmDialog
                  open={confirmMove && Boolean(target)}
                  title={t("admin.moveTitle", { title: isolate(row.title), store: isolate(target?.name ?? "") })}
                  body={t("admin.moveBody", { from: isolate(currentName), store: isolate(target?.name ?? "") })}
                  confirmLabel={t("admin.moveButton")}
                  pending={move.isPending}
                  icon={<ArrowLeftRight className="size-5" aria-hidden />}
                  onConfirm={() => target && move.mutate({ id: row.id, vendorId: target.id })}
                  onClose={() => setConfirmMove(false)}
                />
              </Card>
            );
          })() : null}

          {/* Last, apart, and in red: the one act on this page that cannot be
              taken back. The dialog asks for the name. */}
          {mayDelete ? (
            <Card id="delete" tone="danger" title={t("admin.deleteProduct")} description={t("admin.deleteSectionNote")}>
              <button type="button" onClick={() => setDeleting(true)} className={buttonClass.quietDanger}>
                <Trash2 className="size-4" aria-hidden />{t("admin.deleteProduct")}
              </button>
            </Card>
          ) : null}
        </div>
      </div>

      <DeleteProductDialog
        product={deleting ? { id: row.id, title: row.title } : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => navigate("/admin/products")}
      />
    </>
  );
}

/**
 * The per-product override of the vendor's rate.
 *
 * Empty means "no override" and falls back to the vendor, which is why both
 * boxes clear to null rather than to zero: a zero here is a deliberate
 * commission-free product, and the two have to stay tellable apart.
 */
function CommissionPanel({
  percent,
  fixed,
  pending,
  onSave,
}: {
  percent: string | null;
  fixed: string | null;
  pending: boolean;
  onSave: (rule: { percent: string | null; fixed: string | null }) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ percent: percent ?? "", fixed: fixed ?? "" });
  useEffect(() => { setDraft({ percent: percent ?? "", fixed: fixed ?? "" }); }, [percent, fixed]);

  const trimmed = { percent: draft.percent.trim(), fixed: draft.fixed.trim() };

  return (
    <Card
      id="commission"
      title={t("admin.productCommission")}
      description={t("admin.productCommissionNote")}
      footer={
        <button
          type="button"
          onClick={() => onSave({ percent: trimmed.percent || null, fixed: trimmed.fixed || null })}
          disabled={pending}
          className={buttonClass.primary}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {t("admin.save")}
        </button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {/* The ceiling is on the label, because the API refuses above it and a
            form that does not say so leaves an admin typing 500 and reading
            "Could not save". */}
        <Labelled label={t("admin.commissionPercent")} hint={t("admin.commissionPercentHint")}>
          <input
            dir="ltr"
            inputMode="decimal"
            value={draft.percent}
            onChange={event => setDraft({ ...draft, percent: event.target.value })}
            className={inputClass}
          />
        </Labelled>
        <Labelled label={t("admin.commissionFixed")}>
          <input
            dir="ltr"
            inputMode="decimal"
            value={draft.fixed}
            onChange={event => setDraft({ ...draft, fixed: event.target.value })}
            className={inputClass}
          />
        </Labelled>
      </div>
    </Card>
  );
}

/**
 * A label wrapped round its control, with the hint under the box.
 *
 * Wrapping rather than `htmlFor`, because several of these hold a composite
 * control (a stepper, a value and its note) and a wrapping label names the
 * first field inside it without an id to keep in step.
 */
function Labelled({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[13px] leading-5 font-semibold text-[#0a285a]">{label}</span>
      <span className="mt-1.5 block">{children}</span>
      {hint ? <span className="mt-1.5 block text-[12px] leading-5 ink-muted">{hint}</span> : null}
    </label>
  );
}

function VariantRow({ variant, knownNames, mayEdit, mayStock, onSave, onAdjust, pending }: {
  variant: { id: number; title: string; sku: string | null; price: string; compareAtPrice: string | null; stock: number; unit?: string | null; stepAmount?: string | number | null; preorderStock?: number | null; preorderReleaseAt?: string | Date | null; centreId?: number | null; memberPrice?: string | null; options?: Record<string, string> | null };
  /** Option names any variant of this product uses, so a new row starts on one. */
  knownNames: string[];
  mayEdit: boolean;
  mayStock: boolean;
  onSave: (values: { title: string; sku: string | null; price: string; compareAtPrice: string | null; unit: SellUnit; stepAmount: number; preorderStock: number; preorderReleaseAt: Date | null; memberPrice: string | null; options: Record<string, string> }) => void;
  onAdjust: (delta: number, reason: (typeof REASONS)[number]) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState({
    title: variant.title,
    sku: variant.sku ?? "",
    price: variant.price,
    compareAtPrice: variant.compareAtPrice ?? "",
    unit: (variant.unit ?? "each") as SellUnit,
    stepAmount: String(variant.stepAmount ?? 1),
    preorderStock: String(variant.preorderStock ?? 0),
    memberPrice: variant.memberPrice ?? "",
    // <input type="date"> speaks yyyy-mm-dd and nothing else.
    preorderReleaseAt: variant.preorderReleaseAt
      ? new Date(variant.preorderReleaseAt).toISOString().slice(0, 10)
      : "",
  });

  const measure = { unit: values.unit, stepAmount: Number(values.stepAmount) };
  /*
   * The *same* predicate the server refuses with, so the form cannot save a
   * measure the API would reject — the arrangement the password floor uses.
   * A half-gram step is what puts floating point back into the arithmetic.
   */
  const measureOk = isValidMeasure(measure);
  /*
   * Same shape as the measure check: the form refuses what the server refuses,
   * so Save is never a button that produces an error. A fractional or negative
   * allowance is not a number of parcels.
   */
  const preorderAllowance = Number(values.preorderStock);
  /* A pre-order is a promise about units nobody holds; NetLet's shelf holds only what it counted (4.2). */
  const held = variant.centreId != null;
  const preorderOk = Number.isInteger(preorderAllowance) && preorderAllowance >= 0 && !(held && preorderAllowance > 0);
  const memberTyped = values.memberPrice.trim();
  const memberProblem = memberTyped === "" ? null : /^\d{1,9}(\.\d{1,3})?$/.test(memberTyped) && /^\d{1,9}(\.\d{1,3})?$/.test(values.price) ? memberPriceProblem(values.price, memberTyped) : "membership.priceInvalid";
  const perUnit = measureOk ? unitPrice(values.price || "0", measure) : null;
  /* Colour: Black, Storage: 256 GB — the rows the product page draws as choices. */
  const [pairs, setPairs] = useState<OptionPair[]>(() => optionPairs(variant.options));
  const optionProblem = optionPairsProblem(pairs);
  const setPair = (index: number, change: Partial<OptionPair>) =>
    setPairs(current => current.map((pair, at) => (at === index ? { ...pair, ...change } : pair)));
  const addPair = () => setPairs(current => {
    const used = new Set(current.map(pair => pair.name.trim().toLocaleLowerCase()));
    const next = knownNames.find(name => !used.has(name.toLocaleLowerCase())) ?? "";
    return [...current, { name: next, value: "" }];
  });
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("received");
  /* The server's own rule, asked before the press. */
  const moveProblem = stockMoveProblem(delta, reason);

  return (
    <div className="rounded-xl border border-[#e1e7ef] bg-[#fafbfd] p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Labelled label={t("admin.variantTitle")}>
          <input dir="auto" value={values.title} disabled={!mayEdit} onChange={e => setValues({ ...values, title: e.target.value })} className={inputClass} />
        </Labelled>
        <Labelled label={t("admin.variantSku")}>
          <input dir="ltr" value={values.sku} disabled={!mayEdit} onChange={e => setValues({ ...values, sku: e.target.value })} className={inputClass} />
        </Labelled>
        <Labelled label={t("admin.variantPrice")} hint={t("admin.priceHint")}>
          <input dir="ltr" inputMode="decimal" value={values.price} disabled={!mayEdit} onChange={e => setValues({ ...values, price: e.target.value })} className={inputClass} />
        </Labelled>
        <Labelled label={t("admin.variantCompareAt")}>
          <input dir="ltr" inputMode="decimal" value={values.compareAtPrice} disabled={!mayEdit} onChange={e => setValues({ ...values, compareAtPrice: e.target.value })} className={inputClass} />
        </Labelled>
        {/* What a NetLet member pays (4.1); blank is none. Checked by the rule the server applies. */}
        <Labelled label={t("membership.memberPriceLabel")} hint={memberProblem ? t(memberProblem) : t("membership.memberPriceHint")}>
          <input dir="ltr" inputMode="decimal" value={values.memberPrice} disabled={!mayEdit} aria-invalid={Boolean(memberProblem)} onChange={e => setValues({ ...values, memberPrice: e.target.value })} className={inputClass} />
        </Labelled>
      </div>

      {/*
        The grocery shelf. Left alone, a variant is `each` × 1 and behaves as
        every product in the shop does today — so this row costs a vendor who
        sells kettles nothing but two defaults they never touch.
      */}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Labelled label={t("admin.variantUnit")} hint={t("admin.variantUnitHint")}>
          <Select
            value={values.unit}
            disabled={!mayEdit}
            onChange={e => setValues({ ...values, unit: e.target.value as SellUnit, stepAmount: e.target.value === "each" ? "1" : values.stepAmount })}
            className={inputClass}
          >
            {SELL_UNITS.map(unit => <option key={unit} value={unit}>{t(`unit.${unit}` as MessageKey)}</option>)}
          </Select>
        </Labelled>
        <Labelled label={t("admin.variantStep")} hint={t("admin.variantStepHint")}>
          <input
            dir="ltr" inputMode="decimal" value={values.stepAmount}
            disabled={!mayEdit || values.unit === "each"}
            onChange={e => setValues({ ...values, stepAmount: e.target.value })}
            aria-invalid={!measureOk}
            className={inputClass}
          />
        </Labelled>
        <Labelled label={t("admin.variantUnitPrice")}>
          {/* Read-only and derived: the figure the shopper will compare on,
              shown to the vendor before they save rather than after. */}
          <p className="flex h-11 items-center px-1 text-[14px] font-bold text-[#0a285a]">
            {perUnit
              ? t("unit.perUnit", { price: perUnit.amount, unit: t(`unit.${perUnit.unit}` as MessageKey) })
              : "—"}
          </p>
        </Labelled>
      </div>
      {!measureOk ? <p className="mt-1.5 text-[12px] font-semibold text-[#8c2f22]">{t("admin.variantStepInvalid")}</p> : null}

      <fieldset className="mt-4" aria-describedby={`options-hint-${variant.id}`}>
        <legend className="text-[13px] leading-5 font-semibold text-[#0a285a]">{t("admin.variantOptions")}</legend>
        <p id={`options-hint-${variant.id}`} className="mt-0.5 text-[12px] leading-5 ink-muted">{t("admin.variantOptionsHint")} {t("admin.variantPhotoHint")}</p>
        {pairs.length ? (
          <ul className="mt-2 space-y-2">
            {pairs.map((pair, index) => (
              <li key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                <input
                  dir="auto"
                  value={pair.name}
                  maxLength={OPTION_NAME_MAX}
                  disabled={!mayEdit}
                  onChange={event => setPair(index, { name: event.target.value })}
                  aria-label={t("admin.optionName")}
                  placeholder={t("admin.optionName")}
                  className={inputClass}
                />
                <input
                  dir="auto"
                  value={pair.value}
                  maxLength={OPTION_VALUE_MAX}
                  disabled={!mayEdit}
                  onChange={event => setPair(index, { value: event.target.value })}
                  aria-label={pair.name.trim() ? `${t("admin.optionValue")}: ${pair.name.trim()}` : t("admin.optionValue")}
                  placeholder={t("admin.optionValue")}
                  className={inputClass}
                />
                {mayEdit ? (
                  <button
                    type="button"
                    onClick={() => setPairs(current => current.filter((_, at) => at !== index))}
                    aria-label={t("admin.removeOption")}
                    title={t("admin.removeOption")}
                    className="grid size-11 place-items-center rounded-xl border border-[#cfd9e6] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {mayEdit ? (
          <button type="button" onClick={addPair} className={`${buttonClass.secondary} mt-2`}>
            <Plus className="size-4" aria-hidden />{t("admin.addOption")}
          </button>
        ) : null}
        {optionProblem ? <p role="alert" className="mt-1.5 text-[12px] font-semibold text-[#8c2f22]">{t(optionProblem)}</p> : null}
      </fieldset>

      {/* Pre-order: a second, bounded pool the vendor chooses the size of.
          Beside the stock figure rather than in a panel of its own, because the
          question it answers — how many may I sell — is the same question. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Labelled label={t("admin.preorderStock")}>
          <input
            type="number"
            min={0}
            step={1}
            value={values.preorderStock}
            onChange={event => setValues(v => ({ ...v, preorderStock: event.target.value }))}
            disabled={!mayEdit}
            aria-invalid={!preorderOk}
            aria-describedby={`preorder-hint-${variant.id}`}
            className={inputClass}
          />
          <p id={`preorder-hint-${variant.id}`} className="mt-1.5 text-[12px] leading-5 ink-muted">{t("admin.preorderStockHint")}</p>
        </Labelled>
        <Labelled label={t("admin.preorderReleaseAt")}>
          <input
            type="date"
            value={values.preorderReleaseAt}
            onChange={event => setValues(v => ({ ...v, preorderReleaseAt: event.target.value }))}
            disabled={!mayEdit || preorderAllowance <= 0}
            aria-describedby={`release-hint-${variant.id}`}
            className={inputClass}
          />
          <p id={`release-hint-${variant.id}`} className="mt-1.5 text-[12px] leading-5 ink-muted">{t("admin.preorderReleaseHint")}</p>
        </Labelled>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] font-semibold text-[#536b8c]">
          {t("admin.variantStock")}: <strong className={variant.stock === 0 ? "text-[#b3261e]" : "text-[#0a285a]"}>{variant.stock}</strong>
          {held ? <span className="ms-2 inline-flex items-center gap-1 rounded-full bg-[#e7edf5] px-2 py-0.5 text-[12px] font-semibold text-[#0a285a]">{t("fulfilment.heldBadge")}</span> : null}
        </p>
        {mayEdit ? (
          <button
            onClick={() => onSave({
              title: values.title, sku: values.sku || null, price: values.price,
              compareAtPrice: values.compareAtPrice || null,
              unit: measure.unit, stepAmount: measure.stepAmount,
              preorderStock: preorderAllowance,
              preorderReleaseAt: values.preorderReleaseAt ? new Date(values.preorderReleaseAt) : null,
              memberPrice: memberTyped || null,
              options: optionsRecord(pairs),
            })}
            disabled={pending || !measureOk || !preorderOk || Boolean(memberProblem) || optionProblem !== null}
            className={buttonClass.secondary}
          >
            <Save className="size-4" aria-hidden />{t("admin.save")}
          </button>
        ) : null}
      </div>

      {/* Staff reach this and nothing else on the row, which is the whole point
          of the rank: count the boxes without touching the price. */}
      {mayStock ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#e1e7ef] pt-4">
          {/* A group, not a label: a label wrapped round this would name the
              minus button first, and pressing the words would take one off. */}
          <div role="group" aria-labelledby={`adjust-${variant.id}`}>
            <span id={`adjust-${variant.id}`} className="block text-[13px] leading-5 font-semibold text-[#0a285a]">{t("admin.adjustBy")}</span>
            <div className="mt-1.5 inline-flex items-center gap-1">
              <button type="button" onClick={() => setDelta(d => d - 1)} aria-label={t("product.decreaseQuantity")} className="grid size-11 place-items-center rounded-xl border border-[#cfd9e6] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"><Minus className="size-4" aria-hidden /></button>
              <input dir="ltr" inputMode="numeric" value={delta} onChange={e => setDelta(Number(e.target.value) || 0)} className={`${inputClass} w-20 text-center`} aria-label={t("admin.adjustBy")} />
              <button type="button" onClick={() => setDelta(d => d + 1)} aria-label={t("product.increaseQuantity")} className="grid size-11 place-items-center rounded-xl border border-[#cfd9e6] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"><Plus className="size-4" aria-hidden /></button>
            </div>
          </div>
          <Labelled label={t("admin.reason")}>
            <Select value={reason} onChange={e => setReason(e.target.value as (typeof REASONS)[number])} className={inputClass}>
              {REASONS.map(entry => <option key={entry} value={entry}>{t(`reason.${entry}` as MessageKey)}</option>)}
            </Select>
          </Labelled>
          <button
            onClick={() => onAdjust(delta, reason)}
            disabled={pending || moveProblem !== null}
            aria-describedby={moveProblem ? `adjust-problem-${variant.id}` : undefined}
            className={buttonClass.primary}
          >
            {t("admin.adjustStock")}
          </button>
          {moveProblem === "stock.wrongDirection" ? (
            <p id={`adjust-problem-${variant.id}`} className="basis-full text-[12px] leading-5 font-semibold text-[#8c2f22]">{t(moveProblem)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
