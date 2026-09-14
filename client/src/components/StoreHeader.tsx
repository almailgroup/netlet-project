/**
 * The header every page other than home and checkout wears.
 *
 * It exists because the cart did not. A shopper could add four things from a
 * category page and have no way to see the cart, no count, and no search —
 * the toast said "added to your cart" and then the cart was two navigations
 * away. Search, saved, account and the cart now follow the shopper everywhere.
 *
 * Home keeps its own, taller header: it carries the department rail and the
 * hover-to-expand behaviour, which only make sense on the page you land on.
 * Checkout keeps a deliberately bare one — every extra exit on a payment page
 * is an invitation to leave it.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { LiveSearch } from "@/components/LiveSearch";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { logoImage } from "@/lib/brandAssets";
import { useTranslation } from "@/lib/useTranslation";
import type { Product } from "@shared/commerce/types";
import { Globe2, Heart, ShoppingBag, UserRound } from "lucide-react";
import { Link, useLocation } from "wouter";

/** An icon action with an optional count sitting on its shoulder. */
function HeaderIcon({ label, badge, onClick, children }: {
  label: string;
  badge?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="glass pressable relative grid size-10 shrink-0 place-items-center rounded-full">
      {children}
      {badge ? (
        <span className="absolute -end-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[#f2683a] px-1 text-[9px] font-extrabold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

export function StoreHeader({ catalog = [], search = "", onSearch, onSelectProduct }: {
  catalog?: Product[];
  search?: string;
  onSearch?: (query: string) => void;
  onSelectProduct?: (product: Product) => void;
}) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { itemCount, openCart } = useCart();
  const { savedIds, toggleLocale } = useCustomer();
  const { isAuthenticated } = useAuth();

  // A page with nothing to search (checkout, account) passes no handler and
  // gets the header without the field rather than a field that does nothing.
  const searchable = Boolean(onSearch && onSelectProduct);

  return (
    <header className="sticky top-0 z-40 border-b border-[#d5dfeb] bg-background/95 backdrop-blur-xl">
      <a
        href="#main"
        className="glass glass-navy sr-only rounded-full px-4 py-2 text-xs font-extrabold focus:not-sr-only focus:absolute focus:start-4 focus:top-3 focus:z-50"
      >
        {t("nav.skipToContent")}
      </a>
      <div className="container flex h-[68px] items-center gap-3 lg:gap-5">
        <Link href="/" className="flex shrink-0 items-center" aria-label={t("header.home")}>
          <img src={logoImage} alt="NetLet" loading="eager" decoding="async" className="h-9 w-auto max-w-[118px] object-contain" />
        </Link>

        {searchable ? (
          <div className="hidden min-w-0 flex-1 lg:block">
            <LiveSearch catalog={catalog} value={search} onChange={onSearch!} onSelectProduct={onSelectProduct!} />
          </div>
        ) : <div className="flex-1" />}

        <div className="flex shrink-0 items-center gap-1.5">
          <HeaderIcon label={t("header.changeLanguage")} onClick={toggleLocale}>
            <Globe2 className="size-[18px] ink-accent" />
          </HeaderIcon>
          <HeaderIcon label={t("header.savedItems", { count: savedIds.length })} badge={savedIds.length} onClick={() => navigate("/saved")}>
            <Heart className="size-[18px]" />
          </HeaderIcon>
          <HeaderIcon label={t(isAuthenticated ? "nav.account" : "header.signIn")} onClick={() => navigate("/account")}>
            <UserRound className="size-[18px]" />
          </HeaderIcon>
          <button
            onClick={openCart}
            aria-label={t("header.openCart")}
            title={t("header.openCart")}
            className="glass glass-navy pressable relative grid size-10 shrink-0 place-items-center rounded-full"
          >
            <ShoppingBag className="size-[18px]" />
            {itemCount ? (
              <span className="absolute -end-1 -top-1 grid min-w-4 place-items-center rounded-full bg-[#f2683a] px-1 text-[9px] font-extrabold text-white">
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {/* The field moves to its own row on a phone rather than being dropped:
          search is how most people navigate a catalog on a small screen. */}
      {searchable ? (
        <div className="container pb-3 lg:hidden">
          <LiveSearch catalog={catalog} value={search} onChange={onSearch!} onSelectProduct={onSelectProduct!} />
        </div>
      ) : null}
    </header>
  );
}
