/**
 * The shop's words its first page never draws (`Shared/i18n/laterMessages.ts`),
 * fetched once, by the first page, dialog or drawer `lazyPage` fetches.
 *
 * Every piece of the shop that is not in the first download is reached
 * through `lazyPage`, which waits for this beside the piece's own code, so
 * nothing is drawn before its words are here — a word drawn as its key would
 * be the failure. A failed fetch is forgotten, so the next piece asks again
 * rather than inheriting it, and the page's own error path (the stale-build
 * recovery) answers it as it does a page whose code would not load.
 */
let words: Promise<unknown> | null = null;

export function laterWords(): Promise<unknown> {
  words ??= import("@shared/i18n/laterMessages").catch(error => {
    words = null;
    throw error;
  });
  return words;
}
