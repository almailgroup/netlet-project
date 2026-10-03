/**
 * Is this NetLet document genuine? (3.6.6)
 *
 * Where the QR on a printed invoice leads. Public, because whoever holds the
 * paper — an accountant, a ministry, the relative a gift went to — is rarely
 * the shopper, and asking them to sign in would make the check useless. It
 * shows only what the paper already shows beside the code: the number, the
 * date, the total, who issued it and who sold. Never the buyer or the address.
 *
 * A wrong code and a number that was never issued read the same, so the page
 * cannot be used to ask which numbers exist.
 */
import { useRoute, useSearch } from "wouter";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { StoreHeader } from "@/components/layout/StoreHeader";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { gregorianDate, hijriDate } from "@shared/commerce/invoice";
import { privatePageMeta } from "@shared/seo";

const NUMBER = /^(INV|CRN)-\d{4}-\d{6,9}$/;

export default function InvoiceVerify() {
  const { t, locale } = useTranslation();
  const [, params] = useRoute("/invoices/verify/:number");
  const number = params?.number ?? "";
  const code = new URLSearchParams(useSearch()).get("code")?.trim() ?? "";
  usePageMeta(privatePageMeta(t("invoice.verifyHeading")));
  const shaped = NUMBER.test(number) && code.length > 0 && code.length <= 16;
  const check = trpc.invoices.verify.useQuery({ number, code }, { enabled: shaped, retry: false });
  const found = check.data;

  return (
    <div className="type-body min-h-dvh bg-background pb-24 lg:pb-0">
      <StoreHeader />
      <main id="main" className="container py-10">
        <div className="mx-auto max-w-xl rounded-[1.5rem] border border-[#d5dfeb] bg-white p-6 text-[#0a285a] sm:p-8">
          <h1 className="text-2xl font-extrabold">{t("invoice.verifyHeading")}</h1>
          {shaped && check.isLoading ? <p className="mt-4 text-sm ink-muted">{t("invoice.verifyChecking")}</p> : null}
          {!shaped || (!check.isLoading && !found) ? (
            <p role="status" className="mt-4 flex items-start gap-2 text-sm font-bold text-[#8c2f22]">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />{t("invoice.verifyNo")}
            </p>
          ) : null}
          {found ? (
            <div role="status" className="mt-4">
              <p className="flex items-start gap-2 text-sm font-extrabold text-[#2f5d33]">
                <BadgeCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
                {t(found.kind === "credit_note" ? "invoice.verifyYesCredit" : "invoice.verifyYes")}
              </p>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
                <dt className="ink-muted">{t("invoice.number")}</dt><dd className="font-bold"><bdi dir="ltr">{found.number}</bdi></dd>
                <dt className="ink-muted">{t("invoice.issued")}</dt><dd className="font-bold">{gregorianDate(found.issuedAt, locale)} · {hijriDate(found.issuedAt, locale)}</dd>
                <dt className="ink-muted">{t(found.kind === "credit_note" ? "invoice.creditTotal" : "invoice.total")}</dt><dd className="font-bold">{formatMoney(found.total, { currencyCode: found.currency, locale })}</dd>
                <dt className="ink-muted">{t("invoice.issuer")}</dt><dd className="font-bold"><bdi>{found.issuerName}</bdi>{found.issuerLicence ? <> · <bdi dir="ltr">{found.issuerLicence}</bdi></> : null}</dd>
                <dt className="ink-muted">{t("invoice.soldBy")}</dt><dd className="font-bold">{found.sellers.map((name, index) => <span key={index} className="block"><bdi>{name}</bdi></span>)}</dd>
              </dl>
              {found.corrected ? <p className="mt-4 text-[13px] font-bold">{t("invoice.verifyCorrected")}</p> : null}
            </div>
          ) : null}
        </div>
      </main>
      <MobileTabBar />
    </div>
  );
}
