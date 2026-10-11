/**
 * Paid placements on the storefront (3.3.15), labelled as what they are.
 *
 * **Disclosed on the shelf and on every card.** A heading saying "Sponsored"
 * and a line saying sellers paid to be here, and the word again on each card
 * where the store's name would sit — because a card gets screenshotted and
 * shared on its own, and a paid placement that reads as the shop's own pick
 * once it leaves its heading is the kind of thing a shopper finds out once
 * and never trusts the shop again.
 *
 * **Its own shelf, never mixed into a sort.** On a department page the paid
 * products sit above the grid in a strip of their own, and the grid below is
 * exactly the order the shopper chose. A "price low to high" with paid items
 * folded in is not price low to high — the rule `placement.ts` already keeps
 * for discounters.
 *
 * **Absent rather than broken.** A failed or empty read draws nothing at all:
 * an advert that errors is worse than no advert, and nobody came to the page
 * for it.
 */
import { ProductCard } from "@/components/product/ProductCard";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import type { AdSlot } from "@shared/commerce/adBookings";
import type { Product } from "@shared/commerce/types";

export function SponsoredShelf({ slot, departmentSlug, layout, saved, onSave, onQuickView }: {
  slot: AdSlot;
  departmentSlug?: string;
  /** A home-page rail, or a strip above a department's grid. */
  layout: "rail" | "strip";
  saved: string[];
  onSave: (product: Product) => void;
  onQuickView: (product: Product) => void;
}) {
  const { t, locale } = useTranslation();
  const query = trpc.ads.sponsored.useQuery(
    { slot, departmentSlug, locale },
    { enabled: slot === "home" || Boolean(departmentSlug), staleTime: 60_000, retry: false },
  );
  const products = query.data ?? [];
  if (products.length === 0) return null;

  const id = `sponsored-${slot}`;
  const cards = products.map(product => (
    <div key={product.id} className={layout === "rail" ? "min-w-[172px] sm:min-w-[195px] lg:min-w-0" : "min-w-0"}>
      <ProductCard
        compact
        product={product}
        note={
          <span className="block truncate text-[12px] ink-muted">
            {t("ads.sponsored")}{product.vendor ? <> · <bdi>{product.vendor}</bdi></> : null}
          </span>
        }
        saved={saved.includes(product.id)}
        onSave={() => onSave(product)}
        onQuickView={() => onQuickView(product)}
      />
    </div>
  ));

  if (layout === "strip") {
    return (
      <section aria-labelledby={id} className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white/60 p-3 sm:p-4">
        <h2 id={id} className="text-[13px] font-bold text-[#0a285a]">{t("ads.sponsored")}</h2>
        <p className="mt-0.5 text-[12px] ink-muted">{t("ads.disclosure")}</p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{cards}</div>
      </section>
    );
  }

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="container py-6 sm:py-8">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id={`${id}-title`} className="text-xl font-extrabold text-[#0a285a] sm:text-2xl">{t("ads.homeTitle")}</h2>
        <span className="text-[12px] font-semibold ink-muted">{t("ads.sponsored")}</span>
      </div>
      <p className="mt-0.5 max-w-prose text-[12px] ink-muted">{t("ads.disclosure")}</p>
      <div className="hide-scrollbar mt-4 flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-4 lg:overflow-visible">{cards}</div>
    </section>
  );
}
