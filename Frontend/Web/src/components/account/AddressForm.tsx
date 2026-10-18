/**
 * Adding or changing one saved address.
 *
 * Two places open it — the address book on `/account/addresses` and the
 * header's delivery dialog — and it is one component so they cannot ask for
 * different things or refuse different things. Saving refuses only what
 * `addressProblems` refuses, the same pure function the API refines on.
 *
 * The address is asked for as its parts — area, block, street, house and the
 * rest (`AddressPartsFields`) — and the line is composed from them. An address
 * saved before the parts existed keeps its line, said under the boxes, until
 * somebody fills them in.
 *
 * `requireGovernorate` is the dialog's: an address chosen there is chosen *for*
 * its governorate, which is what prices each seller's delivery, so one saved
 * without it would answer nothing. The book still allows the gap, the way the
 * server does.
 */
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { kuwaitDeliveryZones } from "@shared/customer";
import { MAX_LABEL, MAX_NOTES, addressProblems, type ShippingAddress } from "@shared/commerce/addresses";
import { cleanParts, hasParts } from "@shared/commerce/kuwaitAddress";
import { AddressPartsFields } from "@/components/account/AddressPartsFields";
import { PinPicker } from "@/components/map/PinPicker";
import { Select } from "@/components/ui/Select";
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
  pin: null,
  parts: {},
};

type Saved = { id: number; governorate?: string | null; label: string };

export function AddressForm({
  address,
  requireGovernorate = false,
  heading,
  onSaved,
  onCancel,
  cancelLabel,
  announce = true,
}: {
  /** The row being changed, or nothing for a new one. */
  address?: ShippingAddress & { id: number };
  requireGovernorate?: boolean;
  /** Its title; `null` for none, when whatever holds the form already says it. */
  heading?: string | null;
  onSaved: (row: Saved, created: boolean) => void;
  onCancel: () => void;
  cancelLabel?: string;
  /** Whether saving says so itself; off where the caller has more to say. */
  announce?: boolean;
}) {
  const { t, isArabic } = useTranslation();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<ShippingAddress>(address ? { ...BLANK, ...address } : BLANK);

  const refresh = async () => {
    await utils.customer.addresses.list.invalidate();
    /* The bag carries the book so the picker at checkout has something to
       offer without a second round trip, so it goes stale with it. */
    await utils.commerce.cart.get.invalidate();
  };
  const refused = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("account.preferenceFailed"));

  const add = trpc.customer.addresses.add.useMutation({
    onSuccess: async row => {
      if (announce) toast.success(t("address.saved"));
      await refresh();
      if (row) onSaved(row, true);
    },
    onError: refused,
  });
  const update = trpc.customer.addresses.update.useMutation({
    onSuccess: async row => {
      if (announce) toast.success(t("address.saved"));
      await refresh();
      if (row) onSaved(row, false);
    },
    onError: refused,
  });

  const problems: MessageKey[] = [
    ...addressProblems(draft),
    ...(requireGovernorate && !draft.governorate?.trim() ? (["address.needsGovernorate"] as const) : []),
  ];
  const saving = add.isPending || update.isPending;

  const save = () => {
    const payload = {
      label: draft.label.trim(),
      contactName: draft.contactName?.trim() || null,
      contactPhone: draft.contactPhone?.trim() || null,
      governorate: draft.governorate?.trim() || null,
      /* The line is composed on the server when there are parts; an older
         address with none keeps the one it had. */
      addressLine: hasParts(draft.parts) ? undefined : (draft.addressLine ?? "").trim(),
      addressNotes: draft.addressNotes?.trim() || null,
      pin: draft.pin ?? null,
      parts: cleanParts(draft.parts),
    };
    if (address) update.mutate({ id: address.id, ...payload });
    else add.mutate(payload);
  };

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        if (problems.length === 0) save();
      }}
      className="rounded-2xl border border-[#e6e9ef] bg-white p-5"
    >
      {heading === null ? null : (
        <h3 className="text-[14px] font-extrabold text-[#0a285a]">
          {heading ?? (address ? t("address.editTitle") : t("address.addTitle"))}
        </h3>
      )}
      <div className={`${heading === null ? "" : "mt-4 "}grid gap-3 sm:grid-cols-2`}>
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
          {/* Named explicitly: a label wrapping the list would pull every
              option's text into the field's name. */}
          <Select
            aria-label={t("address.governorate")}
            value={draft.governorate ?? ""}
            onChange={event => setDraft(d => ({ ...d, governorate: event.target.value }))}
            className={`${field} mt-1 font-normal`}
          >
            {requireGovernorate ? <option value="" disabled>{t("delivery.selectGovernorate")}</option> : <option value="">—</option>}
            {kuwaitDeliveryZones.map(zone => (
              <option key={zone.id} value={zone.id}>
                {isArabic ? zone.labelAr : zone.label}
              </option>
            ))}
          </Select>
        </label>
        <AddressPartsFields
          parts={draft.parts ?? {}}
          governorate={draft.governorate}
          onChange={parts => setDraft(d => ({ ...d, parts }))}
          onGovernorate={governorate => setDraft(d => ({ ...d, governorate }))}
          fieldClass={field}
          labelClass="text-[12px] font-bold text-[#536b8c]"
        />
        {/* Saved as one line before the parts existed: kept until replaced. */}
        {!hasParts(draft.parts) && draft.addressLine?.trim() ? (
          <p className="text-[12px] leading-5 ink-muted sm:col-span-2">
            {t("address.legacyLine")} <bdi className="font-semibold text-[#0a285a]">{draft.addressLine}</bdi>
          </p>
        ) : null}
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
        <div className="sm:col-span-2">
          <PinPicker value={draft.pin ?? null} onChange={pin => setDraft(d => ({ ...d, pin }))} governorate={draft.governorate} />
        </div>
      </div>

      {/* What is wrong, named. A form that only greys the button leaves
          somebody guessing which field it meant. */}
      {problems.length > 0 && (draft.label || draft.addressLine || hasParts(draft.parts)) ? (
        <ul className="mt-3 space-y-1 text-[12px] text-[#8c2f22]">
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
        <button type="button" onClick={onCancel} className="glass pressable rounded-full px-5 py-2.5 text-[13px] font-bold">
          {cancelLabel ?? t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
