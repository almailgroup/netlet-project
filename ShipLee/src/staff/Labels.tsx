import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Printer } from "lucide-react";
import { useLanguage } from "../i18n.js";
import { useDesk } from "./Staff.js";
import { LogoMark } from "../components/Logo.js";
import type { StaffShipment } from "../../shared/shipment.js";
import { bars, modules } from "../../shared/code128.js";
import { qrMatrix, qrPath } from "../../shared/qr.js";
import { translate } from "../../shared/i18n.js";
import type { Key, Params } from "../../shared/i18n.js";
import { governorateName } from "../../shared/kuwait.js";
import { formatDay, formatMoney } from "../../shared/format.js";

/**
 * A shipment's labels, one for each piece, sized for 100 × 150 mm label
 * paper and printed with the browser's own Print. Each carries the tracking
 * number as a Code 128 barcode for a scanner and in large digits for a
 * person, the recipient and where they are, the sender, the cash to collect,
 * the piece it is, and a QR code that opens the tracking page.
 *
 * A label is read by drivers and hubs whatever the desk's language, so its
 * captions are in English and Arabic both and the layout does not mirror;
 * what people typed keeps its own direction.
 */
export function Labels({ id }: { id: string }) {
  const { t, n } = useLanguage();
  const { call } = useDesk();
  const [shipment, setShipment] = useState<StaffShipment | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    void call<StaffShipment>("GET", `/api/staff/shipments/${encodeURIComponent(id)}`).then(answer => {
      if (!live) return;
      if (answer.ok) setShipment(answer.body);
      else if (answer.status === 404) setMissing(true);
    });
    return () => {
      live = false;
    };
  }, [call, id]);

  if (missing) return <p className="notice notice-stopped">{t("error.gone")}</p>;
  if (!shipment) return <div className="card" aria-busy="true"><div className="skeleton" data-size="bar" /></div>;

  return (
    <>
      <div className="label-tools">
        <Link href={`/staff/shipments/${shipment.id}`} className="back-link"><ArrowLeft size={16} aria-hidden="true" className="flip" />{t("label.back")}</Link>
        <div className="staff-bar">
          <div>
            <h1>{t("label.title")}</h1>
            <p className="list-count">{t("label.lead")}</p>
          </div>
          <button type="button" className="button button-primary" onClick={() => window.print()}>
            <Printer size={18} aria-hidden="true" />
            {n("labels", shipment.pieces)}
          </button>
        </div>
      </div>
      <div className="ship-labels">
        {Array.from({ length: shipment.pieces }, (_, index) => (
          <Label key={index} shipment={shipment} piece={index + 1} />
        ))}
      </div>
    </>
  );
}

/** A caption in both languages, English first, as on any label in Kuwait. */
function Both({ k, params }: { k: Key; params?: Params }) {
  return (
    <span className="both">
      <span lang="en">{translate("en", k, params)}</span>
      <span lang="ar" dir="rtl">{translate("ar", k, params)}</span>
    </span>
  );
}

function Label({ shipment, piece }: { shipment: StaffShipment; piece: number }) {
  const { t } = useLanguage();
  const number = shipment.trackingNumber;
  /* "SL 4820 6193 79", the way a person reads a number down a phone. */
  const spaced = `${number.slice(0, 2)} ${number.slice(2, 6)} ${number.slice(6, 10)} ${number.slice(10)}`;
  return (
    <article className="ship-label" dir="ltr" aria-label={`${t("label.title")}, ${translate("en", "label.piece", { n: piece, total: shipment.pieces })}`}>
      <header className="label-top">
        <span className="label-brand"><LogoMark size={26} />ShipLee</span>
        <span className="label-site">shiplee.delivery</span>
      </header>
      <div className="label-code">
        <Barcode value={number} />
        <p className="label-number">{spaced}</p>
      </div>
      <section className="label-block label-to">
        <h2><Both k="label.to" /></h2>
        {shipment.recipientName ? <p className="label-name" dir="auto">{shipment.recipientName}</p> : null}
        {shipment.recipientPhone ? <p className="label-phone">+965 {shipment.recipientPhone.slice(0, 4)} {shipment.recipientPhone.slice(4)}</p> : null}
        <p className="label-place">
          {shipment.area ? <bdi dir="auto">{shipment.area}</bdi> : null}
          {shipment.area && shipment.governorate ? ", " : null}
          {shipment.governorate ? <>{governorateName(shipment.governorate, "en")} <span lang="ar">{governorateName(shipment.governorate, "ar")}</span></> : null}
        </p>
        {shipment.address ? <p className="label-address" dir="auto">{shipment.address}</p> : null}
      </section>
      <section className="label-block label-from">
        <h2><Both k="label.from" /></h2>
        <p dir="auto">{shipment.senderName}</p>
      </section>
      <footer className="label-foot">
        <div className="label-facts">
          <div className={`label-cod${shipment.codFils ? " collect" : ""}`}>
            {shipment.codFils ? (
              <>
                <Both k="label.collect" />
                <strong>{formatMoney(shipment.codFils, "en")}</strong>
              </>
            ) : (
              <Both k="label.noCash" />
            )}
          </div>
          <p className="label-piece"><Both k="label.piece" params={{ n: piece, total: shipment.pieces }} /></p>
          {shipment.expectedOn ? (
            <p className="label-expected"><Both k="label.expected" /> {formatDay(shipment.expectedOn, "en")}</p>
          ) : null}
        </div>
        <div className="label-qr">
          <QrCode text={`${window.location.origin}/track/${number}`} />
          <Both k="label.scan" />
        </div>
      </footer>
    </article>
  );
}

function Barcode({ value }: { value: string }) {
  const { t } = useLanguage();
  const quiet = 10;
  const width = modules(value).length + quiet * 2;
  return (
    <svg className="barcode" viewBox={`0 0 ${width} 50`} preserveAspectRatio="none" shapeRendering="crispEdges" role="img" aria-label={t("label.barcodeName", { number: value })}>
      {bars(value).map(bar => <rect key={bar.x} x={bar.x + quiet} y={0} width={bar.width} height={50} fill="currentColor" />)}
    </svg>
  );
}

function QrCode({ text }: { text: string }) {
  const { t } = useLanguage();
  const matrix = useMemo(() => qrMatrix(text), [text]);
  const size = matrix.length + 8;
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={t("label.qrName")}>
      <rect className="paper" width={size} height={size} />
      <path d={qrPath(matrix, 4)} fill="currentColor" />
    </svg>
  );
}
