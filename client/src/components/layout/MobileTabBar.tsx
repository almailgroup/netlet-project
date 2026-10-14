/**
 * The bottom bar on a phone.
 *
 * It existed only on the home page, so a shopper who tapped into a category or
 * a product lost every way of moving around except one "continue shopping"
 * pill. On a phone that bar *is* the navigation; it belongs on every shopping
 * page, which is what it is now.
 *
 * **Four tabs in a floating pill — Home, Profile, Cart, Categories — drawn to
 * the owner's picture.** The current tab sits in a pale grey pill with its icon
 * and its word in navy, the rest are near-black outlines. Saved left the bar
 * with that picture; it is the Saved tile on the account page, one press under
 * Profile. Categories opens `/categories`, the departments as a page: it was
 * a sheet over whatever page the shopper was on, with no address to go Back
 * from, and the owner asked for a page.
 *
 * **Its background is the header's liquid glass** (`.glass-bar-surface` with
 * `.glass-bar-round`, in `index.css`): the page blurs under it as it scrolls
 * past, while the tabs on it stay solid. The words are dark rather than the
 * muted ink they once were, because the tint keeps dark ink at 4.5:1 over the
 * darkest thing that passes under it, and the current tab's pill is solid for
 * the same reason.
 *
 * **It floats above the home indicator rather than growing over it**: the
 * bar's foot is `max(0.75rem, safe area)`, so on an iPhone it is the same
 * pill, lifted, instead of a pill with a thick bottom edge.
 *
 * **The grey pill is one element that slides to the tab chosen**, on the
 * owner's word (`.tab-pill` in `index.css`). It moves on the press, not when
 * the page arrives — a page whose code is still coming keeps the old one up
 * for as long as `MAX_WAIT_MS`, and a highlight that waited with it would read
 * as a press that had not taken — and settles wherever the address lands.
 * Categories holds it on the department pages too, since that is where the tab
 * leads. On a page no tab names (a product, a search) it
 * fades where it is, and it fades in rather than slides when one is reached
 * again, since a slide from a tab nobody was on describes no move. The word
 * and icon follow the pill; `aria-current` follows the address.
 */
import { PixelBadge } from "@/components/ui/PixelBadge";
import { useCart } from "@/contexts/CartContext";
import { useAccountSignals } from "@/hooks/useAccountSignals";
import { useTranslation } from "@/hooks/useTranslation";
import { ShoppingCart, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { MAX_WAIT_MS } from "@/lib/readyNavigation";
import { Link, useLocation } from "wouter";

/** A house, filled while it is the current tab — the picture's own mark. */
function HomeIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[22px]" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={filled ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 3.2 2.9 11.2a.9.9 0 0 0 .6 1.6H5V20a1 1 0 0 0 1 1h4.3v-5.6h3.4V21H18a1 1 0 0 0 1-1v-7.2h1.5a.9.9 0 0 0 .6-1.6L12 3.2Z" />
    </svg>
  );
}

/** Three squares and a circle: the departments. */
function CategoriesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <circle cx="17" cy="17" r="3.5" />
    </svg>
  );
}

type Tab = {
  key: string;
  label: string;
  icon: (active: boolean) => ReactNode;
  active: boolean;
  badge?: number;
  href: string;
};

export function MobileTabBar() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const { itemCount } = useCart();
  /* The tab pressed whose page has not arrived yet. */
  const [pressed, setPressed] = useState<string | null>(null);
  /* The same counts the header's account menu reads, so the two agree. */
  const signals = useAccountSignals();

  /* The address has moved: the page decides from here. A move that never
     happens (Back while it waited) gives the pill back after the wait. */
  useEffect(() => setPressed(null), [location]);
  useEffect(() => {
    if (!pressed) return;
    const timer = window.setTimeout(() => setPressed(null), MAX_WAIT_MS + 500);
    return () => window.clearTimeout(timer);
  }, [pressed]);

  const tabs: Tab[] = [
    {
      key: "home",
      label: t("nav.home"),
      icon: active => <HomeIcon filled={active} />,
      active: location === "/",
      href: "/",
    },
    {
      key: "profile",
      label: t("nav.profile"),
      icon: () => <UserRound className="size-[22px]" aria-hidden />,
      active: location === "/account" || location.startsWith("/account/"),
      /* Unread replies, from sellers and from NetLet: on a phone this tab is
         the only account control there is. */
      badge: signals.unreadMessages + signals.unreadSupport,
      href: "/account",
    },
    {
      key: "cart",
      label: t("nav.cart"),
      icon: () => <ShoppingCart className="size-[22px]" aria-hidden />,
      active: location === "/cart",
      badge: itemCount,
      /* The page, not the drawer: on a phone a drawer is the whole screen
         anyway, and the page has an address Back returns from. */
      href: "/cart",
    },
    {
      key: "categories",
      label: t("nav.categories"),
      icon: () => <CategoriesIcon />,
      /* The page of departments, and every department page it leads to. */
      active: location === "/categories" || location.startsWith("/category/"),
      href: "/categories",
    },
  ];

  /* Where the pill is: a press on its way, then the page. */
  const shownKey = pressed ?? tabs.find(tab => tab.active)?.key ?? null;
  const shown = shownKey ? tabs.findIndex(tab => tab.key === shownKey) : -1;
  /* It slides only from a tab it was on; from nowhere it fades in. */
  const previous = useRef(-1);
  const resting = useRef(Math.max(shown, 0));
  const slides = previous.current >= 0 && shown >= 0;
  const at = shown >= 0 ? shown : resting.current;
  useEffect(() => {
    previous.current = shown;
    if (shown >= 0) resting.current = shown;
  }, [shown]);

  return (
    <nav
      aria-label={t("nav.mobile")}
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 grid grid-cols-4 rounded-full border border-black/[.12] p-[5px] shadow-[0_8px_28px_rgba(10,40,90,.12),0_1px_3px_rgba(10,40,90,.06)] lg:hidden"
    >
      {/* The header's glass, behind the tabs and inside the bar's corners. */}
      <span aria-hidden className="glass-bar-surface glass-bar-round">
        <span className="glass-bar-bend" />
        <span className="glass-bar-face" />
      </span>
      <span
        aria-hidden
        className="tab-pill"
        data-slide={slides ? "" : undefined}
        data-hidden={shown < 0 ? "" : undefined}
        style={{ "--tab": at } as CSSProperties}
      />
      {tabs.map((tab, index) => {
        const lit = index === shown;
        const className = `relative flex h-[52px] min-w-0 flex-col items-center justify-center gap-0.5 whitespace-nowrap rounded-full text-[12px] leading-4 transition-colors duration-300 min-[360px]:text-[13px] min-[390px]:text-[14px] ${
          lit ? "font-bold text-[#0a285a]" : "font-medium text-[#16181d]"
        }`;
        const face = (
          <>
            <span className="relative">
              {tab.icon(lit)}
              <PixelBadge value={tab.badge ?? 0} className="absolute -end-3 -top-2" />
            </span>
            {tab.label}
          </>
        );
        /* Every tab is a link to its page, so a finger landing on it starts
           fetching the page before it lifts. Pressing the tab you are
           on takes you to the top of it, as a phone's own tab bars do. */
        return (
          <Link
            key={tab.key}
            href={tab.href}
            onClick={event => {
              if (location !== tab.href) {
                /* A modified press opens a new tab and moves nothing here. */
                if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) setPressed(tab.key);
                return;
              }
              event.preventDefault();
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            aria-current={tab.active ? "page" : undefined}
            className={className}
          >
            {face}
          </Link>
        );
      })}
    </nav>
  );
}
