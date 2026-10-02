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
import { SizeChartEditor } from "@/components/admin/SizeChartEditor";
import { AdminShell } from "@/components/admin/AdminShell";
import { Thumb } from "@/components/product/Thumb";
import { QueryGate } from "@/components/admin/QueryGate";
import { StatusPill } from "@/components/admin/StatusPill";
import { trpc } from "@/lib/trpc";
import { ADDON_KINDS, type AddonKind } from "@shared/commerce/addons";
import { useTranslation } from "@/hooks/useTranslation";
import { isValidMeasure, SELL_UNITS, unitPrice, type SellUnit } from "@shared/commerce/units";
import { DELIVERY_SPEEDS, type DeliverySpeed } from "@shared/commerce/deliverySpeed";
import { SIZE_CLASSES, vehicleFor, type SizeClass } from "@shared/commerce/vehicle";
import { fieldsFor, freeFormRows, mergeAttributes, valueOf } from "@shared/commerce/attributeSchema";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, type Actor } from "@shared/inventory/permissions";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { ArrowLeft, LoaderCircle, Minus, Play, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { toast } from "sonner";

const REASONS = ["received", "sold", "damaged", "correction", "returned"] as const;

export default function AdminProductEditor() {
  usePageMeta(privatePageMeta("Product"));
  const [, params] = useRoute("/admin/products/:id");
  const id = Number(params?.id ?? 0);
  return <AdminShell need="product.view">{actor => <Editor actor={actor} productId={id} />}</AdminShell>;
}

const inputClass = "type-body h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

function Editor({ actor, productId }: { actor: Actor; productId: number }) {
  const { t, locale } = useTranslation();
  const utils = trpc.useUtils();
  const product = trpc.inventory.products.get.useQuery({ id: productId }, { enabled: productId > 0 });
  const categories = trpc.inventory.categories.useQuery();

  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState({ title: "", titleAr: "", description: "", categoryId: "", tags: "" });
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
      toast.success(t(status === "pending_review" ? "admin.sentForReview" : status === "published" ? "admin.nowLive" : "admin.saved"));
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

  return (
    <>
      <Link href="/admin/products" className="inline-flex items-center gap-2 text-[12px] font-bold text-[#536b8c] hover:text-[#0a285a]">
        <ArrowLeft className="size-4 rtl:-scale-x-100" />{t("admin.products")}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 dir="auto" className="text-xl font-extrabold">{row.title}</h1>
        <div className="flex items-center gap-2">
          <StatusPill status={row.status} />
          {mayPublish ? (
            row.status === "published" ? (
              <button onClick={() => setStatus.mutate({ id: row.id, status: "draft" })} className="glass pressable rounded-full border border-[#0a285a]/15 px-4 py-2 text-xs font-extrabold">
                {t("admin.unpublish")}
              </button>
            ) : (
              <button onClick={() => setStatus.mutate({ id: row.id, status: "published" })} disabled={setStatus.isPending} className="glass glass-accent pressable rounded-full px-4 py-2 text-xs font-extrabold disabled:opacity-60">
                {t("admin.publish")}
              </button>
            )
          ) : null}
        </div>
      </div>

      {/* An admin's verdict is written back here, so a rejected vendor sees why
          without being told separately. */}
      {row.reviewNote ? (
        <p className="mt-3 rounded-xl border border-[#f2b69e] bg-[#fdeceb] px-4 py-3 text-[13px] text-[#8c2f22]">{row.reviewNote}</p>
      ) : null}

      <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label={t("admin.fieldTitle")}>
            <input dir="auto" value={draft.title} disabled={!mayEdit} onChange={e => setDraft({ ...draft, title: e.target.value })} className={inputClass} />
          </Labelled>
          <Labelled label={t("admin.fieldTitleAr")}>
            <input dir="rtl" value={draft.titleAr} disabled={!mayEdit} onChange={e => setDraft({ ...draft, titleAr: e.target.value })} className={inputClass} />
          </Labelled>
          <Labelled label={t("admin.fieldCategory")} className="sm:col-span-2">
            <select value={draft.categoryId} disabled={!mayEdit} onChange={e => setDraft({ ...draft, categoryId: e.target.value })} className={inputClass}>
              <option value="">{t("admin.fieldNoCategory")}</option>
              {(categories.data ?? []).map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </Labelled>
          <Labelled label={t("admin.fieldDescription")} className="sm:col-span-2">
            <textarea dir="auto" value={draft.description} disabled={!mayEdit} onChange={e => setDraft({ ...draft, description: e.target.value })} className={`${inputClass} h-28 py-2`} />
          </Labelled>
          <Labelled label={t("admin.fieldTags")} hint={t("admin.tagsHint")} className="sm:col-span-2">
            <input value={draft.tags} disabled={!mayEdit} onChange={e => setDraft({ ...draft, tags: e.target.value })} className={inputClass} />
          </Labelled>
        </div>

        {mayEdit ? (
          <button
            onClick={() => save.mutate({
              id: row.id,
              title: draft.title,
              titleAr: draft.titleAr || null,
              description: draft.description || null,
              categoryId: draft.categoryId ? Number(draft.categoryId) : null,
              tags: draft.tags.split(",").map(tag => tag.trim()).filter(Boolean),
            })}
            disabled={save.isPending}
            className="glass glass-navy pressable mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
          >
            {save.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t(save.isPending ? "admin.saving" : "admin.save")}
          </button>
        ) : null}
      </section>

      {/* Its own control saving on its own, like every section of a store's
          page: one Save across the page writes a change somebody made while
          editing something else entirely. Three states, not a checkbox —
          "always", "never" and "follow the store" are different instructions
          and a boolean would have lost the third, exactly as the per-product
          commission rate does. */}
      <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        {/* This product's own band, overriding the store's (3.2.5). Same
            three-state shape as the price-request flag beside it: "follow the
            store" is a different instruction from choosing a band, and a
            two-state control would lose it. A sofa built to order and a cable
            off the shelf leave the same warehouse. */}
        <Labelled label={t("admin.fieldDeliverySpeedProduct")} className="mb-4">
          <select
            value={row.deliverySpeed ?? ""}
            disabled={!mayEdit || setSpeed.isPending}
            onChange={e => setSpeed.mutate({ productId: row.id, speed: e.target.value === "" ? null : (e.target.value as DeliverySpeed) })}
            className={inputClass}
          >
            <option value="">{t("admin.speedInherit")}</option>
            {DELIVERY_SPEEDS.map(speed => (
              <option key={speed} value={speed}>{t(`speed.${speed}` as MessageKey)}</option>
            ))}
          </select>
        </Labelled>
        {/* The rows this department expects (3.1.7). The schema *offers* rows
            rather than restricting them: anything a seller typed that it does
            not know about is listed below, untouched, because a schema that
            deletes merchant data on first save is one nobody uses twice. */}
        {schemaFields.length ? (
          <div className="mb-4">
            <p className="text-[11px] font-extrabold text-[#0a285a]">{t("admin.specifications")}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {schemaFields.map(spec => (
                <Labelled
                  key={spec.key}
                  label={locale === "ar" ? spec.labelAr : spec.label}
                  hint={spec.unit ?? undefined}
                >
                  {spec.options ? (
                    <select
                      value={specs[spec.key] ?? ""}
                      disabled={!mayEdit}
                      onChange={e => setSpecs(map => ({ ...map, [spec.key]: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">{t("admin.sizeUnset")}</option>
                      {spec.options.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
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
              <p className="mt-2 text-[11px] ink-muted">
                {t("admin.specificationsKept", { rows: extraRows.map(r => r.label).join(", ") })}
              </p>
            ) : null}
            {mayEdit ? (
              <button
                onClick={() => saveSpecs.mutate({ id: row.id, attributes: mergeAttributes(row.attributes ?? [], departmentSlug, specs) })}
                disabled={saveSpecs.isPending}
                className="glass glass-navy pressable mt-3 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
              >
                {saveSpecs.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                {t(saveSpecs.isPending ? "admin.saving" : "admin.save")}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* How big it is, and what that means for dispatch (3.4.14). The
            vehicle is derived rather than a second dropdown: two fields that
            must agree eventually do not, and the seller can answer the first
            without a tape measure. */}
        <Labelled label={t("admin.fieldSizeClass")} className="mb-4">
          <select
            value={row.sizeClass ?? ""}
            disabled={!mayEdit || setSize.isPending}
            onChange={e => setSize.mutate({ productId: row.id, sizeClass: e.target.value === "" ? null : (e.target.value as SizeClass) })}
            className={inputClass}
          >
            <option value="">{t("admin.sizeUnset")}</option>
            {SIZE_CLASSES.map(size => (
              <option key={size} value={size}>{t(`size.${size}` as MessageKey)}</option>
            ))}
          </select>
          {needsVehicle ? (
            <p className="mt-1 text-[11px] ink-muted">
              {t("admin.needsVehicle", { vehicle: t(`vehicle.${needsVehicle}` as MessageKey) })}
            </p>
          ) : null}
        </Labelled>
        <Labelled label={t("admin.offersProductOpen")}>
          <select
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
          </select>
        </Labelled>
      </section>

      {/* The size chart (3.1.20): the sizes start from this product's own. */}
      <SizeChartEditor
        productId={row.id}
        chart={row.sizeChart ?? null}
        variantOptions={row.variants.map(variant => variant.options ?? {})}
        mayEdit={mayEdit}
      />

      {/* Images are saved as a whole list, in order, so removing the third
          and adding a fourth are the same operation. Position is the array
          index — reordering is a save, not a separate protocol. */}
      <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        <h2 className="text-sm font-extrabold">{t("admin.images")}</h2>
        <p className="mt-1 text-[11px] font-semibold ink-muted">{t("admin.imagesHint")}</p>

        {images.length === 0 ? (
          <p className="mt-4 text-[13px] text-[#536b8c]">{t("admin.noImages")}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {images.map((image, index) => (
              <div key={index} className="flex items-start gap-3 rounded-xl border border-[#e6e9ef] p-3">
                {/* A live preview is the only way to tell a good URL from a
                    typo before the product is on the shelf. */}
                <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-[#eef1f6]">
                  {/* A video previews from its poster: loading the clip to
                      draw a 64px square would cost the vendor a download per
                      row for a thumbnail. */}
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
                  <input
                    dir="auto"
                    value={image.altText}
                    disabled={!mayEdit}
                    placeholder={t("admin.imageAlt")}
                    aria-label={t("admin.imageAlt")}
                    onChange={e => setImages(images.map((entry, i) => i === index ? { ...entry, altText: e.target.value } : entry))}
                    className={inputClass}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-[11px] font-extrabold ink-muted" htmlFor={`media-kind-${index}`}>{t("admin.mediaKind")}</label>
                    <select
                      id={`media-kind-${index}`}
                      value={image.kind}
                      disabled={!mayEdit}
                      onChange={e => setImages(images.map((entry, i) => i === index ? { ...entry, kind: e.target.value as "image" | "video" } : entry))}
                      className="type-body h-9 rounded-lg border border-[#d5dfeb] bg-white px-2 text-[12px] font-semibold text-[#0a285a] outline-none focus:border-[#f2683a]"
                    >
                      <option value="image">{t("admin.mediaImage")}</option>
                      <option value="video">{t("admin.mediaVideo")}</option>
                    </select>
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
                      <p id={`poster-hint-${index}`} className="text-[11px] ink-muted">{t("admin.mediaPosterHint")}</p>
                    </>
                  ) : null}
                </div>
                {mayEdit ? (
                  <button
                    onClick={() => setImages(images.filter((_, i) => i !== index))}
                    aria-label={t("admin.removeImage")}
                    className="tap-target ink-muted hover:text-[#a44a2b]"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {mayEdit ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => setImages([...images, { url: "", altText: "", kind: "image" as const, posterUrl: "" }])}
              className="glass pressable inline-flex items-center gap-2 rounded-full border border-[#0a285a]/15 px-4 py-2 text-xs font-extrabold"
            >
              <Plus className="size-4" />{t("admin.addImage")}
            </button>
            <button
              onClick={() => saveImages.mutate({
                id: row.id,
                // A row left blank is an abandoned edit, not an image.
                images: images
                  .filter(image => image.url.trim())
                  .map(image => ({ url: image.url.trim(), altText: image.altText.trim() || null })),
              })}
              disabled={saveImages.isPending}
              className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
            >
              {saveImages.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t(saveImages.isPending ? "admin.saving" : "admin.save")}
            </button>
          </div>
        ) : null}
      </section>

      {/* Optional extras (3.1.2). Beneath the images and above the variants,
          because they are a fact about the product rather than about one size
          of it — a fitting is the same visit whichever colour was picked. */}
      <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        <h2 className="text-sm font-extrabold">{t("admin.addons")}</h2>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 font-semibold ink-muted">{t("admin.addonsNote")}</p>

        {addons.length === 0 ? (
          <p className="mt-4 text-[13px] text-[#536b8c]">{t("admin.addonsEmpty")}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {addons.map((addon, index) => (
              <div key={index} className="flex items-start gap-3 rounded-xl border border-[#e6e9ef] p-3">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[1fr_140px_120px]">
                  <input
                    dir="auto"
                    value={addon.label}
                    disabled={!mayEdit}
                    placeholder={t("admin.addonLabel")}
                    aria-label={t("admin.addonLabel")}
                    onChange={e => setAddons(addons.map((entry, i) => i === index ? { ...entry, label: e.target.value } : entry))}
                    className={inputClass}
                  />
                  <select
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
                  </select>
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
                    onClick={() => setAddons(addons.filter((_, i) => i !== index))}
                    aria-label={t("admin.addonRemove")}
                    className="tap-target ink-muted hover:text-[#a44a2b]"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {mayEdit ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => setAddons([...addons, { kind: "installation" as AddonKind, label: "", labelAr: "", price: "" }])}
              className="glass pressable inline-flex items-center gap-2 rounded-full border border-[#0a285a]/15 px-4 py-2 text-xs font-extrabold"
            >
              <Plus className="size-4" />{t("admin.addonAdd")}
            </button>
            <button
              onClick={() => saveAddons.mutate({
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
              })}
              disabled={saveAddons.isPending}
              className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
            >
              {saveAddons.isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t(saveAddons.isPending ? "admin.saving" : "admin.save")}
            </button>
          </div>
        ) : null}
      </section>

      <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
        <h2 className="text-sm font-extrabold">{t("admin.variants")}</h2>
        <div className="mt-4 space-y-4">
          {row.variants.map(variant => (
            <VariantRow
              key={variant.id}
              variant={variant}
              mayEdit={mayEdit}
              mayStock={mayStock}
              onSave={values => saveVariant.mutate({ id: variant.id, productId: row.id, ...values })}
              onAdjust={(delta, reason) => adjust.mutate({ variantId: variant.id, delta, reason })}
              pending={saveVariant.isPending || adjust.isPending}
            />
          ))}
        </div>
        {mayEdit ? (
          <button
            onClick={() => saveVariant.mutate({ productId: row.id, title: t("admin.addVariant"), price: "0.000" })}
            className="glass pressable mt-4 inline-flex items-center gap-2 rounded-full border border-[#0a285a]/15 px-4 py-2 text-xs font-extrabold"
          >
            <Plus className="size-4" />{t("admin.addVariant")}
          </button>
        ) : null}
      </section>

      {mayPrice ? (
        <CommissionPanel
          percent={row.commissionPercent}
          fixed={row.commissionFixed}
          pending={setCommission.isPending}
          onSave={rule => setCommission.mutate({ id: row.id, ...rule })}
        />
      ) : null}
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
    <section className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white p-5">
      <h2 className="text-sm font-extrabold">{t("admin.productCommission")}</h2>
      <p className="mt-1 text-[11px] text-[#536b8c]">{t("admin.productCommissionNote")}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {/* The ceiling is on the label, because the API refuses above it and a
            form that does not say so leaves an admin typing 500 and reading
            "Could not save". */}
        <Labelled label={t("admin.commissionPercent")} hint={t("admin.commissionPercentHint")} className="w-32">
          <input
            dir="ltr"
            inputMode="decimal"
            value={draft.percent}
            onChange={event => setDraft({ ...draft, percent: event.target.value })}
            className={inputClass}
          />
        </Labelled>
        <Labelled label={t("admin.commissionFixed")} className="w-32">
          <input
            dir="ltr"
            inputMode="decimal"
            value={draft.fixed}
            onChange={event => setDraft({ ...draft, fixed: event.target.value })}
            className={inputClass}
          />
        </Labelled>
        <button
          onClick={() => onSave({ percent: trimmed.percent || null, fixed: trimmed.fixed || null })}
          disabled={pending}
          className="glass glass-navy pressable inline-flex h-10 items-center gap-2 rounded-full px-4 text-xs font-extrabold disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("admin.save")}
        </button>
      </div>
    </section>
  );
}

function Labelled({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] font-extrabold text-[#0a285a]">{label}</span>
      {hint ? <span className="ms-2 text-[10px] font-semibold ink-muted">{hint}</span> : null}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

function VariantRow({ variant, mayEdit, mayStock, onSave, onAdjust, pending }: {
  variant: { id: number; title: string; sku: string | null; price: string; compareAtPrice: string | null; stock: number; unit?: string | null; stepAmount?: string | number | null; preorderStock?: number | null; preorderReleaseAt?: string | Date | null };
  mayEdit: boolean;
  mayStock: boolean;
  onSave: (values: { title: string; sku: string | null; price: string; compareAtPrice: string | null; unit: SellUnit; stepAmount: number; preorderStock: number; preorderReleaseAt: Date | null }) => void;
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
  const preorderOk = Number.isInteger(preorderAllowance) && preorderAllowance >= 0;
  const perUnit = measureOk ? unitPrice(values.price || "0", measure) : null;
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("received");

  return (
    <div className="rounded-xl border border-[#e6e9ef] bg-[#fbfcfe] p-4">
      <div className="grid gap-3 sm:grid-cols-4">
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
      </div>

      {/*
        The grocery shelf. Left alone, a variant is `each` × 1 and behaves as
        every product in the shop does today — so this row costs a vendor who
        sells kettles nothing but two defaults they never touch.
      */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Labelled label={t("admin.variantUnit")} hint={t("admin.variantUnitHint")}>
          <select
            value={values.unit}
            disabled={!mayEdit}
            onChange={e => setValues({ ...values, unit: e.target.value as SellUnit, stepAmount: e.target.value === "each" ? "1" : values.stepAmount })}
            className={inputClass}
          >
            {SELL_UNITS.map(unit => <option key={unit} value={unit}>{t(`unit.${unit}` as MessageKey)}</option>)}
          </select>
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
          <p className="px-1 py-2 text-sm font-extrabold text-[#0a285a]">
            {perUnit
              ? t("unit.perUnit", { price: perUnit.amount, unit: t(`unit.${perUnit.unit}` as MessageKey) })
              : "—"}
          </p>
        </Labelled>
      </div>
      {!measureOk ? <p className="mt-1 text-[12px] font-semibold text-[#8c2f22]">{t("admin.variantStepInvalid")}</p> : null}

      {/* Pre-order: a second, bounded pool the vendor chooses the size of.
          Beside the stock figure rather than in a panel of its own, because the
          question it answers — how many may I sell — is the same question. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
          <p id={`preorder-hint-${variant.id}`} className="mt-1 text-[11px] ink-muted">{t("admin.preorderStockHint")}</p>
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
          <p id={`release-hint-${variant.id}`} className="mt-1 text-[11px] ink-muted">{t("admin.preorderReleaseHint")}</p>
        </Labelled>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <p className="text-[12px] font-semibold text-[#536b8c]">
          {t("admin.variantStock")}: <strong className={variant.stock === 0 ? "text-[#e61c38]" : "text-[#0a285a]"}>{variant.stock}</strong>
        </p>
        {mayEdit ? (
          <button
            onClick={() => onSave({
              title: values.title, sku: values.sku || null, price: values.price,
              compareAtPrice: values.compareAtPrice || null,
              unit: measure.unit, stepAmount: measure.stepAmount,
              preorderStock: preorderAllowance,
              preorderReleaseAt: values.preorderReleaseAt ? new Date(values.preorderReleaseAt) : null,
            })}
            disabled={pending || !measureOk || !preorderOk}
            className="glass pressable rounded-full border border-[#0a285a]/15 px-4 py-2 text-[11px] font-extrabold disabled:opacity-60"
          >
            {t("admin.save")}
          </button>
        ) : null}
      </div>

      {/* Staff reach this and nothing else on the row, which is the whole point
          of the rank: count the boxes without touching the price. */}
      {mayStock ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[#e6e9ef] pt-3">
          <Labelled label={t("admin.adjustBy")}>
            <div className="inline-flex items-center gap-1">
              <button onClick={() => setDelta(d => d - 1)} aria-label={t("product.decreaseQuantity")} className="glass pressable grid size-9 place-items-center rounded-lg"><Minus className="size-3.5" /></button>
              <input dir="ltr" inputMode="numeric" value={delta} onChange={e => setDelta(Number(e.target.value) || 0)} className={`${inputClass} w-20 text-center`} />
              <button onClick={() => setDelta(d => d + 1)} aria-label={t("product.increaseQuantity")} className="glass pressable grid size-9 place-items-center rounded-lg"><Plus className="size-3.5" /></button>
            </div>
          </Labelled>
          <Labelled label={t("admin.reason")}>
            <select value={reason} onChange={e => setReason(e.target.value as (typeof REASONS)[number])} className={inputClass}>
              {REASONS.map(entry => <option key={entry} value={entry}>{t(`reason.${entry}` as MessageKey)}</option>)}
            </select>
          </Labelled>
          <button
            onClick={() => onAdjust(delta, reason)}
            disabled={pending || delta === 0}
            className="glass glass-navy pressable h-10 rounded-full px-4 text-[11px] font-extrabold disabled:opacity-60"
          >
            {t("admin.adjustStock")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
