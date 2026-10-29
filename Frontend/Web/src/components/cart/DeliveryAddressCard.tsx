/**
 * Where the order goes, as a card: the cart asks it, checkout confirms it.
 *
 * **The address is chosen in the cart, on the owner's word** ("it should ask
 * you to choose your delivery location in the cart page, not in checkout"):
 * checkout used to be a form of governorate, area, block, street, house, name,
 * number and a map, every time. Now the cart opens on this card — the address
 * in use (`addressInUse`, the header's own rule, so the header, the cart and
 * checkout name one address) or a question — and its Change opens the address
 * book (`DeliveryZoneDialog`), whose new-address form is the account page's.
 * Checkout draws the same card to confirm it, with Change beside it, because
 * Buy now goes there without passing the cart.
 *
 * A guest has no book: the card names the area delivery is priced for, if
 * one was chosen, and says signing in is what lets the shop deliver to an
 * address; the dialog offers both.
 */
import { CARD } from "@/components/layout/Page";
import { useCustomer } from "@/contexts/CustomerContext";
import { useAuth } from "@/hooks/useAuth";
import { useLastAddressId } from "@/hooks/useLastAddressId";
import { useTranslation } from "@/hooks/useTranslation";
import { pressHaptic } from "@/lib/haptics";
import { addressInUse } from "@/lib/lastAddress";
import { lazyPage } from "@/lib/lazyPage";
import { trpc } from "@/lib/trpc";
import { addressLineIn } from "@shared/commerce/addresses";
import { formatPhone } from "@shared/commerce/wishlist";
import { MapPin } from "lucide-react";
import { Suspense } from "react";

export const DeliveryZoneDialog = lazyPage(async () => ({ default: (await import("@/components/layout/DeliveryZoneDialog")).DeliveryZoneDialog }));

/** The saved address the order is going to, if there is one, and whether the book has answered. */
export function useDeliveryAddress() {
  const { isAuthenticated, loading } = useAuth();
  const { deliveryZoneId, deliveryZone } = useCustomer();
  const book = trpc.customer.addresses.list.useQuery(undefined, { enabled: isAuthenticated, staleTime: 5 * 60 * 1000 });
  const lastId = useLastAddressId();
  const address = isAuthenticated ? addressInUse(book.data ?? [], lastId, deliveryZoneId) : null;
  return {
    address,
    book: book.data ?? [],
    loaded: isAuthenticated ? book.isSuccess : !loading,
    isAuthenticated,
    zone: deliveryZone,
  };
}

export function DeliveryAddressCard({ open, onOpen, onClose, accountName, accountPhone }: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Who the order is for when the address names nobody. */
  accountName?: string | null;
  /** The number on "Your profile", when the address carries none. */
  accountPhone?: string | null;
}) {
  const { t, isArabic } = useTranslation();
  const { address, loaded, isAuthenticated, zone } = useDeliveryAddress();
  const zoneName = zone ? (isArabic ? zone.labelAr : zone.label) : null;
  const line = address ? addressLineIn(address, isArabic) : "";
  const name = address?.contactName?.trim() || accountName?.trim() || "";
  const phone = address?.contactPhone ? formatPhone(address.contactPhone) : accountPhone ?? "";
  return (
    <section aria-labelledby="deliver-to-title" className={`${CARD} p-4 sm:p-5`}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-[#fdf3ee]">
          <MapPin className="size-[18px] ink-accent" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="deliver-to-title" className="text-[12px] font-semibold leading-4 ink-muted">{t("home.deliverTo")}</h2>
          {!loaded ? (
            <div aria-hidden className="mt-1.5 space-y-1.5">
              <div className="h-4 w-1/3 animate-pulse rounded bg-[#e7edf5]" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-[#e7edf5]" />
            </div>
          ) : address ? (
            <>
              <p dir="auto" className="mt-0.5 text-[15px] font-extrabold leading-5 text-[#0a285a]">{address.label}</p>
              {name || phone ? (
                <p className="mt-1 text-[13px] font-semibold leading-5 text-[#404553]">
                  {name ? <bdi>{name}</bdi> : null}
                  {name && phone ? " · " : null}
                  {phone ? <bdi dir="ltr">{phone}</bdi> : null}
                </p>
              ) : null}
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 ink-muted">
                {zoneName ? <bdi>{zoneName}</bdi> : null}
                {zoneName && line ? " · " : null}
                {line ? <bdi dir="auto">{line}</bdi> : null}
              </p>
            </>
          ) : isAuthenticated ? (
            <>
              <p className="mt-0.5 text-[15px] font-extrabold leading-5 text-[#0a285a]">{t("cart.chooseAddress")}</p>
              <p className="mt-0.5 text-[13px] leading-5 ink-muted">{t("cart.chooseAddressNote")}</p>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-[15px] font-extrabold leading-5 text-[#0a285a]">{zoneName ? t("cart.pricedFor", { area: zoneName }) : t("cart.chooseArea")}</p>
              <p className="mt-0.5 text-[13px] leading-5 ink-muted">{t("cart.guestAddressNote")}</p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => { pressHaptic(); onOpen(); }}
          aria-label={address ? t("cart.changeAddress") : undefined}
          className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-bold ${address ? "border border-[#0a285a]/20 bg-white text-[#0a285a] hover:bg-[#f0f2f5]" : "bg-[#0a285a] text-white hover:bg-[#0d3372]"}`}
        >
          {address ? t("cart.change") : t("cart.choose")}
        </button>
      </div>
      {open ? <Suspense fallback={null}><DeliveryZoneDialog open onClose={onClose} /></Suspense> : null}
    </section>
  );
}
