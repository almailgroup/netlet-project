/**
 * Stores on NetLet: the stores a shopper can buy from, each a door onto its
 * own page.
 *
 * It is what says NetLet is a marketplace rather than one shop, which the rest
 * of the home page — departments, shelves, a grid — never did. The cards are
 * `StoreCardLink`, the one `/stores` draws, and "See all stores" goes there.
 *
 * Fewer than three stores and the row is not drawn, the brand row's rule: two
 * cards are not a way to shop.
 */
import { ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { StoreCardLink } from "@/components/store/StoreCard";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";

export const MIN_STORES = 3;

export function StoreShelf() {
  const { t, locale } = useTranslation();
  const stores = trpc.commerce.stores.useQuery({ locale }, { staleTime: 5 * 60 * 1000 });
  const list = stores.data ?? [];
  if (list.length < MIN_STORES) return null;
  return (
    <section className="py-6 sm:py-8" aria-labelledby="stores-title">
      <div className="container">
        <div className="flex items-center justify-between gap-4">
          <h2 id="stores-title" className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{t("home.storesTitle")}</h2>
          <Link href="/stores" className="pressable inline-flex items-center gap-1 rounded-full px-2 py-2 text-sm font-bold ink-accent hover:underline">
            {t("stores.seeAll")}<ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
        {/* A row to swipe on a phone, a grid from `sm` up. */}
        <ul className="hide-scrollbar mt-4 grid auto-cols-[82%] grid-flow-col gap-3 overflow-x-auto pb-1 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 sm:overflow-visible lg:grid-cols-5">
          {list.map(store => (
            <li key={store.slug} className="min-w-0">
              <StoreCardLink store={store} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
