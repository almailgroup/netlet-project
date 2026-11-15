/**
 * "Change payment method" — how an order is paid, changed while nothing of it
 * is with a driver (on the owner's word: "before the order is fully confirmed
 * and handed over to shipping … they can switch the payment method to other
 * methods, like credit cards and KNET").
 *
 * **A mockup until a payment provider is connected, also on the owner's
 * word** ("just build the mockup for now, we will implement the payment
 * method later"). Cash on delivery is the order's way and the one NetLet can
 * take; KNET, a card and Apple Pay are checkout's own rows, marked as coming,
 * and choosing one shows what switching will do — paid now on the provider's
 * page, the driver collecting nothing — over a Switch button that cannot be
 * pressed and says why beside it. Nothing is sent: there is no procedure to
 * send it to until a provider is.
 */
import { useId, useState, type ReactNode } from "react";
import { Banknote, CreditCard, Smartphone } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import type { Detail } from "@/components/account/LineReturn";
import type { MessageKey } from "@shared/i18n/dictionary";

type Way = "cod" | "knet" | "card" | "apple";

const WAYS: { key: Way; icon: ReactNode; title: MessageKey; note: MessageKey; preview?: MessageKey }[] = [
  { key: "cod", icon: <Banknote className="size-5" />, title: "checkout.payCod", note: "checkout.payCodNote" },
  { key: "knet", icon: <span className="text-[11px] font-extrabold tracking-tight">KNET</span>, title: "checkout.payKnet", note: "checkout.payKnetNote", preview: "orders.payPreviewKnet" },
  { key: "card", icon: <CreditCard className="size-5" />, title: "checkout.payCard", note: "checkout.payCardNote", preview: "orders.payPreviewCard" },
  { key: "apple", icon: <Smartphone className="size-5" />, title: "checkout.payApple", note: "checkout.payAppleNote", preview: "orders.payPreviewApple" },
];

export function OrderPayment({ detail, onCancel }: { detail: Detail; onCancel: () => void }) {
  const { t, locale } = useTranslation();
  const ids = useId();
  const [chosen, setChosen] = useState<Way>("cod");
  const amount = formatMoney(detail.owedNow, { currencyCode: detail.order.currency, locale });
  const picked = WAYS.find(way => way.key === chosen)!;

  return (
    <section aria-labelledby={`${ids}-title`} className="mt-3 rounded-2xl border border-[#d5dfeb] bg-white p-4">
      <h4 id={`${ids}-title`} className="text-[14px] font-extrabold text-[#0a285a]">{t("orders.changePayment")}</h4>
      <p className="mt-1 text-[12px] leading-5 ink-muted">{t("orders.payNowCod", { amount })}</p>
      <fieldset className="mt-3">
        <legend className="sr-only">{t("checkout.paymentMethod")}</legend>
        <ul className="space-y-2">
          {WAYS.map(way => {
            const on = chosen === way.key;
            return (
              <li key={way.key}>
                <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 ${on ? "border-[#0a285a] bg-[#f6f8fb] shadow-[inset_0_0_0_1px_#0a285a]" : "border-[#e6e9ef] bg-white"}`}>
                  <input
                    type="radio"
                    name={`${ids}-way`}
                    value={way.key}
                    checked={on}
                    onChange={() => setChosen(way.key)}
                    aria-describedby={`${ids}-${way.key}-note`}
                    className="size-4 shrink-0 accent-[#0a285a]"
                  />
                  <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl ${on ? "bg-[#0a285a] text-white" : "bg-[#f0f2f5] text-[#536b8c]"}`}>{way.icon}</span>
                  {/* The pill sits on the title's line, so a 320px phone gives the words the row's width. */}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[14px] font-bold text-[#0a285a]">{t(way.title)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${way.key === "cod" ? "bg-[#e7f3ea] text-[#2f5d33]" : "bg-[#f0f2f5] text-[#536b8c]"}`}>
                        {t(way.key === "cod" ? "orders.payCurrent" : "checkout.paySoon")}
                      </span>
                    </span>
                    <span id={`${ids}-${way.key}-note`} className="mt-0.5 block text-[12px] leading-4 ink-muted">{t(way.note)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {picked.preview ? (
        <p aria-live="polite" className="mt-3 rounded-xl bg-[#eef4fb] px-3 py-2.5 text-[13px] leading-5 text-[#0a285a]">
          {t(picked.preview, { amount })}
        </p>
      ) : (
        <p aria-live="polite" className="mt-3 text-[12px] leading-5 ink-muted">{t("orders.payWindow")}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {picked.preview ? (
          <button
            type="button"
            disabled
            aria-describedby={`${ids}-soon`}
            className="glass-navy type-control pressable inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-50 pointer-fine:min-h-9"
          >
            {t("orders.paySwitch", { method: t(picked.title) })}
          </button>
        ) : null}
        <button type="button" onClick={onCancel} className="glass type-control pressable min-h-11 rounded-full px-4 py-2 pointer-fine:min-h-9">
          {t("common.close")}
        </button>
      </div>
      {picked.preview ? <p id={`${ids}-soon`} className="mt-2 text-[12px] leading-5 ink-muted">{t("orders.paySoonNote")}</p> : null}
    </section>
  );
}
