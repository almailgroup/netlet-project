/**
 * What the opened order says about paying at the door (0086, on the owner's
 * word): that it was paid online, and the code the driver scans.
 *
 * **The QR is shown while a parcel is on its way** — the server sends it only
 * then (`handover`) — because it is shown to the person at the door and to
 * nobody else. It carries the vendor portal's scan page, so a driver's own
 * camera opens it signed in; the eight characters under it are the same
 * check for a camera that cannot read it. Signed by the server, never stored:
 * a driver cannot make one from the reference they see on their board.
 */
import { useEffect, useId, useState } from "react";
import { BadgeCheck, QrCode } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import type { Detail } from "@/components/account/LineReturn";
import { formatHandoverCode, type OnlineMethod } from "@shared/commerce/onlinePayment";
import type { MessageKey } from "@shared/i18n/dictionary";

export const METHOD_NAME: Record<OnlineMethod, MessageKey> = {
  knet: "checkout.payKnet",
  card: "checkout.payCard",
  apple_pay: "checkout.payApple",
};

/** "Paid online with KNET": the driver collects nothing. */
export function PaidOnlineNote({ detail }: { detail: Detail }) {
  const { t, locale } = useTranslation();
  const paid = detail.paymentChange.paidOnline;
  if (!paid) return null;
  return (
    <div role="status" className="mb-3 flex items-start gap-3 rounded-2xl border border-[#cfe6d4] bg-[#f1f8f2] px-4 py-3">
      <BadgeCheck className="mt-0.5 size-5 shrink-0 text-[#2f5d33]" aria-hidden />
      <div className="min-w-0 text-[13px] leading-5 text-[#24452a]">
        <p className="font-bold">
          {t("orders.paidOnlineWith", { method: t(METHOD_NAME[paid.method]), amount: formatMoney(paid.amount, { currencyCode: detail.order.currency, locale }) })}
        </p>
        <p>{t("orders.paidOnlineNothing")}</p>
        {paid.test ? <p className="mt-1 text-[12px] text-[#6b4a12]">{t("orders.paidOnTestPage")}</p> : null}
      </div>
    </div>
  );
}

/** The image, drawn once the card first shows, from the library fetched then. */
function useQrImage(value: string | null): string | null {
  const [image, setImage] = useState<{ for: string; url: string } | null>(null);
  useEffect(() => {
    if (!value) return;
    let live = true;
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(value, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: "#0a285a", light: "#ffffff" } }))
      .then(url => { if (live) setImage({ for: value, url }); })
      .catch(() => {});
    return () => { live = false; };
  }, [value]);
  return image && image.for === value ? image.url : null;
}

/** "Show this to your driver": the QR, the code, and what the driver will ask for. */
export function HandoverCard({ detail }: { detail: Detail }) {
  const { t, locale } = useTranslation();
  const titleId = useId();
  const handover = detail.handover;
  const image = useQrImage(handover ? handover.url ?? handover.token : null);
  if (!handover) return null;
  const paid = detail.paymentChange.paidOnline;
  const owed = formatMoney(detail.owedNow, { currencyCode: detail.order.currency, locale });
  const code = formatHandoverCode(handover.code);

  return (
    <section aria-labelledby={titleId} className="mb-3 rounded-2xl border border-[#d5dfeb] bg-white p-4">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="grid size-[180px] shrink-0 place-items-center rounded-xl border border-[#e3e8f0] bg-white p-2">
          {image ? (
            <img src={image} alt={t("orders.handoverQrAlt")} width={164} height={164} loading="eager" decoding="async" className="size-[164px]" />
          ) : (
            <QrCode className="size-10 text-[#c3cfdf]" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-start">
          <h4 id={titleId} className="text-[15px] font-extrabold text-[#0a285a]">{t("orders.handoverTitle")}</h4>
          <p className="mt-1 text-[13px] leading-5 text-[#3d5376]">
            {paid ? t("orders.handoverPaid") : t("orders.handoverCash", { amount: owed })}
          </p>
          <p className="mt-3 text-[12px] font-semibold ink-muted">{t("orders.handoverCodeLabel")}</p>
          <p className="mt-0.5 text-[24px] font-extrabold tracking-[0.12em] text-[#0a285a] tabular-nums">
            <bdi dir="ltr">{code}</bdi>
          </p>
        </div>
      </div>
    </section>
  );
}
