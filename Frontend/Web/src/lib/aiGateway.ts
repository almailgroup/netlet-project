/**
 * The browser's side of the AI gateway (`Backend/gateway/`), shared by
 * `useAIChat` and `useProductGenerator`: holding a token until it lapses,
 * calling a route with it, and turning a refusal into a sentence.
 *
 * The gateway's address is never built into the page. It arrives with each
 * token from `ai.chatSession` / `ai.catalogSession`, so the deployment sets
 * one server variable (`AI_GATEWAY_URL`) and every page follows it — and a
 * deployment without it simply gets `{ available: false }`.
 */
import type { MessageKey } from "@shared/i18n/dictionary";
import type { GatewayErrorCode } from "@shared/ai/gateway";

export type GatewayTicket = { url: string; token: string; expiresAt: number };
type Session = { available: false } | ({ available: true } & GatewayTicket);

/** A token is renewed this long before it lapses, so a request never leaves with one about to. */
const RENEW_MARGIN_MS = 30_000;

/**
 * Keeps one token and asks for another only when it is about to lapse or the
 * gateway has refused it — once, so a server and gateway whose secrets
 * disagree fail at the second try rather than looping.
 */
export class TicketHolder {
  private ticket: GatewayTicket | null = null;

  constructor(private readonly mint: () => Promise<Session>) {}

  async get(fresh = false): Promise<GatewayTicket | null> {
    if (!fresh && this.ticket && this.ticket.expiresAt - RENEW_MARGIN_MS > Date.now()) return this.ticket;
    const session = await this.mint();
    this.ticket = session.available ? { url: session.url, token: session.token, expiresAt: session.expiresAt } : null;
    return this.ticket;
  }

  forget(): void {
    this.ticket = null;
  }
}

export type GatewayCall = { ok: true; response: Response } | { ok: false; code: GatewayErrorCode };

/** POST a JSON body to a gateway route, renewing the token once if it is refused. */
export async function callGateway(holder: TicketHolder, path: string, body: unknown, signal?: AbortSignal): Promise<GatewayCall> {
  for (const fresh of [false, true]) {
    const ticket = await holder.get(fresh);
    if (!ticket) return { ok: false, code: "not_configured" };
    const response = await fetch(`${ticket.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ticket.token}` },
      body: JSON.stringify(body),
      signal,
      credentials: "omit",
    });
    if (response.ok) return { ok: true, response };
    const code = await response.json().then((answer: { error?: { code?: GatewayErrorCode } }) => answer.error?.code, () => undefined);
    if (code === "unauthorised" && !fresh) {
      holder.forget();
      continue;
    }
    return { ok: false, code: code ?? "model_unavailable" };
  }
  return { ok: false, code: "unauthorised" };
}

/** What a shopper or a seller is told for each refusal; nobody is shown a code. */
export function gatewayErrorMessage(code: GatewayErrorCode): MessageKey {
  switch (code) {
    case "rate_limited":
      return "ai.error.tooMany";
    case "contact_details":
      return "ai.error.contact";
    case "model_refused":
      return "ai.error.refused";
    case "too_large":
      return "ai.error.tooLarge";
    case "bad_request":
      return "ai.error.invalid";
    default:
      return "ai.error.unavailable";
  }
}

/** A photo as the catalogue route takes it: base64 without the `data:` prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  /* In slices, because spreading a megabyte into one call overflows the stack. */
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
