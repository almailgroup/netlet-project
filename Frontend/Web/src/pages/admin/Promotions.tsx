/**
 * Minting discount codes and gift cards.
 *
 * Requirement 3.2.3. Two things on one page because they are one job — what a
 * shopper may type into the one field at checkout — and two pages would mean
 * somebody choosing between them before they know which they are making.
 *
 * **A code for the whole order is NetLet's own promotion**, so it comes out of
 * NetLet's cut. **A code for a store or chosen products (migration 0074)** is
 * typed on that product's line at checkout and comes off that line alone; the
 * owner's rule is that whoever made it pays for it. A store's owner or manager
 * (`promotion.manage`) makes codes here for their own products only, always
 * paid by the store, and sees their own codes and nothing of NetLet's; NetLet
 * makes any code and says who pays.
 *
 * **A gift card is money somebody already paid for.** It is generated rather
 * than chosen — the code is the whole credential — and it pays what is still
 * owed after every discount, because spending it first would use a customer's
 * own money on a reduction the shop was giving away anyway.
 */
import { useFeature } from "@/hooks/useFeature";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, Card, EmptyState, Field, fieldClass, Notice, PageHeader, Pill, SectionHeading, SkeletonRows, smallButtonClass, tableClass } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { VOUCHER_KINDS, type VoucherKind } from "@shared/commerce/vouchers";
import { codeShapeProblem, type CodeFunder, type CodeScope } from "@shared/commerce/lineCodes";
import { can, type Actor } from "@shared/inventory/permissions";
import { kuwaitDay } from "@shared/kuwaitDay";
import { privatePageMeta } from "@shared/seo";
import { Gift, LoaderCircle, Ticket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Select } from "@/components/ui/Select";

/** "10.000" is how a numeric column stores ten percent; "10%" is how it reads. */
function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

const EMPTY_CODE = {
  code: "", kind: "percent" as VoucherKind, value: "", minSpend: "", endsAt: "", maxRedemptions: "", perShopper: "1",
  /* What it covers and who pays (0074). */
  scope: "order" as CodeScope, vendorId: "", fundedBy: "netlet" as CodeFunder, productIds: [] as number[],
};

export default function AdminPromotions() {
  usePageMeta(privatePageMeta("Codes and gift cards"));
  /* NetLet's whole page, or a store's own codes for its owner or manager. */
  return <AdminShell need={["platform.viewAll", "promotion.manage"]}>{actor => <Promotions actor={actor} />}</AdminShell>;
}

function Promotions({ actor }: { actor: Actor }) {
  const { t, tError, isArabic } = useTranslation();
  const netlet = can(actor, "platform.viewAll");
  const ownStore = actor.kind === "vendor" ? actor.vendorId : null;
  const fresh = netlet ? EMPTY_CODE : { ...EMPTY_CODE, scope: "store" as CodeScope, vendorId: String(ownStore ?? ""), fundedBy: "store" as CodeFunder };
  /* Switched off (2.3): no new cards. One already sold is money somebody
     holds, so it stays listed and spendable. */
  const cardsOn = useFeature("giftCards");
  const money = useMoney();
  const formatDate = useDateFormat();
  const list = trpc.orders.vouchers.useQuery({});
  const utils = trpc.useUtils();

  const [code, setCode] = useState(fresh);
  const vendors = trpc.inventory.vendors.list.useQuery({ pageSize: 200 }, { enabled: netlet });
  const storeName = (id: number | null, fallback: string | null) =>
    vendors.data?.rows.find(row => row.id === id)?.name ?? fallback ?? "";
  const shape = codeShapeProblem({
    scope: code.scope,
    vendorId: code.scope === "order" ? null : code.vendorId ? Number(code.vendorId) : null,
    fundedBy: code.scope === "order" ? "netlet" : code.fundedBy,
    productIds: code.productIds,
  });
  /* Saving an existing code edits it, which the server has always allowed —
     a live campaign gets a later end date. The form says which it is doing. */
  const [editing, setEditing] = useState<string | null>(null);
  const [card, setCard] = useState({ amount: "", note: "", expiresAt: "" });

  const refresh = () => void utils.orders.vouchers.invalidate();
  const saveCode = trpc.orders.saveDiscountCode.useMutation({
    onSuccess: () => { toast.success(t("admin.codeSaved")); refresh(); setCode(fresh); setEditing(null); },
    onError: error => toast.error(tError(error.message)),
  });
  const makeCard = trpc.orders.createGiftCard.useMutation({
    onSuccess: reply => { toast.success(t("admin.cardCreated", { code: reply.code })); refresh(); setCard({ amount: "", note: "", expiresAt: "" }); },
    onError: error => toast.error(tError(error.message)),
  });

  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const set = (patch: Partial<typeof code>) => setCode(current => ({ ...current, ...patch }));

  return (
    <>
      <PageHeader title={t(netlet ? "admin.promotions" : "admin.codeOwnTitle")} description={t(netlet ? "admin.promotionsNote" : "admin.codeStoreNote")} />

      <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={event => {
          event.preventDefault();
          saveCode.mutate({
            code: code.code.trim(),
            kind: code.kind,
            value: code.value.trim(),
            /* An empty box is "no limit", never zero: a minimum spend of
               0.000 and no minimum at all are different instructions. */
            minSpend: code.minSpend.trim() || null,
            endsAt: code.endsAt || null,
            maxRedemptions: code.maxRedemptions.trim() ? Number(code.maxRedemptions) : null,
            perShopper: Number(code.perShopper) || 1,
            scope: code.scope,
            vendorId: code.scope === "order" || !code.vendorId ? null : Number(code.vendorId),
            fundedBy: code.scope === "order" ? "netlet" : code.fundedBy,
            productIds: code.scope === "products" ? code.productIds : [],
          });
        }}>
          <Card
            title={<span className="inline-flex items-center gap-2"><Ticket className="size-4 ink-accent" aria-hidden />{editing ? editing : t("admin.codeNew")}</span>}
            footer={
              <>
                {editing ? <button type="button" onClick={() => { setCode(fresh); setEditing(null); }} className={buttonClass.secondary}>{t("admin.codeStartNew")}</button> : null}
                <button type="submit" disabled={code.code.trim().length < 3 || !code.value.trim() || Boolean(shape) || saveCode.isPending} className={buttonClass.primary}>
                  {saveCode.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                  {t("admin.codeSave")}
                </button>
              </>
            }
          >
            {editing ? <Notice className="mb-4">{t("admin.codeEditing", { code: editing })}</Notice> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("admin.codeCode")}>
                <input dir="ltr" value={code.code} maxLength={40} readOnly={editing !== null} onChange={e => set({ code: e.target.value.toUpperCase() })} className={`${fieldClass} font-mono uppercase`} />
              </Field>
              <Field label={t("admin.codeKind")}>
                <Select value={code.kind} onChange={e => set({ kind: e.target.value as VoucherKind })} className={fieldClass}>
                  {VOUCHER_KINDS.map(kind => (
                    <option key={kind} value={kind}>{t(kind === "percent" ? "admin.codePercent" : "admin.codeFixed")}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("admin.codeValue")}>
                <input dir="ltr" inputMode="decimal" placeholder={code.kind === "percent" ? "10" : "0.000"} value={code.value} onChange={e => set({ value: e.target.value })} className={fieldClass} />
              </Field>
              <Field label={t("admin.codeMinSpend")} hint={t("admin.codeMinSpendHint")} optional>
                <input dir="ltr" inputMode="decimal" placeholder="0.000" value={code.minSpend} onChange={e => set({ minSpend: e.target.value })} className={fieldClass} />
              </Field>
              <Field label={t("admin.codeEndsAt")} hint={t("admin.codeEndsHint")} optional>
                <input dir="ltr" type="date" value={code.endsAt} onChange={e => set({ endsAt: e.target.value })} className={fieldClass} />
              </Field>
              <Field label={t("admin.codeMaxRedemptions")} hint={t("admin.codeLimitHint")} optional>
                <input dir="ltr" inputMode="numeric" value={code.maxRedemptions} onChange={e => set({ maxRedemptions: e.target.value.replace(/\D/g, "") })} className={fieldClass} />
              </Field>
              <Field label={t("admin.codePerShopper")}>
                <input dir="ltr" inputMode="numeric" value={code.perShopper} onChange={e => set({ perShopper: e.target.value.replace(/\D/g, "") })} className={fieldClass} />
              </Field>
              {/* What it takes money off (0074): NetLet's whole order, a store,
                  or chosen products — a store's own codes are only the last two. */}
              <Field label={t("admin.codeScope")}>
                <Select value={code.scope} onChange={e => set({ scope: e.target.value as CodeScope, productIds: [] })} className={fieldClass}>
                  {netlet ? <option value="order">{t("admin.codeScopeOrder")}</option> : null}
                  <option value="store">{t(netlet ? "admin.codeScopeStore" : "admin.codeScopeStoreOwn")}</option>
                  <option value="products">{t("admin.codeScopeProducts")}</option>
                </Select>
              </Field>
              {netlet && code.scope !== "order" ? (
                <Field label={t("admin.codeStore")}>
                  <Select value={code.vendorId} onChange={e => set({ vendorId: e.target.value, productIds: [] })} className={fieldClass}>
                    <option value="">—</option>
                    {(vendors.data?.rows ?? []).map(row => <option key={row.id} value={String(row.id)}>{row.name}</option>)}
                  </Select>
                </Field>
              ) : null}
              {netlet && code.scope !== "order" ? (
                <Field label={t("admin.codeFunder")}>
                  <Select value={code.fundedBy} onChange={e => set({ fundedBy: e.target.value as CodeFunder })} className={fieldClass}>
                    <option value="netlet">{t("admin.codeFundedNetlet")}</option>
                    <option value="store">{t("admin.codeFundedStore")}</option>
                  </Select>
                </Field>
              ) : null}
              {code.scope === "products" && code.vendorId ? (
                <ProductPicker
                  vendorId={Number(code.vendorId)}
                  chosen={code.productIds}
                  onChange={productIds => set({ productIds })}
                  isArabic={isArabic}
                />
              ) : null}
            </div>
            {shape ? (
              <p className="mt-3 text-[13px] font-semibold text-[#8c2f22]">{t(shape)}</p>
            ) : null}
          </Card>
        </form>

        {!netlet ? null : cardsOn ? (
          <form onSubmit={event => {
            event.preventDefault();
            makeCard.mutate({ amount: card.amount.trim(), note: card.note.trim() || null, expiresAt: card.expiresAt || null });
          }}>
            <Card
              title={<span className="inline-flex items-center gap-2"><Gift className="size-4 ink-accent" aria-hidden />{t("admin.cardNew")}</span>}
              footer={
                <button type="submit" disabled={!card.amount.trim() || makeCard.isPending} className={buttonClass.primary}>
                  {makeCard.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                  {t("admin.cardCreate")}
                </button>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("admin.cardAmount")}>
                  <input dir="ltr" inputMode="decimal" placeholder="0.000" value={card.amount} onChange={e => setCard({ ...card, amount: e.target.value })} className={fieldClass} />
                </Field>
                <Field label={t("admin.cardExpires")} hint={t("admin.cardExpiresHint")} optional>
                  <input dir="ltr" type="date" value={card.expiresAt} onChange={e => setCard({ ...card, expiresAt: e.target.value })} className={fieldClass} />
                </Field>
                <Field label={t("admin.cardNote")} optional className="sm:col-span-2">
                  <input dir="auto" maxLength={200} value={card.note} onChange={e => setCard({ ...card, note: e.target.value })} className={fieldClass} />
                </Field>
              </div>
            </Card>
          </form>
        ) : (
          <Notice className="self-start">{t("admin.cardsOff")}</Notice>
        )}
      </div>

      {list.isLoading ? (
        <div className="mt-8"><SkeletonRows label={t("admin.loading")} /></div>
      ) : (
        <QueryGate queries={[list]}>
          {() => {
            const data = list.data;
            if (!data) return null;
            return (
              <div className="mt-8 grid gap-8 xl:grid-cols-2">
                <section aria-labelledby="codes-title" className="min-w-0">
                  <SectionHeading><span id="codes-title">{t("admin.codesTitle")}</span></SectionHeading>
                  {data.codes.length === 0 ? (
                    <EmptyState title={t("admin.codesEmpty")} />
                  ) : (
                    <ul className="divide-y divide-[#eef1f5] overflow-hidden rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_1px_2px_rgba(10,40,90,0.05)]">
                      {data.codes.map(row => {
                        const over = row.endsAt ? new Date(row.endsAt) < new Date() : false;
                        return (
                          <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-2">
                                <bdi dir="ltr" className="font-mono text-[14px] font-bold text-[#0a285a]">{row.code}</bdi>
                                <Pill tone="navy">
                                  {/* A percentage is not money and is not written like
                                      it: the column is numeric(12,3), so "10" comes
                                      back as "10.000" and reads as a strange figure. */}
                                  {row.kind === "percent" ? <bdi dir="ltr">{trimZeros(row.value)}%</bdi> : amount(row.value)}
                                </Pill>
                                {over ? <Pill tone="neutral">{t("admin.codeExpired")}</Pill> : null}
                                <Pill tone="neutral">
                                  {row.scope === "order" ? t("admin.codeForOrder")
                                    : row.scope === "store" ? t("admin.codeForStore", { name: storeName(row.vendorId, row.vendorName) })
                                    : t("admin.codeForProducts", { name: storeName(row.vendorId, row.vendorName), count: row.productIds.length })}
                                </Pill>
                                {row.scope !== "order" && netlet ? <Pill tone="neutral">{t(row.fundedBy === "store" ? "admin.codePaidByStore" : "admin.codePaidByNetlet")}</Pill> : null}
                              </p>
                              <p className="mt-1 text-[13px] ink-muted">
                                {row.maxRedemptions ? t("admin.codeUsedOf", { used: row.used, max: row.maxRedemptions }) : t("admin.codeUsed", { used: row.used })}
                                {" · "}
                                {row.endsAt ? t("admin.codeEnds", { date: formatDate(row.endsAt) }) : t("admin.codeNoEnd")}
                                {row.minSpend ? <> · {t("admin.codeMinSpend")}: {amount(row.minSpend)}</> : null}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(row.code);
                                setCode({
                                  code: row.code,
                                  kind: row.kind as VoucherKind,
                                  value: row.kind === "percent" ? trimZeros(row.value) : row.value,
                                  minSpend: row.minSpend ?? "",
                                  endsAt: row.endsAt ? kuwaitDay(new Date(row.endsAt)) : "",
                                  maxRedemptions: row.maxRedemptions ? String(row.maxRedemptions) : "",
                                  perShopper: String(row.perShopper ?? 1),
                                  scope: row.scope,
                                  vendorId: row.vendorId === null ? "" : String(row.vendorId),
                                  fundedBy: row.fundedBy,
                                  productIds: row.productIds,
                                });
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                              className={smallButtonClass.secondary}
                            >
                              {t("admin.codeEdit")}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {netlet ? <section aria-labelledby="cards-title" className="min-w-0">
                  <SectionHeading><span id="cards-title">{t("admin.cardsTitle")}</span></SectionHeading>
                  {data.cards.length === 0 ? (
                    <EmptyState title={t("admin.cardsEmpty")} />
                  ) : (
                    <div className={tableClass.wrap}>
                      <table className={tableClass.table}>
                        <thead className={tableClass.head}>
                          <tr>
                            <th scope="col" className={tableClass.th}>{t("admin.columnCode")}</th>
                            <th scope="col" className={tableClass.thEnd}>{t("admin.columnBalance")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.cards.map(row => (
                            <tr key={row.id} className={tableClass.row}>
                              <td className={tableClass.td}>
                                <bdi dir="ltr" className="font-mono text-[13px] font-bold text-[#0a285a]">{row.code}</bdi>
                                {row.note ? <p dir="auto" className="mt-0.5 text-[13px] ink-muted">{row.note}</p> : null}
                                {row.expiresAt ? <p className="mt-0.5 text-[12px] ink-muted">{t("admin.cardExpiresOn", { date: formatDate(row.expiresAt) })}</p> : null}
                              </td>
                              <td className={`${tableClass.td} text-end text-[13px] text-[#3d5376]`}>
                                {t("admin.cardRemaining", { remaining: amount(row.remaining), initial: amount(row.initialBalance) })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section> : null}
              </div>
            );
          }}
        </QueryGate>
      )}
    </>
  );
}

/**
 * The products a code is for: the store's own, searched on the server like
 * the products page, each a tick box. What was ticked stays ticked while the
 * search changes, and the count says how many.
 */
function ProductPicker({ vendorId, chosen, onChange, isArabic }: {
  vendorId: number;
  chosen: number[];
  onChange: (ids: number[]) => void;
  isArabic: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const list = trpc.inventory.products.list.useQuery({ vendorId, query: query.trim() || undefined, pageSize: 50 });
  const rows = list.data?.rows ?? [];
  const toggle = (id: number) => onChange(chosen.includes(id) ? chosen.filter(one => one !== id) : [...chosen, id]);
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-[13px] font-bold text-[#0a285a]">{t("admin.codeProducts")}</legend>
      <p className="mt-0.5 text-[12px] ink-muted">{t("admin.codeProductsHint")}</p>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="search"
          dir="auto"
          value={query}
          onChange={event => setQuery(event.target.value)}
          aria-label={t("admin.codeProductsSearch")}
          placeholder={t("admin.codeProductsSearch")}
          className={`${fieldClass} flex-1`}
        />
        <span className="shrink-0 text-[13px] font-bold text-[#0a285a]">{t("admin.codeChosenCount", { count: chosen.length })}</span>
      </div>
      <ul className="mt-2 max-h-56 divide-y divide-[#eef1f5] overflow-y-auto rounded-xl border border-[#e1e7ef] bg-white">
        {list.isLoading ? <li className="px-3 py-3"><LoaderCircle className="size-4 animate-spin ink-muted" aria-hidden /></li> : null}
        {!list.isLoading && rows.length === 0 ? <li className="px-3 py-3 text-[13px] ink-muted">{t("admin.codeNoProducts")}</li> : null}
        {rows.map(row => (
          <li key={row.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-[14px]">
              <input type="checkbox" checked={chosen.includes(row.id)} onChange={() => toggle(row.id)} className="size-4 shrink-0 accent-[#0a285a]" />
              <span dir="auto" className="min-w-0 flex-1 truncate">{(isArabic && row.titleAr?.trim()) || row.title}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
