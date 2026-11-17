/**
 * Each store's delivery in the bag, beside its car (migration 0085, on the
 * owner's word): "display the default delivery address and delivery fee next
 * to the delivery car icon for each seller … clicking the delivery section
 * should allow customers to change the delivery type (Standard/Express),
 * date, time, and address … show the updated delivery details directly next
 * to the car icon … clearly display Free Delivery and the delivery
 * destination … automatically update the cart total".
 *
 * **The row is one press**: the car, where it goes ("To Home"), what it costs
 * or "Free delivery" in green, and under it Standard or Express with the day
 * chosen, or the store's own band, or "Choose a day and time" while the store
 * offers days. A press opens the sheet (`StoreDeliverySheet`) — a sheet from a
 * phone's foot, a card from `sm` — of the store's delivery type, its address,
 * a day and a time of day, each applied the moment it is pressed through the
 * bag's queue (`setStoreDelivery`), so the row, the fee, free delivery and the
 * total move with it.
 *
 * **What may be chosen is the server's answer** (`Cart.stores`, decided by
 * `Shared/commerce/deliverySlots.ts`): the days from the store's earliest,
 * seven working days without Friday and Saturday, the windows still open on
 * each. A store that has said nothing offers no day; until 0085 is pasted
 * (`slotsReady` false) no day or time is drawn at all and the rest works.
 */
import { useDeliveryAddress } from "@/components/cart/DeliveryAddressCard";
import { useCart, type StoreDeliveryChange } from "@/contexts/CartContext";
import { useOverlay } from "@/hooks/useOverlay";
import { useSlotWords } from "@/hooks/useSlotWords";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { pressHaptic } from "@/lib/haptics";
import { navigateWhenReady } from "@/lib/readyNavigation";
import { freeDeliveryProgress, type BagGroup } from "@/lib/bagGroups";
import { isDeliverySpeed, slowestSpeed } from "@shared/commerce/deliverySpeed";
import { fromFils, toFils } from "@shared/money";
import type { Cart, CartStoreDelivery } from "@shared/commerce/types";
import type { MessageKey } from "@shared/i18n/dictionary";
import { CalendarDays, ChevronRight, Clock, MapPin, Plus, Truck, X, Zap } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

type Window = "morning" | "afternoon" | "evening";
const WINDOWS: Window[] = ["morning", "afternoon", "evening"];

/** A refusal said in words: the server's key when it sent one. */
function useRefusal() {
  const { t, tError } = useTranslation();
  return (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    const said = tError(message);
    toast.error(said && said !== message ? said : t("cart.updateFailed"));
  };
}

/** The store's row of the bag's answer, when the server sent one. */
export function storeDeliveryOf(cart: Cart | null | undefined, group: BagGroup): CartStoreDelivery | null {
  const id = group.store.id;
  return id == null ? null : cart?.stores?.find(store => store.vendorId === id) ?? null;
}

/** The row beside the car: where, what it costs, and when — one press to change any of it. */
export function StoreDeliveryRow({ group, name, store }: { group: BagGroup; name: string; store: CartStoreDelivery }) {
  const { cart, syncing } = useCart();
  const { t } = useTranslation();
  const money = useMoney();
  const words = useSlotWords();
  const { address: main } = useDeliveryAddress();
  const [open, setOpen] = useState(false);

  const to = store.addressId === "mixed"
    ? t("storeDelivery.toSeveral")
    : store.addressId !== null
      ? t("storeDelivery.to", { label: cart?.addresses?.find(address => address.id === store.addressId)?.label ?? main?.label ?? "" })
      : main?.label ? t("storeDelivery.to", { label: main.label }) : t("storeDelivery.toYourAddress");
  const total = group.delivery.reduce((sum, row) => sum + toFils(row.fee.amount), 0n);
  const free = total === 0n;
  const feeText = free ? t("storeDelivery.free") : t("storeDelivery.fee", { fee: money({ amount: fromFils(total), currencyCode: group.delivery[0]?.fee.currencyCode ?? "KWD" }) });
  const kind = store.choice === "fast" ? t("storeDelivery.express") : store.choice === "mixed" ? t("storeDelivery.both") : t("storeDelivery.standard");
  const band = slowestSpeed(group.items.map(item => {
    const value = item.deliveryChoice === "fast" ? item.fastDelivery?.speed : item.deliverySpeed;
    return isDeliverySpeed(value) ? value : null;
  }));
  const when = cart?.slotsReady && store.slot && store.slotState === "kept"
    ? words.slot(store.slot)
    : cart?.slotsReady && store.days.length && store.slotState === "unset"
      ? t("storeDelivery.chooseDay")
      : band ? t(`speed.${band}` as MessageKey) : null;
  const gone = cart?.slotsReady && store.slotState === "gone";
  /* The first parcel still short of its free delivery, with how far along. */
  const nudge = group.delivery.find(row => row.toFree);
  const progress = nudge ? freeDeliveryProgress(nudge) : null;

  return (
    <div className={`mt-2 transition-opacity ${syncing ? "opacity-60" : ""}`}>
      <button
        type="button"
        onClick={() => { pressHaptic(); setOpen(true); }}
        aria-haspopup="dialog"
        title={t("storeDelivery.open", { name })}
        className="flex w-full items-center gap-3 rounded-2xl border border-[#e3e9f2] bg-[#f7f9fc] px-3 py-2.5 text-start hover:bg-[#f0f2f5]"
      >
        <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-full ${free ? "bg-[#e8f3ea] text-[#2f5d33]" : "bg-white text-[#0a285a]"}`}>
          <Truck className="size-[18px] rtl:-scale-x-100" />
        </span>
        {/* Where, then the trip and what it costs, then when — a line each,
            so on a phone nothing wraps under a dangling dot. */}
        <span className="min-w-0 flex-1">
          <bdi dir="auto" className="block break-words text-[13px] font-extrabold leading-5 text-[#0a285a]">{to}</bdi>
          <span className="block text-[12px] font-semibold leading-5 text-[#404553]">
            {store.choice === "fast" ? <Zap className="-mt-0.5 me-1 inline size-3.5 text-[#a44a2b]" aria-hidden /> : null}
            {kind} · <span className={free ? "font-bold text-[#2f5d33]" : "font-bold text-[#0a285a]"}>{feeText}</span>
          </span>
          {when ? <span className="block text-[12px] leading-5 ink-muted"><bdi>{when}</bdi></span> : null}
          {gone ? <span className="block text-[12px] font-bold leading-5 text-[#c2362a]">{t("storeDelivery.slotGone")}</span> : null}
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-[13px] font-bold text-[#0a285a]">
          {t("cart.change")}
          <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </span>
      </button>
      {nudge?.toFree && progress !== null ? (
        <>
          <p className="mt-1.5 text-[12px] font-bold ink-accent">{t("cart.storeToFree", { amount: money(nudge.toFree) })}</p>
          <div aria-hidden className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e7edf5]">
            <div className="h-full rounded-full bg-[#0a285a]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </>
      ) : null}
      {open ? <StoreDeliverySheet group={group} name={name} store={store} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/**
 * The store's delivery, all of it in one place: the type, the door, the day
 * and the time. Each press goes at once; the sheet draws what was pressed
 * while the bag answers, and the bag's answer once it has.
 */
function StoreDeliverySheet({ group, name, store, onClose }: { group: BagGroup; name: string; store: CartStoreDelivery; onClose: () => void }) {
  const { cart, setStoreDelivery } = useCart();
  const { t } = useTranslation();
  const money = useMoney();
  const words = useSlotWords();
  const refuse = useRefusal();
  const { address: main, isAuthenticated } = useDeliveryAddress();
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  useOverlay(true, onClose);

  /* What was pressed, drawn ahead of the bag's answer and dropped once it lands. */
  const [ahead, setAhead] = useState<StoreDeliveryChange>({});
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  useEffect(() => { setAhead({}); }, [store.choice, store.addressId, store.slot?.date, store.slot?.window]);
  useEffect(() => {
    const timer = window.setTimeout(() => sheet.current?.querySelector<HTMLElement>("input:checked, input:not(:disabled)")?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const choice = ahead.choice ?? store.choice;
  const addressId = ahead.addressId !== undefined ? ahead.addressId : store.addressId;
  const slot = ahead.slot !== undefined ? ahead.slot : store.slot;
  const day = pickedDay ?? slot?.date ?? null;
  const dayWindows = store.days.find(entry => entry.date === day)?.windows ?? [];

  const send = (change: StoreDeliveryChange) => {
    pressHaptic();
    setAhead(now => ({ ...now, ...change }));
    void setStoreDelivery(store.vendorId, change).catch(error => {
      setAhead({});
      refuse(error);
    });
  };
  const pickDay = (date: string | null) => {
    if (date === null) {
      setPickedDay(null);
      send({ slot: null });
      return;
    }
    setPickedDay(date);
    /* The time already chosen goes with the new day while that day has it. */
    const windows = store.days.find(entry => entry.date === date)?.windows ?? [];
    if (slot && windows.includes(slot.window)) send({ slot: { date, window: slot.window } });
  };

  const standardNote = store.standard.fee
    ? store.standard.freeOver
      ? `${money(store.standard.fee)} · ${t("storeDelivery.freeOver", { amount: money(store.standard.freeOver) })}`
      : money(store.standard.fee)
    : t("storeDelivery.free");
  const regularBand = slowestSpeed(group.items.map(item => (isDeliverySpeed(item.deliverySpeed) ? item.deliverySpeed : null)));
  const expressBand = store.fast?.speed && isDeliverySpeed(store.fast.speed) ? store.fast.speed : null;
  const others = (cart?.addresses ?? []).filter(address => address.id !== main?.id);
  const fee = group.delivery.reduce((sum, row) => sum + toFils(row.fee.amount), 0n);

  const radio = (props: { name: string; checked: boolean; disabled?: boolean; onChange: () => void; children: React.ReactNode; className?: string }) => (
    <label className={`relative flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#0a285a] ${props.checked ? "border-[#0a285a] bg-[#eef3fa]" : "border-[#d5dfeb] bg-white hover:bg-[#f0f2f5]"} ${props.disabled ? "cursor-not-allowed opacity-50" : ""} ${props.className ?? ""}`}>
      <input type="radio" name={props.name} checked={props.checked} disabled={props.disabled} onChange={props.onChange} className="peer sr-only" />
      <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full border-2 ${props.checked ? "border-[#0a285a]" : "border-[#b8c4d6]"}`}>
        {props.checked ? <span className="size-2.5 rounded-full bg-[#0a285a]" /> : null}
      </span>
      <span className="min-w-0 flex-1">{props.children}</span>
    </label>
  );
  const chip = (props: { name: string; checked: boolean; disabled?: boolean; onChange: () => void; children: React.ReactNode }) => (
    <label className={`relative inline-flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-2xl border px-3.5 py-1.5 text-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#0a285a] pointer-fine:min-h-9 ${props.checked ? "border-[#0a285a] bg-[#0a285a] text-white" : "border-[#d5dfeb] bg-white text-[#0a285a] hover:bg-[#f0f2f5]"} ${props.disabled ? "cursor-not-allowed opacity-40" : ""}`}>
      <input type="radio" name={props.name} checked={props.checked} disabled={props.disabled} onChange={props.onChange} className="sr-only" />
      {props.children}
    </label>
  );

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-[#061b3b]/40 sm:items-center sm:p-6" onClick={onClose}>
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="sheet-rise flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-12px_40px_rgba(10,40,90,.18)] sm:max-w-md sm:rounded-3xl"
      >
        <div className="flex items-start gap-3 border-b border-[#eef1f5] px-4 pb-3 pt-4">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-[#eef3fa] text-[#0a285a]">
            <Truck className="size-5 rtl:-scale-x-100" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[16px] font-extrabold leading-6 text-[#0a285a]">
              {t("storeDelivery.title", { name })}
            </h2>
            <p className={`text-[13px] font-bold ${fee === 0n ? "text-[#2f5d33]" : "text-[#404553]"}`}>
              {fee === 0n ? t("storeDelivery.free") : t("storeDelivery.fee", { fee: money({ amount: fromFils(fee), currencyCode: group.delivery[0]?.fee.currencyCode ?? "KWD" }) })}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="tap-target -m-1 grid size-9 shrink-0 place-items-center rounded-full text-[#536b8c] hover:bg-[#0a285a]/[.06]">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
          <fieldset>
            <legend className="mb-2 text-[13px] font-extrabold text-[#0a285a]">{t("storeDelivery.typeHeading")}</legend>
            <div className="space-y-2">
              {radio({
                name: `type-${store.vendorId}`,
                checked: choice === "regular",
                onChange: () => send({ choice: "regular" }),
                children: (
                  <>
                    <span className="flex items-center gap-2 text-[14px] font-extrabold text-[#0a285a]"><Truck className="size-4 rtl:-scale-x-100" aria-hidden />{t("storeDelivery.standard")}</span>
                    <span className="block text-[12px] leading-5 text-[#404553]">
                      {standardNote}{regularBand ? ` · ${t(`speed.${regularBand}` as MessageKey)}` : ""}
                    </span>
                  </>
                ),
              })}
              {store.fast ? radio({
                name: `type-${store.vendorId}`,
                checked: choice === "fast",
                onChange: () => send({ choice: "fast" }),
                children: (
                  <>
                    <span className="flex items-center gap-2 text-[14px] font-extrabold text-[#0a285a]"><Zap className="size-4 text-[#a44a2b]" aria-hidden />{t("storeDelivery.express")}</span>
                    <span className="block text-[12px] leading-5 text-[#404553]">
                      {cart?.delivery.memberFree ? t("delivery.fastFreeMember") : money(store.fast.fee)}{expressBand ? ` · ${t(`speed.${expressBand}` as MessageKey)}` : ""}
                    </span>
                  </>
                ),
              }) : <p className="px-1 text-[12px] leading-5 ink-muted">{t("storeDelivery.noExpress")}</p>}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[13px] font-extrabold text-[#0a285a]">{t("storeDelivery.addressHeading")}</legend>
            <div className="space-y-2">
              {radio({
                name: `door-${store.vendorId}`,
                checked: addressId === null || (main != null && addressId === main.id),
                onChange: () => send({ addressId: null }),
                children: (
                  <>
                    <span className="flex items-center gap-2 text-[14px] font-extrabold text-[#0a285a]"><MapPin className="size-4" aria-hidden />{t("address.orderAddress")}</span>
                    {main?.label ? <bdi dir="auto" className="block text-[12px] leading-5 text-[#404553]">{main.label}</bdi> : null}
                  </>
                ),
              })}
              {others.map(address => radio({
                name: `door-${store.vendorId}`,
                checked: addressId === address.id,
                onChange: () => send({ addressId: address.id }),
                children: <span dir="auto" className="flex items-center gap-2 text-[14px] font-extrabold text-[#0a285a]"><MapPin className="size-4" aria-hidden />{address.label}</span>,
              }))}
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={() => { onClose(); navigateWhenReady(appPath("/account/addresses")); }}
                  className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-[13px] font-bold text-[#0a285a] hover:bg-[#0a285a]/[.06]"
                >
                  <Plus className="size-4" aria-hidden />{t("address.add")}
                </button>
              ) : <p className="px-1 text-[12px] leading-5 ink-muted">{t("storeDelivery.signInForAddresses")}</p>}
            </div>
          </fieldset>

          {cart?.slotsReady ? (
            store.days.length ? (
              <>
                <fieldset>
                  <legend className="mb-2 flex items-center gap-1.5 text-[13px] font-extrabold text-[#0a285a]"><CalendarDays className="size-4" aria-hidden />{t("storeDelivery.dayHeading")}</legend>
                  {store.slotState === "gone" && ahead.slot === undefined ? <p className="mb-2 text-[12px] font-bold leading-5 text-[#c2362a]">{t("storeDelivery.slotGone")}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {chip({ name: `day-${store.vendorId}`, checked: day === null, onChange: () => pickDay(null), children: <span className="text-[13px] font-bold">{t("storeDelivery.anyDay")}</span> })}
                    {store.days.map(entry => (
                      <span key={entry.date}>
                        {chip({ name: `day-${store.vendorId}`, checked: day === entry.date, onChange: () => pickDay(entry.date), children: <span className="text-[13px] font-bold">{words.day(entry.date)}</span> })}
                      </span>
                    ))}
                  </div>
                </fieldset>
                {day ? (
                  <fieldset>
                    <legend className="mb-2 flex items-center gap-1.5 text-[13px] font-extrabold text-[#0a285a]"><Clock className="size-4" aria-hidden />{t("storeDelivery.timeHeading")}</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {WINDOWS.map(window => (
                        <span key={window} className="contents">
                          {chip({
                            name: `time-${store.vendorId}`,
                            checked: slot?.date === day && slot.window === window,
                            disabled: !dayWindows.includes(window),
                            onChange: () => send({ slot: { date: day, window } }),
                            children: (
                              <>
                                <span className="text-[13px] font-bold">{t(`slot.${window}` as MessageKey)}</span>
                                <span className="text-[11px] font-semibold opacity-80">{t(`slot.${window}Hours` as MessageKey)}</span>
                              </>
                            ),
                          })}
                        </span>
                      ))}
                    </div>
                    {slot?.date !== day ? <p className="mt-2 text-[12px] font-bold leading-5 ink-accent">{t("storeDelivery.pickTime")}</p> : null}
                    <p className="mt-2 text-[12px] leading-5 ink-muted">{t("storeDelivery.preferredNote")}</p>
                  </fieldset>
                ) : null}
              </>
            ) : <p className="flex items-start gap-2 rounded-2xl bg-[#f7f9fc] px-3 py-2.5 text-[12px] leading-5 ink-muted"><CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />{t("storeDelivery.noDays")}</p>
          ) : null}
        </div>

        <div className="border-t border-[#eef1f5] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
          {slot && store.slotState !== "gone" ? <p className="mb-2 text-center text-[12px] font-semibold text-[#404553]">{t("storeDelivery.preferred", { slot: words.slot(slot) })}</p> : null}
          <button type="button" onClick={onClose} className="flex min-h-12 w-full items-center justify-center rounded-full bg-[#0a285a] text-[15px] font-bold text-white hover:bg-[#0d3372]">
            {t("storeDelivery.done")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
