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
import { useTranslation } from "@/hooks/useTranslation";
import { isMessageKey } from "@shared/i18n/dictionary";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";

type GatedQuery = {
  isLoading: boolean;
  isError: boolean;
  error: { message: string } | null;
  refetch: () => unknown;
};

export function QueryGate({ queries, children, audience = "staff" }: {
  /** Every query the page cannot render without. */
  queries: GatedQuery[];
  children: () => ReactNode;
  /**
   * Who is reading. Staff see what the server said — "column contact_email
   * does not exist" is what tells an administrator to run the migration. A
   * shopper is told the section could not load and offered a retry: a raw
   * database sentence on their account page is neither theirs to act on nor
   * NetLet's to show them. A message we wrote is shown to both.
   */
  audience?: "staff" | "shopper";
}) {
  const { t } = useTranslation();

  /* A shape where the content will be rather than a word in its place: the
     page does not jump when it arrives, and "Loading…" is still what a screen
     reader is told. */
  if (queries.some(query => query.isLoading)) {
    return (
      <div role="status" className="space-y-3">
        <span className="sr-only">{t("admin.loading")}</span>
        {[0, 1, 2].map(index => (
          <div key={index} aria-hidden className="h-16 animate-pulse rounded-2xl border border-[#e1e7ef] bg-white" />
        ))}
      </div>
    );
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
    const raw = failed.error?.message ?? "";
    const detail = isMessageKey(raw) || audience === "staff" ? raw : "";
    return (
      <div role="alert" className="rounded-2xl border border-[#f2b69e] bg-[#fdeceb] p-5">
        <p className="flex items-center gap-2 text-[15px] font-bold text-[#8c2f22]">
          <AlertTriangle className="size-4 shrink-0" />
          {t(audience === "shopper" ? "account.sectionFailed" : "admin.loadFailed")}
        </p>
        {detail ? (
          <p dir="auto" className="mt-2 text-[13px] leading-5 break-words text-[#8c2f22]">
            {isMessageKey(detail) ? t(detail) : detail}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => queries.forEach(query => query.refetch())}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-[#efc6bd] bg-white px-4 text-[14px] font-semibold text-[#8c2f22] hover:bg-[#fff5f3]"
        >
          <RotateCw className="size-4" />{t("admin.retry")}
        </button>
      </div>
    );
  }

  return <>{children()}</>;
}
