/**
 * Starts fetching a page the moment somebody shows they are about to open it.
 *
 * A pointer coming to rest on a link, a finger landing on one, or the keyboard
 * reaching one: each happens a hundred milliseconds or more before the press
 * that opens the page, and that is usually long enough for the page's code —
 * and, for a product, the product itself — to be in the browser by the time
 * the press lands. The page then draws at once instead of showing its outline.
 *
 * One listener on the document rather than one per link, so every anchor on
 * the site takes part without knowing it, including ones drawn later. Each
 * address is asked for once per visit; asking again would only hit the cache.
 *
 * Only this site's own addresses, and only plain links — not a download, not
 * one opening a new window — since those are not a page this app will draw.
 *
 * A side effect worth having: Safari only draws `:active` styles while the
 * document has a `touchstart` listener, so this is also what makes a press on
 * a phone visibly press.
 */
import { BASE_PATH } from "@/lib/basePath";
import { useEffect, useRef } from "react";

export function useIntentPrefetch(prefetch: (path: string, search: string) => void) {
  const handler = useRef(prefetch);
  handler.current = prefetch;

  useEffect(() => {
    const asked = new Set<string>();

    const consider = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(link.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      let path = url.pathname;
      if (BASE_PATH) {
        if (path !== BASE_PATH && !path.startsWith(`${BASE_PATH}/`)) return;
        path = path.slice(BASE_PATH.length) || "/";
      }
      const key = path + url.search;
      if (asked.has(key)) return;
      asked.add(key);
      handler.current(path, url.search);
    };

    const onPointer = (event: PointerEvent) => {
      /* A touch is answered by `touchstart`, which comes first. */
      if (event.pointerType === "mouse" || event.pointerType === "pen") consider(event.target);
    };
    const onTouch = (event: TouchEvent) => consider(event.target);
    const onFocus = (event: FocusEvent) => consider(event.target);

    document.addEventListener("pointerover", onPointer, { passive: true });
    document.addEventListener("touchstart", onTouch, { passive: true });
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerover", onPointer);
      document.removeEventListener("touchstart", onTouch);
      document.removeEventListener("focusin", onFocus);
    };
  }, []);
}
