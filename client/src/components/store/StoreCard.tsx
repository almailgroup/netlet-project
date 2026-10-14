/**
 * A store as the shop draws it: its mark, and a card that opens its page.
 *
 * One copy for the home page's Stores on NetLet row and for `/stores`, so the
 * two cannot describe the same store differently. Everything on the card is
 * the store's measured record (`commerce.stores`): how many products are on
 * sale, a rating only from five visible reviews up, and the badges
 * `storefrontBadges` grants — never a figure anybody typed.
 */
import { Star } from "lucide-react";
import { Link } from "wouter";
import { Thumb } from "@/components/product/Thumb";
import { useTranslation } from "@/hooks/useTranslation";
import type { MessageKey } from "@shared/i18n/dictionary";

export type StoreCardData = {
  slug: string;
  name: string;
  logoUrl: string | null;
  products: number;
  rating: { average: number; count: number } | null;
  badges: string[];
};

export const BADGE_LABEL: Record<string, MessageKey> = {
  verified: "badge.verified",
  highRating: "badge.highRating",
  fastShipping: "badge.fastShipping",
};

/**
 * A store's logo, or its initial on the portal's pale navy (`StoreAvatar`'s
 * look) — one colour for every store, so a list of them is not a second
 * palette. Decorative: the store's name is always written beside it.
 */
export function StoreMark({ name, logoUrl, size = "md" }: { name: string; logoUrl: string | null; size?: "md" | "lg" }) {
  const box = size === "lg" ? "size-16 rounded-2xl text-[24px] sm:size-20 sm:text-[28px]" : "size-12 rounded-xl text-lg";
  return (
    <span className={`${box} block shrink-0 overflow-hidden border border-[#e1e7ef] bg-white`}>
      <Thumb
        src={logoUrl || undefined}
        alt=""
        className="size-full object-contain p-1"
        fallbackClassName="bg-[#e7edf5] text-[#0a285a]"
        icon={<span aria-hidden className="font-bold">{Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "·"}</span>}
      />
    </span>
  );
}

/** A store's rating as a star, the figure and how many reviews it is over — or nothing. */
export function StoreRating({ rating, className = "" }: { rating: StoreCardData["rating"]; className?: string }) {
  const { t } = useTranslation();
  if (!rating) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Star className="size-3.5 fill-[#ffb800] text-[#ffb800]" aria-hidden />
      <span className="sr-only">{t("product.ratingAriaCount", { value: rating.average, max: 5, count: rating.count })}</span>
      <span aria-hidden className="font-semibold text-[#1f2229]">{rating.average}</span>
      <span aria-hidden className="ink-muted">({rating.count})</span>
    </span>
  );
}

/** The badges a store has earned, as small green chips. */
export function StoreBadges({ badges }: { badges: string[] }) {
  const { t } = useTranslation();
  const known = badges.filter(badge => BADGE_LABEL[badge]);
  if (!known.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {known.map(badge => (
        <span key={badge} className="rounded-full bg-[#e3efe4] px-2 py-0.5 text-[12px] font-bold text-[#2f5d33]">{t(BADGE_LABEL[badge])}</span>
      ))}
    </span>
  );
}

export function StoreCardLink({ store }: { store: StoreCardData }) {
  const { t } = useTranslation();
  return (
    <Link
      href={`/stores/${encodeURIComponent(store.slug)}`}
      className="flex h-full items-center gap-3 rounded-2xl border border-[#e6e9ef] bg-white p-3.5 hover:bg-[#f0f2f5]"
    >
      <StoreMark name={store.name} logoUrl={store.logoUrl} />
      <span className="min-w-0">
        <bdi dir="auto" className="block truncate text-[15px] font-bold text-[#0a285a]">{store.name}</bdi>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] ink-muted">
          <StoreRating rating={store.rating} />
          {store.rating ? <span aria-hidden>·</span> : null}
          <span>{store.products === 1 ? t("home.brandCountOne") : t("home.brandCountMany", { count: store.products })}</span>
        </span>
        {store.badges.length ? <span className="mt-1.5 block"><StoreBadges badges={store.badges} /></span> : null}
      </span>
    </Link>
  );
}
