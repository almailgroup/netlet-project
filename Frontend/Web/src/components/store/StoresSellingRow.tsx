/**
 * The stores that sell what a search found, or what a subcategory holds, at
 * the top of the page, on the owner's word ("when you search for something it
 * would show the stores that sell it at the top"): a sideways row of the
 * stores, the one selling the most first, each with how many of them it sells
 * (`rankStores`, the server's order). A press opens the store narrowed to the
 * same thing — the words searched, or the department.
 *
 * Small on purpose: it leads the page without pushing the products off a
 * phone's first screen, one line of chips 56px tall.
 */
import { ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { StoreMark, type StoreCardData } from "@/components/store/StoreCard";
import { useTranslation } from "@/hooks/useTranslation";

export type SellingStoreData = StoreCardData & { matching: number };

export function StoresSellingRow({ stores, hrefFor }: { stores: SellingStoreData[]; hrefFor: (slug: string) => string }) {
  const { t } = useTranslation();
  if (!stores.length) return null;
  const count = (matching: number) => (matching === 1 ? t("browse.countOne") : t("browse.countMany", { count: matching }));
  return (
    <section aria-labelledby="stores-selling" className="mb-4">
      <h2 id="stores-selling" className="mb-2 text-[14px] font-bold text-[#0a285a]">{t("search.storesSelling")}</h2>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {stores.map(store => (
          <li key={store.slug} className="shrink-0">
            <Link
              href={hrefFor(store.slug)}
              className="flex h-14 max-w-[15rem] items-center gap-2.5 rounded-2xl border border-[#d5dfeb] bg-white ps-2 pe-3 hover:bg-[#f0f2f5]"
            >
              <StoreMark name={store.name} logoUrl={store.logoUrl} size="sm" />
              <span className="min-w-0">
                <bdi dir="auto" className="block truncate text-[14px] font-bold leading-5 text-[#0a285a]">{store.name}</bdi>
                <span className="block truncate text-[12px] leading-4 ink-muted">{count(store.matching)}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 ink-muted rtl:-scale-x-100" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
