import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  clampPage,
  clampPageSize,
  offsetFor,
  pageCount,
  pageRange,
  pageWindow,
} from "./pagination.js";

describe("pageCount", () => {
  it("rounds up a partial last page", () => {
    expect(pageCount(214, 50)).toBe(5);
    expect(pageCount(200, 50)).toBe(4);
  });

  /* An empty list is one empty page, not zero: "page 0 of 0" reads as broken. */
  it("is one page when there is nothing to show", () => {
    expect(pageCount(0, 50)).toBe(1);
  });
});

describe("clampPage", () => {
  it("keeps a page that exists", () => {
    expect(clampPage(3, 214, 50)).toBe(3);
  });

  /*
   * A bookmark of page 7 outlives the rows that made seven pages. Landing on
   * the last page is what somebody meant; an empty page is not.
   */
  it("lands a stale page number on the last real one", () => {
    expect(clampPage(7, 214, 50)).toBe(5);
    expect(clampPage(99, 0, 50)).toBe(1);
  });

  it("refuses nonsense rather than passing it to SQL", () => {
    expect(clampPage(0, 214, 50)).toBe(1);
    expect(clampPage(-4, 214, 50)).toBe(1);
    expect(clampPage(Number.NaN, 214, 50)).toBe(1);
    expect(clampPage(2.7, 214, 50)).toBe(2);
  });
});

describe("clampPageSize", () => {
  it("defaults when unasked and caps when asked for too much", () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(25)).toBe(25);
    // A caller asking for everything is how a list turns back into the
    // unbounded query the paging replaced.
    expect(clampPageSize(100_000)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(1);
  });
});

describe("offsetFor", () => {
  it("starts the first page at zero", () => {
    expect(offsetFor(1, 50)).toBe(0);
    expect(offsetFor(3, 50)).toBe(100);
  });
});

describe("pageRange", () => {
  it("describes which rows are on screen", () => {
    expect(pageRange({ rows: new Array(50), total: 214, page: 2, pageSize: 50 })).toEqual({ first: 51, last: 100 });
  });

  it("stops the last page at the total rather than at the page size", () => {
    expect(pageRange({ rows: new Array(14), total: 214, page: 5, pageSize: 50 })).toEqual({ first: 201, last: 214 });
  });

  it("says nothing rather than '1–0' when there is nothing", () => {
    expect(pageRange({ rows: [], total: 0, page: 1, pageSize: 50 })).toEqual({ first: 0, last: 0 });
  });
});

describe("pageWindow", () => {
  it("shows every page while they all fit", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it("always offers the first and the last", () => {
    const window = pageWindow(20, 40);
    expect(window[0]).toBe(1);
    expect(window[window.length - 1]).toBe(40);
    expect(window).toContain(20);
  });

  /* A gap of one page costs the same room as the page does, and hides it. */
  it("writes out a single skipped page instead of eliding it", () => {
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("elides a real run", () => {
    expect(pageWindow(10, 40)).toEqual([1, null, 9, 10, 11, null, 40]);
  });

  it("never repeats a page when the window touches an end", () => {
    for (const [current, pages] of [[1, 40], [2, 40], [40, 40], [39, 40], [1, 1]] as const) {
      const numbers = pageWindow(current, pages).filter((page): page is number => page !== null);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    }
  });
});
