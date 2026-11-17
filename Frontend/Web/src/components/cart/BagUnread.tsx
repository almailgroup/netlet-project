import { ShoppingBag } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * The stored bag could not be read (`unread`): what is in it is not known, so
 * it is never called empty. Said with another try, and asked again by itself
 * when the connection or the tab comes back.
 */
export function BagUnread({ heading = "h3" }: { heading?: "h2" | "h3" }) {
  const { t } = useTranslation();
  const { readAgain } = useCart();
  const Heading = heading;
  return (
    <div role="status" className="flex flex-1 flex-col items-center justify-center px-8 py-10 text-center">
      <div className="grid size-16 place-items-center rounded-full bg-[#e7edf5] text-[#0a285a]"><ShoppingBag className="size-7" /></div>
      <Heading className="mt-5 text-lg font-extrabold text-[#0a285a]">{t("cart.loadFailed")}</Heading>
      <p className="mt-2 text-sm leading-6 text-[#536b8c]">{t("common.loadFailedNote")}</p>
      <button type="button" onClick={readAgain} className="glass glass-navy pressable mt-6 rounded-full px-5 py-3 text-xs font-extrabold">{t("home.refreshCatalog")}</button>
    </div>
  );
}
