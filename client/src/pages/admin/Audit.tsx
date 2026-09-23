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
  const entries = trpc.inventory.audit.useQuery({ limit: 100 });

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
      <h1 className="text-xl font-extrabold">{t("admin.audit")}</h1>
      <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[#536b8c]">{t("admin.auditNote")}</p>

      {entries.isLoading || entries.isError ? (
        <div className="mt-5"><QueryGate queries={[entries]}>{() => null}</QueryGate></div>
      ) : (entries.data ?? []).length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-[#b8c9dc] bg-white/60 px-6 py-14 text-center">
          <p className="text-sm font-extrabold">{t("admin.noAudit")}</p>
        </div>
      ) : (
        <ol className="mt-5 space-y-2">
          {(entries.data ?? []).map(entry => {
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
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
