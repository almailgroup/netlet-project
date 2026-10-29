/**
 * Shop by brand: the brands on the shelf, each a link to the whole shop
 * filtered to it.
 *
 * The names are the Brand rows sellers wrote (`commerce.brands`), counted the
 * way the Brand filter counts, so a tile reading "3 products" opens a page of
 * three. There are no logos — NetLet holds none, and a brand's mark drawn
 * without its owner's say is not ours to draw — so each tile carries the
 * initial in the shop's colours. Fewer than three brands and the row is not
 * drawn: two tiles are not a way to shop.
 *
 * **One row that scrolls sideways, on the owner's word**, like the
 * departments above it: two to a row on a phone made twelve brands six rows
 * of the page. The row reaches the screen's edges on a phone so the tile cut
 * off there says there is more, and a mouse gets the shelves' arrows.
 */
import { useTranslation } from "@/hooks/useTranslation";
import { useSideScroll } from "@/hooks/useSideScroll";
import { ScrollArrows } from "@/components/ui/ScrollArrows";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";

export const MIN_BRANDS = 3;
const MAX_BRANDS = 12;

export function BrandShelf() {
  const { t } = useTranslation();
  const brands = trpc.commerce.brands.useQuery(undefined, { staleTime: 5 * 60 * 1000 });
  const list = (brands.data ?? []).slice(0, MAX_BRANDS);
  const scroll = useSideScroll<HTMLUListElement>([list.length]);
  const title = t("home.shopByBrand");
  if (list.length < MIN_BRANDS) return null;
  return (
    <section className="py-6 sm:py-8" aria-labelledby="brands-title">
      <div className="container">
        <div className="flex items-center justify-between gap-4">
          <h2 id="brands-title" className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{title}</h2>
          <ScrollArrows scroll={scroll} previousLabel={t("home.rowBack", { title })} nextLabel={t("home.rowOn", { title })} />
        </div>
        <ul ref={scroll.trackRef} className="hide-scrollbar -mx-4 mt-4 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
          {list.map(brand => (
            <li key={brand.name} className="w-[168px] min-w-0 shrink-0 snap-start sm:w-[196px] lg:w-[212px]">
              <Link
                href={`/category/all?brand=${encodeURIComponent(brand.name)}`}
                className="flex h-full items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-3 hover:bg-[#f0f2f5]"
              >
                <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#eef2f8] text-lg font-extrabold text-[#0a285a]">
                  {Array.from(brand.name.trim())[0]?.toLocaleUpperCase() ?? "·"}
                </span>
                <span className="min-w-0">
                  <bdi dir="auto" className="block truncate text-sm font-bold text-[#0a285a]">{brand.name}</bdi>
                  <span className="block text-[12px] ink-muted">
                    {brand.count === 1 ? t("home.brandCountOne") : t("home.brandCountMany", { count: brand.count })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
