/**
 * "Are you sure?", for moves that cost something to undo.
 *
 * Uses `useOverlay`, so it owes what every overlay here owes: Escape closes,
 * focus returns to whatever opened it, the page behind stops scrolling.
 *
 * The confirm button carries the *verb*, not "OK" — somebody who opened this
 * by accident reads the button, not the paragraph, and "Sign out" tells them
 * what they are about to do where "OK" tells them nothing. Cancel is focused
 * on open for the same reason: the safe answer should be the one a stray
 * Enter gives.
 *
 * **It is the site's own white, on the owner's word** ("use the white color
 * of the website itself"): it was a warm cream (#fffdf9) that read as a
 * different surface from every card behind it. White now, on a hairline rim,
 * the icon in a round tile with a faint halo, and pill buttons the height of
 * the site's others. The confirm is still first in the document, so the
 * keyboard's order and every walk that presses it by name are unchanged.
 */
import { useTranslation } from "@/hooks/useTranslation";
import { useOverlay } from "@/hooks/useOverlay";
import { useHeldWhileOpen, usePresence } from "@/hooks/usePresence";
import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = "normal",
  pending = false,
  icon,
  confirmDisabled = false,
  confirmHidden = false,
  children,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /**
   * The safe answer's words, when "Cancel" would collide with the act itself —
   * "Cancel this item?" over a Cancel button and a confirm button is two
   * buttons that both say cancel.
   */
  cancelLabel?: string;
  /** `danger` for anything that destroys or ends something. */
  tone?: "normal" | "danger";
  pending?: boolean;
  icon?: ReactNode;
  /** True while a field below the sentence holds something the act would refuse. */
  confirmDisabled?: boolean;
  /** The act is a control of its own in `children` — Apple's button — so the dialog draws only the safe answer. */
  confirmHidden?: boolean;
  /** A field the act needs — an amount, a percentage — drawn under the sentence. */
  children?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useOverlay(open, onClose);

  useEffect(() => {
    if (open) window.setTimeout(() => cancelRef.current?.focus(), 40);
  }, [open]);

  /* It plays its way out, with the words it was opened with — the removal
     question clears its own as it closes. */
  const { mounted, closing } = usePresence(open);
  const shown = useHeldWhileOpen(open, { title, body, confirmLabel, cancelLabel, tone, icon, children, confirmHidden });
  if (!mounted) return null;

  return (
    <div
      className="overlay-scrim fixed inset-0 z-[90] grid place-items-center bg-[#061b3b]/50 p-4"
      data-closing={closing ? "" : undefined}
      inert={closing}
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="overlay-pop w-full max-w-[400px] rounded-[28px] border border-[#0a285a]/[.07] bg-white p-6 shadow-[0_24px_64px_rgba(10,40,90,.22),0_2px_6px_rgba(10,40,90,.08)] sm:p-7"
      >
        {shown.icon ? (
          <div
            className={`grid size-12 place-items-center rounded-full ring-[6px] [&_svg]:size-[22px] ${
              shown.tone === "danger"
                ? "bg-[#fdeceb] text-[#8c2f22] ring-[#fdeceb]/50"
                : "bg-[#eef2f8] text-[#0a285a] ring-[#eef2f8]/60"
            }`}
          >
            {shown.icon}
          </div>
        ) : null}

        <h2 id={titleId} className={`${shown.icon ? "mt-5" : ""} text-[19px] font-extrabold leading-7 text-[#0a285a]`}>{shown.title}</h2>
        <p className="type-body mt-1.5 text-[14.5px] leading-6 text-[#536b8c]">{shown.body}</p>
        {shown.children ? <div className="mt-4">{shown.children}</div> : null}

        <div className="mt-6 flex flex-wrap gap-2.5">
          {shown.confirmHidden ? null : <button
            type="button"
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
            className={`pressable inline-flex h-12 min-w-[7.5rem] flex-1 items-center justify-center gap-2 rounded-full px-5 text-white shadow-[0_6px_16px_rgba(10,40,90,.16)] transition disabled:opacity-60 disabled:shadow-none ${
              shown.tone === "danger" ? "bg-[#8c2f22] hover:bg-[#7a2a1e]" : "bg-[#0a285a] hover:bg-[#0d3372]"
            }`}
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {shown.confirmLabel}
          </button>}
          <button
            type="button"
            ref={cancelRef}
            onClick={onClose}
            disabled={pending}
            className="pressable inline-flex h-12 min-w-[7.5rem] flex-1 items-center justify-center rounded-full border border-[#d5dfeb] bg-white px-5 text-[#0a285a] hover:bg-[#f0f2f5] disabled:opacity-60"
          >
            {shown.cancelLabel ?? t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
