/**
 * The cards a shopper has saved — the account's Payment methods page, on the
 * owner's word ("add a manage card for payment methods saved", then "remove
 * the ways to pay … only saved cards; you can only add payment methods").
 *
 * **It is the saved cards and one way to add one, nothing else.** It listed
 * the ways to pay too — cash on delivery as the default, KNET, a card and
 * Apple Pay as coming — and the owner took them off: how an order is paid is
 * checkout's question, and this page is about what is kept on the account.
 *
 * **It says what is true today.** There are no saved cards, and "Add a
 * payment method" is drawn and cannot be pressed: saving a card needs a
 * payment provider that holds it (a token, never the number), and NetLet
 * integrates none yet. When one is, the list is that provider's tokens and
 * this page is where they are named, made the default and removed. NetLet
 * itself never stores a card number, and the page says so, because that is
 * what a shopper reading a card form on a new shop wants to know first.
 */
import { CreditCard, Lock, Plus } from "lucide-react";
import { PANEL } from "@/components/account/profileParts";
import { useTranslation } from "@/hooks/useTranslation";

export function AccountPayments() {
  const { t } = useTranslation();

  return (
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
  );
}
