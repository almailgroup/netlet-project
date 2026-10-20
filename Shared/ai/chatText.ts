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
 * It may also end on a question or two the shopper might ask next, each
 * written `[[ask: Is it waterproof?]]`, which the page draws as presses that
 * ask it — the next step offered rather than left to be typed on a phone.
 *
 * Pure, so the rule for what may become a button is tested rather than
 * trusted: a term is only letters, digits, spaces and a few joiners, at most
 * `MAX_TERM` long, a question at most `MAX_QUESTION` with ordinary
 * punctuation, neither ever carries contact details, and at most
 * `MAX_SEARCHES` and `MAX_ASKS` are drawn. A marker that breaks those rules
 * is dropped, not shown as text. While an answer is still arriving, a marker
 * not yet closed is held back rather than flashed half-written.
 */
import { contactFindings } from "../commerce/contactFilter.js";

export const MAX_SEARCHES = 3;
export const MAX_ASKS = 3;
const MAX_TERM = 60;
const MAX_QUESTION = 80;
const MARKER = /\[\[\s*(search|ask)\s*:\s*([^\]\n]{1,200}?)\s*\]\]/gi;
const TERM = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} '&.,+\-]*$/u;
/* A question may carry what a question does — commas, a dash, its mark — and nothing that builds markup. */
const QUESTION = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} '&.,+\-?!؟،()/%]*$/u;

export type ChatPiece = { kind: "text"; text: string } | { kind: "search"; term: string } | { kind: "ask"; question: string };

function acceptable(kind: "search" | "ask", text: string): boolean {
  return kind === "search"
    ? text.length <= MAX_TERM && TERM.test(text) && contactFindings(text).length === 0
    : text.length <= MAX_QUESTION && QUESTION.test(text) && contactFindings(text).length === 0;
}

/** The answer as text runs, search buttons and follow-up questions, in the order written. */
export function chatPieces(answer: string, options: { streaming?: boolean } = {}): ChatPiece[] {
  let text = answer;
  if (options.streaming) {
    /* A marker still being written: hold it back until it closes. */
    const open = text.lastIndexOf("[[");
    if (open !== -1 && text.indexOf("]]", open) === -1) text = text.slice(0, open);
  }
  const pieces: ChatPiece[] = [];
  const seen = { search: new Set<string>(), ask: new Set<string>() };
  const ceiling = { search: MAX_SEARCHES, ask: MAX_ASKS };
  let at = 0;
  for (const match of text.matchAll(MARKER)) {
    const before = text.slice(at, match.index);
    if (before.trim()) pieces.push({ kind: "text", text: before });
    at = match.index! + match[0].length;
    const kind = match[1].toLowerCase() as "search" | "ask";
    const said = match[2].replace(/\s+/g, " ").trim();
    const key = said.toLowerCase();
    if (acceptable(kind, said) && !seen[kind].has(key) && seen[kind].size < ceiling[kind]) {
      seen[kind].add(key);
      pieces.push(kind === "search" ? { kind, term: said } : { kind, question: said });
    }
  }
  const rest = text.slice(at);
  if (rest.trim()) pieces.push({ kind: "text", text: rest });
  /* Blank lines left where markers stood would draw as gaps. */
  return pieces
    .map((piece): ChatPiece => (piece.kind === "text" ? { kind: "text", text: piece.text.replace(/\n{3,}/g, "\n\n").trim() } : piece))
    .filter(piece => piece.kind !== "text" || piece.text);
}

/** A turn of a conversation, as far as what to offer next is concerned. */
export type ChatTurn = { role: "user" | "assistant"; text: string; state?: string };

/**
 * What a conversation offers to ask next — one row of presses above its box,
 * the same in every chat. Before anything is asked, the starters fitted to the
 * page. After an answer, the questions that answer offered; when it offered
 * none, or only ones already asked, the starters nobody has asked yet, at most
 * `MAX_ASKS` of either. Nothing while an answer is still arriving: a question
 * about an answer that is not there yet is not one to offer.
 */
export function nextQuestions(turns: readonly ChatTurn[], starters: readonly string[]): { questions: string[]; followUps: boolean } {
  const last = turns[turns.length - 1];
  if (!last) return { questions: [...starters], followUps: false };
  if (last.role !== "assistant" || last.state === "streaming") return { questions: [], followUps: false };
  const asked = new Set(turns.flatMap(turn => (turn.role === "user" ? [turn.text.trim().toLowerCase()] : [])));
  const fresh = (question: string) => !asked.has(question.trim().toLowerCase());
  const offered = last.state === undefined || last.state === "done"
    ? chatPieces(last.text).flatMap(piece => (piece.kind === "ask" && fresh(piece.question) ? [piece.question] : []))
    : [];
  if (offered.length) return { questions: offered, followUps: true };
  return { questions: starters.filter(fresh).slice(0, MAX_ASKS), followUps: false };
}
