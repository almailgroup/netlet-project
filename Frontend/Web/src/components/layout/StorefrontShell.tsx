/**
 * The frame every shopping page sits in: the header, one `<main>`, the footer
 * and the phone's tab bar, drawn once and kept while the page inside changes.
 *
 * **Each page used to draw its own.** Thirteen pages each rendered
 * `StoreHeader`, `SiteFooter` and `MobileTabBar` themselves, so moving between
 * two of them threw the whole screen away and built it again — the header
 * included — and while the next page's code arrived the fallback drew a grey
 * strip where the header had been. That was the blink a shopper saw on nearly
 * every first visit to a page. It also let the pages drift: three had no
 * footer, two put their `<main>` round the header, one wrapped the header in a
 * box that stopped it sticking. Now the chrome is here and nowhere else, the
 * header never leaves the screen, and only the part under it waits.
 *
 * A page says what the frame needs from it — which department it is in, and
 * on a product page the product, for the shop assistant to answer about —
 * through `usePageChrome`. Everything else the shell works out from the
 * address: the footer clears a floating bar on the pages that have one.
 *
 * **On a phone the account and the cart have no header and no footer, on the
 * owner's word** (`BARE_ON_PHONE`) — the way the delivery apps people here use
 * draw their profile and their bag: the page starts at the top of the screen,
 * ends with its own content, and the tab bar is the way anywhere else. The
 * room the footer left for the floating tab bar is the page's own padding
 * then. **The assistant's button is on every page, those two included, on
 * the owner's word** — it was left off them for a while, having covered the
 * ends of the account's rows, and the owner asked for it everywhere, folded
 * to its mark while the tab bar is away; the page keeps the room under it. A
 * wide screen keeps both, having no tab bar to fall back on. One structure at a time (`useMediaQuery`), so a phone's
 * page holds no hidden search field for a keyboard to land in.
 *
 * **On a phone the footer is the home page's alone, on the owner's word**
 * (`footed`). Under a department, a product or the categories it was five
 * screens of links between the last thing a shopper looked at and the tab bar,
 * which is the way anywhere else; the home page keeps it, being where somebody
 * looks for who the shop is and how to reach it. Every other page keeps the
 * room the footer left for the floating bars (`clearance`). A wide screen has
 * no tab bar and keeps it everywhere.
 *
 * Checkout, sign-in and the portal stay outside it on purpose: checkout and
 * sign-in keep a bare header (every exit on a payment page is an invitation to
 * take it; the search field is what somebody leaves a password for), and the
 * portal is a different application in everything but deployment.
 */
import { ShopAssistant, useAssistantShown } from "@/components/assistant/ShopAssistant";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { StoreHeader } from "@/components/layout/StoreHeader";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePageEntrance } from "@/hooks/usePageEntrance";
import { useTranslation } from "@/hooks/useTranslation";
import { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import type { ProductBrief } from "@shared/commerce/assistant";

type Chrome = {
  activeDepartment: string | null;
  /** The product a page is about, keyed so a new object for the same one changes nothing. */
  assistantProduct: { key: string; brief: ProductBrief; image: string | null } | null;
};
const NO_CHROME: Chrome = { activeDepartment: null, assistantProduct: null };

const ChromeContext = createContext<(chrome: Chrome) => void>(() => {});

/**
 * Tells the frame what this page is: the department the header marks in its
 * row, and the product the assistant answers about. Cleared when the page
 * goes, so the next page never inherits either.
 */
export function usePageChrome(chrome: Partial<Chrome>) {
  const report = useContext(ChromeContext);
  const activeDepartment = chrome.activeDepartment ?? null;
  const assistantProduct = chrome.assistantProduct ?? null;
  const productKey = assistantProduct?.key ?? null;
  const product = useRef(assistantProduct);
  product.current = assistantProduct;
  useLayoutEffect(() => {
    report({ activeDepartment, assistantProduct: product.current });
    return () => report(NO_CHROME);
  }, [report, activeDepartment, productKey]);
}

/* A floating bar of the page's own sits above the tab bar on these. */
const TALL_FOOT = /^\/(category\/|search|products\/)/;
/*
 * Which page an address is, for the entrance: a new page fades in, a new
 * section of the same page does not. The account's sections share its menu,
 * and a menu that blinks on every press is the opposite of the point.
 */
const pageOf = (path: string) => (path.startsWith("/account/") ? "/account" : path);
/* The account and the bag: no header on a phone. */
const BARE_ON_PHONE = /^\/(account|cart)(\/|$)/;
/* A product, a department and the departments: on a phone the header is its
   search row alone — no logo, no delivery, no heart — on the owner's word. */
const SEARCH_ONLY_ON_PHONE = /^\/(products\/|category\/|categories(\/|$))/;
/* A document: the chrome is not printed with it. */
const PRINTED = /^\/invoices\/(?!verify\/)/;

/* Whether this tab has drawn a page in the frame yet. */
let framePainted = false;

export function StorefrontShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  /*
   * On the first load the frame paints, and the page the frame after.
   * The page arrives with its data more often than not now — remembered from
   * an earlier visit today, or asked for as the app started — and drawn in
   * the same first frame as the header, a product page or a band of product
   * cards held the whole first paint back by a quarter of a second on a
   * phone. Its code is already here (`preloadFirstPage`), so the next frame
   * draws it whole; moving between pages afterwards is not held at all. An
   * ordinary update, not a transition: as a transition the page waited behind
   * every answer arriving for the header, and painted half a second late.
   *
   * Not the home page: its first screen is the front door and the departments,
   * which need no data and draw at once, and holding it only put the header's
   * paint and a frame in front of the hero — measured, the hero's picture
   * 260ms later.
   */
  const [held, setHeld] = useState(() => !framePainted && location !== "/");
  useEffect(() => {
    framePainted = true;
    if (!held) return;
    const frame = requestAnimationFrame(() => setHeld(false));
    return () => cancelAnimationFrame(frame);
  }, [held]);
  const [chrome, setChrome] = useState<Chrome>(NO_CHROME);
  const report = useCallback((next: Chrome) => {
    setChrome(current => (
      current.activeDepartment === next.activeDepartment && current.assistantProduct?.key === next.assistantProduct?.key ? current : next
    ));
  }, []);
  /*
   * The page fades in when the shopper moves to it, and not on the first
   * load: a page that arrives at opacity 0 is a page whose largest picture is
   * painted later than it could be, for an effect nobody asked of a first
   * visit. `page-enter` does nothing for somebody who asked for less motion.
   */
  const enter = usePageEntrance(pageOf(location));
  const printed = PRINTED.test(location);
  const wide = useMediaQuery("(min-width: 1024px)");
  const bare = !wide && BARE_ON_PHONE.test(location);
  /* The footer on a wide screen, and on a phone only on the home page. */
  const footed = !bare && (wide || location === "/");
  /* The assistant's button floats over the foot of the page too, so the
     footer, or a bare page's own padding, leaves it room. */
  const assistant = useAssistantShown();
  /* What the foot of the page clears on a phone, footer or not. */
  const clearance = TALL_FOOT.test(location) || assistant ? "tall" : "tabs";

  return (
    <ChromeContext.Provider value={report}>
      <div className="flex min-h-screen flex-col bg-background text-[#0a285a] print:min-h-0 print:bg-white">
        {/* `contents`, so the bar's sticky box is the page's and not a
            wrapper's the height of the bar. */}
        <div className={printed ? "contents print:hidden" : "contents"}>
          {bare ? null : <StoreHeader activeDepartment={chrome.activeDepartment} logoRow={!SEARCH_ONLY_ON_PHONE.test(location)} />}
        </div>
        {/* With no header, the page clears the status bar itself on a phone
            that draws the page under it (`viewport-fit=cover`); with no
            footer, it clears the tab bar too. */}
        <main
          id="main"
          tabIndex={-1}
          className={`flex min-h-[100svh] flex-1 flex-col outline-none print:min-h-0 ${
            bare
              ? `pt-[env(safe-area-inset-top)] ${assistant ? "pb-[calc(11rem+env(safe-area-inset-bottom))]" : "pb-[calc(5rem+env(safe-area-inset-bottom))]"}`
              : footed
                ? ""
                : clearance === "tall" ? "pb-[calc(11rem+env(safe-area-inset-bottom))]" : "pb-[calc(6rem+env(safe-area-inset-bottom))]"
          }`}
        >
          <Suspense fallback={<PageFallback />}>
            {held ? null : <div key={pageOf(location)} className={`flex flex-1 flex-col ${enter}`}>{children}</div>}
          </Suspense>
        </main>
        <div className={printed ? "contents print:hidden" : "contents"}>
          {held || !footed ? null : <SiteFooter clearance={clearance} assistant={assistant} />}
          <MobileTabBar />
          {held ? null : <ShopAssistant product={chrome.assistantProduct} department={chrome.activeDepartment} />}
        </div>
      </div>
    </ChromeContext.Provider>
  );
}

/**
 * What stands in for a page while its code arrives: the page's shape, under a
 * header that has not moved. A product page, a grid and anything else each get
 * their own outline, so nothing jumps when the page lands.
 */
export function PageFallback() {
  const [location] = useLocation();
  const { t } = useTranslation();
  const block = "animate-pulse rounded-2xl bg-[#e9edf3]";
  const shape = location.startsWith("/products/")
    ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <div className={`aspect-square ${block}`} />
          <div className="space-y-4 pt-4">
            <div className={`h-4 w-28 ${block}`} />
            <div className={`h-9 w-4/5 ${block}`} />
            <div className={`h-7 w-32 ${block}`} />
            <div className={`h-12 ${block}`} />
            <div className={`h-12 ${block}`} />
          </div>
        </div>
      )
    : /^\/(signin|signup|login|register)$/.test(location)
      ? <div className={`mx-auto h-[560px] max-w-[1120px] ${block}`} />
    : location.startsWith("/category/") || location.startsWith("/search") || location === "/saved"
      ? (
          <>
            <div className={`h-8 w-56 ${block}`} />
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, index) => <div key={index} className={`h-72 ${block}`} />)}
            </div>
          </>
        )
      : (
          <div className="space-y-4">
            <div className={`h-8 w-1/3 ${block}`} />
            <div className={`h-40 ${block}`} />
            <div className={`h-40 ${block}`} />
          </div>
        );
  return (
    <div className="container flex-1 pb-12 pt-6 sm:pb-16 sm:pt-8" role="status" aria-live="polite">
      <span className="sr-only">{t("nav.loadingPage")}</span>
      <div aria-hidden>{shape}</div>
    </div>
  );
}
