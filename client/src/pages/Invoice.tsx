/**
 * One invoice or credit note (3.6.6), as a page that prints.
 *
 * **Both languages on one document, whatever the site is in.** Every label is
 * drawn in Arabic and English together — the language being read leads and
 * the other sits beneath it — and the date is given in the Gregorian and the
 * Hijri calendars. An invoice is handed to an accountant, a ministry or a
 * relative as often as it is read by the shopper, and a document that changes
 * language with the reader's site setting is two documents.
 *
 * **It renders what was issued, and nothing current.** Names, registrations,
 * prices and totals all come from the frozen document; nothing here reads the
 * catalogue or the store's details today.
 *
 * Printing is the browser's own: the site's chrome is `print:hidden`, and the
 * document is laid out to fit A4 without a stylesheet of its own.
 */
import { Link, useRoute } from "wouter";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { appPath } from "@/lib/basePath";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { StoreHeader } from "@/components/layout/StoreHeader";
import { QueryGate } from "@/components/admin/QueryGate";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { gregorianDate, hijriDate, type InvoiceDocument, type InvoiceSeller } from "@shared/commerce/invoice";
import { isMessageKey, translate, type MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";

/**
 * A label in the reader's language, with the other beneath it.
 *
 * The second line takes its own direction for its letters but its parent's
 * alignment (`match-parent`), so the Arabic under an English label sits under
 * it rather than at the far edge of the column — and the same in reverse.
 */
function Both({ k, values, className = "" }: { k: MessageKey; values?: Record<string, string>; className?: string }) {
  const { locale } = useTranslation();
  const other = locale === "ar" ? "en" : "ar";
  return (
    <span className={className}>
      <span className="block">{translate(locale, k, values)}</span>
      <span lang={other} dir={other === "ar" ? "rtl" : "ltr"} className="block text-[10px] font-semibold text-[#536b8c] align-parent">{translate(other, k, values)}</span>
    </span>
  );
}

export default function Invoice() {
  const { t } = useTranslation();
  const [, params] = useRoute("/invoices/:number");
  const number = params?.number ?? "";
  const { isAuthenticated, loading } = useAuth();
  usePageMeta(privatePageMeta(number || t("invoice.title")));

  return (
    <div className="type-body min-h-dvh bg-background pb-24 print:bg-white print:pb-0 lg:pb-0">
      <div className="print:hidden"><StoreHeader /></div>
      <main id="main" className="container py-8 sm:py-12 print:p-0">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
            <Link href="/account/orders" className="glass type-control pressable inline-flex items-center gap-2 rounded-full px-4 py-2">
              <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />{t("invoice.back")}
            </Link>
            {isAuthenticated ? (
              <button type="button" onClick={() => window.print()} className="glass-navy type-control pressable inline-flex items-center gap-2 rounded-full px-4 py-2">
                <Printer className="size-4" aria-hidden />{t("invoice.print")}
              </button>
            ) : null}
          </div>
          {loading ? null : !isAuthenticated ? (
            <p className="rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm ink-muted">{t("invoice.signIn")}</p>
          ) : (
            <Loaded number={number} />
          )}
        </div>
      </main>
      <div className="print:hidden"><MobileTabBar /></div>
    </div>
  );
}

function Loaded({ number }: { number: string }) {
  const { t } = useTranslation();
  const query = trpc.invoices.get.useQuery({ number }, { retry: false, enabled: number.length > 0 });
  /* Not yours, or no such number: one plain answer, and no "try again" —
     asking again will not make it exist. */
  if (query.error?.data?.code === "NOT_FOUND" || query.error?.data?.code === "BAD_REQUEST") {
    return <p className="rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm ink-muted">{t("invoice.notFound")}</p>;
  }
  return (
    <QueryGate queries={[query]}>
      {() => (query.data ? <Document document={query.data.document} credits={query.data.credits} verifyCode={query.data.verifyCode} /> : null)}
    </QueryGate>
  );
}

function Document({ document: doc, credits, verifyCode }: { document: InvoiceDocument; credits: { number: string; total: string; issuedAt: Date | string }[]; verifyCode: string }) {
  const { t, locale } = useTranslation();
  const money = (amount: string) => formatMoney(amount, { currencyCode: doc.currency, locale });
  const isCredit = doc.kind === "credit_note";

  return (
    <article className="rounded-[1.5rem] border border-[#d5dfeb] bg-white p-5 text-[#0a285a] sm:p-8 print:rounded-none print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 border-b border-[#e6e9ef] pb-5">
        <div>
          <h1 className="text-2xl font-extrabold"><Both k={isCredit ? "invoice.creditNote" : "invoice.title"} /></h1>
          <p className="mt-2 text-sm font-extrabold"><bdi dir="ltr">{doc.number}</bdi></p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-2 text-[12px]">
          <dt><Both k="invoice.issued" /></dt>
          <dd className="font-bold">
            <span className="block">{gregorianDate(doc.issuedAt, locale)}</span>
            <span className="block">{hijriDate(doc.issuedAt, locale)}</span>
          </dd>
          <dt><Both k="invoice.order" /></dt>
          <dd className="font-bold"><bdi dir="ltr">{doc.orderReference}</bdi></dd>
          {doc.credits ? (
            <>
              <dt><Both k="invoice.corrects" /></dt>
              <dd className="font-bold">
                <Link href={`/invoices/${doc.credits.invoiceNumber}`} className="underline"><bdi dir="ltr">{doc.credits.invoiceNumber}</bdi></Link>
                {isMessageKey(doc.credits.reason) ? <span className="block font-semibold text-[#536b8c]">{t(doc.credits.reason)}</span> : null}
              </dd>
            </>
          ) : null}
        </dl>
      </header>

      <section className="grid gap-5 border-b border-[#e6e9ef] py-5 sm:grid-cols-2" aria-label={t("invoice.parties")}>
        <div>
          <h2 className="text-[11px] font-extrabold uppercase tracking-wide"><Both k="invoice.issuer" /></h2>
          <p className="mt-2 text-sm font-extrabold">{doc.issuer.name}</p>
          {doc.issuer.nameAr ? <p lang="ar" dir="rtl" className="text-sm font-extrabold align-parent">{doc.issuer.nameAr}</p> : null}
          <Registration licence={doc.issuer.licence} underPlatformLicence={false} />
          {doc.issuer.address ? <p className="mt-1 text-[12px] text-[#536b8c]"><bdi>{doc.issuer.address}</bdi></p> : null}
        </div>
        <div>
          <h2 className="text-[11px] font-extrabold uppercase tracking-wide"><Both k="invoice.buyer" /></h2>
          {doc.buyer.name ? <p className="mt-2 text-sm font-extrabold"><bdi>{doc.buyer.name}</bdi></p> : null}
          {doc.buyer.phone ? <p className="text-[12px]"><bdi dir="ltr">{doc.buyer.phone}</bdi></p> : null}
          <p className="text-[12px]"><bdi dir="ltr">{doc.buyer.email}</bdi></p>
          {doc.buyer.address ? <p className="mt-1 text-[12px] text-[#536b8c]"><bdi>{doc.buyer.address}</bdi></p> : null}
        </div>
      </section>

      {doc.sellers.map((seller, index) => <SellerBlock key={`${seller.vendorId ?? "x"}-${index}`} seller={seller} money={money} />)}

      <section className="ms-auto mt-5 max-w-sm" aria-label={t("invoice.totals")}>
        <dl className="space-y-2 text-[13px]">
          <Row k="invoice.goods" value={money(doc.goods)} />
          {Number(doc.delivery) > 0 ? <Row k="invoice.delivery" value={money(doc.delivery)} /> : null}
          {Number(doc.discount) > 0 ? <Row k="invoice.discount" value={`−${money(doc.discount)}`} /> : null}
          <div className="flex items-start justify-between gap-4 border-t border-[#0a285a] pt-2 text-base font-extrabold">
            <dt><Both k={isCredit ? "invoice.creditTotal" : "invoice.total"} /></dt>
            <dd>{money(doc.total)}</dd>
          </div>
          {!isCredit ? (
            <>
              {Number(doc.paidWith.points) > 0 ? <Row k="invoice.paidPoints" value={money(doc.paidWith.points)} /> : null}
              {Number(doc.paidWith.giftCard) > 0 ? <Row k="invoice.paidGiftCard" value={money(doc.paidWith.giftCard)} /> : null}
              <Row k={doc.paymentMethod === "cod" ? "invoice.paidCash" : "invoice.paidOther"} value={money(doc.paidWith.cash)} />
            </>
          ) : null}
        </dl>
      </section>

      {credits.length > 0 ? (
        <section className="mt-6 rounded-xl bg-[#fbf3ef] p-4 text-[12px]" aria-label={t("invoice.creditNotes")}>
          <p className="font-extrabold"><Both k="invoice.correctedBy" /></p>
          <ul className="mt-2 space-y-1">
            {credits.map(credit => (
              <li key={credit.number} className="flex flex-wrap justify-between gap-2">
                <Link href={`/invoices/${credit.number}`} className="font-bold underline"><bdi dir="ltr">{credit.number}</bdi></Link>
                <span>{gregorianDate(credit.issuedAt, locale)} · −{money(credit.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Verification number={doc.number} code={verifyCode} document={doc} />

      <footer className="mt-6 border-t border-[#e6e9ef] pt-4 text-[11px] text-[#536b8c]">
        <Both k="invoice.footer" />
      </footer>
    </article>
  );
}

function Registration({ licence, underPlatformLicence }: { licence: string | null; underPlatformLicence: boolean }) {
  if (underPlatformLicence) return <p className="mt-1 text-[12px]"><Both k="invoice.underPlatformLicence" /></p>;
  return licence
    ? <p className="mt-1 text-[12px]"><Both k="invoice.registration" />{" "}<bdi dir="ltr" className="font-bold">{licence}</bdi></p>
    : <p className="mt-1 text-[12px] text-[#8c2f22]"><Both k="invoice.registrationMissing" /></p>;
}

function Row({ k, value }: { k: MessageKey; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt><Both k={k} /></dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}

function SellerBlock({ seller, money }: { seller: InvoiceSeller; money: (amount: string) => string }) {
  const { t } = useTranslation();
  return (
    <section className="border-b border-[#e6e9ef] py-5">
      <p className="text-[11px] font-extrabold uppercase tracking-wide"><Both k="invoice.soldBy" /></p>
      <h2 className="mt-1 text-sm font-extrabold">
        <bdi className="block">{seller.name}</bdi>
        {seller.nameAr ? <span lang="ar" dir="rtl" className="block align-parent">{seller.nameAr}</span> : null}
      </h2>
      <Registration licence={seller.licence} underPlatformLicence={seller.underPlatformLicence} />
      {/* Scrolls inside itself on a phone, as the finance tables do, with a
          name and a tab stop so a keyboard can reach the last column. */}
      <div role="region" tabIndex={0} aria-label={t("invoice.itemsOf", { name: seller.name })} className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-[12px]">
          <thead>
            <tr className="border-b border-[#e6e9ef] text-start">
              <th scope="col" className="py-2 text-start font-extrabold"><Both k="invoice.item" /></th>
              <th scope="col" className="py-2 text-end font-extrabold"><Both k="invoice.quantity" /></th>
              <th scope="col" className="py-2 text-end font-extrabold"><Both k="invoice.unitPrice" /></th>
              <th scope="col" className="py-2 text-end font-extrabold"><Both k="invoice.lineTotal" /></th>
            </tr>
          </thead>
          <tbody>
            {seller.lines.map((line, index) => (
              <tr key={index} className="border-b border-[#f0f2f6] align-top">
                <td className="py-2">
                  <bdi className="block font-bold">{line.title}</bdi>
                  {line.titleAr ? <span lang="ar" dir="rtl" className="block align-parent">{line.titleAr}</span> : null}
                  {line.variantTitle && line.variantTitle !== "Default" ? <bdi className="block text-[#536b8c]">{line.variantTitle}</bdi> : null}
                  {line.sku ? <span className="block text-[11px] text-[#536b8c]"><bdi dir="ltr">{line.sku}</bdi></span> : null}
                </td>
                <td className="py-2 text-end">{line.quantity}</td>
                <td className="py-2 text-end">{money(line.unitPrice)}</td>
                <td className="py-2 text-end font-bold">{money(line.lineTotal)}</td>
              </tr>
            ))}
            {Number(seller.delivery) > 0 ? (
              <tr>
                <td className="py-2" colSpan={3}><Both k="invoice.deliveryBy" values={{ name: seller.name }} /></td>
                <td className="py-2 text-end font-bold">{money(seller.delivery)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * How anybody holding the paper confirms it (3.6.6): a QR to the public check,
 * and the same link and code in words for somebody without a phone camera.
 * And the document as data, for an accountant's software rather than a person.
 */
function Verification({ number, code, document: doc }: { number: string; code: string; document: InvoiceDocument }) {
  const { t } = useTranslation();
  const url = `${window.location.origin}${appPath(`/invoices/verify/${number}`)}?code=${code}`;
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 160, errorCorrectionLevel: "M" }).then(data => { if (live) setQr(data); }).catch(() => setQr(null));
    return () => { live = false; };
  }, [url]);

  const download = () => {
    const blob = new Blob([JSON.stringify({ ...doc, verification: { code, url } }, null, 2)], { type: "application/json" });
    const link = window.document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${number}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <section className="mt-6 flex flex-wrap items-center gap-4 rounded-xl border border-[#e6e9ef] p-4" aria-label={t("invoice.verifyHeading")}>
      {qr ? <img src={qr} alt={t("invoice.verifyQrAlt")} loading="eager" decoding="async" className="size-28 shrink-0" /> : null}
      <div className="min-w-0 flex-1 text-[12px] leading-5">
        <p className="font-extrabold"><Both k="invoice.verifyHeading" /></p>
        <p className="mt-1 text-[#536b8c]">{t("invoice.verifyHow")}</p>
        <p className="mt-1 break-all"><bdi dir="ltr" className="font-mono">{url}</bdi></p>
        <p className="mt-1">{t("invoice.verifyCode")} <bdi dir="ltr" className="font-mono font-bold tracking-wider">{code}</bdi></p>
        <button type="button" onClick={download} className="glass type-control pressable mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5 print:hidden">
          <Download className="size-3.5" aria-hidden />{t("invoice.downloadData")}
        </button>
      </div>
    </section>
  );
}
