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
 *
 * **Its background is the header's liquid glass, on the owner's word**
 * (`.glass-bar-surface` with `.glass-bar-round`, in `index.css`): the page
 * blurs under it as it scrolls past, while the tabs on it stay solid. That is
 * why the words are navy rather than the muted ink they were — the tint keeps
 * navy at 4.5:1 over the darkest thing that passes under it, and the muted ink
 * would not — and why the current tab is a white pill: the accent ink needs a
 * surface that is the same whatever is behind the glass.
 */
import { DepartmentSheet } from "@/components/layout/DepartmentSheet";
import { useCart } from "@/contexts/CartContext";
import { useCustomer } from "@/contexts/CustomerContext";
import { useAccountSignals } from "@/hooks/useAccountSignals";
import { useTranslation } from "@/hooks/useTranslation";
import { Heart, Menu, ShoppingBag, Store, UserRound } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "wouter";

export function MobileTabBar() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const { itemCount } = useCart();
  const { savedIds } = useCustomer();
  const [browsing, setBrowsing] = useState(false);
  /* The same counts the header's account menu reads, so the two agree. */
  const signals = useAccountSignals();

  const tabs = [
    {
      key: "home",
      label: t("nav.home"),
      icon: <Store className="size-5" />,
      active: location === "/",
      href: "/",
    },
    {
      key: "browse",
      label: t("nav.browse"),
      icon: <Menu className="size-5" />,
      active: location.startsWith("/category"),
      /* The departments, on every page — not the whole catalogue here and a
         sheet on the home page, which made one tab mean two things. */
      action: () => setBrowsing(true),
    },
    {
      key: "saved",
      label: t("nav.saved"),
      icon: <Heart className="size-5" />,
      active: location === "/saved",
      badge: savedIds.length,
      href: "/saved",
    },
    {
      key: "account",
      label: t("nav.account"),
      icon: <UserRound className="size-5" />,
      active: location === "/account" || location.startsWith("/account/"),
      /* Unread replies, from sellers and from NetLet: on a phone this tab is
         the only account control there is. */
      badge: signals.unreadMessages + signals.unreadSupport,
      href: "/account",
    },
    {
      key: "cart",
      label: t("nav.cart"),
      icon: <ShoppingBag className="size-5" />,
      active: location === "/cart",
      badge: itemCount,
      /* The page, not the drawer: on a phone a drawer is the whole screen
         anyway, and the page has an address Back returns from. */
      href: "/cart",
    },
  ];

  return (
    <>
    <DepartmentSheet open={browsing} onClose={() => setBrowsing(false)} />
    <nav
      aria-label={t("nav.mobile")}
      className="fixed inset-x-3 bottom-3 z-30 flex items-center justify-around rounded-2xl border border-[#0a285a]/[.08] px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-6px_28px_rgba(10,40,90,.10)] lg:hidden"
    >
      {/* The header's glass, behind the tabs and inside the bar's corners. */}
      <span aria-hidden className="glass-bar-surface glass-bar-round">
        <span className="glass-bar-bend" />
        <span className="glass-bar-face" />
      </span>
      {tabs.map(tab => {
        const className = `pressable relative grid min-w-[52px] place-items-center gap-0.5 rounded-xl p-1.5 text-[10px] font-bold ${tab.active ? "ink-accent bg-white shadow-[0_1px_3px_rgba(10,40,90,.12)]" : "text-[#0a285a]"}`;
        const face = (
          <>
            <span className="relative">
              {tab.icon}
              {tab.badge ? (
                <span className="absolute -end-1.5 -top-1 grid min-w-4 place-items-center rounded-full bg-[#f2683a] px-1 text-[8px] font-extrabold text-[#0a285a]">
                  {tab.badge > 99 ? "99+" : tab.badge}
                </span>
              ) : null}
            </span>
            {tab.label}
          </>
        );
        /* A tab that goes to a page is a link to it, so a finger landing on it
           starts fetching the page before it lifts. Pressing the tab you are
           on takes you to the top of it, as a phone's own tab bars do. */
        return tab.href ? (
          <Link
            key={tab.key}
            href={tab.href}
            onClick={event => {
              if (location !== tab.href) return;
              event.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            aria-current={tab.active ? "page" : undefined}
            className={className}
          >
            {face}
          </Link>
        ) : (
          <button key={tab.key} type="button" onClick={tab.action} aria-current={tab.active ? "page" : undefined} className={className}>
            {face}
          </button>
        );
      })}
    </nav>
    </>
  );
}
