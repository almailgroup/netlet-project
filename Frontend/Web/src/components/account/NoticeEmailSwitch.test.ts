import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";

vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: "en", isArabic: false }),
}));

const { NoticeEmailSwitch } = await import("./AccountNotifications");

function draw(email: { data: boolean | undefined; isError: boolean; isPlaceholderData?: boolean }) {
  return renderToStaticMarkup(
    createElement(
      Router,
      { ssrPath: "/account/notifications" },
      createElement(NoticeEmailSwitch, { email: { ...email, refetch: () => {} }, address: "noura@example.com", pending: false, onChange: () => {} }),
    ),
  );
}

describe("NoticeEmailSwitch", () => {
  /* It drew `email.data ?? true` and stayed pressable when the setting had
     not come back: on, over a shopper who had turned email off. */
  it("says the setting could not be read, with Try again, rather than a switch drawn on", () => {
    const html = draw({ data: undefined, isError: true });
    expect(html).toContain("account.sectionFailed");
    expect(html).toContain("home.refreshCatalog");
    expect(html).not.toContain('type="checkbox"');
  });

  it("draws the switch off and not pressable while the setting is read", () => {
    const html = draw({ data: undefined, isError: false });
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("checked");
    expect(html).toContain("disabled");
  });

  it("draws the shopper's own setting once it is read", () => {
    expect(draw({ data: false, isError: false })).not.toContain("checked");
    const on = draw({ data: true, isError: false });
    expect(on).toContain("checked");
    expect(on).not.toContain("disabled");
  });

  it("keeps the setting drawn when asking again fails", () => {
    const html = draw({ data: false, isError: true });
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("account.sectionFailed");
  });
});
