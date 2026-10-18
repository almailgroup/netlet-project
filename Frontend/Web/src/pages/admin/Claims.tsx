/**
 * Damage claims (3.4.2): one page for the three parties to one.
 *
 * The seller who files, the delivery company that answers and NetLet that
 * decides see the same claims page, and the server decides which claims each
 * sees — a company the claims against it, a seller the claims on their goods,
 * an administrator every one. Three pages would be the same list three times
 * with a different guard on each, which is the arrangement where one goes
 * missing.
 *
 * What each may *do* is drawn from `can()`, the function the server refuses
 * with: answering is the carrier's, deciding is NetLet's alone. A seller files
 * from the order desk, where the lines are, rather than from here.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { EmptyState, fieldClass, isolate, PageHeader, Pill, Segmented, SectionHeading, SkeletonRows, smallButtonClass, tableClass, textareaClass } from "@/components/admin/ui";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useMoney, useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/lib/trpc";
import { can, type Actor } from "@shared/inventory/permissions";
import { CLAIM_WINDOW_DAYS, MAX_CLAIM_RESPONSE } from "@shared/commerce/damageClaims";
import { privatePageMeta } from "@shared/seo";
import type { MessageKey } from "@shared/i18n/dictionary";
import { isMessageKey } from "@shared/i18n/dictionary";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { AppRouter } from "../../../../../Backend/src/routes";
import type { inferRouterOutputs } from "@trpc/server";

type Claim = inferRouterOutputs<AppRouter>["dispatch"]["claims"]["list"][number];

const TABS = [
  { id: "open", label: "admin.claimsTabOpen" },
  { id: "accepted", label: "admin.claimsTabAccepted" },
  { id: "rejected", label: "admin.claimsTabRejected" },
] as const satisfies { id: "open" | "accepted" | "rejected"; label: MessageKey }[];

const FILED_BY: Record<string, MessageKey> = {
  shopper: "admin.claimsFiledBy.shopper",
  seller: "admin.claimsFiledBy.seller",
  admin: "admin.claimsFiledBy.admin",
};

export default function AdminClaims() {
  usePageMeta(privatePageMeta("Damage claims"));
  return <AdminShell need={["delivery.view", "delivery.fileClaim"]}>{actor => <Claims actor={actor} />}</AdminShell>;
}

function useRefusal() {
  const { t } = useTranslation();
  return (message: string) => (isMessageKey(message) ? t(message, { days: String(CLAIM_WINDOW_DAYS) }) : message);
}

function Claims({ actor }: { actor: Actor }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("open");
  const claims = trpc.dispatch.claims.list.useQuery({ status: tab });
  /* The ledger is about companies, so it is drawn for the people a company's
     liability concerns: NetLet, and the company itself. */
  const seesLedger = can(actor, "delivery.view");

  return (
    <>
      <PageHeader title={t("admin.claims")} description={t("admin.claimsNote")} />

      {seesLedger ? <Ledger /> : null}

      <Segmented
        label={t("admin.claims")}
        className="mb-4 w-fit"
        value={tab}
        onChange={setTab}
        options={TABS.map(entry => ({ value: entry.id, label: t(entry.label) }))}
      />

      {claims.isLoading ? (
        <SkeletonRows rows={3} label={t("admin.loading")} />
      ) : (
        <QueryGate queries={[claims]}>
          {() => {
            const rows = claims.data ?? [];
            if (rows.length === 0) return <EmptyState title={t("admin.claimsNone")} />;
            return <ul className="space-y-4">{rows.map(claim => <ClaimCard key={claim.id} claim={claim} actor={actor} />)}</ul>;
          }}
        </QueryGate>
      )}
    </>
  );
}

function Ledger() {
  const { t } = useTranslation();
  const money = useMoney();
  const ledger = trpc.dispatch.claims.ledger.useQuery();
  return (
    <QueryGate queries={[ledger]}>
      {() => {
        const rows = ledger.data ?? [];
        if (rows.length === 0) return null;
        return (
          <section className="mb-8">
            <SectionHeading><span id="claims-ledger">{t("admin.claimsLedger")}</span></SectionHeading>
            {/* Scrolls sideways on a phone, and a keyboard can reach it — the
                finance tables' arrangement. */}
            <div tabIndex={0} role="region" aria-labelledby="claims-ledger" className={tableClass.wrap}>
              <table className={`${tableClass.table} min-w-[480px]`}>
                <thead className={tableClass.head}>
                  <tr>
                    <th scope="col" className={tableClass.th}>{t("admin.claimsLedgerCompany")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.claimsLedgerOwed")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.claimsLedgerAccepted")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.claimsLedgerOpen")}</th>
                    <th scope="col" className={tableClass.thEnd}>{t("admin.claimsLedgerRejected")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.courierId} className={tableClass.row}>
                      <th scope="row" dir="auto" className={`${tableClass.td} text-start font-semibold text-[#0a285a]`}>{row.courierName ?? "—"}</th>
                      <td className={`${tableClass.td} text-end font-bold text-[#0a285a]`}>{money(row.owed, "KWD")}</td>
                      <td className={`${tableClass.td} text-end tabular-nums`}>{row.accepted}</td>
                      <td className={`${tableClass.td} text-end tabular-nums`}>{row.open}</td>
                      <td className={`${tableClass.td} text-end tabular-nums`}>{row.rejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      }}
    </QueryGate>
  );
}

function ClaimCard({ claim, actor }: { claim: Claim; actor: Actor }) {
  const { t } = useTranslation();
  const money = useMoney();
  const formatDate = useDateFormat();
  const open = claim.status === "open";

  return (
    <li className="overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-[#0a285a]">
              <bdi dir="ltr">{claim.reference}</bdi>
              {claim.vendorName ? <span className="ms-2 text-[13px] font-semibold text-[#536b8c]"><bdi>{claim.vendorName}</bdi></span> : null}
            </p>
            <p className="mt-0.5 text-[13px] text-[#536b8c]">
              {t(FILED_BY[claim.filedAs] ?? "admin.claimsFiledBy.shopper")}
              {claim.courierName ? <> · {t("admin.claimsAgainst", { company: isolate(claim.courierName) })}</> : null}
              {" · "}{formatDate(claim.createdAt)}
            </p>
          </div>
          <Pill tone={claim.status === "open" ? "warning" : claim.status === "accepted" ? "good" : "neutral"}>
            {t(claim.status === "open" ? "admin.claimsTabOpen" : claim.status === "accepted" ? "admin.claimsTabAccepted" : "admin.claimsTabRejected")}
          </Pill>
        </div>

        <ul className="mt-3 divide-y divide-[#f0f2f6] rounded-xl border border-[#e1e7ef] text-[14px]">
          {claim.lines.map(line => (
            <li key={line.lineId} className="flex justify-between gap-4 px-3.5 py-2">
              <span dir="auto" className="min-w-0 truncate text-[#0a285a]">{line.productTitle}</span>
              <span className="shrink-0 text-[#536b8c]">{money(line.lineTotal, "KWD")}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 flex flex-wrap gap-x-4 text-[14px] font-bold text-[#0a285a]">
          <span>{t("admin.claimsClaimed", { amount: money(claim.claimedAmount, "KWD") })}</span>
          {claim.awardedAmount ? <span className="text-[#2f5d33]">{t("admin.claimsAwarded", { amount: money(claim.awardedAmount, "KWD") })}</span> : null}
        </p>
        <p dir="auto" className="mt-2 whitespace-pre-line text-[14px] leading-6 text-[#3d5376]">{claim.description}</p>
        {claim.evidenceUrl ? (
          <a href={claim.evidenceUrl} target="_blank" rel="noopener noreferrer nofollow" className={`${smallButtonClass.secondary} mt-3`}>
            {t("admin.claimsEvidence")} <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}

        <div className="mt-4 rounded-xl border border-[#e1e7ef] bg-[#fafbfd] p-3.5">
          <p className="text-[13px] font-semibold text-[#0a285a]">{t("admin.claimsResponse")}</p>
          {claim.courierResponse ? (
            <p dir="auto" className="mt-1 whitespace-pre-line text-[14px] leading-6 text-[#3d5376]">{claim.courierResponse}</p>
          ) : (
            <p className="mt-1 text-[13px] ink-muted">{t("admin.claimsNoResponse")}</p>
          )}
        </div>

        {claim.decisionNote ? <p dir="auto" className="mt-3 text-[13px] leading-5 text-[#536b8c]">{claim.decisionNote}</p> : null}
      </div>

      {open && actor.kind === "courier" ? <Respond claim={claim} /> : null}
      {open && can(actor, "delivery.decideClaims") ? <Decide claim={claim} /> : null}
    </li>
  );
}

function Respond({ claim }: { claim: Claim }) {
  const { t } = useTranslation();
  const refusal = useRefusal();
  const utils = trpc.useUtils();
  const [response, setResponse] = useState(claim.courierResponse ?? "");
  const respond = trpc.dispatch.claims.respond.useMutation({
    onSuccess: () => { toast.success(t("admin.claimsResponded")); void utils.dispatch.claims.list.invalidate(); },
    onError: error => toast.error(refusal(error.message)),
  });
  const id = `respond-${claim.id}`;
  return (
    <form className="border-t border-[#eef1f5] bg-[#fafbfd] px-4 py-4 sm:px-5" onSubmit={event => { event.preventDefault(); respond.mutate({ claimId: claim.id, response }); }}>
      <label htmlFor={id} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.claimsRespondLabel")}</label>
      <textarea
        id={id}
        value={response}
        onChange={event => setResponse(event.target.value)}
        maxLength={MAX_CLAIM_RESPONSE}
        rows={3}
        dir="auto"
        required
        className={`${textareaClass} mt-1.5`}
      />
      <div className="mt-3 flex justify-end">
        <button type="submit" disabled={respond.isPending || !response.trim()} className={smallButtonClass.primary}>
          {t("admin.claimsRespond")}
        </button>
      </div>
    </form>
  );
}

function Decide({ claim }: { claim: Claim }) {
  const { t } = useTranslation();
  const refusal = useRefusal();
  const utils = trpc.useUtils();
  const money = useMoney();
  const [award, setAward] = useState(claim.claimedAmount);
  const [note, setNote] = useState("");
  /* A decision is final and moves money between two companies, so it asks
     first — and the confirm button carries the verb, not "OK". */
  const [confirming, setConfirming] = useState<"accepted" | "rejected" | null>(null);
  const decide = trpc.dispatch.claims.decide.useMutation({
    onSuccess: () => {
      setConfirming(null);
      toast.success(t("admin.claimsDecided"));
      void utils.dispatch.claims.list.invalidate();
      void utils.dispatch.claims.ledger.invalidate();
      void utils.dispatch.claims.openCount.invalidate();
    },
    onError: error => { setConfirming(null); toast.error(refusal(error.message)); },
  });
  const awardId = `award-${claim.id}`;
  const noteId = `decision-${claim.id}`;
  return (
    <div className="border-t border-[#eef1f5] bg-[#fafbfd] px-4 py-4 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div>
          <label htmlFor={awardId} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.claimsAwardLabel")}</label>
          <input id={awardId} value={award} onChange={event => setAward(event.target.value)} inputMode="decimal" dir="ltr" className={`${fieldClass} mt-1.5`} />
        </div>
        <div>
          <label htmlFor={noteId} className="block text-[13px] font-semibold text-[#0a285a]">{t("admin.claimsNoteLabel")}</label>
          <input id={noteId} value={note} onChange={event => setNote(event.target.value)} maxLength={500} dir="auto" className={`${fieldClass} mt-1.5`} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" disabled={decide.isPending} onClick={() => setConfirming("rejected")} className={smallButtonClass.quietDanger}>
          {t("admin.claimsReject")}
        </button>
        <button type="button" disabled={decide.isPending} onClick={() => setConfirming("accepted")} className={smallButtonClass.primary}>
          {t("admin.claimsAccept")}
        </button>
      </div>
      <ConfirmDialog
        open={confirming !== null}
        tone={confirming === "rejected" ? "danger" : "normal"}
        title={confirming === "accepted"
          ? t("admin.claimsConfirmAccept", { amount: money(award || claim.claimedAmount, "KWD"), company: isolate(claim.courierName ?? "—") })
          : t("admin.claimsConfirmReject")}
        body={t("admin.claimsConfirmBody")}
        confirmLabel={confirming === "accepted" ? t("admin.claimsAcceptShort") : t("admin.claimsReject")}
        pending={decide.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming === "accepted") decide.mutate({ claimId: claim.id, outcome: "accepted", awardedAmount: award, note: note || null });
          else decide.mutate({ claimId: claim.id, outcome: "rejected", note: note || null });
        }}
      />
    </div>
  );
}
