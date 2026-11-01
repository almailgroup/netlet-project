/**
 * How the shopper pays, and the cards they save — the account's Payment
 * methods page, on the owner's word ("add a manage card for payment methods
 * saved").
 *
 * **It says what is true today.** Every order on NetLet is cash on delivery,
 * so cash is the one way to pay and is marked as the default; KNET, a card and
 * Apple Pay are drawn as checkout draws them, each marked "Coming soon" and
 * none choosable. The saved cards say there are none and why, and "Add a card"
 * is drawn and cannot be pressed: saving a card needs a payment provider that
 * holds it (a token, never the number), and NetLet integrates none yet. When
 * one is, the list is that provider's tokens and this page is where they are
 * named, made the default and removed. NetLet itself never stores a card
 * number, and the page says so, because that is what a shopper reading a
 * card form on a new shop wants to know first.
 */
import { Banknote, CreditCard, Lock, Plus, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import { PANEL } from "@/components/account/profileParts";
import { useTranslation } from "@/hooks/useTranslation";

export function AccountPayments() {
  const { t } = useTranslation();

  const way = (key: string, icon: ReactNode, title: string, note: string, chosen: boolean) => (
    <li key={key} className="flex min-h-[72px] items-center gap-3.5 py-3">
      <span aria-hidden className={`grid size-11 shrink-0 place-items-center rounded-xl ${chosen ? "bg-[#0a285a] text-white" : "bg-[#f0f2f5] text-[#536b8c]"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] font-bold ${chosen ? "text-[#0a285a]" : "text-[#404553]"}`}>{title}</span>
        <span className="block text-[13px] leading-5 ink-muted">{note}</span>
      </span>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold ${chosen ? "bg-[#e7f3ea] text-[#2f5d33]" : "bg-[#f0f2f5] text-[#536b8c]"}`}>
        {t(chosen ? "payments.default" : "checkout.paySoon")}
      </span>
    </li>
  );

  return (
    <div className="space-y-3">
      <section aria-labelledby="payments-ways" className={`${PANEL} px-4 py-4 sm:px-5`}>
        <h3 id="payments-ways" className="text-[16px] font-extrabold text-[#0a285a]">{t("payments.waysTitle")}</h3>
        <ul className="mt-1 divide-y divide-dashed divide-[#e3e6ec]">
          {way("cod", <Banknote className="size-5" />, t("checkout.payCod"), t("checkout.payCodNote"), true)}
          {way("knet", <span className="text-[11px] font-extrabold tracking-tight">KNET</span>, t("checkout.payKnet"), t("checkout.payKnetNote"), false)}
          {way("card", <CreditCard className="size-5" />, t("checkout.payCard"), t("checkout.payCardNote"), false)}
          {way("apple", <Smartphone className="size-5" />, t("checkout.payApple"), t("checkout.payAppleNote"), false)}
        </ul>
      </section>

      <section aria-labelledby="payments-cards" className={`${PANEL} px-4 py-4 sm:px-5`}>
        <h3 id="payments-cards" className="text-[16px] font-extrabold text-[#0a285a]">{t("payments.savedCards")}</h3>
        <div className="mt-3 flex items-start gap-3.5 rounded-xl border border-dashed border-[#d5dfeb] bg-[#fbfcfe] p-4">
          <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#eef1f6] text-[#0a285a]"><CreditCard className="size-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-[#0a285a]">{t("payments.noCards")}</span>
            <span className="mt-0.5 block text-[13px] leading-5 text-[#404553]">{t("payments.noCardsNote")}</span>
          </span>
        </div>
        <button
          type="button"
          disabled
          aria-describedby="payments-add-soon"
          className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-[#d5dfeb] bg-white px-5 text-[15px] font-bold text-[#536b8c] disabled:cursor-not-allowed"
        >
          <Plus className="size-5" aria-hidden />
          {t("payments.addCard")}
          <span id="payments-add-soon" className="rounded-full bg-[#f0f2f5] px-2 py-0.5 text-[12px] font-bold">{t("checkout.paySoon")}</span>
        </button>
        <p className="mt-3 flex items-start gap-2 text-[13px] leading-5 ink-muted">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("payments.neverStored")}
        </p>
      </section>
    </div>
  );
}
