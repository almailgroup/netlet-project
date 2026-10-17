/**
 * A conversation with the shop's assistant, streamed from the AI gateway
 * (`workers/ai-gateway/`, `POST /api/ai/chat`).
 *
 * The words arrive as they are written — Server-Sent Events read off the
 * response body, through the same `createSseReader` the gateway uses on
 * Gemini's stream — so a phone shows the first sentence while the rest is
 * still coming. `available` is false until the server says the gateway is
 * set up and model calls are on; a caller draws nothing while it is false,
 * the rule every optional service here follows.
 *
 * What it refuses before anything leaves the page is what the gateway would
 * refuse — the length, and a phone number, an email or a link, by the chat's
 * own filter — so a shopper is told while typing rather than after a round
 * trip, and nothing they typed of that kind reaches a third party.
 *
 * `persist` keeps the conversation for the tab (`sessionStorage`, through
 * `browserStore`): a reload or a link opened in place finds it where it was,
 * and closing the tab ends it, so a shared computer does not hand the next
 * person somebody's questions. An answer still arriving when the page went is
 * kept as far as it got, marked stopped.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "@/hooks/useTranslation";
import { TicketHolder, callGateway } from "@/lib/aiGateway";
import { readSession, removeSession, writeSession } from "@/lib/browserStore";
import { contactFindings, type ContactKind } from "@shared/commerce/contactFilter";
import type { ProductBrief } from "@shared/commerce/assistant";
import {
  GATEWAY_ROUTES,
  MAX_CHAT_TEXT,
  MAX_CHAT_TURNS,
  createSseReader,
  parseChatEvent,
  type ChatRequest,
  type GatewayErrorCode,
} from "@shared/ai/gateway";

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** An answer still arriving, finished, cut short by Stop, stopped by the model's filter, or lost. */
  state: "streaming" | "done" | "stopped" | "blocked" | "failed";
};

export type ChatStatus = "idle" | "sending" | "streaming";

/** Why a message may not be sent as typed, or null when it may. */
export function chatDraftProblem(text: string): { kind: "empty" } | { kind: "tooLong" } | { kind: "contact"; found: ContactKind[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  if (trimmed.length > MAX_CHAT_TEXT) return { kind: "tooLong" };
  const found = contactFindings(trimmed);
  return found.length ? { kind: "contact", found } : null;
}

/** At most this many messages are kept for the tab; the gateway reads the last twelve anyway. */
const KEPT = 40;

function restore(key: string | undefined): ChatMessage[] {
  if (!key) return [];
  try {
    const parsed: unknown = JSON.parse(readSession(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is ChatMessage =>
        Boolean(entry) && (entry.role === "user" || entry.role === "assistant") && typeof entry.text === "string" && typeof entry.id === "number")
      .map(entry => ({ ...entry, text: entry.text.slice(0, MAX_CHAT_TEXT * 4), state: entry.state === "streaming" ? "stopped" : entry.state }))
      .slice(-KEPT);
  } catch {
    return [];
  }
}

export function useAIChat(options: {
  product?: ProductBrief | null;
  /** One question at a time: each sends alone and replaces the last — the Help page's box. */
  single?: boolean;
  /** Keep the conversation for this tab under this key. */
  persist?: string;
} = {}) {
  const { locale } = useTranslation();
  const available = trpc.ai.available.useQuery(undefined, { staleTime: 5 * 60_000 });
  const mint = trpc.ai.chatSession.useMutation();
  const mintRef = useRef(mint.mutateAsync);
  mintRef.current = mint.mutateAsync;
  const holder = useRef(new TicketHolder(() => mintRef.current()));

  const [messages, setMessages] = useState<ChatMessage[]>(() => restore(options.persist));
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<GatewayErrorCode | null>(null);
  const controller = useRef<AbortController | null>(null);
  const nextId = useRef(messages.reduce((top, message) => Math.max(top, message.id), 0) + 1);
  const product = options.product ?? null;
  const single = options.single ?? false;
  const persist = options.persist;

  /* Kept once an answer settles, not on every word of one arriving. */
  useEffect(() => {
    if (!persist || status !== "idle") return;
    if (messages.length) writeSession(persist, JSON.stringify(messages.slice(-KEPT)));
    else removeSession(persist);
  }, [persist, messages, status]);

  /* Leaving the page stops the answer, and the gateway stops Gemini with it. */
  useEffect(() => () => controller.current?.abort(), []);

  const settle = useCallback((id: number, state: ChatMessage["state"]) => {
    setMessages(list => list.map(message => (message.id === id && message.state === "streaming" ? { ...message, state } : message)));
  }, []);

  /** Ask `text` after `base`, the conversation it follows. */
  const ask = useCallback(async (text: string, base: ChatMessage[]): Promise<boolean> => {
    const problem = chatDraftProblem(text);
    if (problem) {
      if (problem.kind === "contact") setError("contact_details");
      else if (problem.kind === "tooLong") setError("too_large");
      return false;
    }
    if (status !== "idle") return false;
    setError(null);

    const question: ChatMessage = { id: nextId.current++, role: "user", text: text.trim(), state: "done" };
    const answer: ChatMessage = { id: nextId.current++, role: "assistant", text: "", state: "streaming" };
    /* The conversation so far, the answers that arrived whole or in part, ending on this question. */
    const earlier = single ? [] : base.filter(message => message.text && message.state !== "failed");
    const history = [...earlier, question].slice(-MAX_CHAT_TURNS);
    while (history.length && history[0].role !== "user") history.shift();
    const body: ChatRequest = {
      locale,
      messages: history.map(message => ({ role: message.role, text: message.text.slice(0, MAX_CHAT_TEXT) })),
      product,
    };
    setMessages(single ? [question, answer] : [...base, question, answer]);
    setStatus("sending");

    const abort = new AbortController();
    controller.current = abort;
    try {
      const call = await callGateway(holder.current, GATEWAY_ROUTES.chat, body, abort.signal);
      if (!call.ok) {
        setError(call.code);
        settle(answer.id, "failed");
        return false;
      }
      setStatus("streaming");
      const reader = call.response.body!.pipeThrough(new TextDecoderStream()).getReader();
      let finish: ChatMessage["state"] = "done";
      const sse = createSseReader(data => {
        const event = parseChatEvent(data);
        if (!event) return;
        if (event.type === "delta") {
          setMessages(list => list.map(message => (message.id === answer.id ? { ...message, text: message.text + event.text } : message)));
        } else if (event.type === "done") {
          finish = event.finish === "blocked" ? "blocked" : "done";
        } else {
          finish = "failed";
          setError(event.code);
        }
      });
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        sse.push(value);
      }
      sse.end();
      settle(answer.id, finish);
      return true;
    } catch {
      if (abort.signal.aborted) settle(answer.id, "stopped");
      else {
        setError("model_unavailable");
        settle(answer.id, "failed");
      }
      return false;
    } finally {
      if (controller.current === abort) controller.current = null;
      setStatus("idle");
    }
  }, [locale, product, settle, single, status]);

  const send = useCallback((text: string) => ask(text, messages), [ask, messages]);

  /**
   * Ask the last question again, after an answer that did not come — in its
   * place, so the conversation does not carry the failure twice.
   */
  const retry = useCallback(() => {
    const at = messages.map(message => message.role).lastIndexOf("user");
    if (at < 0 || status !== "idle") return;
    void ask(messages[at].text, messages.slice(0, at));
  }, [ask, messages, status]);

  /** Stop the answer being written; what has arrived stays. */
  const stop = useCallback(() => controller.current?.abort(), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    setMessages([]);
    setError(null);
  }, []);

  return {
    /** Undefined while the server is asked; draw nothing until it is true. */
    available: available.data?.chat,
    messages,
    status,
    error,
    send,
    retry,
    stop,
    reset,
    dismissError: () => setError(null),
  };
}
