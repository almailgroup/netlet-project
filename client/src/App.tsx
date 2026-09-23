/**
 * NetLet design reminder: public marketplace storefront in pearl white, luxury navy,
 * and NetLet Orange — with shopping state provided by NetLet’s own cart.
 */
import { BagDrawer } from "@/components/cart/BagDrawer";
import { Toaster } from "@/components/ui/sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/contexts/CartContext";
import { CustomerProvider } from "@/contexts/CustomerContext";
import { BASE_PATH } from "@/lib/basePath";
import { lazy, Suspense, useEffect } from "react";
import { Route, Router as WouterRouter, Switch, useLocation } from "wouter";
import LiquidGlassFilters from "./components/ui/LiquidGlassFilters";
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
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const Account = lazy(() => import("@/pages/Account"));
const Saved = lazy(() => import("@/pages/Saved"));
const GiftList = lazy(() => import("@/pages/GiftList"));
const Category = lazy(() => import("@/pages/Category"));
/* The admin portal is a separate application in everything but deployment: no
   shopper ever loads it, so it stays out of the storefront's bundle. */
const AdminOverview = lazy(() => import("@/pages/admin/Overview"));
const AdminProducts = lazy(() => import("@/pages/admin/Products"));
const AdminPeople = lazy(() => import("@/pages/admin/People"));
const AdminAudit = lazy(() => import("@/pages/admin/Audit"));
const AdminStock = lazy(() => import("@/pages/admin/Stock"));
const AdminFinance = lazy(() => import("@/pages/admin/Finance"));
const AdminProductEditor = lazy(() => import("@/pages/admin/ProductEditor"));
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
function RouteFallback() {
  return (
    <div className="grid min-h-screen place-items-center bg-background" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <span className="size-8 animate-spin rounded-full border-2 border-[#d5dfeb] border-t-[#f2683a]" aria-hidden />
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

function Router() {
  return (
    // `base` keeps <Link> and useLocation correct when the app is served from a
    // sub-directory (GitHub Pages). It is "" for a root deployment.
    <WouterRouter base={BASE_PATH}>
      <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/account" component={Account} />
        <Route path="/saved" component={Saved} />
        <Route path="/gifts/:token" component={GiftList} />
        <Route path="/gifts" component={GiftList} />
        <Route path="/checkout" component={Checkout} />
        <Route path="/category/:slug" component={Category} />
        <Route path="/admin" component={AdminOverview} />
        <Route path="/admin/products" component={AdminProducts} />
        <Route path="/admin/products/:id" component={AdminProductEditor} />
        <Route path="/admin/review" component={AdminReview} />
        <Route path="/admin/stock" component={AdminStock} />
        <Route path="/admin/finance" component={AdminFinance} />
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
 * Toasts, on the shopper's side of the screen.
 *
 * Sonner needs both: `dir` so the text lays out right-to-left, and a mirrored
 * corner, because a notice pinned to the bottom-right of an Arabic page sits
 * away from where the eye is already working. Rendered inside the provider so
 * it re-reads the locale when the shopper switches.
 */
function StorefrontToaster() {
  const { direction } = useTranslation();
  return <Toaster richColors dir={direction} position={direction === "rtl" ? "bottom-left" : "bottom-right"} />;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <CustomerProvider>
            <CartProvider>
              <StorefrontToaster />
              <LiquidGlassFilters />
              {/* One drawer for the whole app: the cart button is on every page. */}
              <BagDrawer />
              <Router />
            </CartProvider>
          </CustomerProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
