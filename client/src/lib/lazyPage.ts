/**
 * A page whose code is fetched when it is first needed — and, once fetched,
 * drawn at once.
 *
 * `React.lazy` alone suspends on its first render even when the code is
 * already in the browser: it asks for the module, gets a promise, and a
 * promise is only ever answered a tick later. So a page fetched in advance
 * still flashed its loading outline for a frame on the way in, which made
 * fetching it in advance nearly pointless. This keeps the module once it has
 * arrived and renders it directly from then on; `lazy` is only the first-time
 * path.
 *
 * `preload` is what the shell calls when a pointer comes to rest on a link, a
 * finger lands on one, or the browser is idle — by the press, the page is
 * usually already here.
 */
import { createElement, lazy, type ComponentType, type ReactElement } from "react";

/* A route hands its page the matched params; none of the pages read them as props. */
type Props = object;
export type LazyPage = ((props: Props) => ReactElement) & {
  preload: () => Promise<unknown>;
  /** Whether the code is here, so a move to the page need not wait. */
  loaded: () => boolean;
};

export function lazyPage(load: () => Promise<{ default: ComponentType<Props> }>): LazyPage {
  let loaded: ComponentType<Props> | null = null;
  let pending: Promise<{ default: ComponentType<Props> }> | null = null;
  const preload = () => {
    pending ??= load().then(
      module => {
        loaded = module.default;
        return module;
      },
      error => {
        /* Forgotten, so the next attempt asks again rather than inheriting it. */
        pending = null;
        throw error;
      },
    );
    return pending;
  };
  const Lazy = lazy(preload);
  const Page = (props: Props) => createElement(loaded ?? Lazy, props);
  return Object.assign(Page, { preload, loaded: () => loaded !== null });
}
