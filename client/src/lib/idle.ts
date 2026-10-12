/**
 * Run something once the browser has nothing better to do, and say how to stop it.
 *
 * For fetching what a page will probably want after its first paint — the bag
 * drawer, the address book — without putting it in front of that paint.
 * Safari has no `requestIdleCallback`, so it gets a timer instead.
 */
export function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(run, 1500);
  return () => window.clearTimeout(handle);
}
