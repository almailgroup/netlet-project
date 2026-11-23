/**
 * Checkout's three ways to pay less, on the owner's word ("display three
 * distinct options: a discount code input, a gift card input, a NetLet points
 * redemption toggle") — at checkout only, on their word too ("the codes, gift
 * cards and points should only be in the checkout page, not cart"). What is
 * chosen is kept for the tab and the bag (`lib/bagSavings.ts`), so a reload
 * of checkout keeps it.
 *
 * **A discount and a gift card are two boxes, and one order may use both.**
 * Checkout's one box asked "a discount code or a gift card", since somebody
 * holding a code does not always know which it is — so each box still asks the
 * shop, and a code typed in the wrong one is moved to the right one and said
 * so. One of each per order: a second card or a second code waits for the
 * first to be taken off.
 *
 * **What comes off, and in what order, is `settle`**: the code from the goods,
 * then the points, then the card against what is still owed — the order writer's
 * own function, so the cart, checkout and the bill cannot disagree. The server
 * quotes each code against the bag and checks all three again at the order.
 * A code is applied on a press rather than per keystroke: each one naming
 * nothing counts against the address's ceiling on guesses.
 *
 * **Points are a switch, shown for a balance that has some.** A guest is told
 * to sign in, and an account with none is told where they come from — a line,
 * never a switch that can only be turned on to no effect.
 *
 * **The three are round icons in a row, on the owner's word** ("the same
 * for the codes, gift cards and points — round shaped icons"), each folded
 * until it is pressed ("keep these sections collapsed by default"). Under each
 * circle a line says what it holds — what a code takes off, "Not applied" in
 * red for one refused, the points there are — and a corner badge, green or
 * red, says the same to the eye, so nothing chosen is hidden. A press opens
 * that one's box under the row by its height (`Unfold`), one at a time, and
 * puts the keyboard in it.
 */
import { RoundFace, RoundLabel, savingsFace, type SavingsMark } from "@/components/checkout/RoundChoice";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/hooks/useAuth";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { setSavings, useSavings } from "@/lib/bagSavings";
import { formatCount } from "@/lib/format";
import { pressHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import { pointsSpendableOn, spendValue } from "@shared/commerce/referral";
import { giftCardPayment, normaliseCode, settle } from "@shared/commerce/vouchers";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { subtractMoney } from "@shared/money";
import { Check, LoaderCircle, X } from "lucide-react";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { lazyPage } from "@/lib/lazyPage";
import { Unfold } from "@/components/ui/Unfold";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useConfirmRemoval } from "@/components/ui/ConfirmRemoval";
import { isolate } from "@/lib/isolate";

const AuthDialog = lazyPage(() => import("@/components/auth/AuthDialog"));

const QUOTE_OPTIONS = { refetchOnWindowFocus: false, retry: false, staleTime: 60_000 } as const;

/**
 * What the chosen code, card and points take off this bag, and what is left
 * to pay — read by the card and by checkout's summary.
 * `withBalance` asks for the points balance even when points are not on,
 * which only the card needs (to offer them).
 */
export function useSavingsBill({ withBalance = false }: { withBalance?: boolean } = {}) {
  const { cart, skip } = useCart();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const chosen = useSavings(cart?.id);
  const cartId = cart?.id ?? "";
  /* Of the lines ticked for this checkout (`cartChoice.ts`), as the order will be. */
  const codeQuote = trpc.orders.quoteVoucher.useQuery({ cartId, code: chosen.code, skip }, { ...QUOTE_OPTIONS, enabled: Boolean(cartId && chosen.code) });
  const giftQuote = trpc.orders.quoteVoucher.useQuery({ cartId, code: chosen.giftCard, skip }, { ...QUOTE_OPTIONS, enabled: Boolean(cartId && chosen.giftCard) });
  const rewards = trpc.rewards.mine.useQuery(undefined, { enabled: isAuthenticated && (withBalance || chosen.usePoints) });

  /* A percentage and a minimum spend are of the goods, so a code is asked
     about again when the goods change. A code that works is not a guess, so
     asking again costs nothing against the ceiling. */
  /* The goods are what the shopper pays for them: less each product's own
     code (0074), which the order's code and points then come after. */
  const goods = subtractMoney(cart?.subtotal.amount ?? "0.000", cart?.codeDiscount?.amount ?? "0.000");
  useEffect(() => {
    if (chosen.code || chosen.giftCard) void utils.orders.quoteVoucher.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goods]);

  const discount = codeQuote.data?.ok && codeQuote.data.kind === "discount" ? codeQuote.data : null;
  const gift = giftQuote.data?.ok && giftQuote.data.kind === "gift" ? giftQuote.data : null;
  const balance = isAuthenticated ? rewards.data?.balance ?? 0 : 0;
  const orderTotal = cart?.total.amount ?? "0.000";
  const discountOff = discount?.amount ?? "0.000";
  const afterDiscount = subtractMoney(orderTotal, discountOff);
  const pointsApplied = chosen.usePoints && balance > 0 ? pointsSpendableOn(balance, afterDiscount) : 0;
  const pointsOff = spendValue(pointsApplied);
  const giftOff = gift ? giftCardPayment(gift.remaining, subtractMoney(afterDiscount, pointsOff)) : "0.000";
  const bill = settle({
    goods,
    delivery: cart?.delivery.total.amount ?? "0.000",
    tax: cart?.tax?.amount.amount ?? "0.000",
    discount: discountOff,
    points: pointsOff,
    giftCard: giftOff,
  });
  return {
    chosen,
    codeQuote,
    giftQuote,
    discount,
    gift,
    balance,
    balanceKnown: !isAuthenticated || rewards.isSuccess,
    pointsApplied,
    discountOff: bill.discount,
    pointsOff: bill.points,
    giftOff: bill.giftCard,
    payable: bill.payable,
    /** Anything taken off at all, so a summary knows to draw the rows. */
    reduced: Number(bill.discount) > 0 || Number(bill.points) > 0 || Number(bill.giftCard) > 0,
    /** What to send with the order: only a code not known to be refused. */
    voucherCode: chosen.code && (!codeQuote.data || codeQuote.data.ok) ? chosen.code : undefined,
    giftCardCode: chosen.giftCard && (!giftQuote.data || giftQuote.data.ok) ? chosen.giftCard : undefined,
    usePoints: pointsApplied > 0,
  };
}

export function BagSavings() {
  const { t, locale } = useTranslation();
  const money = useMoney();
  const { cart } = useCart();
  const headingId = useId();
  const panelId = useId();
  const bill = useSavingsBill({ withBalance: true });
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const [open, setOpen] = useState<SavingsMark | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusNext = useRef(false);
  useEffect(() => {
    if (!open || !focusNext.current) return;
    focusNext.current = false;
    panel.current?.querySelector<HTMLElement>("input:not([type=hidden]), [role=switch], button")?.focus({ preventScroll: true });
  }, [open]);

  /* What each circle says under its name about itself. */
  const codeSummary = (kind: "discount" | "gift"): Summary => {
    const held = kind === "discount" ? bill.chosen.code : bill.chosen.giftCard;
    const quote = kind === "discount" ? bill.codeQuote : bill.giftQuote;
    if (!held) return { text: t("cart.savingsOpen"), tone: "muted" };
    if (quote.data && !quote.data.ok) return { text: t("cart.savingsNotApplied"), tone: "bad" };
    if (!quote.data) return { text: normaliseCode(held) || held, tone: "muted", code: true };
    const off = kind === "discount" ? bill.discountOff : bill.giftOff;
    return { text: `−${amount(off)}`, tone: "good" };
  };
  const offer = pointsSpendableOn(bill.balance, cart?.total.amount ?? "0.000");
  const pointsSummary: Summary = bill.chosen.usePoints && bill.pointsApplied > 0
    ? { text: `−${amount(bill.pointsOff)}`, tone: "good" }
    : bill.balance > 0 && offer > 0
      ? { text: formatCount(bill.balance, locale), tone: "muted" }
      : { text: t("cart.savingsOpen"), tone: "muted" };
  const items: Array<{ key: SavingsMark; title: string; summary: Summary }> = [
    { key: "discount", title: t("cart.discountCode"), summary: codeSummary("discount") },
    { key: "gift", title: t("cart.giftCard"), summary: codeSummary("gift") },
    { key: "points", title: t("account.points"), summary: pointsSummary },
  ];
  const openTitle = items.find(item => item.key === open)?.title;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-[15px] font-extrabold">{t("cart.savingsHeading")}</h2>
      {/* Three round icons, on the owner's word; each opens its own box under
          the row, one at a time, and a press on the open one folds it. */}
      <div className="mt-3 grid grid-cols-3 gap-1 sm:flex sm:flex-wrap sm:gap-3">
        {items.map(item => {
          const face = savingsFace(item.key);
          const isOpen = open === item.key;
          const badge = item.summary.tone === "good" ? "done" : item.summary.tone === "bad" ? "problem" : null;
          return (
            <button
              key={item.key}
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => { pressHaptic(); focusNext.current = !isOpen; setOpen(isOpen ? null : item.key); }}
              className="flex min-w-0 flex-col items-center rounded-2xl px-0.5 pb-1 pt-1.5 sm:w-24"
            >
              <RoundFace fill={face.fill} ring={isOpen} badge={badge}>{face.mark}</RoundFace>
              <RoundLabel
                title={item.title}
                note={item.summary.code ? <bdi dir="ltr">{item.summary.text}</bdi> : item.summary.text}
                tone={item.summary.tone}
              />
            </button>
          );
        })}
      </div>
      <Unfold open={open !== null} id={panelId}>
        <div ref={panel} role="group" aria-label={openTitle} className="mt-3 rounded-2xl bg-[#f6f8fb] p-3">
          {openTitle ? <p className="mb-2 text-[13px] font-bold text-[#0a285a]">{openTitle}</p> : null}
          {open === "discount" ? <CodeBox kind="discount" bill={bill} />
            : open === "gift" ? <CodeBox kind="gift" bill={bill} />
            : open === "points" ? <PointsSwitch bill={bill} />
            : null}
        </div>
      </Unfold>
    </section>
  );
}

type Summary = { text: string; tone: "muted" | "good" | "bad"; code?: boolean };

function CodeBox({ kind, bill }: { kind: "discount" | "gift"; bill: ReturnType<typeof useSavingsBill> }) {
  const { t, tError } = useTranslation();
  const ask = useConfirmRemoval();
  const money = useMoney();
  const { cart, skip } = useCart();
  const utils = trpc.useUtils();
  const fieldId = useId();
  const held = kind === "discount" ? bill.chosen.code : bill.chosen.giftCard;
  const quote = kind === "discount" ? bill.codeQuote : bill.giftQuote;
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<{ key: MessageKey; good?: boolean } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const apply = async () => {
    const typed = draft.trim();
    if (!typed || !cart || checking) return;
    pressHaptic();
    setChecking(true);
    setNote(null);
    setFailure(null);
    try {
      const answer = await utils.orders.quoteVoucher.fetch({ cartId: cart.id, code: typed, skip });
      if (!answer.ok) {
        setNote({ key: answer.reason });
        return;
      }
      const into = answer.kind === "gift" ? "giftCard" : "code";
      const already = into === "giftCard" ? bill.chosen.giftCard : bill.chosen.code;
      /* One of each per order: a second waits for the first to come off. */
      if (already && normaliseCode(already) !== normaliseCode(typed)) {
        setNote({ key: "cart.oneEach" });
        return;
      }
      setSavings(cart.id, { [into]: typed });
      setDraft("");
      if ((answer.kind === "gift") !== (kind === "gift")) setNote({ key: answer.kind === "gift" ? "cart.codeIsGift" : "cart.giftIsCode", good: true });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "");
    } finally {
      setChecking(false);
    }
  };

  const remove = async () => {
    if (!cart) return;
    pressHaptic();
    /* Asks first, on the owner's word. */
    const named = isolate(normaliseCode(held) || held);
    const sure = await ask(kind === "discount"
      ? { title: t("remove.codeTitle"), body: t("remove.orderCodeBody", { code: named }) }
      : { title: t("remove.giftTitle"), body: t("remove.giftBody", { code: named }) });
    if (!sure) return;
    setSavings(cart.id, kind === "discount" ? { code: "" } : { giftCard: "" });
    setNote(null);
  };

  const good = quote.data?.ok ? quote.data : null;
  const refused = held && quote.data && !quote.data.ok ? quote.data.reason : null;
  const label = t(kind === "discount" ? "cart.discountCode" : "cart.giftCard");
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  return (
    <div>
      <label htmlFor={fieldId} className="sr-only">{label}</label>
      {held ? (
        <div className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${refused ? "border-[#f0c8c2] bg-[#fdf1ef]" : "border-[#cfe3cf] bg-[#f1f8f1]"}`}>
          {quote.isFetching && !good ? <LoaderCircle className="size-4 shrink-0 animate-spin text-[#536b8c]" aria-hidden />
            : refused ? <X className="size-4 shrink-0 text-[#8c2f22]" aria-hidden />
            : <Check className="size-4 shrink-0 text-[#2f5d33]" aria-hidden />}
          <span className="min-w-0 flex-1">
            <bdi dir="ltr" className="block truncate text-[14px] font-extrabold text-[#0a285a]">{normaliseCode(held) || held}</bdi>
            <span role="status" className={`block text-[12px] font-semibold leading-5 ${refused ? "text-[#8c2f22]" : "text-[#2f5d33]"}`}>
              {refused ? t(refused)
                : quote.error ? tError(quote.error.message)
                : good?.kind === "discount" ? t("cart.codeTakesOff", { amount: amount(bill.discountOff) })
                : good?.kind === "gift" ? t("cart.giftPays", { amount: amount(bill.giftOff), left: amount(subtractMoney(good.remaining, bill.giftOff)) })
                : null}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void remove()}
            aria-label={t("cart.removeCode", { code: normaliseCode(held) || held })}
            className="tap-target -m-1 grid size-9 shrink-0 place-items-center rounded-full text-[#536b8c] hover:bg-[#0a285a]/[.06]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={event => { event.preventDefault(); void apply(); }}
        >
          <input
            id={fieldId}
            dir="ltr"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            value={draft}
            onChange={event => { setDraft(event.target.value); setNote(null); setFailure(null); }}
            placeholder={t(kind === "discount" ? "checkout.voucherPlaceholder" : "cart.giftCardPlaceholder")}
            aria-describedby={note || failure !== null ? `${fieldId}-note` : undefined}
            className="glass-field h-11 min-w-0 flex-1 rounded-xl px-3.5 text-[15px] font-bold uppercase placeholder:normal-case placeholder:font-normal"
          />
          <button
            type="submit"
            disabled={!draft.trim() || checking}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[#0a285a] px-4 text-[14px] font-bold text-white hover:bg-[#0d3372] disabled:opacity-50"
          >
            {checking ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t("checkout.voucherApply")}
          </button>
        </form>
      )}
      {note || failure !== null ? (
        <p id={`${fieldId}-note`} role="status" className={`mt-2 text-[13px] font-semibold ${note?.good ? "text-[#2f5d33]" : "text-[#8c2f22]"}`}>
          {note ? t(note.key) : failure && isMessageKey(failure) ? t(failure) : tError(failure ?? "")}
        </p>
      ) : null}
    </div>
  );
}

function PointsSwitch({ bill }: { bill: ReturnType<typeof useSavingsBill> }) {
  const { t, locale } = useTranslation();
  const money = useMoney();
  const { cart } = useCart();
  const { isAuthenticated } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const labelId = useId();
  const offer = pointsSpendableOn(bill.balance, cart?.total.amount ?? "0.000");
  const on = bill.chosen.usePoints && bill.balance > 0;
  /* The row above says it; this names the switch to a screen reader. */
  const heading = <span id={labelId} className="sr-only">{t("account.points")}</span>;

  if (!isAuthenticated) {
    return (
      <div>
        {heading}
        <p className="text-[13px] leading-5 ink-muted">
          {t("cart.pointsSignIn")}{" "}
          <button type="button" onClick={() => setSigningIn(true)} className="font-bold text-[#0a285a] underline underline-offset-2">{t("header.signIn")}</button>
        </p>
        {signingIn ? createPortal(<Suspense fallback={null}><AuthDialog open onClose={() => setSigningIn(false)} /></Suspense>, document.body) : null}
      </div>
    );
  }
  if (!bill.balanceKnown) {
    return <div>{heading}<span aria-hidden className="block h-4 w-40 animate-pulse rounded bg-[#e7edf5]" /></div>;
  }
  if (bill.balance <= 0 || offer <= 0) {
    return (
      <div>
        {heading}
        <p className="text-[13px] leading-5 ink-muted">
          {t("cart.noPoints")}{" "}
          <Link href="/account/wallet" className="font-bold text-[#0a285a] underline underline-offset-2">{t("cart.howToEarn")}</Link>
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 flex-1">
        {heading}
        <span className="block text-[13px] leading-5 ink-muted">
          {t("checkout.usePoints", { points: formatCount(offer, locale), value: money({ amount: spendValue(offer), currencyCode: "KWD" }) })}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        onClick={() => { pressHaptic(); if (cart) setSavings(cart.id, { usePoints: !on }); }}
        className={`relative h-8 w-[52px] shrink-0 rounded-full transition-colors ${on ? "bg-[#0a285a]" : "bg-[#c9d3e1]"}`}
      >
        <span aria-hidden className={`absolute top-1 size-6 rounded-full bg-white shadow transition-[inset-inline-start] ${on ? "start-[24px]" : "start-1"}`} />
      </button>
    </div>
  );
}
