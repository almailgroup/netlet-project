/**
 * The pager under every admin list, and the count above it.
 *
 * The count is the part that matters and is drawn even when there is only one
 * page: a table that shows some of the answer used to look exactly like one
 * that showed all of it, because the lists stopped at a fixed ceiling and said
 * nothing. "Showing 1–50 of 214" is what stops a vendor going to look for the
 * other 164 somewhere else.
 *
 * The controls themselves are hidden at one page, where they would be four
 * disabled buttons saying the list is short.
 */
import { useTranslation } from "@/hooks/useTranslation";
import { pageCount, pageRange, pageWindow, type Page } from "@shared/pagination";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pager({ page, onPage }: { page: Page<unknown>; onPage: (next: number) => void }) {
  const { t } = useTranslation();
  const pages = pageCount(page.total, page.pageSize);
  const { first, last } = pageRange(page);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p aria-live="polite" className="text-[13px] ink-muted">
        {page.total === 0
          ? t("admin.showingNone")
          : t("admin.showingRange", { first: String(first), last: String(last), total: String(page.total) })}
      </p>

      {pages > 1 ? (
        <nav aria-label={t("admin.pagination")} className="flex items-center gap-1">
          <Step
            label={t("admin.previousPage")}
            disabled={page.page <= 1}
            onClick={() => onPage(page.page - 1)}
          >
            {/* "Back" points against the reading direction in both scripts. */}
            <ChevronLeft className="size-4 rtl:-scale-x-100" />
          </Step>

          {pageWindow(page.page, pages).map((number, index) =>
            number === null ? (
              <span key={`gap-${index}`} aria-hidden className="px-1 text-[12px] ink-muted">
                …
              </span>
            ) : (
              <button
                key={number}
                onClick={() => onPage(number)}
                aria-current={number === page.page ? "page" : undefined}
                aria-label={t("admin.goToPage", { page: String(number) })}
                className={`grid h-9 min-w-9 place-items-center rounded-lg px-2 text-[13px] font-semibold transition ${
                  number === page.page
                    ? "bg-[#0a285a] text-white"
                    : "border border-[#cfd9e6] bg-white text-[#0a285a] hover:bg-[#f2f5f9]"
                }`}
              >
                <bdi dir="ltr">{number}</bdi>
              </button>
            ),
          )}

          <Step
            label={t("admin.nextPage")}
            disabled={page.page >= pages}
            onClick={() => onPage(page.page + 1)}
          >
            <ChevronRight className="size-4 rtl:-scale-x-100" />
          </Step>
        </nav>
      ) : null}
    </div>
  );
}

function Step({ label, disabled, onClick, children }: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-9 place-items-center rounded-lg border border-[#cfd9e6] bg-white text-[#0a285a] transition hover:bg-[#f2f5f9] disabled:opacity-40 disabled:hover:bg-white"
    >
      {children}
    </button>
  );
}
