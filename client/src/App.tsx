/**
 * NetLet design reminder: public marketplace storefront in pearl white, luxury navy,
 * and NetLet Orange — with shopping state provided by NetLet’s own cart.
 */
import { BagDrawer } from "@/components/BagDrawer";
import { Toaster } from "@/components/ui/sonner";
import { useTranslation } from "@/lib/useTranslation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/contexts/CartContext";
import { CustomerProvider } from "@/contexts/CustomerContext";
import { BASE_PATH } from "@/lib/basePath";
import { lazy, Suspense } from "react";
import { Route, Router as WouterRouter, Switch } from "wouter";
import LiquidGlassFilters from "./components/LiquidGlassFilters";
import ErrorBoundary from "./components/ErrorBoundary";
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
const Category = lazy(() => import("@/pages/Category"));
/* The dashboard is a separate application in everything but deployment: no
   shopper ever loads it, so it stays out of the storefront's bundle. */
const DashboardProducts = lazy(() => import("@/pages/dashboard/Products"));
const DashboardProductEditor = lazy(() => import("@/pages/dashboard/ProductEditor"));
const DashboardReview = lazy(() => import("@/pages/dashboard/Review"));
const DashboardVendors = lazy(() => import("@/pages/dashboard/Vendors"));
const DashboardTeam = lazy(() => import("@/pages/dashboard/Team"));
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
        <Route path="/checkout" component={Checkout} />
        <Route path="/category/:slug" component={Category} />
        <Route path="/dashboard" component={DashboardProducts} />
        <Route path="/dashboard/products/:id" component={DashboardProductEditor} />
        <Route path="/dashboard/review" component={DashboardReview} />
        <Route path="/dashboard/vendors" component={DashboardVendors} />
        <Route path="/dashboard/team" component={DashboardTeam} />
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
