/**
 * The shopper's delivery addresses (3.2.6).
 *
 * This exists because a basket may go to more than one door, and picking a
 * second door only works if there is a book to pick from: typing a full street
 * address per line at checkout is not a feature, it is a punishment.
 *
 * Saving refuses only what is actively wrong — `addressProblems`, the same
 * pure function the API refines on, so the form cannot accept what the server
 * refuses or refuse what it accepts. What is merely absent is listed on the
 * card instead, the direction `missingStoreDetails` and the return window both
 * err in: a governorate nobody filled in is a gap in our form, not a reason to
 * throw away what somebody typed.
 */
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { isMessageKey } from "@shared/i18n/dictionary";
import { kuwaitDeliveryZones } from "@shared/customer";
import {
  MAX_ADDRESSES,
  MAX_LABEL,
  MAX_LINE,
  MAX_NOTES,
  addressProblems,
  missingFromAddress,
  type ShippingAddress,
} from "@shared/commerce/addresses";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const field =
  "glass-field w-full rounded-xl px-4 py-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#0a285a]/30";

const BLANK: ShippingAddress = {
  label: "",
  contactName: "",
  contactPhone: "",
  governorate: "",
  addressLine: "",
  addressNotes: "",
};

export function AddressBook() {
  const { t, isArabic } = useTranslation();
  const addresses = trpc.customer.addresses.list.useQuery();
  const utils = trpc.useUtils();

  /* `null` is closed, `0` is the new-address form, anything else is that row. */
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<ShippingAddress>(BLANK);
  const [removing, setRemoving] = useState<number | null>(null);

  const refresh = async () => {
    await utils.customer.addresses.list.invalidate();
    /* The bag carries the book so the picker at checkout has something to
       offer without a second round trip, so it goes stale with it. */
    await utils.commerce.cart.get.invalidate();
  };
  const refused = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("account.preferenceFailed"));

  const add = trpc.customer.addresses.add.useMutation({
    onSuccess: async () => {
      toast.success(t("address.saved"));
      setEditing(null);
      await refresh();
    },
    onError: refused,
  });
  const update = trpc.customer.addresses.update.useMutation({
    onSuccess: async () => {
      toast.success(t("address.saved"));
      setEditing(null);
      await refresh();
    },
    onError: refused,
  });
  const remove = trpc.customer.addresses.remove.useMutation({
    onSuccess: async () => {
      toast.success(t("address.removed"));
      setRemoving(null);
      await refresh();
    },
    onError: refused,
  });

  const rows = addresses.data ?? [];
  const problems = addressProblems(draft);
  const saving = add.isPending || update.isPending;

  const open = (row?: (typeof rows)[number]) => {
    setDraft(row ? { ...BLANK, ...row } : BLANK);
    setEditing(row ? row.id : 0);
  };

  const save = () => {
    const payload = {
      label: draft.label.trim(),
      contactName: draft.contactName?.trim() || null,
      contactPhone: draft.contactPhone?.trim() || null,
      governorate: draft.governorate?.trim() || null,
      addressLine: (draft.addressLine ?? "").trim(),
      addressNotes: draft.addressNotes?.trim() || null,
    };
    if (editing && editing > 0) update.mutate({ id: editing, ...payload });
    else add.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-6 text-[#536b8c]">{t("address.bookNote")}</p>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">
          {t("address.none")}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map(row => {
            const zone = kuwaitDeliveryZones.find(area => area.id === row.governorate);
            const gaps = missingFromAddress(row);
            return (
              <li key={row.id} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#0a285a]">
                    <MapPin className="size-3.5 ink-accent" aria-hidden />
                    <span dir="auto">{row.label}</span>
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => open(row)}
                      aria-label={`${t("address.editTitle")} — ${row.label}`}
                      className="glass tap-target grid size-8 place-items-center rounded-full"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRemoving(row.id)}
                      aria-label={`${t("address.remove")} — ${row.label}`}
                      className="glass tap-target grid size-8 place-items-center rounded-full"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-[#536b8c]" dir="auto">
                  {row.addressLine}
                </p>
                <p className="mt-1 text-[11px] text-[#536b8c]">
                  {[
                    zone ? (isArabic ? zone.labelAr : zone.label) : null,
                    row.contactName,
                    /* A phone number is Latin on an Arabic page, so it is
                       isolated rather than given the block a direction. */
                    row.contactPhone,
                  ]
                    .filter(Boolean)
                    .map((part, index) => (
                      <span key={index}>
                        {index > 0 ? " · " : null}
                        <bdi dir="auto">{part}</bdi>
                      </span>
                    ))}
                </p>
                {gaps.length > 0 ? (
                  <p className="mt-2 text-[11px] ink-muted">{gaps.map(key => t(key)).join(" · ")}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editing === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => open()}
            disabled={rows.length >= MAX_ADDRESSES}
            className="glass glass-navy pressable inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden /> {t("address.add")}
          </button>
          <p className="text-[11px] ink-muted">
            {t("address.count", { count: rows.length, max: MAX_ADDRESSES })}
          </p>
        </div>
      ) : (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (problems.length === 0) save();
          }}
          className="rounded-2xl border border-[#e6e9ef] bg-white p-5"
        >
          <h3 className="text-[13px] font-extrabold text-[#0a285a]">
            {editing > 0 ? t("address.editTitle") : t("address.addTitle")}
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-[12px] font-bold text-[#536b8c]">
              {t("address.label")}
              <input
                value={draft.label}
                maxLength={MAX_LABEL}
                onChange={event => setDraft(d => ({ ...d, label: event.target.value }))}
                placeholder={t("address.labelPlaceholder")}
                className={`${field} mt-1 font-normal`}
              />
            </label>
            <label className="text-[12px] font-bold text-[#536b8c]">
              {t("address.governorate")}
              {/* Named explicitly, because a <label> wrapping a <select> pulls
                  every option's text into the accessible name — so this would
                  otherwise be called "Governorate—Capital (Al Asimah)Hawalli…".
                  The same defect the portal's own selects already carry a
                  comment about. */}
              <select
                aria-label={t("address.governorate")}
                value={draft.governorate ?? ""}
                onChange={event => setDraft(d => ({ ...d, governorate: event.target.value }))}
                className={`${field} mt-1 font-normal`}
              >
                <option value="">—</option>
                {kuwaitDeliveryZones.map(zone => (
                  <option key={zone.id} value={zone.id}>
                    {isArabic ? zone.labelAr : zone.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-bold text-[#536b8c] sm:col-span-2">
              {t("address.line")}
              <input
                value={draft.addressLine ?? ""}
                maxLength={MAX_LINE}
                onChange={event => setDraft(d => ({ ...d, addressLine: event.target.value }))}
                className={`${field} mt-1 font-normal`}
              />
            </label>
            <label className="text-[12px] font-bold text-[#536b8c]">
              {t("address.contactName")}
              <input
                value={draft.contactName ?? ""}
                maxLength={160}
                onChange={event => setDraft(d => ({ ...d, contactName: event.target.value }))}
                className={`${field} mt-1 font-normal`}
              />
            </label>
            <label className="text-[12px] font-bold text-[#536b8c]">
              {t("address.contactPhone")}
              {/* `dir` on a form control sets the typing direction, which is
                  what a Latin phone number wants — and is the one place
                  `markup.test.ts` allows it. */}
              <input
                value={draft.contactPhone ?? ""}
                maxLength={40}
                dir="ltr"
                inputMode="tel"
                onChange={event => setDraft(d => ({ ...d, contactPhone: event.target.value }))}
                className={`${field} mt-1 font-normal`}
              />
            </label>
            <label className="text-[12px] font-bold text-[#536b8c] sm:col-span-2">
              {t("address.notes")}
              <textarea
                value={draft.addressNotes ?? ""}
                maxLength={MAX_NOTES}
                onChange={event => setDraft(d => ({ ...d, addressNotes: event.target.value }))}
                className={`${field} mt-1 min-h-20 font-normal`}
              />
            </label>
          </div>

          {/* What is wrong, named. A form that only greys the button leaves
              somebody guessing which field it meant. */}
          {problems.length > 0 && (draft.label || draft.addressLine) ? (
            <ul className="mt-3 space-y-1 text-[11px] text-[#8c2f22]">
              {problems.map(key => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={problems.length > 0 || saving}
              className="glass glass-navy pressable rounded-full px-5 py-2.5 text-[13px] font-bold disabled:opacity-50"
            >
              {t("address.save")}
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="glass pressable rounded-full px-5 py-2.5 text-[13px] font-bold"
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t("address.removeTitle")}
        body={t("address.removeBody")}
        confirmLabel={t("address.remove")}
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => removing !== null && remove.mutate({ id: removing })}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}
