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
 * Checkout, sign-in and the portal stay outside it on purpose: checkout and
 * sign-in keep a bare header (every exit on a payment page is an invitation to
 * take it; the search field is what somebody leaves a password for), and the
 * portal is a different application in everything but deployment.
 */
import { ShopAssistant, useAssistantShown } from "@/components/assistant/ShopAssistant";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { StoreHeader } from "@/components/layout/StoreHeader";
import { usePageEntrance } from "@/hooks/usePageEntrance";
import { useTranslation } from "@/hooks/useTranslation";
import { createContext, Suspense, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import type { ProductBrief } from "@shared/commerce/assistant";

type Chrome = {
  activeDepartment: string | null;
  /** The product a page is about, keyed so a new object for the same one changes nothing. */
  assistantProduct: { key: string; brief: ProductBrief } | null;
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
/* A document: the chrome is not printed with it. */
const PRINTED = /^\/invoices\/(?!verify\/)/;

export function StorefrontShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
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
  /* The assistant's button floats over the foot of the page too, so the footer leaves it room. */
  const assistant = useAssistantShown();

  return (
    <ChromeContext.Provider value={report}>
      <div className="flex min-h-screen flex-col bg-background text-[#0a285a] print:min-h-0 print:bg-white">
        {/* `contents`, so the bar's sticky box is the page's and not a
            wrapper's the height of the bar. */}
        <div className={printed ? "contents print:hidden" : "contents"}>
          <StoreHeader activeDepartment={chrome.activeDepartment} />
        </div>
        <main id="main" tabIndex={-1} className="flex min-h-[100svh] flex-1 flex-col outline-none print:min-h-0">
          <Suspense fallback={<PageFallback />}>
            <div key={pageOf(location)} className={`flex flex-1 flex-col ${enter}`}>{children}</div>
          </Suspense>
        </main>
        <div className={printed ? "contents print:hidden" : "contents"}>
          <SiteFooter clearance={TALL_FOOT.test(location) || assistant ? "tall" : "tabs"} assistant={assistant} />
          <MobileTabBar />
          <ShopAssistant product={chrome.assistantProduct?.brief ?? null} />
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
