/**
 * Base path helpers for sub-directory deployments (e.g. GitHub Pages, which
 * serves this app from `/<repo-name>/` rather than the domain root).
 *
 * Vite injects `import.meta.env.BASE_URL` from the `base` config option, so a
 * root deployment keeps returning "/" and every helper below is a no-op there.
 */

/** Base URL without a trailing slash — "" at the domain root, "/netlet-project" on Pages. */
export const BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

/**
 * Prefix an app-absolute path with the deployment base.
 *
 * Use for raw `window.location` navigations and plain `<a href>` targets.
 * wouter's `<Link>` and `useLocation` already resolve against the `<Router base>`
 * set in App.tsx, so they must NOT be passed through this helper — doing so
 * would apply the base twice.
 */
export function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
}
