import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* "Mark all as read" that the server refused changed nothing and said
   nothing, which reads as a press that did not take. */
const shown = vi.hoisted(() => ({ errors: [] as string[] }));
const answer = vi.hoisted(() => ({ fails: true }));

vi.mock("sonner", () => ({ toast: { error: (text: string) => shown.errors.push(text), success: () => {} } }));
vi.mock("@/lib/trpc", () => {
  const node = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_target, key: string) {
        if (key === "useMutation")
          return (options: { onError?: (error: { message: string }) => void; onSuccess?: () => void }) => ({
            mutate: () => (answer.fails ? options.onError?.({ message: "Failed to fetch" }) : options.onSuccess?.()),
          });
        if (key === "useUtils") return () => node([]);
        if (key === "invalidate") return () => Promise.resolve();
        if (key === "then") return undefined;
        return node([...path, key]);
      },
      apply() { return node(path); },
    });
  return { trpc: node([]) };
});
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, tError: (message: string) => `said:${message}`, locale: "en", isArabic: false }),
}));

const { useMarkAllRead } = await import("./AccountNotifications");

function pressed() {
  let press: (() => void) | undefined;
  function Probe() {
    press = useMarkAllRead();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  press!();
}

describe("Mark all as read", () => {
  it("says a refusal", () => {
    shown.errors.length = 0;
    answer.fails = true;
    pressed();
    expect(shown.errors).toEqual(["said:Failed to fetch"]);
  });

  it("says nothing once it took", () => {
    shown.errors.length = 0;
    answer.fails = false;
    pressed();
    expect(shown.errors).toEqual([]);
  });
});
