/**
 * The bag: the drawer, and the parts the `/cart` page draws too.
 *
 * The drawer is mounted once in App rather than on the home page, because the
 * cart button follows the shopper across the storefront and a button that
 * opens nothing on four pages out of six is worse than no button. The page
 * exists because a drawer has no address — it cannot be linked, and on a
 * phone Back closed nothing and left the shop. Both draw the same lines and
 * the same summary from here, so the two cannot disagree about a bag.
 */
import { lineTitle, storeName } from "@/lib/lineTitle";
import { useCart } from "@/contexts/CartContext";
import { Thumb } from "@/components/product/Thumb";
import { MeasureLabel } from "@/components/product/UnitPrice";
import { MAX_QUANTITY } from "@/components/cart/QuantityStepper";
import { LineMenu } from "@/components/cart/LineMenu";
import { isDefaultVariantTitle } from "@shared/commerce/fromInventory";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { useOverlay } from "@/hooks/useOverlay";
import { ArrowRight, Check, ChevronRight, Minus, Plus, ShoppingBag, Store, Trash2, Truck, X } from "lucide-react";
import { Link } from "wouter";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { CARD } from "@/components/layout/Page";
import { bagGroups, freeDeliveryProgress, type BagGroup } from "@/lib/bagGroups";
import type { CartItem } from "@shared/commerce/types";
import type { MessageKey } from "@shared/i18n/dictionary";
import { isDeliverySpeed } from "@shared/commerce/deliverySpeed";
import { lineCeiling, quantityDraft, shortLines, typedQuantity } from "@shared/commerce/typedQuantity";
import { MAX_LINE_QUANTITY } from "@shared/commerce/types";

/** While a stored bag loads or the first item is being added: never "empty" before it knows. */
export function BagSettling() {
  const { t } = useTranslation();
  return (
    <div role="status" className="flex flex-1 flex-col gap-4">
      {[0, 1].map(row => (
        <div key={row} aria-hidden className="flex gap-3 border-b border-[#d5dfeb] pb-4">
          <div className="size-20 shrink-0 animate-pulse rounded-xl bg-[#e7edf5]" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 w-2/3 animate-pulse rounded bg-[#e7edf5]" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-[#e7edf5]" />
          </div>
        </div>
      ))}
      <p className="text-center text-[12px] font-bold ink-muted">{t("cart.loading")}</p>
    </div>
  );
}

export function BagEmpty({ onBrowse, heading = "h3" }: { onBrowse: () => void; heading?: "h2" | "h3" }) {
  const { t } = useTranslation();
  const Heading = heading;
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-[#e7edf5] text-[#0a285a]"><ShoppingBag className="size-7" /></div>
      <Heading className="mt-5 text-lg font-extrabold text-[#0a285a]">{t("cart.empty")}</Heading>
      <p className="mt-2 text-sm leading-6 text-[#536b8c]">{t("cart.emptyNote")}</p>
      <button onClick={onBrowse} className="glass glass-navy pressable mt-6 rounded-full px-5 py-3 text-xs font-extrabold">{t("cart.keepBrowsing")}</button>
    </div>
  );
}

/**
 * The lines, by store: each store's lines together, under its name, with what
 * its delivery costs — or what to add for it to cost nothing — right beside
 * them (`bagGroups`), because each store charges its own and a figure under
 * the total cannot say which lines it is for. `page` draws each store as a
 * card of its own; the drawer draws them as sections of one list.
 *
 * Never greyed out while the server answers: the bag changes on the press and
 * sends the presses in order.
 */
export function BagLines({ layout = "drawer" }: { layout?: "drawer" | "page" }) {
  const { cart } = useCart();
  const { t, isArabic } = useTranslation();
  if (!cart) return null;
  const groups = bagGroups(cart);
  const onPage = layout === "page";
  return (
    <div className={onPage ? "space-y-3" : "space-y-6"}>
      {/* The basket somebody forgot (3.1.17), said where they will see it
          rather than in an email nobody can send. A count and an age, never
          a total: the bag is re-priced on every read, and quoting a figure
          that has since moved is the shop arguing with its own page. */}
      {cart.recovery.remind ? (
        <div className="rounded-2xl border border-[#f0d3c6] bg-[#fdf3ee] px-4 py-3">
          <p className="text-[13px] font-extrabold text-[#0a285a]">{cart.recovery.itemCount === 1 ? t("cart.recoveryTitleOne") : t("cart.recoveryTitle", { count: cart.recovery.itemCount })}</p>
          <p className="mt-0.5 text-[12px] leading-5 ink-muted">{cart.recovery.hours >= 48 ? t("cart.recoveryNoteDays", { days: Math.floor(cart.recovery.hours / 24) }) : t("cart.recoveryNote", { hours: cart.recovery.hours })}</p>
        </div>
      ) : null}
      {groups ? groups.map(group => {
        const name = storeName({ vendorName: group.store.name, vendorNameAr: group.store.nameAr }, isArabic);
        return (
          /* A group, not a section: a named section is a page landmark, and
             inside the drawer's dialog that made the skip link stray content. */
          <div key={group.key} role="group" aria-label={t("browse.soldBy", { name })} className={onPage ? `${CARD} overflow-hidden` : ""}>
            <StoreHeading group={group} name={name} padded={onPage} />
            <div className={`divide-y divide-[#eef1f5] ${onPage ? "px-4" : ""}`}>
              {group.items.map(item => <BagLine key={item.lineId} item={item} />)}
            </div>
          </div>
        );
      }) : (
        <div className={`divide-y divide-[#eef1f5] ${onPage ? `${CARD} px-4` : ""}`}>
          {cart.items.map(item => <BagLine key={item.lineId} item={item} />)}
        </div>
      )}
    </div>
  );
}

/**
 * A store's name, which opens its page, and each of its parcels: what it
 * costs, free in green, and while there is a threshold left to reach, how
 * much more and how far along — the server's own figures (`goods`, `toFree`).
 * A store with a fast line or a line for another door has more than one
 * parcel, and each says which it is.
 */
function StoreHeading({ group, name, padded }: { group: BagGroup; name: string; padded: boolean }) {
  const { syncing, closeCart } = useCart();
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <div className={padded ? "border-b border-[#eef1f5] px-4 pb-3 pt-3" : "border-b border-[#d5dfeb] pb-3"}>
      <Link
        href={`/stores/${encodeURIComponent(group.store.slug)}`}
        onClick={closeCart}
        className="pressable -mx-1.5 inline-flex min-h-9 max-w-full items-center gap-2 rounded-lg px-1.5 text-[#0a285a]"
      >
        <Store className="size-4 shrink-0" aria-hidden />
        <span className="truncate text-[14px] font-extrabold">{t("browse.soldBy", { name })}</span>
        <ChevronRight className="size-4 shrink-0 ink-muted rtl:-scale-x-100" aria-hidden />
      </Link>
      {group.delivery.map(row => {
        const fast = row.choice === "fast";
        const cost = row.free
          ? t(fast ? "cart.storeFastDeliveryFree" : "cart.storeDeliveryFree")
          : t(fast ? "cart.storeFastDelivery" : "cart.storeDelivery", { fee: money(row.fee) });
        const progress = freeDeliveryProgress(row);
        return (
          <div key={`${row.destinationLabel ?? ""}|${row.choice ?? ""}`} className={`mt-1.5 transition-opacity ${syncing ? "opacity-50" : ""}`}>
            <p className={`flex items-center gap-1.5 text-[13px] font-semibold ${row.free ? "text-[#2f5d33]" : "text-[#404553]"}`}>
              {row.free ? <Check className="size-4 shrink-0" aria-hidden /> : <Truck className="size-4 shrink-0" aria-hidden />}
              <span dir="auto">{row.destinationLabel ? `${t("address.sendingTo", { label: row.destinationLabel })} · ` : ""}{cost}</span>
            </p>
            {row.toFree && progress !== null ? (
              <>
                <p className="mt-1 text-[12px] font-bold ink-accent">{t("cart.storeToFree", { amount: money(row.toFree) })}</p>
                <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e7edf5]">
                  <div className="h-full rounded-full bg-[#0a285a]" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One line: its photo and name (both to the product), what it is and what it
 * costs under the name, then its trip and its stepper. The total sits under
 * the name rather than at the stepper's end, because on a 320px phone the two
 * did not fit on one line and the price was cut at the card's edge.
 */
function BagLine({ item }: { item: CartItem }) {
  const { cart, updateQuantity, removeItem, closeCart } = useCart();
  const { t, isArabic } = useTranslation();
  const money = useMoney();
  const title = lineTitle(item, isArabic);
  /* How many this line may hold, and whether the bag asks for more of its
     variant than there is — said under the stepper, before checkout. */
  const lines = cart?.items ?? [item];
  const ceiling = lineCeiling(item, lines);
  const left = shortLines(lines).get(item.lineId);
  const href = `/products/${encodeURIComponent(item.productHandle)}`;
  return (
    <div className="flex gap-3 py-4">
      {/* The photo is the same place as the name, so it is hidden from the
          keyboard and a screen reader rather than read as a second link. */}
      <Link href={href} onClick={closeCart} tabIndex={-1} aria-hidden className="size-[72px] shrink-0 overflow-hidden rounded-xl border border-[#eef1f5] bg-[#f4f6f9] min-[360px]:size-[84px]">
        <Thumb src={item.image?.url} alt={item.image?.altText ?? title} className="size-full object-cover" icon={<ShoppingBag className="size-5" />} />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2">
          <div className="min-w-0">
            <Link href={href} onClick={closeCart} dir="auto" className="line-clamp-2 text-sm font-extrabold leading-5 text-[#0a285a] hover:underline">{title}</Link>
            {!isDefaultVariantTitle(item.variantTitle) && <p dir="auto" className="mt-0.5 text-[12px] text-[#536b8c]">{item.variantTitle}</p>}
            {/* The extras this line carries (3.1.2), named rather than folded
                silently into the total — somebody who ticked a fitting
                should be able to see they did. */}
            {(item.addons ?? []).map(addon => (<p key={addon.id} dir="auto" className="mt-0.5 text-[12px] ink-accent">+ {addon.label}</p>))}
            {/* Which set made this line cheaper (3.3.11) — a lower
                figure with no explanation is one a shopper cannot check. */}
            {item.bundleName ? <p dir="auto" className="mt-0.5 text-[12px] ink-accent">{item.bundleName}</p> : null}
            {/* Where this one is going (3.2.6), when it is not going where the
                rest is. Read-only here: the picker belongs at checkout,
                beside the address it is an exception to. */}
            {item.destination ? <p dir="auto" className="mt-0.5 text-[12px] ink-muted">{t("address.sendingTo", { label: item.destination.label })}</p> : null}
            <p className="mt-1.5 text-[15px] font-extrabold text-[#0a285a]">{money(item.lineTotal)}</p>
            {/* What one costs, once there is more than one — the total alone
                leaves somebody dividing in their head. */}
            {item.quantity > 1 ? <p className="text-[12px] ink-muted">{t("cart.each", { price: money(item.unitPrice) })}</p> : null}
            {/* A price this shopper agreed with the seller (3.1.13), named as what
                it is. Never a strikethrough and never a percentage badge: those
                are the machinery of an advertised saving, which needs a Ministry
                of Commerce permit, and this is a private answer to one person. */}
            {item.agreedFrom ? <p className="mt-0.5 text-[11px] font-bold ink-accent">{t(item.priceReason === "member" ? "membership.priceFrom" : "offers.agreedFrom", { price: money(item.agreedFrom) })}</p> : null}
            {/* "1.5 kg" beside a quantity of 6. Nothing for a counted line. */}
            <MeasureLabel measure={item.measure} quantity={item.quantity} className="text-[12px] ink-muted" />
          </div>
          {/* What else can be done with the line — save it for later, move
              it to a wishlist, share it, open it, take it out (`LineMenu`). */}
          <LineMenu item={item} title={title} />
        </div>
        {/* Fast or regular (3.2.5), only where the store offers fast. */}
        {item.fastDelivery ? <SpeedChoice item={item} title={title} /> : null}
        {/* A thumb's size under a coarse pointer (40px a side), the
            old 28px under a mouse, where the drawer is narrow. */}
        <div className="mt-3 inline-flex items-center rounded-full border border-[#d5dfeb] bg-white">
          {/* At one the minus is the bin: taking the last one out is what
              the press does, and the menu above says it in words too. */}
          {item.quantity > 1 ? (
            <button onClick={() => void updateQuantity(item.lineId, item.quantity - 1).catch(() => undefined)} aria-label={t("cart.decrease", { name: title })} className="grid size-10 place-items-center rounded-full text-[#0a285a] disabled:opacity-40 pointer-fine:size-7"><Minus className="size-3.5 pointer-fine:size-3" aria-hidden /></button>
          ) : (
            <button onClick={() => void removeItem(item.lineId).catch(() => undefined)} aria-label={t("cart.remove", { name: title })} className="grid size-10 place-items-center rounded-full text-[#0a285a] hover:text-[#c2362a] pointer-fine:size-7"><Trash2 className="size-3.5 pointer-fine:size-3" aria-hidden /></button>
          )}
          <LineQuantity item={item} title={title} ceiling={ceiling} />
          <button disabled={item.quantity >= ceiling} onClick={() => void updateQuantity(item.lineId, item.quantity + 1).catch(() => undefined)} aria-label={t("cart.increase", { name: title })} className="grid size-10 place-items-center rounded-full text-[#0a285a] disabled:opacity-40 pointer-fine:size-7"><Plus className="size-3.5 pointer-fine:size-3" aria-hidden /></button>
        </div>
        {left !== undefined ? (
          <p role="status" className="mt-2 text-[12px] font-bold text-[#b42318]">
            {left === 0 ? t("cart.lineSoldOut") : t("cart.lineShort", { count: left })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The number between the minus and the plus, which is a box, on the owner's
 * word: a press on it selects the number and opens the number keypad, and
 * what is typed is the line's quantity once the box is left or Enter is
 * pressed — so twenty is two keys, not nineteen presses of the plus.
 * `typedQuantity` reads it (Arabic-Indic digits folded, zero takes the line
 * out as the bin does, over the ceiling is held to it and said); anything
 * that is not a whole number changes nothing and Escape puts the number back.
 * It is always an input rather than a number that turns into one, because a
 * phone opens its keyboard only for a field focused by the press itself.
 */
function LineQuantity({ item, title, ceiling }: { item: CartItem; title: string; ceiling: number }) {
  const { updateQuantity, removeItem } = useCart();
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  /* The press that focused the box would put the caret where it landed and
     undo the selection; that one press keeps the whole number selected. */
  const justFocused = useRef(false);
  const commit = () => {
    const text = draft;
    setDraft(null);
    if (cancelled.current || text === null) {
      cancelled.current = false;
      return;
    }
    const typed = typedQuantity(text, ceiling);
    if (!typed) return;
    if (typed.kind === "remove") {
      void removeItem(item.lineId).catch(() => undefined);
      return;
    }
    /* Held to what there is, or to the line ceiling — each said as what it is. */
    if (typed.capped) toast(ceiling < MAX_LINE_QUANTITY ? t("cart.onlyAvailable", { count: ceiling }) : t("cart.atMost", { count: String(MAX_QUANTITY) }));
    if (typed.quantity !== item.quantity) void updateQuantity(item.lineId, typed.quantity).catch(() => undefined);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      enterKeyHint="done"
      autoComplete="off"
      aria-label={t("cart.quantityOf", { name: title })}
      value={draft ?? String(item.quantity)}
      onFocus={event => {
        setDraft(String(item.quantity));
        event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
        justFocused.current = true;
      }}
      onMouseUp={event => {
        if (!justFocused.current) return;
        justFocused.current = false;
        event.preventDefault();
      }}
      onChange={event => setDraft(quantityDraft(event.target.value))}
      onKeyDown={event => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={commit}
      className="line-quantity h-8 w-10 rounded-lg bg-[#0a285a]/[.06] text-center text-[14px] font-extrabold tabular-nums text-[#0a285a] outline-none focus:bg-white focus:ring-2 focus:ring-[#0a285a] pointer-fine:h-6 pointer-fine:w-8 pointer-fine:text-xs"
    />
  );
}

/**
 * Regular or fast for one line (3.2.5): two presses in a named group, each
 * saying what it costs, so the choice and its price are read together. Fast
 * from one store to one door is its own parcel, charged its own fee, which the
 * summary below then shows as its own row.
 */
function SpeedChoice({ item, title }: { item: CartItem; title: string }) {
  const { cart, setDeliveryChoice } = useCart();
  const { t } = useTranslation();
  const money = useMoney();
  const fast = item.deliveryChoice === "fast";
  /* A member's fast trip is NetLet's to carry too (4.1), so it says free. */
  const fastLabel = cart?.delivery.memberFree ? t("delivery.fastFreeMember") : t("delivery.fastFor", { fee: money(item.fastDelivery!.fee) });
  const speed = item.fastDelivery?.speed;
  const option = (choice: "regular" | "fast", label: string) => (
    <button
      type="button"
      aria-pressed={(choice === "fast") === fast}
      onClick={() => void setDeliveryChoice(item.lineId, choice).catch(() => undefined)}
      className={`min-h-9 rounded-xl px-2.5 text-[12px] font-bold transition pointer-fine:min-h-7 ${(choice === "fast") === fast ? "bg-[#0a285a] text-white" : "text-[#0a285a]"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label={t("delivery.choiceFor", { name: title })} className="mt-2.5 flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-2xl border border-[#d5dfeb] bg-white p-0.5">
      {option("regular", t("delivery.regular"))}
      {option("fast", fastLabel)}
      {fast && speed && isDeliverySpeed(speed) ? <span className="px-2 text-[11px] ink-muted">{t(`speed.${speed}` as MessageKey)}</span> : null}
    </div>
  );
}

/**
 * Delivery per seller, the totals, and the way to checkout. While a press is
 * on its way the delivery and the total are the server's last, so they are
 * drawn fainter and the region says it is busy until the answer lands.
 */
export function BagSummary({ checkoutRef, heading = false, onCheckout }: {
  checkoutRef?: (node: HTMLButtonElement | null) => void;
  heading?: boolean;
  /** What Checkout does instead of going straight there — the cart page asks for an address first. */
  onCheckout?: () => void;
} = {}) {
  const { cart, syncing, proceedToCheckout } = useCart();
  const { t, isArabic } = useTranslation();
  const money = useMoney();
  if (!cart) return null;
  const updating = syncing ? "opacity-50" : "";
  /* Drawn by store, each store's delivery is beside its lines already. */
  const perStore = bagGroups(cart) ? [] : cart.delivery.perVendor;
  return (
    <div aria-busy={syncing}>
      {heading ? <h2 className="mb-3 text-[17px] font-extrabold text-[#0a285a]">{t("checkout.orderSummary")}</h2> : null}
      {/* Delivery per seller (3.2.4), each named. A basket from three shops
          is three parcels, and one blended figure hides which seller is
          expensive. Sellers who charge nothing are left out entirely —
          a row reading "Free" for every shop is noise. */}
      {perStore.filter(row => !row.free || row.toFree).map(row => (
        <div key={`${row.vendorId ?? row.vendorName}|${row.destinationLabel ?? ""}|${row.choice ?? ""}`} className="mb-2 flex items-baseline justify-between gap-3 text-[12px]">
          <span className="ink-muted" dir="auto">
            {row.destinationLabel ? t("address.deliveryTo", { name: storeName(row, isArabic), label: row.destinationLabel }) : t("cart.deliveryFrom", { name: storeName(row, isArabic) })}
            {row.choice === "fast" ? <> · {t("delivery.fastTag")}</> : null}
          </span>
          <span className={`shrink-0 font-bold text-[#0a285a] transition-opacity ${updating}`}>{row.free ? t("cart.deliveryFree") : money(row.fee)}</span>
        </div>
      ))}
      {/* The nudge, only while it is one: a threshold nobody can see is just
          a higher price with a rumour attached. And with a basket going to
          two doors it has to say *which* door: one seller can have two
          parcels, and a nudge that does not name the parcel points at
          the wrong one half the time. */}
      {perStore.filter(row => row.toFree).map(row => (
        <p key={`tofree-${row.vendorId}|${row.destinationLabel ?? ""}`} className="mb-2 text-[12px] font-bold ink-accent" dir="auto">
          {row.destinationLabel ? t("address.toFreeAt", { amount: money(row.toFree!), name: storeName(row, isArabic), label: row.destinationLabel }) : t("cart.deliveryToFree", { amount: money(row.toFree!), name: storeName(row, isArabic) })}
        </p>
      ))}
      <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold text-[#536b8c]">{t("cart.subtotal")} <span className="font-normal">({t("cart.itemCount", { count: cart.itemCount })})</span></span><span className="shrink-0 font-bold text-[#0a285a]">{money(cart.subtotal)}</span></div>
      <div className="mt-1 flex items-center justify-between text-sm"><span className="font-semibold text-[#536b8c]">{t("cart.delivery")}</span><span className={`font-bold text-[#0a285a] transition-opacity ${updating}`}>{money(cart.delivery.total)}</span></div>
      {/* A member's free delivery (4.1), said with what it saved. */}
      {cart.delivery.memberWaived ? <p className="mt-1 text-[12px] font-bold text-[#0a285a]">{t("membership.deliveryWaived", { amount: money(cart.delivery.memberWaived) })}</p> : null}
      <div className="mt-2 flex items-center justify-between border-t border-[#d5dfeb] pt-2 text-sm"><span className="font-semibold text-[#536b8c]">{t("cart.total")}</span><span className={`text-lg font-extrabold text-[#0a285a] transition-opacity ${updating}`}>{money(cart.total)}</span></div>
      <p className="mt-2 text-[12px] leading-5 ink-muted">{t("cart.checkoutNote")}</p>
      <button ref={checkoutRef} onClick={onCheckout ?? proceedToCheckout} className="glass glass-accent pressable mt-4 flex w-full items-center justify-center gap-2 rounded-full px-5 py-4 text-xs font-extrabold">
        {t("cart.checkout")} <ArrowRight className="size-4 rtl:-scale-x-100" />
      </button>
    </div>
  );
}

export function BagDrawer() {
  const { cart, isOpen, closeCart, settling } = useCart();
  const { t } = useTranslation();
  useOverlay(isOpen, closeCart);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-[#061b3b]/35" onClick={closeCart}>
      <div role="dialog" aria-modal="true" aria-label={t("cart.title")} className="type-body ms-auto flex h-full w-full max-w-md flex-col bg-background shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#d5dfeb] px-6 py-5">
          <h2 className="text-xl font-extrabold text-[#0a285a]">{t("cart.title")}</h2>
          <button onClick={closeCart} aria-label={t("cart.close")} className="glass pressable grid size-10 shrink-0 place-items-center rounded-full"><X className="size-5" /></button>
        </div>
        {!cart?.items.length && settling ? (
          <div className="flex flex-1 flex-col px-6 py-5"><BagSettling /></div>
        ) : !cart?.items.length ? (
          <BagEmpty onBrowse={closeCart} />
        ) : (
          <>
            <div className="hide-scrollbar flex-1 overflow-y-auto px-6 py-5"><BagLines /></div>
            <div className="border-t border-[#d5dfeb] bg-white/70 px-6 py-5"><BagSummary /></div>
          </>
        )}
      </div>
    </div>
  );
}
