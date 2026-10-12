/**
 * Where the shop delivers to: the shopper's own addresses.
 *
 * It asked "choose your governorate" — six tiles — and a shopper does not
 * think of where they live as a governorate. They think "home" or "the
 * office", and they already told the shop exactly where those are. So the
 * header's delivery button opens the address book: pick one and the shop
 * delivers there (its governorate prices each seller's delivery, and checkout
 * starts from it — the same memory, `lib/lastAddress`), change one with its
 * pencil, or add a new one. With nothing saved, the dialog *is* the new-address
 * form, because the only useful thing to do there is make one.
 *
 * The form is `AddressForm`, the one the account page uses, so the two cannot
 * ask for different things. Here it insists on a governorate, since an address
 * chosen for delivery is chosen for exactly that.
 *
 * **Signed out there is no book to open** — addresses belong to an account —
 * so it offers to sign in, and keeps the governorate tiles beneath as the one
 * thing a guest can do: see what delivery costs. Signing in happens over the
 * dialog, which comes back as the address book once the session exists.
 *
 * **Portalled to `<body>`.** The header that opens it once carried
 * `backdrop-filter`, which makes it the containing block for every
 * `position: fixed` descendant: rendered inside the bar, `inset-0` resolved
 * against a 120px header and the dialog hung off the top of the screen.
 */
import { AddressForm } from "@/components/account/AddressForm";
import { useCustomer } from "@/contexts/CustomerContext";
import { useAuth } from "@/hooks/useAuth";
import { useLastAddressId } from "@/hooks/useLastAddressId";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { DEMO_MODE } from "@/lib/demoMode";
import { addressInUse, rememberAddress } from "@/lib/lastAddress";
import { trpc } from "@/lib/trpc";
import { MAX_ADDRESSES } from "@shared/commerce/addresses";
import { kuwaitDeliveryZones } from "@shared/customer";
import { Check, MapPin, Pencil, Plus, X } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Link } from "wouter";

const AuthDialog = lazy(() => import("@/components/auth/AuthDialog"));

type Row = { id: number; label: string; governorate?: string | null; addressLine?: string | null };

export function DeliveryZoneDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { deliveryZoneId, setDeliveryZoneId } = useCustomer();
  const { isArabic, t } = useTranslation();
  const { isAuthenticated, loading: sessionLoading } = useAuth();
  const book = trpc.customer.addresses.list.useQuery(undefined, { enabled: open && isAuthenticated, staleTime: 5 * 60 * 1000 });
  const lastId = useLastAddressId();
  /* `null` is the list; `0` is a new address; anything else is that address. */
  const [form, setForm] = useState<number | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);

  useOverlay(open && !authOpen, onClose);

  /* Every opening starts from the list. */
  useEffect(() => {
    if (!open) setForm(null);
  }, [open]);

  const rows: Row[] = isAuthenticated ? book.data ?? [] : [];
  const loaded = isAuthenticated ? book.isSuccess : !sessionLoading;
  const empty = isAuthenticated && loaded && rows.length === 0;
  const showingForm = isAuthenticated && loaded && (form !== null || empty);
  const chosenId = addressInUse(rows, lastId, deliveryZoneId)?.id ?? null;

  /*
   * Focus follows the view. Declared after `useOverlay`, so the opener it
   * records is the header's button rather than whatever this moves focus to:
   * the form's first field when there is a form, else the chosen address, else
   * the first thing in the panel. Every press here replaces what was pressed.
   */
  useEffect(() => {
    if (!open || authOpen || !loaded) return;
    const root = panel.current;
    if (!root) return;
    const target = showingForm
      ? root.querySelector<HTMLElement>("form input")
      : root.querySelector<HTMLElement>("[data-chosen=true]") ?? root.querySelector<HTMLElement>("[data-first]");
    target?.focus();
  }, [open, authOpen, loaded, showingForm, form]);

  if (!open) return null;
  if (authOpen) {
    return createPortal(
      <Suspense fallback={null}>
        <AuthDialog open onClose={() => setAuthOpen(false)} />
      </Suspense>,
      document.body,
    );
  }

  const zoneName = (id: string | null | undefined) => {
    const zone = kuwaitDeliveryZones.find(entry => entry.id === id);
    return zone ? (isArabic ? zone.labelAr : zone.label) : null;
  };

  const choose = (row: Row) => {
    /* An address with no governorate cannot price a delivery; opening it to
       fill that in is the useful answer to pressing it. */
    if (!row.governorate || !zoneName(row.governorate)) {
      setForm(row.id);
      return;
    }
    setDeliveryZoneId(row.governorate);
    rememberAddress(row.id);
    onClose();
  };

  const saved = (row: Row, created: boolean) => {
    if (created && row.governorate) {
      setDeliveryZoneId(row.governorate);
      rememberAddress(row.id);
      toast.success(t("delivery.savedAndDelivering", { label: row.label }));
      onClose();
      return;
    }
    toast.success(t("address.saved"));
    /* Changing the address being delivered to moves the delivery with it. */
    if (row.id === chosenId && row.governorate) setDeliveryZoneId(row.governorate);
    setForm(null);
  };

  const heading = empty ? t("delivery.firstTitle") : t("delivery.title");
  const note = !isAuthenticated ? t("delivery.signInNote") : empty ? t("delivery.firstNote") : t("delivery.addressNote");
  const editing = form ? rows.find(row => row.id === form) : undefined;

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-end bg-[#061b3b]/35 p-3 sm:items-center sm:justify-center" onClick={onClose}>
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-title"
        aria-describedby="delivery-note"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.5rem] bg-background p-5 shadow-2xl sm:p-7"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="delivery-title" className="text-xl font-extrabold text-[#0a285a]">{heading}</h2>
            <p id="delivery-note" className="mt-2 text-sm leading-6 text-[#536b8c]">{note}</p>
          </div>
          <button onClick={onClose} aria-label={t("delivery.close")} title={t("delivery.close")} className="glass pressable grid size-10 shrink-0 place-items-center rounded-full">
            <X className="size-5" />
          </button>
        </div>

        {!loaded ? (
          <div className="mt-6 grid gap-2" aria-hidden>
            {[0, 1].map(index => <div key={index} className="h-[72px] animate-pulse rounded-2xl bg-[#e9edf3]" />)}
          </div>
        ) : !isAuthenticated ? (
          <>
            <button
              type="button"
              data-first
              onClick={() => (DEMO_MODE ? toast(t("header.signInDisabled"), { description: t("header.signInDisabledNote") }) : setAuthOpen(true))}
              className="glass glass-navy pressable mt-5 inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-extrabold"
            >
              {t("header.signIn")}
            </button>
            <h3 className="mt-7 text-[13px] font-bold ink-muted">{t("delivery.guestZones")}</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {kuwaitDeliveryZones.map(zone => (
                <button
                  key={zone.id}
                  onClick={() => { setDeliveryZoneId(zone.id); onClose(); }}
                  aria-pressed={deliveryZoneId === zone.id}
                  className={`pressable rounded-2xl border p-4 text-start ${deliveryZoneId === zone.id ? "border-[#0a285a] bg-white" : "border-[#d5dfeb] bg-white hover:border-[#aac0da] hover:bg-[#f0f2f5]"}`}
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-extrabold text-[#0a285a]">
                    {isArabic ? zone.labelAr : zone.label}
                    {deliveryZoneId === zone.id ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : showingForm ? (
          <div className="mt-5">
            <AddressForm
              key={form ?? 0}
              address={editing}
              requireGovernorate
              announce={false}
              /* With nothing saved the dialog's own heading says it already. */
              heading={empty ? null : undefined}
              onSaved={saved}
              onCancel={() => (empty ? onClose() : setForm(null))}
              cancelLabel={empty ? undefined : t("delivery.back")}
            />
          </div>
        ) : (
          <>
            <ul className="mt-5 grid gap-2">
              {rows.map((row, index) => {
                const chosen = row.id === chosenId;
                const zone = zoneName(row.governorate);
                return (
                  <li key={row.id} className="flex items-stretch gap-2">
                    <button
                      type="button"
                      onClick={() => choose(row)}
                      aria-pressed={chosen}
                      data-chosen={chosen}
                      data-first={index === 0 ? true : undefined}
                      className={`pressable flex min-w-0 flex-1 items-center gap-3 rounded-2xl border bg-white p-4 text-start ${chosen ? "border-[#0a285a] shadow-[inset_0_0_0_1px_#0a285a]" : "border-[#d5dfeb] hover:border-[#aac0da] hover:bg-[#f0f2f5]"}`}
                    >
                      <MapPin className="size-4 shrink-0 ink-accent" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span dir="auto" className="block truncate text-sm font-extrabold text-[#0a285a]">{row.label}</span>
                        {zone ? (
                          <span className="block truncate text-xs ink-muted">
                            <bdi>{zone}</bdi>
                            {row.addressLine ? <> · <bdi dir="auto">{row.addressLine}</bdi></> : null}
                          </span>
                        ) : (
                          <span className="block truncate text-xs font-semibold ink-accent">{t("delivery.needsGovernorate")}</span>
                        )}
                      </span>
                      {chosen ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e7edf5] px-2 py-1 text-[11px] font-bold text-[#0a285a]">
                          <Check className="size-3.5" aria-hidden />
                          <span className="hidden min-[380px]:inline">{t("delivery.chosenAddress")}</span>
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(row.id)}
                      aria-label={`${t("address.editTitle")} — ${row.label}`}
                      title={t("address.editTitle")}
                      className="pressable grid w-12 shrink-0 place-items-center rounded-2xl border border-[#d5dfeb] bg-white text-[#0a285a] hover:border-[#aac0da] hover:bg-[#f0f2f5]"
                    >
                      <Pencil className="size-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              onClick={() => setForm(0)}
              disabled={rows.length >= MAX_ADDRESSES}
              className="pressable mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#b8c9dc] bg-white p-4 text-sm font-extrabold text-[#0a285a] hover:bg-[#f0f2f5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="size-4" aria-hidden /> {t("delivery.addNew")}
            </button>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className="ink-muted">{t("address.count", { count: rows.length, max: MAX_ADDRESSES })}</span>
              <Link href="/account/addresses" onClick={onClose} className="font-bold text-[#0a285a] underline underline-offset-2">
                {t("delivery.manage")}
              </Link>
            </div>
          </>
        )}
      </section>
    </div>,
    document.body,
  );
}
