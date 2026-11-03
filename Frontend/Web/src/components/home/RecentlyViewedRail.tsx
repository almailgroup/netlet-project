/**
 * "Previously viewed": what this device opened lately, newest first, so a
 * shopper comes back to something without searching for it again — on the
 * owner's word. The list is the device's own (`lib/recentlyViewed.ts`) and the
 * products are read back by id, so the cards carry today's price and photo;
 * a product no longer on the shelf is simply not drawn. Drawn from one,
 * because it is this shopper's own history and a short one is still theirs,
 * not a shelf that fell short.
 *
 * **Managing it is the account's, on the owner's word** ("keep management in
 * the account, less prominent … view, remove individual, clear all"): the
 * shelf stays here and its heading links to Browsing history
 * (`/account/history`), where one product comes off or all of them do.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { TabbedShelf, type ShelfCardProps } from "@/components/home/ProductShelf";
import { useProductsByIds } from "@/hooks/useCatalog";
import { useTranslation } from "@/hooks/useTranslation";
import { viewedIds } from "@/lib/recentlyViewed";

export function RecentlyViewedRail(cards: ShelfCardProps) {
  const { t } = useTranslation();
  /* Read once as the page appears: a product opened from this shelf joins it on the next visit, not under the finger. */
  const [ids] = useState(() => viewedIds());
  const { byId } = useProductsByIds(ids, { enabled: ids.length > 0 });
  /* In the order they were opened, newest first; one the shop no longer shows is not drawn. */
  const products = useMemo(() => ids.flatMap(id => byId.get(id) ?? []), [ids, byId]);
  if (products.length === 0) return null;

  return (
    <TabbedShelf id="viewed" title="rail.viewed.title" products={products} layout="rail" tabs={false} {...cards}>
      <Link href="/account/history" className="pressable inline-flex min-h-11 items-center rounded-full px-3 text-sm font-bold ink-muted hover:underline">
        {t("history.manage")}
      </Link>
    </TabbedShelf>
  );
}
