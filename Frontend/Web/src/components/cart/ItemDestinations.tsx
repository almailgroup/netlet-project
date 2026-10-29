/**
 * Where each thing in the basket goes (3.2.6).
 *
 * One select per line, offering the shopper's own saved addresses and "the
 * order's main address" — which is the default rather than an option they have
 * to choose, so somebody sending everything to one place never has to touch
 * this at all.
 *
 * **It draws only when there is a choice to make.** No saved addresses means
 * no second door to send anything to, and one line in the basket means there
 * is nothing to split — in both cases the control would be a question with one
 * answer, which is the dead-control rule. A guest sees nothing either: the
 * book belongs to an account, and the bag comes back with an empty one.
 *
 * The note about parcels appears only once a seller is actually being asked
 * for two, because explaining the charge to somebody who is not paying it is
 * explaining a rule that has not applied to them.
 *
 * **Folded until it is wanted** on the checkout that only confirms: most
 * orders go to one door, and a list of selects under the address was one
 * more block between the shopper and Place order.
 */
import { lineTitle } from "@/lib/lineTitle";
import { useCart } from "@/contexts/CartContext";
import { useTranslation } from "@/hooks/useTranslation";
import { ChevronDown, MapPin } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/Select";

export function ItemDestinations() {
  const { cart, setDestination, loading } = useCart();
  const { t, isArabic } = useTranslation();
  const [open, setOpen] = useState(false);

  const book = cart?.addresses ?? [];
  const items = cart?.items ?? [];
  /* Folded until it is wanted, unless a line is already going elsewhere. */
  const shown = open || items.some(item => item.destination);
  if (book.length === 0 || items.length < 2) return null;

  /*
   * Whether any one seller is being asked for two doors.
   *
   * Read off the delivery quote rather than off the lines, because the quote
   * is what actually carries the parcels: the server sends one row per parcel,
   * so a seller appearing twice *is* the split, and asking the same question a
   * second way here is how two answers come to disagree.
   */
  const perSeller = new Map<string, number>();
  for (const row of cart?.delivery.perVendor ?? []) {
    const key = String(row.vendorId ?? row.vendorName);
    perSeller.set(key, (perSeller.get(key) ?? 0) + 1);
  }
  const split = [...perSeller.values()].some(count => count > 1);

  return (
    <section className="rounded-2xl border border-[#e6e9ef] bg-white px-4 py-1.5 sm:px-5">
      <button
        type="button"
        aria-expanded={shown}
        aria-controls="item-destinations"
        onClick={() => setOpen(value => !value)}
        className="flex min-h-12 w-full items-center gap-3 text-start"
      >
        <MapPin className="size-[18px] shrink-0 text-[#536b8c]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-[#0a285a]">{t("address.sendElsewhere")}</span>
          {shown ? <span className="block text-[12px] leading-4 ink-muted">{t("address.bookNote")}</span> : null}
        </span>
        <ChevronDown className={`size-4 shrink-0 text-[#536b8c] transition-transform ${shown ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {shown ? (
      <div id="item-destinations" className="pb-3">
      <ul className="mt-2 space-y-3">
        {items.map(item => (
          <li key={item.lineId} className="flex flex-wrap items-center justify-between gap-3">
            <span className="type-body min-w-0 flex-1 text-[13px] text-[#0a285a]" dir="auto">
              {lineTitle(item, isArabic)}
            </span>
            {/* The label is explicit rather than wrapped around the select:
                a <label> containing one pulls every option's text into the
                accessible name, so a screen reader reads the whole list as the
                field's name. */}
            <Select
              aria-label={t("address.forLine", { name: lineTitle(item, isArabic) })}
              disabled={loading}
              value={item.destination?.id ?? ""}
              onChange={event =>
                void setDestination(item.lineId, event.target.value ? Number(event.target.value) : null)
              }
              className="glass-field w-full rounded-xl px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[#0a285a]/30 sm:w-auto sm:min-w-52"
            >
              <option value="">{t("address.orderAddress")}</option>
              {book.map(address => (
                <option key={address.id} value={address.id}>
                  {address.label}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>

      {split ? (
        <p className="type-body mt-4 rounded-xl border border-[#d5dfeb] bg-[#f3f2ed] p-3 text-[12px] leading-5 text-[#536b8c]">
          {t("address.splitNote")}
        </p>
      ) : null}
      </div>
      ) : null}
    </section>
  );
}
