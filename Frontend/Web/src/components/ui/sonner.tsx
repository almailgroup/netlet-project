import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toasts in NetLet's own palette, on the owner's word ("why are the alerts in
 * green colour? It should be the same colour palette as the website"): a
 * white card on a hairline rim with a soft navy-tinted shadow, the words in
 * navy, and Undo the site's navy pill — the app's toast's look too.
 *
 * **Always light, never the phone's dark mode.** This wrapper read the theme
 * from `next-themes`, which the site never sets up, so it fell back to
 * "system": on a phone in dark mode every toast was sonner's near-black, and
 * with `richColors` a success was dark green with green words on it. The site
 * has one look (`ThemeProvider` is light and not switchable), and so do its
 * toasts. Nothing fills a toast with green or red any more either: what kind
 * of message it is shows in its icon alone (`[data-sonner-toast][data-type]`
 * in index.css), so a toast reads as part of the shop, not a system alert.
 *
 * Sonner's stylesheet is injected outside every cascade layer, which beats
 * anything in index.css's layers on the toast itself, so the card's corners,
 * shadow and type and the pill's shape are set here, inline.
 */
const TOAST_STYLE: CSSProperties = {
  boxShadow: "0 12px 32px rgba(10, 40, 90, 0.14), 0 1px 3px rgba(10, 40, 90, 0.08)",
  fontSize: "14px",
  padding: "14px 16px",
  gap: "10px",
};

const ACTION_STYLE: CSSProperties = {
  height: "32px",
  borderRadius: "9999px",
  padding: "0 14px",
  fontSize: "13px",
  fontWeight: 700,
  background: "#0a285a",
  color: "#ffffff",
};

const Toaster = ({ toastOptions, style, ...props }: ToasterProps) => (
  <Sonner
    theme="light"
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--border-radius": "16px",
        ...style,
      } as CSSProperties
    }
    toastOptions={{
      ...toastOptions,
      style: { ...TOAST_STYLE, ...toastOptions?.style },
      actionButtonStyle: { ...ACTION_STYLE, ...toastOptions?.actionButtonStyle },
    }}
    {...props}
  />
);

export { Toaster };
