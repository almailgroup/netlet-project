/**
 * The ways a store lets its shoppers pay (`Shared/commerce/storePayments.ts`),
 * on the owner's word: cash on delivery with its limit, KNET, a card and
 * Apple Pay, any of them and one at least. The store's owner and managers
 * keep it on their own page (`/admin/payment-methods`); NetLet keeps any
 * store's on the store's page. One Save, through `storePayments.set`.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Banknote, CreditCard, Landmark, LoaderCircle, Save, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { Card, Field, Notice, buttonClass, fieldClass } from "@/components/admin/ui";
import { QueryGate } from "@/components/ui/QueryGate";
import { ONLINE_METHODS, type OnlineMethod } from "@shared/commerce/onlinePayment";
import { storeMethodKey, storeMethodsProblem, type StoreMethod } from "@shared/commerce/storePayments";
import { latinDigits } from "@shared/commerce/typedQuantity";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";

const HINT: Record<StoreMethod, MessageKey> = {
  cod: "storePay.codHint",
  knet: "storePay.knetHint",
  card: "storePay.cardHint",
  apple_pay: "storePay.applePayHint",
};

const ICON: Record<StoreMethod, ReactNode> = {
  cod: <Banknote className="size-5" aria-hidden />,
  knet: <Landmark className="size-5" aria-hidden />,
  card: <CreditCard className="size-5" aria-hidden />,
  apple_pay: <Smartphone className="size-5" aria-hidden />,
};

const AMOUNT = /^\d{1,9}(\.\d{1,3})?$/;

export function StorePayments({ vendorId, editable = true, id = "ways-to-pay" }: { vendorId?: number; editable?: boolean; id?: string }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const query = trpc.storePayments.get.useQuery(vendorId ? { vendorId } : undefined);
  const [cod, setCod] = useState(true);
  const [online, setOnline] = useState<OnlineMethod[]>([]);
  const [ceiling, setCeiling] = useState("");
  const [tried, setTried] = useState(false);
  const firstTick = useRef<HTMLInputElement>(null);
  const ceilingBox = useRef<HTMLInputElement>(null);
  const groupNote = useId();

  const view = query.data;
  useEffect(() => {
    if (!view) return;
    setCod(view.cod);
    setOnline(view.online);
    setCeiling(view.codCeiling ?? "");
    setTried(false);
  }, [view]);

  const save = trpc.storePayments.set.useMutation({
    onSuccess: saved => {
      utils.storePayments.get.setData(vendorId ? { vendorId } : undefined, saved);
      void utils.inventory.vendors.get.invalidate();
      toast.success(t("storePay.saved"));
    },
    onError: error => toast.error(isMessageKey(error.message) ? t(error.message) : t("admin.saveFailed")),
  });

  if (!view) return <QueryGate queries={[query]}>{() => null}</QueryGate>;

  const ready = view.ready;
  const typedCeiling = latinDigits(ceiling).trim();
  const none = storeMethodsProblem(cod, ready ? online : ONLINE_METHODS);
  const ceilingProblem = cod && typedCeiling !== "" && !AMOUNT.test(typedCeiling) ? t("storePay.badCeiling") : undefined;
  const changed =
    cod !== view.cod ||
    (cod && (typedCeiling || null) !== (view.codCeiling ?? null)) ||
    (ready && online.join() !== view.online.join());

  const onSave = () => {
    setTried(true);
    if (none) {
      firstTick.current?.focus();
      return;
    }
    if (ceilingProblem) {
      ceilingBox.current?.focus();
      return;
    }
    save.mutate({ ...(vendorId ? { vendorId } : {}), cod, codCeiling: cod ? typedCeiling : null, online: ready ? online : [...ONLINE_METHODS] });
  };

  const tick = (method: StoreMethod, value: boolean) => {
    if (method === "cod") setCod(value);
    else setOnline(current => ONLINE_METHODS.filter(m => (m === method ? value : current.includes(m))));
  };
  const isOn = (method: StoreMethod) => (method === "cod" ? cod : (ready ? online : ONLINE_METHODS).includes(method as OnlineMethod));
  const locked = (method: StoreMethod) => !editable || save.isPending || (method !== "cod" && !ready);

  return (
    <Card
      id={id}
      title={t("storePay.title")}
      description={t("storePay.intro")}
      footer={editable ? (
        <button type="button" onClick={onSave} disabled={save.isPending || (!changed && !tried)} className={buttonClass.primary}>
          {save.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
          {t(save.isPending ? "admin.saving" : "admin.save")}
        </button>
      ) : null}
    >
      <div className="space-y-4">
        {!ready ? <Notice>{t("storePay.notOpen")}</Notice> : !view.live ? <Notice>{t("storePay.onlineSoon")}</Notice> : null}
        <fieldset aria-describedby={tried && none ? groupNote : undefined} className="min-w-0">
          <legend className="sr-only">{t("storePay.title")}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["cod", ...ONLINE_METHODS] as StoreMethod[]).map((method, index) => (
              <label
                key={method}
                className={`tint-on-hover flex items-start gap-3 rounded-xl border p-3.5 ${isOn(method) ? "border-[#0a285a] bg-[#f4f7fb]" : "border-[#e1e7ef] bg-[#fafbfd]"} ${locked(method) ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
              >
                <input
                  ref={index === 0 ? firstTick : undefined}
                  type="checkbox"
                  checked={isOn(method)}
                  disabled={locked(method)}
                  onChange={event => tick(method, event.target.checked)}
                  className="mt-0.5 size-5 shrink-0 accent-[#0a285a]"
                />
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-[#0a285a] shadow-[inset_0_0_0_1px_#e1e7ef]">{ICON[method]}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-[#0a285a]">{t(storeMethodKey(method))}</span>
                  <span className="mt-0.5 block text-[12px] leading-5 ink-muted">{t(HINT[method])}</span>
                </span>
              </label>
            ))}
          </div>
          {tried && none ? (
            <p id={groupNote} className="mt-2 text-[13px] font-semibold text-[#a3221c]">{t("storePay.needOne")}</p>
          ) : null}
        </fieldset>
        <Field label={t("storePay.cashLimit")} hint={t("storePay.cashLimitHint")} error={tried ? ceilingProblem : undefined} optional className="max-w-sm">
          <input
            ref={ceilingBox}
            dir="ltr"
            inputMode="decimal"
            placeholder="0.000"
            value={ceiling}
            disabled={!editable || !cod || save.isPending}
            onChange={event => setCeiling(event.target.value)}
            className={fieldClass}
          />
        </Field>
        {!cod && !view.live ? <Notice tone="warning">{t("storePay.cashOffWarning")}</Notice> : null}
      </div>
    </Card>
  );
}
