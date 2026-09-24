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
 */
import { useCart } from "@/contexts/CartContext";
import { useTranslation } from "@/hooks/useTranslation";
import { MapPin } from "lucide-react";

export function ItemDestinations() {
  const { cart, setDestination, loading } = useCart();
  const { t } = useTranslation();

  const book = cart?.addresses ?? [];
  const items = cart?.items ?? [];
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
    <section className="mt-8 border-t border-[#d5dfeb] pt-7">
      <div className="flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-full bg-[#0a285a] text-white">
          <MapPin className="size-4" aria-hidden />
        </div>
        <div>
          <h2 className="type-heading text-base">{t("address.sendElsewhere")}</h2>
          <p className="type-body text-[#536b8c]">{t("address.bookNote")}</p>
        </div>
      </div>

      <ul className="mt-5 space-y-3">
        {items.map(item => (
          <li key={item.lineId} className="flex flex-wrap items-center justify-between gap-3">
            <span className="type-body min-w-0 flex-1 text-[13px] text-[#0a285a]" dir="auto">
              {item.productTitle}
            </span>
            {/* The label is explicit rather than wrapped around the select:
                a <label> containing one pulls every option's text into the
                accessible name, so a screen reader reads the whole list as the
                field's name. */}
            <select
              aria-label={t("address.forLine", { name: item.productTitle })}
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
            </select>
          </li>
        ))}
      </ul>

      {split ? (
        <p className="type-body mt-4 rounded-xl border border-[#d5dfeb] bg-[#f3f2ed] p-3 text-[12px] leading-5 text-[#536b8c]">
          {t("address.splitNote")}
        </p>
      ) : null}
    </section>
  );
}
