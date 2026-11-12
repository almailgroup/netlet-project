/**
 * A page's own search, on the owner's word ("the search bar should only
 * search for what's in the specific page … category, deals, profile and cart
 * page"). On Categories, the Deals page, the account's home and the cart the
 * header's field stops being the shop's search and narrows the page instead:
 * the departments, subcategories and stores; the deals; the places on the
 * account; the lines in the bag. Everywhere else it is the shop's search, as
 * before.
 *
 * **The words live in the page's address** (`?q=`, replaced rather than
 * pushed, so Back leaves the page rather than stepping back through letters),
 * which is what lets the header's field and the page agree without either
 * owning the other, and lets a phone's account and cart — which have no
 * header, on the owner's word — draw the same field at their top
 * (`PageSearchField`, when `useHeaderDrawn` says there is none). Nothing is
 * asked of the server while typing: the page narrows what it already holds,
 * by `textsMatch`, the shop's own folding and stemming.
 *
 * With nothing matching, the page says so and offers the shop's search for
 * the same words (`PageSearchMissed`), since somebody typing a product's name
 * on the Categories page is still looking for the product.
 */
import { Search, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { searchPath, searchTermFrom } from "@shared/commerce/browse";
import type { MessageKey } from "@shared/i18n/dictionary";
import { CARD } from "@/components/layout/Page";
import { useTranslation } from "@/hooks/useTranslation";
import { isolate } from "@/lib/isolate";

/** What a page's field says: its placeholder and its name to a screen reader. */
export type PageSearchSetup = { placeholder: MessageKey };

/** Whether the shell drew the header on this page — a phone's account and cart have none. */
export const HeaderDrawnContext = createContext(true);
export const useHeaderDrawn = () => useContext(HeaderDrawnContext);

/** The words the page is narrowed by, trimmed, from its address. */
export function usePageTerm(): string {
  const query = useSearch();
  return searchTermFrom(query);
}

/** Writes the words into the address in place — every other part of it kept. */
export function useWritePageTerm() {
  const [location, navigate] = useLocation();
  const query = useSearch();
  return (value: string) => {
    const params = new URLSearchParams(query);
    if (value.trim()) params.set("q", value);
    else params.delete("q");
    const next = params.toString();
    navigate(`${location}${next ? `?${next}` : ""}`, { replace: true });
  };
}

/**
 * The field: the header's look — a white pill, clear while there are words,
 * the navy disc — searching the page it is on. The disc and Enter put the
 * keyboard away, the results being on the page already; Escape empties it.
 */
export function PageSearchField({ setup, className = "" }: { setup: PageSearchSetup; className?: string }) {
  const { t } = useTranslation();
  const term = usePageTerm();
  const write = useWritePageTerm();
  const field = useRef<HTMLInputElement>(null);
  /* What is typed, kept as typed: the address is trimmed when read, and a
     field fed back from it would lose the space between two words. */
  const [value, setValue] = useState(term);
  useEffect(() => { setValue(current => (current.trim() === term ? current : term)); }, [term]);
  const change = (next: string) => { setValue(next); write(next); };
  return (
    <form role="search" onSubmit={event => { event.preventDefault(); field.current?.blur(); }} className={`min-w-0 flex-1 ${className}`}>
      <div
        onMouseDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); field.current?.focus(); } }}
        className="glass-field flex h-11 cursor-text items-center rounded-full py-1 ps-2 pe-1 lg:h-12"
      >
        <input
          ref={field}
          type="search"
          data-page-search=""
          value={value}
          onChange={event => change(event.target.value)}
          onKeyDown={event => { if (event.key === "Escape" && value) { event.preventDefault(); change(""); } }}
          aria-label={t(setup.placeholder)}
          aria-keyshortcuts="/"
          enterKeyHint="search"
          placeholder={t(setup.placeholder)}
          className="type-body w-full min-w-0 bg-transparent px-3 outline-none placeholder:text-[#536b8c] [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { change(""); field.current?.focus(); }} aria-label={t("header.searchClear")} className="glass type-control grid size-7 shrink-0 place-items-center rounded-full !text-[#536b8c]">
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
        <button type="submit" aria-label={t("search.pageSubmit")} className="glass glass-navy pressable ms-1.5 grid size-9 shrink-0 place-items-center rounded-full lg:size-10">
          <Search className="size-[17px]" aria-hidden />
        </button>
      </div>
    </form>
  );
}

/** Nothing on the page matches: said, with the shop's own search for the same words. */
export function PageSearchMissed({ term, shopWide = true }: { term: string; shopWide?: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="status" className={`${CARD} px-5 py-8 text-center`}>
      <p className="text-[16px] font-bold text-[#0a285a]">{t("search.pageNoMatch", { term: isolate(term) })}</p>
      {shopWide ? (
        <Link href={searchPath(term)} className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[#d5dfeb] bg-white px-5 text-[14px] font-bold text-[#0a285a] hover:bg-[#f0f2f5]">
          <Search className="size-4" aria-hidden />
          {t("search.wholeShop", { term: isolate(term) })}
        </Link>
      ) : null}
    </div>
  );
}
