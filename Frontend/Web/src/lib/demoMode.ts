/**
 * Static-demo flag.
 *
 * Set by the GitHub Pages workflow (VITE_DEMO_MODE=true) to build a version of
 * the storefront that runs with no backend: tRPC calls resolve from local
 * fixtures and the OAuth sign-in flow is disabled. Any other build leaves this
 * false and behaves exactly as before.
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
