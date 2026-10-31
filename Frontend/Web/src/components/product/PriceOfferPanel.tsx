/**
 * "Ask for a better price."
 *
 * Requirement 3.1.13. A shopper names what they would pay, the seller answers,
 * and the agreed price applies to that shopper's bag and nobody else's.
 *
 * **It is absent unless the seller takes requests.** `offers.openOn` is a
 * public query about the *product* — nothing about the caller — so a signed-out
 * browser gets the same answer, and a shop that will never reply never draws
 * the button. That is the dead-control rule the notifications bell broke.
 *
 * **The state is a sentence, not a badge.** "Waiting on the seller", "The
 * seller agreed KWD 85.000 — yours for 2 more days": somebody coming back to a
 * page they asked from needs to know where it stands and when it runs out, and
 * a coloured pill says neither.
 *
 * **It is one line until it is pressed.** The whole form — price, quantity, a
 * note, Send — sat open under Buy now on every product that takes requests,
 * and on a phone it pushed the description and the specifications a screen
 * further down for the few who ask. A request already standing is shown open,
 * because that is something the shopper is waiting on.
 *
 * **It also opens from a line of the bag, on the owner's word** ("a discount
 * icon next to each individual product … applies exclusively to that row"):
 * `LineDiscount` draws it `embedded` in a sheet, open and with the price box
 * focused. What it agrees is the price of that variant for this shopper, so
 * it lowers that line and no other; a guest is offered the sign-in there.
 *
 * **The agreed price is never drawn as a struck-through discount.** The
 * strikethrough and the `−27%` badge are the machinery of an advertised
 * saving, which Kuwaiti law requires a Ministry of Commerce permit for. This
 * is a private answer to one shopper who asked, and it is shown as what it is.
 */
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Handshake, LoaderCircle } from "lucide-react";
import { ASK_WINDOW_DAYS, daysLeft, MAX_NOTE } from "@shared/commerce/priceOffers";
import type { MessageKey } from "@shared/i18n/dictionary";
import { useAuth } from "@/hooks/useAuth";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const STATE_HEADING: Record<string, MessageKey> = {
  pending: "offers.statusPending",
  offered: "offers.statusOffered",
  declined: "offers.statusDeclined",
  expired: "offers.statusExpired",
  withdrawn: "offers.statusWithdrawn",
  used: "offers.statusUsed",
};

export function PriceOfferPanel({ variantId, listPrice, embedded = false, onSignIn }: {
  variantId: string;
  listPrice: string;
  /** Drawn inside a sheet that is about it: always open, no heading of its own. */
  embedded?: boolean;
  /** Where a guest signs in, when the panel is somewhere that can offer it. */
  onSignIn?: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const { isAuthenticated } = useAuth();
  const utils = trpc.useUtils();
  const numericId = Number(variantId);

  const open = trpc.offers.openOn.useQuery(
    { variantIds: [numericId] },
    { enabled: Number.isFinite(numericId) && numericId > 0, staleTime: 5 * 60 * 1000 },
  );
  const mine = trpc.offers.mine.useQuery(
    { variantId: numericId },
    { enabled: isAuthenticated && Number.isFinite(numericId) && numericId > 0 },
  );

  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(embedded);
  const bodyId = useId();
  const fieldId = useId();
  const priceRef = useRef<HTMLInputElement>(null);
  /* Opening it is asking to type a price, so the box takes the keyboard. */
  const opened = useRef(embedded);
  useEffect(() => {
    if (expanded && opened.current) priceRef.current?.focus();
    opened.current = false;
  }, [expanded]);

  const refresh = () => {
    void utils.offers.mine.invalidate({ variantId: numericId });
    void utils.commerce.cart.invalidate();
  };

  const request = trpc.offers.request.useMutation({
    onSuccess: () => {
      setPrice("");
      setNote("");
      toast.success(t("offers.sent", { days: String(ASK_WINDOW_DAYS) }));
      refresh();
    },
    /* The server's key, translated here. A sentence assembled on the server
       would be an English one on an Arabic page. */
    onError: error => toast.error(t(error.message as MessageKey)),
  });

  const withdraw = trpc.offers.withdraw.useMutation({
    onSuccess: refresh,
    onError: error => toast.error(t(error.message as MessageKey)),
  });

  // Nothing at all when this seller does not take requests on this product.
  if (!open.data?.includes(numericId)) return null;

  const held = mine.data ?? null;
  const settled = held && ["declined", "expired", "withdrawn", "used"].includes(held.state);
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!price.trim() || request.isPending) return;
    request.mutate({ variantId: numericId, askedPrice: price.trim(), quantity, note: note.trim() || null });
  };

  const standing = Boolean(isAuthenticated && held && !settled);
  const icon = (
    <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-[#0a285a]/12 bg-[#0a285a]/8 text-[#0a285a]">
      <Handshake className="size-4" aria-hidden />
    </span>
  );

  const body = (
    <>
      {!isAuthenticated ? (
        <p className="mt-1 rounded-xl border border-[#d5dfeb] bg-white px-4 py-3 text-[13px] leading-6 text-[#404553]">
          <strong className="font-extrabold text-[#0a285a]">{t("offers.signInFirst")}</strong>
          <br />
          {t("offers.signInWhy")}
          {onSignIn ? (
            <>
              <br />
              <button
                type="button"
                onClick={onSignIn}
                className="glass glass-navy pressable mt-3 inline-flex min-h-11 items-center rounded-full px-5 text-xs font-extrabold"
              >
                {t("header.signIn")}
              </button>
            </>
          ) : null}
        </p>
      ) : held && !settled ? (
        <Standing offer={held} onWithdraw={() => withdraw.mutate({ offerId: held.id })} pending={withdraw.isPending} />
      ) : (
        <>
          {held ? (
            <p className="mt-1 text-[13px] font-bold text-[#404553]">
              {t(STATE_HEADING[held.state])}
              {held.vendorNote ? (
                <span dir="auto" className="block font-medium ink-muted">{t("offers.sellerSaid", { note: held.vendorNote })}</span>
              ) : null}
            </p>
          ) : null}

          <form onSubmit={submit} className={`${held ? "mt-4" : "mt-1"} grid gap-3 sm:grid-cols-[1fr_auto]`}>
            <div>
              <label htmlFor={`${fieldId}-price`} className="text-[12px] font-semibold ink-muted">
                {t("offers.yourPrice")}
              </label>
              {/*
                * `inputMode="decimal"` rather than `type="number"`: a number
                * input in Arabic refuses Arabic-Indic digits on some keyboards
                * and silently drops what was typed. `dir="ltr"` sets the typing
                * direction on the control, which is the one place `dir` on an
                * element is about a value rather than a block.
                */}
              <input
                id={`${fieldId}-price`}
                ref={priceRef}
                dir="ltr"
                inputMode="decimal"
                value={price}
                onChange={event => setPrice(event.target.value)}
                placeholder={listPrice}
                className="glass-field mt-1 w-full rounded-xl px-3.5 py-2.5 text-[15px] font-bold"
              />
              <p className="mt-1 text-[12px] ink-muted">{t("offers.listPrice", { price: amount(listPrice) })}</p>
            </div>
            <div>
              <label htmlFor={`${fieldId}-qty`} className="text-[12px] font-semibold ink-muted">
                {t("offers.quantity")}
              </label>
              <input
                id={`${fieldId}-qty`}
                dir="ltr"
                inputMode="numeric"
                value={quantity}
                onChange={event => setQuantity(Math.max(1, Math.min(999, Number(event.target.value) || 1)))}
                className="glass-field mt-1 w-full rounded-xl px-3.5 py-2.5 text-[15px] font-bold sm:w-24"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor={`${fieldId}-note`} className="text-[12px] font-semibold ink-muted">
                {t("offers.messageLabel")}
              </label>
              <textarea
                id={`${fieldId}-note`}
                dir="auto"
                rows={2}
                maxLength={MAX_NOTE}
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder={t("offers.messagePlaceholder")}
                className="glass-field mt-1 w-full resize-y rounded-xl px-3.5 py-2.5 text-[13px]"
              />
            </div>

            <button
              type="submit"
              disabled={!price.trim() || request.isPending}
              className="glass glass-navy pressable inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-xs font-extrabold disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2 sm:w-fit"
            >
              {request.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              {t(request.isPending ? "offers.sending" : "offers.send")}
            </button>
          </form>
        </>
      )}
    </>
  );
  if (embedded) return body;

  return (
    <section className="mt-6 rounded-[1.25rem] border border-[#d5dfeb] bg-white/60 p-2">
      {standing ? (
        <div className="flex items-center gap-2 p-3">
          {icon}
          <h2 className="text-sm font-extrabold text-[#0a285a]">{t("offers.heading")}</h2>
        </div>
      ) : (
        <h2>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => { opened.current = !expanded; setExpanded(open => !open); }}
            className="flex w-full items-center gap-2 rounded-2xl p-3 text-start"
          >
            {icon}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold text-[#0a285a]">{t("offers.heading")}</span>
              <span className="block text-[12px] font-normal leading-5 ink-muted">{t("offers.note")}</span>
            </span>
            <ChevronDown className={`size-5 shrink-0 ink-muted transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </h2>
      )}

      <div id={bodyId} hidden={!standing && !expanded} className="px-3 pb-3">
        {body}
      </div>
    </section>
  );
}

/** A request that is still live: where it stands, and when it runs out. */
function Standing({ offer, onWithdraw, pending }: {
  offer: { id: number; state: string; askedPrice: string; offeredPrice: string | null; expiresAt: Date | string | null; vendorNote: string | null; usedOnOrderId?: number | null };
  onWithdraw: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const amount = (value: string) => money({ amount: value, currencyCode: "KWD" });
  const left = daysLeft({ status: "offered", offeredPrice: offer.offeredPrice, expiresAt: offer.expiresAt, usedOnOrderId: null });

  return (
    <div className="mt-1 rounded-xl border border-[#d5dfeb] bg-white px-4 py-3.5">
      <p className="text-[13px] font-extrabold text-[#0a285a]">
        {offer.state === "offered" && offer.offeredPrice
          ? t("offers.statusOffered", { price: amount(offer.offeredPrice) })
          : t("offers.statusPending")}
      </p>
      <p className="mt-0.5 text-[12px] leading-5 ink-muted">
        {offer.state === "offered"
          /* "0 days left" on a price somebody can still spend would be a lie,
             so the last hours read as their own sentence rather than a zero. */
          ? left === null || left <= 1
            ? t("offers.statusOfferedToday")
            : t("offers.statusOfferedNote", { days: String(left) })
          : t("offers.statusPendingNote", {
              price: amount(offer.askedPrice),
              date: offer.expiresAt ? formatDate(offer.expiresAt) : "—",
            })}
      </p>
      {offer.vendorNote ? (
        <p dir="auto" className="mt-1.5 text-[12px] leading-5 text-[#404553]">
          {t("offers.sellerSaid", { note: offer.vendorNote })}
        </p>
      ) : null}
      <button
        onClick={onWithdraw}
        disabled={pending}
        className="glass pressable mt-3 inline-flex rounded-full px-4 py-2 text-[12px] font-extrabold disabled:opacity-50"
      >
        {t("offers.withdraw")}
      </button>
    </div>
  );
}
