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
  const { t, locale } = useTranslation();
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

  const when = (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime())
      ? "—"
      : new Intl.DateTimeFormat(locale === "ar" ? "ar-KW-u-ca-gregory-nu-latn" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
  };

  return (
    <>
      <h1 className="text-[22px] leading-8 font-extrabold sm:text-[24px]">{t("admin.audit")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.auditNote")}</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {([["all", "admin.auditEverything"], ["sellers", "admin.sellerChanges"]] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setView(value)}
            aria-pressed={view === value}
            className={`pressable rounded-full px-4 py-2 text-[12px] font-extrabold ${view === value ? "glass glass-navy" : "glass"}`}
          >
            {t(label)}
          </button>
        ))}
        {/* The count is what makes the log visible rather than merely
            available, and pressing the button is what clears it — never the
            tile rendering somewhere else, which would hide work by drawing. */}
        {unread.data && unread.data.unseen > 0 ? (
          <>
            <span className="text-[12px] font-bold ink-accent">
              {t("admin.auditUnseen", { count: unread.data.unseen })}
            </span>
            <button
              onClick={() => markSeen.mutate()}
              disabled={markSeen.isPending}
              className="glass pressable rounded-full px-4 py-2 text-[11px] font-extrabold disabled:opacity-50"
            >
              {t("admin.auditMarkSeen")}
            </button>
          </>
        ) : (
          <span className="text-[12px] ink-muted">{t("admin.auditAllRead")}</span>
        )}
      </div>

      {active.isLoading || active.isError ? (
        <div className="mt-5"><QueryGate queries={[active]}>{() => null}</QueryGate></div>
      ) : rows.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t("admin.noAudit")}</p>
        </div>
      ) : (
        <ol className="mt-5 space-y-2">
          {rows.map(entry => {
            const change = summarise(entry.before, entry.after);
            const label = `action.${entry.action}`;
            const automatic = (entry.after as Record<string, unknown> | null)?.automatic === true;
            return (
              <li key={entry.id} className="rounded-2xl border border-[#e6e9ef] bg-white px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-[13px] font-extrabold text-[#0a285a]">
                    {isMessageKey(label) ? t(label as MessageKey) : entry.action}
                  </p>
                  <time dir="ltr" className="text-[11px] ink-muted">{when(entry.createdAt)}</time>
                </div>

                <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-[12px] text-[#536b8c]">
                  {entry.subjectLabel ? <span dir="auto" className="font-semibold">{entry.subjectLabel}</span> : null}
                  {change ? (
                    // The values are data, not prose: isolated so a status or a
                    // price does not reorder inside an Arabic sentence.
                    <span dir="ltr" className="font-mono text-[11px]">
                      {change.from} → {change.to}
                    </span>
                  ) : null}
                  <span className="ink-muted">
                    {automatic || !entry.actorEmail
                      ? t("admin.auditAutomatic")
                      : t("admin.auditBy", { name: entry.actorEmail })}
                  </span>
                  {/* "And who authorised them" — the half of requirement 3.3.9
                      the trail could not answer. Shown only where it was
                      resolved: absent means the actor is this installation's
                      first administrator, and a row reading "authorised by
                      nobody" would be an accusation rather than a fact. */}
                  {entry.authorisedByEmail ? (
                    <span className="ink-muted">
                      {t("admin.auditAuthorisedBy", { name: entry.authorisedByEmail })}
                    </span>
                  ) : null}
                  {/* The rank they held at the time, frozen on the row — not
                      the one they hold today, which is a different fact. */}
                  {entry.actorRole ? (
                    <span className="ink-muted">
                      {t("admin.auditRole", { role: t(roleLabel(entry.actorRole)) })}
                    </span>
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
