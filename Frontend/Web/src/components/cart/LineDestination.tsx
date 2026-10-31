/**
 * Where one line of the bag goes, on the owner's word ("add a delivery icon
 * below the 3-dots menu for each product in the cart … to choose a specific
 * delivery address for that individual product").
 *
 * **Every line goes where the order goes until it is told otherwise**: the
 * address in use, which the cart's first card names (`DeliveryAddressCard`).
 * The button under the line's "⋯" opens the shopper's saved addresses — that
 * one first, as "The order's main address", then the rest — and the choice is
 * the line's own (`commerce.setDestination`, stored on the bag's line and
 * frozen on the order's), said under the line's name as "Going to …". This is
 * 3.2.6, which checkout asked for behind "Deliver this elsewhere" until the
 * address moved to the cart; checkout draws neither now.
 *
 * The button is navy while the line is going somewhere of its own and the
 * muted ink otherwise. A guest has no book, so a guest's line has no button;
 * an account with nothing saved is offered "Add an address", which opens the
 * account's address book.
 */
import { LinePopover, type LineAction } from "@/components/cart/LinePopover";
import { useDeliveryAddress } from "@/components/cart/DeliveryAddressCard";
import { useCart } from "@/contexts/CartContext";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { navigateWhenReady } from "@/lib/readyNavigation";
import type { CartItem } from "@shared/commerce/types";
import { House, MapPin, Plus, Truck } from "lucide-react";
import { toast } from "sonner";

export function LineDestination({ item, title }: { item: CartItem; title: string }) {
  const { t } = useTranslation();
  const { cart, setDestination, closeCart } = useCart();
  const { address: main, isAuthenticated } = useDeliveryAddress();
  if (!isAuthenticated) return null;

  const send = (addressId: number | null) =>
    void setDestination(item.lineId, addressId).catch(() => toast.error(t("cart.updateFailed")));
  const current = item.destination?.id ?? null;
  /* The address in use is the line's default, so it is not offered twice. */
  const others = (cart?.addresses ?? []).filter(address => address.id !== main?.id);

  const actions: LineAction[] = [
    {
      key: "main",
      icon: <House className="size-[18px]" aria-hidden />,
      label: t("address.orderAddress"),
      note: main?.label || undefined,
      checked: current === null || current === main?.id,
      run: () => send(null),
    },
    ...others.map(address => ({
      key: `address-${address.id}`,
      icon: <MapPin className="size-[18px]" aria-hidden />,
      label: address.label,
      checked: current === address.id,
      run: () => send(address.id),
    })),
    {
      key: "add",
      icon: <Plus className="size-[18px]" aria-hidden />,
      label: t("address.add"),
      run: () => { closeCart(); navigateWhenReady(appPath("/account/addresses")); },
    },
  ];

  return (
    <LinePopover
      item={item}
      title={title}
      label={t("address.forLine", { name: title })}
      short={t("address.lineShort")}
      intro={t("address.lineIntro")}
      trigger={<Truck className="size-[18px] rtl:-scale-x-100" aria-hidden />}
      actions={actions}
      active={current !== null && current !== main?.id}
    />
  );
}
