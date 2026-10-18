/**
 * Switching between English and Arabic as one smooth change, on the owner's
 * word.
 *
 * The switch used to be a cut, and then a second cut: the page flipped from
 * left-to-right to right-to-left in one frame, and a moment later the product
 * names, which are read from the server in the page's language, arrived and
 * replaced the outlines that stood in for them. Two jumps for one press.
 *
 * Now it is the browser's own view transition. The page as it was is held
 * while the new language is drawn underneath — and while the catalogue's
 * words for it arrive, up to `SWITCH_WAIT_MS` — and then one cross-fades into
 * the other (`[data-switching="language"]` in `index.css`). Whatever is the
 * same in both languages, the navy band, the white cards, the pearl ground,
 * holds still, because the two pictures are added rather than layered; only
 * what moved to the other side fades across.
 *
 * Nothing changes for a browser without view transitions, for somebody who
 * asked for less motion, or for a tab nobody is looking at: those switch at
 * once, as before. The language a signed-in account brings with it is adopted
 * without this, since nobody pressed anything.
 */
import { flushSync } from "react-dom";

/** The longest the old page is held while the new language's words arrive. */
export const SWITCH_WAIT_MS = 500;

type TransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> };
};

/** Resolves once nothing is being fetched, or once `ms` have passed. */
export function settled(isBusy: () => boolean, ms = SWITCH_WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms;
  return new Promise(resolve => {
    /* A moment first: a query for the new language is started by an effect
       of the render the switch caused, so asking at once would find nothing
       busy and let go before the words were even asked for. A timer, never
       `requestAnimationFrame` — the browser draws no frames while a view
       transition waits on this, so a frame callback would never come and the
       page would sit frozen until the browser gave up, four seconds on. */
    const look = () => {
      if (!isBusy() || Date.now() >= deadline) resolve();
      else setTimeout(look, 30);
    };
    setTimeout(look, 20);
  });
}

export function switchLanguage(apply: () => void, isBusy: () => boolean) {
  const doc = document as TransitionDocument;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || still || doc.visibilityState !== "visible") {
    apply();
    return;
  }
  const root = doc.documentElement;
  root.dataset.switching = "language";
  try {
    const transition = doc.startViewTransition(async () => {
      flushSync(apply);
      await settled(isBusy);
    });
    const done = () => { delete root.dataset.switching; };
    transition.finished.then(done, done);
  } catch {
    delete root.dataset.switching;
    apply();
  }
}
