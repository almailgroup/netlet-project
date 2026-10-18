/**
 * The audit trail.
 *
 * Reads rather than acts — there is deliberately nothing on this page that
 * changes anything, because a log you can edit is not evidence.
 *
 * Each row answers the three questions an audit is for: what happened, to
 * what, and who did it. The before/after pair is shown inline where there is
 * one, since "commission changed" without the numbers is a timestamp wearing a
 * label.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { QueryGate } from "@/components/admin/QueryGate";
import { EmptyState, isolate, PageHeader, Pill, Segmented, SkeletonRows, smallButtonClass } from "@/components/admin/ui";
import { useDateTimeFormat } from "@/hooks/useDateFormat";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { usePageMeta } from "@/hooks/usePageMeta";
import { privatePageMeta } from "@shared/seo";
import { isMessageKey, type MessageKey } from "@shared/i18n/dictionary";
import { useState } from "react";

/** The rank names the portal already uses, so one word is not spelled twice. */
const ROLE_LABEL: Record<string, MessageKey> = {
  admin: "admin.roleAdmin",
  owner: "admin.roleOwner",
  manager: "admin.roleManager",
  staff: "admin.roleStaff",
};
const roleLabel = (role: string): MessageKey => ROLE_LABEL[role] ?? "admin.roleStaff";

export default function AdminAudit() {
  usePageMeta(privatePageMeta("Audit trail"));
  return <AdminShell need={"platform.viewAll"}>{() => <Trail />}</AdminShell>;
}

/** The fields worth showing inline, in the order they read best. */
const SUMMARY_KEYS = ["status", "role", "price", "commissionPercent", "commissionFixed"] as const;

function summarise(before: unknown, after: unknown): { field: string; from: string; to: string } | null {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    if (key in a || key in b) {
      const from = b[key];
      const to = a[key];
      if (String(from ?? "—") === String(to ?? "—")) continue;
      return { field: key, from: String(from ?? "—"), to: String(to ?? "—") };
    }
  }
  return null;
}

function Trail() {
  const { t } = useTranslation();
  const when = useDateTimeFormat();
  const utils = trpc.useUtils();
  /*
   * Two views of one table, not two pages. "Everything" is the trail;
   * "Seller changes" is requirement 3.3.8's question — what the vendors did —
   * and it is narrowed on the server, because a filter applied to the hundred
   * rows already fetched reports a quiet week for a shop that has been busy.
   */
  const [view, setView] = useState<"all" | "sellers">("all");
  const entries = trpc.inventory.audit.useQuery({ limit: 100 }, { enabled: view === "all" });
  const seller = trpc.inventory.sellerChanges.useQuery({ limit: 100 }, { enabled: view === "sellers" });
  const unread = trpc.inventory.sellerChanges.useQuery({ limit: 1 });

  const markSeen = trpc.inventory.markAuditSeen.useMutation({
    onSuccess: () => { void utils.inventory.sellerChanges.invalidate(); },
  });

  const active = view === "all" ? entries : seller;
  const rows = view === "all" ? entries.data ?? [] : seller.data?.rows ?? [];
  const unseen = unread.data?.unseen ?? 0;

  return (
    <>
      <PageHeader title={t("admin.audit")} description={t("admin.auditNote")} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t("admin.audit")}
          value={view}
          onChange={setView}
          options={[
            { value: "all", label: t("admin.auditEverything") },
            { value: "sellers", label: t("admin.sellerChanges"), count: unseen > 0 ? unseen : null },
          ]}
        />
        {/* The count is what makes the log visible rather than merely
            available, and pressing the button is what clears it — never the
            tile rendering somewhere else, which would hide work by drawing. */}
        {unread.data ? (
          unseen > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold ink-accent">{t("admin.auditUnseen", { count: unseen })}</span>
              <button type="button" onClick={() => markSeen.mutate()} disabled={markSeen.isPending} className={smallButtonClass.secondary}>
                {t("admin.auditMarkSeen")}
              </button>
            </div>
          ) : (
            <span className="text-[13px] ink-muted">{t("admin.auditAllRead")}</span>
          )
        ) : null}
      </div>

      {active.isLoading ? (
        <SkeletonRows label={t("admin.loading")} />
      ) : active.isError ? (
        <QueryGate queries={[active]}>{() => null}</QueryGate>
      ) : rows.length === 0 ? (
        <EmptyState title={t("admin.noAudit")} />
      ) : (
        <ol className="divide-y divide-[#eef1f5] overflow-hidden rounded-2xl border border-[#e1e7ef] bg-white">
          {rows.map(entry => {
            const change = summarise(entry.before, entry.after);
            const label = `action.${entry.action}`;
            const automatic = (entry.after as Record<string, unknown> | null)?.automatic === true;
            return (
              <li key={entry.id} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-[14px] font-bold text-[#0a285a]">
                    {isMessageKey(label) ? t(label as MessageKey) : entry.action}
                    {entry.subjectLabel ? <span dir="auto" className="ms-2 font-semibold text-[#3d5376]">{entry.subjectLabel}</span> : null}
                  </p>
                  <time dateTime={new Date(entry.createdAt).toISOString()} className="text-[12px] ink-muted">{when(entry.createdAt)}</time>
                </div>

                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#536b8c]">
                  {change ? (
                    // The values are data, not prose: isolated so a status or a
                    // price does not reorder inside an Arabic sentence.
                    <bdi dir="ltr" className="rounded-md bg-[#f2f5f9] px-1.5 py-0.5 font-mono text-[12px] text-[#0a285a]">
                      {change.from} → {change.to}
                    </bdi>
                  ) : null}
                  <span>
                    {automatic || !entry.actorEmail
                      ? t("admin.auditAutomatic")
                      : t("admin.auditBy", { name: isolate(entry.actorEmail) })}
                  </span>
                  {/* The rank they held at the time, frozen on the row — not
                      the one they hold today, which is a different fact. */}
                  {entry.actorRole ? <Pill>{t(roleLabel(entry.actorRole))}</Pill> : null}
                  {/* "And who authorised them" — the half of requirement 3.3.9
                      the trail could not answer. Shown only where it was
                      resolved: absent means the actor is this installation's
                      first administrator, and a row reading "authorised by
                      nobody" would be an accusation rather than a fact. */}
                  {entry.authorisedByEmail ? (
                    <span className="ink-muted">{t("admin.auditAuthorisedBy", { name: isolate(entry.authorisedByEmail) })}</span>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
