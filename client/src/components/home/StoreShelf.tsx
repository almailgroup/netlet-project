/**
 * Stores on NetLet: the stores a shopper can buy from, each a door onto the
 * shop filtered to that seller.
 *
 * It is what says NetLet is a marketplace rather than one shop, which the rest
 * of the home page — departments, shelves, a grid — never did. Everything on a
 * card is the store's own measured record (`commerce.stores`): how many
 * products are on sale, a rating only from five visible reviews up, and the
 * badges `storefrontBadges` grants — never a figure anybody typed. A logo when
 * the store has one, its initial on the portal's pale navy otherwise.
 *
 * Fewer than three stores and the row is not drawn, the brand row's rule: two
 * cards are not a way to shop. The card opens `/category/all?seller=…`, the
 * page's own Seller filter; when stores have pages of their own it will open
 * those instead.
 */
import { Star } from "lucide-react";
import { Link } from "wouter";
import { Thumb } from "@/components/product/Thumb";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";

export const MIN_STORES = 3;

const BADGE_LABEL: Record<string, MessageKey> = {
  verified: "badge.verified",
  highRating: "badge.highRating",
  fastShipping: "badge.fastShipping",
};

export function StoreShelf() {
  const { t, locale } = useTranslation();
  const stores = trpc.commerce.stores.useQuery({ locale }, { staleTime: 5 * 60 * 1000 });
  const list = stores.data ?? [];
  if (list.length < MIN_STORES) return null;
  return (
    <section className="py-6 sm:py-8" aria-labelledby="stores-title">
      <div className="container">
        <h2 id="stores-title" className="text-xl font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-2xl">{t("home.storesTitle")}</h2>
        {/* A row to swipe on a phone, a grid from `sm` up. */}
        <ul className="hide-scrollbar mt-4 grid auto-cols-[82%] grid-flow-col gap-3 overflow-x-auto pb-1 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 sm:overflow-visible lg:grid-cols-5">
          {list.map(store => (
            <li key={store.slug} className="min-w-0">
              <Link
                href={`/category/all?seller=${encodeURIComponent(store.name)}`}
                className="flex h-full items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-3.5 hover:bg-[#f0f2f5]"
              >
                {/* The portal's `StoreAvatar` look: one pale navy for every
                    initial, so the row is not a second palette. */}
                <span className="size-12 shrink-0 overflow-hidden rounded-xl border border-[#e1e7ef] bg-white">
                  <Thumb
                    src={store.logoUrl || undefined}
                    alt=""
                    className="size-full object-contain p-1"
                    fallbackClassName="bg-[#e7edf5] text-[#0a285a]"
                    icon={<span aria-hidden className="text-lg font-bold">{Array.from(store.name.trim())[0]?.toLocaleUpperCase() ?? "·"}</span>}
                  />
                </span>
                <span className="min-w-0">
                  <bdi dir="auto" className="block truncate text-[15px] font-bold text-[#0a285a]">{store.name}</bdi>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] ink-muted">
                    {store.rating ? (
                      <span className="inline-flex items-center gap-0.5" aria-label={t("product.ratingAriaCount", { value: store.rating.average, max: 5, count: store.rating.count })}>
                        <Star className="size-3 fill-[#ffb800] text-[#ffb800]" aria-hidden />
                        <span aria-hidden className="font-semibold text-[#1f2229]">{store.rating.average}</span>
                        <span aria-hidden>·</span>
                      </span>
                    ) : null}
                    {store.products === 1 ? t("home.brandCountOne") : t("home.brandCountMany", { count: store.products })}
                  </span>
                  {store.badges.length ? (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {store.badges.map(badge => BADGE_LABEL[badge] ? (
                        <span key={badge} className="rounded-full bg-[#e3efe4] px-2 py-0.5 text-[11px] font-bold text-[#2f5d33]">{t(BADGE_LABEL[badge])}</span>
                      ) : null)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
