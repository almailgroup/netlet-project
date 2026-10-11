/**
 * Making a set.
 *
 * Requirement 3.3.11. Two rules decide everything on this page, and both are
 * about money rather than layout.
 *
 * **A seller may bundle their own goods; a set spanning two shops is NetLet's
 * own.** A seller who could put another shop's product into a discounted set
 * would be spending money that is not theirs, so the server refuses it and
 * this page only offers the choice to somebody who may make it.
 *
 * **A bundle price is an advertised saving**, so the Ministry permit rule that
 * governs a struck-through price governs this too. It is checked on the read,
 * which means a seller whose permit has lapsed sees their bundle vanish from
 * the shop without anybody editing it — said here so that is not a mystery.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Card, EmptyState, Field, fieldClass, isolate, PageHeader, Pill, SectionHeading, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
import { Thumb } from "@/components/product/Thumb";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import { can, type Actor } from "@shared/inventory/permissions";
import { addMoney, compareMoney, multiplyMoney, subtractMoney } from "@shared/money";
import { privatePageMeta } from "@shared/seo";
import { ImageOff, LoaderCircle, Plus, Search, Trash2 } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

/** One chosen item: enough to draw it and to price the set before saving. */
type Member = { variantId: number; title: string; option: string | null; price: string; image: string | null; quantity: number };

const AMOUNT = /^\d{1,9}(\.\d{1,3})?$/;

export default function AdminBundles() {
  usePageMeta(privatePageMeta("Bundles"));
  return <AdminShell need="product.view">{actor => <Bundles actor={actor} />}</AdminShell>;
}

function Bundles({ actor }: { actor: Actor }) {
  const { t, tError } = useTranslation();
  const money = useMoney();
  const list = trpc.inventory.bundles.list.useQuery();
  const utils = trpc.useUtils();

  const mayCrossVendor = can(actor, "platform.viewAll");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [members, setMembers] = useState<Member[]>([]);

  const refresh = () => void utils.inventory.bundles.list.invalidate();
  const save = trpc.inventory.bundles.save.useMutation({
    onSuccess: () => {
      toast.success(t("admin.bundleSaved"));
      setName(""); setPrice(""); setMembers([]);
      refresh();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const setActive = trpc.inventory.bundles.setActive.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(tError(error.message)),
  });

  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  /* What the set comes to bought piece by piece, in fils — the figure the
     server refuses a bundle price against, shown before Save rather than
     after it. */
  const separately = members.length ? addMoney(...members.map(member => multiplyMoney(member.price, member.quantity))) : "0";
  const priced = AMOUNT.test(price.trim());
  const saving = priced && members.length >= 2 ? subtractMoney(separately, price.trim()) : null;
  const noSaving = saving !== null && compareMoney(saving, "0") <= 0;

  /* Picking the same option twice adds one more of it: the server reads a
     repeated variant as an unknown item, which is the wrong thing to be told. */
  const add = (member: Omit<Member, "quantity">) =>
    setMembers(current => current.some(entry => entry.variantId === member.variantId)
      ? current.map(entry => entry.variantId === member.variantId ? { ...entry, quantity: Math.min(99, entry.quantity + 1) } : entry)
      : [...current, { ...member, quantity: 1 }]);

  return (
    <>
      <PageHeader title={t("admin.bundles")} description={t("admin.bundlesNote")} />

      <Card
        title={t("admin.bundleNew")}
        footer={
          <button
            type="button"
            disabled={save.isPending || !name.trim() || !priced || members.length < 2 || noSaving}
            onClick={() => save.mutate({
              name: name.trim(),
              /* A seller's own bundle carries their vendor; an admin's carries
                 null, which is what lets it span two shops. */
              vendorId: mayCrossVendor ? null : actor.kind === "vendor" ? actor.vendorId : null,
              bundlePrice: price.trim(),
              members: members.map(member => ({ variantId: member.variantId, quantity: member.quantity })),
            })}
            className={buttonClass.primary}
          >
            {save.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t("admin.bundleSave")}
          </button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("admin.bundleName")}>
            <input dir="auto" value={name} maxLength={200} onChange={event => setName(event.target.value)} className={fieldClass} />
          </Field>
          <Field
            label={t("admin.bundlePrice")}
            error={noSaving ? t("bundle.noSaving") : undefined}
            hint={members.length ? t("admin.bundleTotalSeparately", { amount: amount(separately) }) + (saving && !noSaving ? ` · ${t("admin.bundleSavingLine", { amount: amount(saving) })}` : "") : undefined}
          >
            <input dir="ltr" inputMode="decimal" placeholder="0.000" value={price} onChange={event => setPrice(event.target.value.replace(/[^\d.]/g, ""))} className={fieldClass} />
          </Field>
        </div>

        <h3 className="mt-6 text-[14px] font-bold text-[#0a285a]">{t("admin.bundleMembers")}</h3>
        {members.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-[#cfd9e6] bg-[#fafbfd] px-4 py-5 text-center text-[13px] ink-muted">{t("admin.bundleNoItems")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
            {members.map(member => {
              const label = member.option ? `${member.title} — ${member.option}` : member.title;
              return (
                <li key={member.variantId} className="flex items-center gap-3 p-3">
                  <div className="size-11 shrink-0 overflow-hidden rounded-lg bg-[#f4f6f9]">
                    <Thumb src={member.image ?? undefined} alt="" className="size-full object-cover" icon={<ImageOff className="size-4 text-[#536b8c]" />} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-[14px] font-semibold text-[#0a285a]">{member.title}</p>
                    <p className="text-[12px] ink-muted">
                      {member.option ? <><bdi>{member.option}</bdi> · </> : null}{amount(member.price)}
                    </p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    dir="ltr"
                    value={member.quantity}
                    aria-label={t("admin.bundleQuantity", { name: isolate(label) })}
                    onChange={event => {
                      const quantity = Math.max(1, Math.min(99, Number.parseInt(event.target.value, 10) || 1));
                      setMembers(current => current.map(entry => entry.variantId === member.variantId ? { ...entry, quantity } : entry));
                    }}
                    className={`${fieldClass} h-9 w-16 px-2 text-center`}
                  />
                  <button
                    type="button"
                    onClick={() => setMembers(current => current.filter(entry => entry.variantId !== member.variantId))}
                    aria-label={t("admin.bundleRemoveItem", { name: isolate(label) })}
                    className={`${smallButtonClass.quietDanger} w-9 px-0`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <ProductFinder chosen={members.map(member => member.variantId)} onPick={add} />
      </Card>

      <section className="mt-8" aria-labelledby="bundle-list">
        <SectionHeading><span id="bundle-list">{t("admin.bundleListTitle")}</span></SectionHeading>
        {list.isLoading ? (
          <SkeletonRows rows={3} label={t("admin.loading")} />
        ) : (
          <QueryGate queries={[list]}>
            {() => {
              const rows = list.data ?? [];
              if (rows.length === 0) return <EmptyState title={t("admin.bundlesEmpty")} />;
              return (
                <ul className="space-y-3">
                  {rows.map(bundle => (
                    <li key={bundle.id} className="rounded-2xl border border-[#e1e7ef] bg-white p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <p dir="auto" className="text-[15px] font-bold text-[#0a285a]">{bundle.name}</p>
                          <p className="mt-0.5 text-[13px]">
                            <span className="font-bold text-[#0a285a]">{amount(bundle.bundlePrice)}</span>
                            <span className="ink-muted"> · {t("admin.bundleSeparately", { amount: amount(bundle.separately) })}</span>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {bundle.crossVendor ? <Pill tone="navy">{t("admin.bundleCrossVendor", { count: new Set(bundle.members.map(m => m.vendorId)).size })}</Pill> : null}
                          <Pill tone={bundle.active ? "good" : "neutral"}>{t(bundle.active ? "admin.bundleActive" : "admin.bundleInactive")}</Pill>
                        </div>
                      </div>
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {bundle.members.map((member, index) => (
                          <li key={index} dir="auto" className="rounded-lg bg-[#f2f5f9] px-2.5 py-1 text-[13px] text-[#3d5376]">{member.productTitle}</li>
                        ))}
                      </ul>
                      <div className="mt-4 border-t border-[#eef1f5] pt-3">
                        <button
                          type="button"
                          disabled={setActive.isPending}
                          onClick={() => setActive.mutate({ id: bundle.id, active: !bundle.active })}
                          className={bundle.active ? smallButtonClass.quietDanger : smallButtonClass.secondary}
                        >
                          {t(bundle.active ? "admin.bundleTakeOff" : "admin.bundlePutOn")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              );
            }}
          </QueryGate>
        )}
      </section>
    </>
  );
}

/**
 * Search the shelf this person may bundle from, and choose the exact option.
 *
 * It used to be a box for a variant id under a label promising "product code"
 * — and a code typed there was `NaN` by the time it reached the server. The
 * search is the products list's own, so a seller finds only their own shelf
 * and an administrator every store's, by name, Arabic name or code.
 */
function ProductFinder({ chosen, onPick }: { chosen: number[]; onPick: (member: Omit<Member, "quantity">) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const [term, setTerm] = useState("");
  const query = useDeferredValue(term.trim());
  const results = trpc.inventory.products.list.useQuery({ query, pageSize: 6 }, { enabled: query.length >= 2, placeholderData: previous => previous });
  const rows = query.length >= 2 ? results.data?.rows ?? [] : [];

  return (
    <div className="mt-5">
      {/* Not `Field`: that names its one child, and the child here is the box
          holding the icon rather than the input. */}
      <label htmlFor="bundle-find" className="block text-[13px] leading-5 font-semibold text-[#0a285a]">{t("admin.bundleSearch")}</label>
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[#536b8c]" aria-hidden />
        <input id="bundle-find" type="search" dir="auto" aria-describedby="bundle-find-hint" value={term} onChange={event => setTerm(event.target.value)} className={`${fieldClass} ps-10`} />
      </div>
      <p id="bundle-find-hint" className="mt-1.5 text-[12px] leading-5 ink-muted">{t("admin.bundleSearchHint")}</p>
      {query.length >= 2 ? (
        results.isLoading ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] ink-muted"><LoaderCircle className="size-4 animate-spin" aria-hidden />{t("admin.loading")}</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-[13px] ink-muted">{t("admin.bundleNoResults")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
            {rows.map(product => (
              <li key={product.id} className="p-3">
                <div className="flex items-center gap-3">
                  <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-[#f4f6f9]">
                    <Thumb src={product.images.find(image => image.kind !== "video")?.url} alt="" className="size-full object-cover" icon={<ImageOff className="size-4 text-[#536b8c]" />} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-[14px] font-semibold text-[#0a285a]">{product.title}</p>
                    {product.vendorName ? <p dir="auto" className="truncate text-[12px] ink-muted">{product.vendorName}</p> : null}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 ps-[52px]">
                  {product.variants.map(variant => {
                    const option = isDefaultVariantTitle(variant.title) ? null : variant.title;
                    const inSet = chosen.includes(variant.id);
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => onPick({
                          variantId: variant.id,
                          title: product.title,
                          option,
                          price: variant.price,
                          image: product.images.find(image => image.kind !== "video")?.url ?? null,
                        })}
                        className={`${smallButtonClass.secondary} ${inSet ? "border-[#0a285a]" : ""}`}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        {/* Named for a screen reader by what it adds, and still
                            containing the words a sighted user reads on it. */}
                        <span className="sr-only">{t("admin.bundleAddThis", { name: isolate(product.title) })}</span>
                        {option ? <bdi>{option}</bdi> : null}
                        <span className="font-normal ink-muted">{money({ amount: variant.price, currencyCode: "KWD" })}</span>
                        {inSet ? <span className="sr-only">({t("admin.bundleInSet")})</span> : null}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
