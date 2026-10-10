/**
 * The header's account control.
 *
 * Signed out it is one button, "Sign in", and it opens the sign-in dialog where
 * the shopper already is — sending somebody to another page to find a form is
 * one more step between them and the bag they were filling.
 *
 * Signed in it carries the shopper's first name and opens a short menu: where
 * their orders are, their messages, the account page, and — only for somebody
 * who also runs a store or the shop — the portal. Those are the places people
 * open an account control to reach; everything else is on the account page.
 * **Signing out is deliberately not here.** It lives on `/account` behind its
 * confirmation, so the most destructive thing the bar can do never sits one
 * click from the friendliest label on it.
 *
 * It is the WAI-ARIA menu button: `aria-haspopup`, `aria-expanded`, focus moves
 * to the first item on open, the arrow keys move between items, Escape and Tab
 * close it, and Escape hands focus back to the button. A plain list of links
 * would be simpler and is what a phone gets — the bottom bar's Account tab
 * goes straight to the page.
 */
import AuthDialog from "@/components/auth/AuthDialog";
import { useAccountSignals } from "@/hooks/useAccountSignals";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { DEMO_MODE } from "@/lib/demoMode";
import { trpc } from "@/lib/trpc";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ChevronDown, LayoutDashboard, LifeBuoy, MessageCircle, Package, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Link } from "wouter";

/** The first word of a display name, or null when there is nothing to show. */
export function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

const plain = "pressable flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-[13px] font-extrabold text-[#0a285a] transition-colors hover:bg-[#0a285a]/[.06]";

export function AccountMenu() {
  const { t } = useTranslation();
  const { user, loading, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  /* Cached hard and asked only when signed in: the same read the account page's Selling section makes. */
  const me = trpc.inventory.me.useQuery(undefined, { enabled: isAuthenticated, staleTime: 10 * 60 * 1000, retry: false });
  const portal: MessageKey | null = me.data?.kind === "admin" ? "header.menuAdmin" : me.data?.kind === "vendor" ? "header.menuSeller" : null;
  /* Above the early returns, with every other hook (`hookOrder.test.ts`). */
  const signals = useAccountSignals();
  const unread = signals.unreadMessages + signals.unreadSupport;

  const focusItem = (index: number) => {
    const all = menu.current ? [...menu.current.querySelectorAll<HTMLElement>("[role=menuitem]")] : [];
    all[(index + all.length) % all.length]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  /*
   * While the session is still being asked about, a quiet block the size of
   * the control. It read "Sign in" for that moment and then turned into a
   * name, so the bar shifted under the cursor and a signed-in shopper was told,
   * briefly, that they were not.
   */
  if (loading) return <span aria-hidden className="block h-11 w-[104px] shrink-0 rounded-xl bg-[#0a285a]/[.05]" />;

  if (!isAuthenticated) {
    return (
      <>
        <button
          onClick={() => (DEMO_MODE ? toast(t("header.signInDisabled"), { description: t("header.signInDisabledNote") }) : setAuthOpen(true))}
          className={plain}
        >
          <UserRound className="size-[19px] shrink-0" aria-hidden />
          <span className="hidden lg:inline">{t("header.signIn")}</span>
          <span className="sr-only lg:hidden">{t("header.signIn")}</span>
        </button>
        {/* To `<body>`: the header's `backdrop-filter` would otherwise be the
            containing block for the dialog's `position: fixed`. */}
        {createPortal(<AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />, document.body)}
      </>
    );
  }

  const name = firstName(user?.name) ?? t("nav.account");
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };
  const onMenuKey = (event: React.KeyboardEvent) => {
    const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") { event.preventDefault(); focusItem(at + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusItem(at - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusItem(0); }
    else if (event.key === "End") { event.preventDefault(); focusItem(all.length - 1); }
    else if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "Tab") close(false);
  };

  /*
   * An entry, with what is waiting there said in words beside it — "2 unread",
   * "1 on its way" — rather than a bare number a screen reader would read as
   * part of the label.
   */
  const entry = (href: string, icon: React.ReactNode, label: MessageKey, note?: string | null) => (
    <Link
      href={href}
      role="menuitem"
      tabIndex={-1}
      onClick={() => close(false)}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold text-[#0a285a] hover:bg-[#0a285a]/[.06] focus-visible:bg-[#0a285a]/[.06]"
    >
      <span className="grid size-5 shrink-0 place-items-center text-[#536b8c]" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">{t(label)}</span>
      {note ? <span className="shrink-0 rounded-full bg-[#fff0e8] px-2 py-0.5 text-[11px] font-extrabold ink-accent">{note}</span> : null}
    </Link>
  );

  return (
    <div className="relative">
      <button
        ref={button}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={t("header.accountMenu")}
        className={plain}
      >
        <span className="relative grid shrink-0 place-items-center">
          <UserRound className="size-[19px]" aria-hidden />
          {/* A dot, not a count: the menu says how many and where. */}
          {unread ? <span aria-hidden className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-[#f2683a]" /> : null}
        </span>
        {/* The name a shopper gave, as they typed it. */}
        <span dir="auto" className="max-w-[110px] truncate">{name}</span>
        {unread ? <span className="sr-only">, {t("header.unreadCount", { count: unread })}</span> : null}
        <ChevronDown className={`size-3.5 shrink-0 text-[#536b8c] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={t("header.accountMenu")}
          onKeyDown={onMenuKey}
          className="absolute end-0 top-full z-50 mt-2 w-72 rounded-2xl border border-[#d5dfeb] bg-white p-1.5 shadow-[0_18px_40px_rgba(10,40,90,.16)]"
        >
          {entry("/account#orders", <Package className="size-4" />, "account.sectionOrders", signals.onTheWay ? t("header.onTheWay", { count: signals.onTheWay }) : null)}
          {entry("/account#messages", <MessageCircle className="size-4" />, "chat.sectionMessages", signals.unreadMessages ? t("header.unreadCount", { count: signals.unreadMessages }) : null)}
          {/* Only while NetLet has answered and the shopper has not read it:
              a standing link to support is on the account page and the footer. */}
          {signals.unreadSupport ? entry("/account#help", <LifeBuoy className="size-4" />, "support.section", t("header.unreadCount", { count: signals.unreadSupport })) : null}
          {entry("/account", <UserRound className="size-4" />, "header.menuAccount")}
          {portal ? (
            <>
              <div role="separator" className="my-1 h-px bg-[#e6e9ef]" />
              {entry("/admin", <LayoutDashboard className="size-4" />, portal)}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
