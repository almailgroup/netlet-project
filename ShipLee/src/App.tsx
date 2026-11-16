import { lazy, Suspense, useEffect } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { LanguageProvider } from "./i18n.js";
import { Layout } from "./components/Layout.js";
import { Home } from "./pages/Home.js";
import { Track } from "./pages/Track.js";
import { Help } from "./pages/Help.js";
import { NotFound } from "./pages/NotFound.js";
import { Preview } from "./pages/Preview.js";
import { PreviewProvider } from "./preview.js";
/* The desk is for ShipLee's staff alone, so a customer's first visit does not download it, its labels' QR encoder included. */
const Staff = lazy(() => import("./staff/Staff.js").then(module => ({ default: module.Staff })));
/* The style guide is a design reference, never a customer's first page. */
const Styleguide = lazy(() => import("./pages/Styleguide.js").then(module => ({ default: module.Styleguide })));

const Waiting = () => <div className="container"><div className="page-head" aria-busy="true" /></div>;

/** A new page starts at its top. */
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location]);
  return null;
}

export function App() {
  return (
    <LanguageProvider>
      <PreviewProvider>
        <ScrollToTop />
        <Layout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/track"><Redirect to="/" replace /></Route>
            <Route path="/track/:number">{params => <Track number={params.number} />}</Route>
            <Route path="/help" component={Help} />
            <Route path="/preview" component={Preview} />
            <Route path="/styleguide">
              <Suspense fallback={<Waiting />}><Styleguide /></Suspense>
            </Route>
            {/* One route for the whole desk, so moving inside it keeps its session. */}
            <Route path="/staff/*?">
              <Suspense fallback={<Waiting />}>
                <Staff />
              </Suspense>
            </Route>
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </PreviewProvider>
    </LanguageProvider>
  );
}
