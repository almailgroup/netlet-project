/**
 * The bottom bar on a phone.
 *
 * It existed only on the home page, so a shopper who tapped into a category or
 * a product lost every way of moving around except one "continue shopping"
 * pill. On a phone that bar *is* the navigation; it belongs on every shopping
 * page, which is what it is now.
 *
 * The current page is marked rather than left to guess, and the labels are the
 * same words as the header's, so the two do not read as different sites.
 */
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { useTranslation } from "@/lib/useTranslation";
import { Heart, Menu, ShoppingBag, Store, UserRound } from "lucide-react";
import { useLocation } from "wouter";

export function MobileTabBar({ onBrowse }: { onBrowse?: () => void }) {
  const { t } = useTranslation();
  const [location, navigate] = useLocation();
  const { itemCount, openCart } = useCart();
  const { savedIds } = useCustomer();

  const tabs = [
    {
      key: "home",
      label: t("nav.home"),
      icon: <Store className="size-5" />,
      active: location === "/",
      // On the home page the first tab means "back to the top", which is what
      // tapping the current tab does everywhere else too.
      action: () => (location === "/" ? window.scrollTo({ top: 0, behavior: "smooth" }) : navigate("/")),
    },
    {
      key: "browse",
      label: t("nav.browse"),
      icon: <Menu className="size-5" />,
      active: location.startsWith("/category"),
      action: () => (onBrowse ? onBrowse() : navigate("/category/all")),
    },
    {
      key: "saved",
      label: t("nav.saved"),
      icon: <Heart className="size-5" />,
      active: location === "/saved",
      badge: savedIds.length,
      action: () => navigate("/saved"),
    },
    {
      key: "account",
      label: t("nav.account"),
      icon: <UserRound className="size-5" />,
      active: location === "/account",
      action: () => navigate("/account"),
    },
    {
      key: "cart",
      label: t("nav.cart"),
      icon: <ShoppingBag className="size-5" />,
      active: false,
      badge: itemCount,
      action: openCart,
    },
  ];

  return (
    <nav
      aria-label={t("nav.mobile")}
      className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-around rounded-2xl border border-[#ece7da] bg-[#fffdf7] px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_28px_rgba(10,40,90,.10)] lg:hidden"
    >
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={tab.action}
          aria-current={tab.active ? "page" : undefined}
          className={`pressable relative grid min-w-[52px] place-items-center gap-0.5 rounded-xl p-1.5 text-[10px] font-bold ${tab.active ? "ink-accent" : "text-[#536b8c]"}`}
        >
          <span className="relative">
            {tab.icon}
            {tab.badge ? (
              <span className="absolute -end-1.5 -top-1 grid min-w-4 place-items-center rounded-full bg-[#f2683a] px-1 text-[8px] font-extrabold text-white">
                {tab.badge > 99 ? "99+" : tab.badge}
              </span>
            ) : null}
          </span>
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
