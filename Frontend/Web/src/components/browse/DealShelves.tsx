/**
 * The Deals page's shelves, after the owner's picture: what is on offer, a
 * shelf per kind of thing — its name, View all, and a sideways row of cards
 * that a finger swipes and a mouse steps through with the arrows beside the
 * heading. `dealShelves` (`Shared/commerce/deals.ts`) cuts the shelves; View
 * all opens that kind's department narrowed to it and to what is on offer.
 */
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { ProductCard } from "@/components/product/ProductCard";
import { ScrollArrows } from "@/components/ui/ScrollArrows";
import { useSideScroll } from "@/hooks/useSideScroll";
import { useTranslation } from "@/hooks/useTranslation";
import { DEPARTMENTS } from "@shared/commerce/departments";
import { findSubcategory, subcategoryName } from "@shared/commerce/subcategories";
import type { DealShelf } from "@shared/commerce/deals";
import type { Product } from "@shared/commerce/types";
import type { MessageKey } from "@shared/i18n/dictionary";

type Props = {
  shelves: DealShelf[];
  saved: string[];
  onSave: (product: Product) => void;
  onQuickView: (product: Product) => void;
};

export function DealShelves({ shelves, saved, onSave, onQuickView }: Props) {
  return (
    <div className="mt-4 space-y-8">
      {shelves.map(shelf => <Shelf key={shelf.key} shelf={shelf} saved={saved} onSave={onSave} onQuickView={onQuickView} />)}
    </div>
  );
}

function Shelf({ shelf, saved, onSave, onQuickView }: { shelf: DealShelf } & Omit<Props, "shelves">) {
  const { t, locale } = useTranslation();
  const scroll = useSideScroll<HTMLUListElement>([shelf.products.length]);
  const department = DEPARTMENTS.find(entry => entry.slug === shelf.department) ?? null;
  const kind = findSubcategory(shelf.department, shelf.subcategory);
  const title = kind ? subcategoryName(kind, locale === "ar") : department ? t(department.label as MessageKey) : t("browse.moreDeals");
  /* That kind's department, narrowed to it and to what is on offer. */
  const viewAll = department ? `/category/${department.slug}?offer=1${kind ? `&sub=${kind.slug}` : ""}` : null;
  const id = `deals-${shelf.key.replace(/[^a-z0-9]+/gi, "-")}`;

  return (
    <section aria-labelledby={`${id}-title`} className="cat-rise">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="min-w-0 truncate text-[20px] font-extrabold tracking-[-.01em] text-[#0a285a] sm:text-[22px]">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <ScrollArrows scroll={scroll} previousLabel={t("home.previousProducts", { title })} nextLabel={t("home.nextProducts", { title })} />
          {viewAll ? (
            <Link href={viewAll} className="-me-2 inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-[14px] font-bold ink-accent hover:underline">
              {t("home.viewAll")}
              <span className="sr-only">: {title}</span>
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : null}
        </div>
      </div>
      <ul ref={scroll.trackRef} className="hide-scrollbar -mx-4 mt-3 flex snap-x gap-3 overflow-x-auto scroll-smooth px-4 pb-1 sm:mx-0 sm:px-0">
        {shelf.products.map(product => (
          <li key={product.id} className="w-[164px] shrink-0 snap-start sm:w-[195px] lg:w-[calc((100%-2.25rem)/4)]">
            <ProductCard
              compact
              product={product}
              saved={saved.includes(product.id)}
              onSave={() => onSave(product)}
              onQuickView={() => onQuickView(product)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
