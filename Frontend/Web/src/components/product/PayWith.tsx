/**
 * "Pay with: Cash on delivery · KNET coming soon" — the ways a store takes,
 * as a shopper reads them today (`payLine` in `Shared/commerce/storePayments.ts`),
 * under a product's price, on a store's page and under a store's lines in
 * the cart. While online payment is not live, KNET, cards and Apple Pay are
 * said as coming; a store that takes only those says it cannot be ordered
 * yet, here rather than at checkout.
 */
import { CircleAlert, Wallet } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { payLine, storeMethodKey, type StoreMethod } from "@shared/commerce/storePayments";

export function PayWith({ methods, className = "" }: { methods: readonly StoreMethod[] | undefined; className?: string }) {
  const { t } = useTranslation();
  if (!methods || methods.length === 0) return null;
  const { now, soon } = payLine(methods);
  const words = (list: StoreMethod[]) => list.map(method => t(storeMethodKey(method))).join(" · ");
  if (now.length === 0) {
    return (
      <p className={`flex items-start gap-1.5 text-[13px] leading-5 font-semibold text-[#7a4b0c] ${className}`}>
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t("storePay.notYet", { list: words(soon) })}</span>
      </p>
    );
  }
  return (
    <p className={`flex items-start gap-1.5 text-[13px] leading-5 text-[#0a285a] ${className}`}>
      <Wallet className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold">{t("storePay.payWith")}: </span>
        {words(now)}
        {soon.length > 0 ? <span className="ink-muted"> · {t("storePay.soon", { list: words(soon) })}</span> : null}
      </span>
    </p>
  );
}
