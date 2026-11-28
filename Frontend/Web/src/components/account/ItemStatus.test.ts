import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrderProgress } from "@shared/commerce/orderProgress";

/* On the owner's word ("it should be clear, showing status also track order
   click to be understandable by clients"): each item of an opened order says
   where it is in a band, with a button saying what a press does. It was a
   small tile with an 11px word and no word for the press. */
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, tError: (message: string) => message, locale: "en", isArabic: false }),
}));
vi.mock("@/hooks/useDateFormat", () => ({ useDateFormat: () => () => "4 Nov" }));

const { ItemStatus } = await import("./OrderJourney");

const draw = (progress: OrderProgress, over: Partial<Parameters<typeof ItemStatus>[0]> = {}) =>
  renderToStaticMarkup(createElement(ItemStatus, {
    progress,
    expected: null,
    rating: null,
    mayRate: false,
    title: "Desk lamp",
    track: { open: false, controls: "panel-1", onPress: () => {} },
    onRate: () => {},
    ...over,
  }));

describe("an opened order's item status", () => {
  it("is one press saying Track order while the item is coming, its name telling the items apart", () => {
    const html = draw({ kind: "received", preordered: false }, { expected: { text: "Expected Tue 13 Oct", late: false } });
    expect(html).toMatch(/^<button (?=[^>]*aria-expanded="false")(?=[^>]*aria-controls="panel-1")[^>]*data-look="processing"/);
    expect(html).toContain('class="item-status-word">orders.progressReceived<');
    expect(html).toContain('<span class="item-status-pill">orders.track');
    expect(html).toContain("Expected Tue 13 Oct");
    expect(html).toContain('<span class="sr-only">: Desk lamp</span>');
  });

  it("draws the tracker's four steps with the one it is at", () => {
    const html = draw({ kind: "onTheWay" });
    const steps = [...html.matchAll(/data-step="(\w+)"/g)].map(match => match[1]);
    expect(steps).toEqual(["done", "done", "now", "ahead"]);
    expect(draw({ kind: "delivered", at: null }).match(/data-step="arrived"/g)).toHaveLength(4);
  });

  it("says it is open while its tracker is", () => {
    expect(draw({ kind: "preparing" }, { track: { open: true, controls: "panel-1", onPress: () => {} } })).toContain('aria-expanded="true"');
  });

  it("is the review once it has arrived: Rate, then the stars and Edit", () => {
    const rate = draw({ kind: "delivered", at: "2026-11-04T10:00:00.000Z" }, { mayRate: true });
    expect(rate).toMatch(/^<button (?![^>]*aria-expanded)[^>]*data-look="rate"/);
    expect(rate).toContain("orders.pickRate");
    expect(rate).not.toContain("orders.track");
    const rated = draw({ kind: "delivered", at: null }, { rating: 4 });
    expect(rated).toContain('data-look="rated"');
    // The pill says what it edits, so the name is "… Edit your review: Desk lamp", Edit said once.
    expect(rated).toContain('<span class="item-status-pill" data-quiet="">review.edit</span><span class="sr-only">: Desk lamp</span>');
  });

  it("is the status alone when there is nothing to do", () => {
    const cancelled = draw({ kind: "cancelled" }, { track: null });
    expect(cancelled).toMatch(/^<div class="item-status" data-look="cancelled">/);
    expect(cancelled).not.toContain("<button");
    expect(cancelled).not.toContain("item-status-steps");
    expect(draw({ kind: "delivered", at: null }, { track: null })).not.toContain("<button");
  });
});
