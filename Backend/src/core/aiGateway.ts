/**
 * Where the AI gateway is and whether it is set up — infrastructure, beside
 * `maps.ts` and `captcha.ts`, because the security headers need the answer as
 * much as the data layer does: the browser streams from the gateway, so the
 * CSP must name its origin. `Backend/src/services/aiGateway.ts` decides who gets a token.
 */
import { createHmac } from "node:crypto";
import { ENV } from "./env.js";
import { MIN_SECRET_LENGTH } from "../../../Shared/ai/gateway.js";

/**
 * The gateway's origin, if it is one a browser may be sent to: https, or
 * plain http only to this machine for `wrangler dev`. No path — the Worker
 * serves its routes from its root — and no credentials in the address.
 */
export function gatewayOrigin(raw: string = ENV.aiGatewayUrl): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    if (url.protocol !== "https:" && !local) return null;
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function gatewayConfigured(): boolean {
  return gatewayOrigin() !== null && ENV.aiGatewaySecret.length >= MIN_SECRET_LENGTH;
}

/**
 * A guest's subject: the same for every token their address asks for, so a
 * fresh token is not a fresh allowance, and meaningless to anybody without
 * the secret.
 */
export function guestSubject(address: string | null): string {
  const digest = createHmac("sha256", ENV.aiGatewaySecret).update(`guest:${address ?? "unknown"}`).digest("base64url");
  return `a:${digest.slice(0, 22)}`;
}
