/**
 * The stores that sell what a page holds — a subcategory, a department, a
 * search — over its products, on the owner's word ("when you tap on a sub
 * category, it should show the products for that sub category, with the
 * stores shown at the top"). Drawn as the owner's picture draws a shop's
 * brands: "Shop by store" over a sideways row of large circles, each the
 * store's logo — or its initial — on a pale ground with its name under it,
 * the store selling the most first (`rankStores`, the server's order). A
 * press opens the store narrowed to the same thing: the words searched, or
 * the department.
 */
import { Link } from "wouter";
import { Thumb } from "@/components/product/Thumb";
import type { StoreCardData } from "@/components/store/StoreCard";
import { useTranslation } from "@/hooks/useTranslation";

export type SellingStoreData = StoreCardData & { matching: number };

export function StoresSellingRow({ stores, hrefFor }: { stores: SellingStoreData[]; hrefFor: (slug: string) => string }) {
  const { t } = useTranslation();
  if (!stores.length) return null;
  const count = (matching: number) => (matching === 1 ? t("browse.countOne") : t("browse.countMany", { count: matching }));
  return (
    <section aria-labelledby="stores-selling" className="mb-5 mt-2">
      <h2 id="stores-selling" className="mb-3 text-[19px] font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-xl">{t("browse.shopByStore")}</h2>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:gap-4 sm:px-0">
        {stores.map(store => (
          <li key={store.slug} className="w-[84px] shrink-0 sm:w-[104px]">
            <Link
              href={hrefFor(store.slug)}
              aria-label={`${store.name}, ${count(store.matching)}`}
              className="group flex flex-col items-center gap-2 rounded-2xl text-center hover:bg-transparent"
            >
              <span className="tint-in-group grid size-[84px] place-items-center overflow-hidden rounded-full bg-[#f1f3f6] sm:size-[104px]">
                <Thumb
                  src={store.logoUrl || undefined}
                  alt=""
                  className="size-full object-contain p-3.5"
                  fallbackClassName="bg-[#f1f3f6] text-[#0a285a]"
                  icon={<span aria-hidden className="text-[30px] font-extrabold sm:text-[36px]">{Array.from(store.name.trim())[0]?.toLocaleUpperCase() ?? "·"}</span>}
                />
              </span>
              <bdi dir="auto" aria-hidden className="line-clamp-2 w-full text-[13px] font-semibold leading-tight text-[#0a285a]">{store.name}</bdi>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
