/**
 * How an assistant's answer is drawn: its words, and the searches it offers.
 *
 * The model cannot see the catalogue, so it never names a product as for
 * sale; what it can do is suggest what to look for. It writes a suggestion as
 * `[[search: wireless earbuds]]` on a line of its own (the gateway's prompt
 * says so), and the page draws that as a button that runs the search on
 * NetLet — the shop's own search answers whether anything matches, so the
 * model never has to be right about stock to be useful.
 *
 * Pure, so the rule for what may become a button is tested rather than
 * trusted: a term is only letters, digits, spaces and a few joiners, at most
 * `MAX_TERM` long, never carries contact details, and at most
 * `MAX_SEARCHES` are drawn. A marker that breaks those rules is dropped, not
 * shown as text. While an answer is still arriving, a marker not yet closed
 * is held back rather than flashed half-written.
 */
import { contactFindings } from "../commerce/contactFilter.js";

export const MAX_SEARCHES = 3;
const MAX_TERM = 60;
const MARKER = /\[\[\s*search\s*:\s*([^\]\n]{1,200}?)\s*\]\]/gi;
const TERM = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} '&.,+\-]*$/u;

export type ChatPiece = { kind: "text"; text: string } | { kind: "search"; term: string };

function acceptable(term: string): boolean {
  return term.length <= MAX_TERM && TERM.test(term) && contactFindings(term).length === 0;
}

/** The answer as text runs and search buttons, in the order written. */
export function chatPieces(answer: string, options: { streaming?: boolean } = {}): ChatPiece[] {
  let text = answer;
  if (options.streaming) {
    /* A marker still being written: hold it back until it closes. */
    const open = text.lastIndexOf("[[");
    if (open !== -1 && text.indexOf("]]", open) === -1) text = text.slice(0, open);
  }
  const pieces: ChatPiece[] = [];
  const seen = new Set<string>();
  let at = 0;
  for (const match of text.matchAll(MARKER)) {
    const before = text.slice(at, match.index);
    if (before.trim()) pieces.push({ kind: "text", text: before });
    at = match.index! + match[0].length;
    const term = match[1].replace(/\s+/g, " ").trim();
    const key = term.toLowerCase();
    if (acceptable(term) && !seen.has(key) && seen.size < MAX_SEARCHES) {
      seen.add(key);
      pieces.push({ kind: "search", term });
    }
  }
  const rest = text.slice(at);
  if (rest.trim()) pieces.push({ kind: "text", text: rest });
  /* Blank lines left where markers stood would draw as gaps. */
  return pieces
    .map((piece): ChatPiece => (piece.kind === "text" ? { kind: "text", text: piece.text.replace(/\n{3,}/g, "\n\n").trim() } : piece))
    .filter(piece => piece.kind === "search" || piece.text);
}
