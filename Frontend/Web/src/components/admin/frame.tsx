/**
 * The portal's frame pieces: the side menu, the bar above the page and the
 * page jump.
 *
 * **The menu is always there on a wide screen, and folds to its icons.** A
 * deep navy column at the page's start, one group per kind of work, the page
 * you are on marked by a lighter plate and an orange edge; a press at its foot
 * folds it to a rail of icons (each named, so a screen reader and a pointer's
 * tooltip still say what it opens), remembered on the device. Below `lg` it
 * is a drawer from the same edge, over a dimmed page, a modal there
 * (`useOverlay`): Escape, the dim or a link closes it.
 *
 * **The page jump is the menu typed.** Twenty-eight pages are a lot to scan;
 * Ctrl or ⌘ with K (or the bar's search button) opens a box that narrows the
 * same list, `can()` and all, as it is typed — the WAI-ARIA combobox, focus in
 * the box and the highlighted page named by `aria-activedescendant`.
 */
import { useTranslation } from "@/hooks/useTranslation";
import { useOverlay } from "@/hooks/useOverlay";
import { appPath } from "@/lib/basePath";
import { footerLogoImage } from "@/lib/brandAssets";
import { readStored, writeStored } from "@/lib/browserStore";
import type { MessageKey } from "@shared/i18n/dictionary";
import { ChevronsLeft, CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "wouter";

export type FrameLink = { href: string; label: MessageKey; icon: ReactNode };
export type FrameGroup = { label: MessageKey | null; links: FrameLink[] };

const RAIL_KEY = "portal:rail";

/** Whether the wide menu is folded to its icons, kept on the device. */
export function useRail(): [boolean, (folded: boolean) => void] {
  const [folded, setFolded] = useState(() => readStored(RAIL_KEY) === "1");
  return [folded, (next: boolean) => {
    setFolded(next);
    writeStored(RAIL_KEY, next ? "1" : "0");
  }];
}

/** A product's page is still Products; Overview alone must match exactly. */
export function isActiveHref(location: string, href: string): boolean {
  return location === href || (href !== "/admin" && location.startsWith(`${href}/`));
}

function MenuList({ groups, folded, onNavigate }: { groups: FrameGroup[]; folded: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const [location] = useLocation();
  return (
    <div className={folded ? "space-y-3" : "space-y-5"}>
      {groups.map(group => (
        <div key={group.label ?? "top"}>
          {group.label ? (
            folded
              ? <div aria-hidden className="mx-auto mb-2 h-px w-8 bg-white/15" />
              : <p className="mb-1.5 px-3 text-[12px] font-semibold text-white/60">{t(group.label)}</p>
          ) : null}
          {/* The group's name for a screen reader too, when the rail hides it. */}
          <ul className="space-y-0.5" aria-label={group.label ? t(group.label) : undefined}>
            {group.links.map(link => {
              const active = isActiveHref(location, link.href);
              const label = t(link.label);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    title={folded ? label : undefined}
                    onClick={onNavigate}
                    className={`portal-link relative flex items-center gap-3 rounded-xl text-[14px] font-semibold ${folded ? "mx-auto size-11 justify-center" : "px-3 py-2.5"} ${active ? "bg-white/[.13] text-white" : "text-white/80 hover:bg-white/[.12] hover:text-white"}`}
                  >
                    {active ? <span aria-hidden className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-[#f2683a]" /> : null}
                    <span aria-hidden className="shrink-0 [&_svg]:size-[18px]">{link.icon}</span>
                    <span className={folded ? "sr-only" : "min-w-0 truncate"}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Brand({ folded }: { folded: boolean }) {
  const { t } = useTranslation();
  return (
    <Link href="/admin" aria-label={t("admin.overview")} className={`flex h-16 shrink-0 items-center ${folded ? "justify-center" : "px-5"}`}>
      {folded
        ? <img src={appPath("/brand/icon-192.png")} alt="" loading="eager" decoding="async" className="size-9 rounded-lg" />
        : <img src={footerLogoImage} alt="NetLet" loading="eager" decoding="async" className="h-7 w-auto object-contain" />}
    </Link>
  );
}

/** The wide screen's menu: a column at the page's start, folding to a rail. */
export function Sidebar({ groups, folded, onFold }: { groups: FrameGroup[]; folded: boolean; onFold: (folded: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("admin.title")}
      className={`portal-sidebar sticky top-0 hidden h-screen shrink-0 flex-col bg-[#0a1f45] lg:flex ${folded ? "w-[76px]" : "w-[256px]"}`}
    >
      <Brand folded={folded} />
      <div className={`hide-scrollbar min-h-0 flex-1 overflow-y-auto pb-4 ${folded ? "px-2.5" : "px-3"}`}>
        <MenuList groups={groups} folded={folded} />
      </div>
      <div className={`border-t border-white/10 p-3 ${folded ? "flex justify-center" : ""}`}>
        <button
          type="button"
          onClick={() => onFold(!folded)}
          aria-expanded={!folded}
          aria-label={folded ? t("shell.expandMenu") : t("shell.collapseMenu")}
          title={folded ? t("shell.expandMenu") : undefined}
          className={`flex h-10 items-center gap-2.5 rounded-xl text-[13px] font-semibold text-white/75 hover:bg-white/[.12] hover:text-white ${folded ? "w-11 justify-center" : "w-full px-3"}`}
        >
          <ChevronsLeft aria-hidden className={`size-[18px] shrink-0 transition-transform rtl:-scale-x-100 ${folded ? "rotate-180" : ""}`} />
          {folded ? null : <span>{t("shell.collapseMenu")}</span>}
        </button>
      </div>
    </nav>
  );
}

/** Below `lg`: the same menu as a drawer from the page's start. */
export function MenuDrawer({ groups, open, onClose }: { groups: FrameGroup[]; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  useOverlay(open, onClose);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) close.current?.focus();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 lg:hidden">
      <button type="button" aria-label={t("shell.closeMenu")} tabIndex={-1} onClick={onClose} className="sheet-scrim absolute inset-0 bg-[#06142e]/55" />
      <div role="dialog" aria-modal="true" aria-label={t("admin.title")} className="portal-drawer absolute inset-y-0 start-0 flex w-[min(300px,86vw)] flex-col bg-[#0a1f45] shadow-2xl">
        <div className="flex items-center justify-between pe-3">
          <Brand folded={false} />
          <button ref={close} type="button" onClick={onClose} aria-label={t("shell.closeMenu")} className="grid size-11 place-items-center rounded-xl text-white/80 hover:bg-white/[.12] hover:text-white">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <nav aria-label={t("admin.title")} className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          <MenuList groups={groups} folded={false} onNavigate={onClose} />
        </nav>
      </div>
    </div>,
    document.body,
  );
}

/** The bar's button that opens the page jump, with the shortcut where there is a keyboard to press it on. */
export function JumpButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      className="flex h-10 min-w-0 items-center gap-2.5 rounded-xl border border-[#dfe5ee] bg-[#f6f8fb] px-3 text-[14px] text-[#536b8c] hover:border-[#c9d3e1] tint-on-hover sm:w-64"
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="hidden truncate sm:inline">{t("shell.jumpTo")}</span>
      <span className="sr-only sm:hidden">{t("shell.jumpTo")}</span>
      <kbd aria-hidden className="ms-auto hidden rounded-md border border-[#dfe5ee] bg-white px-1.5 py-0.5 font-sans text-[11px] font-semibold text-[#536b8c] pointer-fine:sm:inline">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}

/** Folds Arabic's spellings and case so "مخزون" and "Stock" are found however typed. */
function fold(text: string): string {
  return text.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْـ]/g, "").trim();
}

/** The page jump: the menu, narrowed as it is typed. */
export function PageJump({ groups, open, onClose }: { groups: FrameGroup[]; open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useOverlay(open, onClose);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    input.current?.focus();
  }, [open]);

  const all = useMemo(
    () => groups.flatMap(group => group.links.map(link => ({ ...link, group: group.label ? t(group.label) : null, name: t(link.label) }))),
    [groups, t],
  );
  const found = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return all;
    return all.filter(link => words.every(word => fold(`${link.name} ${link.group ?? ""}`).includes(word)));
  }, [all, query]);
  useEffect(() => setActive(0), [query]);

  if (!open) return null;
  const go = (href: string) => {
    onClose();
    navigate(href);
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <button type="button" aria-label={t("common.close")} tabIndex={-1} onClick={onClose} className="sheet-scrim absolute inset-0 bg-[#06142e]/45" />
      <div role="dialog" aria-modal="true" aria-label={t("shell.jumpTo")} className="portal-pop relative w-full max-w-lg overflow-hidden rounded-2xl border border-[#e3e8f0] bg-white shadow-[0_24px_60px_-20px_rgba(10,40,90,0.45)]">
        <div className="flex items-center gap-3 border-b border-[#eef1f6] px-4">
          <Search className="size-5 shrink-0 text-[#536b8c]" aria-hidden />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={found[active] ? `${listId}-${active}` : undefined}
            aria-label={t("shell.jumpTo")}
            placeholder={t("shell.jumpPlaceholder")}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive(index => Math.min(found.length - 1, index + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(index => Math.max(0, index - 1));
              } else if (event.key === "Enter" && found[active]) {
                event.preventDefault();
                go(found[active].href);
              }
            }}
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-[#0a285a] outline-none placeholder:text-[#6b7c93]"
          />
        </div>
        <ul id={listId} role="listbox" aria-label={t("shell.jumpPages")} className="max-h-[50vh] overflow-y-auto p-2">
          {found.length === 0 ? (
            <li role="presentation" className="px-3 py-6 text-center text-[14px] ink-muted">{t("shell.jumpNone")}</li>
          ) : found.map((link, index) => (
            <li
              key={link.href}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={event => event.preventDefault()}
              onClick={() => go(link.href)}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ${index === active ? "bg-[#eef2fb] text-[#0a285a]" : "text-[#3d5376]"}`}
            >
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#f1f4f9] text-[#0a285a] [&_svg]:size-4">{link.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{link.name}</span>
                {link.group ? <span className="block truncate text-[12px] ink-muted">{link.group}</span> : null}
              </span>
              {index === active ? <CornerDownLeft aria-hidden className="size-4 shrink-0 text-[#536b8c] rtl:-scale-x-100" /> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** Ctrl or ⌘ with K opens the page jump from anywhere in the portal. */
export function useJumpShortcut(onOpen: () => void) {
  const open = useRef(onOpen);
  open.current = onOpen;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && (event.key === "k" || event.key === "K" || event.code === "KeyK")) {
        event.preventDefault();
        open.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
