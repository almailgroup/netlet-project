/**
 * The App Store badge at the end of a wide screen's department row, under the
 * cart, and the card it opens — on the owner's word ("put the download NetLet
 * app text below the cart icon in the header. And when you hover over it, it
 * should show the QR code with the buttons", after a picture of a shop's own
 * card). **The trigger is Apple's "Download on the App Store" badge in
 * NetLet's navy, on the owner's word** ("put this instead of the download
 * NetLet app text, and make its color the NetLet blue"): their file,
 * `assets/app-store-badge.svg`, its black and grey rim made `#0a285a` and its
 * grey shine taken off. It was a black badge in the screen's bottom corner
 * first, then the words "Download the NetLet app".
 *
 * **The card**: the QR code with NetLet's mark in its middle, "Download the
 * NetLet app", "Scan the QR code to download", and the same navy badge as the
 * App Store button — one button, one colour — then "For iOS only." There is no Google Play button: there is no Android app, and a
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
import badgeUrl from "@/assets/app-store-badge.svg";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { APP_STORE_URL } from "@/content/appDownload";

/** How long the card waits for a pointer crossing from the link to it. */
const LEAVE_MS = 180;

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
        className="flex shrink-0 items-center rounded-[9px] p-0"
      >
        {/* Apple's own words, drawn in English on either page: its name
            carries them, so somebody steering by voice can say what they see. */}
        <img src={badgeUrl} alt={t("appDownload.badge")} width={122} height={36} loading="eager" decoding="async" className="h-9 w-auto" />
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
              className="mt-4 inline-flex rounded-[11px]"
            >
              {/* The header's own badge, larger: one App Store button, one colour. */}
              <img src={badgeUrl} alt={t("appDownload.badge")} width={149} height={44} loading="eager" decoding="async" className="h-11 w-auto" />
            </a>
            <p className="mt-2 text-[12px] font-semibold text-[#536b8c]">{t("appDownload.iosOnly")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
