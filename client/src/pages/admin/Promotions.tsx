/**
 * Minting discount codes and gift cards.
 *
 * Requirement 3.2.3. Two things on one page because they are one job — what a
 * shopper may type into the one field at checkout — and two pages would mean
 * somebody choosing between them before they know which they are making.
 *
 * **A discount code is NetLet's own promotion**, so it comes out of NetLet's
 * cut and needs no seller's agreement; a seller's own code would reduce their
 * takings and change the commission split on their lines, which is a decision
 * about money rather than a default to pick, so it is deliberately not here.
 *
 * **A gift card is money somebody already paid for.** It is generated rather
 * than chosen — the code is the whole credential — and it pays what is still
 * owed after every discount, because spending it first would use a customer's
 * own money on a reduction the shop was giving away anyway.
 */
import { useFeature } from "@/hooks/useFeature";
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { VOUCHER_KINDS, type VoucherKind } from "@shared/commerce/vouchers";
import { privatePageMeta } from "@shared/seo";
import { Gift, LoaderCircle, Ticket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** "10.000" is how a numeric column stores ten percent; "10%" is how it reads. */
function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

const field =
  "type-body h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a] outline-none focus:border-[#f2683a]";

export default function AdminPromotions() {
  usePageMeta(privatePageMeta("Codes and gift cards"));
  return <AdminShell need="platform.viewAll">{() => <Promotions />}</AdminShell>;
}

function Promotions() {
  const { t, tError } = useTranslation();
  /* Switched off (2.3): no new cards. One already sold is money somebody
     holds, so it stays listed and spendable. */
  const cardsOn = useFeature("giftCards");
  const money = useMoney();
  const list = trpc.orders.vouchers.useQuery({});
  const utils = trpc.useUtils();

  const [code, setCode] = useState({ code: "", kind: "percent" as VoucherKind, value: "", minSpend: "", endsAt: "", maxRedemptions: "", perShopper: "1" });
  const [card, setCard] = useState({ amount: "", note: "", expiresAt: "" });

  const refresh = () => void utils.orders.vouchers.invalidate();
  const saveCode = trpc.orders.saveDiscountCode.useMutation({
    onSuccess: () => { toast.success(t("admin.codeSaved")); refresh(); },
    onError: error => toast.error(tError(error.message)),
  });
  const makeCard = trpc.orders.createGiftCard.useMutation({
    onSuccess: reply => { toast.success(t("admin.cardCreated", { code: reply.code })); refresh(); setCard({ amount: "", note: "", expiresAt: "" }); },
    onError: error => toast.error(tError(error.message)),
  });

  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.promotions")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.promotionsNote")}</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#e6e9ef] bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-extrabold">
            <Ticket className="size-4 ink-accent" aria-hidden /> {t("admin.codeNew")}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] font-extrabold ink-muted">
              {t("admin.codeCode")}
              <input dir="ltr" value={code.code} onChange={e => setCode({ ...code, code: e.target.value })} className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] font-extrabold ink-muted">
              {t("admin.codeKind")}
              {/* The select carries its own name: a <label> wrapping one takes
                  the option text into the accessible name, so a screen reader
                  reads "Takes off A percentage An amount" as the field's name. */}
              <select
                aria-label={t("admin.codeKind")}
                value={code.kind}
                onChange={e => setCode({ ...code, kind: e.target.value as VoucherKind })}
                className={`${field} mt-1`}
              >
                {VOUCHER_KINDS.map(kind => (
                  <option key={kind} value={kind}>{t(kind === "percent" ? "admin.codePercent" : "admin.codeFixed")}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] font-extrabold ink-muted">
              {t("admin.codeValue")}
              <input dir="ltr" inputMode="decimal" value={code.value} onChange={e => setCode({ ...code, value: e.target.value })} className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] font-extrabold ink-muted">
              {t("admin.codeMinSpend")}
              <input dir="ltr" inputMode="decimal" value={code.minSpend} onChange={e => setCode({ ...code, minSpend: e.target.value })} className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] font-extrabold ink-muted">
              {t("admin.codeEndsAt")}
              <input dir="ltr" type="date" value={code.endsAt} onChange={e => setCode({ ...code, endsAt: e.target.value })} className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] font-extrabold ink-muted">
              {t("admin.codeMaxRedemptions")}
              <input dir="ltr" inputMode="numeric" value={code.maxRedemptions} onChange={e => setCode({ ...code, maxRedemptions: e.target.value })} className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] font-extrabold ink-muted">
              {t("admin.codePerShopper")}
              <input dir="ltr" inputMode="numeric" value={code.perShopper} onChange={e => setCode({ ...code, perShopper: e.target.value })} className={`${field} mt-1`} />
            </label>
          </div>
          <button
            type="button"
            disabled={!code.code.trim() || !code.value.trim() || saveCode.isPending}
            onClick={() => saveCode.mutate({
              code: code.code.trim(),
              kind: code.kind,
              value: code.value.trim(),
              /* An empty box is "no limit", never zero: a minimum spend of
                 0.000 and no minimum at all are different instructions. */
              minSpend: code.minSpend.trim() || null,
              endsAt: code.endsAt || null,
              maxRedemptions: code.maxRedemptions.trim() ? Number(code.maxRedemptions) : null,
              perShopper: Number(code.perShopper) || 1,
            })}
            className="glass glass-navy pressable mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
          >
            {saveCode.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t("admin.codeSave")}
          </button>
        </section>

        {cardsOn ? <section className="rounded-2xl border border-[#e6e9ef] bg-white p-5">
          <h2 className="flex items-center gap-2 text-sm font-extrabold">
            <Gift className="size-4 ink-accent" aria-hidden /> {t("admin.cardNew")}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] font-extrabold ink-muted">
              {t("admin.cardAmount")}
              <input dir="ltr" inputMode="decimal" value={card.amount} onChange={e => setCard({ ...card, amount: e.target.value })} className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] font-extrabold ink-muted">
              {t("admin.cardExpires")}
              <input dir="ltr" type="date" value={card.expiresAt} onChange={e => setCard({ ...card, expiresAt: e.target.value })} className={`${field} mt-1`} />
            </label>
            <label className="text-[11px] font-extrabold ink-muted sm:col-span-2">
              {t("admin.cardNote")}
              <input dir="auto" value={card.note} onChange={e => setCard({ ...card, note: e.target.value })} className={`${field} mt-1`} />
            </label>
          </div>
          <button
            type="button"
            disabled={!card.amount.trim() || makeCard.isPending}
            onClick={() => makeCard.mutate({
              amount: card.amount.trim(),
              note: card.note.trim() || null,
              expiresAt: card.expiresAt || null,
            })}
            className="glass glass-navy pressable mt-4 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-extrabold disabled:opacity-60"
          >
            {makeCard.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t("admin.cardCreate")}
          </button>
        </section> : null}
      </div>

      <QueryGate queries={[list]}>
        {() => {
          const data = list.data;
          if (!data) return null;
          return (
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              <section>
                <h2 className="text-sm font-extrabold text-[#0a285a]">{t("admin.promotions")}</h2>
                {data.codes.length === 0 ? (
                  <p className="mt-2 text-[13px] text-[#536b8c]">{t("admin.codesEmpty")}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {data.codes.map(row => (
                      <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-[#e6e9ef] bg-white px-4 py-3">
                        <bdi dir="ltr" className="font-mono text-sm font-bold text-[#0a285a]">{row.code}</bdi>
                        <span className="text-[13px] text-[#536b8c]">
                          {/* A percentage is not money and is not written like
                              it: the column is numeric(12,3), so "10" comes
                              back as "10.000" and reads as a strange figure. */}
                          {row.kind === "percent" ? `${trimZeros(row.value)}%` : amount(row.value)}
                        </span>
                        <span className="text-[11px] ink-muted">{t("admin.codeUsed", { used: row.used })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h2 className="text-sm font-extrabold text-[#0a285a]">{t("admin.cardNew")}</h2>
                {data.cards.length === 0 ? (
                  <p className="mt-2 text-[13px] text-[#536b8c]">{t("admin.cardsEmpty")}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {data.cards.map(row => (
                      <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-xl border border-[#e6e9ef] bg-white px-4 py-3">
                        <bdi dir="ltr" className="font-mono text-[12px] font-bold text-[#0a285a]">{row.code}</bdi>
                        <span className="text-[13px] text-[#536b8c]">
                          {t("admin.cardRemaining", { remaining: amount(row.remaining), initial: amount(row.initialBalance) })}
                        </span>
                        {row.note ? <span dir="auto" className="w-full text-[11px] ink-muted">{row.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          );
        }}
      </QueryGate>
    </>
  );
}
