/**
 * People asking to open a store.
 *
 * Requirement 3.3.1's reviewing half. **Approving creates the store and makes
 * the applicant its owner — there is no second step**, because a vendor left
 * `pending` after an approval is a state somebody has to clear later, and that
 * is the arrangement where a seller is told they are open and is not.
 *
 * The page shows what the applicant wrote, what is still missing, and the
 * documents they uploaded, each to be accepted or turned down with a reason
 * before the application can be — a store approved on a file nobody opened
 * was not approved on it. Links an older application gave are still shown.
 *
 * Rejecting takes a reason and the reason is not optional: a rejection nobody
 * can act on is an application that comes back unchanged.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { Pager } from "@/components/admin/Pager";
import { QueryGate } from "@/components/admin/QueryGate";
import { buttonClass, EmptyState, fieldClass, Notice, PageHeader, Pill, SkeletonCards, smallButtonClass } from "@/components/admin/ui";
import { useDateFormat } from "@/hooks/useDateFormat";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { DEFAULT_COMMISSION_PERCENT } from "@shared/inventory/commission";
import {
  AGREEMENT_VERSION,
  missingFromApplication,
  type MissingField,
} from "@shared/inventory/sellerApplication";
import type { MessageKey } from "@shared/i18n/dictionary";
import { privatePageMeta } from "@shared/seo";
import { Check, ExternalLink, LoaderCircle, Paperclip, X } from "lucide-react";
import { KIND_LABEL, STATUS_LABEL as DOCUMENT_STATUS_LABEL, STATUS_TONE, documentHref, useFileSize } from "@/components/account/DocumentUploads";
import { DOCUMENT_KINDS, DOCUMENT_NOTE_MAX, currentByKind } from "@shared/inventory/applicationDocuments";
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
  /* The rate each store will be charged, per row: the standard one until the
     administrator changes it (3.3.2). */
  const [rates, setRates] = useState<Record<number, string>>({});

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

  /* Only a web address becomes a link. The server refuses anything else now,
     but an application saved before that may still carry one, and the person
     opening it is an administrator. */
  const webAddress = (value: string | null) => (value && /^https?:\/\/\S+$/i.test(value) ? value : null);
  const deciding = approve.isPending ? approve.variables?.id : reject.isPending ? reject.variables?.id : undefined;

  return (
    <>
      <PageHeader title={t("admin.applications")} description={t("admin.applicationsNote")} />

      {list.isLoading ? (
        <SkeletonCards count={2} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[list]}>
          {() => {
            const rows = list.data?.rows ?? [];
            if (rows.length === 0) return <EmptyState title={t("admin.applicationsEmpty")} />;
            return (
              <>
                <ul className="space-y-4">
                  {rows.map(row => {
                    const missing = missingFromApplication(row);
                    const licenceDoc = webAddress(row.licenceDocUrl);
                    const identityDoc = webAddress(row.identityDocUrl);
                    const reasonId = `reject-${row.id}`;
                    const rateId = `rate-${row.id}`;
                    return (
                      <li key={row.id} className="overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
                        <div className="p-4 sm:p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p dir="auto" className="text-[16px] font-bold text-[#0a285a]">{row.storeName}</p>
                              <p className="mt-0.5 text-[13px] ink-muted">
                                <bdi dir="ltr">{row.applicantEmail}</bdi> · {formatDate(row.createdAt)}
                              </p>
                            </div>
                            <Pill tone="warning">{t(STATUS_LABEL[row.status] ?? "admin.applicationStatusSubmitted")}</Pill>
                          </div>

                          <dl className="mt-4 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
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
                          {licenceDoc || identityDoc ? (
                            <p className="mt-4 flex flex-wrap items-center gap-2 text-[13px]">
                              <span className="font-semibold text-[#536b8c]">{t("admin.applicationDocs")}</span>
                              {licenceDoc ? (
                                <a href={licenceDoc} target="_blank" rel="noreferrer noopener" className={smallButtonClass.secondary}>
                                  {t("admin.applicationLicenceDoc")} <ExternalLink className="size-3.5" aria-hidden />
                                </a>
                              ) : null}
                              {identityDoc ? (
                                <a href={identityDoc} target="_blank" rel="noreferrer noopener" className={smallButtonClass.secondary}>
                                  {t("admin.applicationIdentityDoc")} <ExternalLink className="size-3.5" aria-hidden />
                                </a>
                              ) : null}
                            </p>
                          ) : null}

                          <DocumentReview applicationId={row.id} />

                          {row.agreementVersion ? (
                            <p className="mt-3 text-[13px] ink-muted">
                              {t("admin.applicationAgreed", { version: row.agreementVersion })}
                              {row.agreementVersion !== AGREEMENT_VERSION ? " ⚠" : ""}
                            </p>
                          ) : null}

                          {/* The rate is NetLet's decision, taken here, with the
                              applicant's proposal and reason beside it — and the
                              standard rate unless somebody changes it, so approving
                              never quietly applies what was asked for. */}
                          <div className="mt-4 rounded-xl border border-[#e1e7ef] bg-[#fafbfd] p-3.5">
                            <p className="text-[13px] text-[#0a285a]">
                              {row.proposedCommissionPercent
                                ? t("admin.applicationProposed", { rate: String(Number(row.proposedCommissionPercent)), standard: String(Number(DEFAULT_COMMISSION_PERCENT)) })
                                : t("admin.applicationNoProposal", { standard: String(Number(DEFAULT_COMMISSION_PERCENT)) })}
                            </p>
                            {row.commissionNote ? <p dir="auto" className="mt-1 text-[13px] leading-5 ink-muted">“{row.commissionNote}”</p> : null}
                            <div className="mt-3 flex flex-wrap items-end gap-2">
                              <div>
                                <label htmlFor={rateId} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.applicationRate")}</label>
                                <input
                                  id={rateId}
                                  dir="ltr"
                                  inputMode="decimal"
                                  value={rates[row.id] ?? String(Number(DEFAULT_COMMISSION_PERCENT))}
                                  onChange={event => setRates({ ...rates, [row.id]: event.target.value })}
                                  className={`${fieldClass} mt-1.5 h-9 w-24`}
                                />
                              </div>
                              {row.proposedCommissionPercent ? (
                                <button
                                  type="button"
                                  onClick={() => setRates({ ...rates, [row.id]: String(Number(row.proposedCommissionPercent)) })}
                                  className={smallButtonClass.secondary}
                                >
                                  {t("admin.applicationUseProposed")}
                                </button>
                              ) : null}
                            </div>
                          </div>

                          {/* Approving is guarded by the same function the server
                              runs, so the button cannot offer what the API refuses. */}
                          {missing.length > 0 ? (
                            <Notice tone="danger" className="mt-4">
                              {t("admin.applicationMissing", { fields: missing.map(item => t(MISSING_LABEL[item])).join(", ") })}
                            </Notice>
                          ) : null}
                          {row.documentsWaiting > 0 ? (
                            <Notice tone="warning" className="mt-4">{t("admin.applicationDocsWaiting", { count: row.documentsWaiting })}</Notice>
                          ) : null}
                        </div>

                        <div className="border-t border-[#eef1f5] bg-[#fafbfd] px-4 py-4 sm:px-5">
                          <label htmlFor={reasonId} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.applicationReason")}</label>
                          <input
                            id={reasonId}
                            dir="auto"
                            value={reasons[row.id] ?? ""}
                            onChange={event => setReasons({ ...reasons, [row.id]: event.target.value })}
                            className={`${fieldClass} mt-1.5`}
                          />
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => reject.mutate({ id: row.id, reason: reasons[row.id] ?? "" })}
                              disabled={!(reasons[row.id] ?? "").trim() || deciding !== undefined}
                              className={buttonClass.quietDanger}
                            >
                              {deciding === row.id && reject.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
                              {t("admin.applicationReject")}
                            </button>
                            <button
                              type="button"
                              onClick={() => approve.mutate({ id: row.id, commissionPercent: (rates[row.id] ?? "").trim() || null })}
                              disabled={missing.length > 0 || row.documentsWaiting > 0 || deciding !== undefined}
                              className={buttonClass.primary}
                            >
                              {deciding === row.id && approve.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                              {t("admin.applicationApprove")}
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {list.data ? <Pager page={list.data} onPage={setPage} /> : null}
              </>
            );
          }}
        </QueryGate>
      )}
    </>
  );
}

/**
 * One application's uploaded documents, each kind's newest file with its
 * decision. A file waiting is accepted, or turned down with a reason the
 * applicant reads. Opening one downloads it: a civil ID never renders as a
 * page on NetLet's origin.
 */
function DocumentReview({ applicationId }: { applicationId: number }) {
  const { t, tError } = useTranslation();
  const size = useFileSize();
  const utils = trpc.useUtils();
  const documents = trpc.inventory.applications.documents.useQuery({ applicationId });
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const review = trpc.inventory.applications.reviewDocument.useMutation({
    onSuccess: status => {
      toast.success(t(status === "accepted" ? "documents.accepted" : "documents.rejected"));
      setRejecting(null);
      setNote("");
      void utils.inventory.applications.documents.invalidate({ applicationId });
      void utils.inventory.applications.list.invalidate();
    },
    onError: error => toast.error(tError(error.message)),
  });
  const current = currentByKind(documents.data ?? []);
  if (documents.isLoading) return null;
  return (
    <section className="mt-4" aria-label={t("documents.title")}>
      <p className="text-[13px] font-semibold text-[#536b8c]">{t("documents.title")}</p>
      {current.size === 0 ? (
        <p className="mt-1 text-[13px] ink-muted">{t("documents.noneUploaded")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#eef1f5] rounded-xl border border-[#e1e7ef]">
          {DOCUMENT_KINDS.filter(kind => current.has(kind)).map(kind => {
            const { latest, replacing } = current.get(kind)!;
            const noteId = `document-note-${latest.id}`;
            return (
              <li key={kind} className="p-3 text-[13px] text-[#0a285a]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-bold">{t(KIND_LABEL[kind])}</p>
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[12px] leading-none font-semibold ${STATUS_TONE[latest.status]}`}>{t(DOCUMENT_STATUS_LABEL[latest.status])}</span>
                </div>
                <a href={documentHref(latest.id)} download className="mt-1 inline-flex max-w-full items-center gap-1.5 font-semibold hover:underline">
                  <Paperclip className="size-3.5 shrink-0" aria-hidden /><bdi className="truncate">{latest.fileName}</bdi>
                </a>
                <span className="ink-muted"> · {size(latest.byteSize)}</span>
                {latest.reviewNote ? <p dir="auto" className="mt-1 ink-muted">{t("documents.reviewerNote", { note: latest.reviewNote })}</p> : null}
                {replacing ? (
                  <p className="mt-1 ink-muted">
                    {t("documents.replacingAdmin")}{" "}
                    <a href={documentHref(replacing.id)} download className="font-semibold hover:underline"><bdi>{replacing.fileName}</bdi></a>
                  </p>
                ) : null}
                {latest.status === "pending" ? (
                  rejecting === latest.id ? (
                    <div className="mt-2">
                      <label htmlFor={noteId} className="block text-[13px] font-semibold">{t("documents.rejectReason")}</label>
                      <input id={noteId} dir="auto" value={note} maxLength={DOCUMENT_NOTE_MAX} onChange={event => setNote(event.target.value)} className={`${fieldClass} mt-1.5`} />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => review.mutate({ id: latest.id, decision: "reject", note })} disabled={!note.trim() || review.isPending} className={smallButtonClass.quietDanger}>
                          {t("documents.reject")}
                        </button>
                        <button type="button" onClick={() => { setRejecting(null); setNote(""); }} className={smallButtonClass.secondary}>{t("documents.keep")}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => review.mutate({ id: latest.id, decision: "accept" })} disabled={review.isPending} aria-label={`${t("documents.accept")}: ${t(KIND_LABEL[kind])}`} className={smallButtonClass.primary}>
                        <Check className="size-4" aria-hidden />{t("documents.accept")}
                      </button>
                      <button type="button" onClick={() => { setRejecting(latest.id); setNote(""); }} disabled={review.isPending} aria-label={`${t("documents.reject")}: ${t(KIND_LABEL[kind])}`} className={smallButtonClass.quietDanger}>
                        <X className="size-4" aria-hidden />{t("documents.reject")}
                      </button>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Row({ label, value, ltr }: { label: string; value: string | null; ltr?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 font-semibold text-[#536b8c]">{label}</dt>
      {/* A value that is always Latin gets `bdi`, never `dir` on the block:
          the characters read left to right, the line belongs on its own side. */}
      <dd className="min-w-0 truncate text-[#0a285a]">
        {ltr ? <bdi dir="ltr">{value}</bdi> : <span dir="auto">{value}</span>}
      </dd>
    </div>
  );
}
