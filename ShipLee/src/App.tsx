import { lazy, Suspense, useEffect } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { LanguageProvider } from "./i18n.js";
import { Layout } from "./components/Layout.js";
import { Home } from "./pages/Home.js";
import { Track } from "./pages/Track.js";
import { Help } from "./pages/Help.js";
import { NotFound } from "./pages/NotFound.js";
/* The desk is for ShipLee's staff alone, so a customer's first visit does not download it, its labels' QR encoder included. */
const Staff = lazy(() => import("./staff/Staff.js").then(module => ({ default: module.Staff })));

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
      <ScrollToTop />
      <Layout>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/track"><Redirect to="/" replace /></Route>
          <Route path="/track/:number">{params => <Track number={params.number} />}</Route>
          <Route path="/help" component={Help} />
          {/* One route for the whole desk, so moving inside it keeps its session. */}
          <Route path="/staff/*?">
            <Suspense fallback={<div className="container"><div className="page-head" aria-busy="true" /></div>}>
              <Staff />
            </Suspense>
          </Route>
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </LanguageProvider>
  );
}
