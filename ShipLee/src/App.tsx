import { lazy, Suspense, useEffect } from "react";
import type { ReactElement } from "react";
import { Route, Switch, useLocation } from "wouter";
import { LanguageProvider } from "./i18n.js";
import { Layout } from "./components/Layout.js";
import { Home } from "./pages/Home.js";
import { TrackEmpty, TrackRoute } from "./pages/Track.js";
import { Help } from "./pages/Help.js";
import { NotFound } from "./pages/NotFound.js";
import { Preview } from "./pages/Preview.js";
import { Contact } from "./pages/Contact.js";
import { Report } from "./pages/Report.js";
import { Scams } from "./pages/Scams.js";
import { PreviewOnly, PreviewProvider } from "./preview.js";
/* The desk is for ShipLee's staff alone, so a customer's first visit does not download it, its labels' QR encoder included. */
const Staff = lazy(() => import("./staff/Staff.js").then(module => ({ default: module.Staff })));
/* The style guide is a design reference, never a customer's first page. */
const Styleguide = lazy(() => import("./pages/Styleguide.js").then(module => ({ default: module.Styleguide })));

/* Preview pages: designed, not connected, and never what a customer's first visit downloads. */
const Services = lazy(() => import("./pages/preview/Services.js").then(module => ({ default: module.Services })));
const Rates = lazy(() => import("./pages/preview/Rates.js").then(module => ({ default: module.Rates })));
const Book = lazy(() => import("./pages/preview/Book.js").then(module => ({ default: module.Book })));
const Locations = lazy(() => import("./pages/preview/Locations.js").then(module => ({ default: module.Locations })));
const SignIn = lazy(() => import("./pages/preview/Auth.js").then(module => ({ default: module.SignIn })));
const SignUp = lazy(() => import("./pages/preview/Auth.js").then(module => ({ default: module.SignUp })));
const Account = lazy(() => import("./pages/preview/Account.js").then(module => ({ default: module.Account })));
const About = lazy(() => import("./pages/preview/About.js").then(module => ({ default: module.About })));
const Careers = lazy(() => import("./pages/preview/Careers.js").then(module => ({ default: module.Careers })));
const Couriers = lazy(() => import("./pages/preview/Couriers.js").then(module => ({ default: module.Couriers })));

/** Each preview page's address, and what it draws where preview is on. */
const PREVIEW_ROUTES: readonly [string, () => ReactElement][] = [
  ["/services", () => <Services />],
  ["/rates", () => <Rates />],
  ["/book", () => <Book />],
  ["/locations", () => <Locations />],
  ["/signin", () => <SignIn />],
  ["/signup", () => <SignUp />],
  ["/account", () => <Account />],
  ["/about", () => <About />],
  ["/careers", () => <Careers />],
  ["/couriers", () => <Couriers />],
];

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
            <Route path="/track" component={TrackEmpty} />
            <Route path="/track/:number">{params => <TrackRoute number={params.number} />}</Route>
            <Route path="/help" component={Help} />
            <Route path="/contact" component={Contact} />
            <Route path="/report" component={Report} />
            <Route path="/scams" component={Scams} />
            {PREVIEW_ROUTES.map(([path, page]) => (
              <Route key={path} path={path}>
                <PreviewOnly>
                  <Suspense fallback={<Waiting />}>{page()}</Suspense>
                </PreviewOnly>
              </Route>
            ))}
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
