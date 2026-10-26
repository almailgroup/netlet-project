/**
 * Asking to sell on NetLet.
 *
 * Requirement 3.3.1. A store could only exist because an administrator made
 * one, so every seller arrived through a conversation and nobody could start
 * on their own. This is the form that changes that, and it is on the
 * storefront rather than in the portal, because the person filling it in has
 * no portal to reach yet.
 *
 * **Saving and submitting are two acts.** An application is a draft somebody
 * comes back to when they have found their licence number, and a queue that
 * filled up every time somebody typed would be a queue nobody reads. Saving
 * refuses only what is actively wrong; submitting is what asks for the same
 * completeness an administrator will.
 *
 * **What is missing is listed, not hidden behind a disabled button.** A button
 * that will not press and says nothing is the worst of both: the page names
 * each gap, and the button follows.
 */
import { CARD, PageBody, PageHeading } from "@/components/layout/Page";
import AuthDialog from "@/components/auth/AuthDialog";
import { useAuth } from "@/hooks/useAuth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useTranslation } from "@/hooks/useTranslation";
import { appPath } from "@/lib/basePath";
import { trpc } from "@/lib/trpc";
import {
  AGREEMENT_VERSION,
  missingFromApplication,
  type MissingField,
  MAX_COMMISSION_NOTE,
  proposalProblem,
} from "@shared/inventory/sellerApplication";
import { DEFAULT_COMMISSION_PERCENT } from "@shared/inventory/commission";
import { GOVERNORATES, ibanReadAs, isValidIban } from "@shared/inventory/storeProfile";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ArrowUpRight, CheckCircle2, Clock, LoaderCircle, Store, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Select } from "@/components/ui/Select";
import { DocumentUploads } from "@/components/account/DocumentUploads";

const MISSING_LABEL: Record<MissingField, MessageKey> = {
  contactEmail: "sell.fieldEmail",
  contactPhone: "sell.fieldPhone",
  governorate: "sell.fieldGovernorate",
  addressLine: "sell.fieldAddress",
  payoutIban: "sell.fieldIban",
  licenceNumber: "sell.fieldLicence",
  agreement: "sell.fieldAgreement",
};

const field =
  "type-body h-11 w-full rounded-xl border border-[#d5dfeb] bg-white px-3 text-[14px] text-[#0a285a] outline-none focus:border-[#f2683a]";

type Form = {
  storeName: string;
  storeNameAr: string;
  contactEmail: string;
  contactPhone: string;
  governorate: string;
  addressLine: string;
  licenceNumber: string;
  licenceDocUrl: string;
  identityDocUrl: string;
  payoutIban: string;
  underPlatformLicence: boolean;
  agreed: boolean;
  proposing: boolean;
  proposedCommissionPercent: string;
  commissionNote: string;
};

const EMPTY: Form = {
  storeName: "", storeNameAr: "", contactEmail: "", contactPhone: "", governorate: "",
  addressLine: "", licenceNumber: "", licenceDocUrl: "", identityDocUrl: "", payoutIban: "",
  underPlatformLicence: false, agreed: false,
  proposing: false, proposedCommissionPercent: "", commissionNote: "",
};

export default function Sell() {
  usePageMeta({
    title: "Sell on NetLet",
    description: "Open a store on NetLet: tell us about your business, accept the seller agreement, and we will review it.",
    type: "website",
  });
  const { t, tError } = useTranslation();
  const { isAuthenticated, loading } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);

  const mine = trpc.inventory.applications.mine.useQuery(undefined, { enabled: isAuthenticated });
  const utils = trpc.useUtils();
  const refresh = () => void utils.inventory.applications.mine.invalidate();

  /*
   * Sending saves first, because the form and the row have to agree before the
   * completeness check runs on the server. That save is silent: "Saved" and
   * "Sent" one after the other describes one press twice, and the second is
   * the one that happened.
   */
  const [sending, setSending] = useState(false);
  const save = trpc.inventory.applications.save.useMutation({
    onSuccess: () => { if (!sending) toast.success(t("sell.saved")); refresh(); },
    onError: error => toast.error(tError(error.message)),
  });
  const submit = trpc.inventory.applications.submit.useMutation({
    onSuccess: () => { toast.success(t("sell.submitted")); refresh(); },
    onError: error => toast.error(tError(error.message)),
  });

  /* Fill the form from whatever was saved, once it arrives. A draft somebody
     comes back to is the ordinary case, not the exception. */
  useEffect(() => {
    const row = mine.data;
    if (!row) return;
    setForm({
      storeName: row.storeName,
      storeNameAr: row.storeNameAr ?? "",
      contactEmail: row.contactEmail ?? "",
      contactPhone: row.contactPhone ?? "",
      governorate: row.governorate ?? "",
      addressLine: row.addressLine ?? "",
      licenceNumber: row.licenceNumber ?? "",
      licenceDocUrl: row.licenceDocUrl ?? "",
      identityDocUrl: row.identityDocUrl ?? "",
      payoutIban: row.payoutIban ?? "",
      underPlatformLicence: row.underPlatformLicence,
      agreed: row.agreementVersion === AGREEMENT_VERSION,
      proposing: row.proposedCommissionPercent !== null,
      proposedCommissionPercent: row.proposedCommissionPercent ? String(Number(row.proposedCommissionPercent)) : "",
      commissionNote: row.commissionNote ?? "",
    });
  }, [mine.data?.id, mine.data?.updatedAt]);

  const state = mine.data?.status ?? "none";
  const linkedEarlier = { licence: Boolean(mine.data?.licenceDocUrl), identity: Boolean(mine.data?.identityDocUrl) };
  const editable = state === "none" || state === "draft" || state === "rejected";

  const missing = missingFromApplication({
    ...form,
    agreementVersion: form.agreed ? AGREEMENT_VERSION : null,
  });

  const payload = {
    storeName: form.storeName.trim(),
    storeNameAr: form.storeNameAr.trim() || null,
    contactEmail: form.contactEmail.trim() || null,
    contactPhone: form.contactPhone.trim() || null,
    governorate: form.governorate || null,
    addressLine: form.addressLine.trim() || null,
    licenceNumber: form.licenceNumber.trim() || null,
    licenceDocUrl: form.licenceDocUrl.trim() || null,
    identityDocUrl: form.identityDocUrl.trim() || null,
    payoutIban: form.payoutIban.trim() || null,
    underPlatformLicence: form.underPlatformLicence,
    agreementVersion: form.agreed ? AGREEMENT_VERSION : null,
    /* Unticking the proposal withdraws it, rather than leaving a number the
       applicant can no longer see on the row an administrator reads. */
    proposedCommissionPercent: form.proposing ? form.proposedCommissionPercent.trim() || null : null,
    commissionNote: form.proposing ? form.commissionNote.trim() || null : null,
  };
  const proposalIssue = form.proposing ? proposalProblem(form.proposedCommissionPercent) : null;
  /* The server takes web addresses only (a reviewer opens these); said here,
     beside the box, rather than as a refused save. */
  const badLink = (value: string) => value.trim() !== "" && !/^https?:\/\/\S+$/i.test(value.trim());
  const linksOk = !badLink(form.licenceDocUrl) && !badLink(form.identityDocUrl);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));
  /* What the IBAN will be saved as, when that is not what was typed (`ibanReadAs`). */
  const ibanRead = isValidIban(form.payoutIban) ? ibanReadAs(form.payoutIban) : null;

  return (
    <PageBody width="reading" className="type-body">
        <PageHeading title={t("sell.title")} note={t("sell.note")} />

        {loading ? null : !isAuthenticated ? (
          /* An application belongs to an account — that is the first step the
             requirement names — so this asks for one rather than collecting a
             form it would then have nowhere to keep. */
          <div className={`${CARD} p-6`}>
            <p className="text-sm leading-6 text-[#536b8c]">{t("sell.signInFirst")}</p>
            <button
              onClick={() => setAuthOpen(true)}
              className="glass-navy type-control pressable mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3"
            >
              <Store className="size-4" aria-hidden /> {t("sell.signIn")}
            </button>
          </div>
        ) : (
          <>
            {state === "submitted" ? (
              <p className="mb-6 flex items-start gap-2 rounded-xl border border-[#d5dfeb] bg-white px-4 py-3 text-[13px] leading-6 text-[#0a285a]">
                <Clock className="mt-0.5 size-4 shrink-0 ink-accent" aria-hidden /> {t("sell.waiting")}
              </p>
            ) : null}

            {state === "approved" ? (
              <p className="mb-6 flex items-start gap-2 rounded-xl border border-[#bcd8c0] bg-[#e3efe4] px-4 py-3 text-[13px] leading-6 text-[#2f5d33]">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t("sell.approved")}{" "}
                <a href={appPath("/admin")} className="font-extrabold underline">{t("sell.openPortal")}</a>
              </p>
            ) : null}

            {/* The reason is on the row the applicant reads, because a rejection
                with no reason sends somebody back to guess. */}
            {state === "rejected" ? (
              <p className="mb-6 flex items-start gap-2 rounded-xl border border-[#f2b69e] bg-[#fdeceb] px-4 py-3 text-[13px] leading-6 text-[#8c2f22]">
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span dir="auto">{mine.data?.rejectionReason || t("sell.rejected")}</span>
              </p>
            ) : null}

            <fieldset disabled={!editable} className="space-y-6">
              <section className={`${CARD} p-5 sm:p-6`}>
                <h2 className="text-sm font-extrabold">{t("sell.aboutStore")}</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Labelled label={t("sell.fieldStoreName")}>
                    <input dir="auto" value={form.storeName} onChange={e => set("storeName", e.target.value)} className={field} />
                  </Labelled>
                  <Labelled label={t("sell.fieldStoreNameAr")}>
                    <input dir="auto" value={form.storeNameAr} onChange={e => set("storeNameAr", e.target.value)} className={field} />
                  </Labelled>
                  <Labelled label={t("sell.fieldEmail")}>
                    <input dir="ltr" type="email" value={form.contactEmail} onChange={e => set("contactEmail", e.target.value)} className={field} />
                  </Labelled>
                  <Labelled label={t("sell.fieldPhone")}>
                    <input dir="ltr" inputMode="tel" placeholder="+965" value={form.contactPhone} onChange={e => set("contactPhone", e.target.value)} className={field} />
                  </Labelled>
                  <Labelled label={t("sell.fieldGovernorate")}>
                    <Select
                      aria-label={t("sell.fieldGovernorate")}
                      value={form.governorate}
                      onChange={e => set("governorate", e.target.value)}
                      className={field}
                    >
                      <option value="">{t("sell.choose")}</option>
                      {GOVERNORATES.map(name => <option key={name} value={name}>{name}</option>)}
                    </Select>
                  </Labelled>
                  <Labelled label={t("sell.fieldAddress")}>
                    <input dir="auto" value={form.addressLine} onChange={e => set("addressLine", e.target.value)} className={field} />
                  </Labelled>
                </div>
              </section>

              <section className={`${CARD} p-5 sm:p-6`}>
                <h2 className="text-sm font-extrabold">{t("sell.papers")}</h2>

                <label className="tint-on-hover mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-[#f3f2ed] p-3">
                  <input
                    type="checkbox"
                    checked={form.underPlatformLicence}
                    onChange={e => set("underPlatformLicence", e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-[#0a285a]"
                  />
                  <span className="text-[13px] leading-5 text-[#0a285a]">{t("sell.underPlatformLicence")}</span>
                </label>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {/* Absent entirely for somebody trading under NetLet's licence:
                      they have no number of their own, and a field they cannot
                      fill is a field they will try to. */}
                  {!form.underPlatformLicence ? (
                    <Labelled label={t("sell.fieldLicence")}>
                      <input dir="ltr" value={form.licenceNumber} onChange={e => set("licenceNumber", e.target.value)} className={field} />
                    </Labelled>
                  ) : null}
                  <Labelled label={t("sell.fieldIban")}>
                    <input dir="ltr" autoComplete="off" spellCheck={false} value={form.payoutIban} aria-describedby={ibanRead ? "iban-read" : undefined} onChange={e => set("payoutIban", e.target.value)} className={field} />
                    {ibanRead ? <span id="iban-read" className="mt-1 block text-[12px] leading-5 ink-muted">{t("admin.ibanReadAs", { iban: ibanRead })}</span> : null}
                  </Labelled>
                  {/* Links were how documents arrived before uploads existed.
                      An application that carries one keeps it and can still
                      correct it; a new one is never asked for one. */}
                  {linkedEarlier.licence ? (
                    <Labelled label={t("sell.fieldLicenceDoc")}>
                      <input dir="ltr" type="url" placeholder="https://" value={form.licenceDocUrl} aria-invalid={badLink(form.licenceDocUrl) || undefined} aria-describedby={badLink(form.licenceDocUrl) ? "licence-doc-error" : undefined} onChange={e => set("licenceDocUrl", e.target.value)} className={field} />
                      {badLink(form.licenceDocUrl) ? <span id="licence-doc-error" className="mt-1 block text-[12px] font-semibold text-[#8c2f22]">{t("sell.badLink")}</span> : null}
                    </Labelled>
                  ) : null}
                  {linkedEarlier.identity ? (
                    <Labelled label={t("sell.fieldIdentityDoc")}>
                      <input dir="ltr" type="url" placeholder="https://" value={form.identityDocUrl} aria-invalid={badLink(form.identityDocUrl) || undefined} aria-describedby={badLink(form.identityDocUrl) ? "identity-doc-error" : undefined} onChange={e => set("identityDocUrl", e.target.value)} className={field} />
                      {badLink(form.identityDocUrl) ? <span id="identity-doc-error" className="mt-1 block text-[12px] font-semibold text-[#8c2f22]">{t("sell.badLink")}</span> : null}
                    </Labelled>
                  ) : null}
                </div>
              </section>

              {/* Uploaded, not linked (3.3.1): each kind its own file and its
                  own decision. Once submitted the fieldset disables the
                  buttons, and the files, being links, can still be opened. */}
              <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="sell-documents">
                <h2 id="sell-documents" className="text-sm font-extrabold">{t("documents.title")}</h2>
                <p className="mt-1 max-w-prose text-[12px] leading-5 ink-muted">{t("documents.note")}</p>
                <DocumentUploads saved={Boolean(mine.data)} editable={editable} />
              </section>

              {/* What selling here costs, before anybody applies (3.3.2). The
                  rate is stated from the same constant a new store is charged,
                  so the page cannot quote a figure the database does not. A
                  different rate can be *proposed*; commission is outside a
                  seller's control, so it is NetLet that decides, at approval. */}
              <section className={`${CARD} p-5 sm:p-6`}>
                <h2 className="text-sm font-extrabold">{t("sell.commission")}</h2>
                <p className="mt-2 max-w-prose text-[13px] leading-6 text-[#536b8c]">
                  {t("sell.commissionStandard", { rate: String(Number(DEFAULT_COMMISSION_PERCENT)) })}
                </p>
                <label className="tint-on-hover mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-[#f3f2ed] p-3">
                  <input
                    type="checkbox"
                    checked={form.proposing}
                    onChange={e => set("proposing", e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-[#0a285a]"
                  />
                  <span className="text-[13px] leading-5 text-[#0a285a]">{t("sell.commissionPropose")}</span>
                </label>
                {form.proposing ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-[160px_1fr]">
                    <Labelled label={t("sell.commissionRate")}>
                      <input
                        dir="ltr"
                        inputMode="decimal"
                        value={form.proposedCommissionPercent}
                        onChange={e => set("proposedCommissionPercent", e.target.value)}
                        aria-invalid={proposalIssue !== null}
                        aria-describedby="proposal-issue"
                        className={field}
                      />
                    </Labelled>
                    <Labelled label={t("sell.commissionWhy")}>
                      <input dir="auto" maxLength={MAX_COMMISSION_NOTE} value={form.commissionNote} onChange={e => set("commissionNote", e.target.value)} className={field} />
                    </Labelled>
                  </div>
                ) : null}
                {/* Outside the grid, so an empty live region does not cost a
                    row of gap; present whenever the fields are, so a screen
                    reader is listening before there is anything to say. */}
                {form.proposing ? (
                  <>
                    <p id="proposal-issue" aria-live="polite" className={`text-[12px] leading-5 text-[#8c2f22] ${proposalIssue ? "mt-2" : ""}`}>
                      {proposalIssue ? t(proposalIssue, { rate: String(Number(DEFAULT_COMMISSION_PERCENT)) }) : null}
                    </p>
                    <p className="mt-3 text-[12px] leading-5 ink-muted">{t("sell.commissionDecided")}</p>
                  </>
                ) : null}
              </section>

              <section className={`${CARD} p-5 sm:p-6`}>
                <h2 className="text-sm font-extrabold">{t("sell.agreement")}</h2>
                <p className="mt-2 max-w-prose text-[13px] leading-6 text-[#536b8c]">{t("sell.agreementNote")}</p>
                {/* A new tab, because this form is half filled in when
                    somebody stops to read what they are agreeing to. */}
                <a
                  href="/seller-agreement"
                  target="_blank"
                  rel="noopener"
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-[#0a285a] underline underline-offset-4"
                >
                  {t("sell.readAgreement")}
                  <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
                </a>
                <label className="mt-4 flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={form.agreed}
                    onChange={e => set("agreed", e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-[#0a285a]"
                  />
                  {/* The version is named, because "they accepted the terms"
                      means nothing without "which terms". */}
                  <span className="text-[13px] leading-5 text-[#0a285a]">
                    {t("sell.agreementAccept", { version: AGREEMENT_VERSION })}
                  </span>
                </label>
              </section>
            </fieldset>

            {editable ? (
              <div className="mt-6">
                {missing.length > 0 ? (
                  /* Named rather than hidden behind a button that will not
                     press and says nothing. */
                  <div className="rounded-xl border border-[#d5dfeb] bg-white/70 px-4 py-3">
                    <p className="text-[12px] font-semibold ink-muted">{t("sell.stillNeeded")}</p>
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {missing.map(item => (
                        <li key={item} className="text-[13px] text-[#536b8c]">· {t(MISSING_LABEL[item])}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={() => save.mutate(payload)}
                    disabled={!form.storeName.trim() || !linksOk || save.isPending}
                    className="glass type-control pressable inline-flex items-center gap-2 rounded-full border border-[#0a285a]/15 px-5 py-3 disabled:opacity-60"
                  >
                    {save.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                    {t("sell.save")}
                  </button>
                  <button
                    onClick={async () => {
                      setSending(true);
                      try {
                        await save.mutateAsync(payload);
                        await submit.mutateAsync();
                      } finally {
                        setSending(false);
                      }
                    }}
                    disabled={missing.length > 0 || !form.storeName.trim() || !linksOk || submit.isPending}
                    className="glass-navy type-control pressable inline-flex items-center gap-2 rounded-full px-5 py-3 disabled:opacity-60"
                  >
                    {submit.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                    {t("sell.submit")}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </PageBody>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="type-label ink-muted">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
