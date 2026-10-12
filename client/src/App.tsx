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
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Route, Router as WouterRouter, Switch, useLocation, useSearch } from "wouter";
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
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const Account = lazy(() => import("@/pages/Account"));
const SignIn = lazy(() => import("@/pages/SignIn"));
const Saved = lazy(() => import("@/pages/Saved"));
const Cart = lazy(() => import("@/pages/Cart"));
const Returns = lazy(() => import("@/pages/Returns"));
const Help = lazy(() => import("@/pages/Help"));
const GiftList = lazy(() => import("@/pages/GiftList"));
const Invoice = lazy(() => import("@/pages/Invoice"));
const InvoiceVerify = lazy(() => import("@/pages/InvoiceVerify"));
const AdminInvoices = lazy(() => import("@/pages/admin/Invoices"));
const Category = lazy(() => import("@/pages/Category"));
/* The admin portal is a separate application in everything but deployment: no
   shopper ever loads it, so it stays out of the storefront's bundle. */
const AdminOverview = lazy(() => import("@/pages/admin/Overview"));
const AdminProducts = lazy(() => import("@/pages/admin/Products"));
const AdminPeople = lazy(() => import("@/pages/admin/People"));
const AdminAudit = lazy(() => import("@/pages/admin/Audit"));
const AdminStock = lazy(() => import("@/pages/admin/Stock"));
const AdminOrders = lazy(() => import("@/pages/admin/Orders"));
const AdminImport = lazy(() => import("@/pages/admin/Import"));
const AdminPromotions = lazy(() => import("@/pages/admin/Promotions"));
const AdminApplications = lazy(() => import("@/pages/admin/Applications"));
const AdminBundles = lazy(() => import("@/pages/admin/Bundles"));
const AdminDispatch = lazy(() => import("@/pages/admin/Dispatch"));
const AdminCouriers = lazy(() => import("@/pages/admin/Couriers"));
const AdminClaims = lazy(() => import("@/pages/admin/Claims"));
const AdminMessages = lazy(() => import("@/pages/admin/Messages"));
const AdminReturns = lazy(() => import("@/pages/admin/Returns"));
const AdminFeatures = lazy(() => import("@/pages/admin/Features"));
const AdminAffiliates = lazy(() => import("@/pages/admin/Affiliates"));
const AdminPayouts = lazy(() => import("@/pages/admin/Payouts"));
const AdminAds = lazy(() => import("@/pages/admin/Ads"));
const AdminSubscriptions = lazy(() => import("@/pages/admin/Subscriptions"));
const AdminSupport = lazy(() => import("@/pages/admin/Support"));
const AdminFulfilment = lazy(() => import("@/pages/admin/Fulfilment"));
const AdminMembership = lazy(() => import("@/pages/admin/Membership"));
const Sell = lazy(() => import("@/pages/Sell"));
const AdminFinance = lazy(() => import("@/pages/admin/Finance"));
const AdminOffers = lazy(() => import("@/pages/admin/Offers"));
const AdminProductEditor = lazy(() => import("@/pages/admin/ProductEditor"));
const AdminNewProduct = lazy(() => import("@/pages/admin/NewProduct"));
const AdminReview = lazy(() => import("@/pages/admin/Review"));
const AdminVendors = lazy(() => import("@/pages/admin/Vendors"));
const AdminVendorNew = lazy(() => import("@/pages/admin/VendorNew"));
const AdminVendorDetail = lazy(() => import("@/pages/admin/VendorDetail"));
const AdminTeam = lazy(() => import("@/pages/admin/Team"));
const NotFound = lazy(() => import("@/pages/NotFound"));

/**
 * Shown while a route chunk is in flight. Deliberately the page's own ground
 * colour with a single centred mark rather than a spinner on white: on a fast
 * connection this is on screen for a few frames, and a white flash between two
 * off-white pages reads as a fault.
 */
/**
 * What shows while a page's code arrives: the page's shape, not a spinner.
 *
 * A spinner in the middle of an empty screen on every first visit to a page
 * read as the whole shop reloading; a header-height strip and grey blocks
 * where the content will be say "this page, nearly here" and do not jump
 * when it lands. A product page, a department grid and anything else get
 * their own outline.
 */
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

function RouteFallback() {
  const [location] = useLocation();
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
      ? <div className={`mx-auto h-[560px] max-w-[480px] lg:mx-0 ${block}`} />
    : location.startsWith("/category/") || location.startsWith("/search") || location === "/saved"
      ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className={`h-72 ${block}`} />)}
          </div>
        )
      : (
          <div className="space-y-4">
            <div className={`h-8 w-1/3 ${block}`} />
            <div className={`h-40 ${block}`} />
            <div className={`h-40 ${block}`} />
          </div>
        );
  return (
    <div className="min-h-screen bg-background" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="h-[72px] border-b border-[#e6e9ef] bg-white lg:h-[124px]" aria-hidden />
      <div className="container py-8" aria-hidden>{shape}</div>
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

function Router() {
  return (
    // `base` keeps <Link> and useLocation correct when the app is served from a
    // sub-directory (GitHub Pages). It is "" for a root deployment.
    <WouterRouter base={BASE_PATH}>
      <ReferralCapture />
      <ScrollMemory />
      <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/signin" component={SignIn} />
        <Route path="/signup" component={SignIn} />
        <Route path="/login" component={SignIn} />
        <Route path="/register" component={SignIn} />
        <Route path="/account" component={Account} />
        <Route path="/account/:section" component={Account} />
        <Route path="/saved" component={Saved} />
        <Route path="/cart" component={Cart} />
        <Route path="/returns" component={Returns} />
        <Route path="/help" component={Help} />
        <Route path="/gifts/:token" component={GiftList} />
        <Route path="/gifts" component={GiftList} />
        <Route path="/invoices/verify/:number" component={InvoiceVerify} />
        <Route path="/invoices/:number" component={Invoice} />
        <Route path="/checkout" component={Checkout} />
        <Route path="/sell" component={Sell} />
        <Route path="/category/:slug" component={Category} />
        {/* Search results are the department layout over the whole catalog. */}
        <Route path="/search" component={Category} />
        <Route path="/admin" component={AdminOverview} />
        <Route path="/admin/products" component={AdminProducts} />
        {/* Before `:id`, which would otherwise read "new" as a product id. */}
        <Route path="/admin/products/new" component={AdminNewProduct} />
        <Route path="/admin/products/:id" component={AdminProductEditor} />
        <Route path="/admin/review" component={AdminReview} />
        <Route path="/admin/stock" component={AdminStock} />
        <Route path="/admin/orders" component={AdminOrders} />
        <Route path="/admin/import" component={AdminImport} />
        <Route path="/admin/promotions" component={AdminPromotions} />
        <Route path="/admin/applications" component={AdminApplications} />
        <Route path="/admin/bundles" component={AdminBundles} />
        {/* The fifth party's own board (2.2, 3.4.2), inside the same portal
            rather than a shell of its own: scope is already decided by the
            server, and two shells would be two navigations showing the same
            links. A courier sees only these. */}
        <Route path="/admin/dispatch" component={AdminDispatch} />
        <Route path="/admin/couriers" component={AdminCouriers} />
        <Route path="/admin/claims" component={AdminClaims} />
        <Route path="/admin/messages" component={AdminMessages} />
        <Route path="/admin/returns" component={AdminReturns} />
        <Route path="/admin/features" component={AdminFeatures} />
        <Route path="/admin/affiliates" component={AdminAffiliates} />
        <Route path="/admin/payouts" component={AdminPayouts} />
        <Route path="/admin/ads" component={AdminAds} />
        <Route path="/admin/subscriptions" component={AdminSubscriptions} />
        <Route path="/admin/support" component={AdminSupport} />
        <Route path="/admin/fulfilment" component={AdminFulfilment} />
        <Route path="/admin/membership" component={AdminMembership} />
        <Route path="/admin/invoices" component={AdminInvoices} />
        <Route path="/admin/finance" component={AdminFinance} />
        <Route path="/admin/offers" component={AdminOffers} />
        <Route path="/admin/vendors" component={AdminVendors} />
        <Route path="/admin/vendors/new" component={AdminVendorNew} />
        <Route path="/admin/vendors/:id" component={AdminVendorDetail} />
        <Route path="/admin/people" component={AdminPeople} />
        <Route path="/admin/audit" component={AdminAudit} />
        <Route path="/admin/team" component={AdminTeam} />
        {/* The portal used to live at /dashboard. Anyone who bookmarked it
            lands here rather than on a 404 that looks like the tool is gone. */}
        <Route path="/dashboard/:rest*" component={LegacyAdminRedirect} />
        <Route path="/dashboard" component={LegacyAdminRedirect} />
        <Route path="/products/:handle" component={ProductDetail} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
      </Suspense>
    </WouterRouter>
  );
}

/**
 * Toasts, at the top of the screen, under the header.
 *
 * They sat in the bottom corner on the bag's side, and "added to your cart" is
 * the toast that fires as the bag drawer opens — so the confirmation covered
 * the checkout button it was confirming, on every add, in both languages, and
 * on a phone it covered the tab bar too. The top centre is the one place
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
