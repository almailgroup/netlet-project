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
import type { AppRouter } from "../../../../server/routers";
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
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.claims")}</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.claimsNote")}</p>

      {seesLedger ? <Ledger /> : null}

      <div role="tablist" aria-label={t("admin.claims")} className="mt-6 inline-flex gap-1 rounded-2xl bg-[#eef1f6] p-1">
        {TABS.map(entry => (
          <button
            key={entry.id}
            role="tab"
            type="button"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`rounded-xl px-4 py-2 text-[12px] font-extrabold ${
              tab === entry.id ? "bg-white text-[#0a285a] shadow-sm" : "text-[#536b8c]"
            }`}
          >
            {t(entry.label)}
          </button>
        ))}
      </div>

      <QueryGate queries={[claims]}>
        {() => {
          const rows = claims.data ?? [];
          if (rows.length === 0) {
            return <p className="mt-5 rounded-2xl border border-[#e6e9ef] bg-white px-5 py-6 text-sm text-[#536b8c]">{t("admin.claimsNone")}</p>;
          }
          return (
            <ul className="mt-5 space-y-3">
              {rows.map(claim => <ClaimCard key={claim.id} claim={claim} actor={actor} />)}
            </ul>
          );
        }}
      </QueryGate>
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
          <div className="mt-6">
            <h2 id="claims-ledger" className="text-sm font-extrabold">{t("admin.claimsLedger")}</h2>
            {/* Scrolls sideways on a phone, and a keyboard can reach it — the
                finance tables' arrangement. */}
            <div tabIndex={0} role="region" aria-labelledby="claims-ledger" className="mt-2 overflow-x-auto rounded-2xl border border-[#e6e9ef] bg-white">
              <table className="w-full min-w-[480px] text-[13px]">
                <thead className="text-[11px] font-extrabold tracking-[.06em] text-[#536b8c] uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-start">{t("admin.claimsLedgerCompany")}</th>
                    <th scope="col" className="px-4 py-3 text-end">{t("admin.claimsLedgerOwed")}</th>
                    <th scope="col" className="px-4 py-3 text-end">{t("admin.claimsLedgerAccepted")}</th>
                    <th scope="col" className="px-4 py-3 text-end">{t("admin.claimsLedgerOpen")}</th>
                    <th scope="col" className="px-4 py-3 text-end">{t("admin.claimsLedgerRejected")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.courierId} className="border-t border-[#eef1f6]">
                      <th scope="row" dir="auto" className="px-4 py-3 text-start font-bold">{row.courierName ?? "—"}</th>
                      <td className="px-4 py-3 text-end font-extrabold"><bdi dir="ltr">{money(row.owed, "KWD")}</bdi></td>
                      <td className="px-4 py-3 text-end">{row.accepted}</td>
                      <td className="px-4 py-3 text-end">{row.open}</td>
                      <td className="px-4 py-3 text-end">{row.rejected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
    <li className="rounded-2xl border border-[#e6e9ef] bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-extrabold">
          <bdi dir="ltr">{claim.reference}</bdi>
          <span className="ms-2 text-[12px] font-bold text-[#536b8c]" dir="auto">{claim.vendorName ?? "—"}</span>
        </p>
        <span className="text-[11px] text-[#536b8c]">{formatDate(claim.createdAt)}</span>
      </div>
      <p className="mt-1 text-[12px] text-[#536b8c]">
        {t(FILED_BY[claim.filedAs] ?? "admin.claimsFiledBy.shopper")}
        {claim.courierName ? <> · <span dir="auto">{t("admin.claimsAgainst", { company: claim.courierName })}</span></> : null}
      </p>

      <ul className="mt-3 space-y-0.5 text-[13px]">
        {claim.lines.map(line => (
          <li key={line.lineId} className="flex justify-between gap-4">
            <span dir="auto" className="min-w-0 truncate">{line.productTitle}</span>
            <bdi dir="ltr" className="shrink-0 text-[#536b8c]">{money(line.lineTotal, "KWD")}</bdi>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] font-extrabold">
        {t("admin.claimsClaimed", { amount: money(claim.claimedAmount, "KWD") })}
        {claim.awardedAmount ? <span className="ms-3 text-[#2f5d33]">{t("admin.claimsAwarded", { amount: money(claim.awardedAmount, "KWD") })}</span> : null}
      </p>
      <p dir="auto" className="mt-2 whitespace-pre-line text-[13px] leading-6">{claim.description}</p>
      {claim.evidenceUrl ? (
        <a
          href={claim.evidenceUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-extrabold ink-accent underline"
        >
          {t("admin.claimsEvidence")} <ExternalLink className="size-3.5" aria-hidden />
        </a>
      ) : null}

      <div className="mt-3 rounded-xl bg-[#f7f8fb] p-3">
        <p className="text-[11px] font-extrabold tracking-[.06em] text-[#536b8c] uppercase">{t("admin.claimsResponse")}</p>
        {claim.courierResponse ? (
          <p dir="auto" className="mt-1 whitespace-pre-line text-[13px] leading-6">{claim.courierResponse}</p>
        ) : (
          <p className="mt-1 text-[12px] text-[#536b8c]">{t("admin.claimsNoResponse")}</p>
        )}
      </div>

      {claim.decisionNote ? <p dir="auto" className="mt-2 text-[12px] leading-5 text-[#536b8c]">{claim.decisionNote}</p> : null}

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
  return (
    <form className="mt-3" onSubmit={event => { event.preventDefault(); respond.mutate({ claimId: claim.id, response }); }}>
      <label className="block">
        <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("admin.claimsRespondLabel")}</span>
        <textarea
          value={response}
          onChange={event => setResponse(event.target.value)}
          maxLength={MAX_CLAIM_RESPONSE}
          rows={3}
          dir="auto"
          required
          className="glass-field mt-1 w-full rounded-2xl px-4 py-2.5 text-sm"
        />
      </label>
      <button type="submit" disabled={respond.isPending} className="glass-navy type-control pressable mt-2 rounded-full px-4 py-2 disabled:opacity-60">
        {t("admin.claimsRespond")}
      </button>
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
    onError: error => toast.error(refusal(error.message)),
  });
  return (
    <div className="mt-3 border-t border-[#eef1f6] pt-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("admin.claimsAwardLabel")}</span>
          <input
            value={award}
            onChange={event => setAward(event.target.value)}
            inputMode="decimal"
            dir="ltr"
            className="glass-field mt-1 w-36 rounded-full px-4 py-2 text-sm"
          />
        </label>
        <label className="block min-w-[220px] flex-1">
          <span className="block text-[11px] font-extrabold text-[#536b8c]">{t("admin.claimsNoteLabel")}</span>
          <input
            value={note}
            onChange={event => setNote(event.target.value)}
            maxLength={500}
            dir="auto"
            className="glass-field mt-1 w-full rounded-full px-4 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => setConfirming("accepted")}
          className="glass-navy type-control pressable rounded-full px-4 py-2 disabled:opacity-60"
        >
          {t("admin.claimsAccept")}
        </button>
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => setConfirming("rejected")}
          className="glass type-control pressable rounded-full px-4 py-2 disabled:opacity-60"
        >
          {t("admin.claimsReject")}
        </button>
      </div>
      <ConfirmDialog
        open={confirming !== null}
        tone={confirming === "rejected" ? "danger" : "normal"}
        title={confirming === "accepted"
          ? t("admin.claimsConfirmAccept", { amount: money(award || claim.claimedAmount, "KWD"), company: claim.courierName ?? "—" })
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
