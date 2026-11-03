/**
 * The App Store badge in the bottom start corner of a wide screen, and the QR
 * code it opens — on the owner's word ("add an App Store icon to the bottom
 * left corner that, when you click on it, opens a QR code saying scan this QR
 * code to download the NetLet application, for iOS only — very simple and
 * basic").
 *
 * **A wide screen only** (`lg`): a QR code is for a computer's screen and a
 * phone's camera, and a phone cannot scan itself. The corner is the start
 * one — the left in English, the right in Arabic — because the assistant's
 * button holds the end one. The badge is Apple's own shape, a black pill with
 * the Apple mark and "App Store"; the mark is Simple Icons' drawing (CC0).
 *
 * The code is drawn from `APP_STORE_URL`, a template until the app is
 * published, and the `qrcode` library is fetched only when the window opens.
 * The window is the shop's other dialogs' shape: a modal (`useOverlay` —
 * Escape, focus back to the badge, the page held still), its Close focused as
 * it opens, closed by a press on the dim.
 */
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useOverlay } from "@/hooks/useOverlay";
import { useTranslation } from "@/hooks/useTranslation";
import { APP_STORE_URL } from "@/content/appDownload";

const APPLE_MARK =
  "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";

function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path fill="currentColor" d={APPLE_MARK} />
    </svg>
  );
}

export function AppDownload() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={t("appDownload.open")}
        className="fixed bottom-6 start-6 z-30 hidden items-center gap-2.5 rounded-xl bg-black py-2 pe-4 ps-3 text-white shadow-[0_10px_26px_rgba(0,0,0,.28)] transition-shadow hover:shadow-[0_14px_32px_rgba(0,0,0,.4)] lg:flex print:hidden"
      >
        <AppleMark className="size-[26px]" />
        <span className="flex flex-col items-start leading-none">
          <span className="text-[11px] font-medium">{t("appDownload.badgeTop")}</span>
          <span className="mt-0.5 text-[18px] font-semibold tracking-tight" dir="ltr">App Store</span>
        </span>
      </button>
      {open ? <AppDownloadDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function AppDownloadDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [qr, setQr] = useState<string | null>(null);

  useOverlay(true, onClose);

  /* After `useOverlay`, so the badge is what it hands focus back to. */
  useEffect(() => {
    const timer = window.setTimeout(() => closeRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let live = true;
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(APP_STORE_URL, { margin: 1, width: 440, errorCorrectionLevel: "M", color: { dark: "#0a285a", light: "#ffffff" } }),
      )
      .then(data => { if (live) setQr(data); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#061b3b]/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
        className="relative w-full max-w-[360px] rounded-3xl bg-white px-7 pb-7 pt-8 text-center shadow-[0_24px_60px_rgba(10,40,90,.28)]"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute end-3 top-3 grid size-10 place-items-center rounded-full text-[#0a285a]"
        >
          <X className="size-5" aria-hidden />
        </button>
        <h2 id={titleId} className="text-lg font-extrabold text-[#0a285a]">{t("appDownload.title")}</h2>
        <div className="mx-auto mt-5 grid size-[220px] place-items-center rounded-2xl border border-[#e3e8f0] bg-white p-3">
          {qr ? (
            <img src={qr} alt={t("appDownload.qrAlt")} width={196} height={196} loading="eager" decoding="async" className="size-full" />
          ) : (
            <span className="size-full animate-pulse rounded-xl bg-[#eef2f7]" />
          )}
        </div>
        <p className="mt-5 text-[15px] leading-6 text-[#0a285a]">{t("appDownload.scan")}</p>
        <p className="ink-muted mt-1 text-[13px] font-semibold">{t("appDownload.iosOnly")}</p>
      </div>
    </div>,
    document.body,
  );
}
