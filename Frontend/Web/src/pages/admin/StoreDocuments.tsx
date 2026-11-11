/**
 * A store's own documents, for its owner (`Shared/inventory/storeDocuments.ts`):
 * the papers NetLet keeps with the store — what the store uploaded and what
 * NetLet added — and a way to add one, such as a renewed licence.
 *
 * An owner's page and not a manager's, like the payout account the IBAN
 * letter is about (`vendor.editProfile`); the menu shows it to nobody else,
 * and the server refuses anybody else regardless.
 */
import { Link } from "wouter";
import { AdminShell } from "@/components/admin/AdminShell";
import { StoreDocuments } from "@/components/admin/StoreDocuments";
import { Notice, PageHeader, smallButtonClass } from "@/components/admin/ui";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import type { Actor } from "@shared/inventory/permissions";
import { privatePageMeta } from "@shared/seo";

export default function AdminStoreDocuments() {
  usePageMeta(privatePageMeta("Store documents"));
  return <AdminShell need={"vendor.editProfile"}>{actor => <Page actor={actor} />}</AdminShell>;
}

function Page({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  /* An administrator belongs to no store: each store's documents are a
     section of its own page, which is where this points — the Team page's rule. */
  if (actor.kind !== "vendor") {
    return (
      <>
        <PageHeader title={t("storeDocs.title")} />
        <Notice action={<Link href="/admin/vendors" className={smallButtonClass.secondary}>{t("admin.vendors")}</Link>}>
          {t("storeDocs.adminNote")}
        </Notice>
      </>
    );
  }
  return (
    <>
      <PageHeader title={t("storeDocs.title")} description={t("storeDocs.noteStore")} />
      <StoreDocuments vendorId={actor.vendorId} audience="store" />
    </>
  );
}
