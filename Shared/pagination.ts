/**
 * Paging for the admin lists, as arithmetic rather than as a component.
 *
 * Every list in the portal used to stop at a hard `limit` — 500 products, 100
 * vendors, 100 people, 50 low-stock rows — and say nothing about it. That is
 * the same failure `QueryGate` was built for: a table that shows some of the
 * answer looks exactly like a table that shows all of it, so a vendor with 600
 * products would have gone looking for the missing hundred in the wrong place,
 * and an administrator would have decided who works here from a list of the
 * hundred newest accounts.
 *
 * A page therefore always carries its `total`, whether or not the UI shows a
 * pager: the count is the part that stops a truncated list from lying.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** One page of rows, and enough about the whole to describe it honestly. */
export type Page<T> = {
  rows: T[];
  /** How many rows match, ignoring paging. */
  total: number;
  /** 1-based. */
  page: number;
  pageSize: number;
};

/** Pages needed to hold `total` rows. Zero rows is still one (empty) page. */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * A requested page number, brought into range.
 *
 * Out-of-range is a normal thing to receive rather than an error: a bookmark
 * of page 7 outlives the rows that made seven pages, and a shopper deleted
 * between two requests moves everybody. Landing on the last page is what
 * somebody meant; an empty page with no explanation is not.
 */
export function clampPage(requested: number, total: number, pageSize: number): number {
  if (!Number.isFinite(requested)) return 1;
  return Math.min(Math.max(1, Math.trunc(requested)), pageCount(total, pageSize));
}

export function clampPageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.trunc(requested)), MAX_PAGE_SIZE);
}

export function offsetFor(page: number, pageSize: number): number {
  return (Math.max(1, page) - 1) * pageSize;
}

/** The rows this page covers, 1-based and inclusive, for "showing 51–100 of 214". */
export function pageRange(page: Page<unknown>): { first: number; last: number } {
  if (page.total === 0) return { first: 0, last: 0 };
  const first = offsetFor(page.page, page.pageSize) + 1;
  return { first, last: Math.min(first + page.rows.length - 1, page.total) };
}

/**
 * Which page numbers a pager should offer, with gaps as `null`.
 *
 * The first and last are always there — "go to the end" is a real intention —
 * and `span` pages either side of the current one. Anything skipped becomes a
 * single `null`, so a list of 400 pages is still one row of controls.
 */
export function pageWindow(current: number, pages: number, span = 1): (number | null)[] {
  const wanted = new Set<number>([1, pages]);
  for (let page = current - span; page <= current + span; page += 1) {
    if (page >= 1 && page <= pages) wanted.add(page);
  }

  const out: (number | null)[] = [];
  let previous = 0;
  for (const page of [...wanted].sort((a, b) => a - b)) {
    // A gap of exactly one page is written out rather than elided: "1 … 3"
    // takes the same room as "1 2 3" and hides a page you can reach.
    if (page - previous === 2) out.push(previous + 1);
    else if (page - previous > 2) out.push(null);
    out.push(page);
    previous = page;
  }
  return out;
}
