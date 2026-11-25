/**
 * The ways a store lets its shoppers pay, for its owner and managers
 * (`Shared/commerce/storePayments.ts`), on the owner's word: cash on delivery
 * with its limit, KNET, a card and Apple Pay, any of them and one at least.
 *
 * A store's page and not NetLet's: NetLet keeps each store's on that store's
 * own page under Vendors, which is where this points an administrator.
 */
import { Link } from "wouter";
import { AdminShell } from "@/components/admin/AdminShell";
import { StorePayments } from "@/components/admin/StorePayments";
import { Notice, PageHeader, smallButtonClass } from "@/components/admin/ui";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import type { Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";

export default function AdminPaymentMethods() {
  usePageMeta(privatePageMeta("Ways to pay"));
  return <AdminShell need={"vendor.payments"}>{actor => <Page actor={actor} />}</AdminShell>;
}

function Page({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  if (actor.kind !== "vendor") {
    return (
      <>
        <PageHeader title={t("storePay.title")} />
        <Notice action={<Link href="/admin/vendors" className={smallButtonClass.secondary}>{t("admin.vendors")}</Link>}>
          {t("storePay.adminElsewhere")}
        </Notice>
      </>
    );
  }
  return (
    <>
      <PageHeader title={t("storePay.title")} />
      <StorePayments vendorId={actor.vendorId} id="ways" />
    </>
  );
}
