/**
 * Stores on NetLet: the stores a shopper can buy from, each a door onto its
 * own page.
 *
 * It is what says NetLet is a marketplace rather than one shop. The cards are
 * `StoreCardLink`, the one `/stores` draws, and "See all stores" goes there.
 * **It sits at the top of `/categories` under the brands, not on the home
 * page, on the owner's word**, and scrolls sideways like them.
 *
 * Fewer than three stores and the row is not drawn, the brand row's rule: two
 * cards are not a way to shop.
 */
import { ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { useSideScroll } from "@/hooks/useSideScroll";
import { ScrollArrows } from "@/components/ui/ScrollArrows";
import { StoreCardLink } from "@/components/store/StoreCard";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

export const MIN_STORES = 3;

export function StoreShelf({ embedded = false }: { embedded?: boolean }) {
  const { t, locale } = useTranslation();
  const stores = trpc.commerce.stores.useQuery({ locale }, { staleTime: 5 * 60 * 1000 });
  const list = stores.data ?? [];
  const scroll = useSideScroll<HTMLUListElement>([list.length]);
  const title = t("home.storesTitle");
  if (list.length < MIN_STORES) return null;
  return (
    <section className={embedded ? "mb-7 sm:mb-9" : "py-6 sm:py-8"} aria-labelledby="stores-title">
      <div className={embedded ? "" : "container"}>
        <div className="flex items-center justify-between gap-4">
          <h2 id="stores-title" className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{title}</h2>
          <div className="flex items-center gap-2">
            <Link href="/stores" className="pressable inline-flex items-center gap-1 rounded-full px-2 py-2 text-sm font-bold ink-accent hover:underline">
              {t("stores.seeAll")}<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
            <ScrollArrows scroll={scroll} previousLabel={t("home.rowBack", { title })} nextLabel={t("home.rowOn", { title })} />
          </div>
        </div>
        {/* One row that scrolls sideways at every width, the brands' own, on
            the owner's word; it reaches the screen's edges on a phone so the
            card cut off there says there is more. */}
        <ul ref={scroll.trackRef} className="hide-scrollbar -mx-4 mt-4 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
          {list.map(store => (
            <li key={store.slug} className="w-[82%] min-w-0 shrink-0 snap-start sm:w-[280px] lg:w-[264px]">
              <StoreCardLink store={store} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
