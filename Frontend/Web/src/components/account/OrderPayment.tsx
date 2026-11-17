/**
 * "Change payment method" — paying a cash order online instead, until it is
 * delivered (on the owner's word: "allow customers to change from COD to
 * online payment through the order page").
 *
 * **Two states, by the server's word** (`paymentChange.live`). While no
 * gateway is connected and the `testPayments` switch is off, it is the mockup
 * it was: KNET, a card and Apple Pay drawn as they will be, marked as coming,
 * over a Switch that cannot be pressed. With the switch on (and 0086 pasted),
 * choosing one and pressing Pay opens NetLet's own test page
 * (`/pay/test/:id`), which takes no money and says so — the order then reads
 * paid online and the driver collects nothing. The figure sent is the one the
 * panel shows; the server refuses it if the order now owes something else.
 */
import { useId, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { Banknote, CreditCard, FlaskConical, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import type { OnlineMethod } from "@shared/commerce/onlinePayment";
import type { Detail } from "@/components/account/LineReturn";
import type { MessageKey } from "@shared/i18n/dictionary";

type Way = "cod" | "knet" | "card" | "apple";

/** What the server calls each online way. */
const METHOD: Record<Exclude<Way, "cod">, OnlineMethod> = { knet: "knet", card: "card", apple: "apple_pay" };

const WAYS: { key: Way; icon: ReactNode; title: MessageKey; note: MessageKey; preview?: MessageKey }[] = [
  { key: "cod", icon: <Banknote className="size-5" />, title: "checkout.payCod", note: "checkout.payCodNote" },
  { key: "knet", icon: <span className="text-[11px] font-extrabold tracking-tight">KNET</span>, title: "checkout.payKnet", note: "checkout.payKnetNote", preview: "orders.payPreviewKnet" },
  { key: "card", icon: <CreditCard className="size-5" />, title: "checkout.payCard", note: "checkout.payCardNote", preview: "orders.payPreviewCard" },
  { key: "apple", icon: <Smartphone className="size-5" />, title: "checkout.payApple", note: "checkout.payAppleNote", preview: "orders.payPreviewApple" },
];

export function OrderPayment({ reference, detail, onCancel, onMoved }: {
  reference: string;
  detail: Detail;
  onCancel: () => void;
  /** The order moved under the panel: read it again, so the figure is today's. */
  onMoved: () => void;
}) {
  const { t, tError, locale } = useTranslation();
  const ids = useId();
  const [, navigate] = useLocation();
  const [chosen, setChosen] = useState<Way>("cod");
  const live = detail.paymentChange.live;
  const amount = formatMoney(detail.owedNow, { currencyCode: detail.order.currency, locale });
  const picked = WAYS.find(way => way.key === chosen)!;
  const start = trpc.orders.paymentStart.useMutation({
    onSuccess: started => navigate(`/pay/test/${started.paymentId}`),
    onError: error => {
      toast.error(tError(error.message));
      if (error.message === "orders.payMoved") onMoved();
    },
  });

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
                        {t(way.key === "cod" ? "orders.payCurrent" : live ? "orders.payTest" : "checkout.paySoon")}
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

      {/* The mockup says what a gateway's page will do; live, the test page's own note does. */}
      {picked.preview && !live ? (
        <p aria-live="polite" className="mt-3 rounded-xl bg-[#eef4fb] px-3 py-2.5 text-[13px] leading-5 text-[#0a285a]">
          {t(picked.preview, { amount })}
        </p>
      ) : picked.preview ? null : (
        <p aria-live="polite" className="mt-3 text-[12px] leading-5 ink-muted">{t("orders.payWindow")}</p>
      )}

      {/* With the test switch on: what the page it opens is, before it is pressed. */}
      {live && picked.preview ? (
        <p id={`${ids}-test`} aria-live="polite" className="mt-3 flex items-start gap-2 rounded-xl border border-dashed border-[#e4b363] bg-[#fff8eb] px-3 py-2 text-[12px] leading-5 text-[#6b4a12]">
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("orders.payTestNote")}</span>
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {picked.preview && live ? (
          <button
            type="button"
            disabled={start.isPending}
            aria-describedby={`${ids}-test`}
            onClick={() => start.mutate({ reference, method: METHOD[picked.key as Exclude<Way, "cod">], expectOwed: detail.owedNow })}
            className="glass-navy type-control pressable inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 disabled:opacity-60 pointer-fine:min-h-9"
          >
            {t(start.isPending ? "orders.payOpening" : "orders.payNow", { amount })}
          </button>
        ) : picked.preview ? (
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
      {picked.preview && !live ? <p id={`${ids}-soon`} className="mt-2 text-[12px] leading-5 ink-muted">{t("orders.paySoonNote")}</p> : null}
    </section>
  );
}
