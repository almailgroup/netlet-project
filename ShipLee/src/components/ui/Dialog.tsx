import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useLanguage } from "../../i18n.js";

/**
 * The one dialog: a card in the middle of the screen, a sheet rising from the
 * foot of a phone, or (`drawer`) a panel from the page's end edge.
 *
 * It is the browser's own `<dialog>` opened with `showModal()`, so the page
 * behind is inert, Tab stays inside and Escape closes it without any of that
 * written here. What is written here: focus goes back to whatever opened it,
 * a press on the dim outside closes it, and its contents are only drawn while
 * it is open, so a form inside starts empty every time.
 */
export function Dialog({ open, onClose, title, lead, children, footer, variant = "modal", closeLabel }: {
  open: boolean;
  onClose: () => void;
  title: string;
  lead?: string;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "modal" | "drawer";
  closeLabel?: string;
}) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const leadId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
      /* A field marked to start with focus gets it; otherwise the browser's own choice, the first control. */
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  /* Whatever closed it — Escape, the close button, a press outside — the page is told, and focus goes home. */
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const closed = () => {
      onClose();
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    };
    dialog.addEventListener("close", closed);
    return () => dialog.removeEventListener("close", closed);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`dialog${variant === "drawer" ? " drawer" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={lead ? leadId : undefined}
      onClick={event => {
        /* The dialog box itself is only ever hit outside its contents: on the dim. */
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      {open ? (
        <>
          <div className="dialog-head">
            <div>
              <h2 id={titleId}>{title}</h2>
              {lead ? <p id={leadId}>{lead}</p> : null}
            </div>
            <button type="button" className="button button-quiet button-icon button-small" onClick={() => ref.current?.close()} aria-label={closeLabel ?? t("ui.close")}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <div className="dialog-body">{children}</div>
          {footer ? <div className="dialog-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}
