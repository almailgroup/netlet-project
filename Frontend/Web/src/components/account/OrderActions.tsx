/**
 * The opened order as an after-sales centre, on the owner's word: "each
 * order's detail page should function as a complete after-sales service
 * center", with only the actions this order offers now.
 *
 * **Everything is the bar's, once items are chosen** (`ChosenBar`,
 * `selectionOffers`), on the owner's word ("remove all these 3 dot buttons;
 * instead put their options here — when you select all, it should show you
 * all the options, and when you select individually, it should show you the
 * options as well"). Chosen, an item can be tracked, returned or exchanged,
 * claimed on, lowered or cancelled before a driver has it, bought again,
 * rated and asked about; one item's act is drawn under that item
 * (`OrderLinePanel`), several over the items. Whatever is chosen, one item
 * included, the bar also has what only the whole order can have done: the
 * order's change form, its address and cancelling the order (on the owner's
 * word: "keep as many options as there is"; they waited for every item to be
 * chosen once). Each item had a ⋯ of its own for a while, and so did the
 * order.
 *
 * **Track, Payment and Receipt are not on the bar, on the owner's word** ("no
 * need inside the track because will show out side, no need payment because
 * we will control full payment for all order one time, no need receipt
 * because there will be one receipt for all"): where each item is, is drawn
 * under its photo; the way to pay is the whole order's, changed from the one
 * line saying how it is paid (`PaymentLine`); the receipt is the PDF at the
 * top.
 *
 * **The circles are out only while the order is being edited**, on the
 * owner's word ("when I came to this page no need to see it in this way …
 * add an icon like edit your order, once you click it, it will open like that
 * to control all or each one separately"): the order opens on its items
 * alone, and "Edit order" at the end of "In this order" brings the All
 * circle, the items' circles and the line saying what they are for; "Done",
 * or the bar's Close, puts them away with the choice. Outside editing a press
 * on an item opens its page on the shop (on the owner's word: "I cannot see
 * product details"); while editing it chooses the item, and one item chosen
 * offers View product on the bar.
 *
 * **Nothing here decides.** Each action is drawn from the server's own answer
 * about this order — `cancel` (`shopperCancelState`), `change` and
 * `changeAddress` (`Shared/commerce/orderChanges.ts`), each line's return
 * window, warranty eligibility and review eligibility — so the page offers
 * exactly what the API accepts, and the server asks every question again
 * under a lock when the button is pressed. Once a driver has collected part
 * of an order, receive it and return it — said in a sentence, never a button
 * that refuses.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  Check,
  Banknote,
  CircleX,
  CreditCard,
  Eye,
  House,
  LifeBuoy,
  MapPin,
  Package,
  PackageSearch,
  PencilLine,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Star,
  Truck,
  X,
  Zap,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { Thumb } from "@/components/product/Thumb";
import { ChoiceCircle } from "@/components/cart/ChoiceCircle";
import { GlassLayers, PhoneActionBar } from "@/components/layout/PhoneActionBar";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { TrackParcels } from "@/components/account/TrackParcels";
import { LineReturnForm, mayRequestReturn, REASON_LABEL, type Detail } from "@/components/account/LineReturn";
import { OrderModify } from "@/components/account/OrderModify";
import { OrderAddress } from "@/components/account/OrderAddress";
import { OrderPayment } from "@/components/account/OrderPayment";
import { HandoverCard, PaidOnlineNote } from "@/components/account/OrderHandover";
import { WarrantyClaims, WarrantyForm } from "@/components/account/OrderWarranty";
import { OrderHelp } from "@/components/account/OrderHelp";
import { ReceiptButton } from "@/components/account/OrderReceipt";
import { ItemStatus } from "@/components/account/OrderJourney";
import { useCart } from "@/contexts/CartContext";
import { useFeature } from "@/hooks/useFeature";
import { useTranslation } from "@/hooks/useTranslation";
import { useShortDayFormat } from "@/hooks/useDateFormat";
import { pressHaptic } from "@/lib/haptics";
import { trpc } from "@/lib/trpc";
import { MAX_RETURN_NOTE, RETURN_REASONS, type ReturnReason } from "@shared/commerce/returnRequests";
import { TRACK_STEPS, type ParcelTrack, type TrackPromise, type TrackStep } from "@shared/commerce/orderTracking";
import { orderProgress } from "@shared/commerce/orderProgress";
import type { OrderHelpAction } from "@shared/commerce/orderHelp";
import { chosenState, firstToRate, selectionOffers, type SelectionAction, type SelectionOffer } from "@shared/commerce/orderSelection";
import type { MessageKey } from "@shared/i18n/dictionary";

const STEP_LABEL: Record<TrackStep, MessageKey> = {
  placed: "track.placed",
  preparing: "track.preparing",
  onTheWay: "track.onTheWay",
  delivered: "track.delivered",
};

/** A store's name inside one of our sentences keeps its own direction. */
const isolate = (text: string) => `\u2068${text}\u2069`;

type Line = Detail["lines"][number];
type PanelKind = "track" | "refund" | "return" | "warranty" | "modify" | "address" | "payment" | "help";
/**
 * What is open, and which items it is about: for one item that item
 * (`lineId`, drawn under it); for several of the items the shopper chose,
 * those items (`lineIds`, drawn over the items).
 */
type Panel = { kind: PanelKind; lineId?: number; lineIds?: number[]; remove?: boolean; fromBar?: boolean };

type Controls = {
  reference: string;
  detail: Detail;
  panel: Panel | null;
  open: (panel: Panel) => void;
  close: () => void;
  done: () => void;
  act: (action: OrderHelpAction, lineId?: number) => void;
  rate: (lineId: number) => void;
  /** The items chosen by their circles, the cart's own (on the owner's word). */
  chosen: number[];
  /** Choosing an item opens the editing; putting one back does not close it. */
  choose: (lineIds: number[], on: boolean) => void;
  /** Whether the circles are out ("Edit order", on the owner's word). */
  editing: boolean;
  /** The circles away, with the choice: "Done" and the bar's Close. */
  stopEditing: () => void;
  /** Where an item's panel is drawn, so the bar can bring it into view. */
  panelId: (lineId?: number) => string;
};
const OrderControls = createContext<Controls | null>(null);

function useControls(): Controls {
  const controls = useContext(OrderControls);
  if (!controls) throw new Error("An order's menus are drawn inside OrderAfterSales.");
  return controls;
}

/**
 * The order's after-sales state, round its items: the All circle and what
 * the order's acts open, then `children` — the items, each with
 * `OrderLineChoice` and `OrderLinePanel` — the bar of the chosen items, and
 * the confirmation that cancels the whole order.
 */
export function OrderAfterSales({ reference, detail, trackFirst = false, refundFirst = false, onRate, children }: {
  reference: string;
  detail: Detail;
  trackFirst?: boolean;
  /** Opened from the list row's "Request a refund", or `&refund=1`: the form is open, in view and focused. */
  refundFirst?: boolean;
  /** Rate one item: its review form. */
  onRate: (lineId: number) => void;
  children: ReactNode;
}) {
  const { t, tError } = useTranslation();
  const utils = trpc.useUtils();
  const returnsOn = useFeature("returns");
  const ids = useId();
  const [, navigate] = useLocation();
  const { cartId, adoptCart, addItem } = useCart();
  const [panel, setPanel] = useState<Panel | null>(() =>
    refundFirst ? { kind: "refund" } : trackFirst || detail.steps.parcels.some(parcel => parcel.step === "onTheWay") ? { kind: "track" } : null,
  );
  const [asking, setAsking] = useState(false);
  /* The items chosen, kept to the ones the order still has. */
  const [picked, setPicked] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const chosen = picked.filter(id => detail.lines.some(line => line.id === id));
  const choose = (lineIds: number[], on: boolean) => {
    if (on) setEditing(true);
    setPicked(now => (on ? [...now.filter(id => !lineIds.includes(id)), ...lineIds] : now.filter(id => !lineIds.includes(id))));
  };
  const stopEditing = () => { setPicked([]); setEditing(false); };

  const refundable = returnsOn ? detail.lines.filter(line => mayRequestReturn(line, detail.returns)) : [];
  const claimable = returnsOn ? detail.lines.filter(line => line.warrantyEligibility.allowed) : [];
  const changeable = detail.change.changeable && detail.lines.some(line => line.changeable);

  /* Opened for the refund: the form is brought into view with its first box
     focused, since the press that asked for it is on the list above. */
  useEffect(() => {
    if (!refundFirst) return;
    const region = document.getElementById(`${ids}-panel`);
    region?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    region?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  }, [refundFirst, ids]);

  const refresh = () => {
    void utils.orders.get.invalidate({ reference });
    void utils.orders.list.invalidate();
    void utils.orders.onTheWay.invalidate();
  };
  const cancel = trpc.orders.cancel.useMutation({
    onSuccess: () => { setAsking(false); toast.success(t("orders.cancelDone")); refresh(); },
    onError: error => { setAsking(false); toast.error(tError(error.message)); refresh(); },
  });
  const again = trpc.orders.buyAgain.useMutation({
    onSuccess: async answer => {
      if (answer.cartId) await adoptCart(answer.cartId);
      if (answer.added > 0) {
        toast.success(t("orders.buyAgainDone", { count: answer.added }), {
          description: answer.skipped.length ? t("orders.buyAgainSkipped", { items: answer.skipped.map(skip => skip.title).join(", ") }) : undefined,
          action: { label: t("product.viewCart"), onClick: () => navigate("/cart") },
        });
      } else {
        toast.error(t("orders.buyAgainNone"));
      }
    },
    onError: error => toast.error(tError(error.message)),
  });

  /* The chosen items back in the bag, each at what was ordered of it and
     today's price; one that is no longer for sale is left out and counted. */
  const buyChosen = async (lineIds: number[]) => {
    const lines = detail.lines.filter(line => lineIds.includes(line.id) && line.variantId !== null);
    let added = 0;
    for (const line of lines) {
      try {
        await addItem(String(line.variantId), line.quantity, { reveal: false });
        added += 1;
      } catch {
        /* Sold out or gone: said in the count below. */
      }
    }
    if (added === 0) { toast.error(t("orders.buyAgainNone")); return; }
    choose(lineIds, false);
    toast.success(t("orders.buyAgainDone", { count: added }), {
      description: added < lineIds.length ? t("orders.buyAgainSomeLeft") : undefined,
      action: { label: t("product.viewCart"), onClick: () => navigate("/cart") },
    });
  };

  /* What an answer from NetLet AI points at: that panel, or that act — about
     the item it was asked from, when it was. */
  const act = (action: OrderHelpAction, lineId?: number) => {
    if (action === "cancel") { setAsking(true); return; }
    if (action === "buyAgain") { again.mutate({ reference, cartId }); return; }
    if (action === "rate") {
      const first = lineId ?? detail.lines.find(line => !line.review && line.reviewEligibility.allowed)?.id;
      if (first !== undefined) onRate(first);
      return;
    }
    const kind: PanelKind = action === "track" ? "track" : action === "refund" ? (lineId === undefined ? "refund" : "return")
      : action === "warranty" ? "warranty" : action === "modify" ? "modify" : "address";
    setPanel({ kind, lineId: kind === "address" || kind === "refund" ? undefined : lineId });
  };

  const panelId = (lineId?: number) => (lineId === undefined ? `${ids}-panel` : `${ids}-line-${lineId}`);
  const controls: Controls = {
    reference,
    detail,
    panel,
    /* A press on what is already open closes it; the bar always opens. */
    open: next => setPanel(current => (!next.fromBar && current && current.kind === next.kind && current.lineId === next.lineId && current.remove === next.remove && !current.lineIds ? null : next)),
    close: () => setPanel(null),
    /* What was done is done with the items it was about: the choice goes too. */
    done: () => { setPanel(null); stopEditing(); refresh(); },
    act,
    rate: onRate,
    chosen,
    choose,
    editing,
    stopEditing,
    panelId,
  };

  /* Opened from the bar, which floats over the page's foot: the panel is
     brought into view, its first box or button focused. */
  useEffect(() => {
    if (!panel?.fromBar) return;
    const frame = window.requestAnimationFrame(() => {
      const region = document.getElementById(panelId(panel.lineId));
      if (!region) return;
      region.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      region.querySelector<HTMLElement>("input, textarea, button")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  /* Said only while the order is still coming: an order that is over needs
     no sentence about why it cannot be cancelled. */
  const whyNot = !detail.cancel.cancellable && detail.cancel.reason !== "orders.cancelClosed" && !detail.steps.cancelled
    && detail.steps.parcels.some(parcel => parcel.step !== "delivered")
    ? detail.cancel.reason
    : null;

  const orderPanel = panel && panel.lineId === undefined ? panel : null;

  return (
    <OrderControls.Provider value={controls}>
      <div className="mb-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {/* Every item at once, the cart's All: the circle lines up with the
              items' own — out only while the order is being edited. */}
          <span className="flex min-h-11 min-w-0 items-center gap-1 pointer-fine:min-h-9">
            {editing ? (
              <span className="panel-in">
                <ChoiceCircle
                  state={chosenState(detail.lines.map(line => line.id), chosen)}
                  label={t("orders.chooseAllItems")}
                  onToggle={on => choose(detail.lines.map(line => line.id), on)}
                  className="-ms-2.5 pointer-fine:-ms-1.5"
                />
              </span>
            ) : null}
            <h4 className="text-[14px] font-extrabold text-[#0a285a]">{t("orders.inThisOrder")}</h4>
          </span>
          <span className="ms-auto flex items-center gap-2">
            {/* "Edit order" brings the circles; "Done" puts them away. */}
            <button
              type="button"
              onClick={() => { pressHaptic(); if (editing) stopEditing(); else setEditing(true); }}
              className={`${editing ? "glass-navy" : "glass"} type-control pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 pointer-fine:min-h-9`}
            >
              {editing ? <Check className="size-4" aria-hidden /> : <PencilLine className="size-4" aria-hidden />}
              {t(editing ? "orders.editDone" : "orders.editOrder")}
            </button>
            {/* The receipt as a PDF, at the top of the order under its title
                and its date, on the owner's word — it was at the order's foot. */}
            <ReceiptButton detail={detail} />
          </span>
        </div>
        {/* The bar is the one way to the order's acts: said while editing and
            nothing is chosen yet. */}
        {editing && chosen.length === 0 ? <p className="mt-1 text-[12px] leading-5 ink-muted">{t("orders.chooseHint")}</p> : null}
      </div>
      {whyNot ? <p className="mb-3 text-[12px] leading-5 ink-muted">{t(whyNot)}</p> : null}

      {/* Paid online (0086), and the code the driver scans at the door. */}
      <PaidOnlineNote detail={detail} />
      <PaymentLine />
      <HandoverCard detail={detail} />

      <WarrantyClaims detail={detail} onChanged={refresh} />

      <div id={`${ids}-panel`} className="mb-3 scroll-mt-4 empty:hidden">
        {orderPanel?.kind === "track" ? <OrderTracking reference={reference} detail={detail} lineIds={orderPanel.lineIds} /> : null}
        {orderPanel?.kind === "refund" && refundable.length > 0 ? (
          <RefundForm
            key={orderPanel.lineIds?.join(",") ?? "all"}
            reference={reference}
            lines={orderPanel.lineIds ? refundable.filter(line => orderPanel.lineIds?.includes(line.id)) : refundable}
            initial={orderPanel.lineIds}
            onDone={controls.done}
            onCancel={controls.close}
          />
        ) : null}
        {orderPanel?.kind === "warranty" && claimable.length > 0 ? (
          <WarrantyForm key={orderPanel.lineIds?.join(",") ?? "all"} reference={reference} detail={detail} lineIds={orderPanel.lineIds} onDone={controls.done} onCancel={controls.close} />
        ) : null}
        {orderPanel?.kind === "modify" && changeable ? (
          <OrderModify
            key={`${orderPanel.lineIds?.join(",") ?? "all"}-${orderPanel.remove ? "remove" : "change"}`}
            reference={reference}
            detail={detail}
            lineIds={orderPanel.lineIds}
            remove={orderPanel.remove}
            onDone={controls.done}
            onCancel={controls.close}
          />
        ) : null}
        {orderPanel?.kind === "address" && detail.changeAddress.changeable ? (
          <OrderAddress reference={reference} detail={detail} onDone={controls.done} onCancel={controls.close} />
        ) : null}
        {orderPanel?.kind === "payment" && detail.paymentChange.open ? <OrderPayment reference={reference} detail={detail} onCancel={controls.close} onMoved={refresh} /> : null}
        {orderPanel?.kind === "help" ? <OrderHelp reference={reference} items={helpItems(detail)} onAction={(action, lineId) => act(action, lineId)} onClose={controls.close} /> : null}
      </div>

      {children}

      {/* What can be done with the items chosen, and with the whole order once
          every item is, on the owner's word. */}
      <ChosenBar onBuyAgain={buyChosen} onCancelOrder={() => setAsking(true)} />

      <ConfirmDialog
        open={asking}
        title={t("orders.cancelAsk")}
        body={t("orders.cancelBody")}
        confirmLabel={t("orders.cancelOrder")}
        cancelLabel={t("orders.keepOrder")}
        tone="danger"
        pending={cancel.isPending}
        icon={<CircleX className="size-5" aria-hidden />}
        onConfirm={() => cancel.mutate({ reference })}
        onClose={() => setAsking(false)}
      />
    </OrderControls.Provider>
  );
}

/** What the bar opened for one item, under that item. */
export function OrderLinePanel({ line }: { line: Line }) {
  const { reference, detail, panel: current, close, done, act, panelId } = useControls();
  const panel = current && current.lineId === line.id ? current : null;
  /* Always drawn, empty while nothing is open, so the bar can bring it into view. */
  return (
    <div id={panelId(line.id)} className="mt-1 scroll-mt-4 empty:hidden">
      {panel?.kind === "track" ? <OrderTracking reference={reference} detail={detail} lineId={line.id} /> : null}
      {panel?.kind === "return" && mayRequestReturn(line, detail.returns) ? <LineReturnForm reference={reference} line={line} onDone={done} onCancel={close} /> : null}
      {panel?.kind === "warranty" && line.warrantyEligibility.allowed ? <WarrantyForm reference={reference} detail={detail} lineId={line.id} onDone={done} onCancel={close} /> : null}
      {panel?.kind === "modify" && detail.change.changeable && line.changeable ? (
        <OrderModify key={panel.remove ? "remove" : "quantity"} reference={reference} detail={detail} lineId={line.id} remove={panel.remove} onDone={done} onCancel={close} />
      ) : null}
      {panel?.kind === "help" ? <OrderHelp reference={reference} items={helpItems(detail)} lineId={line.id} onAction={(action, lineId) => act(action, lineId ?? line.id)} onClose={close} /> : null}
    </div>
  );
}

/**
 * The circle beside an item, the cart's own, on the owner's word ("when you
 * select a specific order, it should let you choose the product, just like in
 * the cart page"). What the chosen items allow is the bar's (`ChosenBar`).
 */
export function OrderLineChoice({ line }: { line: Line }) {
  const { t } = useTranslation();
  const { chosen, choose, editing } = useControls();
  const on = chosen.includes(line.id);
  /* Out only while the order is being edited (on the owner's word). */
  if (!editing) return null;
  return (
    <span className="panel-in self-start pt-1.5 pointer-fine:pt-3">
      <ChoiceCircle
        state={on ? "all" : "none"}
        label={t("select.item", { name: line.productTitle })}
        onToggle={next => choose([line.id], next)}
        className="-ms-2.5 pointer-fine:-ms-1.5"
      />
    </span>
  );
}

/** What a press inside the row does itself — the circle, a link, a button, a box. */
const OWN_PRESS = "a, button, input, select, textarea, label, summary, [role='button'], [role='link'], [role='checkbox'], [role='radio'], [contenteditable='true']";

/**
 * An item's row. **Outside editing, a press on it opens its page on the
 * shop**, on the owner's word ("I cannot see product details" from an order):
 * while the circles are put away nothing is being chosen, so the item is a
 * way to its product, as a cart's line is. Its name is the link the keyboard
 * and a screen reader meet (`OrderLineTitle`), its photo the same link for
 * the eye (`OrderLinePhoto`), and the rest of the row the pointer's and the
 * finger's larger target. A product the shop no longer shows has no page, and
 * its row opens nothing.
 *
 * **While editing, a press anywhere on it chooses it, or puts it back**, on
 * the owner's word ("when you tap on its name or anywhere near that specific
 * product, it should automatically choose it"); the circle stays the one
 * control the keyboard and a screen reader meet (`OrderLineChoice`), and one
 * item chosen offers View product on the bar. Either way a press on something
 * inside the row that does a thing of its own — a link, a review's button —
 * does that thing alone, and a press that ends a text selection selects.
 */
export function OrderLineRow({ line, children }: { line: Line; children: ReactNode }) {
  const { chosen, choose, editing } = useControls();
  const [, navigate] = useLocation();
  const on = chosen.includes(line.id);
  const href = productHref(line);
  const acts = editing || href !== null;
  return (
    <div
      data-chosen={on ? "" : undefined}
      onClick={event => {
        const target = event.target as Element | null;
        if (target?.closest(OWN_PRESS)) return;
        if ((window.getSelection?.()?.toString() ?? "") !== "") return;
        if (!editing) {
          if (href) navigate(href);
          return;
        }
        pressHaptic();
        choose([line.id], !on);
      }}
      className={`-mx-2 flex gap-2 rounded-2xl px-2 py-1.5 transition-colors duration-150 min-[360px]:gap-3 ${acts ? "cursor-pointer" : ""} ${
        on ? "bg-[#0a285a]/[.05]" : acts ? "hover:bg-[#0a285a]/[.06]" : ""
      }`}
    >
      {children}
    </div>
  );
}

/** An item's page on the shop, while the shop still shows it. */
function productHref(line: Line): string | null {
  return line.productHandle ? `/products/${encodeURIComponent(line.productHandle)}` : null;
}

/**
 * An item's name: outside editing, a link to its page on the shop — the one
 * the keyboard and a screen reader meet; while editing, words, since a press
 * there chooses the item.
 */
export function OrderLineTitle({ line }: { line: Line }) {
  const { editing } = useControls();
  const href = productHref(line);
  const className = "type-product line-clamp-2 pt-1.5 text-sm text-[#0a285a]";
  if (editing || !href) return <p dir="auto" className={className}>{line.productTitle}</p>;
  return (
    <p dir="auto" className={className}>
      <Link href={href} dir="auto" className="hover:underline">{line.productTitle}</Link>
    </p>
  );
}

/**
 * An item's photo: outside editing, the same link as its name, for the eye
 * alone (hidden from the keyboard and a screen reader, the card's rule: two
 * links to one place read twice).
 */
export function OrderLinePhoto({ line, children }: { line: Line; children: ReactNode }) {
  const { editing } = useControls();
  const href = productHref(line);
  if (editing || !href) return <>{children}</>;
  return <Link href={href} tabIndex={-1} aria-hidden className="block">{children}</Link>;
}

/**
 * How the whole order is paid, and the one place that is changed, on the
 * owner's word ("we will control full payment for all order one time"): it
 * was Payment on the bar, offered beside one chosen item as if an item could
 * be paid for apart. Drawn while the way to pay may still change
 * (`paymentChange.open`: cash, not paid online, something still coming); the
 * press opens the order's payment panel just under it, and closes it again.
 */
function PaymentLine() {
  const { t } = useTranslation();
  const { detail, panel, open } = useControls();
  if (!detail.paymentChange.open) return null;
  const opened = panel?.kind === "payment" && panel.lineId === undefined;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border border-[#e2e7ef] bg-white px-4 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-[#0a285a]">
        <Banknote className="size-[18px] shrink-0" aria-hidden />
        {t("orders.payOnDelivery")}
      </span>
      <button
        type="button"
        aria-expanded={opened}
        onClick={() => { pressHaptic(); open({ kind: "payment" }); }}
        className="glass type-control pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 pointer-fine:min-h-9"
      >
        <CreditCard className="size-4" aria-hidden />
        {t("orders.changePayment")}
      </button>
    </div>
  );
}

/** Each act's word on the bar — short, for a row of them — and its picture. */
const PICK_LABEL: Record<SelectionAction, MessageKey> = {
  view: "orders.pickView",
  return: "orders.pickReturn",
  refund: "orders.pickRefund",
  warranty: "orders.pickWarranty",
  quantity: "orders.pickQuantity",
  rate: "orders.pickRate",
  buyAgain: "orders.pickBuyAgain",
  help: "orders.pickHelp",
  cancelItems: "orders.pickCancelItem",
  modify: "orders.pickModify",
  address: "orders.pickAddress",
  cancelOrder: "orders.pickCancelOrder",
};
const PICK_ICON: Record<SelectionAction, ReactNode> = {
  view: <Eye className="size-[19px]" aria-hidden />,
  return: <RotateCcw className="size-[19px] rtl:-scale-x-100" aria-hidden />,
  refund: <RotateCcw className="size-[19px] rtl:-scale-x-100" aria-hidden />,
  warranty: <ShieldCheck className="size-[19px]" aria-hidden />,
  quantity: <PencilLine className="size-[19px]" aria-hidden />,
  rate: <Star className="size-[19px]" aria-hidden />,
  buyAgain: <ShoppingBag className="size-[19px]" aria-hidden />,
  help: <LifeBuoy className="size-[19px]" aria-hidden />,
  cancelItems: <CircleX className="size-[19px]" aria-hidden />,
  modify: <PencilLine className="size-[19px]" aria-hidden />,
  address: <MapPin className="size-[19px]" aria-hidden />,
  cancelOrder: <CircleX className="size-[19px]" aria-hidden />,
};

/**
 * What can be done with the items chosen — every act they allow and none
 * they do not (`selectionOffers`, the app's own rule) — as a row of
 * presses, each saying how many of the chosen it is about when that is not
 * all of them. One item's act opens under that item, several over the
 * items; either is brought into view, since the bar floats over the foot.
 *
 * It is a pane of the tab bar's Liquid Glass, on the owner's word ("can you
 * make this Liquid Glass design?"): an even 70% tint with its rim, the words
 * on it navy (6.8:1 over black behind the glass) and the cancel's a deep red
 * (`#7f1d1d`, 4.8:1, where the shop's `#c2362a` would be 3.3:1), each act's
 * picture on a small white plate. On a phone it floats over the tab bar
 * (`PhoneActionBar`'s `glass`, which also puts the assistant's button aside);
 * on a wide screen it sticks to the foot of the window while the order is on
 * screen.
 */
function ChosenBar({ onBuyAgain, onCancelOrder }: {
  onBuyAgain: (lineIds: number[]) => Promise<void>;
  /** Cancel the order itself, behind its question. */
  onCancelOrder: () => void;
}) {
  const { t } = useTranslation();
  const { detail, chosen, open, rate, stopEditing } = useControls();
  const [, navigate] = useLocation();
  const returnsOn = useFeature("returns");
  const wide = useMediaQuery("(min-width: 1024px)");
  const eightAcross = useMediaQuery("(min-width: 640px)");
  const [buying, setBuying] = useState(false);
  const count = chosen.length;
  /* What was last on the bar, kept while it slides away. */
  const lines = detail.lines.filter(line => chosen.includes(line.id));
  const offers = selectionOffers(
    lines.map(line => ({
      id: line.id,
      fulfilment: line.fulfilment,
      quantity: line.quantity,
      returnable: returnsOn && mayRequestReturn(line, detail.returns),
      warranty: returnsOn && line.warrantyEligibility.allowed,
      changeable: detail.change.changeable && line.changeable,
      rateable: Boolean(line.review) || line.reviewEligibility.allowed,
      rebuyable: line.variantId !== null,
      viewable: Boolean(line.productHandle),
    })),
    {
      cancelled: detail.steps.cancelled,
      /* The whole order's acts whatever is chosen, one item included (on the
         owner's word); with every item chosen they stand in for the items'. */
      whole: {
        modifiable: detail.change.changeable && detail.lines.some(line => line.changeable),
        address: detail.changeAddress.changeable,
        cancellable: detail.cancel.cancellable,
      },
      everyChosen: chosenState(detail.lines.map(line => line.id), chosen) === "all",
    },
  );
  const shown = useRef(offers);
  if (count > 0) shown.current = offers;

  const run = async (offer: SelectionOffer) => {
    const lineIds = offer.lineIds;
    const one = lineIds.length === 1 ? lineIds[0] : undefined;
    /* One item's act opens under it; several open over the items. */
    const show = (kind: PanelKind, remove = false) =>
      open(one !== undefined ? { kind, lineId: one, remove, fromBar: true } : { kind, lineIds, remove, fromBar: true });
    switch (offer.action) {
      /* The item's page on the shop, the order left as it was behind it. */
      case "view": {
        const handle = lines.find(line => line.id === lineIds[0])?.productHandle;
        if (handle) navigate(`/products/${encodeURIComponent(handle)}`);
        return;
      }
      case "return": open({ kind: "return", lineId: lineIds[0], fromBar: true }); return;
      case "refund": open({ kind: "refund", lineIds, fromBar: true }); return;
      case "warranty": show("warranty"); return;
      case "quantity": show("modify"); return;
      case "cancelItems": show("modify", true); return;
      /* The whole order's: its own panels over the items, and its cancel. */
      case "modify": open({ kind: "modify", fromBar: true }); return;
      case "address": open({ kind: "address", fromBar: true }); return;
      case "cancelOrder": onCancelOrder(); return;
      case "rate": {
        const first = firstToRate(lines.map(line => ({ id: line.id, reviewed: Boolean(line.review) })), lineIds);
        if (first !== null) rate(first);
        return;
      }
      case "buyAgain":
        setBuying(true);
        try { await onBuyAgain(lineIds); } finally { setBuying(false); }
        return;
      case "help":
        open(count === 1 ? { kind: "help", lineId: chosen[0], fromBar: true } : { kind: "help", fromBar: true });
        return;
    }
  };

  const body = (
    <>
      <div className="flex items-center gap-2 ps-2">
        <p aria-live="polite" className="min-w-0 flex-1 truncate text-[13px] font-extrabold text-[#0a285a]">
          {count > 0 ? t("orders.chosenCount", { count }) : null}
        </p>
        <button
          type="button"
          onClick={stopEditing}
          className="tint-on-hover inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-white/90 bg-white/75 px-3 text-[13px] font-bold text-[#0a285a] pointer-fine:min-h-8"
        >
          <X className="size-4" aria-hidden />
          {t("orders.chosenClear")}
        </button>
      </div>
      {/* Rows of four that wrap (one row of eight from `sm`), never a sideways
          scroll: every option the chosen items have is in view at once (on the
          owner's word). */}
      <ul className="grid grid-cols-4 gap-y-1 sm:grid-cols-8">
        {shown.current.map(offer => {
          const some = count > 1 && offer.lineIds.length < count;
          const danger = offer.action === "cancelItems" || offer.action === "cancelOrder";
          return (
            <li key={offer.action} className="min-w-0">
              <button
                type="button"
                onClick={() => void run(offer)}
                disabled={buying && offer.action === "buyAgain"}
                className={`group flex w-full flex-col items-center gap-1 rounded-xl px-0.5 pb-1.5 pt-1 text-center disabled:opacity-60 ${danger ? "text-[#7f1d1d]" : "text-[#0a285a]"}`}
              >
                {/* A small plate of white glass under each picture: the shop's
                    red one for the cancel, the rest white with a bright rim. */}
                <span
                  aria-hidden
                  className={`grid size-10 place-items-center rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,.9),0_1px_3px_rgba(10,40,90,.14)] transition-transform duration-150 group-active:scale-95 ${danger ? "bg-[#fdeceb]/90" : "bg-white/85"}`}
                >
                  {PICK_ICON[offer.action]}
                </span>
                <span className="text-[12px] font-bold leading-[1.2]">
                  {t(offer.action === "cancelItems" && offer.lineIds.length > 1 ? "orders.pickCancelItems" : PICK_LABEL[offer.action])}
                  {some ? <span className="font-semibold"> ({offer.lineIds.length})</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );

  if (wide) {
    return count > 0 ? (
      <div
        role="region"
        aria-label={t("orders.chosenBar")}
        className="glass-rise glass-panel sticky bottom-4 z-10 mt-4 rounded-[24px] border border-white/70 p-2 shadow-[0_12px_32px_rgba(10,40,90,.2),0_1px_3px_rgba(10,40,90,.08)]"
      >
        <GlassLayers />
        <div className="glass-float-body">{body}</div>
      </div>
    ) : null;
  }
  return (
    <>
      {/* Room at the page's foot while the bar is up, so whatever is under it
          — this order's last item, or the orders listed after it — can be
          scrolled clear: about 80px a row of options, four to a row on a phone
          and eight from `sm`. At the foot of `<main>` rather than under this
          order, where the orders after it were left under the bar. */}
      {count > 0 && typeof document !== "undefined"
        ? createPortal(
            <div aria-hidden style={{ height: 16 + 80 * Math.ceil(shown.current.length / (eightAcross ? 8 : 4)) }} />,
            document.getElementById("main") ?? document.body,
          )
        : null}
      <PhoneActionBar shown={count > 0} label={t("orders.chosenBar")} glass>{body}</PhoneActionBar>
    </>
  );
}

/** The order's items as the help panel lists them. */
function helpItems(detail: Detail) {
  return detail.lines.map(line => ({
    id: line.id,
    title: line.productTitle,
    variant: line.variantTitle && line.variantTitle !== "Default" ? line.variantTitle : null,
    photo: line.photo ?? null,
    variantId: line.variantId,
    quantity: line.quantity,
  }));
}

/**
 * Where each parcel is, drawn the way the delivery apps people here use every
 * day draw it, on the owner's word ("enhance the tracking order UI, make it
 * better"): per parcel the items in it by their photos, where it is now in
 * large type with the store's estimate under it, and the four steps as one
 * row of pictures — the order, the box, the van, the house — the ones behind
 * it filled navy, the one it is at in the brand's orange with a ring spreading
 * from it, a moving dash on the road while it is on the way, the house green
 * once it has arrived. Only facts are dated. The live map follows while
 * anything is on the road.
 */
function OrderTracking({ reference, detail, lineId, lineIds }: { reference: string; detail: Detail; lineId?: number; lineIds?: number[] }) {
  const { t } = useTranslation();
  const shortDay = useShortDayFormat();
  const headingId = useId();
  /* For one item the parcel it is in; for several chosen, the parcels they are in. */
  const about = lineId !== undefined ? [lineId] : lineIds;
  const steps = !about ? detail.steps : { ...detail.steps, parcels: detail.steps.parcels.filter(parcel => parcel.lineIds.some(id => about.includes(id))) };
  const items = new Map(detail.lines.map(line => [line.id, { title: line.productTitle, photo: line.photo ?? null }]));
  const estimated = steps.parcels.some(parcel => parcel.promise && parcel.promise.kind !== "madeToOrder");

  return (
    <section aria-labelledby={headingId} className="panel-in mt-3 rounded-2xl border border-[#d5dfeb] bg-[#f7f9fc] p-3 sm:p-4">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h4 id={headingId} className="text-[15px] font-extrabold text-[#0a285a]">{t("track.title")}</h4>
        {steps.parcels.length > 1 ? <p className="text-[12px] font-semibold ink-muted">{t("track.parcelCount", { count: steps.parcels.length })}</p> : null}
      </div>
      <ul className="mt-3 space-y-3">
        {steps.parcels.map(parcel => (
          <li key={parcel.key} className="rounded-2xl border border-[#e3e9f1] bg-white p-4 shadow-[0_1px_2px_rgba(10,40,90,.05)]">
            <ParcelTracker parcel={parcel} placedAt={steps.placedAt} items={items} shortDay={shortDay} />
          </li>
        ))}
      </ul>
      {estimated ? <p className="mt-3 px-1 text-[12px] leading-5 ink-muted">{t("track.estimate")}</p> : null}
      {/* Live tracking (3.4.3), while anything is on the road. */}
      {steps.parcels.some(parcel => parcel.step === "onTheWay") ? <TrackParcels reference={reference} /> : null}
    </section>
  );
}

/** Each step's picture: the order, the box, the van, the house. */
const STEP_ICON: Record<TrackStep, (className: string) => ReactNode> = {
  placed: className => <ReceiptText className={className} aria-hidden />,
  preparing: className => <Package className={className} aria-hidden />,
  onTheWay: className => <Truck className={`${className} rtl:-scale-x-100`} aria-hidden />,
  delivered: className => <House className={className} aria-hidden />,
};

/**
 * What the store says about when a parcel comes, said as theirs: its window,
 * "made to order", a pre-order's release, or that it is later than the
 * estimate. Null when there is nothing to say.
 */
function usePromiseText() {
  const { t } = useTranslation();
  const shortDay = useShortDayFormat();
  return (promised: TrackPromise | null): { text: string; late: boolean } | null => {
    if (!promised) return null;
    if (promised.kind === "madeToOrder") return { text: t("track.madeToOrder"), late: false };
    if (promised.kind === "preorder") return { text: promised.at ? t("track.preorder", { date: shortDay(promised.at) }) : t("track.preorderOpen"), late: false };
    if (promised.late) return { text: t("track.late", { date: shortDay(promised.to) }), late: true };
    const from = shortDay(promised.from);
    const to = shortDay(promised.to);
    return { text: from === to ? t("track.expectedOn", { date: from }) : t("track.expected", { from, to }), late: false };
  };
}

/**
 * Where one item is, drawn under it in the opened order, on the owner's word
 * ("inside, each item has a different delivery time … once you click in it,
 * each item will show this one"): the road My orders drew under the whole
 * order, read off this item alone (`orderProgress` over its one line), with
 * when its parcel's store says it comes. The list shows the order's main
 * facts only.
 */
/**
 * Where one item is, under its photo (on the owner's word: "delivery status
 * should shown here; once it shown delivered, then review icon will appear
 * out here"), read off that item alone; once delivered, the plate is its
 * review — Rate, or the stars given and Edit.
 */
export function LineStatus({ line, detail }: { line: Line; detail: Detail }) {
  const { rate } = useControls();
  return (
    <ItemStatus
      progress={orderProgress(detail.order, [line])}
      rating={line.review?.rating ?? null}
      mayRate={!line.review && line.reviewEligibility.allowed}
      title={line.productTitle}
      onRate={() => rate(line.id)}
    />
  );
}

/**
 * When one item still coming is expected — its parcel's day, the store's own
 * estimate or that it is later (the tracker's words): an order's items arrive
 * on different days.
 */
export function LineExpected({ line, detail }: { line: Line; detail: Detail }) {
  const promiseText = usePromiseText();
  const progress = orderProgress(detail.order, [line]);
  if (progress.kind === "delivered" || progress.kind === "cancelled" || progress.kind === "returned") return null;
  const parcel = detail.steps.parcels.find(entry => entry.lineIds.includes(line.id));
  const promise = promiseText(parcel?.promise ?? null);
  if (!promise) return null;
  return <p className={`mt-1 text-[12px] font-semibold leading-5 ${promise.late ? "ink-accent" : "text-[#2f5d33]"}`}>{promise.text}</p>;
}

/** How many of a parcel's items are drawn by their photos before a "+N". */
const PARCEL_PHOTOS = 4;

function ParcelTracker({ parcel, placedAt, items, shortDay }: {
  parcel: ParcelTrack;
  placedAt: string;
  items: Map<number, { title: string; photo: string | null }>;
  shortDay: (value: string) => string;
}) {
  const { t } = useTranslation();
  const reached = TRACK_STEPS.indexOf(parcel.step);
  const arrived = parcel.step === "delivered";
  const inside = parcel.lineIds.map(id => items.get(id)).filter((item): item is { title: string; photo: string | null } => Boolean(item));
  const dateOf = (step: TrackStep) =>
    step === "placed" ? shortDay(placedAt) : step === "delivered" && parcel.deliveredAt ? shortDay(parcel.deliveredAt) : null;

  const promiseText = usePromiseText();
  const promise = arrived ? null : promiseText(parcel.promise);

  return (
    <>
      <div className="flex items-start gap-3">
        {/* The items by their photos: how a parcel is recognised. */}
        <span aria-hidden className="flex shrink-0 -space-x-3 rtl:space-x-reverse">
          {inside.slice(0, inside.length > PARCEL_PHOTOS ? PARCEL_PHOTOS - 1 : PARCEL_PHOTOS).map((item, index) => (
            <Thumb key={index} src={item.photo} alt="" className="size-11 rounded-xl border-2 border-white bg-white object-contain shadow-[0_0_0_1px_#e3e9f1]" icon={<PackageSearch className="size-4" />} />
          ))}
          {inside.length > PARCEL_PHOTOS ? (
            <span className="grid size-11 place-items-center rounded-xl border-2 border-white bg-[#0a285a] text-[12px] font-extrabold text-white">+{inside.length - (PARCEL_PHOTOS - 1)}</span>
          ) : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-extrabold text-[#0a285a]">
            {parcel.vendorName ? t("track.from", { store: isolate(parcel.vendorName) }) : t("track.parcel")}
          </p>
          {inside.length > 0 ? <p dir="auto" className="mt-0.5 truncate text-[12px] ink-muted">{inside.map(item => item.title).join(" · ")}</p> : null}
          {parcel.fast || parcel.destinationLabel ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold text-[#0a285a]">
              {parcel.fast ? <span className="inline-flex items-center gap-1 rounded-full bg-[#fff1e8] px-2 py-0.5 text-[#8a3a17]"><Zap className="size-3.5" aria-hidden />{t("track.fast")}</span> : null}
              {parcel.destinationLabel ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{t("track.to", { label: isolate(parcel.destinationLabel) })}</span> : null}
            </p>
          ) : null}
        </div>
      </div>

      {/* Where it is now, in words, and when the store says it comes. */}
      <div className={`mt-4 rounded-xl px-3.5 py-3 ${arrived ? "bg-[#e9f5ec]" : promise?.late ? "bg-[#fff4ec]" : "bg-[#f1f5fb]"}`}>
        <p className={`text-[17px] font-extrabold leading-6 ${arrived ? "text-[#1f6a35]" : "text-[#0a285a]"}`}>
          {arrived && parcel.deliveredAt ? t("track.deliveredOn", { date: shortDay(parcel.deliveredAt) }) : t(STEP_LABEL[parcel.step])}
        </p>
        {promise ? <p className={`mt-0.5 text-[13px] font-semibold leading-5 ${promise.late ? "ink-accent" : "text-[#2f5d33]"}`}>{promise.text}</p> : null}
      </div>

      <ol className="mt-4 grid grid-cols-4">
        {TRACK_STEPS.map((step, index) => {
          const done = index < reached || (index === reached && arrived);
          const now = index === reached && !done;
          const label = t(STEP_LABEL[step]);
          const date = dateOf(step);
          /* The road to this step from the one before: travelled, being travelled, or still ahead. */
          const road = index <= reached ? "bg-[#0a285a]" : index === reached + 1 && parcel.step === "onTheWay" ? "track-road-moving" : "bg-[#dfe5ee]";
          return (
            <li key={step} aria-current={now ? "step" : undefined} className="relative flex flex-col items-center px-0.5 text-center">
              {index > 0 ? <span aria-hidden className={`absolute end-1/2 top-[17px] h-[3px] w-full -translate-y-1/2 rounded-full ${road}`} /> : null}
              <span
                aria-hidden
                className={`relative z-[1] grid size-[34px] place-items-center rounded-full ${
                  done && step === "delivered" ? "bg-[#2f7d43] text-white"
                    : done ? "bg-[#0a285a] text-white"
                      : now ? "track-now bg-[#f2683a] text-[#0a285a]"
                        : "border border-[#dfe5ee] bg-[#f4f6f9] text-[#8593a8]"
                }`}
              >
                {STEP_ICON[step]("size-4")}
              </span>
              <span className={`mt-1.5 text-[12px] leading-[1.25] ${now ? "font-extrabold text-[#0a285a]" : done ? "font-bold text-[#0a285a]" : "font-semibold ink-muted"}`}>
                <span className="sr-only">{t(done ? "track.stepDone" : now ? "track.stepNow" : "track.stepNext", { step: label })}</span>
                <span aria-hidden>{label}</span>
              </span>
              {date ? <span className="mt-0.5 text-[12px] leading-4 ink-muted">{date}</span> : null}
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * "Request a refund": which items, why, and a note — one return request per
 * item, with the refund chosen. Each is decided as the per-item form's is,
 * and the item says where its request stands once it is sent.
 */
function RefundForm({ reference, lines, initial, onDone, onCancel }: {
  reference: string;
  lines: Detail["lines"];
  /** The items chosen on the page, ticked to start. */
  initial?: number[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, tError } = useTranslation();
  const ids = useId();
  const [chosen, setChosen] = useState<number[]>(() =>
    initial ? lines.filter(line => initial.includes(line.id)).map(line => line.id) : lines.length === 1 ? [lines[0].id] : [],
  );
  const [reason, setReason] = useState<ReturnReason>("damaged");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const ask = trpc.orders.requestReturn.useMutation();

  const send = async () => {
    if (chosen.length === 0) {
      setProblem(t("orders.refundPickOne"));
      document.getElementById(`${ids}-items`)?.querySelector("input")?.focus();
      return;
    }
    setProblem(null);
    setSending(true);
    let sent = 0;
    for (const orderItemId of chosen) {
      try {
        await ask.mutateAsync({ reference, orderItemId, kind: "refund", reason, note: note.trim() || null });
        sent += 1;
      } catch (error) {
        toast.error(tError(error instanceof Error ? error.message : ""));
      }
    }
    setSending(false);
    if (sent > 0) {
      toast.success(t("orders.refundSent"));
      onDone();
    }
  };

  return (
    <form
      className="mt-3 rounded-2xl border border-[#d5dfeb] bg-white p-4"
      aria-labelledby={`${ids}-title`}
      onSubmit={event => { event.preventDefault(); void send(); }}
    >
      <h4 id={`${ids}-title`} className="text-[14px] font-extrabold text-[#0a285a]">{t("orders.requestRefund")}</h4>
      <fieldset id={`${ids}-items`} className="mt-3" aria-describedby={problem ? `${ids}-problem` : undefined}>
        <legend className="text-[12px] font-extrabold ink-muted">{t("orders.refundWhich")}</legend>
        <ul className="mt-2 space-y-2">
          {lines.map(line => (
            <li key={line.id}>
              <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[#e7edf5] px-3 py-2">
                <input
                  type="checkbox"
                  checked={chosen.includes(line.id)}
                  onChange={event => {
                    const ticked = event.target.checked;
                    setChosen(now => ticked ? [...now, line.id] : now.filter(id => id !== line.id));
                    setProblem(null);
                  }}
                  className="size-4 shrink-0 accent-[#0a285a]"
                />
                <Thumb src={line.photo ?? null} alt="" className="size-10 shrink-0 rounded-lg border border-[#e7edf5] bg-white object-contain" icon={<PackageSearch className="size-4" />} />
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-[13px] font-bold text-[#0a285a]">{line.productTitle}</span>
                  {/* A lone "Default" names no choice anybody made. */}
                  {line.variantTitle && line.variantTitle !== "Default" ? <span dir="auto" className="block truncate text-[12px] ink-muted">{line.variantTitle}</span> : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {problem ? <p id={`${ids}-problem`} role="alert" className="mt-2 text-[12px] font-semibold text-[#8c2f22]">{problem}</p> : null}
      </fieldset>
      <label className="mt-3 block">
        <span className="block text-[12px] font-extrabold ink-muted">{t("returns.why")}</span>
        <Select
          value={reason}
          onChange={event => setReason(event.target.value as ReturnReason)}
          className="mt-1 h-11 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] text-[#0a285a]"
        >
          {RETURN_REASONS.map(option => <option key={option} value={option}>{t(REASON_LABEL[option])}</option>)}
        </Select>
      </label>
      <label className="mt-3 block">
        <span className="block text-[12px] font-extrabold ink-muted">{t(reason === "other" ? "returns.noteRequired" : "returns.noteOptional")}</span>
        <textarea
          value={note}
          onChange={event => setNote(event.target.value)}
          maxLength={MAX_RETURN_NOTE}
          rows={2}
          dir="auto"
          required={reason === "other"}
          className="glass-field mt-1 w-full rounded-2xl px-3 py-2 text-sm"
        />
      </label>
      <p className="mt-2 text-[12px] leading-5 ink-muted">{t("returns.howItWorks")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" disabled={sending} className="glass-navy type-control pressable min-h-11 rounded-full px-4 py-2 disabled:opacity-60 pointer-fine:min-h-9">
          {t("orders.refundSend")}
        </button>
        <button type="button" onClick={onCancel} className="glass type-control pressable min-h-11 rounded-full px-4 py-2 pointer-fine:min-h-9">
          {t("claims.cancel")}
        </button>
      </div>
    </form>
  );
}
