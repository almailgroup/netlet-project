/**
 * A panel that opens and closes by its height, for a section kept folded until
 * it is asked for — checkout's codes and gift card, its ways to pay.
 *
 * The height eases between nothing and what the content needs by a grid row
 * (`0fr` to `1fr`, `.unfold` in `index.css`), so what is below moves with it
 * rather than jumping; a cut for somebody who asked for less motion. Folded,
 * it is `inert`, so neither the keyboard nor a screen reader reaches what
 * cannot be seen. The content keeps a few pixels of room inside the clip, so
 * a focus ring at its edge is drawn whole.
 */
import type { ReactNode } from "react";

export function Unfold({ open, id, children, className = "" }: { open: boolean; id?: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} className={`unfold ${className}`} data-open={open ? "" : undefined} inert={!open}>
      <div className="-mx-1 min-h-0 overflow-hidden">
        <div className="px-1 py-1">{children}</div>
      </div>
    </div>
  );
}
