/**
 * Loads the analytics tag, but only when it is actually configured.
 *
 * This used to be a `<script>` in index.html with `%VITE_ANALYTICS_ENDPOINT%`
 * in its src. Vite only substitutes those placeholders when the variable is
 * set, so every build without one shipped a tag pointing at a literal
 * `%VITE_ANALYTICS_ENDPOINT%/umami` — a 404 on every page load for every
 * visitor. The Pages workflow stripped the line with sed, which hid it there
 * and nowhere else: the Mac mini build would have shipped it.
 *
 * Injecting from here means an unset variable produces no tag at all.
 */
const ENDPOINT = import.meta.env.VITE_ANALYTICS_ENDPOINT?.trim();
const WEBSITE_ID = import.meta.env.VITE_ANALYTICS_WEBSITE_ID?.trim();

export function loadAnalytics(): void {
  if (!ENDPOINT || !WEBSITE_ID) return;
  if (document.querySelector("script[data-netlet-analytics]")) return;

  const script = document.createElement("script");
  script.src = `${ENDPOINT.replace(/\/+$/, "")}/umami`;
  script.defer = true;
  script.dataset.websiteId = WEBSITE_ID;
  script.dataset.netletAnalytics = "true";
  // Analytics must never be able to take the storefront down with it.
  script.onerror = () => script.remove();
  document.head.appendChild(script);
}
