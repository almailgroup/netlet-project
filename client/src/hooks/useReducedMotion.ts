import { useEffect, useState } from "react";

/**
 * Whether the shopper has asked their system for less motion.
 *
 * This was a one-line `window.matchMedia(...).matches` read inside the card
 * gallery's effect, which was honest enough while the only motion was a cycle
 * somebody started by hovering. It stopped being enough once the cards began
 * cycling on their own: a preference read once, inside an effect, only takes
 * hold the next time that effect happens to re-run, so somebody who turns the
 * setting on to stop a page moving would watch it carry on moving.
 *
 * Subscribing is the whole difference. `change` fires the moment the system
 * preference flips, and every card re-renders and stops.
 *
 * It starts false on the server and on the first client render, which is the
 * right way round: the alternative is claiming a preference nobody has
 * expressed and disabling motion for everybody until the first effect runs.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
