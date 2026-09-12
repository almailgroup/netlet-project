/**
 * The three states a loaded page has, never two.
 *
 * Every page in the portal used to branch on `isLoading` and then read
 * `data ?? []`, which silently turns a refused or broken query into "nothing
 * here". That is the worst of the three answers: an empty table invites
 * somebody to add the thing that is actually already there and merely
 * unreadable, and a failing page that says "No vendors yet" reads as working.
 *
 * So: loading, failed, or ready — and failed says so, shows what the server
 * said, and offers to try again.
 */
import { useTranslation } from "@/lib/useTranslation";
import { isMessageKey } from "@shared/i18n/dictionary";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

type GatedQuery = {
  isLoading: boolean;
  isError: boolean;
  error: { message: string } | null;
  refetch: () => unknown;
};

export function QueryGate({ queries, children }: {
  /** Every query the page cannot render without. */
  queries: GatedQuery[];
  children: () => ReactNode;
}) {
  const { t } = useTranslation();

  if (queries.some(query => query.isLoading)) {
    return <p className="text-sm text-[#536b8c]">{t("admin.loading")}</p>;
  }

  const failed = queries.find(query => query.isError);
  if (failed) {
    /*
     * The server's own message, when it is one we wrote. A tRPC error from a
     * broken query carries the database's text, which is not for a shopper but
     * is exactly what an administrator needs — it is the difference between
     * "something went wrong" and "column contact_email does not exist", and
     * only one of those tells you to run the migration.
     */
    const detail = failed.error?.message ?? "";
    return (
      <div className="rounded-2xl border border-[#f2b69e] bg-[#fdeceb] p-5">
        <p className="flex items-center gap-2 text-sm font-extrabold text-[#8c2f22]">
          <AlertTriangle className="size-4 shrink-0" />
          {t("admin.loadFailed")}
        </p>
        {detail ? (
          <p dir="auto" className="mt-2 text-[12px] leading-5 break-words text-[#8c2f22]/80">
            {isMessageKey(detail) ? t(detail) : detail}
          </p>
        ) : null}
        <button
          onClick={() => queries.forEach(query => query.refetch())}
          className="glass pressable mt-4 inline-flex items-center gap-2 rounded-full border border-[#8c2f22]/20 px-4 py-2 text-xs font-extrabold text-[#8c2f22]"
        >
          <RotateCw className="size-4" />{t("admin.retry")}
        </button>
      </div>
    );
  }

  return <>{children()}</>;
}
