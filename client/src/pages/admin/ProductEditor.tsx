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
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { StatusPill } from "@/components/admin/StatusPill";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/lib/useTranslation";
import { usePageMeta } from "@/lib/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { can, type Actor } from "@shared/inventory/permissions";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { ArrowLeft, LoaderCircle, Minus, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { toast } from "sonner";

const REASONS = ["received", "sold", "damaged", "correction", "returned"] as const;

export default function AdminProductEditor() {
  usePageMeta(privatePageMeta("Product"));
  const [, params] = useRoute("/admin/products/:id");
  const id = Number(params?.id ?? 0);
  return <AdminShell>{actor => <Editor actor={actor} productId={id} />}</AdminShell>;
}

const field = "type-body h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

function Editor({ actor, productId }: { actor: Actor; productId: number }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const product = trpc.inventory.products.get.useQuery({ id: productId }, { enabled: productId > 0 });
  const categories = trpc.inventory.categories.useQuery();

  const [draft, setDraft] = useState({ title: "", titleAr: "", description: "", categoryId: "", tags: "" });
  const [images, setImages] = useState<{ url: string; altText: string }[]>([]);
  useEffect(() => {
    if (!product.data) return;
    setDraft({
      title: product.data.title,
      titleAr: product.data.titleAr ?? "",
      description: product.data.description ?? "",
      categoryId: product.data.categoryId ? String(product.data.categoryId) : "",
      tags: product.data.tags.join(", "),
    });
    setImages(product.data.images.map(image => ({ url: image.url, altText: image.altText ?? "" })));
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
            <input dir="auto" value={draft.title} disabled={!mayEdit} onChange={e => setDraft({ ...draft, title: e.target.value })} className={field} />
          </Labelled>
          <Labelled label={t("admin.fieldTitleAr")}>
            <input dir="rtl" value={draft.titleAr} disabled={!mayEdit} onChange={e => setDraft({ ...draft, titleAr: e.target.value })} className={field} />
          </Labelled>
          <Labelled label={t("admin.fieldCategory")} className="sm:col-span-2">
            <select value={draft.categoryId} disabled={!mayEdit} onChange={e => setDraft({ ...draft, categoryId: e.target.value })} className={field}>
              <option value="">{t("admin.fieldNoCategory")}</option>
              {(categories.data ?? []).map(category => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </Labelled>
          <Labelled label={t("admin.fieldDescription")} className="sm:col-span-2">
            <textarea dir="auto" value={draft.description} disabled={!mayEdit} onChange={e => setDraft({ ...draft, description: e.target.value })} className={`${field} h-28 py-2`} />
          </Labelled>
          <Labelled label={t("admin.fieldTags")} hint={t("admin.tagsHint")} className="sm:col-span-2">
            <input value={draft.tags} disabled={!mayEdit} onChange={e => setDraft({ ...draft, tags: e.target.value })} className={field} />
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
                  {image.url ? <img src={image.url} alt="" loading="lazy" decoding="async" className="size-full object-cover" /> : null}
                </div>
                <div className="grid min-w-0 flex-1 gap-2">
                  <input
                    dir="ltr"
                    value={image.url}
                    disabled={!mayEdit}
                    placeholder={t("admin.imageUrl")}
                    aria-label={t("admin.imageUrl")}
                    onChange={e => setImages(images.map((entry, i) => i === index ? { ...entry, url: e.target.value } : entry))}
                    className={field}
                  />
                  <input
                    dir="auto"
                    value={image.altText}
                    disabled={!mayEdit}
                    placeholder={t("admin.imageAlt")}
                    aria-label={t("admin.imageAlt")}
                    onChange={e => setImages(images.map((entry, i) => i === index ? { ...entry, altText: e.target.value } : entry))}
                    className={field}
                  />
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
              onClick={() => setImages([...images, { url: "", altText: "" }])}
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
        <Labelled label={t("admin.commissionPercent")} className="w-32">
          <input
            dir="ltr"
            inputMode="decimal"
            value={draft.percent}
            onChange={event => setDraft({ ...draft, percent: event.target.value })}
            className={field}
          />
        </Labelled>
        <Labelled label={t("admin.commissionFixed")} className="w-32">
          <input
            dir="ltr"
            inputMode="decimal"
            value={draft.fixed}
            onChange={event => setDraft({ ...draft, fixed: event.target.value })}
            className={field}
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
  variant: { id: number; title: string; sku: string | null; price: string; compareAtPrice: string | null; stock: number };
  mayEdit: boolean;
  mayStock: boolean;
  onSave: (values: { title: string; sku: string | null; price: string; compareAtPrice: string | null }) => void;
  onAdjust: (delta: number, reason: (typeof REASONS)[number]) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState({
    title: variant.title,
    sku: variant.sku ?? "",
    price: variant.price,
    compareAtPrice: variant.compareAtPrice ?? "",
  });
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState<(typeof REASONS)[number]>("received");

  return (
    <div className="rounded-xl border border-[#e6e9ef] bg-[#fbfcfe] p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Labelled label={t("admin.variantTitle")}>
          <input dir="auto" value={values.title} disabled={!mayEdit} onChange={e => setValues({ ...values, title: e.target.value })} className={field} />
        </Labelled>
        <Labelled label={t("admin.variantSku")}>
          <input dir="ltr" value={values.sku} disabled={!mayEdit} onChange={e => setValues({ ...values, sku: e.target.value })} className={field} />
        </Labelled>
        <Labelled label={t("admin.variantPrice")} hint={t("admin.priceHint")}>
          <input dir="ltr" inputMode="decimal" value={values.price} disabled={!mayEdit} onChange={e => setValues({ ...values, price: e.target.value })} className={field} />
        </Labelled>
        <Labelled label={t("admin.variantCompareAt")}>
          <input dir="ltr" inputMode="decimal" value={values.compareAtPrice} disabled={!mayEdit} onChange={e => setValues({ ...values, compareAtPrice: e.target.value })} className={field} />
        </Labelled>
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <p className="text-[12px] font-semibold text-[#536b8c]">
          {t("admin.variantStock")}: <strong className={variant.stock === 0 ? "text-[#e61c38]" : "text-[#0a285a]"}>{variant.stock}</strong>
        </p>
        {mayEdit ? (
          <button
            onClick={() => onSave({ title: values.title, sku: values.sku || null, price: values.price, compareAtPrice: values.compareAtPrice || null })}
            disabled={pending}
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
              <input dir="ltr" inputMode="numeric" value={delta} onChange={e => setDelta(Number(e.target.value) || 0)} className={`${field} w-20 text-center`} />
              <button onClick={() => setDelta(d => d + 1)} aria-label={t("product.increaseQuantity")} className="glass pressable grid size-9 place-items-center rounded-lg"><Plus className="size-3.5" /></button>
            </div>
          </Labelled>
          <Labelled label={t("admin.reason")}>
            <select value={reason} onChange={e => setReason(e.target.value as (typeof REASONS)[number])} className={field}>
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
