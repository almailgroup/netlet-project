/**
 * What a page draws just after its first paint rather than in it.
 *
 * The home page drew all of itself in one go — the front door, the
 * departments, and below them some thirty product cards on four shelves — so
 * the phone showed nothing until the last card was built, and the build was
 * one long stretch in which a tap could not be answered. Everything below the
 * first screen now waits for the frame after the first paint and is then
 * built as a transition, which React breaks into small pieces between which
 * the page stays answerable.
 *
 * It waits one frame, not for anything to load, so Back to a shelf far down
 * the home page still lands: `ScrollMemory` keeps trying for about a second
 * while the page grows to where it was.
 */
import { startTransition, useEffect, useState, type ReactNode } from "react";

export function Later({ children, reserve = 600 }: { children: ReactNode; reserve?: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    const frame = requestAnimationFrame(() => startTransition(() => setShown(true)));
    return () => cancelAnimationFrame(frame);
  }, [shown]);
  /* Room kept below the first screen, so the footer does not ride up and
     then get pushed down again a frame later. */
  return shown ? <>{children}</> : <div aria-hidden style={{ minHeight: reserve }} />;
}
