/**
 * The button a sold-out product wears in place of Add to cart: "Remind me when
 * back in stock" (`useStockReminder`). On the product page and in the preview
 * it is the page's one action, a navy capsule the width of the pair it stands
 * in for, with a line under it saying how the reminder will arrive and how
 * many are waiting; on a card, in Saved and in Frequently bought it is the
 * card's own white button. Once set it reads "Reminder set" with a tick, and a
 * press turns it off again.
 *
 * Its accessible name starts with the words drawn and ends with the product
 * ("Remind me: Smart watch"), the card's rule, so a grid of them is not one
 * name said twenty times, and somebody driving the page by voice can say what
 * they see.
 */
import { BellRing, Check, LoaderCircle } from "lucide-react";
import AuthDialog from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { useStockReminder } from "@/hooks/useStockReminder";
import { useTranslation } from "@/hooks/useTranslation";
import { PREVIEW_TONE, PURCHASE_TONE } from "@/lib/purchaseStyle";
import { trpc } from "@/lib/trpc";

export function StockReminder({ productId, title, tone = "card", className = "" }: {
  productId: string;
  title: string;
  /**
   * `page`: the product page's and the preview's one action. `card`: a
   * card's, Saved's or a list row's button. `bar`: the phone's floating buy
   * bar, beside the price.
   */
  tone?: "page" | "card" | "bar";
  className?: string;
}) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const reminder = useStockReminder({ productId, title });
  const reach = trpc.customer.follows.reach.useQuery(undefined, { enabled: isAuthenticated && tone === "page", staleTime: 5 * 60_000 });

  const icon = reminder.pending
    ? <LoaderCircle className="size-[18px] shrink-0 animate-spin" aria-hidden />
    : reminder.on
      ? <Check className="size-[18px] shrink-0" aria-hidden />
      : <BellRing className="size-[18px] shrink-0" aria-hidden />;

  const dialog = reminder.signingIn ? <AuthDialog open onClose={reminder.closeSignIn} /> : null;

  if (tone === "bar") {
    return (
      <>
        <button
          type="button"
          onClick={reminder.press}
          aria-pressed={reminder.on}
          aria-label={t(reminder.on ? "remind.setName" : "remind.shortName", { name: title })}
          className={`flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-bold ${reminder.on ? PREVIEW_TONE.buy : PREVIEW_TONE.add} ${className}`}
        >
          {icon}
          {t(reminder.on ? "remind.set" : "remind.short")}
        </button>
        {dialog}
      </>
    );
  }

  if (tone === "card") {
    return (
      <>
        <button
          type="button"
          onClick={reminder.press}
          aria-pressed={reminder.on}
          aria-label={t(reminder.on ? "remind.setName" : "remind.shortName", { name: title })}
          className={`pressable flex h-11 w-full min-w-0 items-center justify-center gap-1.5 rounded-xl px-2.5 pointer-fine:h-10 ${reminder.on ? "border border-[#0a285a] bg-[#0a285a] text-white transition-colors hover:bg-[#0d3372]" : PURCHASE_TONE.add} ${className}`}
        >
          {icon}
          <span className="truncate">{t(reminder.on ? "remind.set" : "remind.short")}</span>
        </button>
        {dialog}
      </>
    );
  }

  const note = !isAuthenticated
    ? t("remind.noteGuest")
    : reach.data?.email ? t("remind.noteEmail") : t("remind.noteInbox");

  return (
    <div className={className}>
      <button
        type="button"
        onClick={reminder.press}
        aria-pressed={reminder.on}
        aria-label={t(reminder.on ? "remind.setName" : "remind.name", { name: title })}
        className={`flex h-12 w-full min-w-0 items-center justify-center gap-2 rounded-full px-4 text-[15px] font-bold ${reminder.on ? PREVIEW_TONE.buy : PREVIEW_TONE.add}`}
      >
        {icon}
        <span className="truncate">{t(reminder.on ? "remind.set" : "remind.button")}</span>
      </button>
      <p className="mt-2 text-center text-[13px] leading-5 ink-muted">{note}</p>
      {reminder.waiting > 0 ? (
        <p className="mt-0.5 text-center text-[12px] font-semibold ink-muted">
          {reminder.waiting === 1 ? t("follow.waitingOne") : t("follow.waiting", { count: reminder.waiting })}
        </p>
      ) : null}
      {dialog}
    </div>
  );
}
