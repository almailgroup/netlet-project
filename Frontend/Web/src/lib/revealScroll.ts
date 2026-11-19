/**
 * Bringing an opened department up to the top of the screen, so its
 * subcategories unfold into view — on the owner's word ("when you tap on a
 * category, it should automatically scroll down showing the sub categories
 * … when you tap on any category").
 *
 * It used to scroll only when the list started below 70% of the screen, so a
 * department in the first rows unfolded half off the foot of a phone and the
 * page did nothing. Now every press glides: the tile pressed comes to rest
 * just under the header, and the list unfolds under it with all the room the
 * screen has.
 *
 * **The glide is driven frame by frame, not by `scrollIntoView`.** The list
 * unfolds over 300ms (`.cat-unfold`), and while it does the page is shorter
 * than it will be — a smooth scroll to a place past its foot is cut short
 * where the page ends at that moment, and a department in the last row never
 * got there. A list folding away above the tile moves the tile up as it goes,
 * too. So each frame asks where the tile is now and moves a step toward that.
 */

/** How long the glide runs: the unfold's 300ms and a little after, so it settles with the list. */
export const GLIDE_MS = 420;

/** The room left between the header's foot and the tile pressed. */
export const REVEAL_GAP = 12;

export interface RevealLayout {
  /** Where the page is now. */
  scrollY: number;
  /** The tile's top on the screen (`getBoundingClientRect().top`). */
  tileTop: number;
  /** How much of the top of the screen the stuck header covers. */
  covered: number;
  /** How far the page can scroll now. */
  maxScroll: number;
}

/**
 * Where the page should be for the tile to sit just under the header — never
 * past where the page can go and never above its top.
 */
export function revealTarget({ scrollY, tileTop, covered, maxScroll }: RevealLayout): number {
  const wanted = scrollY + tileTop - covered - REVEAL_GAP;
  return Math.max(0, Math.min(wanted, Math.max(0, maxScroll)));
}

/** How far through the glide it is, eased out (quick at first, settling at the end). */
export function glideProgress(elapsed: number, duration = GLIDE_MS): number {
  if (duration <= 0) return 1;
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return 1 - (1 - t) ** 3;
}

/** The page's place on one frame: from where it began toward where the tile is now. */
export function glideFrame(start: number, target: number, progress: number): number {
  return start + (target - start) * progress;
}

/** How much of the top of the screen a stuck header covers: its height and where it sticks. */
function coveredBy(header: HTMLElement | null): number {
  if (!header) return 0;
  const style = window.getComputedStyle(header);
  if (style.position !== "sticky" && style.position !== "fixed") return 0;
  const top = Number.parseFloat(style.top);
  return Math.max(0, header.offsetHeight + (Number.isFinite(top) ? top : 0));
}

/**
 * Glides the page until `tile` sits under the shop's header, following it
 * while the lists above and below it fold and unfold. A wheel, a touch or a
 * key stops it where it is, since the shopper has taken the page back; under
 * reduced motion it jumps. Returns a function that stops it.
 */
export function glideTileIntoView(tile: HTMLElement): () => void {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const root = document.documentElement;
  const header = document.querySelector<HTMLElement>(".sticky-header");
  const start = window.scrollY;
  const began = performance.now();
  /*
   * The browser's own scroll anchoring moves the page when something above
   * what it is anchored to changes height — the list folding away above —
   * which would pull every frame away from where this put it.
   */
  const anchor = root.style.overflowAnchor;
  root.style.overflowAnchor = "none";
  let frame = 0;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    window.cancelAnimationFrame(frame);
    root.style.overflowAnchor = anchor;
    for (const kind of TAKEN_BACK) window.removeEventListener(kind, stop);
  };
  for (const kind of TAKEN_BACK) window.addEventListener(kind, stop, { passive: true });
  /* Under reduced motion it still follows for a few frames, while the list's height lands. */
  const duration = still ? 0 : GLIDE_MS;
  const step = () => {
    const elapsed = performance.now() - began;
    const target = revealTarget({
      scrollY: window.scrollY,
      tileTop: tile.getBoundingClientRect().top,
      covered: coveredBy(header),
      maxScroll: root.scrollHeight - window.innerHeight,
    });
    const top = glideFrame(start, target, glideProgress(elapsed, duration));
    /* `instant`: the page's own `scroll-behavior: smooth` would ease every frame again. */
    window.scrollTo({ top, behavior: "instant" });
    if (elapsed >= Math.max(duration, 80)) return stop();
    frame = window.requestAnimationFrame(step);
  };
  frame = window.requestAnimationFrame(step);
  return stop;
}

/** What says the shopper has taken the page back from the glide. */
const TAKEN_BACK = ["wheel", "touchstart", "keydown"] as const;
