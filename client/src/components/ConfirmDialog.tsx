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
 */
import { useTranslation } from "@/lib/useTranslation";
import { useOverlay } from "@/lib/useOverlay";
import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = "normal",
  pending = false,
  icon,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /** `danger` for anything that destroys or ends something. */
  tone?: "normal" | "danger";
  pending?: boolean;
  icon?: ReactNode;
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-[#061b3b]/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="w-full max-w-[400px] rounded-3xl bg-[#fffdf9] p-6 shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        {icon ? (
          <div
            className={`grid size-11 place-items-center rounded-2xl ${
              tone === "danger" ? "bg-[#fdeceb] text-[#8c2f22]" : "bg-[#e7edf5] text-[#0a285a]"
            }`}
          >
            {icon}
          </div>
        ) : null}

        <h2 id={titleId} className="mt-4 text-lg font-extrabold text-[#0a285a]">{title}</h2>
        <p className="type-body mt-2 text-sm leading-6 text-[#536b8c]">{body}</p>

        <div className="mt-6 flex flex-wrap gap-2.5">
          <button
            onClick={onConfirm}
            disabled={pending}
            className={`pressable inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-extrabold text-white transition disabled:opacity-60 ${
              tone === "danger" ? "bg-[#8c2f22] hover:bg-[#7a2a1e]" : "bg-[#0a285a] hover:bg-[#0d3372]"
            }`}
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            onClick={onClose}
            disabled={pending}
            className="glass pressable inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-[#d5dfeb] text-sm font-extrabold text-[#0a285a] disabled:opacity-60"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
