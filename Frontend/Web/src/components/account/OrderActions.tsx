/**
 * The opened order as an after-sales centre, on the owner's word: "each
 * order's detail page should function as a complete after-sales service
 * center", with only the actions this order offers now — **and each item's
 * behind a ⋯ of its own**, also on the owner's word ("let these options be in
 * a 3 dot icon for each product. The user can select a specific product with
 * the options"). They were one row of buttons over the items, each asking
 * afterwards which item it meant.
 *
 * **An item's ⋯** (`OrderLineMenu`, the bag's own `LinePopover`: a sheet on a
 * phone naming the item, a small menu from `sm`) offers what that item can
 * have done: track it, return or exchange it, claim its warranty, change its
 * quantity or cancel it before a driver has it, buy it again, rate it, and get
 * help with it. What it opens is drawn under that item (`OrderLinePanel`).
 * **The order's ⋯**, beside "In this order", keeps what is about the whole
 * order: tracking every parcel, a refund across items, changing the address,
 * modifying, buying everything again, cancelling it and getting help.
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
import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Check,
  CircleX,
  LifeBuoy,
  MapPin,
  MoreHorizontal,
  PackageSearch,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
  Star,
  Truck,
  Zap,
} from "lucide-react";
import { useLocation } from "wouter";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Select } from "@/components/ui/Select";
import { Thumb } from "@/components/product/Thumb";
import { LinePopover, type LineAction } from "@/components/cart/LinePopover";
import { TrackParcels } from "@/components/account/TrackParcels";
import { LineReturnForm, mayRequestReturn, REASON_LABEL, type Detail } from "@/components/account/LineReturn";
import { OrderModify } from "@/components/account/OrderModify";
import { OrderAddress } from "@/components/account/OrderAddress";
import { WarrantyClaims, WarrantyForm } from "@/components/account/OrderWarranty";
import { OrderHelp } from "@/components/account/OrderHelp";
import { useCart } from "@/contexts/CartContext";
import { useFeature } from "@/hooks/useFeature";
import { useTranslation } from "@/hooks/useTranslation";
import { useShortDayFormat } from "@/hooks/useDateFormat";
import { trpc } from "@/lib/trpc";
import { MAX_RETURN_NOTE, RETURN_REASONS, type ReturnReason } from "@shared/commerce/returnRequests";
import { TRACK_STEPS, type ParcelTrack, type TrackStep } from "@shared/commerce/orderTracking";
import type { OrderHelpAction } from "@shared/commerce/orderHelp";
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
type PanelKind = "track" | "refund" | "return" | "warranty" | "modify" | "address" | "help";
/** What is open, and — from an item's ⋯ — which item it is about. */
type Panel = { kind: PanelKind; lineId?: number; remove?: boolean };

type Controls = {
  reference: string;
  detail: Detail;
  panel: Panel | null;
  open: (panel: Panel) => void;
  close: () => void;
  done: () => void;
  act: (action: OrderHelpAction, lineId?: number) => void;
  rate: (lineId: number) => void;
};
const OrderControls = createContext<Controls | null>(null);

function useControls(): Controls {
  const controls = useContext(OrderControls);
  if (!controls) throw new Error("An order's menus are drawn inside OrderAfterSales.");
  return controls;
}

/**
 * The order's after-sales state, round its items: the order's own ⋯ and what
 * it opens, then `children` — the items, each with `OrderLineMenu` and
 * `OrderLinePanel` — and the confirmation that cancels the whole order.
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
  const { cartId, adoptCart } = useCart();
  const [panel, setPanel] = useState<Panel | null>(() =>
    refundFirst ? { kind: "refund" } : trackFirst || detail.steps.parcels.some(parcel => parcel.step === "onTheWay") ? { kind: "track" } : null,
  );
  const [asking, setAsking] = useState(false);

  const refundable = returnsOn ? detail.lines.filter(line => mayRequestReturn(line, detail.returns)) : [];
  const claimable = returnsOn ? detail.lines.filter(line => line.warrantyEligibility.allowed) : [];
  const changeable = detail.change.changeable && detail.lines.some(line => line.changeable);
  const rebuyable = detail.lines.some(line => line.variantId !== null);

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

  const controls: Controls = {
    reference,
    detail,
    panel,
    open: next => setPanel(current => (current && current.kind === next.kind && current.lineId === next.lineId && current.remove === next.remove ? null : next)),
    close: () => setPanel(null),
    done: () => { setPanel(null); refresh(); },
    act,
    rate: onRate,
  };

  /* Said only while the order is still coming: an order that is over needs
     no sentence about why it cannot be cancelled. */
  const whyNot = !detail.cancel.cancellable && detail.cancel.reason !== "orders.cancelClosed" && !detail.steps.cancelled
    && detail.steps.parcels.some(parcel => parcel.step !== "delivered")
    ? detail.cancel.reason
    : null;

  const actions: LineAction[] = [];
  if (!detail.steps.cancelled) actions.push({ key: "track", icon: <Truck className="size-[18px] rtl:-scale-x-100" aria-hidden />, label: t("orders.track"), run: () => controls.open({ kind: "track" }) });
  if (refundable.length > 0) actions.push({ key: "refund", icon: <RotateCcw className="size-[18px] rtl:-scale-x-100" aria-hidden />, label: t("orders.requestRefund"), run: () => controls.open({ kind: "refund" }) });
  if (claimable.length > 0) actions.push({ key: "warranty", icon: <ShieldCheck className="size-[18px]" aria-hidden />, label: t("warranty.title"), run: () => controls.open({ kind: "warranty" }) });
  if (detail.changeAddress.changeable) actions.push({ key: "address", icon: <MapPin className="size-[18px]" aria-hidden />, label: t("orders.changeAddress"), run: () => controls.open({ kind: "address" }) });
  if (changeable) actions.push({ key: "modify", icon: <PencilLine className="size-[18px]" aria-hidden />, label: t("orders.modify"), run: () => controls.open({ kind: "modify" }) });
  if (rebuyable) actions.push({ key: "again", icon: <ShoppingBag className="size-[18px]" aria-hidden />, label: t("orders.buyAgainAll"), run: () => again.mutate({ reference, cartId }) });
  actions.push({ key: "help", icon: <LifeBuoy className="size-[18px]" aria-hidden />, label: t("orders.getHelp"), run: () => controls.open({ kind: "help" }) });
  if (detail.cancel.cancellable) actions.push({ key: "cancel", icon: <CircleX className="size-[18px]" aria-hidden />, label: t("orders.cancelOrder"), danger: true, run: () => setAsking(true) });

  const orderPanel = panel && panel.lineId === undefined ? panel : null;

  return (
    <OrderControls.Provider value={controls}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-[14px] font-extrabold text-[#0a285a]">{t("orders.inThisOrder")}</h4>
        <LinePopover
          title={t("orders.orderMenuTitle", { reference })}
          label={t("orders.orderMenu")}
          short={t("cart.lineMenuShort")}
          trigger={<MoreHorizontal className="size-5" aria-hidden />}
          actions={actions}
          active
        />
      </div>
      {whyNot ? <p className="mb-3 text-[12px] leading-5 ink-muted">{t(whyNot)}</p> : null}

      <WarrantyClaims detail={detail} onChanged={refresh} />

      <div id={`${ids}-panel`} className="mb-3 empty:hidden">
        {orderPanel?.kind === "track" ? <OrderTracking reference={reference} detail={detail} /> : null}
        {orderPanel?.kind === "refund" && refundable.length > 0 ? (
          <RefundForm reference={reference} lines={refundable} onDone={controls.done} onCancel={controls.close} />
        ) : null}
        {orderPanel?.kind === "warranty" && claimable.length > 0 ? (
          <WarrantyForm reference={reference} detail={detail} onDone={controls.done} onCancel={controls.close} />
        ) : null}
        {orderPanel?.kind === "modify" && changeable ? (
          <OrderModify reference={reference} detail={detail} onDone={controls.done} onCancel={controls.close} />
        ) : null}
        {orderPanel?.kind === "address" && detail.changeAddress.changeable ? (
          <OrderAddress reference={reference} detail={detail} onDone={controls.done} onCancel={controls.close} />
        ) : null}
        {orderPanel?.kind === "help" ? <OrderHelp reference={reference} items={helpItems(detail)} onAction={(action, lineId) => act(action, lineId)} onClose={controls.close} /> : null}
      </div>

      {children}

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

/**
 * One item's ⋯: what can be done with this item now, and nothing else. A row
 * the server would refuse is not drawn — an item not delivered offers no
 * return, one a driver has offers no change.
 */
export function OrderLineMenu({ line }: { line: Line }) {
  const { t } = useTranslation();
  const { detail, open, rate } = useControls();
  const returnsOn = useFeature("returns");
  const { addItem } = useCart();
  const [, navigate] = useLocation();
  const changeable = detail.change.changeable && line.changeable;
  const actions: LineAction[] = [];

  if (!detail.steps.cancelled && line.fulfilment !== "cancelled") {
    actions.push({ key: "track", icon: <Truck className="size-[18px] rtl:-scale-x-100" aria-hidden />, label: t("orders.trackItem"), run: () => open({ kind: "track", lineId: line.id }) });
  }
  if (returnsOn && mayRequestReturn(line, detail.returns)) {
    actions.push({ key: "return", icon: <RotateCcw className="size-[18px] rtl:-scale-x-100" aria-hidden />, label: t("returns.start"), run: () => open({ kind: "return", lineId: line.id }) });
  }
  if (returnsOn && line.warrantyEligibility.allowed) {
    actions.push({ key: "warranty", icon: <ShieldCheck className="size-[18px]" aria-hidden />, label: t("warranty.title"), run: () => open({ kind: "warranty", lineId: line.id }) });
  }
  if (changeable && line.quantity > 1) {
    actions.push({ key: "quantity", icon: <PencilLine className="size-[18px]" aria-hidden />, label: t("orders.changeQuantity"), run: () => open({ kind: "modify", lineId: line.id }) });
  }
  if (line.review || line.reviewEligibility.allowed) {
    actions.push({ key: "rate", icon: <Star className="size-[18px] fill-[#ffb800] text-[#ffb800]" aria-hidden />, label: t(line.review ? "review.edit" : "review.rateItem"), run: () => rate(line.id) });
  }
  if (line.variantId !== null) {
    actions.push({
      key: "again",
      icon: <ShoppingBag className="size-[18px]" aria-hidden />,
      label: t("orders.buyAgain"),
      run: () => {
        addItem(String(line.variantId), line.quantity, { reveal: false }).then(
          () => toast.success(t("cart.added", { name: line.productTitle }), { action: { label: t("product.viewCart"), onClick: () => navigate("/cart") } }),
          () => toast.error(t("orders.buyAgainNone")),
        );
      },
    });
  }
  actions.push({ key: "help", icon: <LifeBuoy className="size-[18px]" aria-hidden />, label: t("orders.helpItem"), run: () => open({ kind: "help", lineId: line.id }) });
  if (changeable) {
    actions.push({ key: "cancel", icon: <CircleX className="size-[18px]" aria-hidden />, label: t("orders.cancelItem"), danger: true, run: () => open({ kind: "modify", lineId: line.id, remove: true }) });
  }

  return (
    <LinePopover
      photo={line.photo ?? null}
      title={line.productTitle}
      label={t("orders.lineMenu", { name: line.productTitle })}
      short={t("cart.lineMenuShort")}
      trigger={<MoreHorizontal className="size-5" aria-hidden />}
      actions={actions}
    />
  );
}

/** What an item's ⋯ opened, under that item. */
export function OrderLinePanel({ line }: { line: Line }) {
  const { reference, detail, panel, close, done, act } = useControls();
  if (!panel || panel.lineId !== line.id) return null;
  return (
    <div className="mt-1">
      {panel.kind === "track" ? <OrderTracking reference={reference} detail={detail} lineId={line.id} /> : null}
      {panel.kind === "return" && mayRequestReturn(line, detail.returns) ? <LineReturnForm reference={reference} line={line} onDone={done} onCancel={close} /> : null}
      {panel.kind === "warranty" && line.warrantyEligibility.allowed ? <WarrantyForm reference={reference} detail={detail} lineId={line.id} onDone={done} onCancel={close} /> : null}
      {panel.kind === "modify" && detail.change.changeable && line.changeable ? (
        <OrderModify key={panel.remove ? "remove" : "quantity"} reference={reference} detail={detail} lineId={line.id} remove={panel.remove} onDone={done} onCancel={close} />
      ) : null}
      {panel.kind === "help" ? <OrderHelp reference={reference} items={helpItems(detail)} lineId={line.id} onAction={(action, lineId) => act(action, lineId ?? line.id)} onClose={close} /> : null}
    </div>
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
 * The order's parcels as steps, one line of steps per parcel, with the live
 * map under a parcel on the road.
 */
function OrderTracking({ reference, detail, lineId }: { reference: string; detail: Detail; lineId?: number }) {
  const { t } = useTranslation();
  const shortDay = useShortDayFormat();
  const headingId = useId();
  /* From an item's ⋯: the parcel that item is in. */
  const steps = lineId === undefined ? detail.steps : { ...detail.steps, parcels: detail.steps.parcels.filter(parcel => parcel.lineIds.includes(lineId)) };
  const titles = new Map(detail.lines.map(line => [line.id, line.productTitle]));
  const estimated = steps.parcels.some(parcel => parcel.promise && parcel.promise.kind !== "madeToOrder");

  return (
    <section aria-labelledby={headingId} className="mt-3 rounded-2xl border border-[#d5dfeb] bg-[#fbfcfe] p-4">
      <h4 id={headingId} className="text-[14px] font-extrabold text-[#0a285a]">{t("track.title")}</h4>
      <ul className="mt-3 space-y-3">
        {steps.parcels.map(parcel => (
          <li key={parcel.key} className="rounded-xl border border-[#e7edf5] bg-white p-3">
            <ParcelSteps parcel={parcel} placedAt={steps.placedAt} titles={titles} shortDay={shortDay} />
          </li>
        ))}
      </ul>
      {estimated ? <p className="mt-3 text-[12px] leading-5 ink-muted">{t("track.estimate")}</p> : null}
      {/* Live tracking (3.4.3), while anything is on the road. */}
      {steps.parcels.some(parcel => parcel.step === "onTheWay") ? <TrackParcels reference={reference} /> : null}
    </section>
  );
}

function ParcelSteps({ parcel, placedAt, titles, shortDay }: {
  parcel: ParcelTrack;
  placedAt: string;
  titles: Map<number, string>;
  shortDay: (value: string) => string;
}) {
  const { t } = useTranslation();
  const reached = TRACK_STEPS.indexOf(parcel.step);
  const names = parcel.lineIds.map(id => titles.get(id)).filter((name): name is string => Boolean(name));
  const dateOf = (step: TrackStep) =>
    step === "placed" ? shortDay(placedAt) : step === "delivered" && parcel.deliveredAt ? shortDay(parcel.deliveredAt) : null;

  const promise = (() => {
    const promised = parcel.promise;
    if (!promised) return null;
    if (promised.kind === "madeToOrder") return { text: t("track.madeToOrder"), late: false };
    if (promised.kind === "preorder") return { text: promised.at ? t("track.preorder", { date: shortDay(promised.at) }) : t("track.preorderOpen"), late: false };
    if (promised.late) return { text: t("track.late", { date: shortDay(promised.to) }), late: true };
    const from = shortDay(promised.from);
    const to = shortDay(promised.to);
    return { text: from === to ? t("track.expectedOn", { date: from }) : t("track.expected", { from, to }), late: false };
  })();

  return (
    <>
      <p className="text-[13px] font-extrabold text-[#0a285a]">
        {parcel.vendorName ? t("track.from", { store: isolate(parcel.vendorName) }) : t("track.parcel")}
      </p>
      {names.length > 0 ? <p dir="auto" className="mt-0.5 truncate text-[12px] ink-muted">{names.join(" · ")}</p> : null}
      {parcel.fast || parcel.destinationLabel ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold text-[#0a285a]">
          {parcel.fast ? <span className="inline-flex items-center gap-1"><Zap className="size-3.5" aria-hidden />{t("track.fast")}</span> : null}
          {parcel.destinationLabel ? <span>{t("track.to", { label: isolate(parcel.destinationLabel) })}</span> : null}
        </p>
      ) : null}

      <ol className="mt-3">
        {TRACK_STEPS.map((step, index) => {
          const done = index < reached || (index === reached && step === "delivered");
          const now = index === reached && !done;
          const label = t(STEP_LABEL[step]);
          const date = dateOf(step);
          const last = index === TRACK_STEPS.length - 1;
          return (
            <li key={step} className="relative flex items-start gap-3 pb-3 last:pb-0">
              {last ? null : (
                <span aria-hidden className={`absolute start-[9px] top-5 bottom-0 w-0.5 ${index < reached ? "bg-[#0a285a]" : "bg-[#d5dfeb]"}`} />
              )}
              <span
                aria-hidden
                className={`relative z-[1] grid size-5 shrink-0 place-items-center rounded-full ${
                  done ? "bg-[#0a285a] text-white"
                    : now ? "border-2 border-[#0a285a] bg-white"
                      : "border-2 border-[#c9d3e0] bg-white"
                }`}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : now ? <span className="size-2 rounded-full bg-[#0a285a]" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
                <span className={`text-[13px] ${now ? "font-extrabold text-[#0a285a]" : done ? "font-bold text-[#0a285a]" : "font-semibold ink-muted"}`}>
                  <span className="sr-only">{t(done ? "track.stepDone" : now ? "track.stepNow" : "track.stepNext", { step: label })}</span>
                  <span aria-hidden>{label}</span>
                </span>
                {date ? <span className="text-[12px] ink-muted">{date}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {promise ? <p className={`mt-2 text-[12px] font-semibold ${promise.late ? "ink-accent" : "text-[#2f5d33]"}`}>{promise.text}</p> : null}
    </>
  );
}

/**
 * "Request a refund": which items, why, and a note — one return request per
 * item, with the refund chosen. Each is decided as the per-item form's is,
 * and the item says where its request stands once it is sent.
 */
function RefundForm({ reference, lines, onDone, onCancel }: {
  reference: string;
  lines: Detail["lines"];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, tError } = useTranslation();
  const ids = useId();
  const [chosen, setChosen] = useState<number[]>(() => (lines.length === 1 ? [lines[0].id] : []));
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
