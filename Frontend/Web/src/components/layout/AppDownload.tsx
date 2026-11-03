/**
 * "Download the NetLet app" at the end of a wide screen's department row,
 * under the cart, and the card it opens — on the owner's word ("put the
 * download NetLet app text below the cart icon in the header. And when you
 * hover over it, it should show the QR code with the buttons", after a
 * picture of a shop's own card). It was a black App Store badge in the bottom
 * corner of the screen first.
 *
 * **The card**: the QR code with NetLet's mark in its middle, "Download the
 * NetLet app", "Scan the QR code to download", and the App Store button —
 * Apple's black pill with its mark (Simple Icons' drawing, CC0) — then "For
 * iOS only." There is no Google Play button: there is no Android app, and a
 * button leading nowhere is the dead-control rule.
 *
 * **It opens for a pointer resting on it, the keyboard reaching it, and a
 * press**, and stays open while the pointer is over the card, so the App Store
 * button can be reached: a short delay on leaving lets the pointer cross the
 * gap. It is the disclosure pattern — the link's `aria-expanded`, Escape
 * closing it and handing focus back, focus leaving closing it — not a modal,
 * because the page around it stays usable.
 *
 * **A wide screen only** (`lg`, where the department row is drawn): a QR code
 * is for a computer's screen and a phone's camera, and a phone cannot scan
 * itself. The code is drawn from `APP_STORE_URL`, a template until the app is
 * published, by the `qrcode` library, fetched only when the card first opens.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { APP_STORE_URL } from "@/content/appDownload";

const APPLE_MARK =
  "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";

/** How long the card waits for a pointer crossing from the link to it. */
const LEAVE_MS = 180;

function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="currentColor" d={APPLE_MARK} />
    </svg>
  );
}

/** The code, drawn once the card first opens; nothing while it is being drawn. */
function useQrCode(wanted: boolean): string | null {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || image) return;
    let live = true;
    void import("qrcode")
      .then(({ default: QRCode }) =>
        /* The highest correction, so the mark over its middle hides nothing it needs. */
        QRCode.toDataURL(APP_STORE_URL, { margin: 0, width: 320, errorCorrectionLevel: "H", color: { dark: "#0a285a", light: "#ffffff" } }),
      )
      .then(url => { if (live) setImage(url); })
      .catch(() => {});
    return () => { live = false; };
  }, [wanted, image]);
  return image;
}

export function AppDownloadLink({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const cardId = useId();
  const titleId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const leaving = useRef<number | null>(null);
  const qr = useQrCode(asked);

  const show = () => {
    if (leaving.current) window.clearTimeout(leaving.current);
    leaving.current = null;
    setAsked(true);
    setOpen(true);
  };
  const hideSoon = () => {
    if (leaving.current) window.clearTimeout(leaving.current);
    leaving.current = window.setTimeout(() => setOpen(false), LEAVE_MS);
  };
  useEffect(() => () => { if (leaving.current) window.clearTimeout(leaving.current); }, []);

  /* Escape closes it and hands focus back; a press elsewhere closes it. */
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  return (
    <div
      ref={wrap}
      className={`relative ${className}`}
      onPointerEnter={event => { if (event.pointerType === "mouse") show(); }}
      onPointerLeave={event => { if (event.pointerType === "mouse") hideSoon(); }}
      onFocus={show}
      onBlur={event => { if (!wrap.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={cardId}
        /* Opens; a pointer that is already resting on it has opened it, so a
           press never closes it under the pointer. Escape, leaving and a
           press elsewhere close it. */
        onClick={show}
        className="pressable flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-[#0a285a] transition-colors hover:bg-[#0a285a]/[.06]"
      >
        <Smartphone className="size-3.5 shrink-0" aria-hidden />
        {t("appDownload.title")}
      </button>
      <div
        id={cardId}
        role="region"
        aria-labelledby={titleId}
        hidden={!open}
        className="app-card absolute end-0 top-full z-50 mt-2 w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-[#e6e9ef] bg-white p-5 text-start shadow-[0_22px_48px_-12px_rgba(10,40,90,.28)]"
      >
        <span aria-hidden className="absolute -top-1.5 end-10 size-3 rotate-45 border-s border-t border-[#e6e9ef] bg-white" />
        <div className="flex items-center gap-5">
          <div className="relative size-[132px] shrink-0 rounded-xl border border-[#eef1f5] bg-white p-2">
            {qr ? (
              <img src={qr} alt={t("appDownload.qrAlt")} width={116} height={116} loading="eager" decoding="async" className="size-full" />
            ) : (
              <span aria-hidden className="block size-full animate-pulse rounded-lg bg-[#eef1f5]" />
            )}
            {qr ? (
              <img
                src={appPath("/brand/icon-192.png")}
                alt=""
                aria-hidden
                loading="eager"
                decoding="async"
                className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-white bg-white"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p id={titleId} className="text-[18px] font-extrabold leading-6 text-[#0a285a]">{t("appDownload.title")}</p>
            <p className="mt-1 text-[14px] leading-5 text-[#536b8c]">{t("appDownload.scan")}</p>
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={t("appDownload.open")}
              className="mt-4 inline-flex h-12 items-center gap-2 rounded-full bg-black pe-5 ps-4 text-white"
            >
              <AppleMark className="size-[22px]" />
              <span className="text-[16px] font-bold tracking-tight" dir="ltr">App Store</span>
            </a>
            <p className="mt-2 text-[12px] font-semibold text-[#536b8c]">{t("appDownload.iosOnly")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
