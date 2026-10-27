/**
 * Where the shop delivers, named the way the shopper would: the saved address
 * in use by its own name ("Home"), or the area when none is — the header's
 * phone row and wide bar, and the cart's own bar on a phone, all say it the
 * same way because they all ask here.
 *
 * Only an address in the area in use (`addressInUse`) is named: an area with
 * no saved address in it is named as itself.
 */
import { useCustomer } from "@/contexts/CustomerContext";
import { useAuth } from "@/hooks/useAuth";
import { useLastAddressId } from "@/hooks/useLastAddressId";
import { useTranslation } from "@/hooks/useTranslation";
import { addressInUse } from "@/lib/lastAddress";
import { trpc } from "@/lib/trpc";

export function useDeliveryArea(): { name: string; title: string } {
  const { t, isArabic } = useTranslation();
  const { deliveryZone } = useCustomer();
  const { isAuthenticated } = useAuth();
  const book = trpc.customer.addresses.list.useQuery(undefined, { enabled: isAuthenticated, staleTime: 5 * 60 * 1000 });
  const lastAddressId = useLastAddressId();
  const zoneName = deliveryZone ? (isArabic ? deliveryZone.labelAr : deliveryZone.label) : t("home.chooseAreaShort");
  const deliveringTo = isAuthenticated ? addressInUse(book.data ?? [], lastAddressId, deliveryZone?.id) : null;
  return {
    name: deliveringTo ? deliveringTo.label : zoneName,
    title: deliveringTo ? `${t("delivery.buttonTitle")}: ${deliveringTo.label}, ${zoneName}` : t("delivery.buttonTitle"),
  };
}
