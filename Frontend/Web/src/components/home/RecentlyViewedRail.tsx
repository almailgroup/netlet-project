/**
 * "Previously viewed": what this device opened lately, newest first, so a
 * shopper comes back to something without searching for it again — on the
 * owner's word. The list is the device's own (`lib/recentlyViewed.ts`) and the
 * products are read back by id, so the cards carry today's price and photo;
 * a product no longer on the shelf is simply not drawn. Drawn from one,
 * because it is this shopper's own history and a short one is still theirs,
 * not a shelf that fell short. Clear empties the device's list and says so.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { TabbedShelf, type ShelfCardProps } from "@/components/home/ProductShelf";
import { useProductsByIds } from "@/hooks/useCatalog";
import { useTranslation } from "@/hooks/useTranslation";
import { clearViewed, viewedIds } from "@/lib/recentlyViewed";

export function RecentlyViewedRail(cards: ShelfCardProps) {
  const { t } = useTranslation();
  /* Read once as the page appears: a product opened from this shelf joins it on the next visit, not under the finger. */
  const [ids, setIds] = useState(() => viewedIds());
  const { byId } = useProductsByIds(ids, { enabled: ids.length > 0 });
  /* In the order they were opened, newest first; one the shop no longer shows is not drawn. */
  const products = useMemo(() => ids.flatMap(id => byId.get(id) ?? []), [ids, byId]);
  if (products.length === 0) return null;

  const clear = () => {
    clearViewed();
    setIds([]);
    toast(t("rail.viewed.cleared"));
  };

  return (
    <TabbedShelf id="viewed" title="rail.viewed.title" products={products} layout="rail" tabs={false} {...cards}>
      <button type="button" onClick={clear} className="pressable inline-flex min-h-11 items-center rounded-full px-3 text-sm font-bold ink-muted hover:underline">
        {t("rail.viewed.clear")}
      </button>
    </TabbedShelf>
  );
}
