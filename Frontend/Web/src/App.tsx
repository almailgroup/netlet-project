/**
 * NetLet design reminder: public marketplace storefront in pearl white, luxury navy,
 * and NetLet Orange — with shopping state provided by NetLet’s own cart.
 */
import { Toaster } from "@/components/ui/sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { CartProvider, useCart } from "@/contexts/CartContext";
import { whenIdle } from "@/lib/idle";
import { CustomerProvider } from "@/contexts/CustomerContext";
import { BASE_PATH } from "@/lib/basePath";
import { captureReferral } from "@/lib/referral";
import { captureAffiliate } from "@/lib/affiliate";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { matchRoute, Route, Router as WouterRouter, Switch, useLocation, useRouter, useSearch, type RouteComponentProps } from "wouter";
import { PageFallback, StorefrontShell } from "@/components/layout/StorefrontShell";
import { useIntentPrefetch } from "@/hooks/useIntentPrefetch";
import { shelvedProduct } from "@/hooks/useCatalog";
import { useQueryClient } from "@tanstack/react-query";
import { lazyPage, type Preloadable } from "@/lib/lazyPage";
import { isWaiting, setPageResolver, subscribeWaiting, useReadyLocation } from "@/lib/readyNavigation";
import { trpc } from "@/lib/trpc";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

/**
 * Home loads with the document; everything else is fetched when first visited.
 *
 * A shopper landing on the storefront was downloading the checkout form, the
 * account page and the product gallery before seeing a single product. Home
 * stays eager because it is the page nearly every visit starts on, and making
 * it lazy would only add a round trip to the critical path.
 */
const loadBagDrawer = () => import("@/components/cart/BagDrawer");
const BagDrawer = lazy(() => loadBagDrawer().then(module => ({ default: module.BagDrawer })));
const ProductDetail = lazyPage(() => import("@/pages/ProductDetail"));
const Checkout = lazyPage(() => import("@/pages/Checkout"));
const Account = lazyPage(() => import("@/pages/Account"));
const SignIn = lazyPage(() => import("@/pages/SignIn"));
const Saved = lazyPage(() => import("@/pages/Saved"));
const Cart = lazyPage(() => import("@/pages/Cart"));
const Returns = lazyPage(() => import("@/pages/Returns"));
const Help = lazyPage(() => import("@/pages/Help"));
const GiftList = lazyPage(() => import("@/pages/GiftList"));
const Invoice = lazyPage(() => import("@/pages/Invoice"));
const InvoiceVerify = lazyPage(() => import("@/pages/InvoiceVerify"));
const AdminInvoices = lazyPage(() => import("@/pages/admin/Invoices"));
const Category = lazyPage(() => import("@/pages/Category"));
const Store = lazyPage(() => import("@/pages/Store"));
const Stores = lazyPage(() => import("@/pages/Stores"));
const Categories = lazyPage(() => import("@/pages/Categories"));
const Legal = lazyPage(() => import("@/pages/Legal"));
/* The admin portal is a separate application in everything but deployment: no
   shopper ever loads it, so it stays out of the storefront's bundle. */
const AdminOverview = lazyPage(() => import("@/pages/admin/Overview"));
const AdminProducts = lazyPage(() => import("@/pages/admin/Products"));
const AdminPeople = lazyPage(() => import("@/pages/admin/People"));
const AdminAudit = lazyPage(() => import("@/pages/admin/Audit"));
const AdminStock = lazyPage(() => import("@/pages/admin/Stock"));
const AdminOrders = lazyPage(() => import("@/pages/admin/Orders"));
const AdminImport = lazyPage(() => import("@/pages/admin/Import"));
const AdminPromotions = lazyPage(() => import("@/pages/admin/Promotions"));
const AdminApplications = lazyPage(() => import("@/pages/admin/Applications"));
const AdminBundles = lazyPage(() => import("@/pages/admin/Bundles"));
const AdminDispatch = lazyPage(() => import("@/pages/admin/Dispatch"));
const AdminCouriers = lazyPage(() => import("@/pages/admin/Couriers"));
const AdminClaims = lazyPage(() => import("@/pages/admin/Claims"));
const AdminMessages = lazyPage(() => import("@/pages/admin/Messages"));
const AdminReturns = lazyPage(() => import("@/pages/admin/Returns"));
const AdminFeatures = lazyPage(() => import("@/pages/admin/Features"));
const AdminAffiliates = lazyPage(() => import("@/pages/admin/Affiliates"));
const AdminPayouts = lazyPage(() => import("@/pages/admin/Payouts"));
const AdminAds = lazyPage(() => import("@/pages/admin/Ads"));
const AdminSubscriptions = lazyPage(() => import("@/pages/admin/Subscriptions"));
const AdminSupport = lazyPage(() => import("@/pages/admin/Support"));
const AdminFulfilment = lazyPage(() => import("@/pages/admin/Fulfilment"));
const AdminMembership = lazyPage(() => import("@/pages/admin/Membership"));
const Sell = lazyPage(() => import("@/pages/Sell"));
const AdminFinance = lazyPage(() => import("@/pages/admin/Finance"));
const AdminOffers = lazyPage(() => import("@/pages/admin/Offers"));
const AdminProductEditor = lazyPage(() => import("@/pages/admin/ProductEditor"));
const AdminNewProduct = lazyPage(() => import("@/pages/admin/NewProduct"));
const AdminReview = lazyPage(() => import("@/pages/admin/Review"));
const AdminVendors = lazyPage(() => import("@/pages/admin/Vendors"));
const AdminVendorNew = lazyPage(() => import("@/pages/admin/VendorNew"));
const AdminVendorDetail = lazyPage(() => import("@/pages/admin/VendorDetail"));
const AdminTeam = lazyPage(() => import("@/pages/admin/Team"));
const NotFound = lazyPage(() => import("@/pages/NotFound"));
/* The portal's frame too: it is fetched with the first admin page, never by a shopper. */
const loadAdminFrame = () => import("@/components/admin/AdminShell");
const AdminLayout = lazyPage<{ children: ReactNode }>(async () => ({ default: (await loadAdminFrame()).AdminLayout }));
const AdminNotFound = lazyPage(async () => ({ default: (await loadAdminFrame()).AdminNotFound }));

/**
 * The bag drawer, out of the first download.
 *
 * It is on every page and opened on few visits, so it is fetched once the
 * first page has drawn — the browser is idle by then, and the first press
 * still opens it at once — and mounted from the first time it is opened, so
 * it keeps its `useOverlay` across later opens.
 */
function BagDrawerWhenWanted() {
  const { isOpen } = useCart();
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (isOpen) setWanted(true);
  }, [isOpen]);
  useEffect(() => whenIdle(() => void loadBagDrawer()), []);
  return wanted || isOpen ? <Suspense fallback={null}><BagDrawer /></Suspense> : null;
}

/**
 * What shows while the code of a page outside the shop's frame arrives —
 * checkout, sign-in, the portal: a header-height strip and the page's shape.
 * A page inside the frame never sees this; the shell keeps its header and
 * draws `PageFallback` under it instead.
 */
function RouteFallback() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-16 border-b border-[#e6e9ef] bg-white" aria-hidden />
      <PageFallback />
    </div>
  );
}

/** /dashboard/x -> /admin/x, replacing history so Back does not bounce. */
function LegacyAdminRedirect() {
  const [location, navigate] = useLocation();
  useEffect(() => {
    navigate(location.replace(/^\/dashboard/, "/admin") || "/admin", { replace: true });
  }, [location, navigate]);
  return null;
}

/**
 * Put aside the `?ref=` an invitation link carries (3.1.14).
 *
 * Here rather than on the home page because a shared link may point anywhere —
 * a product, a gift list — and the code has to survive until whenever the new
 * shopper gets round to making an account.
 */
function ReferralCapture() {
  const [location] = useLocation();
  useEffect(() => {
    captureReferral(window.location.search);
    /* And an affiliate's link (3.7), which may point at any page too. */
    captureAffiliate(window.location.search);
  }, [location]);
  return null;
}

/**
 * A new page starts at its top, and Back returns to where the shopper was.
 *
 * Cards and links move between pages without a reload now, and a browser only
 * manages the scroll on a real navigation — so opening a product from the
 * bottom of the home page landed on the product's footer, and Back from it
 * landed at the top of the home page. The browser's own restoration cannot
 * help with the second: it runs at `popstate`, before React has drawn the page
 * it is restoring, so it scrolls a page that is not there yet.
 *
 * So the position is kept here, per address, and put back once the page is
 * tall enough to hold it. The address includes the query string, so each set
 * of a category page's filters keeps its own place. A filter replaces the
 * history entry rather than pushing one, and a replace on the same page is
 * left where it is: ticking a box half-way down the grid should not throw the
 * shopper back to the top.
 */
function ScrollMemory() {
  const [location] = useLocation();
  const search = useSearch();
  const key = `${location}?${search}`;
  const positions = useRef(new Map<string, number>());
  const current = useRef(key);
  const traversed = useRef(false);
  const loaded = useRef(false);
  const depth = useRef(0);
  const path = useRef(location);

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    const onPop = () => { traversed.current = true; };
    const onScroll = () => { positions.current.set(current.current, window.scrollY); };
    window.addEventListener("popstate", onPop);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  /*
   * Before paint, so a scroll event fired by the new page's layout is never
   * recorded against the page being left — and the saved position is read
   * here for the same reason, before the new page's first scroll overwrites it.
   */
  useLayoutEffect(() => {
    if (current.current === key && loaded.current) return;
    current.current = key;
    const target = positions.current.get(key) ?? 0;
    /* A push grows the history; a replace and a traversal do not. */
    const pushed = history.length > depth.current;
    const moved = path.current !== location;
    depth.current = history.length;
    path.current = location;
    if (!loaded.current) {
      /* A page load: a reload keeps its place, which the browser handles. */
      loaded.current = true;
      return;
    }
    if (pushed) {
      traversed.current = false;
      if (!window.location.hash) window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    /*
     * Back or a replace, and the difference is only known a task later: the
     * router re-renders in a microtask inside its own \`popstate\` listener,
     * which is before any listener here has run, in either phase.
     */
    let frame = 0;
    const timer = window.setTimeout(() => {
      if (!traversed.current) {
        if (moved && !window.location.hash) window.scrollTo({ top: 0, behavior: "instant" });
        return;
      }
      traversed.current = false;
      let frames = 0;
      const settle = () => {
        const room = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({ top: Math.min(target, room), behavior: "instant" });
        /* A page still loading its products is shorter than the place it is
           being returned to; try again for about a second while it fills. */
        if (room < target && frames++ < 60) frame = requestAnimationFrame(settle);
      };
      settle();
    }, 0);
    return () => { window.clearTimeout(timer); cancelAnimationFrame(frame); };
  }, [key]);

  return null;
}

/**
 * Every address the app answers, in one list, because two things read it: the
 * router, and the prefetcher that fetches a page's code before it is opened.
 * A second list for the prefetcher would be the one that falls behind.
 *
 * `frame` is which frame the page sits in, drawn once and kept while pages
 * change under it: the shop's (`StorefrontShell`), the portal's
 * (`AdminLayout`), or none — checkout and sign-in draw a bare header of their
 * own. Order matters as it does in any `Switch`: `/admin/products/new` before
 * `:id`, which would otherwise read "new" as a product id.
 */
const ROUTES: { path: string; page: ComponentType<RouteComponentProps>; frame: "shop" | "admin" | "bare" }[] = [
  { path: "/", page: Home, frame: "shop" },
  { path: "/signin", page: SignIn, frame: "bare" },
  { path: "/signup", page: SignIn, frame: "bare" },
  { path: "/login", page: SignIn, frame: "bare" },
  { path: "/register", page: SignIn, frame: "bare" },
  { path: "/checkout", page: Checkout, frame: "bare" },
  { path: "/account", page: Account, frame: "shop" },
  { path: "/account/:section", page: Account, frame: "shop" },
  { path: "/saved", page: Saved, frame: "shop" },
  { path: "/cart", page: Cart, frame: "shop" },
  { path: "/returns", page: Returns, frame: "shop" },
  { path: "/help", page: Help, frame: "shop" },
  { path: "/terms", page: Legal, frame: "shop" },
  { path: "/privacy", page: Legal, frame: "shop" },
  { path: "/gifts/:token", page: GiftList, frame: "shop" },
  { path: "/gifts", page: GiftList, frame: "shop" },
  { path: "/invoices/verify/:number", page: InvoiceVerify, frame: "shop" },
  { path: "/invoices/:number", page: Invoice, frame: "shop" },
  { path: "/sell", page: Sell, frame: "shop" },
  { path: "/categories", page: Categories, frame: "shop" },
  { path: "/category/:slug", page: Category, frame: "shop" },
  /* Search results are the department layout over the whole catalog. */
  { path: "/search", page: Category, frame: "shop" },
  { path: "/products/:handle", page: ProductDetail, frame: "shop" },
  { path: "/stores", page: Stores, frame: "shop" },
  { path: "/stores/:slug", page: Store, frame: "shop" },
  { path: "/404", page: NotFound, frame: "shop" },
  { path: "/admin", page: AdminOverview, frame: "admin" },
  { path: "/admin/products", page: AdminProducts, frame: "admin" },
  { path: "/admin/products/new", page: AdminNewProduct, frame: "admin" },
  { path: "/admin/products/:id", page: AdminProductEditor, frame: "admin" },
  { path: "/admin/review", page: AdminReview, frame: "admin" },
  { path: "/admin/stock", page: AdminStock, frame: "admin" },
  { path: "/admin/orders", page: AdminOrders, frame: "admin" },
  { path: "/admin/import", page: AdminImport, frame: "admin" },
  { path: "/admin/promotions", page: AdminPromotions, frame: "admin" },
  { path: "/admin/applications", page: AdminApplications, frame: "admin" },
  { path: "/admin/bundles", page: AdminBundles, frame: "admin" },
  /* The fifth party's own board (2.2, 3.4.2), inside the same portal rather
     than a shell of its own: scope is already decided by the server, and two
     shells would be two navigations showing the same links. A courier sees
     only these. */
  { path: "/admin/dispatch", page: AdminDispatch, frame: "admin" },
  { path: "/admin/couriers", page: AdminCouriers, frame: "admin" },
  { path: "/admin/claims", page: AdminClaims, frame: "admin" },
  { path: "/admin/messages", page: AdminMessages, frame: "admin" },
  { path: "/admin/returns", page: AdminReturns, frame: "admin" },
  { path: "/admin/features", page: AdminFeatures, frame: "admin" },
  { path: "/admin/affiliates", page: AdminAffiliates, frame: "admin" },
  { path: "/admin/payouts", page: AdminPayouts, frame: "admin" },
  { path: "/admin/ads", page: AdminAds, frame: "admin" },
  { path: "/admin/subscriptions", page: AdminSubscriptions, frame: "admin" },
  { path: "/admin/support", page: AdminSupport, frame: "admin" },
  { path: "/admin/fulfilment", page: AdminFulfilment, frame: "admin" },
  { path: "/admin/membership", page: AdminMembership, frame: "admin" },
  { path: "/admin/invoices", page: AdminInvoices, frame: "admin" },
  { path: "/admin/finance", page: AdminFinance, frame: "admin" },
  { path: "/admin/offers", page: AdminOffers, frame: "admin" },
  { path: "/admin/vendors", page: AdminVendors, frame: "admin" },
  { path: "/admin/vendors/new", page: AdminVendorNew, frame: "admin" },
  { path: "/admin/vendors/:id", page: AdminVendorDetail, frame: "admin" },
  { path: "/admin/people", page: AdminPeople, frame: "admin" },
  { path: "/admin/audit", page: AdminAudit, frame: "admin" },
  { path: "/admin/team", page: AdminTeam, frame: "admin" },
  /* The portal used to live at /dashboard. Anyone who bookmarked it lands
     there rather than on a 404 that looks like the tool is gone. */
  { path: "/dashboard/:rest*", page: LegacyAdminRedirect, frame: "bare" },
  { path: "/dashboard", page: LegacyAdminRedirect, frame: "bare" },
];

/* Every address the portal answers, whether or not a page does. */
const ADMIN_AREA = /^\/admin(?:\/.*)?$/;

const isLazy = (page: unknown): page is Preloadable => typeof (page as Partial<Preloadable>).preload === "function";

/**
 * Whose code an address needs before it can draw: its page, and for the
 * portal the portal's frame as well. An address no route answers is the 404 of
 * whichever frame it falls in.
 */
function piecesFor(parser: Parameters<typeof matchRoute>[0], path: string): Preloadable[] {
  const route = ROUTES.find(entry => matchRoute(parser, entry.path, path)[0]);
  const inPortal = ADMIN_AREA.test(path);
  const page = route?.page ?? (inPortal ? AdminNotFound : NotFound);
  const pieces: unknown[] = inPortal ? [page, AdminLayout] : [page];
  return pieces.filter(isLazy);
}

/**
 * Fetches a page before it is opened (`useIntentPrefetch`): its code, and for
 * a product the product too, so the press lands on a page that is already
 * here. And once the first page has drawn, the two pages nearly every visit
 * goes on to — a product and a department, or in the portal its overview,
 * products and orders — so the first of those opens at once even on a phone,
 * where there is no pointer to rest on a link first.
 */
function Prefetcher() {
  const { parser } = useRouter();
  const utils = trpc.useUtils();
  const client = useQueryClient();
  const { locale } = useTranslation();
  const prefetch = useCallback((path: string) => {
    for (const piece of piecesFor(parser, path)) void piece.preload().catch(() => undefined);
    const [isProduct, params] = matchRoute(parser, "/products/:handle", path);
    if (isProduct && params?.handle) {
      const handle = decodeURIComponent(params.handle);
      /* A card's own shelf already holds the product, and the page starts
         from that copy (`useProductByHandle`); anything else — a bag line,
         an order, a link in a message — is asked for now. */
      if (!shelvedProduct(client, handle, locale)) void utils.commerce.products.byHandle.prefetch({ handle, locale }, { staleTime: 30_000 });
    }
  }, [parser, utils, client, locale]);
  useIntentPrefetch(prefetch);
  /* A press on a link whose page has not arrived waits for it, with the
     current page still up (`readyNavigation`). */
  useEffect(() => setPageResolver(path => {
    const missing = piecesFor(parser, path).filter(piece => !piece.loaded());
    return missing.length ? () => Promise.all(missing.map(piece => piece.preload())) : null;
  }), [parser]);
  /* In the portal, the pages somebody running a store opens most instead. */
  const [location] = useLocation();
  const inPortal = ADMIN_AREA.test(location);
  useEffect(() => whenIdle(() => {
    const likely = inPortal ? [AdminLayout, AdminOverview, AdminProducts, AdminOrders] : [ProductDetail, Category];
    for (const page of likely) void page.preload().catch(() => undefined);
  }), [inPortal]);
  return null;
}

/**
 * The slim bar across the top while a press waits for its page's code
 * (`readyNavigation`). Drawn only once the wait passes 120ms, so a page that
 * is nearly here arrives without a bar flicking on and off before it.
 */
function NavigationProgress() {
  const waiting = useSyncExternalStore(subscribeWaiting, isWaiting, () => false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!waiting) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), 120);
    return () => window.clearTimeout(timer);
  }, [waiting]);
  return <div aria-hidden className={`nav-progress ${shown ? "is-on" : ""}`} />;
}

function Router() {
  const storefront = ROUTES.filter(route => route.frame === "shop");
  const portal = ROUTES.filter(route => route.frame === "admin");
  return (
    // `base` keeps <Link> and useLocation correct when the app is served from a
    // sub-directory (GitHub Pages). It is "" for a root deployment.
    <WouterRouter base={BASE_PATH} hook={useReadyLocation}>
      <NavigationProgress />
      <ReferralCapture />
      <ScrollMemory />
      <Prefetcher />
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          {ROUTES.filter(route => route.frame === "bare").map(route => <Route key={route.path} path={route.path} component={route.page} />)}
          {/* The portal, in one frame that stays put while its pages change. */}
          <Route path={ADMIN_AREA}>
            <AdminLayout>
              <Switch>
                {portal.map(route => <Route key={route.path} path={route.path} component={route.page} />)}
                <Route component={AdminNotFound} />
              </Switch>
            </AdminLayout>
          </Route>
          {/* Everything else is the shop, in one frame that stays put while
              the page inside it changes — a 404 included. */}
          <Route>
            <StorefrontShell>
              <Switch>
                {storefront.map(route => <Route key={route.path} path={route.path} component={route.page} />)}
                <Route component={NotFound} />
              </Switch>
            </StorefrontShell>
          </Route>
        </Switch>
      </Suspense>
    </WouterRouter>
  );
}

/**
 * Toasts, at the top of the screen, under the header.
 *
 * They sat in the bottom corner on the bag's side, and "added to your cart"
 * fired as the bag drawer opened — so the confirmation covered the checkout
 * button it was confirming, on every add, in both languages, and on a phone it
 * covered the tab bar too. That toast is gone now, on the owner's word (the
 * drawer and the header's count say it); the rest still land here. The top centre is the one place
 * nothing a shopper presses next lives: the drawer's actions are at its foot,
 * the tab bar is at the bottom, and the offset keeps it under the header's
 * cart and account controls. `dir` still lays the text out right-to-left.
 */
function StorefrontToaster() {
  const { direction } = useTranslation();
  return <Toaster richColors dir={direction} position="top-center" offset={{ top: 84 }} mobileOffset={{ top: 72 }} />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <CustomerProvider>
          <CartProvider>
            <StorefrontToaster />
            {/* One drawer for the whole app: the cart button is on every page. */}
            <BagDrawerWhenWanted />
            <Router />
          </CartProvider>
        </CustomerProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
