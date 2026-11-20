/**
 * Making a set.
 *
 * Requirement 3.3.11. Two rules decide everything on this page, and both are
 * about money rather than layout.
 *
 * **A seller may bundle their own goods, and another store's by arrangement.**
 * A seller may put another shop's product into a set beside one of its own;
 * that shop is asked and answers under "Asked of your store", and the set is
 * on sale only once every store in it has agreed, because a set that gave up
 * somebody else's margin without asking would be spending money that is not
 * the seller's. NetLet's own sets span shops as before.
 *
 * **A bundle price is an advertised saving**, so the Ministry permit rule that
 * governs a struck-through price governs this too. It is checked on the read,
 * which means a seller whose permit has lapsed sees their bundle vanish from
 * the shop without anybody editing it — said here so that is not a mystery.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Card, EmptyState, Field, fieldClass, isolate, Notice, PageHeader, Pill, Segmented, SectionHeading, SkeletonRows, smallButtonClass, textareaClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BUNDLE_NOTE_MAX, bundleAnswerProblem } from "@shared/commerce/bundles";
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
import { useConfirmRemoval } from "@/components/ui/ConfirmRemoval";

/** One chosen item: enough to draw it and to price the set before saving. */
type Member = {
  variantId: number;
  title: string;
  option: string | null;
  price: string;
  image: string | null;
  quantity: number;
  /** Picked from the shop's other stores, whose answer the set will wait for. */
  fromShop?: boolean;
  vendorName?: string | null;
};

const AMOUNT = /^\d{1,9}(\.\d{1,3})?$/;

export default function AdminBundles() {
  usePageMeta(privatePageMeta("Bundles"));
  return <AdminShell need="product.view">{actor => <Bundles actor={actor} />}</AdminShell>;
}

function Bundles({ actor }: { actor: Actor }) {
  const { t, tError, locale } = useTranslation();
  const ask = useConfirmRemoval();
  const money = useMoney();
  const list = trpc.inventory.bundles.list.useQuery();
  const utils = trpc.useUtils();

  /* What this person may change, by the capability each save asks: a
     store's own bundles are `product.edit` for that store, NetLet's are
     `bundles.netlet`. A team role that only reads the catalogue reads. */
  const mayChange = (vendorId: number | null) => vendorId === null ? can(actor, "bundles.netlet") : can(actor, "product.edit", vendorId);
  const mayMake = mayChange(actor.kind === "vendor" ? actor.vendorId : null);
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

      {mayMake ? <Card
        title={t("admin.bundleNew")}
        footer={
          <button
            type="button"
            disabled={save.isPending || !name.trim() || !priced || members.length < 2 || noSaving}
            onClick={() => save.mutate({
              name: name.trim(),
              /* A seller's own bundle carries their vendor; an admin's carries
                 null, which is what lets it span two shops. */
              vendorId: actor.kind === "vendor" ? actor.vendorId : null,
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
                <li key={member.variantId} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="size-11 shrink-0 overflow-hidden rounded-lg bg-[#f4f6f9]">
                    <Thumb src={member.image ?? undefined} alt="" className="size-full object-cover" icon={<ImageOff className="size-4 text-[#536b8c]" />} />
                  </div>
                  {/* A basis, so on the narrowest phone the quantity and the bin
                      drop to a line of their own rather than squeezing this. */}
                  <div className="min-w-0 flex-1 basis-32">
                    <p dir="auto" className="truncate text-[14px] font-semibold text-[#0a285a]">{member.title}</p>
                    <p className="text-[12px] whitespace-nowrap ink-muted">
                      {member.option ? <><bdi>{member.option}</bdi> · </> : null}{amount(member.price)}
                    </p>
                  </div>
                  <div className="ms-auto flex shrink-0 items-center gap-3">
                  {/* The box's own width is the field's full width, so it is held
                      in a narrow box of its own: on a phone it took the row and
                      left the name and price a column one letter wide. */}
                  <div className="w-16 shrink-0">
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
                      className={`${fieldClass} h-9 px-2 text-center`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void ask({ title: t("remove.formTitle"), body: t("remove.formBody") }).then(sure => { if (sure) setMembers(current => current.filter(entry => entry.variantId !== member.variantId)); })}
                    aria-label={t("admin.bundleRemoveItem", { name: isolate(label) })}
                    className={`${smallButtonClass.quietDanger} w-9 px-0`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {members.some(member => member.fromShop) ? (
          <Notice className="mt-3">{t("admin.bundleAskedNote", { stores: [...new Set(members.filter(member => member.fromShop).map(member => member.vendorName).filter(Boolean))].join(", ") })}</Notice>
        ) : null}

        <ProductFinder chosen={members.map(member => member.variantId)} onPick={add} otherStores={actor.kind === "vendor"} />
      </Card> : null}

      {actor.kind === "vendor" ? <AskedOfYou actor={actor} /> : null}

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
                    <li key={bundle.id} className="rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)] p-4 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                        <div className="min-w-0">
                          <p dir="auto" className="text-[15px] font-bold text-[#0a285a]">{inLanguage(locale, bundle.name, bundle.nameAr)}</p>
                          <p className="mt-0.5 text-[13px]">
                            <span className="font-bold text-[#0a285a]">{amount(bundle.bundlePrice)}</span>
                            <span className="ink-muted"> · {t("admin.bundleSeparately", { amount: amount(bundle.separately) })}</span>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {bundle.crossVendor ? <Pill tone="navy">{t("admin.bundleCrossVendor", { count: new Set(bundle.members.map(m => m.vendorId)).size })}</Pill> : null}
                          {/* A set the other stores have not all agreed to is not on sale, whatever its own switch says. */}
                          {bundle.active && !bundle.agreement.agreed
                            ? <Pill tone="warning">{t("admin.bundleAwaitingPill")}</Pill>
                            : <Pill tone={bundle.active ? "good" : "neutral"}>{t(bundle.active ? "admin.bundleActive" : "admin.bundleInactive")}</Pill>}
                        </div>
                      </div>
                      <AgreementLines bundle={bundle} />
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {bundle.members.map((member, index) => (
                          <li key={index} dir="auto" className="rounded-lg bg-[#f2f5f9] px-2.5 py-1 text-[13px] text-[#3d5376]">{inLanguage(locale, member.productTitle, member.productTitleAr)}</li>
                        ))}
                      </ul>
                      {mayChange(bundle.vendorId) ? <div className="mt-4 border-t border-[#eef1f5] pt-3">
                        <button
                          type="button"
                          disabled={setActive.isPending}
                          onClick={() => setActive.mutate({ id: bundle.id, active: !bundle.active })}
                          className={bundle.active ? smallButtonClass.quietDanger : smallButtonClass.secondary}
                        >
                          {t(bundle.active ? "admin.bundleTakeOff" : "admin.bundlePutOn")}
                        </button>
                      </div> : null}
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

/** Where a set made by arrangement stands: each store asked, and its answer. */
/** A name in the page's language where it has one: a set's, an item's, a store's. */
function inLanguage(locale: string, english: string | null, arabic: string | null | undefined): string {
  return (locale === "ar" && arabic ? arabic : english) ?? "";
}

function AgreementLines({ bundle }: { bundle: { ownerName: string | null; agreement: { asked: { vendorId: number; vendorName: string | null; vendorNameAr: string | null; state: "waiting" | "agreed" | "declined"; note: string | null }[]; agreed: boolean } } }) {
  const { t, locale } = useTranslation();
  if (bundle.agreement.asked.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[13px] font-semibold text-[#0a285a]">
        {t(bundle.agreement.agreed ? "admin.bundleAllAgreed" : "admin.bundleNotYetAgreed")}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {bundle.agreement.asked.map(entry => (
          <li key={entry.vendorId}>
            <Pill tone={entry.state === "agreed" ? "good" : entry.state === "declined" ? "danger" : "warning"}>
              {t(entry.state === "agreed" ? "admin.bundleStoreAgreed" : entry.state === "declined" ? "admin.bundleStoreDeclined" : "admin.bundleStoreWaiting", { store: isolate(inLanguage(locale, entry.vendorName, entry.vendorNameAr)) })}
            </Pill>
          </li>
        ))}
      </ul>
      {bundle.agreement.asked.filter(entry => entry.state === "declined" && entry.note).map(entry => (
        <p key={entry.vendorId} dir="auto" className="text-[13px] text-[#3d5376]">
          <span className="font-semibold">{t("admin.bundleTheirWords", { store: isolate(inLanguage(locale, entry.vendorName, entry.vendorNameAr)) })}</span> {entry.note}
        </p>
      ))}
    </div>
  );
}

/**
 * The sets other stores made with this store's products, and its answer to
 * each. Agreeing is giving up a share of the store's own price inside that
 * set, so it is a manager's act; declining needs words the other store reads.
 */
function AskedOfYou({ actor }: { actor: Extract<Actor, { kind: "vendor" }> }) {
  const { t, tError, locale } = useTranslation();
  const money = useMoney();
  const asked = trpc.inventory.bundles.asked.useQuery();
  const utils = trpc.useUtils();
  const mayAnswer = can(actor, "product.edit", actor.vendorId);
  const [declining, setDeclining] = useState<{ id: number; name: string } | null>(null);
  const [note, setNote] = useState("");
  const answer = trpc.inventory.bundles.answer.useMutation({
    onSuccess: (_, input) => {
      toast.success(t(input.state === "agreed" ? "admin.bundleYouAgreed" : "admin.bundleYouDeclined"));
      setDeclining(null);
      setNote("");
      void utils.inventory.bundles.asked.invalidate();
      void utils.inventory.bundles.waiting.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const rows = asked.data ?? [];
  if (!asked.isLoading && !asked.isError && rows.length === 0) return null;
  const noteProblem = declining ? bundleAnswerProblem("declined", note) : null;

  return (
    <section className="mt-8" aria-labelledby="bundle-asked">
      <SectionHeading><span id="bundle-asked">{t("admin.bundleAskedTitle")}</span></SectionHeading>
      <p className="-mt-2 mb-3 text-[13px] ink-muted">{t("admin.bundleAskedHint")}</p>
      {asked.isLoading ? <SkeletonRows rows={2} label={t("admin.loading")} /> : (
        <QueryGate queries={[asked]}>
          {() => (
            <ul className="space-y-3">
              {rows.map(bundle => {
                const yours = bundle.members.filter(member => member.vendorId === actor.vendorId);
                return (
                  <li key={bundle.id} className="rounded-2xl border border-[#e3e8f0] bg-white p-4 shadow-[0_1px_2px_rgba(10,40,90,0.05)] sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <div className="min-w-0">
                        <p dir="auto" className="text-[15px] font-bold text-[#0a285a]">{inLanguage(locale, bundle.name, bundle.nameAr)}</p>
                        <p className="mt-0.5 text-[13px] ink-muted">{t("admin.bundleMadeBy", { store: isolate(inLanguage(locale, bundle.ownerName, bundle.ownerNameAr)) })}</p>
                        <p className="mt-0.5 text-[13px]">
                          <span className="font-bold text-[#0a285a]">{money({ amount: bundle.bundlePrice, currencyCode: "KWD" })}</span>
                          <span className="ink-muted"> · {t("admin.bundleSeparately", { amount: money({ amount: bundle.separately, currencyCode: "KWD" }) })}</span>
                        </p>
                      </div>
                      <Pill tone={bundle.myState === "agreed" ? "good" : bundle.myState === "declined" ? "danger" : "warning"}>
                        {t(bundle.myState === "agreed" ? "admin.bundleYouHaveAgreed" : bundle.myState === "declined" ? "admin.bundleYouHaveDeclined" : "admin.bundleWaitingOnYou")}
                      </Pill>
                    </div>
                    <ul className="mt-3 space-y-1 text-[13px]">
                      {yours.map(member => (
                        <li key={member.variantId} className="flex flex-wrap justify-between gap-x-3">
                          <span dir="auto" className="text-[#0a285a]">{member.quantity > 1 ? `${member.quantity} × ` : ""}{inLanguage(locale, member.productTitle, member.productTitleAr)}</span>
                          <span className="ink-muted">
                            {t("admin.bundleYourShare", {
                              price: money({ amount: member.unitPrice, currencyCode: "KWD" }),
                              share: money({ amount: member.bundleUnitPrice, currencyCode: "KWD" }),
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {mayAnswer ? (
                      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#eef1f5] pt-3">
                        {bundle.myState !== "agreed" ? (
                          <button type="button" disabled={answer.isPending} onClick={() => answer.mutate({ bundleId: bundle.id, state: "agreed" })} className={smallButtonClass.primary}>
                            {t("admin.bundleAgree")}
                          </button>
                        ) : null}
                        {bundle.myState !== "declined" ? (
                          <button type="button" disabled={answer.isPending} onClick={() => { setNote(""); setDeclining({ id: bundle.id, name: inLanguage(locale, bundle.name, bundle.nameAr) }); }} className={smallButtonClass.quietDanger}>
                            {t("admin.bundleDecline")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </QueryGate>
      )}
      <ConfirmDialog
        open={declining !== null}
        title={t("admin.bundleDeclineTitle")}
        body={t("admin.bundleDeclineBody", { name: isolate(declining?.name ?? "") })}
        confirmLabel={t("admin.bundleDecline")}
        tone="danger"
        pending={answer.isPending}
        confirmDisabled={noteProblem !== null}
        onConfirm={() => declining && answer.mutate({ bundleId: declining.id, state: "declined", note: note.trim() })}
        onClose={() => setDeclining(null)}
      >
        <Field label={t("admin.bundleDeclineNote")} hint={t("admin.bundleDeclineNoteHint")}>
          <textarea dir="auto" rows={3} maxLength={BUNDLE_NOTE_MAX} value={note} onChange={event => setNote(event.target.value)} className={textareaClass} />
        </Field>
      </ConfirmDialog>
    </section>
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
function ProductFinder({ chosen, onPick, otherStores = false }: { chosen: number[]; onPick: (member: Omit<Member, "quantity">) => void; otherStores?: boolean }) {
  const { t, locale } = useTranslation();
  const [source, setSource] = useState<"mine" | "shop">("mine");
  const [term, setTerm] = useState("");
  const query = useDeferredValue(term.trim());
  const shop = otherStores && source === "shop";
  /* The store's own address, so "Other stores" leaves its own products to
     "Your products": a product of its own is nobody else's to agree to. */
  const store = trpc.inventory.myStore.useQuery(undefined, { enabled: otherStores });
  return (
    <div className="mt-5">
      {otherStores ? (
        <Segmented
          label={t("admin.bundleSource")}
          options={[{ value: "mine", label: t("admin.bundleSourceMine") }, { value: "shop", label: t("admin.bundleSourceShop") }]}
          value={source}
          onChange={setSource}
          className="mb-3"
        />
      ) : null}
      {shop ? <ShopFinder query={query} term={term} setTerm={setTerm} chosen={chosen} onPick={onPick} locale={locale} ownSlug={store.data?.slug ?? null} /> : <OwnFinder query={query} term={term} setTerm={setTerm} chosen={chosen} onPick={onPick} />}
    </div>
  );
}

/**
 * Another store's shelf, by the shop's own search: only what any shopper can
 * see, so a store never reads another's stock, costs or terms.
 */
function ShopFinder({ query, term, setTerm, chosen, onPick, locale, ownSlug }: { query: string; term: string; setTerm: (value: string) => void; chosen: number[]; onPick: (member: Omit<Member, "quantity">) => void; locale: "en" | "ar"; ownSlug: string | null }) {
  const { t } = useTranslation();
  const money = useMoney();
  const results = trpc.search.products.useQuery({ q: query, locale, limit: 8 }, { enabled: query.length >= 2, placeholderData: previous => previous });
  const rows = query.length >= 2 ? (results.data?.products ?? []).filter(product => !ownSlug || product.vendorSlug !== ownSlug).slice(0, 6) : [];
  return (
    <>
      <label htmlFor="bundle-find-shop" className="block text-[13px] leading-5 font-semibold text-[#0a285a]">{t("admin.bundleSearchShop")}</label>
      <div className="relative mt-1.5">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-[#536b8c]" aria-hidden />
        <input id="bundle-find-shop" type="search" dir="auto" aria-describedby="bundle-find-shop-hint" value={term} onChange={event => setTerm(event.target.value)} className={`${fieldClass} ps-10`} />
      </div>
      <p id="bundle-find-shop-hint" className="mt-1.5 text-[12px] leading-5 ink-muted">{t("admin.bundleSearchShopHint")}</p>
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
                    <Thumb src={product.images[0]?.url} alt="" className="size-full object-contain" icon={<ImageOff className="size-4 text-[#536b8c]" />} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p dir="auto" className="truncate text-[14px] font-semibold text-[#0a285a]">{product.title}</p>
                    {product.vendor ? <p dir="auto" className="truncate text-[12px] ink-muted">{product.vendor}</p> : null}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 ps-[52px]">
                  {product.variants.filter(variant => variant.availableForSale).map(variant => {
                    const variantId = Number(variant.id);
                    const option = isDefaultVariantTitle(variant.title) ? null : variant.title;
                    const inSet = chosen.includes(variantId);
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        onClick={() => onPick({
                          variantId,
                          title: product.title,
                          option,
                          price: variant.price.amount,
                          image: product.images[0]?.url ?? null,
                          fromShop: true,
                          vendorName: product.vendor,
                        })}
                        className={`${smallButtonClass.secondary} ${inSet ? "border-[#0a285a]" : ""}`}
                      >
                        <Plus className="size-3.5" aria-hidden />
                        <span className="sr-only">{t("admin.bundleAddThis", { name: isolate(product.title) })}</span>
                        {option ? <bdi>{option}</bdi> : null}
                        <span className="font-normal ink-muted">{money({ amount: variant.price.amount, currencyCode: "KWD" })}</span>
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
    </>
  );
}

/** The store's own shelf, or every store's for NetLet, by the products list's own search. */
function OwnFinder({ query, term, setTerm, chosen, onPick }: { query: string; term: string; setTerm: (value: string) => void; chosen: number[]; onPick: (member: Omit<Member, "quantity">) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const results = trpc.inventory.products.list.useQuery({ query, pageSize: 6 }, { enabled: query.length >= 2, placeholderData: previous => previous });
  const rows = query.length >= 2 ? results.data?.rows ?? [] : [];

  return (
    <div>
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
