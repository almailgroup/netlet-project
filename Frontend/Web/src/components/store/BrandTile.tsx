/**
 * One brand, as a link to the whole shop filtered to it — the `/brands`
 * page's tile.
 *
 * The names are the Brand rows sellers wrote (`commerce.brands`), counted the
 * way the Brand filter counts, so a tile reading "3 products" opens a page of
 * three. There are no logos — NetLet holds none, and a brand's mark drawn
 * without its owner's say is not ours to draw — so each tile carries the
 * initial in the shop's colours.
 */
import { useTranslation } from "@/hooks/useTranslation";
import { Link } from "wouter";

export function BrandTile({ brand }: { brand: { name: string; count: number } }) {
  const { t } = useTranslation();
  return (
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
  );
}
