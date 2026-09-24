/**
 * People asking to open a store.
 *
 * Requirement 3.3.1's reviewing half. **Approving creates the store and makes
 * the applicant its owner — there is no second step**, because a vendor left
 * `pending` after an approval is a state somebody has to clear later, and that
 * is the arrangement where a seller is told they are open and is not.
 *
 * The page shows what the applicant wrote, what is still missing, and their
 * documents as links — NetLet has no upload pipeline, so a link is what they
 * could give.
 *
 * Rejecting takes a reason and the reason is not optional: a rejection nobody
 * can act on is an application that comes back unchanged.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import {
  AGREEMENT_VERSION,
  missingFromApplication,
  type MissingField,
} from "@shared/inventory/sellerApplication";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import { Check, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const MISSING_LABEL: Record<MissingField, MessageKey> = {
  contactEmail: "sell.fieldEmail",
  contactPhone: "sell.fieldPhone",
  governorate: "sell.fieldGovernorate",
  addressLine: "sell.fieldAddress",
  payoutIban: "sell.fieldIban",
  licenceNumber: "sell.fieldLicence",
  agreement: "sell.fieldAgreement",
};

const STATUS_LABEL: Record<string, MessageKey> = {
  draft: "admin.applicationStatusDraft",
  submitted: "admin.applicationStatusSubmitted",
  approved: "admin.applicationStatusApproved",
  rejected: "admin.applicationStatusRejected",
};

export default function AdminApplications() {
  usePageMeta(privatePageMeta("Seller applications"));
  return <AdminShell need="platform.manageUsers">{() => <Applications />}</AdminShell>;
}

function Applications() {
  const { t, tError } = useTranslation();
  const formatDate = useDateFormat();
  const [page, setPage] = useState(1);
  const [reasons, setReasons] = useState<Record<number, string>>({});

  /* The queue asks the server for what is waiting rather than filtering a page
     of everything: with paging the second reports an empty queue the moment it
     grows past one page — the mistake the product review queue already fixed. */
  const list = trpc.inventory.applications.list.useQuery(
    { status: "submitted", page },
    { placeholderData: previous => previous },
  );
  const utils = trpc.useUtils();
  const refresh = () => {
    void utils.inventory.applications.list.invalidate();
    void utils.inventory.applications.waiting.invalidate();
    void utils.inventory.vendors.list.invalidate();
  };

  const approve = trpc.inventory.applications.approve.useMutation({
    onSuccess: () => { toast.success(t("admin.applicationApproved")); refresh(); },
    onError: error => toast.error(tError(error.message)),
  });
  const reject = trpc.inventory.applications.reject.useMutation({
    onSuccess: () => { toast.success(t("admin.applicationRejected")); refresh(); },
    onError: error => toast.error(tError(error.message)),
  });

  return (
    <>
      <h1 className="text-xl font-extrabold">{t("admin.applications")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.applicationsNote")}</p>

      <QueryGate queries={[list]}>
        {() => {
          const rows = list.data?.rows ?? [];
          if (rows.length === 0) {
            return (
              <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
                <p className="text-sm font-extrabold">{t("admin.applicationsEmpty")}</p>
              </div>
            );
          }
          return (
            <div className="mt-5 space-y-3">
              {rows.map(row => {
                const missing = missingFromApplication(row);
                return (
                  <article key={row.id} className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p dir="auto" className="font-bold text-[#0a285a]">{row.storeName}</p>
                        <p className="mt-0.5 text-[11px] ink-muted">
                          <bdi dir="ltr">{row.applicantEmail}</bdi> · {formatDate(row.createdAt)}
                        </p>
                      </div>
                      <span className="rounded-full bg-[#e7edf5] px-3 py-1 text-[11px] font-extrabold text-[#0a285a]">
                        {t(STATUS_LABEL[row.status] ?? "admin.applicationStatusSubmitted")}
                      </span>
                    </div>

                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                      <Row label={t("sell.fieldEmail")} value={row.contactEmail} ltr />
                      <Row label={t("sell.fieldPhone")} value={row.contactPhone} ltr />
                      <Row label={t("sell.fieldGovernorate")} value={row.governorate} />
                      <Row label={t("sell.fieldAddress")} value={row.addressLine} />
                      <Row
                        label={t("sell.fieldLicence")}
                        value={row.underPlatformLicence ? t("admin.underPlatformLicence") : row.licenceNumber}
                        ltr={!row.underPlatformLicence}
                      />
                      <Row label={t("sell.fieldIban")} value={row.payoutIban} ltr />
                    </dl>

                    {/* Links, because that is what an applicant could give. They
                        open in a new tab: losing the queue to read a PDF means
                        finding your place in it again. */}
                    {row.licenceDocUrl || row.identityDocUrl ? (
                      <p className="mt-3 flex flex-wrap items-center gap-3 text-[12px]">
                        <span className="font-extrabold ink-muted">{t("admin.applicationDocs")}</span>
                        {row.licenceDocUrl ? (
                          <a href={row.licenceDocUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-bold text-[#a44a2b] hover:underline">
                            {t("admin.applicationLicenceDoc")} <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : null}
                        {row.identityDocUrl ? (
                          <a href={row.identityDocUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-bold text-[#a44a2b] hover:underline">
                            {t("admin.applicationIdentityDoc")} <ExternalLink className="size-3" aria-hidden />
                          </a>
                        ) : null}
                      </p>
                    ) : null}

                    {row.agreementVersion ? (
                      <p className="mt-2 text-[12px] ink-muted">
                        {t("admin.applicationAgreed", { version: row.agreementVersion })}
                        {row.agreementVersion !== AGREEMENT_VERSION ? " ⚠" : ""}
                      </p>
                    ) : null}

                    {/* Approving is guarded by the same function the server
                        runs, so the button cannot offer what the API refuses. */}
                    {missing.length > 0 ? (
                      <p className="mt-3 rounded-xl border border-[#f2b69e] bg-[#fdeceb] px-3 py-2 text-[12px] text-[#8c2f22]">
                        {t("admin.applicationMissing", { fields: missing.map(item => t(MISSING_LABEL[item])).join(", ") })}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => approve.mutate({ id: row.id })}
                        disabled={missing.length > 0 || approve.isPending}
                        className="glass glass-navy pressable inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[11px] font-extrabold disabled:opacity-60"
                      >
                        {approve.isPending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
                        {t("admin.applicationApprove")}
                      </button>
                      <button
                        onClick={() => reject.mutate({ id: row.id, reason: reasons[row.id] ?? "" })}
                        disabled={!(reasons[row.id] ?? "").trim() || reject.isPending}
                        className="glass pressable inline-flex items-center gap-1.5 rounded-full border border-[#0a285a]/15 px-4 py-2 text-[11px] font-extrabold disabled:opacity-60"
                      >
                        <X className="size-3.5" aria-hidden /> {t("admin.applicationReject")}
                      </button>
                    </div>

                    <input
                      dir="auto"
                      value={reasons[row.id] ?? ""}
                      onChange={event => setReasons({ ...reasons, [row.id]: event.target.value })}
                      aria-label={t("admin.applicationReason")}
                      placeholder={t("admin.applicationReason")}
                      className="type-body mt-3 h-10 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[13px] outline-none focus:border-[#f2683a]"
                    />
                  </article>
                );
              })}
              {list.data ? <Pager page={list.data} onPage={setPage} /> : null}
            </div>
          );
        }}
      </QueryGate>
    </>
  );
}

function Row({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 font-extrabold ink-muted">{label}</dt>
      {/* A value that is always Latin gets `bdi`, never `dir` on the block:
          the characters read left to right, the line belongs on its own side. */}
      <dd className="min-w-0 truncate text-[#0a285a]">
        {ltr ? <bdi dir="ltr">{value}</bdi> : <span dir="auto">{value}</span>}
      </dd>
    </div>
  );
}
