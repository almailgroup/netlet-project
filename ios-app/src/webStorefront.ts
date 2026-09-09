/**
 * Contract between the native shell and the web storefront it wraps.
 *
 * Reconstructed from App.tsx's usage after the original file was lost — the
 * app imported it but it was never committed, so the project could not bundle.
 *
 * The shell is a WebView around the live site plus a native navigation bar and
 * haptics. Everything here is the seam between the two halves, so a change on
 * either side has to be matched on the other.
 */

/**
 * The site the WebView loads.
 *
 * Must be https: App.tsx sets `originWhitelist={["https://*"]}`, so an http URL
 * is refused rather than loaded. Point this at a local tunnel when developing
 * against an unpublished build.
 */
export const MOBILE_STOREFRONT_URL = "https://almailgroup.github.io/netlet-project/";

/**
 * Items in the native bottom bar, in display order.
 *
 * These mirror the web storefront's own mobile navigation, and the strings are
 * the contract: the shell forwards the label verbatim to
 * `window.__netletInvokeMobileNavigation(label)`, so renaming one here without
 * renaming it on the web silently breaks that item.
 *
 * "Account" is handled natively rather than forwarded — App.tsx intercepts it
 * and presents its own sheet.
 */
export const MOBILE_NAVIGATION_LABELS = ["Home", "Browse", "Saved", "Account", "Cart"] as const;

/**
 * Haptic feedback the web storefront may request, by posting
 * `{ type: "storefront-haptic", action }` to the WebView bridge.
 *
 * App.tsx checks membership before playing anything, so an unrecognised action
 * is ignored rather than throwing — but it also means a new action added on the
 * web side does nothing until it is listed here.
 */
export const STOREFRONT_HAPTIC_ACTIONS = ["selection", "navigation", "medium", "success"] as const;
