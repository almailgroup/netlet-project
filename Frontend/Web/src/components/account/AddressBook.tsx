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
import { MAX_ADDRESSES, addressLineIn, missingFromAddress } from "@shared/commerce/addresses";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PinLink } from "@/components/map/PinLink";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DiscButton } from "@/components/ui/DiscButton";
import { AddressForm } from "@/components/account/AddressForm";

export function AddressBook() {
  const { t, isArabic } = useTranslation();
  const addresses = trpc.customer.addresses.list.useQuery();
  const utils = trpc.useUtils();

  /* `null` is closed, `0` is the new-address form, anything else is that row. */
  const [editing, setEditing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  const refresh = async () => {
    await utils.customer.addresses.list.invalidate();
    /* The bag carries the book so the picker at checkout has something to
       offer without a second round trip, so it goes stale with it. */
    await utils.commerce.cart.get.invalidate();
  };
  const refused = (error: { message: string }) =>
    toast.error(isMessageKey(error.message) ? t(error.message) : t("account.preferenceFailed"));

  const remove = trpc.customer.addresses.remove.useMutation({
    onSuccess: async () => {
      toast.success(t("address.removed"));
      setRemoving(null);
      await refresh();
    },
    onError: refused,
  });

  const rows = addresses.data ?? [];
  const open = (row?: (typeof rows)[number]) => setEditing(row ? row.id : 0);

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
                  <div className="flex items-center gap-3">
                    {/* Twelve pixels apart, so the two 44px targets meet rather
                        than overlap and a press on the gap goes to neither. */}
                    <DiscButton onClick={() => open(row)} aria-label={`${t("address.editTitle")} — ${row.label}`} className="-m-1.5">
                      <Pencil className="size-3.5" aria-hidden />
                    </DiscButton>
                    <DiscButton onClick={() => setRemoving(row.id)} aria-label={`${t("address.remove")} — ${row.label}`} className="-m-1.5">
                      <Trash2 className="size-3.5" aria-hidden />
                    </DiscButton>
                  </div>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-[#536b8c]" dir="auto">
                  {addressLineIn(row, isArabic)}
                </p>
                <p className="mt-1 text-[12px] text-[#536b8c]">
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
                {row.pin ? (
                  <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-bold text-[#0a285a]">
                    {t("address.pinned")}
                    <PinLink pin={row.pin} />
                  </p>
                ) : null}
                {gaps.length > 0 ? (
                  <p className="mt-2 text-[12px] ink-muted">{gaps.map(key => t(key)).join(" · ")}</p>
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
          <p className="text-[12px] ink-muted">
            {t("address.count", { count: rows.length, max: MAX_ADDRESSES })}
          </p>
        </div>
      ) : (
        <AddressForm
          key={editing}
          address={editing > 0 ? rows.find(row => row.id === editing) : undefined}
          onSaved={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
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
